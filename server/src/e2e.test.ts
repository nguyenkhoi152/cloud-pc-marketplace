/**
 * TÍCH HỢP CỤC BỘ end-to-end (không phải Supabase/Fuji/host thật):
 *   THẬT: Postgres 18, API HTTP (createApiHandler trên cổng thật), worker, host-agent (heartbeat + kéo lệnh qua HTTP),
 *         gateway (HTTP + WebSocket thật), xác thực lệnh/credential, quote, đối soát sự kiện.
 *   GIẢ CÓ NHÃN: chuỗi khối (log dựng bằng ABI), operator (tạo sự kiện Activated), guest/Selkies (upstream HTTP+WS echo),
 *         xác thực người dùng (stub của /auth/v1/user).
 * Luồng: enrollment → quote → Funded → chuẩn bị → activate → Active → cấp token → renter xem qua gateway →
 *        Settled → thu hồi (đóng kết nối, chặn reconnect) → reset → xác minh → nhả máy.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { encodeAbiParameters, encodeEventTopics, keccak256, toBytes, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { WebSocket, WebSocketServer } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ESCROW_EVENTS_ABI, type LogsClientLike, type ReceiptLike } from "@cpm/shared/src/chainEvents";
import { Agent, MemoryCounter, unavailableGuest, type GuestController } from "../../host-agent/src/agent";
import { CLOSE_REVOKED, Gateway } from "../../host-agent/src/gateway";
import { linkWallet, makeAdmin, makeApprovedHost, makeMachine, renterWithWallet, reserve } from "../../db/tests/harness";
import { asPglite, startRealPg, type RealPg } from "../../db/tests/realpg";
import { ESCROW_STATE } from "./chainReader";
import { pgServiceDb, type ServerConfig } from "./core";
import { createApiHandler } from "./http";
import { makeControlPlaneProvider } from "./api/agent";
import { runOnce, type ChainOperator, type WorkerDeps } from "./worker";

const ESCROW = "0x" + "e5".repeat(20);
const PCP = "0x" + "c1".repeat(20);
const TREASURY = "0x" + "d7".repeat(20);

let real: RealPg;
let admin: pg.Client;
let pool: pg.Pool;
const A = () => asPglite(admin);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------- chuỗi khối GIẢ ---------------- */
const chain = { events: [] as { bookingId: string; eventName: string; args: Record<string, unknown>; logIndex: number; blockNumber: bigint }[], state: new Map<string, number>(), receipts: new Map<string, ReceiptLike>(), activated: [] as string[] };
const chainLogs: LogsClientLike = {
  async getBlockNumber() { return 1000n; },
  async getTransactionReceipt({ hash }) { const r = chain.receipts.get(hash); if (!r) throw new Error("Transaction receipt could not be found"); return r; },
  async getContractEvents(a) {
    return chain.events.filter((e) => e.bookingId === a.args.bookingId.toLowerCase() && e.blockNumber <= a.toBlock).map((e) => ({ ...e, blockHash: "0x" + "b0".repeat(32), transactionHash: keccak256(toBytes(`${e.bookingId}:${e.logIndex}`)) }));
  },
};
function logFor(eventName: string, args: Record<string, unknown>, logIndex: number) {
  const item = ESCROW_EVENTS_ABI.find((x) => x.type === "event" && x.name === eventName) as unknown as { inputs: { name: string; type: string; indexed?: boolean }[] };
  const indexed = item.inputs.filter((i) => i.indexed);
  const plain = item.inputs.filter((i) => !i.indexed);
  const topics = encodeEventTopics({ abi: ESCROW_EVENTS_ABI, eventName: eventName as never, args: Object.fromEntries(indexed.map((i) => [i.name, args[i.name]])) as never }) as Hex[];
  return { address: ESCROW, topics, data: encodeAbiParameters(plain as never, plain.map((i) => args[i.name]) as never), logIndex, blockNumber: 990n, blockHash: ("0x" + "b0".repeat(32)) as Hex, transactionHash: null };
}
let txn = 1;
/** Phát một sự kiện lên "chuỗi" giả: vào danh sách log (cho worker quét) và một receipt (cho API reconcile). */
function emit(cid: string, eventName: string, args: Record<string, unknown>, logIndex: number): Hex {
  chain.events.push({ bookingId: cid, eventName, args: { bookingId: cid, ...args }, logIndex, blockNumber: 900n + BigInt(logIndex) });
  const hash = toHex(txn++, { size: 32 });
  chain.receipts.set(hash, { status: "success", blockNumber: 990n, blockHash: ("0x" + "b0".repeat(32)) as Hex, logs: [logFor(eventName, { bookingId: cid, ...args }, logIndex)] });
  return hash;
}

/* ---------------- guest GIẢ (đứng thay môi trường Linux/Selkies) ---------------- */
const guestCalls: string[] = [];
const fakeGuest: GuestController = {
  async prepare(i) { guestCalls.push("prepare"); return { ok: true, evidence: `guest giả sẵn sàng ${i.bookingId.slice(0, 4)}` }; },
  async stopSession() { guestCalls.push("stop"); return { ok: true, evidence: "đã dừng" }; },
  async reset() { guestCalls.push("reset"); return { ok: true, evidence: "đã reset" }; },
  async verifyReset() { guestCalls.push("verify"); return { ok: true, evidence: "đã xác minh" }; },
};

/* ---------------- dựng hệ thống ---------------- */
let apiServer: http.Server;
let apiBase = "";
let upstream: http.Server;
let upstreamWs: WebSocketServer;
let gateway: Gateway;
let gatewayUrl = "";
let workerDeps: WorkerDeps;
const tokens = new Map<string, string>();
const bearer = (userId: string) => {
  const t = "Bearer " + userId.replace(/-/g, "") + "x".repeat(10);
  tokens.set(t, userId);
  return t;
};
const abort = new AbortController();
const agents: Agent[] = [];

beforeAll(async () => {
  const r = await startRealPg();
  if (!r) throw new Error("Không có binary Postgres cục bộ");
  real = r;
  admin = await real.connect();
  pool = new pg.Pool({ host: "127.0.0.1", port: real.port, user: "postgres", database: "postgres", max: 8 });
  const cfg: ServerConfig = { supabaseUrl: "https://auth.example.test", anonKey: "k", chainId: 43113, escrow: ESCROW, pcp: PCP, treasury: TREASURY, quoteSigner: privateKeyToAccount(generatePrivateKey()), minConfirmations: 2, graceSeconds: 600, arbitrationSeconds: 86_400, configVersion: 1, walletDomain: "app.test", walletUri: "https://app.test", allowedOrigins: [] };
  const db = pgServiceDb(pool);
  const reader = { async machineOccupied() { return false; }, async stateOf(id: Hex) { return chain.state.get(id.toLowerCase()) ?? 0; } };
  const authFetch = (async (_u: string, init: RequestInit) => {
    const id = tokens.get((init.headers as Record<string, string>).authorization ?? "");
    return id ? new Response(JSON.stringify({ id, email: null })) : new Response("{}", { status: 401 });
  }) as unknown as typeof fetch;
  const handler = createApiHandler({ db, cfg, chain: chainLogs, escrowReader: reader, fetchImpl: authFetch });
  apiServer = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const out = await handler(new Request(`http://api.local${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "GET" ? undefined : (body as unknown as ArrayBuffer) }));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise<void>((ok) => apiServer.listen(0, "127.0.0.1", () => ok()));
  apiBase = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;

  // Upstream giả (đứng thay Selkies): HTTP trả "desktop", WebSocket echo.
  upstream = http.createServer((_q, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.end("desktop"); });
  upstreamWs = new WebSocketServer({ server: upstream });
  upstreamWs.on("connection", (s) => s.on("message", (d, bin) => s.send(d, { binary: bin })));
  await new Promise<void>((ok) => upstream.listen(0, "127.0.0.1", () => ok()));
  gateway = new Gateway({ upstream: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}` });
  gatewayUrl = `http://127.0.0.1:${await gateway.listen()}`;

  const operator: ChainOperator = {
    async activate(id) {
      chain.activated.push(id);
      chain.state.set(id.toLowerCase(), ESCROW_STATE.Active);
      const now = Math.floor(Date.now() / 1000);
      emit(id, "Activated", { startedAt: BigInt(now), endAt: BigInt(now + 900) }, 2);
      return ("0x" + "ab".repeat(32)) as Hex;
    },
    // Bài này không đi tới nhánh người thuê bỏ đi; nếu worker gọi nhầm thì lộ ngay.
    async claimAfterGrace() { throw new Error("claimAfterGrace không được gọi trong bài e2e này"); },
  };
  workerDeps = { db, cfg, escrowReader: reader as never, operator, provider: makeControlPlaneProvider(db, { timeoutMs: 10_000, pollMs: 25 }), chainLogs, workerId: "w-e2e", deployBlock: 1n, expireMarginSeconds: 60, leaseSeconds: 30 };
}, 120_000);
afterAll(async () => {
  abort.abort();
  await sleep(100);
  await gateway?.close();
  upstreamWs?.close();
  upstream?.closeAllConnections();
  apiServer?.closeAllConnections();
  await new Promise<void>((ok) => apiServer?.close(() => ok()));
  await new Promise<void>((ok) => upstream?.close(() => ok()));
  await pool?.end();
  await admin?.end();
  await real?.stop();
}, 60_000);

/* ---------------- tiện ích ---------------- */
const api = (method: string, p: string, token?: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${apiBase}/api${p}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const row = async (id: string) => (await admin.query("select state, access_state, (select active_booking_id from public.machines m where m.id = machine_id) as holding from public.bookings where id = $1", [id])).rows[0] as { state: string; access_state: string; holding: string | null };
const wake = () => admin.query("update public.outbox_jobs set available_at = now() where status = 'pending'");
async function until(pred: () => Promise<boolean>, what: string, steps = 60) {
  for (let i = 0; i < steps; i++) {
    await runOnce(workerDeps, 20, { schedule: false });
    await wake();
    if (await pred()) return;
    await sleep(60);
  }
  throw new Error(`Hết số vòng chờ: ${what}`);
}

async function enrollAgent(machine: string, adminId: string, guest: GuestController) {
  const t = await api("POST", "/admin/enrollments", bearer(adminId), { machineId: machine, ttlSeconds: 600 });
  expect(t.status).toBe(201);
  const enrollmentToken = ((await t.json()) as { enrollmentToken: string }).enrollmentToken;
  const r = await api("POST", "/agent/enroll", undefined, { token: enrollmentToken });
  expect(r.status).toBe(201);
  const credential = ((await r.json()) as { credential: string }).credential;
  const agent = new Agent({ apiBase: `${apiBase}/api`, credential, gateway, gatewayPublicUrl: gatewayUrl, guest, counter: new MemoryCounter() });
  agents.push(agent);
  void agent.run(abort.signal, 40);
  return { agent, credential };
}

async function bookedMachine() {
  const host = await makeApprovedHost(A());
  await linkWallet(A(), host);
  const machine = await makeMachine(A(), host);
  const renter = await renterWithWallet(A());
  const id = (await reserve(A(), renter, machine)).id;
  const b = (await admin.query("select encode(chain_booking_id,'hex') as cid, price_units::text as p, fee_bps, duration_seconds, floor(extract(epoch from fund_by))::bigint as fb, floor(extract(epoch from activate_by))::bigint as ab, (select machine_key from public.machines where id = machine_id) as mk from public.bookings where id = $1", [id])).rows[0];
  const w = (await admin.query("select user_id, address from public.wallet_links where user_id in ($1, $2)", [renter, host])).rows;
  const cid = `0x${b.cid}`;
  const fundedArgs = { renter: w.find((x) => x.user_id === renter).address, host: w.find((x) => x.user_id === host).address, machineKey: keccak256(toBytes(b.mk)), token: PCP, priceUnits: BigInt(b.p), feeBps: BigInt(b.fee_bps), treasury: TREASURY, fundBy: BigInt(b.fb), activateBy: BigInt(b.ab) };
  return { id, host, machine, renter, cid, b, fundedArgs };
}

describe("E2E cục bộ: từ enrollment tới nhả máy", () => {
  it("toàn bộ vòng đời: quote → Funded → chuẩn bị → activate → Active → token → xem qua gateway → Settled → thu hồi → reset → nhả máy", async () => {
    const adminId = await makeAdmin(A());
    const f = await bookedMachine();
    const { credential } = await enrollAgent(f.machine, adminId, fakeGuest);

    // 1. Heartbeat thật tới API: máy có sức khỏe 'ok'
    await sleep(300);
    expect((await admin.query("select public.machine_health($1) as h", [f.machine])).rows[0].h).toBe("ok");

    // 2. Renter xin quote (server ký), rồi "thanh toán" trên chuỗi giả và đối soát bằng tx hash qua API
    const q = await api("POST", `/bookings/${f.id}/quote`, bearer(f.renter));
    expect(q.status).toBe(200);
    chain.state.set(f.cid, ESCROW_STATE.Funded);
    const fundTx = emit(f.cid, "Funded", f.fundedArgs, 1);
    const rec = await api("POST", `/bookings/${f.id}/reconcile`, bearer(f.renter), { txHash: fundTx });
    expect(((await rec.json()) as { applied: { outcome: string }[] }).applied[0]!.outcome).toBe("applied");
    expect((await row(f.id)).state).toBe("funded");

    // 3. Chưa Active ⇒ chưa có quyền xem
    expect((await api("POST", `/bookings/${f.id}/connect`, bearer(f.renter))).status).toBe(409);

    // 4. Worker + agent: chuẩn bị → activate → Active → cấp token
    await until(async () => (await row(f.id)).access_state === "granted", "phiên được cấp");
    const mid = await row(f.id);
    expect([mid.state, mid.access_state]).toEqual(["active", "granted"]);
    expect(chain.activated).toEqual([f.cid]); // activate đúng một lần

    // 5. Renter nhận đường dẫn xem một lần; người khác không nhận được; nhận lần hai thất bại
    const stranger = await renterWithWallet(A());
    expect((await api("POST", `/bookings/${f.id}/connect`, bearer(stranger))).status).toBe(404);
    const c = await api("POST", `/bookings/${f.id}/connect`, bearer(f.renter));
    expect(c.status).toBe(200);
    const { viewerUrl } = (await c.json()) as { viewerUrl: string };
    expect(viewerUrl.startsWith(`${gatewayUrl}/__gw/redeem?t=`)).toBe(true);
    expect((await api("POST", `/bookings/${f.id}/connect`, bearer(f.renter))).status).toBe(409);
    const left = await admin.query("select redeem_token from public.session_grants where booking_id = $1", [f.id]);
    expect(left.rows[0].redeem_token).toBeNull(); // token đã bị xoá khỏi DB sau khi nhận

    // 6. Xem qua gateway thật: HTTP + WebSocket tới upstream giả
    const red = await fetch(viewerUrl, { redirect: "manual" });
    expect(red.status).toBe(302);
    const cookie = red.headers.get("set-cookie")!.split(";")[0]!;
    expect(await (await fetch(`${gatewayUrl}/`, { headers: { cookie } })).text()).toBe("desktop");
    const ws = new WebSocket(`ws://${gatewayUrl.replace("http://", "")}/websocket`, { headers: { cookie } });
    const closed = new Promise<number>((ok) => ws.on("close", (code) => ok(code)));
    await new Promise<void>((ok, bad) => { ws.on("open", ok); ws.on("error", bad); });
    const echoed = await new Promise<string>((ok) => { ws.once("message", (d) => ok(d.toString())); ws.send("xin chào"); });
    expect(echoed).toBe("xin chào");
    expect((await fetch(viewerUrl, { redirect: "manual" })).status).toBe(401); // token đổi một lần

    // 7. Kết thúc: Settled trên chuỗi → worker thu hồi → gateway đóng kết nối ĐANG MỞ và chặn reconnect
    chain.state.set(f.cid, ESCROW_STATE.Settled);
    emit(f.cid, "Settled", { hostGross: 1n }, 3);
    await admin.query("select public.enqueue_job($1, 'reconcile_booking', $2::jsonb, 0)", [`reconcile:${f.id}:settled`, JSON.stringify({ booking_id: f.id })]);
    await until(async () => (await row(f.id)).holding === null, "máy được nhả");
    expect(await closed).toBe(CLOSE_REVOKED);
    expect((await fetch(`${gatewayUrl}/`, { headers: { cookie } })).status).toBe(401);
    const end = await row(f.id);
    expect([end.state, end.access_state, end.holding]).toEqual(["settled", "reset_verified", null]);
    expect(guestCalls).toEqual(["prepare", "stop", "reset", "verify"]);

    // 8. Credential bị thu hồi ⇒ agent không còn nhận lệnh
    const a = agents[0]!;
    await admin.query("select public.revoke_device($1, $2)", [adminId, f.machine]);
    expect((await a.tick()).heartbeat).toBe("rejected");
    const poll = await api("GET", "/agent/commands", undefined, undefined, { authorization: `Device ${credential}` });
    expect(poll.status).toBe(401);
  });

  it("guest chưa cài (unavailableGuest): prepare trả Unknown ⇒ access 'unknown', KHÔNG activate, máy vẫn bị giữ", async () => {
    const adminId = await makeAdmin(A());
    const f = await bookedMachine();
    await enrollAgent(f.machine, adminId, unavailableGuest);
    chain.state.set(f.cid, ESCROW_STATE.Funded);
    emit(f.cid, "Funded", f.fundedArgs, 1);
    await admin.query("select public.enqueue_job($1, 'reconcile_booking', $2::jsonb, 0)", [`reconcile:${f.id}:x`, JSON.stringify({ booking_id: f.id })]);
    const before = chain.activated.length;
    for (let i = 0; i < 6; i++) { await runOnce(workerDeps, 20, { schedule: false }); await wake(); await sleep(60); }
    const r = await row(f.id);
    expect(["unknown", "failed", "preparing"]).toContain(r.access_state);
    expect(r.state).toBe("funded");
    expect(r.holding).not.toBeNull();
    expect(chain.activated.length).toBe(before); // không bao giờ kích hoạt khi guest chưa sẵn sàng
  });

  it("agent bị từ chối khi không có/sai credential; lệnh của máy khác không báo kết quả được", async () => {
    expect((await api("GET", "/agent/commands")).status).toBe(401);
    expect((await api("GET", "/agent/commands", undefined, undefined, { authorization: "Device " + "z".repeat(43) })).status).toBe(401);
    expect((await api("POST", "/agent/commands/1/result", undefined, { ok: true }, { authorization: "Device " + "z".repeat(43) })).status).toBe(401);
    const adminId = await makeAdmin(A());
    const f1 = await bookedMachine();
    const f2 = await bookedMachine();
    const e1 = await enrollAgent(f1.machine, adminId, fakeGuest);
    await enrollAgent(f2.machine, adminId, fakeGuest);
    const cmdId = (await admin.query("select public.agent_enqueue_command($1, $2, 'prepare', '{}'::jsonb)::text as id", [f2.id, `prepare:${f2.id}`])).rows[0].id as string;
    // Agent của máy 1 cố báo kết quả cho lệnh của máy 2
    const hit = await api("POST", `/agent/commands/${cmdId}/result`, undefined, { ok: true, evidence: "giả mạo" }, { authorization: `Device ${e1.credential}` });
    expect(hit.status).toBe(404);
    // Lệnh gốc không bị đổi trạng thái bởi kẻ giả mạo: nó chỉ hoàn tất bởi agent đúng máy
    await sleep(300);
    const st = (await admin.query("select status, (result->>'evidence') as ev from public.agent_commands where id = $1", [cmdId])).rows[0];
    expect(st.ev).not.toBe("giả mạo");
  });

  it("ControlPlaneProvider: agent im lặng ⇒ Unknown (không bao giờ thành công), lệnh dùng lại khi chờ, thất bại thì tạo lần thử mới, thành công thì dùng lại", async () => {
    const f = await bookedMachine(); // máy này KHÔNG có agent
    const provider = makeControlPlaneProvider(pgServiceDb(pool), { timeoutMs: 250, pollMs: 20 });
    const i = { bookingId: f.id, actionId: `prepare:${f.id}` };
    const r1 = await provider.prepare(i);
    expect(r1).toMatchObject({ ok: false, unknown: true });
    const count = async () => (await admin.query("select count(*)::int as n, max(attempt) as a from public.agent_commands where booking_id = $1", [f.id])).rows[0] as { n: number; a: number };
    expect(await count()).toEqual({ n: 1, a: 1 });
    expect(await provider.prepare(i)).toMatchObject({ ok: false, unknown: true });
    expect(await count()).toEqual({ n: 1, a: 1 }); // đang chờ ⇒ dùng lại, không xếp trùng
    await admin.query("update public.agent_commands set status = 'failed', ok = false, unknown = false, result = '{\"evidence\":\"hỏng\"}'::jsonb where booking_id = $1", [f.id]);
    expect(await provider.prepare(i)).toMatchObject({ ok: false, unknown: true });
    expect(await count()).toEqual({ n: 2, a: 2 }); // thất bại ⇒ lần thử mới
    await admin.query("update public.agent_commands set status = 'done', ok = true, result = '{\"evidence\":\"xong\"}'::jsonb where booking_id = $1 and attempt = 2", [f.id]);
    expect(await provider.prepare(i)).toEqual({ ok: true, evidence: "xong" });
    expect(await count()).toEqual({ n: 2, a: 2 }); // đã thành công ⇒ dùng lại kết quả
  });
});

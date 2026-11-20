/**
 * Test API server trên PostgreSQL THẬT cục bộ (không phải Supabase). Chuỗi khối là client GIẢ có nhãn: log dựng bằng
 * ABI thật; việc contract chấp nhận chữ ký quote đã được kiểm riêng trong contracts/test/serverQuote.test.ts.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { encodeAbiParameters, encodeEventTopics, keccak256, toBytes, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ESCROW_EVENTS_ABI, type ChainClientLike, type ReceiptLike } from "@cpm/shared/src/chainEvents";
import { quoteDomain, recoverQuoteSigner, type Quote } from "@cpm/shared/src/quote";
import { linkWallet, makeAdmin, makeApprovedHost, makeMachine, newUser, renterWithWallet, reserve } from "../../db/tests/harness";
import { asPglite, startRealPg, type RealPg } from "../../db/tests/realpg";
import { ApiError, authenticate, dbSsl, isLoopbackRpc, isPublicDevAddress, loadServerConfig, pgServiceDb, publicDevKeyProblem, sha256Hex, type ApiUser, type Deps, type ServerConfig } from "./core";
import { createApiHandler } from "./http";
import { createEnrollment, heartbeat, redeemEnrollment, revokeDevice } from "./api/enrollment";
import { issueQuote } from "./api/quote";
import { reconcileByTx } from "./api/reconcile";
import { walletChallenge, walletVerify } from "./api/wallet";

let real: RealPg;
let admin: pg.Client;
let pool: pg.Pool;
let deps: Deps;
let cfg: ServerConfig;
const A = () => asPglite(admin);
const user = (id: string): ApiUser => ({ id, email: null });
const ESCROW = "0x" + "e5".repeat(20);
const PCP = "0x" + "c1".repeat(20);
const TREASURY = "0x" + "d7".repeat(20);

const chainState = { receipts: new Map<string, ReceiptLike | "notfound">(), head: 1000n };
const fakeChain: ChainClientLike = {
  async getTransactionReceipt({ hash }) {
    const r = chainState.receipts.get(hash);
    if (!r || r === "notfound") throw new Error("Transaction receipt could not be found");
    return r;
  },
  async getBlockNumber() { return chainState.head; },
};

beforeAll(async () => {
  const r = await startRealPg();
  if (!r) throw new Error("Không có binary Postgres cục bộ cho test server (xem db/tests/realpg.ts)");
  real = r;
  admin = await real.connect();
  pool = new pg.Pool({ host: "127.0.0.1", port: real.port, user: "postgres", database: "postgres", max: 4 });
  cfg = {
    supabaseUrl: "https://auth.example.test", anonKey: "anon-public-key", chainId: 43113, escrow: ESCROW, pcp: PCP, treasury: TREASURY,
    quoteSigner: privateKeyToAccount(generatePrivateKey()), minConfirmations: 2, graceSeconds: 600, arbitrationSeconds: 86_400, configVersion: 1,
    walletDomain: "app.test", walletUri: "https://app.test", allowedOrigins: ["http://localhost:5176"],
  };
  deps = { db: pgServiceDb(pool), cfg, chain: fakeChain };
}, 120_000);
afterAll(async () => {
  await pool?.end();
  await admin?.end();
  await real?.stop();
}, 60_000);

const rejects = async (p: Promise<unknown>, status: number, code: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e, `kỳ vọng lỗi ${status}/${code}`).toBeInstanceOf(ApiError);
  expect([(e as ApiError).status, (e as ApiError).code]).toEqual([status, code]);
};

/* ------------------------------------------------------------------ xác thực */
describe("authenticate (Supabase Auth /user qua anon key)", () => {
  const stub = (status: number, body: unknown = {}): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  const token = "Bearer " + "a".repeat(40);
  it("token hợp lệ → người dùng; 401 → null; header thiếu/sai dạng → null (không gọi mạng)", async () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(await authenticate(token, cfg, stub(200, { id, email: "a@b.c" }))).toEqual({ id, email: "a@b.c" });
    expect(await authenticate(token, cfg, stub(401))).toBeNull();
    let called = false;
    const spy = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
    for (const h of [null, undefined, "", "Basic abc", "Bearer ", "Bearer có dấu cách", "bearer " + "a".repeat(40)]) expect(await authenticate(h, cfg, spy)).toBeNull();
    expect(called).toBe(false);
    expect(await authenticate(token, cfg, stub(200, { id: "không-phải-uuid" }))).toBeNull();
  });
  it("lỗi mạng hoặc 5xx → 503, không coi là đã đăng nhập", async () => {
    await rejects(authenticate(token, cfg, (async () => { throw new TypeError("fetch failed"); }) as typeof fetch), 503, "auth_unavailable");
    await rejects(authenticate(token, cfg, stub(500)), 503, "auth_unavailable");
  });
});

/* ------------------------------------------------------------------ ví */
describe("liên kết ví bằng chữ ký", () => {
  const wallet = () => privateKeyToAccount(generatePrivateKey());
  async function challenge(u: ApiUser, w: ReturnType<typeof wallet>, chainId = 43113) {
    const r = await walletChallenge(deps, u, { address: w.address, chainId });
    return r.body as { message: string; nonce: string };
  }

  it("luồng đúng: challenge → ký thông điệp server dựng → liên kết; nonce dùng lại bị từ chối", async () => {
    const u = user(await newUser(A(), "w1"));
    const w = wallet();
    const c = await challenge(u, w);
    expect(c.message).toContain(w.address);
    expect(c.message).toContain(u.id);
    const sig = await w.signMessage({ message: c.message });
    const r = await walletVerify(deps, u, { nonce: c.nonce, signature: sig });
    expect(r.body).toMatchObject({ linked: true, address: w.address.toLowerCase() });
    const row = await admin.query("select address from public.wallet_links where user_id = $1", [u.id]);
    expect(row.rows[0].address).toBe(w.address.toLowerCase());
    await rejects(walletVerify(deps, u, { nonce: c.nonce, signature: sig }), 400, "invalid_challenge");
  });

  it("chữ ký sai/người ký khác bị từ chối nhưng không đốt nonce; ký đúng sau đó vẫn được", async () => {
    const u = user(await newUser(A(), "w2"));
    const w = wallet();
    const c = await challenge(u, w);
    const attacker = wallet();
    await rejects(walletVerify(deps, u, { nonce: c.nonce, signature: await attacker.signMessage({ message: c.message }) }), 401, "bad_signature");
    await rejects(walletVerify(deps, u, { nonce: c.nonce, signature: "0x1234" }), 401, "bad_signature");
    await rejects(walletVerify(deps, u, { nonce: c.nonce, signature: await w.signMessage({ message: "thông điệp khác" }) }), 401, "bad_signature");
    expect((await walletVerify(deps, u, { nonce: c.nonce, signature: await w.signMessage({ message: c.message }) })).status).toBe(200);
  });

  it("nonce của người khác, hết hạn, sai chain, địa chỉ rác, spam đều bị chặn", async () => {
    const u1 = user(await newUser(A(), "w3"));
    const u2 = user(await newUser(A(), "w4"));
    const w = wallet();
    const c = await challenge(u1, w);
    await rejects(walletVerify(deps, u2, { nonce: c.nonce, signature: await w.signMessage({ message: c.message }) }), 400, "invalid_challenge");
    await admin.query("update public.wallet_challenges set expires_at = now() - interval '1 second' where nonce_hash = $1", [sha256Hex(c.nonce)]);
    await rejects(walletVerify(deps, u1, { nonce: c.nonce, signature: await w.signMessage({ message: c.message }) }), 400, "invalid_challenge");
    await rejects(walletChallenge(deps, u1, { address: w.address, chainId: 1 }), 400, "wrong_chain");
    await rejects(walletChallenge(deps, u1, { address: "0xabc", chainId: 43113 }), 400, "bad_address");
    const spammer = user(await newUser(A(), "spam"));
    for (let i = 0; i < 8; i++) await challenge(spammer, wallet());
    await rejects(walletChallenge(deps, spammer, { address: wallet().address, chainId: 43113 }), 429, "rate_limited");
  });

  it("ví đã thuộc tài khoản khác → 409; đổi ví khi còn booking chưa kết thúc → 409", async () => {
    const u1 = user(await newUser(A(), "w5"));
    const u2 = user(await newUser(A(), "w6"));
    const w = wallet();
    const c1 = await challenge(u1, w);
    await walletVerify(deps, u1, { nonce: c1.nonce, signature: await w.signMessage({ message: c1.message }) });
    const c2 = await challenge(u2, w);
    await rejects(walletVerify(deps, u2, { nonce: c2.nonce, signature: await w.signMessage({ message: c2.message }) }), 409, "wallet_taken");

    const host = await makeApprovedHost(A());
    const m = await makeMachine(A(), host);
    const renter = await renterWithWallet(A());
    await reserve(A(), renter, m);
    const w2 = wallet();
    const c3 = await challenge(user(renter), w2);
    await rejects(walletVerify(deps, user(renter), { nonce: c3.nonce, signature: await w2.signMessage({ message: c3.message }) }), 409, "wallet_change_blocked");
  });
});

/* ------------------------------------------------------------------ quote */
describe("quote EIP-712 do server ký", () => {
  async function fixture() {
    const host = await makeApprovedHost(A());
    await linkWallet(A(), host);
    const machine = await makeMachine(A(), host);
    const renter = await renterWithWallet(A());
    const b = await reserve(A(), renter, machine);
    return { host, machine, renter, bookingId: b.id };
  }

  it("cấp quote khớp snapshot DB, chữ ký khôi phục đúng signer, lặp lại cho cùng kết quả", async () => {
    const f = await fixture();
    const r = await issueQuote(deps, user(f.renter), f.bookingId);
    const { quote, signature, escrow, chainId } = r.body as { quote: Record<keyof Quote, string>; signature: Hex; escrow: string; chainId: number };
    expect([escrow, chainId]).toEqual([ESCROW, 43113]);
    const db = (await admin.query("select price_units::text as p, fee_bps from public.bookings where id = $1", [f.bookingId])).rows[0];
    expect(quote.priceUnits).toBe(db.p);
    expect(quote.feeBps).toBe(String(db.fee_bps));
    const w = (await admin.query("select user_id, address from public.wallet_links where user_id in ($1, $2)", [f.renter, f.host])).rows;
    expect(quote.renter.toLowerCase()).toBe(w.find((x) => x.user_id === f.renter).address);
    expect(quote.host.toLowerCase()).toBe(w.find((x) => x.user_id === f.host).address);
    expect(BigInt(quote.activateBy) - BigInt(quote.fundBy)).toBe(300n);
    expect(BigInt(quote.fundBy) - BigInt(quote.issuedAt)).toBe(600n);
    const asQuote = Object.fromEntries(Object.entries(quote).map(([k, v]) => [k, /^[0-9]+$/.test(v) && !["bookingId", "machineKey", "policyHash"].includes(k) ? BigInt(v) : v])) as unknown as Quote;
    expect(await recoverQuoteSigner(asQuote, quoteDomain(43113, ESCROW), signature)).toBe(cfg.quoteSigner.address);
    expect(((await issueQuote(deps, user(f.renter), f.bookingId)).body as { signature: string }).signature).toBe(signature);
  });

  it("từ chối: người khác, sai trạng thái, hết hạn giữ máy, host chưa có ví, máy còn bị chiếm on-chain, id rác", async () => {
    const f = await fixture();
    await rejects(issueQuote(deps, user(await newUser(A(), "other")), f.bookingId), 404, "not_found");
    await rejects(issueQuote(deps, user(f.renter), "không-phải-uuid"), 400, "bad_request");
    await rejects(issueQuote(deps, user(f.renter), f.bookingId, { machineOccupied: async () => true }), 409, "machine_occupied_onchain");

    const noHostWallet = await (async () => {
      const host = await makeApprovedHost(A());
      const machine = await makeMachine(A(), host);
      const renter = await renterWithWallet(A());
      return { renter, id: (await reserve(A(), renter, machine)).id };
    })();
    await rejects(issueQuote(deps, user(noHostWallet.renter), noHostWallet.id), 409, "host_wallet_required");

    const g = await fixture();
    await admin.query("alter table public.bookings disable trigger bookings_guard");
    await admin.query("update public.bookings set fund_by = now() + interval '2 seconds' where id = $1", [g.bookingId]);
    await rejects(issueQuote(deps, user(g.renter), g.bookingId), 410, "quote_expired"); // trong biên 5 giây
    await admin.query("update public.bookings set state = 'funded' where id = $1", [f.bookingId]);
    await admin.query("alter table public.bookings enable trigger bookings_guard");
    await rejects(issueQuote(deps, user(f.renter), f.bookingId), 409, "invalid_state");
  });
});

/* ------------------------------------------------------------------ đối soát chuỗi */
function makeLog(eventName: string, args: Record<string, unknown>, address = ESCROW, logIndex = 0) {
  const item = ESCROW_EVENTS_ABI.find((x) => x.type === "event" && x.name === eventName) as unknown as { inputs: { name: string; type: string; indexed?: boolean }[] };
  const indexed = item.inputs.filter((i) => i.indexed);
  const plain = item.inputs.filter((i) => !i.indexed);
  const topics = encodeEventTopics({ abi: ESCROW_EVENTS_ABI, eventName: eventName as never, args: Object.fromEntries(indexed.map((i) => [i.name, args[i.name]])) as never }) as Hex[];
  const data = encodeAbiParameters(plain as never, plain.map((i) => args[i.name]) as never);
  return { address, topics, data, logIndex, blockNumber: 990n, blockHash: ("0x" + "b0".repeat(32)) as Hex, transactionHash: null };
}
let txCounter = 1;
function putReceipt(logs: ReturnType<typeof makeLog>[], o: { status?: "success" | "reverted"; block?: bigint } = {}) {
  const hash = toHex(txCounter++, { size: 32 });
  chainState.receipts.set(hash, { status: o.status ?? "success", blockNumber: o.block ?? 990n, blockHash: ("0x" + "b0".repeat(32)) as Hex, logs });
  return hash;
}

describe("xác minh giao dịch và đối soát", () => {
  async function booked() {
    const host = await makeApprovedHost(A());
    await linkWallet(A(), host);
    const machine = await makeMachine(A(), host);
    const renter = await renterWithWallet(A());
    const id = (await reserve(A(), renter, machine)).id;
    const b = (await admin.query("select encode(chain_booking_id,'hex') as cid, price_units::text as p, fee_bps, duration_seconds, floor(extract(epoch from fund_by))::bigint as fb, floor(extract(epoch from activate_by))::bigint as ab, (select machine_key from public.machines where id = machine_id) as mk from public.bookings where id = $1", [id])).rows[0];
    const w = (await admin.query("select user_id, address from public.wallet_links where user_id in ($1, $2)", [renter, host])).rows;
    const funded = (over: Record<string, unknown> = {}, address = ESCROW) =>
      makeLog("Funded", { bookingId: `0x${b.cid}`, renter: w.find((x) => x.user_id === renter).address, host: w.find((x) => x.user_id === host).address, machineKey: keccak256(toBytes(b.mk)), token: PCP, priceUnits: BigInt(b.p), feeBps: BigInt(b.fee_bps), treasury: TREASURY, fundBy: BigInt(b.fb), activateBy: BigInt(b.ab), ...over }, address);
    return { id, renter, host, b, funded };
  }
  const stateOf = async (id: string) => (await admin.query("select state from public.bookings where id = $1", [id])).rows[0].state as string;
  const jobs = async (type: string, id: string) => (await admin.query("select count(*)::int as n from public.outbox_jobs where job_type = $1 and payload->>'booking_id' = $2", [type, id])).rows[0].n as number;

  it("Funded khớp snapshot → booking funded + job prepare_session; áp lại → duplicate (không thêm job)", async () => {
    const f = await booked();
    const tx = putReceipt([f.funded()]);
    const r = await reconcileByTx(deps, user(f.renter), f.id, tx);
    expect((r.body as { applied: { outcome: string }[] }).applied.map((a) => a.outcome)).toEqual(["applied"]);
    expect(await stateOf(f.id)).toBe("funded");
    expect(await jobs("prepare_session", f.id)).toBe(1);
    const again = await reconcileByTx(deps, user(f.renter), f.id, tx);
    expect((again.body as { applied: { outcome: string }[] }).applied.map((a) => a.outcome)).toEqual(["duplicate"]);
    expect(await jobs("prepare_session", f.id)).toBe(1);
  });

  it("Activated ghi started_at/end_at theo block và xếp job grant_session", async () => {
    const f = await booked();
    await reconcileByTx(deps, user(f.renter), f.id, putReceipt([f.funded()]));
    const act = putReceipt([makeLog("Activated", { bookingId: `0x${f.b.cid}`, startedAt: 1_800_000_000n, endAt: 1_800_000_000n + BigInt(f.b.duration_seconds) })]);
    const r = await reconcileByTx(deps, user(f.renter), f.id, act);
    expect((r.body as { applied: { outcome: string }[] }).applied[0]!.outcome).toBe("applied");
    expect(await stateOf(f.id)).toBe("active");
    expect(await jobs("grant_session", f.id)).toBe(1);
    const t = (await admin.query("select extract(epoch from end_at)::bigint as e from public.bookings where id = $1", [f.id])).rows[0];
    expect(Number(t.e)).toBe(1_800_000_000 + f.b.duration_seconds);
  });

  it("sự kiện lệch snapshot (renter, host, token, treasury, giá, phí, hạn) bị từ chối và ghi audit; booking không đổi", async () => {
    const f = await booked();
    const cases: [string, Record<string, unknown>][] = [
      ["renter", { renter: "0x" + "99".repeat(20) }], ["host", { host: "0x" + "98".repeat(20) }], ["token", { token: "0x" + "97".repeat(20) }],
      ["treasury", { treasury: "0x" + "96".repeat(20) }], ["price", { priceUnits: 1n }], ["fee", { feeBps: 5n }], ["deadline", { fundBy: 1n }],
      ["machine_key", { machineKey: keccak256(toHex("máy khác")) }],
    ];
    for (const [why, over] of cases) {
      const r = await reconcileByTx(deps, user(f.renter), f.id, putReceipt([f.funded(over)]));
      expect((r.body as { applied: { outcome: string }[] }).applied[0]!.outcome, why).toBe(`rejected_${why}`);
    }
    expect(await stateOf(f.id)).toBe("reserved");
    expect((await admin.query("select count(*)::int as n from public.audit_logs where action = 'chain_event_rejected' and resource = $1", [`booking:${f.id}`])).rows[0].n).toBe(cases.length);
  });

  it("log của contract khác và tx revert bị từ chối, không áp dụng gì", async () => {
    const f = await booked();
    await rejects(reconcileByTx(deps, user(f.renter), f.id, putReceipt([f.funded({}, "0x" + "aa".repeat(20))])), 422, "no_matching_event");
    await rejects(reconcileByTx(deps, user(f.renter), f.id, putReceipt([f.funded()], { status: "reverted" })), 409, "tx_reverted");
  });

  it("chưa đủ confirmation → 202 và không áp dụng; tx chưa thấy → 202; người khác → 404; thiếu RPC → 503", async () => {
    const f = await booked();
    const fresh = putReceipt([f.funded()], { block: 1000n }); // head 1000 → 1 confirmation < 2
    const r = await reconcileByTx(deps, user(f.renter), f.id, fresh);
    expect(r).toEqual({ status: 202, body: { status: "pending" } });
    expect(await stateOf(f.id)).toBe("reserved");
    expect((await reconcileByTx(deps, user(f.renter), f.id, toHex(424242, { size: 32 }))).status).toBe(202);
    await rejects(reconcileByTx(deps, user(await newUser(A(), "x")), f.id, fresh), 404, "not_found");
    await rejects(reconcileByTx({ ...deps, chain: undefined }, user(f.renter), f.id, fresh), 503, "chain_unavailable");
    await rejects(reconcileByTx(deps, user(f.renter), f.id, "0x12"), 400, "bad_request");
  });
});

/* ------------------------------------------------------------------ enrollment + heartbeat */
describe("enrollment thiết bị và heartbeat", () => {
  it("admin tạo token → thiết bị đổi lấy credential → heartbeat; DB chỉ giữ băm", async () => {
    const adminId = await makeAdmin(A());
    const machine = await makeMachine(A(), await makeApprovedHost(A()));
    const t = await createEnrollment(deps, user(adminId), { machineId: machine, ttlSeconds: 600 });
    const token = (t.body as { enrollmentToken: string }).enrollmentToken;
    const stored = (await admin.query("select token_hash from public.device_enrollments where machine_id = $1 and revoked_at is null", [machine])).rows[0].token_hash as Buffer;
    expect(stored.length).toBe(32);
    expect(stored.toString("utf8")).not.toContain(token);

    const r = await redeemEnrollment(deps, { token });
    const { credential, machineId } = r.body as { credential: string; machineId: string };
    expect(machineId).toBe(machine);
    await rejects(redeemEnrollment(deps, { token }), 400, "invalid_enrollment"); // một lần
    expect((await heartbeat(deps, `Device ${credential}`, { counter: 1 })).body).toMatchObject({ ok: true, machineId: machine });
    expect((await heartbeat(deps, `Device ${credential}`, { counter: 2 })).status).toBe(200);
    await rejects(heartbeat(deps, `Device ${credential}`, { counter: 2 }), 401, "invalid_heartbeat"); // replay
    await rejects(heartbeat(deps, `Device ${credential}`, { counter: 1 }), 401, "invalid_heartbeat");
    await rejects(heartbeat(deps, "Device " + "x".repeat(43), { counter: 3 }), 401, "invalid_heartbeat");
    await rejects(heartbeat(deps, null, { counter: 3 }), 401, "unauthorized");
    await rejects(heartbeat(deps, `Device ${credential}`, { counter: 0 }), 400, "bad_request");
    await rejects(heartbeat(deps, `Device ${credential}`, { counter: 1.5 }), 400, "bad_request");
    const health = (await admin.query("select public.machine_health($1) as h", [machine])).rows[0].h;
    expect(health).toBe("ok");
  });

  it("chỉ chủ máy hoặc admin tạo enrollment (người lạ 403); tham số xấu bị từ chối; token lạ bị từ chối", async () => {
    const host = await makeApprovedHost(A());
    const machine = await makeMachine(A(), host);
    const stranger = await makeApprovedHost(A()); // host khác, không sở hữu máy này
    await rejects(createEnrollment(deps, user(stranger), { machineId: machine }), 403, "forbidden");
    const plain = await newUser(A());
    await rejects(createEnrollment(deps, user(plain), { machineId: machine }), 403, "forbidden");
    expect((await createEnrollment(deps, user(host), { machineId: machine })).status).toBe(201); // chủ máy: không cần admin
    const adminId = await makeAdmin(A());
    await rejects(createEnrollment(deps, user(adminId), { machineId: "rác" }), 400, "bad_request");
    await rejects(createEnrollment(deps, user(adminId), { machineId: machine, ttlSeconds: 5 }), 400, "bad_request");
    await rejects(createEnrollment(deps, user(adminId), { machineId: machine, ttlSeconds: 99999 }), 400, "bad_request");
    await rejects(redeemEnrollment(deps, { token: "t".repeat(40) }), 400, "invalid_enrollment");
    await rejects(redeemEnrollment(deps, {}), 400, "bad_request");
  });

  it("chủ máy tự ghi danh → tự thu hồi → tự ghi danh lại, KHÔNG cần admin; người khác và host bị đình chỉ bị chặn", async () => {
    const host = await makeApprovedHost(A());
    const machine = await makeMachine(A(), host);
    const stranger = await makeApprovedHost(A());
    const enrollOwn = async () => {
      const t = await createEnrollment(deps, user(host), { machineId: machine, ttlSeconds: 600 });
      return ((await redeemEnrollment(deps, { token: (t.body as { enrollmentToken: string }).enrollmentToken })).body as { credential: string }).credential;
    };
    const first = await enrollOwn();
    expect((await heartbeat(deps, `Device ${first}`, { counter: 1 })).status).toBe(200);
    await rejects(createEnrollment(deps, user(host), { machineId: machine }), 409, "unavailable"); // đang có thiết bị: phải thu hồi trước
    await rejects(revokeDevice(deps, user(stranger), { machineId: machine }), 403, "forbidden"); // người khác không thu hồi hộ được
    expect((await heartbeat(deps, `Device ${first}`, { counter: 2 })).status).toBe(200); // lần bị chặn không thu hồi gì
    expect((await revokeDevice(deps, user(host), { machineId: machine })).body).toEqual({ revoked: true });
    await rejects(heartbeat(deps, `Device ${first}`, { counter: 3 }), 401, "invalid_heartbeat");
    const second = await enrollOwn();
    expect(second).not.toBe(first);
    // Host bị admin đình chỉ: mất luôn quyền tự ghi danh/thu hồi (phanh khẩn cấp còn hiệu lực).
    await admin.query("update public.host_profiles set status = 'suspended' where user_id = $1", [host]);
    await rejects(revokeDevice(deps, user(host), { machineId: machine }), 403, "forbidden");
    await rejects(createEnrollment(deps, user(host), { machineId: machine }), 403, "forbidden");
    // Máy chưa đăng (draft) thì chưa ghi danh được, kể cả chủ máy.
    const h2 = await makeApprovedHost(A());
    const draft = await makeMachine(A(), h2, { status: "draft" });
    await rejects(createEnrollment(deps, user(h2), { machineId: draft }), 409, "unavailable");
  });

  it("thu hồi thiết bị: admin vẫn làm được; credential cũ bị từ chối ngay; sau đó mới ghi danh lại được (credential mới, bộ đếm bắt đầu lại)", async () => {
    const adminId = await makeAdmin(A());
    const host = await makeApprovedHost(A());
    const stranger = await makeApprovedHost(A());
    const machine = await makeMachine(A(), host);
    const enrollOnce = async () => {
      const t = await createEnrollment(deps, user(adminId), { machineId: machine, ttlSeconds: 600 });
      return ((await redeemEnrollment(deps, { token: (t.body as { enrollmentToken: string }).enrollmentToken })).body as { credential: string }).credential;
    };
    const first = await enrollOnce();
    expect((await heartbeat(deps, `Device ${first}`, { counter: 5 })).status).toBe(200);
    // Thiết bị đang hiệu lực: không cấp enrollment mới khi chưa thu hồi.
    await rejects(createEnrollment(deps, user(adminId), { machineId: machine }), 409, "unavailable");
    await rejects(revokeDevice(deps, user(stranger), { machineId: machine }), 403, "forbidden");
    await rejects(revokeDevice(deps, user(adminId), { machineId: "rác" }), 400, "bad_request");
    expect((await heartbeat(deps, `Device ${first}`, { counter: 6 })).status).toBe(200); // các lần bị từ chối ở trên không thu hồi gì
    expect((await revokeDevice(deps, user(adminId), { machineId: machine })).body).toEqual({ revoked: true });
    await rejects(heartbeat(deps, `Device ${first}`, { counter: 7 }), 401, "invalid_heartbeat");
    expect((await admin.query("select public.machine_health($1) as h", [machine])).rows[0].h).toBe("unknown");
    const second = await enrollOnce();
    expect(second).not.toBe(first);
    expect((await heartbeat(deps, `Device ${second}`, { counter: 1 })).status).toBe(200);
    expect((await revokeDevice(deps, user(adminId), { machineId: machine })).status).toBe(200);
    expect((await revokeDevice(deps, user(adminId), { machineId: machine })).status).toBe(200); // idempotent
  });
});

/* ------------------------------------------------------------------ HTTP */
describe("lớp HTTP", () => {
  const authFetch = (async (_u: string, init: RequestInit) => {
    const t = (init.headers as Record<string, string>).authorization ?? "";
    return t.endsWith("ok".padEnd(40, "o")) ? new Response(JSON.stringify({ id: "11111111-2222-3333-4444-555555555555", email: null })) : new Response("{}", { status: 401 });
  }) as unknown as typeof fetch;
  const h = (over: Partial<Parameters<typeof createApiHandler>[0]> = {}) => createApiHandler({ ...deps, fetchImpl: authFetch, ...over });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://api.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("health; 404; JSON hỏng; body quá lớn; chưa đăng nhập → 401", async () => {
    expect((await h()(new Request("http://api.test/api/health"))).status).toBe(200);
    expect((await h()(post("/api/khong-co", {}))).status).toBe(404);
    expect((await h()(post("/api/wallet/challenge", "{hỏng"))).status).toBe(400);
    expect((await h()(post("/api/wallet/challenge", { x: "a".repeat(20_000) }))).status).toBe(413);
    const r = await h()(post("/api/wallet/challenge", { address: "0x" + "1".repeat(40), chainId: 43113 }));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: { code: "unauthorized", message: "Cần đăng nhập." } });
  });

  it("đường /api/host/enrollments và /api/host/devices/revoke: cần đăng nhập (401); người lạ không phải chủ máy nhận 403 từ DB", async () => {
    const machine = await makeMachine(A(), await makeApprovedHost(A()));
    const okAuth = { authorization: "Bearer " + "ok".padEnd(40, "o") }; // authFetch coi token này là user 1111… (không sở hữu máy nào)
    for (const p of ["/api/host/enrollments", "/api/host/devices/revoke"]) {
      expect((await h()(post(p, { machineId: machine }))).status, p).toBe(401);
      const r = await h()(post(p, { machineId: machine }, okAuth));
      expect([r.status, ((await r.json()) as { error: { code: string } }).error.code], p).toEqual([403, "forbidden"]);
    }
  });

  it("trần body theo BYTE và theo luồng: không đọc hết body khi vượt trần (không Content-Length), chạy trước xác thực", async () => {
    // Luồng 64 MiB giả (không khai Content-Length, kiểu chunked): server phải dừng và huỷ sau vài chunk, không nạp cả luồng.
    let pulled = 0, cancelled = false;
    const chunk = new Uint8Array(1024).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) { if (pulled >= 65_536) return ctrl.close(); pulled++; ctrl.enqueue(chunk); },
      cancel() { cancelled = true; },
    });
    const req = new Request("http://api.test/api/wallet/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    const res = await h()(req); // không Authorization: vẫn 413 (đọc body trước xác thực, nhưng có trần)
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(64); // 16 KiB trần + dung sai bộ đệm
    // Trần tính theo byte, không theo ký tự: 6000 ký tự Thái = 18000 byte > 16 KiB
    expect((await h()(post("/api/wallet/challenge", "ก".repeat(6000)))).status).toBe(413);
    // Dưới trần vẫn đi tiếp tới xác thực
    expect((await h()(post("/api/wallet/challenge", { address: "0x" + "1".repeat(40), chainId: 43113 }))).status).toBe(401);
  });

  it("chain-info trả chainId + địa chỉ escrow công khai, không lộ khoá hay địa chỉ vai trò khác", async () => {
    const r = await h()(new Request("http://api.test/api/chain-info"));
    expect(r.status).toBe(200);
    const j = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(j).sort()).toEqual(["chainId", "escrow", "faucet", "pcp"]); // không có rpcUrl khi cfg không khai RPC công khai
    expect(j.faucet).toBe(false);
    // Có RPC công khai và vòi ⇒ app biết kết nối chuỗi nào và có thể xin PCP; vẫn không lộ khoá hay địa chỉ vai trò khác.
    const withRpc = await createApiHandler({ ...deps, cfg: { ...deps.cfg, publicRpcUrl: "https://api.avax-test.network/ext/bc/C/rpc" }, faucet: { chain: {} as never, gasWei: 1n, minGasWei: 1n } })(new Request("http://api.test/api/chain-info"));
    expect(await withRpc.json()).toMatchObject({ rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc", faucet: true });
    expect(j.chainId).toBe(deps.cfg.chainId);
    expect(j.escrow).toBe(deps.cfg.escrow);
    expect(j.pcp).toBe(deps.cfg.pcp);
    expect(JSON.stringify(j)).not.toContain(deps.cfg.treasury);
  });

  it("CORS chỉ cho origin được cấu hình; preflight 204; lỗi nội bộ không lộ chi tiết", async () => {
    const ok = await h()(new Request("http://api.test/api/health", { headers: { origin: "http://localhost:5176" } }));
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5176");
    const bad = await h()(new Request("http://api.test/api/health", { headers: { origin: "http://evil.example" } }));
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await h()(new Request("http://api.test/api/wallet/verify", { method: "OPTIONS", headers: { origin: "http://localhost:5176" } }));
    expect(pre.status).toBe(204);
    const logs: string[] = [];
    const boom = h({ db: { tx: async () => { throw new Error("mật khẩu db = hunter2"); } }, log: (m) => logs.push(m) });
    const e = await boom(post("/api/agent/heartbeat", { counter: 1 }, { authorization: "Device " + "a".repeat(30) }));
    expect(e.status).toBe(500);
    expect(JSON.stringify(await e.json())).not.toContain("hunter2");
    expect(logs.length).toBe(1);
  });

  it("đi qua HTTP: người đăng nhập thật cấp challenge ví", async () => {
    const tok = "Bearer " + "ok".padEnd(40, "o");
    await admin.query("insert into auth.users (id, email) values ('11111111-2222-3333-4444-555555555555', 'http@example.invalid') on conflict do nothing");
    await admin.query("insert into public.profiles (user_id, display_name) values ('11111111-2222-3333-4444-555555555555', 'http') on conflict do nothing");
    const r = await h()(post("/api/wallet/challenge", { address: "0x" + "1".repeat(40), chainId: 43113 }, { authorization: tok }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ nonce: expect.any(String), message: expect.stringContaining("app.test") });
  });
});

/* ------------------------------------------------------------------ cấu hình */
describe("loadServerConfig (fail-closed, không in giá trị)", () => {
  const good = { SUPABASE_URL: "https://x.supabase.co/", SUPABASE_ANON_KEY: "k", ESCROW_ADDRESS: ESCROW, PCP_ADDRESS: PCP, TREASURY_ADDRESS: TREASURY, QUOTE_SIGNER_PRIVATE_KEY: generatePrivateKey(), WALLET_DOMAIN: "app.test", WALLET_URI: "https://app.test" };
  it("đủ cấu hình → ok (chain mặc định Fuji, 2 confirmation); thiếu/sai → liệt kê tên biến, không lộ key", () => {
    const c = loadServerConfig(good);
    expect([c.chainId, c.minConfirmations, c.supabaseUrl]).toEqual([43113, 2, "https://x.supabase.co"]);
    expect(c.quoteSigner.address).toMatch(/^0x/);
    let msg = "";
    try { loadServerConfig({ ...good, QUOTE_SIGNER_PRIVATE_KEY: "0xnot-a-key", ESCROW_ADDRESS: "", CHAIN_ID: "abc" }); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("QUOTE_SIGNER_PRIVATE_KEY");
    expect(msg).toContain("ESCROW_ADDRESS");
    expect(msg).toContain("CHAIN_ID");
    expect(msg).not.toContain("not-a-key");
    expect(() => loadServerConfig({})).toThrow(/SUPABASE_URL/);
  });

  // Khoá Hardhat #3 CÔNG KHAI (quote signer của demo cục bộ) — ai cũng biết, vô giá trị ngoài chuỗi mô phỏng.
  const HARDHAT_3 = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
  it("khoá thử công khai của Hardhat chỉ được chấp nhận khi RPC là loopback; trỏ mạng từ xa ⇒ từ chối khởi động", () => {
    expect(loadServerConfig({ ...good, QUOTE_SIGNER_PRIVATE_KEY: HARDHAT_3, RPC_URL: "http://127.0.0.1:8545" }).quoteSigner.address).toBe("0x90F79bf6EB2c4f870365E785982E1f101E93b906");
    expect(loadServerConfig({ ...good, QUOTE_SIGNER_PRIVATE_KEY: HARDHAT_3, RPC_URL: "http://localhost:8545/" }).chainId).toBe(43113);
    for (const rpc of ["https://api.avax-test.network/ext/bc/C/rpc", "https://api.avax.network/ext/bc/C/rpc", "http://10.0.0.5:8545", "http://127.0.0.1.evil.example:8545", "https://127.0.0.1:8545"]) {
      let msg = "";
      try { loadServerConfig({ ...good, QUOTE_SIGNER_PRIVATE_KEY: HARDHAT_3, RPC_URL: rpc }); } catch (e) { msg = (e as Error).message; }
      expect(msg, rpc).toContain("QUOTE_SIGNER_PRIVATE_KEY");
      expect(msg, rpc).toContain("loopback");
      expect(msg, rpc).not.toContain("7c852118");
    }
    // Khoá riêng tư thật (ngẫu nhiên) không bị ảnh hưởng dù RPC ở đâu.
    expect(loadServerConfig({ ...good, RPC_URL: "https://api.avax-test.network/ext/bc/C/rpc" }).chainId).toBe(43113);
  });
  it("PUBLIC_RPC_URL: https hoặc loopback được nhận; RPC từ xa của RPC_URL không bao giờ tự thành công khai; dạng sai bị từ chối", () => {
    expect(loadServerConfig({ ...good, PUBLIC_RPC_URL: "https://api.avax-test.network/ext/bc/C/rpc" }).publicRpcUrl).toBe("https://api.avax-test.network/ext/bc/C/rpc");
    expect(loadServerConfig({ ...good, RPC_URL: "http://127.0.0.1:8545" }).publicRpcUrl).toBe("http://127.0.0.1:8545");
    expect(loadServerConfig({ ...good, RPC_URL: "https://avax-fuji.example.com/v1/KHOA-API-RIENG" }).publicRpcUrl).toBeUndefined(); // có thể chứa khoá riêng ⇒ không lộ
    expect(() => loadServerConfig({ ...good, PUBLIC_RPC_URL: "http://10.0.0.5:8545" })).toThrow(/PUBLIC_RPC_URL/);
    expect(() => loadServerConfig({ ...good, PUBLIC_RPC_URL: "ftp://x" })).toThrow(/PUBLIC_RPC_URL/);
  });
  it("nhận diện đủ 20 tài khoản mặc định của Hardhat; loopback chỉ là http://127.0.0.1|localhost", () => {
    expect(isPublicDevAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe(true); // #0
    expect(isPublicDevAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8")).toBe(true); // #1 (operator của demo), chữ thường
    expect(isPublicDevAddress("0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199")).toBe(true); // #19
    expect(isPublicDevAddress("0x" + "ab".repeat(20))).toBe(false);
    expect([isLoopbackRpc("http://127.0.0.1:8545"), isLoopbackRpc("http://localhost:8545/x"), isLoopbackRpc("https://localhost:8545"), isLoopbackRpc("http://localhost.evil:8545"), isLoopbackRpc(undefined)]).toEqual([true, true, false, false, false]);
    expect(publicDevKeyProblem("OPERATOR_PRIVATE_KEY", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "https://api.avax-test.network/ext/bc/C/rpc")).toContain("OPERATOR_PRIVATE_KEY");
    expect(publicDevKeyProblem("OPERATOR_PRIVATE_KEY", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "http://127.0.0.1:8545")).toBeNull();
  });
});

describe("dbSsl (TLS cho kết nối Postgres)", () => {
  const url = "postgresql://postgres.abc:pw@aws-0-x.pooler.supabase.com:5432/postgres";
  it("mặc định xác minh; localhost không TLS; CA từ file; no-verify là phương án cuối được gắn nhãn", () => {
    expect(dbSsl("postgresql://u:p@127.0.0.1:5432/db", {})).toBeUndefined();
    expect(dbSsl("postgresql://u:p@localhost/db", {})).toBeUndefined();
    expect(dbSsl(url, {})).toEqual({ rejectUnauthorized: true });
    const f = path.join(mkdtempSync(path.join(os.tmpdir(), "cpm-ca-")), "ca.pem");
    const PEM = ["-----BEGIN CERTIFICATE-----", "TEST", "-----END CERTIFICATE-----", ""].join(String.fromCharCode(10));
    writeFileSync(f, PEM);
    expect(dbSsl(url, { SUPABASE_DB_CA: f })).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(dbSsl(url, { SUPABASE_DB_SSL: "no-verify" })).toEqual({ rejectUnauthorized: false });
    expect(dbSsl(url, { SUPABASE_DB_CA: f, SUPABASE_DB_SSL: "no-verify" })).toMatchObject({ rejectUnauthorized: true }); // CA thắng no-verify
    expect(() => dbSsl(url, { SUPABASE_DB_CA: "/khong/co/file.pem" })).toThrow(); // CA sai đường dẫn: lỗi, không lặng lẽ bỏ xác minh
  });
});

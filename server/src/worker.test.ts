/**
 * Test worker trên PostgreSQL THẬT cục bộ. Provider remote, operator chuỗi và chuỗi khối là bản GIẢ CÓ NHÃN
 * (không phải host-agent, Selkies hay Fuji). Kiểm logic vòng đời, idempotency, fencing và thứ tự an toàn.
 */
import pg from "pg";
import { keccak256, toBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LogsClientLike } from "@cpm/shared/src/chainEvents";
import { linkWallet, makeApprovedHost, makeMachine, renterWithWallet, reserve } from "../../db/tests/harness";
import { asPglite, startRealPg, type RealPg } from "../../db/tests/realpg";
import { pgServiceDb, type ServerConfig } from "./core";
import { ESCROW_STATE } from "./chainReader";
import { runOnce, scheduleTick, type ChainOperator, type RemoteResult, type SessionProvider, type WorkerDeps } from "./worker";

let real: RealPg;
let admin: pg.Client;
let pool: pg.Pool;
const A = () => asPglite(admin);
const ESCROW = "0x" + "e5".repeat(20);
const PCP = "0x" + "c1".repeat(20);
const TREASURY = "0x" + "d7".repeat(20);

/* ---- bản giả có nhãn ---- */
const calls: string[] = [];
const results: Record<string, RemoteResult> = {};
const provider: SessionProvider = {
  async prepare(i) { calls.push(`prepare:${i.actionId}`); return results.prepare ?? { ok: true, evidence: "giả" }; },
  async grant(i) { calls.push(`grant:${i.actionId}:${i.renterId}:${i.endAtMs}`); return results.grant ?? { ok: true, evidence: "giả" }; },
  async revoke(i) { calls.push(`revoke:${i.actionId}`); return results.revoke ?? { ok: true, evidence: "giả" }; },
  async reset(i) { calls.push(`reset:${i.actionId}`); return results.reset ?? { ok: true, evidence: "giả" }; },
  async verifyReset(i) { calls.push(`verify:${i.actionId}`); return results.verify ?? { ok: true, evidence: "giả" }; },
};
const chain = { state: new Map<string, number>(), failRpc: false, events: [] as { bookingId: string; eventName: string; args: Record<string, unknown>; logIndex: number; blockNumber: bigint }[], activations: [] as string[], claims: [] as string[], claimFails: false };
const operator: ChainOperator = {
  async activate(id) { chain.activations.push(id); return ("0x" + "ab".repeat(32)) as Hex; },
  async claimAfterGrace(id) { if (chain.claimFails) throw new Error("TooEarly()"); chain.claims.push(id); return ("0x" + "cd".repeat(32)) as Hex; },
};
const logs: LogsClientLike = {
  async getBlockNumber() { return 1000n; },
  async getTransactionReceipt() { throw new Error("không dùng"); },
  async getContractEvents(a) {
    return chain.events.filter((e) => e.bookingId === a.args.bookingId.toLowerCase() && e.blockNumber <= a.toBlock).map((e) => ({ ...e, blockHash: "0x" + "b0".repeat(32), transactionHash: keccak256(toBytes(`${e.bookingId}:${e.logIndex}`)) }));
  },
};
const reader = {
  async machineOccupied() { return false; },
  async stateOf(id: Hex) { if (chain.failRpc) throw new Error("RPC down"); return chain.state.get(id.toLowerCase()) ?? 0; },
};

let deps: WorkerDeps;
beforeAll(async () => {
  const r = await startRealPg();
  if (!r) throw new Error("Không có binary Postgres cục bộ");
  real = r;
  admin = await real.connect();
  pool = new pg.Pool({ host: "127.0.0.1", port: real.port, user: "postgres", database: "postgres", max: 4 });
  const cfg = { supabaseUrl: "https://x.test", anonKey: "k", chainId: 43113, escrow: ESCROW, pcp: PCP, treasury: TREASURY, quoteSigner: privateKeyToAccount(generatePrivateKey()), minConfirmations: 2, graceSeconds: 600, arbitrationSeconds: 86_400, configVersion: 1, walletDomain: "a", walletUri: "https://a", allowedOrigins: [] } satisfies ServerConfig;
  deps = { db: pgServiceDb(pool), cfg, chain: undefined, escrowReader: reader as never, operator, provider, chainLogs: logs, workerId: "w1", deployBlock: 1n, expireMarginSeconds: 60, leaseSeconds: 30 };
}, 120_000);
afterAll(async () => { await pool?.end(); await admin?.end(); await real?.stop(); }, 60_000);

/* ---- tiện ích ---- */
async function newBooking() {
  const host = await makeApprovedHost(A());
  await linkWallet(A(), host);
  const machine = await makeMachine(A(), host);
  const renter = await renterWithWallet(A());
  const id = (await reserve(A(), renter, machine)).id;
  const b = (await admin.query("select encode(chain_booking_id,'hex') as cid, price_units::text as p, fee_bps, duration_seconds, floor(extract(epoch from fund_by))::bigint as fb, floor(extract(epoch from activate_by))::bigint as ab, (select machine_key from public.machines where id = machine_id) as mk from public.bookings where id = $1", [id])).rows[0];
  const w = (await admin.query("select user_id, address from public.wallet_links where user_id in ($1, $2)", [renter, host])).rows;
  const cid = `0x${b.cid}`;
  const ev = (eventName: string, args: Record<string, unknown>, logIndex: number) => chain.events.push({ bookingId: cid, eventName, args: { bookingId: cid, ...args }, logIndex, blockNumber: 900n + BigInt(logIndex) });
  const funded = async () => {
    // Đọc hạn từ DB tại thời điểm gọi (test có thể đã đổi mốc thời gian để mô phỏng quá hạn).
    const d = (await admin.query("select floor(extract(epoch from fund_by))::bigint as fb, floor(extract(epoch from activate_by))::bigint as ab from public.bookings where id = $1", [id])).rows[0];
    b.fb = d.fb; b.ab = d.ab;
    ev("Funded", { renter: w.find((x) => x.user_id === renter).address, host: w.find((x) => x.user_id === host).address, machineKey: keccak256(toBytes(b.mk)), token: PCP, priceUnits: BigInt(b.p), feeBps: BigInt(b.fee_bps), treasury: TREASURY, fundBy: BigInt(b.fb), activateBy: BigInt(b.ab) }, 1);
  };
  const activated = (endOffsetSec = 900) => ev("Activated", { startedAt: BigInt(Math.floor(Date.now() / 1000)), endAt: BigInt(Math.floor(Date.now() / 1000) + endOffsetSec) }, 2);
  const settled = () => ev("Settled", { hostGross: 1n }, 3);
  return { id, host, machine, renter, cid, b, funded, activated, settled };
}
const job = (type: string, id: string, key = `${type}:${id}:${Math.random()}`) => admin.query("select public.enqueue_job($1, $2, $3::jsonb, 0)", [key, type, JSON.stringify({ booking_id: id })]);
const force = async (sql: string, args: unknown[]) => {
  await admin.query("alter table public.bookings disable trigger bookings_guard");
  await admin.query(sql, args);
  await admin.query("alter table public.bookings enable trigger bookings_guard");
};
const row = async (id: string) => (await admin.query("select state, access_state, (select active_booking_id from public.machines m where m.id = machine_id) as holding from public.bookings where id = $1", [id])).rows[0] as { state: string; access_state: string; holding: string | null };
const wake = () => admin.query("update public.outbox_jobs set available_at = now() where status = 'pending'");
const run = (limit = 50) => runOnce(deps, limit, { schedule: false });
const reset = () => { calls.length = 0; for (const k of Object.keys(results)) delete results[k]; chain.failRpc = false; chain.activations.length = 0; chain.claims.length = 0; chain.claimFails = false; };
const pending = async (type: string, id: string) => (await admin.query("select status, attempts, last_error from public.outbox_jobs where job_type = $1 and payload->>'booking_id' = $2 order by id desc limit 1", [type, id])).rows[0] as { status: string; attempts: number; last_error: string | null } | undefined;

describe("vòng đời đầy đủ với provider/operator/chuỗi giả", () => {
  it("Funded → chuẩn bị → activate (đúng một lần) → Active → cấp phiên → Settled → thu hồi → reset → nhả máy", async () => {
    reset();
    const f = await newBooking();
    await f.funded();
    chain.state.set(f.cid, ESCROW_STATE.Funded);
    await job("reconcile_booking", f.id);
    await run();
    expect((await row(f.id)).state).toBe("funded");

    await run(); // prepare_session
    expect((await row(f.id)).access_state).toBe("ready");
    expect(calls).toEqual([`prepare:prepare:${f.id}`]);

    await run(); // activate_booking: gửi tx đúng một lần
    expect(chain.activations).toEqual([f.cid]);
    chain.state.set(f.cid, ESCROW_STATE.Active);
    f.activated();
    await wake();
    await run(); // reconcile → Active
    expect((await row(f.id)).state).toBe("active");
    expect((await row(f.id)).access_state).toBe("ready"); // chưa cấp vì job grant chưa chạy

    await run(); // grant_session
    expect((await row(f.id)).access_state).toBe("granted");
    expect(calls.filter((c) => c.startsWith("grant:"))).toHaveLength(1);
    expect(calls.find((c) => c.startsWith("grant:"))).toContain(f.renter);

    f.settled();
    await job("reconcile_booking", f.id);
    await run(); // Settled → job revoke
    expect((await row(f.id)).state).toBe("settled");
    await run(); // revoke → reset → verify → release
    const end = await row(f.id);
    expect([end.access_state, end.holding]).toEqual(["reset_verified", null]);
    expect(calls.map((c) => c.split(":")[0])).toEqual(["prepare", "grant", "revoke", "reset", "verify"]);
    expect(chain.activations).toHaveLength(1);
  });
});

describe("hết hạn booking và đối soát", () => {
  it("quá hạn + chuỗi xác nhận không có booking → expired và nhả máy", async () => {
    reset();
    const f = await newBooking();
    await force("update public.bookings set fund_by = now() - interval '10 minutes', activate_by = now() - interval '5 minutes' where id = $1", [f.id]);
    await job("expire_booking", f.id);
    await run();
    expect(await row(f.id)).toMatchObject({ state: "expired", holding: null });
  });
  it("chuỗi đã có Funded mà DB chưa thấy → KHÔNG expire, đối soát thành funded", async () => {
    reset();
    const f = await newBooking();
    await force("update public.bookings set fund_by = now() - interval '10 minutes' where id = $1", [f.id]);
    await f.funded();
    chain.state.set(f.cid, ESCROW_STATE.Funded);
    await job("expire_booking", f.id);
    await run();
    expect(await row(f.id)).toMatchObject({ state: "funded" });
    expect((await row(f.id)).holding).not.toBeNull();
  });
  it("RPC lỗi → giữ máy và thử lại có backoff; chưa tới biên an toàn → thử lại", async () => {
    reset();
    const f = await newBooking();
    await force("update public.bookings set fund_by = now() - interval '10 minutes' where id = $1", [f.id]);
    chain.failRpc = true;
    await job("expire_booking", f.id);
    const s = await run();
    expect(s.retried).toBe(1);
    expect(await row(f.id)).toMatchObject({ state: "reserved" });
    expect((await pending("expire_booking", f.id))!.last_error).toContain("RPC");
    const g = await newBooking();
    await force("update public.bookings set fund_by = now() - interval '10 seconds' where id = $1", [g.id]); // < biên 60s
    await job("expire_booking", g.id);
    await run();
    expect(await row(g.id)).toMatchObject({ state: "reserved" });
  });
});

describe("chuẩn bị, kích hoạt và cấp phiên chỉ khi đủ điều kiện", () => {
  it("prepare thất bại → access failed, không xếp job activate; không rõ → unknown; đều thử lại", async () => {
    reset();
    const f = await newBooking();
    await force("update public.bookings set state = 'funded' where id = $1", [f.id]);
    results.prepare = { ok: false, reason: "disk đầy" };
    await job("prepare_session", f.id);
    expect((await run()).retried).toBe(1);
    expect((await row(f.id)).access_state).toBe("failed");
    expect(await pending("activate_booking", f.id)).toBeUndefined();
    results.prepare = { ok: false, reason: "mất kết nối agent", unknown: true };
    await wake();
    await run();
    expect((await row(f.id)).access_state).toBe("unknown");
    results.prepare = { ok: true, evidence: "ok" };
    await wake();
    await run();
    expect((await row(f.id)).access_state).toBe("ready");
    expect(await pending("activate_booking", f.id)).toBeDefined();
  });

  it("activate: chuỗi đã Active thì không gửi tx; sai trạng thái là lỗi vĩnh viễn (dead); guest chưa sẵn sàng thì chờ", async () => {
    reset();
    const a = await newBooking();
    await force("update public.bookings set state = 'funded', access_state = 'ready' where id = $1", [a.id]);
    chain.state.set(a.cid, ESCROW_STATE.Active); // chuỗi đã Active (ví dụ crash sau khi gửi)
    await job("activate_booking", a.id);
    await run();
    expect(chain.activations).toEqual([]);
    const b = await newBooking(); // refunded: không được kích hoạt
    await force("update public.bookings set state = 'refunded' where id = $1", [b.id]);
    await job("activate_booking", b.id);
    const s = await run();
    expect(s.dead).toBe(1);
    const c = await newBooking(); // guest chưa ready
    await force("update public.bookings set state = 'funded', access_state = 'preparing' where id = $1", [c.id]);
    await job("activate_booking", c.id);
    expect((await run()).retried).toBe(1);
    expect(chain.activations).toEqual([]);
  });

  it("grant: chưa Active thì không cấp; hết endAt thì không cấp mà xếp thu hồi; provider không rõ thì không đánh dấu granted", async () => {
    reset();
    const a = await newBooking();
    await force("update public.bookings set state = 'funded', access_state = 'ready' where id = $1", [a.id]);
    await job("grant_session", a.id);
    expect((await run()).retried).toBe(1);
    expect(calls).toEqual([]);

    const b = await newBooking();
    await force("update public.bookings set state = 'active', access_state = 'ready', started_at = now() - interval '20 minutes', end_at = now() - interval '5 minutes' where id = $1", [b.id]);
    await job("grant_session", b.id);
    await run();
    expect(calls).toEqual([]);
    expect(await pending("revoke_session", b.id)).toBeDefined();

    const c = await newBooking();
    await force("update public.bookings set state = 'active', access_state = 'ready', started_at = now(), end_at = now() + interval '15 minutes' where id = $1", [c.id]);
    results.grant = { ok: false, reason: "agent im lặng", unknown: true };
    await job("grant_session", c.id);
    expect((await run()).retried).toBe(1);
    expect((await row(c.id)).access_state).toBe("ready");
  });
});

describe("thu hồi, reset và nhả máy", () => {
  it("verifyReset không rõ → access unknown, máy VẪN bị giữ, thử lại; khi xác minh được mới nhả", async () => {
    reset();
    const f = await newBooking();
    await force("update public.bookings set state = 'settled', access_state = 'granted' where id = $1", [f.id]);
    results.verify = { ok: false, reason: "không xác minh được", unknown: true };
    await job("revoke_session", f.id);
    expect((await run()).retried).toBe(1);
    expect(await row(f.id)).toMatchObject({ access_state: "unknown" });
    expect((await row(f.id)).holding).not.toBeNull();
    delete results.verify;
    await wake();
    await run();
    expect(await row(f.id)).toMatchObject({ access_state: "reset_verified", holding: null });
  });

  it("tranh chấp (tiền chưa terminal): thu hồi và reset nhưng KHÔNG nhả máy; sau Resolved mới nhả", async () => {
    reset();
    const f = await newBooking();
    await force("update public.bookings set state = 'disputed', access_state = 'granted' where id = $1", [f.id]);
    await job("revoke_session", f.id);
    await run();
    const mid = await row(f.id);
    expect([mid.access_state, mid.state]).toEqual(["reset_verified", "disputed"]);
    expect(mid.holding).not.toBeNull();
    await force("update public.bookings set state = 'resolved' where id = $1", [f.id]);
    await job("revoke_session", f.id);
    await run();
    expect((await row(f.id)).holding).toBeNull();
  });

  it("thu hồi lỗi ở bước revoke: access failed, thử lại tiếp tục đúng bước, provider được gọi lại idempotent theo actionId", async () => {
    reset();
    const f = await newBooking();
    await force("update public.bookings set state = 'settled', access_state = 'granted' where id = $1", [f.id]);
    results.revoke = { ok: false, reason: "agent từ chối" };
    await job("revoke_session", f.id);
    await run();
    expect((await row(f.id)).access_state).toBe("failed");
    delete results.revoke;
    await wake();
    await run();
    expect((await row(f.id)).holding).toBeNull();
    const ids = calls.filter((c) => c.startsWith("revoke:"));
    expect(new Set(ids).size).toBe(1); // cùng actionId ở cả hai lần gọi
    expect(ids.length).toBe(2);
  });
});

describe("kết thúc phiên khi người thuê không bấm gì (claimAfterGrace)", () => {
  const makeActive = async (endOffset: string) => {
    const a = await newBooking();
    await force(`update public.bookings set state = 'active', access_state = 'granted', started_at = now() - interval '40 minutes', end_at = now() - interval '${endOffset}' where id = $1`, [a.id]);
    return a;
  };

  it("lịch: chỉ xếp job khi đã qua endAt + ân hạn (600 s) + dự phòng; chưa tới thì không; chạy lại không tạo trùng", async () => {
    reset();
    const early = await makeActive("5 minutes"); // quá endAt nhưng còn trong ân hạn
    const late = await makeActive("11 minutes"); // quá endAt + 600 s + 30 s
    await scheduleTick(deps);
    expect(await pending("claim_after_grace", early.id)).toBeUndefined();
    expect(await pending("claim_after_grace", late.id)).toBeDefined();
    const n = async () => (await admin.query("select count(*)::int as n from public.outbox_jobs where job_type = 'claim_after_grace' and payload->>'booking_id' = $1", [late.id])).rows[0].n as number;
    await scheduleTick(deps);
    expect(await n()).toBe(1);
  });

  it("chuỗi đang Active: gửi claimAfterGrace đúng MỘT lần (chạy lại không gửi thêm), xếp đối soát; booking chưa đổi trạng thái cho tới khi chuỗi xác nhận", async () => {
    reset();
    const a = await makeActive("12 minutes");
    chain.state.set(a.cid, ESCROW_STATE.Active);
    await job("claim_after_grace", a.id);
    await run();
    expect(chain.claims).toEqual([a.cid]); // newBooking trả cid đã có tiền tố 0x
    expect(await pending("reconcile_booking", a.id)).toBeDefined();
    expect((await row(a.id)).state).toBe("active"); // chỉ đổi khi đối soát thấy Settled
    // chuỗi đã Settled (ví dụ người thuê accept xen vào / lần gọi trước đã thành công): không gửi thêm
    chain.state.set(a.cid, ESCROW_STATE.Settled);
    await job("claim_after_grace", a.id);
    await run();
    expect(chain.claims.length).toBe(1);
  });

  it("revert/RPC lỗi/chuỗi chưa Active ⇒ thử lại, không bao giờ coi là xong; booking không còn active ⇒ bỏ qua", async () => {
    reset();
    const a = await makeActive("12 minutes");
    chain.state.set(a.cid, ESCROW_STATE.Active);
    const st = async () => (await pending("claim_after_grace", a.id))!;
    chain.claimFails = true; // contract từ chối (ví dụ TooEarly do lệch đồng hồ)
    await job("claim_after_grace", a.id);
    await run();
    expect(chain.claims).toEqual([]);
    expect(await st()).toMatchObject({ status: "pending", attempts: 1 });
    expect((await st()).last_error).toMatch(/claimAfterGrace lỗi/);
    chain.claimFails = false; chain.failRpc = true;
    await wake();
    await run();
    expect(await st()).toMatchObject({ status: "pending", attempts: 2 });
    expect((await st()).last_error).toMatch(/không đọc được chuỗi/);
    chain.failRpc = false; chain.state.set(a.cid, ESCROW_STATE.Funded);
    await wake();
    await run();
    expect(await st()).toMatchObject({ status: "pending", attempts: 3 });
    expect((await st()).last_error).toMatch(/chưa ở Active/);
    expect(chain.claims).toEqual([]);
    const s = await newBooking();
    await force("update public.bookings set state = 'settled', access_state = 'revoked' where id = $1", [s.id]);
    await job("claim_after_grace", s.id);
    await run();
    expect(chain.claims).toEqual([]);
  });
});

describe("lease, crash và lập lịch", () => {
  it("worker cũ mất lease: job được worker mới xử lý; kết quả của worker cũ bị chặn (fencing)", async () => {
    reset();
    const f = await newBooking();
    await force("update public.bookings set state = 'settled', access_state = 'granted' where id = $1", [f.id]);
    await job("revoke_session", f.id);
    const claimed = (await admin.query("select id, attempts from public.claim_jobs('w-crash', 50, 30) where job_type = 'revoke_session' and payload->>'booking_id' = $1", [f.id])).rows[0];
    // w-crash "chết" sau khi nhận job; lease hết hạn
    await admin.query("update public.outbox_jobs set lease_until = now() - interval '1 second' where id = $1", [claimed.id]);
    const other = await run(); // w1 nhận lại và hoàn tất
    expect(other.done).toBeGreaterThanOrEqual(1);
    expect((await row(f.id)).holding).toBeNull();
    const late = await admin.query("select public.complete_job($1, 'w-crash', $2, '{}'::jsonb) as r", [claimed.id, claimed.attempts]);
    expect(late.rows[0].r).toBe(false);
  });

  it("job lạ → dead + audit; payload thiếu booking → dead", async () => {
    reset();
    await admin.query("select public.enqueue_job('x:lạ', 'khong_biet', '{\"booking_id\":\"00000000-0000-0000-0000-000000000000\"}'::jsonb, 0)");
    await admin.query("select public.enqueue_job('x:thieu', 'revoke_session', '{}'::jsonb, 0)");
    const s = await run();
    expect(s.dead).toBe(2);
    const a = await admin.query("select count(*)::int as n from public.audit_logs where action = 'job_dead'");
    expect(a.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it("scheduleTick: xếp job hết hạn, watchdog endAt và đối soát; chạy lại không tạo trùng", async () => {
    reset();
    const exp = await newBooking();
    await force("update public.bookings set fund_by = now() - interval '5 minutes' where id = $1", [exp.id]);
    const act = await newBooking();
    await force("update public.bookings set state = 'active', access_state = 'granted', started_at = now() - interval '20 minutes', end_at = now() - interval '1 minute' where id = $1", [act.id]);
    await scheduleTick(deps);
    expect(await pending("expire_booking", exp.id)).toBeDefined();
    expect(await pending("revoke_session", act.id)).toBeDefined();
    expect(await pending("reconcile_booking", act.id)).toBeDefined();
    const count = async () => (await admin.query("select count(*)::int as n from public.outbox_jobs")).rows[0].n as number;
    const before = await count();
    await scheduleTick(deps);
    expect(await count()).toBe(before);
  });
});

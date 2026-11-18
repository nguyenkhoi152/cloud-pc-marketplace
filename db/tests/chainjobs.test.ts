import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, makeApprovedHost, makeMachine, renterWithWallet, reserve } from "./harness";

let db: PGlite;
beforeAll(async () => { db = await createDb(); }, 60_000);
afterAll(async () => { await db.close(); });

const sv = <T>(fn: () => Promise<T>) => as(db, "service_role", fn);
const hex = (n: number, len: number) => "0x" + n.toString(16).padStart(len, "0");
const CONTRACT = hex(0xe5c0, 40);
let txn = 1;

async function newBooking() {
  const host = await makeApprovedHost(db);
  const machine = await makeMachine(db, host);
  const renter = await renterWithWallet(db);
  const b = await reserve(db, renter, machine);
  const row = (await db.query<{ chain_booking_id: Uint8Array; price_units: string; fee_bps: number }>("select chain_booking_id, price_units::text, fee_bps from public.bookings where id = $1", [b.id])).rows[0]!;
  return { id: b.id, chainId: row.chain_booking_id, price: row.price_units, fee: row.fee_bps, host, machine, renter };
}
const state = async (id: string) => (await db.query<{ state: string }>("select state from public.bookings where id = $1", [id])).rows[0]!.state;
const apply = (b: { chainId: Uint8Array }, event: string, data: Record<string, unknown>, o: { tx?: number; log?: number; block?: string } = {}) =>
  sv(async () => {
    const tx = o.tx ?? txn++;
    return (await db.query<{ r: string }>("select public.apply_chain_event(43113, $1, $2, $3, 100, $4, $5, $6, $7::jsonb) as r", [CONTRACT, hex(tx, 64), o.log ?? 0, o.block ?? hex(0xb10c, 64), event, b.chainId, JSON.stringify(data)])).rows[0]!.r;
  });

describe("apply_chain_event (idempotent, theo trạng thái, không tin sự kiện lệch)", () => {
  it("Funded → Activated → Settled, ghi started_at/end_at từ block activate", async () => {
    const b = await newBooking();
    expect(await apply(b, "Funded", { priceUnits: b.price, feeBps: String(b.fee) })).toBe("applied");
    expect(await state(b.id)).toBe("funded");
    expect(await apply(b, "Activated", { startedAt: 1_800_000_000, endAt: 1_800_000_900 })).toBe("applied");
    const row = (await db.query<{ s: number; e: number }>("select extract(epoch from started_at)::int as s, extract(epoch from end_at)::int as e from public.bookings where id = $1", [b.id])).rows[0]!;
    expect([row.s, row.e]).toEqual([1_800_000_000, 1_800_000_900]);
    expect(await apply(b, "Settled", {})).toBe("applied");
    expect(await state(b.id)).toBe("settled");
  });

  it("refund trước activate, và dispute → resolved", async () => {
    const a = await newBooking();
    await apply(a, "Funded", { priceUnits: a.price, feeBps: String(a.fee) });
    expect(await apply(a, "Refunded", {})).toBe("applied");
    expect(await state(a.id)).toBe("refunded");
    const b = await newBooking();
    await apply(b, "Funded", { priceUnits: b.price, feeBps: String(b.fee) });
    await apply(b, "Activated", { startedAt: 1, endAt: 2 });
    expect(await apply(b, "DisputeOpened", {})).toBe("applied");
    expect(await apply(b, "Resolved", {})).toBe("applied");
    expect(await state(b.id)).toBe("resolved");
  });

  it("áp lại cùng (tx, log) là duplicate; cùng tx khác block_hash là nghi reorg và không đổi trạng thái", async () => {
    const b = await newBooking();
    const tx = txn++;
    expect(await apply(b, "Funded", { priceUnits: b.price, feeBps: String(b.fee) }, { tx })).toBe("applied");
    expect(await apply(b, "Funded", { priceUnits: b.price, feeBps: String(b.fee) }, { tx })).toBe("duplicate");
    expect(await apply(b, "Funded", { priceUnits: b.price, feeBps: String(b.fee) }, { tx, block: hex(0xdead, 64) })).toBe("reorg_suspected");
    expect(await state(b.id)).toBe("funded");
    const audit = await db.query("select 1 from public.audit_logs where action = 'chain_reorg_suspected'");
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("giá/phí trên chuỗi lệch snapshot → mismatch, booking không bị funded", async () => {
    const b = await newBooking();
    expect(await apply(b, "Funded", { priceUnits: "1", feeBps: String(b.fee) })).toBe("mismatch");
    expect(await apply(b, "Funded", { priceUnits: b.price, feeBps: "9999" })).toBe("mismatch");
    expect(await state(b.id)).toBe("reserved");
  });

  it("sự kiện sai trạng thái bị bỏ qua có ghi nhận (Activated khi còn reserved; Settled khi chưa active)", async () => {
    const b = await newBooking();
    expect(await apply(b, "Activated", { startedAt: 1, endAt: 2 })).toBe("ignored_state");
    expect(await apply(b, "Settled", {})).toBe("ignored_state");
    expect(await state(b.id)).toBe("reserved");
    const out = await db.query<{ outcome: string }>("select outcome from public.chain_events where booking_chain_id = $1 order by id", [b.chainId]);
    expect(out.rows.map((r) => r.outcome)).toEqual(["ignored_state", "ignored_state"]);
  });

  it("booking không tồn tại → unknown_booking; sự kiện lạ bị từ chối; client không gọi được", async () => {
    const ghost = { chainId: new Uint8Array(32).fill(7) };
    expect(await apply(ghost, "Funded", {})).toBe("unknown_booking");
    await expect(apply(ghost, "Minted", {})).rejects.toThrow(/check constraint/);
    const b = await newBooking();
    const call = "select public.apply_chain_event(43113, $1, $2, 0, 1, $3, 'Funded', $4, '{}'::jsonb)";
    const args = [CONTRACT, hex(9999, 64), hex(1, 64), b.chainId];
    await expect(as(db, { user: b.renter }, () => db.query(call, args))).rejects.toThrow(/permission denied/);
    await expect(as(db, { user: b.host }, () => db.query(call, args))).rejects.toThrow(/permission denied/);
    await expect(as(db, "anon", () => db.query(call, args))).rejects.toThrow(/permission denied/);
    await expect(as(db, { user: b.renter }, () => db.query("select * from public.chain_events"))).rejects.toThrow(/permission denied/);
  });
});

describe("outbox: lease, fencing, retry, dead, hết hạn booking", () => {
  const enqueue = (key: string, delay = 0, payload: object = {}) =>
    sv(async () => (await db.query<{ r: boolean }>("select public.enqueue_job($1, 'test', $2::jsonb, $3) as r", [key, JSON.stringify(payload), delay])).rows[0]!.r);
  const claim = (worker: string, limit = 10, lease = 30) =>
    sv(async () => (await db.query<{ id: number; attempts: number; action_key: string }>("select id, attempts, action_key from public.claim_jobs($1, $2, $3)", [worker, limit, lease])).rows);
  const complete = (id: number, worker: string, attempt: number) =>
    sv(async () => (await db.query<{ r: boolean }>("select public.complete_job($1, $2, $3, '{}'::jsonb) as r", [id, worker, attempt])).rows[0]!.r);
  const fail = (id: number, worker: string, attempt: number, retry = true) =>
    sv(async () => (await db.query<{ r: string }>("select public.fail_job($1, $2, $3, 'lỗi thử', $4) as r", [id, worker, attempt, retry])).rows[0]!.r);

  it("enqueue idempotent theo action_key; job trễ chưa được nhận", async () => {
    expect(await enqueue("job:a")).toBe(true);
    expect(await enqueue("job:a")).toBe(false);
    expect(await enqueue("job:later", 3600)).toBe(true);
    const got = await claim("w1");
    expect(got.map((j) => j.action_key)).toContain("job:a");
    expect(got.map((j) => j.action_key)).not.toContain("job:later");
    for (const j of got) await complete(j.id, "w1", j.attempts);
  });

  it("job đang có lease không bị nhận lại; lease hết hạn thì nhận lại và worker cũ bị fencing", async () => {
    await enqueue("job:lease");
    const [j] = (await claim("w1", 10, 60)).filter((x) => x.action_key === "job:lease");
    expect(j!.attempts).toBe(1);
    expect((await claim("w2")).map((x) => x.action_key)).not.toContain("job:lease");
    await db.query("update public.outbox_jobs set lease_until = now() - interval '1 second' where id = $1", [j!.id]);
    const [again] = (await claim("w2")).filter((x) => x.action_key === "job:lease");
    expect(again!.attempts).toBe(2);
    expect(await complete(j!.id, "w1", 1)).toBe(false); // worker cũ: sai chủ + sai lần thử
    expect(await fail(j!.id, "w1", 1)).toBe("stale");
    expect(await complete(j!.id, "w2", 1)).toBe(false); // đúng worker nhưng lần thử cũ
    expect(await complete(j!.id, "w2", 2)).toBe(true);
    expect(await complete(j!.id, "w2", 2)).toBe(false); // đã xong, không ghi hai lần
  });

  it("fail_job: retry với backoff, dead khi hết lượt hoặc không retry được", async () => {
    await enqueue("job:fail");
    const [j] = (await claim("w1")).filter((x) => x.action_key === "job:fail");
    expect(await fail(j!.id, "w1", j!.attempts)).toBe("retry");
    const row = (await db.query<{ wait: number; status: string; err: string }>("select extract(epoch from (available_at - now()))::int as wait, status, last_error as err from public.outbox_jobs where id = $1", [j!.id])).rows[0]!;
    expect(row.status).toBe("pending");
    expect(row.wait).toBeGreaterThanOrEqual(5);
    expect(row.err).toBe("lỗi thử");
    expect((await claim("w1")).map((x) => x.action_key)).not.toContain("job:fail"); // đang chờ backoff

    await enqueue("job:dead");
    await db.query("update public.outbox_jobs set max_attempts = 1 where action_key = 'job:dead'");
    const [d] = (await claim("w1")).filter((x) => x.action_key === "job:dead");
    expect(await fail(d!.id, "w1", d!.attempts)).toBe("dead");
    await enqueue("job:noretry");
    const [n] = (await claim("w1")).filter((x) => x.action_key === "job:noretry");
    expect(await fail(n!.id, "w1", n!.attempts, false)).toBe("dead");
    expect((await claim("w1")).map((x) => x.action_key)).not.toEqual(expect.arrayContaining(["job:dead", "job:noretry"]));
  });

  it("enqueue_expiry_jobs: chỉ booking reserved quá hạn, idempotent", async () => {
    const stale = await newBooking();
    const fresh = await newBooking();
    const funded = await newBooking();
    await apply(funded, "Funded", { priceUnits: funded.price, feeBps: String(funded.fee) });
    await db.query("alter table public.bookings disable trigger bookings_guard");
    await db.query("update public.bookings set fund_by = now() - interval '1 minute' where id in ($1, $2)", [stale.id, funded.id]);
    await db.query("alter table public.bookings enable trigger bookings_guard");
    const first = await sv(async () => (await db.query<{ n: number }>("select public.enqueue_expiry_jobs() as n")).rows[0]!.n);
    expect(first).toBeGreaterThanOrEqual(1);
    const keys = (await db.query<{ action_key: string }>("select action_key from public.outbox_jobs where job_type = 'expire_booking'")).rows.map((r) => r.action_key);
    expect(keys).toContain(`expire:${stale.id}`);
    expect(keys).not.toContain(`expire:${fresh.id}`);
    expect(keys).not.toContain(`expire:${funded.id}`);
    expect(await sv(async () => (await db.query<{ n: number }>("select public.enqueue_expiry_jobs() as n")).rows[0]!.n)).toBe(0);
  });

  it("client không gọi được các hàm hàng đợi", async () => {
    const u = await renterWithWallet(db);
    for (const q of ["select * from public.claim_jobs('w', 1, 1)", "select public.enqueue_job('x','t','{}'::jsonb,0)", "select public.enqueue_expiry_jobs()"]) {
      await expect(as(db, { user: u }, () => db.query(q))).rejects.toThrow(/permission denied/);
    }
    await expect(as(db, "anon", () => db.query("select * from public.outbox_jobs"))).rejects.toThrow(/permission denied/);
  });
});

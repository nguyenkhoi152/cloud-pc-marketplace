/**
 * Kiểm đồng thời trên PostgreSQL THẬT (nhiều connection, barrier bằng pg_blocking_pids).
 * Không phải Supabase (auth/roles là shim) — xem realpg.ts. Test bị skip nếu không có binary Postgres.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linkWallet, makeApprovedHost, makeMachine, newUser, renterWithWallet } from "./harness";
import { asPglite, backendPid, startRealPg, waitBlocked, type RealPg } from "./realpg";

let real: RealPg | null = null;
let admin: pg.Client;
let a: pg.Client;
let b: pg.Client;
let obs: pg.Client;
let pidA = 0;
let pidB = 0;

beforeAll(async () => {
  real = await startRealPg();
  if (!real) return;
  [admin, a, b, obs] = await Promise.all([real.connect(), real.connect(), real.connect(), real.connect()]);
  pidA = await backendPid(a);
  pidB = await backendPid(b);
}, 120_000);
afterAll(async () => {
  if (!real) return;
  await Promise.all([admin, a, b, obs].map((c) => c.end().catch(() => undefined)));
  await real.stop();
}, 60_000);

const db = () => asPglite(admin);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Mở transaction với danh tính giả lập (LOCAL: tự hết khi commit/rollback). */
async function begin(c: pg.Client, user: string) {
  await c.query("begin");
  if (user === "service_role") await c.query("set local role service_role");
  else {
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    await c.query("set local role authenticated");
  }
}
const settle = <T>(p: Promise<T>) =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e: Error) => ({ ok: false as const, msg: String(e.message) }),
  );
const reserveSql = "select * from public.reserve_machine($1, $2, 'h1')";
const run = String(Date.now());
const key = () => "key-" + Math.random().toString(36).slice(2);
const count = async (sql: string, args: unknown[]) => (await admin.query<{ n: number }>(sql, args)).rows[0]!.n;

describe("đồng thời trên PostgreSQL thật", () => {
  const need = (ctx: { skip: () => void }) => {
    if (!real) ctx.skip();
  };

  it("[P1] reserve giữ khoá máy: host xoá cam kết bị chặn tới khi reserve commit, rồi bị từ chối", async (ctx) => {
    need(ctx);
    const host = await makeApprovedHost(db());
    const m = await makeMachine(db(), host);
    const renter = await renterWithWallet(db());
    const cid = (await admin.query<{ id: string }>("select id from public.host_commitments where machine_id = $1", [m])).rows[0]!.id;

    await begin(a, renter);
    await a.query(reserveSql, [m, key()]); // A: booking chưa commit, đang giữ khoá máy
    await begin(b, host);
    const pb = settle(b.query("delete from public.host_commitments where id = $1", [cid]));
    expect(await waitBlocked(obs, pidB, pidA), "B phải bị chặn bởi A").toBe(true);
    await a.query("commit");
    const r = await pb;
    expect(r.ok).toBe(false);
    expect(!r.ok && r.msg).toMatch(/commitment_in_use/);
    await b.query("rollback");

    expect(await count("select count(*)::int as n from public.host_commitments where machine_id = $1", [m])).toBe(1);
    expect(await count("select count(*)::int as n from public.bookings where machine_id = $1", [m])).toBe(1);
  });

  it("[P1] host xoá cam kết trước: reserve bị chặn, thấy cam kết đã mất và từ chối, không tạo booking", async (ctx) => {
    need(ctx);
    const host = await makeApprovedHost(db());
    const m = await makeMachine(db(), host);
    const renter = await renterWithWallet(db());

    await begin(b, host);
    await b.query("delete from public.host_commitments where machine_id = $1", [m]); // B: chưa commit, giữ khoá máy
    await begin(a, renter);
    const pa = settle(a.query(reserveSql, [m, key()]));
    expect(await waitBlocked(obs, pidA, pidB), "A phải bị chặn bởi B").toBe(true);
    await b.query("commit");
    const r = await pa;
    expect(r.ok).toBe(false);
    expect(!r.ok && r.msg).toMatch(/unavailable/);
    await a.query("rollback");
    expect(await count("select count(*)::int as n from public.bookings where machine_id = $1", [m])).toBe(0);
  });

  it("[P3] hai INSERT lịch chồng lấn đồng thời: cái sau bị chặn rồi từ chối", async (ctx) => {
    need(ctx);
    const host = await makeApprovedHost(db());
    const m = await makeMachine(db(), host);
    const ins = "insert into public.host_schedule_rules (machine_id, weekday, start_minute, end_minute) values ($1, 0, $2, $3)";
    await begin(a, host);
    await a.query(ins, [m, 600, 720]);
    await begin(b, host);
    const pb = settle(b.query(ins, [m, 660, 780]));
    expect(await waitBlocked(obs, pidB, pidA)).toBe(true);
    await a.query("commit");
    const r = await pb;
    expect(!r.ok && r.msg).toMatch(/schedule_overlap/);
    await b.query("rollback");
    expect(await count("select count(*)::int as n from public.host_schedule_rules where machine_id = $1", [m])).toBe(1);
  });

  it("[P3] UPDATE kéo dài khung và INSERT khung kề đồng thời: không để lại hai khung chồng nhau", async (ctx) => {
    need(ctx);
    const host = await makeApprovedHost(db());
    const m = await makeMachine(db(), host);
    await admin.query("insert into public.host_schedule_rules (machine_id, weekday, start_minute, end_minute) values ($1,0,600,720), ($1,0,900,960)", [m]);
    await begin(a, host);
    await a.query("update public.host_schedule_rules set end_minute = 780 where machine_id = $1 and start_minute = 600", [m]);
    await begin(b, host);
    const pb = settle(b.query("insert into public.host_schedule_rules (machine_id, weekday, start_minute, end_minute) values ($1, 0, 750, 840)", [m]));
    expect(await waitBlocked(obs, pidB, pidA)).toBe(true);
    await a.query("commit");
    const r = await pb;
    expect(!r.ok && r.msg).toMatch(/schedule_overlap/);
    await b.query("rollback");
    const overlaps = await count(
      `select count(*)::int as n from public.host_schedule_rules x join public.host_schedule_rules y
         on x.machine_id = y.machine_id and x.weekday = y.weekday and x.id < y.id
        and x.start_minute < y.end_minute and y.start_minute < x.end_minute
       where x.machine_id = $1`,
      [m],
    );
    expect(overlaps).toBe(0);
  });

  const W2 = "0x" + "e".repeat(40);
  const challenge = (user: string, nonce: string) =>
    admin.query(
      "insert into public.wallet_challenges (user_id, domain, address, chain_id, nonce_hash, expires_at) values ($1,'app.test',$2,43113,$3, now() + interval '5 minutes')",
      [user, W2, sha(nonce)],
    );
  const consume = (user: string, nonce: string) =>
    b.query("select public.consume_wallet_challenge($1,$2,$3,43113,'app.test')", [user, sha(nonce), W2]);

  it("[wallet] đổi ví của renter chờ reserve đang chạy rồi bị chặn vì đã có booking sống", async (ctx) => {
    need(ctx);
    const host = await makeApprovedHost(db());
    const m = await makeMachine(db(), host);
    const renter = await renterWithWallet(db());
    await challenge(renter, "n-renter");

    await begin(a, renter);
    await a.query(reserveSql, [m, key()]);
    await begin(b, "service_role");
    const pb = settle(consume(renter, "n-renter"));
    expect(await waitBlocked(obs, pidB, pidA), "đổi ví phải chờ khoá user").toBe(true);
    await a.query("commit");
    const r = await pb;
    expect(!r.ok && r.msg).toMatch(/wallet_change_blocked/);
    await b.query("rollback");
    const w = await admin.query<{ address: string }>("select address from public.wallet_links where user_id = $1", [renter]);
    expect(w.rows[0]!.address).not.toBe(W2);
  });

  it("[wallet] đổi ví của host chờ reserve đang đặt máy của host đó", async (ctx) => {
    need(ctx);
    const host = await makeApprovedHost(db());
    await linkWallet(db(), host);
    const m = await makeMachine(db(), host);
    const renter = await renterWithWallet(db());
    await challenge(host, "n-host");

    await begin(a, renter);
    await a.query(reserveSql, [m, key()]);
    await begin(b, "service_role");
    const pb = settle(consume(host, "n-host"));
    expect(await waitBlocked(obs, pidB, pidA)).toBe(true);
    await a.query("commit");
    const r = await pb;
    expect(!r.ok && r.msg).toMatch(/wallet_change_blocked/);
    await b.query("rollback");
  });

  it("[deadlock] hai user đặt máy của nhau đồng thời: cả hai thành công, không có deadlock", async (ctx) => {
    need(ctx);
    for (let i = 0; i < 8; i++) {
      const u1 = await newUser(db(), "u1");
      const u2 = await newUser(db(), "u2");
      for (const u of [u1, u2]) {
        await linkWallet(db(), u);
        await admin.query("insert into public.host_profiles (user_id, status) values ($1, 'approved')", [u]);
      }
      const m1 = await makeMachine(db(), u1);
      const m2 = await makeMachine(db(), u2);
      // Mỗi bên tự commit ngay sau reserve (khoá user giữ tới commit nên không được đợi bên kia trước khi commit).
      const run = async (c: pg.Client, u: string, machine: string) => {
        await begin(c, u);
        const r = await settle(c.query(reserveSql, [machine, key()]));
        await c.query(r.ok ? "commit" : "rollback");
        return r;
      };
      const [ra, rb] = await Promise.all([run(a, u1, m2), run(b, u2, m1)]);
      expect([ra.ok, rb.ok], JSON.stringify([ra, rb])).toEqual([true, true]);
    }
  }, 60_000);
  it("[jobs] hai worker nhận job đồng thời không trùng và không chặn nhau (SKIP LOCKED)", async (ctx) => {
    need(ctx);
    await admin.query("update public.outbox_jobs set status = 'done' where status = 'pending'");
    for (let i = 0; i < 5; i++) await admin.query("select public.enqueue_job($1, 'conc', '{}'::jsonb, 0)", [`conc:${run}:${i}`]);
    await begin(a, "service_role");
    const ra = await a.query<{ id: string }>("select id from public.claim_jobs('wa', 2, 60)"); // A giữ khoá hàng tới khi commit
    await begin(b, "service_role");
    const rb = await b.query<{ id: string }>("select id from public.claim_jobs('wb', 5, 60)"); // B không bị chặn, nhận phần còn lại
    await a.query("commit");
    await b.query("commit");
    const ids = [...ra.rows, ...rb.rows].map((r) => r.id);
    expect(ra.rows).toHaveLength(2);
    expect(rb.rows).toHaveLength(3);
    expect(new Set(ids).size).toBe(5);
  });

  it("[chain] hai tiến trình áp cùng một sự kiện chuỗi: một applied, một duplicate, booking funded đúng một lần", async (ctx) => {
    need(ctx);
    const host = await makeApprovedHost(db());
    const m = await makeMachine(db(), host);
    const renter = await renterWithWallet(db());
    await begin(a, renter);
    const bk = (await a.query<{ id: string }>(reserveSql, [m, key()])).rows[0]!;
    await a.query("commit");
    const row = (await admin.query<{ chain_booking_id: Buffer; price_units: string; fee_bps: number }>("select chain_booking_id, price_units::text, fee_bps from public.bookings where id = $1", [bk.id])).rows[0]!;
    const call = "select public.apply_chain_event(43113, $1, $2, 0, 10, $3, 'Funded', $4, $5::jsonb) as r";
    const args = ["0x" + "e5".repeat(20), "0x" + "ab".repeat(32), "0x" + "cd".repeat(32), row.chain_booking_id, JSON.stringify({ priceUnits: row.price_units, feeBps: String(row.fee_bps) })];
    await begin(a, "service_role");
    expect((await a.query<{ r: string }>(call, args)).rows[0]!.r).toBe("applied"); // chưa commit
    await begin(b, "service_role");
    const pb = settle(b.query<{ r: string }>(call, args));
    expect(await waitBlocked(obs, pidB, pidA), "B phải chờ khoá unique của A").toBe(true);
    await a.query("commit");
    const r = await pb;
    expect(r.ok && r.v.rows[0]!.r).toBe("duplicate");
    await b.query("commit");
    expect((await admin.query<{ state: string }>("select state from public.bookings where id = $1", [bk.id])).rows[0]!.state).toBe("funded");
    expect(await count("select count(*)::int as n from public.chain_events where tx_hash = $1", ["0x" + "ab".repeat(32)])).toBe(1);
  });
});

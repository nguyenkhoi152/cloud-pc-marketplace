import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, linkWallet, makeApprovedHost, makeMachine, newUser, renterWithWallet, reserve } from "./harness";

let db: PGlite;
beforeAll(async () => { db = await createDb(); }, 60_000);
afterAll(async () => { await db.close(); });

const sv = (fn: () => Promise<unknown>) => as(db, "service_role", fn);

describe("reserve_machine", () => {
  it("tạo booking với snapshot lấy từ server, đánh dấu máy, tạo outbox và audit", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host, { price: "20000000000000000000" });
    const renter = await renterWithWallet(db);
    const b = await reserve(db, renter, m);

    const row = (await db.query<Record<string, unknown>>("select * from public.bookings where id = $1", [b.id])).rows[0]!;
    expect(row.renter_id).toBe(renter);
    expect(row.host_id).toBe(host);
    expect(String(row.price_units)).toBe("20000000000000000000");
    expect(row.fee_bps).toBe(1000);
    expect(row.duration_seconds).toBe(900);
    expect(row.state).toBe("reserved");
    expect(row.access_state).toBe("not_granted");
    expect((row.chain_booking_id as Uint8Array).length).toBe(32);
    const quote = row.quote as Record<string, unknown>;
    expect(quote.price_units).toBe("20000000000000000000");
    expect(quote.chain_id).toBe(43113);
    // fund_by = +600s, activate_by = fund_by + 300s
    const gap = (await db.query<{ a: number; b: number }>(
      "select extract(epoch from fund_by - created_at)::int a, extract(epoch from activate_by - fund_by)::int b from public.bookings where id = $1", [b.id])).rows[0]!;
    expect(gap.a).toBeGreaterThanOrEqual(599);
    expect(gap.a).toBeLessThanOrEqual(600);
    expect(gap.b).toBe(300);

    expect((await db.query<{ active_booking_id: string }>("select active_booking_id from public.machines where id = $1", [m])).rows[0]!.active_booking_id).toBe(b.id);
    expect((await db.query("select 1 from public.outbox_jobs where action_key = $1", ["issue_quote:" + b.id])).rows).toHaveLength(1);
    expect((await db.query("select 1 from public.audit_logs where resource = $1", ["booking:" + b.id])).rows).toHaveLength(1);
  });

  it("từ chối: chưa đăng nhập, chưa có ví, tự thuê máy mình, input sai", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await expect(as(db, "anon", () => db.query("select public.reserve_machine($1, 'abcdefgh', 'h')", [m]))).rejects.toThrow(/permission denied/);
    await expect(sv(() => db.query("select public.reserve_machine($1, 'abcdefgh', 'h')", [m]))).rejects.toThrow(/forbidden/); // không có auth.uid()

    const noWallet = await newUser(db);
    await expect(reserve(db, noWallet, m)).rejects.toThrow(/wallet_required/);
    await linkWallet(db, host);
    await expect(reserve(db, host, m)).rejects.toThrow(/forbidden/); // host có ví nhưng không được tự thuê máy mình

    const renter = await renterWithWallet(db);
    await expect(reserve(db, renter, m, "short")).rejects.toThrow(/invalid_request/);
    await expect(reserve(db, renter, m, "valid-key-1", "")).rejects.toThrow(/invalid_request/);
    await expect(as(db, { user: renter }, () => db.query("select public.reserve_machine($1, 'valid-key-2', 'h', 'weird')", [m]))).rejects.toThrow(/invalid_request/);
    expect((await db.query("select 1 from public.bookings where machine_id = $1", [m])).rows).toHaveLength(0);
  });

  it("không thuê được máy chưa duyệt, tạm dừng, không tồn tại hoặc commitment không đủ phủ thời gian", async () => {
    const host = await makeApprovedHost(db);
    const renter = await renterWithWallet(db);
    const draft = await makeMachine(db, host, { status: "draft" });
    const suspended = await makeMachine(db, host, { status: "suspended" });
    // cần 600+300+900+600 = 2400s (40 phút); commitment tối thiểu 4h luôn phủ nếu bắt đầu đúng lúc,
    // nên dựng commitment sắp hết hạn bằng cách sửa trực tiếp bằng superuser.
    const short = await makeMachine(db, host);
    await db.query("update public.host_commitments set starts_at = now() - interval '4 hours', ends_at = now() + interval '39 minutes' where machine_id = $1", [short]);
    const future = await makeMachine(db, host);
    await db.query("update public.host_commitments set starts_at = now() + interval '1 minute', ends_at = now() + interval '9 hours' where machine_id = $1", [future]);
    const none = await makeMachine(db, host);
    await db.query("delete from public.host_commitments where machine_id = $1", [none]);

    for (const id of [draft, suspended, short, future, none, "00000000-0000-0000-0000-000000000000"]) {
      await expect(reserve(db, renter, id), id).rejects.toThrow(/unavailable/);
    }
    // vừa đủ phủ (41 phút) thì được
    const ok = await makeMachine(db, host);
    await db.query("update public.host_commitments set starts_at = now() - interval '4 hours', ends_at = now() + interval '41 minutes' where machine_id = $1", [ok]);
    await reserve(db, renter, ok);
  });

  it("hai renter đặt cùng máy: chỉ một thành công, người sau nhận unavailable", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    const r1 = await renterWithWallet(db);
    const r2 = await renterWithWallet(db);
    await reserve(db, r1, m);
    await expect(reserve(db, r2, m)).rejects.toThrow(/unavailable/);
    await expect(reserve(db, r1, m)).rejects.toThrow(/unavailable/); // cùng renter, key khác
    expect((await db.query("select 1 from public.bookings where machine_id = $1", [m])).rows).toHaveLength(1);
  });

  it("idempotency: cùng key+payload trả lại booking cũ; khác payload/máy bị từ chối", async () => {
    const host = await makeApprovedHost(db);
    const m1 = await makeMachine(db, host);
    const m2 = await makeMachine(db, host);
    const renter = await renterWithWallet(db);
    const first = await reserve(db, renter, m1, "idem-key-1", "hash-a");
    const again = await reserve(db, renter, m1, "idem-key-1", "hash-a");
    expect(again.id).toBe(first.id);
    await expect(reserve(db, renter, m1, "idem-key-1", "hash-b")).rejects.toThrow(/idempotency_conflict/);
    await expect(reserve(db, renter, m2, "idem-key-1", "hash-a")).rejects.toThrow(/idempotency_conflict/);
    expect((await db.query("select 1 from public.bookings where renter_id = $1", [renter])).rows).toHaveLength(1);
    expect((await db.query("select 1 from public.outbox_jobs where action_key = $1", ["issue_quote:" + first.id])).rows).toHaveLength(1);
  });

  it("chốt chặn DB: index unique chặn booking sống thứ hai dù bỏ qua hàm", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    const r1 = await renterWithWallet(db);
    const r2 = await renterWithWallet(db);
    const b = await reserve(db, r1, m);
    const insert = () => db.query(
      `insert into public.bookings (renter_id, machine_id, host_id, price_units, fee_bps, duration_seconds, fund_by, activate_by, policy_version_id, quote, idempotency_key, request_hash)
       select $1, $2, $3, 1, 0, 1, now(), now(), id, '{}', 'direct-key-' || random(), 'h' from public.policy_versions limit 1`, [r2, m, host]);
    await expect(insert()).rejects.toThrow(/bookings_one_live_per_machine|unique/);

    // Booking terminal về tiền nhưng quyền truy cập chưa reset vẫn giữ máy (cả ở mức index).
    await db.query("update public.bookings set state = 'cancelled', access_state = 'granted' where id = $1", [b.id]);
    await expect(insert()).rejects.toThrow(/bookings_one_live_per_machine|unique/);
    await db.query("update public.bookings set access_state = 'reset_verified' where id = $1", [b.id]);
    await insert(); // giờ mới chèn được
  });
});

describe("snapshot và trạng thái booking", () => {
  it("host đổi giá sau khi đặt không ảnh hưởng booking; snapshot không sửa được kể cả service_role", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    const renter = await renterWithWallet(db);
    const b = await reserve(db, renter, m);
    await as(db, { user: host }, () => db.query("update public.machines set price_units = 99 where id = $1", [m]));
    expect(String((await db.query<{ p: string }>("select price_units p from public.bookings where id = $1", [b.id])).rows[0]!.p)).toBe("20000000000000000000");
    for (const set of ["price_units = 1", "fee_bps = 0", "duration_seconds = 1", "renter_id = host_id", "quote = '{}'", "chain_booking_id = '\\x00'::bytea", "fund_by = now() + interval '1 day'"]) {
      await expect(sv(() => db.query(`update public.bookings set ${set} where id = $1`, [b.id])), set).rejects.toThrow(/immutable|violates/);
    }
  });

  it("chuyển trạng thái tiền chỉ theo đường hợp lệ; terminal không đi tiếp", async () => {
    const host = await makeApprovedHost(db);
    const renter = await renterWithWallet(db);
    const m = await makeMachine(db, host);
    const b = await reserve(db, renter, m);
    const go = (s: string) => sv(() => db.query(`update public.bookings set state = '${s}' where id = $1`, [b.id]));
    await expect(go("active")).rejects.toThrow(/invalid_transition/);
    await expect(go("settled")).rejects.toThrow(/invalid_transition/);
    await go("funded");
    await expect(go("reserved")).rejects.toThrow(/invalid_transition/);
    await go("active");
    await go("disputed");
    await go("resolved");
    for (const s of ["active", "refunded", "settled", "reserved"]) await expect(go(s), s).rejects.toThrow(/invalid_transition/);
  });

  it("máy bị giữ tới khi tiền terminal VÀ quyền truy cập reset xác minh; sau đó đặt lại được", async () => {
    const host = await makeApprovedHost(db);
    const r1 = await renterWithWallet(db);
    const r2 = await renterWithWallet(db);
    const m = await makeMachine(db, host);
    const b = await reserve(db, r1, m);
    const upd = (sql: string) => sv(() => db.query(`update public.bookings set ${sql} where id = $1`, [b.id]));
    await upd("state = 'funded'");
    await upd("state = 'active', access_state = 'granted'");
    await upd("state = 'settled'");

    await expect(sv(() => db.query("select public.release_machine($1)", [b.id]))).rejects.toThrow(/cleanup_pending/);
    await expect(reserve(db, r2, m)).rejects.toThrow(/unavailable/);
    await upd("access_state = 'revoking'");
    await upd("access_state = 'revoked'");
    await expect(sv(() => db.query("select public.release_machine($1)", [b.id]))).rejects.toThrow(/cleanup_pending/);
    await upd("access_state = 'failed'");
    await expect(reserve(db, r2, m)).rejects.toThrow(/unavailable/);
    await upd("access_state = 'reset_verified'");
    await sv(() => db.query("select public.release_machine($1)", [b.id]));
    expect((await db.query<{ a: string | null }>("select active_booking_id a from public.machines where id = $1", [m])).rows[0]!.a).toBeNull();
    await reserve(db, r2, m);
  });

  it("hết hold chỉ nhả máy khi đã quá hạn, đã đối soát chain và booking còn reserved", async () => {
    const host = await makeApprovedHost(db);
    const r1 = await renterWithWallet(db);
    const r2 = await renterWithWallet(db);
    const m = await makeMachine(db, host);
    const b = await reserve(db, r1, m);
    const expire = (reconciled: boolean) => sv(() => db.query("select public.expire_unfunded_booking($1, $2)", [b.id, reconciled]));

    await expect(expire(true)).rejects.toThrow(/hold_not_expired/);
    // fund_by bất biến -> test tạm tắt trigger (superuser) để giả lập thời gian trôi qua.
    await db.exec("alter table public.bookings disable trigger bookings_guard");
    await db.query("update public.bookings set fund_by = now() - interval '1 second' where id = $1", [b.id]);
    await db.exec("alter table public.bookings enable trigger bookings_guard");

    await expect(expire(false)).rejects.toThrow(/reconcile_required/);
    await expect(reserve(db, r2, m)).rejects.toThrow(/unavailable/); // hết hạn nhưng chưa đối soát -> vẫn giữ máy
    await expire(true);
    expect((await db.query<{ state: string }>("select state from public.bookings where id = $1", [b.id])).rows[0]!.state).toBe("expired");
    await reserve(db, r2, m);
    await expect(expire(true)).rejects.toThrow(/invalid_transition/); // đã expired
  });

  it("booking đã funded không thể bị expire", async () => {
    const host = await makeApprovedHost(db);
    const r1 = await renterWithWallet(db);
    const m = await makeMachine(db, host);
    const b = await reserve(db, r1, m);
    await sv(() => db.query("update public.bookings set state = 'funded' where id = $1", [b.id]));
    await expect(sv(() => db.query("select public.expire_unfunded_booking($1, true)", [b.id]))).rejects.toThrow(/invalid_transition/);
  });

  it("policy_versions bất biến và booking ghi lại version chính sách", async () => {
    await expect(db.query("update public.policy_versions set body = 'x'")).rejects.toThrow(/immutable/);
    await expect(db.query("delete from public.policy_versions")).rejects.toThrow(/immutable/);
    const host = await makeApprovedHost(db);
    const r1 = await renterWithWallet(db);
    const m = await makeMachine(db, host);
    const b = await reserve(db, r1, m);
    const q = (await db.query<{ q: Record<string, string> }>("select quote q from public.bookings where id = $1", [b.id])).rows[0]!.q;
    expect(q.policy_version).toBe("demo-0.1");
    expect(q.policy_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

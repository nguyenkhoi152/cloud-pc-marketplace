import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, createDbStagedAt, makeAdmin, makeApprovedHost, makeMachine, newUser, renterWithWallet, reserve } from "./harness";

let db: PGlite;
beforeAll(async () => { db = await createDb(); }, 60_000);
afterAll(async () => { await db.close(); });

const sha = (s: string) => createHash("sha256").update(s).digest();
const sv = <T>(fn: () => Promise<T>) => as(db, "service_role", fn);
const availability = async (m: string) =>
  (await as(db, "anon", async () => (await db.query<{ availability: string }>("select availability from public.public_machines where id = $1", [m])).rows))[0]?.availability;

/** Ghi danh thiết bị bằng tay chủ máy rồi gửi một heartbeat: máy có agent "sống". */
async function bringOnline(host: string, m: string, tag: string) {
  await sv(() => db.query("select public.create_enrollment($1,$2,$3,600)", [host, m, sha("tok-" + tag)]));
  await sv(() => db.query("select public.redeem_enrollment($1,$2)", [sha("tok-" + tag), sha("cred-" + tag)]));
  await sv(() => db.query("select public.record_heartbeat($1, 1)", [sha("cred-" + tag)]));
}
/** fund_by bất biến (trigger) nên tạm tắt trigger để giả lập thời gian trôi qua, như reservation.test.ts. */
async function expireBooking(id: string) {
  await db.exec("alter table public.bookings disable trigger bookings_guard");
  await db.query("update public.bookings set fund_by = now() - interval '1 second' where id = $1", [id]);
  await db.exec("alter table public.bookings enable trigger bookings_guard");
  await sv(() => db.query("select public.expire_unfunded_booking($1, true)", [id]));
}
const exists = async (table: string, col: string, id: string) =>
  ((await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${col} = $1`, [id])).rows[0]!.n) > 0;

describe("public_machines.availability: trạng thái online THẬT từ heartbeat và booking", () => {
  it("chưa có agent => offline; có heartbeat => online; trễ 60 giây vẫn online (suspect); quá 90 giây => offline", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    expect(await availability(m)).toBe("offline");
    await bringOnline(host, m, "a1");
    expect(await availability(m)).toBe("online");
    await db.query("update public.device_enrollments set last_heartbeat_at = now() - interval '60 seconds' where machine_id = $1", [m]);
    expect(await availability(m)).toBe("online");
    await db.query("update public.device_enrollments set last_heartbeat_at = now() - interval '200 seconds' where machine_id = $1", [m]);
    expect(await availability(m)).toBe("offline");
  });

  it("khớp machine_health/booking_is_live ở mọi mốc (view viết thẳng điều kiện nên phải đối chiếu để không trôi lệch)", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await bringOnline(host, m, "a0");
    for (const secs of [0, 10, 29, 31, 60, 89, 91, 500]) {
      await db.query("update public.device_enrollments set last_heartbeat_at = now() - make_interval(secs => $2) where machine_id = $1", [m, secs]);
      const health = (await db.query<{ h: string }>("select public.machine_health($1) as h", [m])).rows[0]!.h;
      expect(await availability(m), `heartbeat cách ${secs}s (machine_health=${health})`).toBe(health === "ok" || health === "suspect" ? "online" : "offline");
    }
    // booking_is_live: mọi cặp (state, access_state) cho kết quả giống nhau giữa hàm và view.
    const states = ["reserved", "funded", "active", "settled", "refunded", "disputed", "resolved", "cancelled", "expired"];
    const access = ["not_granted", "preparing", "ready", "granted", "revoking", "revoked", "resetting", "reset_verified", "failed", "unknown"];
    const b = await reserve(db, await renterWithWallet(db), m);
    await db.exec("alter table public.bookings disable trigger bookings_guard");
    await db.exec("alter table public.machines disable trigger user");
    for (const s of states) {
      for (const a of access) {
        await db.query("update public.bookings set state = $2::public.booking_state, access_state = $3::public.access_state where id = $1", [b.id, s, a]);
        await db.query("update public.machines set active_booking_id = null where id = $1", [m]);
        const live = (await db.query<{ l: boolean }>("select public.booking_is_live($1::public.booking_state, $2::public.access_state) as l", [s, a])).rows[0]!.l;
        expect(await availability(m), `${s}/${a}`).toBe(live ? "busy" : "offline");
      }
    }
    await db.exec("alter table public.machines enable trigger user");
    await db.exec("alter table public.bookings enable trigger bookings_guard");
  });

  it("thu hồi thiết bị => offline ngay", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await bringOnline(host, m, "a2");
    expect(await availability(m)).toBe("online");
    await sv(() => db.query("select public.revoke_device($1,$2)", [host, m]));
    expect(await availability(m)).toBe("offline");
  });

  it("có booking sống => busy dù agent còn sống; booking hết hạn xong => online trở lại", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await bringOnline(host, m, "a3");
    const b = await reserve(db, await renterWithWallet(db), m);
    expect(await availability(m)).toBe("busy");
    await expireBooking(b.id);
    expect(await availability(m)).toBe("online");
  });

  it("không đưa lịch/accepting vào tín hiệu (máy online dù chưa bật nhận thuê, khớp reserve_machine vốn không kiểm các thứ đó)", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await bringOnline(host, m, "a4");
    expect((await db.query("select 1 from public.machine_availability where machine_id = $1", [m])).rows).toHaveLength(0);
    expect(await availability(m)).toBe("online");
  });

  it("vẫn chỉ máy approved của host approved; không lộ owner; anon/authenticated đọc được", async () => {
    const host = await makeApprovedHost(db);
    const draft = await makeMachine(db, host, { status: "draft" });
    expect(await availability(draft)).toBeUndefined();
    const m = await makeMachine(db, host);
    const u = await newUser(db);
    const cols = await as(db, { user: u }, async () => Object.keys((await db.query("select * from public.public_machines where id = $1", [m])).rows[0]!));
    expect(cols).toEqual(["id", "name", "declared_specs", "price_units", "created_at", "availability"]);
  });
});

describe("admin_delete_machine: chỉ xoá máy chưa từng có tiền hay phiên", () => {
  const del = (who: string, m: string) => as(db, { user: who }, () => db.query("select public.admin_delete_machine($1)", [m]));

  it("chỉ admin: chủ máy, người lạ và anon đều bị chặn; máy không tồn tại => unavailable", async () => {
    const admin = await makeAdmin(db);
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await expect(del(host, m)).rejects.toThrow(/forbidden/);
    await expect(del(await newUser(db), m)).rejects.toThrow(/forbidden/);
    await expect(as(db, "anon", () => db.query("select public.admin_delete_machine($1)", [m]))).rejects.toThrow(/permission denied/);
    await expect(del(admin, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/unavailable/);
    expect(await exists("machines", "id", m)).toBe(true);
  });

  it("máy chưa có booking: xoá được cùng cam kết, có audit cho admin", async () => {
    const admin = await makeAdmin(db);
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await del(admin, m);
    expect(await exists("machines", "id", m)).toBe(false);
    expect(await exists("host_commitments", "machine_id", m)).toBe(false);
    const logs = await as(db, { user: admin }, async () => (await db.query<{ action: string; detail: { bookings_removed: number } }>("select action, detail from public.audit_logs where resource = $1", ["machine:" + m])).rows);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "delete_machine", detail: { bookings_removed: 0 } });
  });

  it("luồng thật reserve => hết hạn => xoá: booking chưa tới tay tiền được xoá theo máy", async () => {
    const admin = await makeAdmin(db);
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    const b = await reserve(db, await renterWithWallet(db), m);
    await expect(del(admin, m)).rejects.toThrow(/has_history/); // còn reserved (đang giữ): chưa xoá được
    await expireBooking(b.id);
    await del(admin, m);
    expect(await exists("machines", "id", m)).toBe(false);
    expect(await exists("bookings", "id", b.id)).toBe(false);
    expect(await exists("host_commitments", "machine_id", m)).toBe(false);
  });

  it("máy có booking đã settled/funded (từng chạm tiền hoặc phiên) => has_history, KHÔNG xoá gì; vẫn đình chỉ được", async () => {
    const admin = await makeAdmin(db);
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    const b = await reserve(db, await renterWithWallet(db), m);
    await db.exec("alter table public.bookings disable trigger bookings_guard");
    await db.query("update public.bookings set state = 'settled', access_state = 'reset_verified' where id = $1", [b.id]);
    await db.exec("alter table public.bookings enable trigger bookings_guard");
    await expect(del(admin, m)).rejects.toThrow(/has_history/);
    expect(await exists("machines", "id", m)).toBe(true);
    expect(await exists("bookings", "id", b.id)).toBe(true);
    expect(await exists("host_commitments", "machine_id", m)).toBe(true);
    await as(db, { user: admin }, () => db.query("select public.review_machine($1, 'suspended')", [m]));
    expect((await db.query<{ status: string }>("select status from public.machines where id = $1", [m])).rows[0]!.status).toBe("suspended");
  });

  it("migration chạy lặp lại không lỗi và không đổi kết quả", async () => {
    const { db: old, applyRest } = await createDbStagedAt("20261120000002_admin_dashboard_availability.sql");
    try {
      await applyRest();
      await applyRest();
      const cols = await old.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_machines' order by ordinal_position");
      expect(cols.rows.map((c) => c.column_name)).toEqual(["id", "name", "declared_specs", "price_units", "created_at", "availability"]);
    } finally {
      await old.close();
    }
  });
});

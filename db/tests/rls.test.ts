import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, linkWallet, makeAdmin, makeApprovedHost, makeMachine, newUser, renterWithWallet, reserve } from "./harness";

let db: PGlite;
beforeAll(async () => { db = await createDb(); }, 60_000);
afterAll(async () => { await db.close(); });

const denied = /permission denied|row-level security|violates row-level/i;

describe("anon / dữ liệu công khai", () => {
  it("anon đọc được public_machines chỉ gồm máy approved của host approved, không lộ owner", async () => {
    const host = await makeApprovedHost(db);
    const ok = await makeMachine(db, host);
    const draft = await makeMachine(db, host, { status: "draft" });
    const pendingHost = await newUser(db, "ph");
    await db.query("insert into public.host_profiles (user_id) values ($1)", [pendingHost]);
    const hidden = await makeMachine(db, pendingHost);

    const rows = await as(db, "anon", async () => (await db.query<Record<string, unknown>>("select * from public.public_machines")).rows);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ok);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(hidden);
    expect(Object.keys(rows[0]!)).not.toContain("owner_id");
  });

  it("anon không đọc được bảng gốc, booking, role, audit, outbox, private config", async () => {
    for (const t of ["machines", "bookings", "user_roles", "audit_logs", "outbox_jobs", "machine_private_config", "wallet_challenges", "wallet_links", "profiles", "host_profiles"]) {
      await expect(as(db, "anon", () => db.query(`select * from public.${t}`)), t).rejects.toThrow(denied);
    }
  });

  it("anon không gọi được hàm nghiệp vụ", async () => {
    await expect(as(db, "anon", () => db.query("select public.reserve_machine(gen_random_uuid(), 'abcdefgh', 'h')"))).rejects.toThrow(/permission denied/);
  });
});

describe("host và phân quyền", () => {
  it("user chưa là host approved không tạo được máy", async () => {
    const u = await newUser(db);
    await expect(
      as(db, { user: u }, () => db.query("insert into public.machines (owner_id, machine_key, name, price_units) values ($1, 'machine-abc1234', 'x', 1)", [u])),
    ).rejects.toThrow(denied);
  });

  it("host tạo máy chỉ cho chính mình, luôn ở draft, không tự đặt status/active_booking_id", async () => {
    const host = await makeApprovedHost(db);
    const other = await makeApprovedHost(db);
    await as(db, { user: host }, () => db.query("insert into public.machines (owner_id, machine_key, name, price_units) values ($1, 'host-own-0001', 'x', 5)", [host]));
    await expect(
      as(db, { user: host }, () => db.query("insert into public.machines (owner_id, machine_key, name, price_units) values ($1, 'host-other-0001', 'x', 5)", [other])),
    ).rejects.toThrow(denied);
    await expect(
      as(db, { user: host }, () => db.query("insert into public.machines (owner_id, machine_key, name, price_units, status) values ($1, 'host-appr-0001', 'x', 5, 'approved')", [host])),
    ).rejects.toThrow(denied);
    const st = await db.query<{ status: string }>("select status from public.machines where machine_key = 'host-own-0001'");
    expect(st.rows[0]!.status).toBe("draft");
  });

  it("host không tự duyệt máy, tự sửa status/owner/machine_key/active_booking_id", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host, { status: "draft" });
    await expect(as(db, { user: host }, () => db.query("select public.review_machine($1, 'approved')", [m]))).rejects.toThrow(/forbidden/);
    for (const col of ["status = 'approved'", "owner_id = gen_random_uuid()", "machine_key = 'hijacked-key-1'", "active_booking_id = gen_random_uuid()"]) {
      await expect(as(db, { user: host }, () => db.query(`update public.machines set ${col} where id = $1`, [m])), col).rejects.toThrow(denied);
    }
  });

  it("host khác không sửa/xem máy hoặc tạo commitment cho máy người khác", async () => {
    const host = await makeApprovedHost(db);
    const attacker = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    const seen = await as(db, { user: attacker }, async () => (await db.query("select * from public.machines where id = $1", [m])).rows);
    expect(seen).toHaveLength(0);
    const upd = await as(db, { user: attacker }, () => db.query("update public.machines set name = 'pwn' where id = $1", [m]));
    expect(upd.affectedRows).toBe(0);
    await expect(
      as(db, { user: attacker }, () => db.query("insert into public.host_commitments (machine_id, starts_at, ends_at) values ($1, now(), now() + interval '5 hours')", [m])),
    ).rejects.toThrow(denied);
  });

  it("commitment dưới 4 giờ bị từ chối", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await expect(
      as(db, { user: host }, () => db.query("insert into public.host_commitments (machine_id, starts_at, ends_at) values ($1, now(), now() + interval '3 hours 59 minutes')", [m])),
    ).rejects.toThrow(/commitment_min_4h|check constraint/);
    await as(db, { user: host }, () => db.query("insert into public.host_commitments (machine_id, starts_at, ends_at) values ($1, now(), now() + interval '4 hours')", [m]));
  });

  it("sửa thông số máy đã duyệt đưa máy về review và biến khỏi danh sách công khai", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await as(db, { user: host }, () => db.query(`update public.machines set declared_specs = '{"ramGb":128}' where id = $1`, [m]));
    const s = await db.query<{ status: string }>("select status from public.machines where id = $1", [m]);
    expect(s.rows[0]!.status).toBe("review");
    const pub = await as(db, "anon", async () => (await db.query("select id from public.public_machines where id = $1", [m])).rows);
    expect(pub).toHaveLength(0);
  });

  it("giá máy không âm, không 0, không vượt supply cap (kể cả host cập nhật)", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    for (const bad of ["0", "-1", "1000000000000000000000001"]) {
      await expect(as(db, { user: host }, () => db.query("update public.machines set price_units = $2 where id = $1", [m, bad])), bad).rejects.toThrow(/check constraint|price_units/);
    }
    await as(db, { user: host }, () => db.query("update public.machines set price_units = $2 where id = $1", [m, "1000000000000000000000000"]));
  });

  it("máy cố dùng chung machine_key bị chặn (một thiết bị một listing)", async () => {
    const host = await makeApprovedHost(db);
    await db.query("insert into public.machines (owner_id, machine_key, name, price_units) values ($1, 'dup-device-key', 'a', 1)", [host]);
    await expect(db.query("insert into public.machines (owner_id, machine_key, name, price_units) values ($1, 'dup-device-key', 'b', 1)", [host])).rejects.toThrow(/unique|duplicate/);
  });
});

describe("admin / role", () => {
  it("user tự thêm role admin hoặc tự duyệt host đều bị chặn", async () => {
    const u = await newUser(db);
    await expect(as(db, { user: u }, () => db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [u]))).rejects.toThrow(denied);
    await expect(as(db, { user: u }, () => db.query("insert into public.host_profiles (user_id, status) values ($1, 'approved')", [u]))).rejects.toThrow(denied);
    await as(db, { user: u }, () => db.query("insert into public.host_profiles (user_id) values ($1)", [u]));
    await expect(as(db, { user: u }, () => db.query("select public.review_host($1, 'approved')", [u]))).rejects.toThrow(/forbidden/);
    await expect(as(db, { user: u }, () => db.query("update public.host_profiles set status = 'approved' where user_id = $1", [u]))).rejects.toThrow(denied);
  });

  it("admin duyệt host rồi máy; có audit; host mới tạo/submit được máy", async () => {
    const admin = await makeAdmin(db);
    const u = await newUser(db, "newhost");
    await as(db, { user: u }, () => db.query("insert into public.host_profiles (user_id) values ($1)", [u]));
    await as(db, { user: admin }, () => db.query("select public.review_host($1, 'approved')", [u]));
    const m = await as(db, { user: u }, async () =>
      (await db.query<{ id: string }>("insert into public.machines (owner_id, machine_key, name, price_units) values ($1, 'new-host-machine', 'x', 10) returning id", [u])).rows[0]!.id);
    await as(db, { user: u }, () => db.query("select public.submit_machine_for_review($1)", [m]));
    await as(db, { user: admin }, () => db.query("select public.review_machine($1, 'approved')", [m]));
    const st = await db.query<{ status: string }>("select status from public.machines where id = $1", [m]);
    expect(st.rows[0]!.status).toBe("approved");
    const logs = await as(db, { user: admin }, async () => (await db.query("select action from public.audit_logs")).rows);
    expect(logs.length).toBeGreaterThanOrEqual(2);
    const nonAdminLogs = await as(db, { user: u }, async () => (await db.query("select * from public.audit_logs")).rows);
    expect(nonAdminLogs).toHaveLength(0);
  });

  it("host bị suspend không còn thuê được/hiển thị", async () => {
    const admin = await makeAdmin(db);
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    const renter = await renterWithWallet(db);
    await as(db, { user: admin }, () => db.query("select public.review_host($1, 'suspended')", [host]));
    await expect(reserve(db, renter, m)).rejects.toThrow(/unavailable/);
    const pub = await as(db, "anon", async () => (await db.query("select id from public.public_machines where id = $1", [m])).rows);
    expect(pub).toHaveLength(0);
  });
});

describe("booking RLS", () => {
  it("renter và host thấy booking của mình, người khác không; client không ghi trực tiếp", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    const renter = await renterWithWallet(db);
    const stranger = await renterWithWallet(db);
    const b = await reserve(db, renter, m);

    const count = (u: string) => as(db, { user: u }, async () => (await db.query("select id from public.bookings where id = $1", [b.id])).rows.length);
    expect(await count(renter)).toBe(1);
    expect(await count(host)).toBe(1);
    expect(await count(stranger)).toBe(0);

    await expect(as(db, { user: renter }, () => db.query("update public.bookings set state = 'funded' where id = $1", [b.id]))).rejects.toThrow(denied);
    await expect(as(db, { user: renter }, () => db.query("update public.bookings set price_units = 1 where id = $1", [b.id]))).rejects.toThrow(denied);
    await expect(as(db, { user: renter }, () => db.query("delete from public.bookings where id = $1", [b.id]))).rejects.toThrow(denied);
    await expect(
      as(db, { user: renter }, () => db.query("insert into public.bookings (renter_id, machine_id, host_id, price_units, fee_bps, duration_seconds, fund_by, activate_by, policy_version_id, quote, idempotency_key, request_hash) select $1, $2, $3, 1, 0, 1, now(), now(), id, '{}', 'forged-key-1', 'h' from public.policy_versions limit 1", [renter, m, host])),
    ).rejects.toThrow(denied);
    await expect(as(db, { user: renter }, () => db.query("select * from public.outbox_jobs"))).rejects.toThrow(denied);
  });

  it("client không gọi được hàm chỉ dành cho server", async () => {
    const u = await newUser(db);
    await expect(as(db, { user: u }, () => db.query("select public.release_machine(gen_random_uuid())"))).rejects.toThrow(/permission denied/);
    await expect(as(db, { user: u }, () => db.query("select public.expire_unfunded_booking(gen_random_uuid(), true)"))).rejects.toThrow(/permission denied/);
    await expect(as(db, { user: u }, () => db.query("select public.consume_wallet_challenge($1, 'x', '0x', 1, 'd')", [u]))).rejects.toThrow(/permission denied/);
  });

  it("không có bảng public nào thiếu RLS", async () => {
    const r = await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public' and not rowsecurity");
    expect(r.rows).toEqual([]);
  });

  it("user không đọc được profile/ví người khác", async () => {
    const a = await newUser(db, "a");
    const b = await newUser(db, "b");
    await linkWallet(db, b);
    expect(await as(db, { user: a }, async () => (await db.query("select * from public.profiles where user_id = $1", [b])).rows)).toHaveLength(0);
    expect(await as(db, { user: a }, async () => (await db.query("select * from public.wallet_links where user_id = $1", [b])).rows)).toHaveLength(0);
    await expect(as(db, { user: a }, () => db.query("update public.profiles set status = 'disabled' where user_id = $1", [a]))).rejects.toThrow(denied);
  });
});

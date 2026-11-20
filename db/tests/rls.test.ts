import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, createDbStagedAt, linkWallet, makeAdmin, makeApprovedHost, makeMachine, newUser, renterWithWallet, reserve } from "./harness";

let db: PGlite;
beforeAll(async () => { db = await createDb(); }, 60_000);
afterAll(async () => { await db.close(); });

const denied = /permission denied|row-level security|violates row-level/i;

describe("anon / dữ liệu công khai", () => {
  it("anon đọc được public_machines chỉ gồm máy approved của host approved, không lộ owner", async () => {
    const host = await makeApprovedHost(db);
    const ok = await makeMachine(db, host);
    const draft = await makeMachine(db, host, { status: "draft" });
    const suspendedHost = await newUser(db, "ph");
    await db.query("insert into public.host_profiles (user_id, status) values ($1, 'suspended')", [suspendedHost]);
    const hidden = await makeMachine(db, suspendedHost);

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

  // (Đã bỏ test "sửa thông số đưa máy về review": migration 20261120000001 chủ ý bỏ hành vi đó vì không còn admin duyệt lại.
  //  Test thay thế: "sửa thông số máy đã đăng KHÔNG đẩy máy về chờ duyệt" ở nhóm admin / role.)

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

  const GOOD_SPECS = JSON.stringify({ cores: 8, ramGb: 16, gpu: null, categories: ["dev"] });
  const newHostMachine = async (u: string, key: string, specs = GOOD_SPECS) =>
    as(db, { user: u }, async () =>
      (await db.query<{ id: string }>("insert into public.machines (owner_id, machine_key, name, declared_specs, price_units) values ($1, $2, 'x', $3::jsonb, 10) returning id", [u, key, specs])).rows[0]!.id);

  it("KHÔNG cần admin: host tự đăng ký là approved, tự đăng máy và máy hiện công khai; có audit cho admin", async () => {
    const admin = await makeAdmin(db);
    const u = await newUser(db, "newhost");
    await as(db, { user: u }, () => db.query("insert into public.host_profiles (user_id) values ($1)", [u]));
    const hp = await db.query<{ status: string }>("select status from public.host_profiles where user_id = $1", [u]);
    expect(hp.rows[0]!.status).toBe("approved");
    const m = await newHostMachine(u, "new-host-machine");
    expect((await db.query<{ status: string }>("select status from public.machines where id = $1", [m])).rows[0]!.status).toBe("draft");
    await as(db, { user: u }, () => db.query("select public.submit_machine_for_review($1)", [m]));
    expect((await db.query<{ status: string }>("select status from public.machines where id = $1", [m])).rows[0]!.status).toBe("approved");
    const pub = await as(db, "anon", async () => (await db.query("select id from public.public_machines where id = $1", [m])).rows);
    expect(pub).toHaveLength(1);
    const logs = await as(db, { user: admin }, async () => (await db.query<{ action: string }>("select action from public.audit_logs where resource = $1", ["machine:" + m])).rows);
    expect(logs.map((l) => l.action)).toContain("publish_machine");
    const nonAdminLogs = await as(db, { user: u }, async () => (await db.query("select * from public.audit_logs")).rows);
    expect(nonAdminLogs).toHaveLength(0);
  });

  it("đăng máy chỉ nhận thông số hợp lệ (cores và ramGb là số >= 1); thiếu hoặc sai kiểu bị từ chối và máy giữ nguyên draft", async () => {
    const u = await makeApprovedHost(db);
    const cases: [string, string][] = [
      ["bad-specs-empty-1", "{}"],
      ["bad-specs-nocore-1", JSON.stringify({ ramGb: 16 })],
      ["bad-specs-zero-ram", JSON.stringify({ cores: 4, ramGb: 0 })],
      ["bad-specs-string-1", JSON.stringify({ cores: "8", ramGb: 16 })],
      ["bad-specs-array-1", "[]"],
    ];
    for (const [key, specs] of cases) {
      const m = await newHostMachine(u, key, specs);
      await expect(as(db, { user: u }, () => db.query("select public.submit_machine_for_review($1)", [m])), key).rejects.toThrow(/invalid_request/);
      expect((await db.query<{ status: string }>("select status from public.machines where id = $1", [m])).rows[0]!.status).toBe("draft");
    }
  });

  it("không đăng hộ người khác; user không phải host không đăng được; máy bị admin đình chỉ không tự đăng lại được", async () => {
    const admin = await makeAdmin(db);
    const u = await makeApprovedHost(db);
    const other = await makeApprovedHost(db);
    const stranger = await newUser(db, "nohost");
    const m = await newHostMachine(u, "owner-only-0001");
    await expect(as(db, { user: other }, () => db.query("select public.submit_machine_for_review($1)", [m]))).rejects.toThrow(/unavailable/);
    await expect(as(db, { user: stranger }, () => db.query("select public.submit_machine_for_review($1)", [m]))).rejects.toThrow(/forbidden/);
    await as(db, { user: u }, () => db.query("select public.submit_machine_for_review($1)", [m]));
    await as(db, { user: admin }, () => db.query("select public.review_machine($1, 'suspended')", [m]));
    await expect(as(db, { user: u }, () => db.query("select public.submit_machine_for_review($1)", [m]))).rejects.toThrow(/unavailable/);
    expect((await db.query<{ status: string }>("select status from public.machines where id = $1", [m])).rows[0]!.status).toBe("suspended");
  });

  it("sửa thông số máy đã đăng KHÔNG đẩy máy về chờ duyệt (không còn admin để duyệt lại)", async () => {
    const u = await makeApprovedHost(db);
    const m = await newHostMachine(u, "edit-specs-0001");
    await as(db, { user: u }, () => db.query("select public.submit_machine_for_review($1)", [m]));
    await as(db, { user: u }, () => db.query("update public.machines set declared_specs = $2::jsonb where id = $1", [m, JSON.stringify({ cores: 16, ramGb: 32 })]));
    expect((await db.query<{ status: string }>("select status from public.machines where id = $1", [m])).rows[0]!.status).toBe("approved");
  });

  it("migration backfill: host pending và máy review có từ trước được đăng luôn", async () => {
    const { db: old, applyRest } = await createDbStagedAt("20261120000001_self_service_listing.sql");
    try {
      // Dữ liệu theo luật cũ: host pending (default cũ), máy đang chờ duyệt, và một host bị đình chỉ phải GIỮ NGUYÊN.
      const u = await newUser(old, "legacy");
      await old.query("insert into public.host_profiles (user_id) values ($1)", [u]);
      expect((await old.query<{ status: string }>("select status from public.host_profiles where user_id = $1", [u])).rows[0]!.status).toBe("pending");
      const m = await makeMachine(old, u, { status: "review" });
      const bad = await newUser(old, "banned");
      await old.query("insert into public.host_profiles (user_id, status) values ($1, 'suspended')", [bad]);
      await applyRest();
      await applyRest(); // áp lần hai (dán hai lần ở SQL Editor) không được lỗi và không đổi kết quả
      expect((await old.query<{ status: string }>("select status from public.host_profiles where user_id = $1", [u])).rows[0]!.status).toBe("approved");
      expect((await old.query<{ status: string }>("select status from public.machines where id = $1", [m])).rows[0]!.status).toBe("approved");
      expect((await old.query<{ status: string }>("select status from public.host_profiles where user_id = $1", [bad])).rows[0]!.status).toBe("suspended");
    } finally {
      await old.close();
    }
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

  it("mọi hàm public: không PUBLIC/anon EXECUTE, authenticated chỉ đúng danh sách cho phép", async () => {
    // Hàm mới tạo mà quên revoke sẽ mặc định cho PUBLIC gọi (xem migration schedule_devices mục 0).
    const r = await db.query<{ fn: string; pub: boolean; anon: boolean; auth: boolean }>(`
      select p.oid::regprocedure::text as fn,
             (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as pub,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'`);
    expect(r.rows.filter((x) => x.pub).map((x) => x.fn), "còn EXECUTE cho PUBLIC").toEqual([]);
    expect(r.rows.filter((x) => x.anon).map((x) => x.fn), "anon gọi được hàm").toEqual([]);
    const authenticated = r.rows.filter((x) => x.auth).map((x) => x.fn.replace(/^[a-z_]+\./, "").replace(/\(.*/, "")).sort();
    expect(authenticated).toEqual(
      ["admin_delete_machine", "booking_is_live", "is_admin", "is_approved_host", "my_machine_health", "reserve_machine", "review_host", "review_machine", "schedule_windows", "submit_machine_for_review"].sort(),
    );
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

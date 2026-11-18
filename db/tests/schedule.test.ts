import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, makeAdmin, makeApprovedHost, makeMachine, newUser, renterWithWallet, reserve } from "./harness";

let db: PGlite;
beforeAll(async () => { db = await createDb(); }, 60_000);
afterAll(async () => { await db.close(); });

const sha = (s: string) => createHash("sha256").update(s).digest();
const denied = /permission denied|row-level security|violates row-level/i;
const sv = <T>(fn: () => Promise<T>) => as(db, "service_role", fn);

async function rule(host: string, machine: string, weekday: number, from: number, to: number) {
  return as(db, { user: host }, () =>
    db.query("insert into public.host_schedule_rules (machine_id, weekday, start_minute, end_minute) values ($1,$2,$3,$4)", [machine, weekday, from, to]));
}
async function exception(host: string, machine: string, date: string, kind: string, from: number | null = null, to: number | null = null) {
  return as(db, { user: host }, () =>
    db.query("insert into public.host_schedule_exceptions (machine_id, on_date, kind, start_minute, end_minute) values ($1,$2,$3,$4,$5)", [machine, date, kind, from, to]));
}
async function windows(machine: string, from: string, to: string) {
  const r = await db.query<{ day: string; starts_at: Date; ends_at: Date }>("select day::text, starts_at, ends_at from public.schedule_windows($1, $2, $3)", [machine, from, to]);
  return r.rows.map((x) => ({ day: x.day, from: x.starts_at.toISOString(), to: x.ends_at.toISOString() }));
}

describe("lịch availability của host", () => {
  it("quy đổi 19:00–23:00 Asia/Ho_Chi_Minh sang UTC; ngoại lệ bỏ ngày/đổi giờ", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    for (let d = 0; d < 7; d++) await rule(host, m, d, 19 * 60, 23 * 60); // mỗi ngày
    // 09/11/2026 là Thứ Hai
    expect(await windows(m, "2026-11-09", "2026-11-09")).toEqual([{ day: "2026-11-09", from: "2026-11-09T12:00:00.000Z", to: "2026-11-09T16:00:00.000Z" }]);
    await exception(host, m, "2026-11-10", "skip");
    await exception(host, m, "2026-11-11", "custom", 20 * 60, 22 * 60);
    const w = await windows(m, "2026-11-09", "2026-11-12");
    expect(w.map((x) => x.day)).toEqual(["2026-11-09", "2026-11-11", "2026-11-12"]);
    expect(w[1]).toEqual({ day: "2026-11-11", from: "2026-11-11T13:00:00.000Z", to: "2026-11-11T15:00:00.000Z" });
  });

  it("từ chối giờ sai, không bội 15 phút, <30 phút, chồng lấn; cho phép khung liền kề", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await expect(rule(host, m, 0, 600, 600)).rejects.toThrow(/rule_order|check constraint/);
    await expect(rule(host, m, 0, 700, 600)).rejects.toThrow(/rule_order|check constraint/);
    await expect(rule(host, m, 0, 610, 700)).rejects.toThrow(/check constraint/);
    await expect(rule(host, m, 0, 600, 615)).rejects.toThrow(/rule_min_30|check constraint/);
    await expect(rule(host, m, 0, 600, 1455)).rejects.toThrow(/check constraint/);
    await rule(host, m, 0, 600, 720);
    await expect(rule(host, m, 0, 705, 810)).rejects.toThrow(/schedule_overlap/);
    await expect(rule(host, m, 0, 540, 601)).rejects.toThrow(/check constraint|schedule_overlap/);
    await rule(host, m, 0, 720, 810); // liền kề: hợp lệ
    await rule(host, m, 1, 705, 810); // khác ngày: hợp lệ
  });

  it("ngoại lệ sai hình dạng hoặc trùng ngày bị từ chối", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await expect(exception(host, m, "2026-11-10", "custom")).rejects.toThrow(/exc_shape|check constraint/);
    await expect(exception(host, m, "2026-11-10", "skip", 600, 700)).rejects.toThrow(/exc_shape|check constraint/);
    await expect(exception(host, m, "2026-11-10", "custom", 600, 620)).rejects.toThrow(/exc_shape|check constraint/);
    await exception(host, m, "2026-11-10", "skip");
    await expect(exception(host, m, "2026-11-10", "skip")).rejects.toThrow(/unique|duplicate/);
  });

  it("chỉ chủ máy là host đã duyệt mới ghi được lịch; người khác/anon bị chặn", async () => {
    const host = await makeApprovedHost(db);
    const other = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await expect(rule(other, m, 0, 600, 720)).rejects.toThrow(denied);
    const pending = await newUser(db, "pending");
    await expect(rule(pending, m, 0, 600, 720)).rejects.toThrow(denied);
    await expect(as(db, "anon", () => db.query("select * from public.host_schedule_rules"))).rejects.toThrow(/permission denied/);
    await rule(host, m, 0, 600, 720);
    const seen = await as(db, { user: other }, async () => (await db.query("select * from public.host_schedule_rules")).rows);
    expect(seen).toHaveLength(0);
  });
});

describe("enrollment và heartbeat thiết bị", () => {
  async function setup() {
    const admin = await makeAdmin(db);
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    return { admin, host, m };
  }
  const enroll = (admin: string, m: string, tok: string, ttl = 600) =>
    sv(() => db.query<{ create_enrollment: string }>("select public.create_enrollment($1,$2,$3,$4)", [admin, m, sha(tok), ttl]));
  const redeem = (tok: string, cred: string) => sv(() => db.query("select public.redeem_enrollment($1,$2)", [sha(tok), sha(cred)]));
  const beat = (cred: string, n: number) => sv(() => db.query("select public.record_heartbeat($1,$2)", [sha(cred), n]));

  it("chỉ admin tạo enrollment, máy phải approved, TTL trong giới hạn", async () => {
    const { admin, host, m } = await setup();
    await expect(enroll(host, m, "t1")).rejects.toThrow(/forbidden/);
    await expect(enroll(admin, m, "t2", 10)).rejects.toThrow(/invalid_request/);
    await expect(enroll(admin, m, "t3", 99999)).rejects.toThrow(/invalid_request/);
    const draft = await makeMachine(db, host, { status: "draft" });
    await expect(enroll(admin, draft, "t4")).rejects.toThrow(/unavailable/);
    await enroll(admin, m, "t5");
  });

  it("client (kể cả admin/host) không đọc bảng hay gọi hàm enrollment/heartbeat", async () => {
    const { admin, host, m } = await setup();
    await expect(as(db, { user: host }, () => db.query("select * from public.device_enrollments"))).rejects.toThrow(denied);
    await expect(as(db, { user: admin }, () => db.query("select * from public.device_enrollments"))).rejects.toThrow(denied);
    await expect(as(db, { user: admin }, () => db.query("select public.create_enrollment($1,$2,$3,600)", [admin, m, sha("x")]))).rejects.toThrow(/permission denied/);
    await expect(as(db, "anon", () => db.query("select public.record_heartbeat($1, 1)", [sha("x")]))).rejects.toThrow(/permission denied/);
  });

  it("token dùng đúng một lần, trong hạn; hết hạn/thu hồi/sai token bị từ chối", async () => {
    const { admin, m } = await setup();
    await enroll(admin, m, "tok-a");
    await expect(redeem("tok-sai", "c1")).rejects.toThrow(/invalid_enrollment/);
    await redeem("tok-a", "cred-a");
    await expect(redeem("tok-a", "cred-b")).rejects.toThrow(/invalid_enrollment/);

    const m2 = await makeMachine(db, await makeApprovedHost(db));
    await enroll(admin, m2, "tok-exp");
    await db.query("update public.device_enrollments set expires_at = now() - interval '1 second' where machine_id = $1", [m2]);
    await expect(redeem("tok-exp", "c2")).rejects.toThrow(/invalid_enrollment/);

    const m3 = await makeMachine(db, await makeApprovedHost(db));
    await enroll(admin, m3, "tok-rev");
    await sv(() => db.query("select public.revoke_device($1,$2)", [admin, m3]));
    await expect(redeem("tok-rev", "c3")).rejects.toThrow(/invalid_enrollment/);
  });

  it("heartbeat: counter phải tăng (replay bị chặn), credential lạ/đã thu hồi bị từ chối, health theo ngưỡng", async () => {
    const { admin, m } = await setup();
    await enroll(admin, m, "tok-h");
    await redeem("tok-h", "cred-h");
    const health = async (offsetSec: number) =>
      (await db.query<{ h: string }>("select public.machine_health($1, now() + make_interval(secs => $2)) as h", [m, offsetSec])).rows[0]!.h;
    expect(await health(0)).toBe("unknown"); // chưa có heartbeat

    await beat("cred-h", 5);
    await expect(beat("cred-h", 5)).rejects.toThrow(/invalid_heartbeat/); // replay
    await expect(beat("cred-h", 4)).rejects.toThrow(/invalid_heartbeat/);
    await expect(beat("cred-la", 6)).rejects.toThrow(/invalid_heartbeat/);
    await beat("cred-h", 6);
    expect(await health(10)).toBe("ok");
    expect(await health(45)).toBe("suspect");
    expect(await health(120)).toBe("incident");

    await sv(() => db.query("select public.revoke_device($1,$2)", [admin, m]));
    await expect(beat("cred-h", 7)).rejects.toThrow(/invalid_heartbeat/);
    expect(await health(0)).toBe("unknown");
    // Sau khi thu hồi có thể enroll thiết bị mới cho máy
    await enroll(admin, m, "tok-h2");
    await redeem("tok-h2", "cred-h2");
    await beat("cred-h2", 1);
  });
});

describe("trạng thái sức khoẻ cho client (my_machine_health)", () => {
  const myHealth = (ctx: Parameters<typeof as>[1], m: string) =>
    as(db, ctx, async () => (await db.query<{ h: string }>("select public.my_machine_health($1) as h", [m])).rows[0]!.h);

  it("chủ máy và admin đọc được trạng thái an toàn qua đúng role của họ; người khác bị từ chối", async () => {
    const admin = await makeAdmin(db);
    const host = await makeApprovedHost(db);
    const other = await makeApprovedHost(db);
    const renter = await newUser(db, "renter");
    const m = await makeMachine(db, host);

    expect(await myHealth({ user: host }, m)).toBe("unknown"); // chưa có thiết bị; trước đây lỗi permission denied
    expect(await myHealth({ user: admin }, m)).toBe("unknown");
    await expect(myHealth({ user: other }, m)).rejects.toThrow(/forbidden/);
    await expect(myHealth({ user: renter }, m)).rejects.toThrow(/forbidden/);
    await expect(myHealth("anon", m)).rejects.toThrow(/permission denied/);

    await as(db, "service_role", () => db.query("select public.create_enrollment($1,$2,$3,600)", [admin, m, sha("tok-my")]));
    await as(db, "service_role", () => db.query("select public.redeem_enrollment($1,$2)", [sha("tok-my"), sha("cred-my")]));
    await as(db, "service_role", () => db.query("select public.record_heartbeat($1, 1)", [sha("cred-my")]));
    expect(await myHealth({ user: host }, m)).toBe("ok");
  });

  it("host không gọi trực tiếp machine_health và không đọc device_enrollments", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await expect(as(db, { user: host }, () => db.query("select public.machine_health($1)", [m]))).rejects.toThrow(/permission denied for function/);
    await expect(as(db, { user: host }, () => db.query("select * from public.device_enrollments"))).rejects.toThrow(denied);
  });
});

describe("điều kiện nhận phiên mới (can_accept_new)", () => {
  const NOW = "2026-11-09T05:00:00Z"; // Thứ Hai 12:00 Asia/Ho_Chi_Minh
  const can = async (m: string, need = 2400) =>
    (await db.query<{ c: boolean }>("select public.can_accept_new($1, $2::timestamptz, $3) as c", [m, NOW, need])).rows[0]!.c;

  it("chỉ true khi đủ mọi điều kiện; mỗi điều kiện thiếu làm false", async () => {
    const admin = await makeAdmin(db);
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    expect(await can(m)).toBe(false); // chưa gì cả

    await rule(host, m, 0, 9 * 60, 17 * 60); // Thứ Hai 09:00–17:00
    expect(await can(m)).toBe(false); // chưa accepting

    await as(db, { user: host }, () => db.query("insert into public.machine_availability (machine_id, accepting) values ($1, true)", [m]));
    expect(await can(m)).toBe(false); // chưa có thiết bị

    await sv(() => db.query("select public.create_enrollment($1,$2,$3,600)", [admin, m, sha("tok-c")]));
    await sv(() => db.query("select public.redeem_enrollment($1,$2)", [sha("tok-c"), sha("cred-c")]));
    await sv(() => db.query("select public.record_heartbeat($1, 1)", [sha("cred-c")]));
    await db.query("update public.device_enrollments set last_heartbeat_at = $2::timestamptz - interval '10 seconds' where machine_id = $1", [m, NOW]);
    expect(await can(m)).toBe(true);

    await db.query("update public.device_enrollments set last_heartbeat_at = $2::timestamptz - interval '60 seconds' where machine_id = $1", [m, NOW]);
    expect(await can(m)).toBe(false); // heartbeat cũ (suspect)
    await db.query("update public.device_enrollments set last_heartbeat_at = $2::timestamptz - interval '10 seconds' where machine_id = $1", [m, NOW]);

    expect(await can(m, 5 * 3600 + 1)).toBe(false); // vượt phần còn lại của cửa sổ (12:00→17:00 = 5h)
    await exception(host, m, "2026-11-09", "skip");
    expect(await can(m)).toBe(false); // ngày bị bỏ

    await as(db, { user: host }, () => db.query("update public.machine_availability set accepting = false where machine_id = $1", [m]));
    await db.query("delete from public.host_schedule_exceptions where machine_id = $1", [m]);
    expect(await can(m)).toBe(false); // host tạm nghỉ: lịch không ghi đè
  });

  it("máy có booking sống hoặc host/máy chưa duyệt thì false", async () => {
    const admin = await makeAdmin(db);
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    await rule(host, m, 0, 9 * 60, 17 * 60);
    await as(db, { user: host }, () => db.query("insert into public.machine_availability (machine_id, accepting) values ($1, true)", [m]));
    await sv(() => db.query("select public.create_enrollment($1,$2,$3,600)", [admin, m, sha("tok-d")]));
    await sv(() => db.query("select public.redeem_enrollment($1,$2)", [sha("tok-d"), sha("cred-d")]));
    await sv(() => db.query("select public.record_heartbeat($1, 1)", [sha("cred-d")]));
    await db.query("update public.device_enrollments set last_heartbeat_at = $2::timestamptz - interval '5 seconds' where machine_id = $1", [m, NOW]);
    expect(await can(m)).toBe(true);

    const renter = await renterWithWallet(db);
    await reserve(db, renter, m);
    expect(await can(m)).toBe(false); // booking sống giữ máy
  });
});

describe("cam kết (host_commitments) không được phá booking đang sống", () => {
  it("host không xoá/rút ngắn cam kết đang phủ booking; mở rộng và thay bằng cam kết phủ khác thì được", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    const renter = await renterWithWallet(db);
    const b = await reserve(db, renter, m);
    const cid = (await db.query<{ id: string }>("select id from public.host_commitments where machine_id = $1", [m])).rows[0]!.id;
    const hostSql = (sql: string, args: unknown[]) => as(db, { user: host }, () => db.query(sql, args));

    await expect(hostSql("delete from public.host_commitments where id = $1", [cid])).rejects.toThrow(/commitment_in_use/);
    await expect(hostSql("update public.host_commitments set starts_at = now() + interval '1 minute' where id = $1", [cid])).rejects.toThrow(/commitment_in_use/);
    // service_role cũng bị chặn: ràng buộc nằm ở DB
    await expect(sv(() => db.query("delete from public.host_commitments where id = $1", [cid]))).rejects.toThrow(/commitment_in_use/);

    await hostSql("update public.host_commitments set ends_at = now() + interval '30 hours' where id = $1", [cid]); // mở rộng: được
    await hostSql("insert into public.host_commitments (machine_id, starts_at, ends_at) values ($1, now() - interval '2 hours', now() + interval '30 hours')", [m]);
    await hostSql("delete from public.host_commitments where id = $1", [cid]); // còn cam kết khác phủ: được

    // Booking kết thúc và dọn xong → được sửa/xoá tự do
    await db.query("update public.bookings set state = 'cancelled' where id = $1", [b.id]);
    await hostSql("delete from public.host_commitments where machine_id = $1", [m]);
  });
});

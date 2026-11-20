/**
 * SMOKE TEST VỚI SUPABASE DEV THẬT — dùng chính lớp src/api/live.ts (không client giả).
 * Chỉ dùng key công khai. Tạo tài khoản test và dữ liệu `smoke-*` trên project dev (client không xóa được).
 *
 * QUY TẮC KẾT QUẢ: không có test nào bị skip. Thiếu cấu hình, còn bật xác nhận email, thiếu role admin/ví thử
 * → test liên quan ĐỎ kèm lý do và thao tác cần làm. Xanh nghĩa là bước đó thật sự đã chạy.
 *
 * Cần tối đa 3 câu SQL ngoài client (SQL Editor): 1 câu cấp role admin + 1 câu gắn ví thử cho mỗi renter (2 renter).
 * Test in đúng các câu còn thiếu. Mật khẩu test sinh ngẫu nhiên, lưu ở desktop/.env.smoke.local, không in ra.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readEnv } from "../src/api/env";
import { createLiveApi, formatUnits, type Db, type LiveApi } from "../src/api/live";

const ENVFILE = path.join(process.cwd(), ".env.smoke.local");
const cfg = readEnv({ VITE_APP_MODE: "live", VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY });
const ROLES = ["admin", "host", "renter", "renter2"] as const;
type Role = (typeof ROLES)[number];

function readFileEnv(): Record<string, string> {
  if (!existsSync(ENVFILE)) return {};
  return Object.fromEntries(
    readFileSync(ENVFILE, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}
function ensureCreds(role: Role): { email: string; password: string } {
  const e = readFileEnv();
  const k = role.toUpperCase();
  if (e[`SMOKE_${k}_EMAIL`] && e[`SMOKE_${k}_PASSWORD`]) return { email: e[`SMOKE_${k}_EMAIL`]!, password: e[`SMOKE_${k}_PASSWORD`]! };
  const email = `cpm-smoke-${role}-${randomBytes(4).toString("hex")}@example.com`;
  const password = randomBytes(18).toString("base64url");
  appendFileSync(ENVFILE, `SMOKE_${k}_EMAIL=${email}\nSMOKE_${k}_PASSWORD=${password}\n`); // ghi TRƯỚC khi đăng ký để không mất
  return { email, password };
}

const client = () =>
  createClient(cfg.mode === "live" ? cfg.url : "http://invalid.local", cfg.mode === "live" ? cfg.anonKey : "x", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const users = {} as Record<Role, { api: LiveApi; id: string }>;
/** Client Supabase thô của từng tài khoản (để thử các thao tác mà lớp API cố ý không có). */
const raws = {} as Record<Role, ReturnType<typeof client>>;
const rawDb = (role: Role) => raws[role];
const anon = () => createLiveApi(client());
const run = String(Date.now());

/** Tiền điều kiện của chuỗi test. Mỗi cờ chỉ bật khi bước tương ứng thật sự đạt; thiếu → ném lỗi (test đỏ), không skip. */
const state = { configured: false, autoconfirm: false, accounts: false, sql: false };
function requires(...keys: (keyof typeof state)[]) {
  const why: Record<keyof typeof state, string> = {
    configured: "chưa cấu hình desktop/.env.local (chạy npm run check:env)",
    autoconfirm: "project còn bật xác nhận email (Authentication → Providers → Email → tắt Confirm email)",
    accounts: "chưa tạo/đăng nhập được 4 tài khoản test (xem test 3)",
    sql: "chưa có role admin và ví thử (xem SQL in ra ở test 4)",
  };
  const missing = keys.filter((k) => !state[k]);
  if (missing.length) throw new Error(`CHƯA ĐẠT — tiền điều kiện thiếu: ${missing.map((k) => why[k]).join("; ")}`);
}

let machineId = "";
let priceUnits = "";

describe("Supabase dev thật (qua src/api/live.ts)", () => {
  // Dọn: test 5 đăng một máy `smoke-*` công khai mỗi lần chạy (client không xoá được). Đình chỉ nó để KHÔNG còn hiện trong danh mục của người thuê
  // (trước đây mỗi lần chạy để lại một máy "Máy test tự động" cạnh máy thật). Muốn xoá hẳn: Quản trị → Máy → Xoá (chỉ khi chưa có tiền/phiên).
  afterAll(async () => {
    if (!machineId || !users.admin) return;
    try {
      await users.admin.api.admin.reviewMachine(machineId, "suspended");
      console.log(`[smoke] đã đình chỉ máy thử ${machineId.slice(0, 8)} (không còn hiện cho người thuê)`);
    } catch (e) {
      console.warn(`[smoke] KHÔNG đình chỉ được máy thử ${machineId.slice(0, 8)}: ${(e as Error).message}. Đình chỉ tay: Quản trị → Máy.`);
    }
  });

  it("0. cấu hình hợp lệ và Auth trả cài đặt; email autoconfirm đã bật", async () => {
    expect(cfg.mode, cfg.mode === "invalid" ? cfg.problems.join(" ") : "").toBe("live");
    state.configured = true;
    const live = cfg as { url: string; anonKey: string };
    const r = await fetch(`${live.url}/auth/v1/settings`, { headers: { apikey: live.anonKey } });
    expect(r.status, "Không gọi được /auth/v1/settings: kiểm tra URL/key").toBe(200);
    const s = (await r.json()) as { mailer_autoconfirm?: boolean; disable_signup?: boolean };
    console.log(`[smoke] Auth settings: email autoconfirm=${s.mailer_autoconfirm}, disable_signup=${s.disable_signup}`);
    expect(s.disable_signup, "Đăng ký đang bị tắt (disable_signup)").not.toBe(true);
    expect(s.mailer_autoconfirm, "Còn bật xác nhận email → chưa thể tạo tài khoản test. Tắt Confirm email ở Authentication → Providers → Email").toBe(true);
    state.autoconfirm = true;
  });

  it("1. kết nối: đọc danh mục công khai bằng anon (PostgREST + view)", async () => {
    requires("configured");
    const list = await anon().catalog.list();
    expect(Array.isArray(list)).toBe(true);
    console.log(`[smoke] public_machines: ${list.length} máy`);
  });

  it("2. anon bị chặn ở dữ liệu riêng và hàm nghiệp vụ", async () => {
    requires("configured");
    const db = client();
    for (const t of ["bookings", "machines", "device_enrollments", "outbox_jobs", "user_roles", "wallet_links", "wallet_challenges", "audit_logs"]) {
      const { data, error } = await db.from(t).select("*").limit(1);
      expect(error, `anon đọc được bảng ${t}`).not.toBeNull();
      expect(data).toBeNull();
    }
    const zero = "00000000-0000-0000-0000-000000000000";
    expect((await db.rpc("reserve_machine", { p_machine_id: zero, p_idempotency_key: "anon-test-1", p_request_hash: "h" })).error).not.toBeNull();
    expect((await db.rpc("create_enrollment", { p_admin: zero, p_machine: zero, p_token_hash: "\\x00", p_ttl_seconds: 600 })).error).not.toBeNull();
  });

  it("3. đăng ký/đăng nhập thật 4 tài khoản test, tự tạo profile, đăng xuất rồi đăng nhập lại", async () => {
    requires("configured", "autoconfirm");
    for (const role of ROLES) {
      const { email, password } = ensureCreds(role);
      const raw = client();
      raws[role] = raw;
      const api = createLiveApi(raw as unknown as Db);
      try {
        await api.auth.signIn(email, password);
      } catch {
        const r = await api.auth.signUp(email, password, `Smoke ${role}`);
        expect(r.confirmed, `${role}: đăng ký xong nhưng chưa có phiên (còn bật xác nhận email?)`).toBe(true);
      }
      const acc = await api.account();
      expect(acc.email).toBe(email);
      users[role] = { api, id: acc.userId };
    }
    // Phiên thật: đăng xuất rồi đăng nhập lại bằng mật khẩu
    const c = ensureCreds("renter");
    await users.renter.api.auth.signOut();
    await expect(users.renter.api.account()).rejects.toMatchObject({ code: "auth" });
    await users.renter.api.auth.signIn(c.email, c.password);
    expect((await users.renter.api.account()).email).toBe(c.email);
    state.accounts = true;
  });

  it("4. điều kiện cần SQL Editor: role admin + ví thử cho 2 renter (client không có đường tự cấp)", async () => {
    requires("accounts");
    const { data: roles, error } = await rawDb("admin").from("user_roles").select("role");
    expect(error?.message ?? "").toBe("");
    const needAdmin = !(roles ?? []).some((r) => (r as { role: string }).role === "admin");
    const needWallet: Role[] = [];
    for (const r of ["renter", "renter2"] as const) {
      const { data } = await rawDb(r).from("wallet_links").select("address");
      if (!(data ?? []).length) needWallet.push(r);
    }
    const addr = (n: number) => "0x" + (0xd3ad00 + n).toString(16).padStart(40, "0");
    const stmts = [
      needAdmin ? `insert into public.user_roles (user_id, role) values ('${users.admin.id}', 'admin') on conflict do nothing;` : "",
      ...needWallet.map((r) => `insert into public.wallet_links (user_id, address, chain_id) values ('${users[r].id}', '${addr(r === "renter" ? 1 : 2)}', 43113) on conflict do nothing;`),
    ].filter(Boolean);
    if (stmts.length) {
      throw new Error(
        `CHƯA ĐẠT — cần chạy ${stmts.length} câu SQL trong SQL Editor (DEV; địa chỉ ví là GIẢ để thử đặt máy, KHÔNG phải ví đã xác minh), rồi chạy lại smoke test:\n${stmts.join("\n")}`,
      );
    }
    state.sql = true;
  });

  it("5. host: tự đăng ký là được ngay (KHÔNG admin); đăng máy, cam kết, lịch, rồi đăng máy công khai không cần admin duyệt", async () => {
    requires("accounts", "sql");
    const { host } = users;
    if ((await host.api.account()).hostApproval === "none") await host.api.host.apply();
    // Đỏ ở đây nghĩa là Supabase dev chưa áp migration 20261120000001_self_service_listing.sql (host mới còn "pending").
    expect((await host.api.account()).hostApproval, "áp supabase/migrations/20261120000001_self_service_listing.sql trong SQL Editor").toBe("approved");

    priceUnits = "12345678901234567890"; // > 2^53 trong đơn vị nhỏ nhất: kiểm không mất chính xác
    machineId = await host.api.host.createMachine({ name: `smoke-${run}`, pricePcp: formatUnits(priceUnits), specs: { cpu: "Smoke CPU", cores: 4, ramGb: 8, categories: ["dev"], location: "Smoke", summary: "Máy test tự động" } });
    await host.api.host.addCommitment(machineId, new Date(Date.now() - 3_600_000), new Date(Date.now() + 5 * 3_600_000));
    await host.api.host.addRule(machineId, 0, 19 * 60, 23 * 60);
    await expect(host.api.host.addRule(machineId, 0, 20 * 60, 22 * 60)).rejects.toMatchObject({ code: "rejected" }); // chồng lấn
    await expect(host.api.host.addRule(machineId, 1, 19 * 60 + 5, 23 * 60)).rejects.toBeDefined(); // không bội 15 phút
    expect((await host.api.host.listRules(machineId)).length).toBe(1);
    await host.api.host.setAccepting(machineId, true);
    expect(await host.api.host.getAccepting(machineId)).toBe(true);
    expect(await host.api.host.health(machineId)).toBe("unknown"); // chưa có agent thật

    expect((await anon().catalog.list()).some((m) => m.id === machineId)).toBe(false); // nháp: chưa công khai
    expect(await host.api.host.publishMachine(machineId)).toBe("approved"); // không cần admin
    await expect(host.api.admin.reviewMachine(machineId, "suspended")).rejects.toMatchObject({ code: "rejected" }); // host vẫn không có quyền admin (đình chỉ máy)
    expect((await anon().catalog.list()).some((m) => m.id === machineId)).toBe(true);
  });

  it("6. danh mục công khai thấy máy đã duyệt, giá chính xác tuyệt đối, không lộ chủ máy", async () => {
    requires("accounts", "sql");
    expect(machineId, "test 5 chưa tạo được máy").not.toBe("");
    const got = await anon().catalog.get(machineId);
    expect(got).not.toBeNull();
    expect(got!.priceUnits).toBe(priceUnits);
    expect(got!.machine.state).toBe("unverified");
    expect(got!.machine.name).toBe(`smoke-${run}`);
    expect(JSON.stringify(got)).not.toContain("owner");
  });

  it("7. renter giữ máy thật; thử lại cùng khóa trả cùng booking; renter khác bị từ chối", async () => {
    requires("accounts", "sql");
    expect(machineId, "test 5 chưa tạo được máy").not.toBe("");
    const key = `rsv-smoke-${run}-a`;
    const b = await users.renter.api.bookings.reserve(machineId, key, "none");
    expect(b).toMatchObject({ state: "reserved", accessState: "not_granted", priceUnits, feeBps: 1000, durationSeconds: 900, workspaceMode: "none" });
    expect(new Date(b.fundBy).getTime()).toBeGreaterThan(Date.now());
    console.log(`[smoke] booking ${b.id.slice(0, 8)} state=${b.state}/${b.accessState}`);
    const again = await users.renter.api.bookings.reserve(machineId, key, "none");
    expect(again.id).toBe(b.id); // replay idempotent
    await expect(users.renter.api.bookings.reserve(machineId, key, "project")).rejects.toMatchObject({ code: "rejected" }); // cùng khóa, khác nội dung
    await expect(users.renter2.api.bookings.reserve(machineId, `rsv-smoke-${run}-b`, "none")).rejects.toMatchObject({ code: "rejected", message: expect.stringMatching(/không thể giữ/) });
    expect((await users.renter.api.bookings.listMine()).map((x) => x.id)).toContain(b.id);
    expect((await users.renter2.api.bookings.listMine()).map((x) => x.id)).not.toContain(b.id);
  });

  it("8. host không tự thuê máy mình; không phá cam kết đang bảo đảm booking; renter không đọc/ghi booking người khác; không tự cấp admin", async () => {
    requires("accounts", "sql");
    expect(machineId, "test 5 chưa tạo được máy").not.toBe("");
    await expect(users.host.api.bookings.reserve(machineId, `rsv-smoke-${run}-h`, "none")).rejects.toMatchObject({ code: "rejected" });
    const commitments = await users.host.api.host.listCommitments(machineId);
    const del = await rawDb("host").from("host_commitments").delete().eq("id", commitments[0]!.id);
    expect(del.error?.message ?? "", "host xóa được cam kết đang bảo đảm booking").toMatch(/commitment_in_use/);
    const stolen = await rawDb("renter2").from("bookings").select("id").eq("machine_id", machineId);
    expect(stolen.data ?? []).toHaveLength(0);
    const tamper = await rawDb("renter").from("bookings").update({ state: "settled" }).eq("machine_id", machineId).select();
    expect(tamper.error !== null || (tamper.data ?? []).length === 0, "renter sửa được trạng thái tiền của booking").toBe(true);
    const roleEsc = await rawDb("renter").from("user_roles").insert({ user_id: users.renter.id, role: "admin" });
    expect(roleEsc.error, "client tự cấp role admin").not.toBeNull();
  });
});


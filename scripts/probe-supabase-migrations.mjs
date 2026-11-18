#!/usr/bin/env node
/**
 * Thăm dò CHỈ ĐỌC (không DDL, không xoá, không tạo dữ liệu có chủ đích) xem migration 000003–000005 đã áp dụng chưa,
 * chỉ dùng anon key + đăng nhập một tài khoản smoke có sẵn (không đăng ký mới). Không in URL/key/mật khẩu/token.
 *
 * Nguyên tắc đọc kết quả: "có lỗi" KHÔNG chứng minh gì. Chỉ mã lỗi mới có nghĩa:
 *   42501                        → đối tượng TỒN TẠI và client bị chặn (đúng thiết kế)  → PASS
 *   PGRST205 / PGRST202 / 42P01  → bảng/hàm KHÔNG tồn tại hoặc cache schema của PostgREST cũ → FAIL
 *      (nếu migration đã chạy: SQL Editor → `NOTIFY pgrst, 'reload schema';` rồi chạy lại)
 * Đối số RPC đúng tên/kiểu: sai kiểu cũng ra PGRST202 và dễ bị hiểu nhầm là "thiếu hàm".
 * Ghi chú: nếu một hàm lại KHÔNG bị chặn (lỗi cấp quyền), lời gọi dùng tham số vô hại (uuid 0, tên 'probe:*') nhưng
 * `enqueue_job` có thể tạo một job loại 'probe' — chính điều đó là phát hiện nghiêm trọng, không phải kết quả mong muốn.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parse = (f) =>
  existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")])) : {};
const env = parse(path.join(root, "desktop/.env.local"));
const smoke = parse(path.join(root, "desktop/.env.smoke.local"));
const URL_ = (env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = env.VITE_SUPABASE_ANON_KEY ?? "";
if (!URL_ || !KEY) { console.error("Thiếu cấu hình desktop/.env.local (chạy npm run check:env)."); process.exit(2); }

const Z = "00000000-0000-0000-0000-000000000000";
const results = [];
const note = (ok, name, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const MISSING = new Set(["PGRST205", "PGRST202", "42P01", "42883"]);

async function rest(method, p, token, body) {
  const r = await fetch(`${URL_}/rest/v1${p}`, { method, headers: { apikey: KEY, authorization: `Bearer ${token ?? KEY}`, "content-type": "application/json", prefer: "return=minimal" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, code: j?.code ?? null, msg: String(j?.message ?? "").slice(0, 90), body: j };
}
const verdict = (r, role) => {
  if (r.code === "42501") return { ok: true, d: `tồn tại, ${role} bị chặn (42501)` };
  if (MISSING.has(r.code) || /schema cache/i.test(r.msg)) return { ok: false, d: `KHÔNG thấy (${r.code}) — chưa áp dụng hoặc cache schema cũ (NOTIFY pgrst, 'reload schema')` };
  if (r.status < 300) return { ok: false, d: `${role} ĐỌC/GỌI ĐƯỢC (HTTP ${r.status}) — lỗi cấp quyền!` };
  return { ok: false, d: `mã không mong đợi: HTTP ${r.status} ${r.code ?? ""} ${r.msg}` };
};

// ---- đăng nhập một tài khoản smoke có sẵn (không đăng ký mới) ----
let token = null;
let userId = null;
if (smoke.SMOKE_RENTER_EMAIL && smoke.SMOKE_RENTER_PASSWORD) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: smoke.SMOKE_RENTER_EMAIL, password: smoke.SMOKE_RENTER_PASSWORD }) });
  if (r.ok) { const j = await r.json(); token = j.access_token; userId = j.user?.id; }
}
note(!!token, "Đăng nhập tài khoản smoke renter có sẵn (cho thăm dò quyền authenticated)", token ? "" : "không đăng nhập được — chỉ thăm dò anon");

// ---- 1. Bảng nhạy cảm: anon VÀ authenticated phải bị chặn bằng 42501 (session_grants trước: chứa redeem_token) ----
const SENSITIVE = ["session_grants", "chain_events", "agent_commands", "workspace_leases", "workspace_objects", "outbox_jobs", "device_enrollments"];
for (const t of SENSITIVE) {
  for (const [role, tk] of [["anon", null], ["authenticated", token]]) {
    if (role === "authenticated" && !tk) continue;
    const v = verdict(await rest("GET", `/${t}?select=*&limit=1`, tk), role);
    note(v.ok, `Bảng ${t} (${role})`, v.d);
  }
}

// ---- 2. Hàm chỉ service_role: đối số ĐÚNG tên/kiểu; kỳ vọng 42501 ----
const FN = {
  apply_chain_event: { p_chain_id: 1, p_contract: "0x" + "0".repeat(40), p_tx_hash: "0x" + "0".repeat(64), p_log_index: 0, p_block_number: 1, p_block_hash: "0x" + "0".repeat(64), p_event: "Funded", p_booking_chain_id: "\\x" + "00".repeat(32), p_data: {} },
  claim_jobs: { p_worker: "probe", p_limit: 1, p_lease_seconds: 5 },
  enqueue_job: { p_action_key: "probe:denied", p_job_type: "probe", p_payload: {}, p_delay_seconds: 0 },
  complete_job: { p_id: 0, p_worker: "probe", p_attempt: 1, p_result: {} },
  fail_job: { p_id: 0, p_worker: "probe", p_attempt: 1, p_error: "probe", p_retry: false },
  enqueue_expiry_jobs: {},
  grant_claim: { p_booking: Z, p_user: Z },
  grant_store: { p_booking: Z, p_gateway_url: "http://probe.invalid", p_token: "probe", p_ttl_seconds: 60 },
  agent_poll: { p_credential_hash: "\\x" + "00".repeat(32), p_limit: 1, p_lease_seconds: 5 },
  agent_report: { p_credential_hash: "\\x" + "00".repeat(32), p_command_id: 0, p_ok: false, p_unknown: false, p_result: {} },
  agent_enqueue_command: { p_booking: Z, p_base_action: "probe", p_command: "prepare", p_payload: {} },
  agent_command_state: { p_id: 0 },
  ws_create: { p_owner: Z, p_name: "probe" },
  ws_acquire_lease: { p_workspace: Z, p_user: Z, p_booking: Z, p_token_hash: "\\x" + "00".repeat(32), p_ttl_seconds: 60 },
  ws_check_lease: { p_workspace: Z, p_token_hash: "\\x" + "00".repeat(32) },
  ws_register_object: { p_workspace: Z, p_token_hash: "\\x" + "00".repeat(32), p_sha: "0".repeat(64), p_size: 1 },
  ws_commit: { p_workspace: Z, p_token_hash: "\\x" + "00".repeat(32), p_expected_version: 0, p_manifest: { files: [] }, p_manifest_sha: "0".repeat(64) },
  ws_release_lease: { p_workspace: Z, p_token_hash: "\\x" + "00".repeat(32) },
  ws_release_for_booking: { p_booking: Z },
  ws_gc: { p_workspace: Z, p_keep_versions: 1 },
  ws_delete: { p_workspace: Z, p_owner: Z },
};
for (const [fn, args] of Object.entries(FN)) {
  for (const [role, tk] of [["anon", null], ["authenticated", token]]) {
    if (role === "authenticated" && !tk) continue;
    const v = verdict(await rest("POST", `/rpc/${fn}`, tk, args), role);
    note(v.ok, `Hàm ${fn} (${role})`, v.d);
  }
}

// ---- 3. Bằng chứng tồn tại ở phía DƯƠNG (authenticated): cột mới của bookings, bảng owner-đọc ----
if (token) {
  const cols = await rest("GET", `/bookings?select=id,started_at,end_at&limit=1`, token);
  note(cols.status === 200 && Array.isArray(cols.body), "bookings.started_at / end_at (000003) đọc được", cols.status === 200 ? "" : `${cols.status} ${cols.code} ${cols.msg}`);
  for (const t of ["workspaces", "workspace_versions"]) {
    const r = await rest("GET", `/${t}?select=*&limit=1`, token);
    note(r.status === 200 && Array.isArray(r.body), `Bảng ${t} (000004) đọc được qua RLS owner`, r.status === 200 ? `${r.body.length} dòng của riêng tài khoản` : `${r.status} ${r.code} ${r.msg}`);
  }
  const wl = await rest("GET", `/workspaces?select=id&owner_id=neq.${userId}&limit=1`, token);
  note(wl.status === 200 && wl.body.length === 0, "RLS workspaces: không thấy workspace của người khác", `${wl.status === 200 ? wl.body.length : wl.status} dòng`);
  const w = await rest("POST", "/workspaces", token, { owner_id: userId, name: "probe" });
  note(w.code === "42501", "Client không tự INSERT workspaces", w.code === "42501" ? "42501" : `HTTP ${w.status} ${w.code}`);
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} đạt${failed ? ` — ${failed} FAIL: dán nguyên đầu ra này (không có secret) để xử lý` : ""}.`);
if (failed) console.log("Nếu FAIL là PGRST205/PGRST202: SQL Editor → NOTIFY pgrst, 'reload schema'; rồi chạy lại. Kết luận cuối cùng vẫn phải dựa vào supabase/verify/post_migration_checks.sql.");
process.exit(failed ? 1 : 0);

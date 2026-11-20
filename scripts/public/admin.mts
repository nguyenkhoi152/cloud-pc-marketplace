/**
 * Công cụ của NGƯỜI TỔ CHỨC (admin) cho đợt thử với người khác. Chạy trên máy tổ chức; KHÔNG có trong app của người thử.
 *   npx tsx scripts/public/admin.mts pending                              Host đang chờ duyệt + máy đang chờ duyệt (id, tên hiển thị)
 *   npx tsx scripts/public/admin.mts approve-host <userId>                Duyệt host
 *   npx tsx scripts/public/admin.mts approve-machine <machineId>          Duyệt máy
 *   npx tsx scripts/public/admin.mts machine <machineId>                  Chỉ đọc: máy, cam kết giờ, booking gần nhất (vì sao máy "unavailable")
 *   npx tsx scripts/public/admin.mts enroll <machineId> <tệp ghi mã> [apiBase] [ttl giây]
 *                                                                         Thu hồi thiết bị cũ của máy và cấp MÃ GHI DANH một lần (ghi vào tệp, KHÔNG in)
 * Dùng tài khoản admin của dev (desktop/.env.smoke.local: SMOKE_ADMIN_EMAIL/SMOKE_ADMIN_PASSWORD). Không in mật khẩu, token hay mã ghi danh.
 * Ghi vào Supabase dev: review_host / review_machine (RPC có kiểm quyền admin + audit_logs), device_enrollments.
 * Gửi mã ghi danh cho tester qua kênh riêng (mã dùng một lần, hết hạn nhanh); xoá tệp mã sau khi gửi.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [cmd, a1, a2, apiBaseArg, ttlArg] = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const parse = (f: string): Record<string, string> =>
  existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")])) : {}; // bỏ chú thích cùng dòng như các script khác
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const usage = () => { console.log("Dùng: pending | find <tên> | approve-host-wait <userId> [phút] | suspend-machine <machineId> | approve-host <userId> | approve-machine <machineId> | enroll <machineId> <tệp ghi mã> [apiBase] [ttl giây]"); process.exit(1); };
if (!cmd) usage();

const desk = parse(path.join(root, "desktop/.env.local"));
const smoke = parse(path.join(root, "desktop/.env.smoke.local"));
const SU = (desk.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = desk.VITE_SUPABASE_ANON_KEY ?? "";
if (!SU || !KEY || !smoke.SMOKE_ADMIN_EMAIL || !smoke.SMOKE_ADMIN_PASSWORD) throw new Error("Thiếu cấu hình Supabase dev hoặc tài khoản admin smoke (desktop/.env.local, desktop/.env.smoke.local)");

async function jf(url: string, init: RequestInit, tries = 4): Promise<{ status: number; j: any }> {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url, init); return { status: r.status, j: await r.json().catch(() => null) }; }
    catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 3000 * i)); }
  }
}
const lg = await jf(`${SU}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: smoke.SMOKE_ADMIN_EMAIL, password: smoke.SMOKE_ADMIN_PASSWORD }) });
if (!lg.j?.access_token) throw new Error(`Đăng nhập admin thất bại (HTTP ${lg.status}${lg.j?.error_code ? ` ${lg.j.error_code}` : ""}${lg.j?.msg || lg.j?.message || lg.j?.error_description ? `: ${String(lg.j.msg ?? lg.j.message ?? lg.j.error_description).replace(/eyJ[\w.-]{20,}/g, "[jwt]").slice(0, 120)}` : ""})`);
const auth = { apikey: KEY, authorization: `Bearer ${lg.j.access_token}`, "content-type": "application/json" };
const rest = (p: string) => jf(`${SU}/rest/v1/${p}`, { headers: auth });

if (cmd === "find") {
  // Chỉ đọc: tìm hồ sơ theo tên hiển thị (không phân biệt hoa thường), kèm trạng thái host và các máy của họ. Dùng khi tài khoản chưa lọt vào danh sách chờ duyệt.
  const q = (a1 ?? "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim();
  if (q.length < 2) usage();
  const ps = await rest(`profiles?select=user_id,display_name,created_at&display_name=ilike.*${encodeURIComponent(q)}*&order=created_at.desc&limit=10`);
  if (ps.status !== 200) throw new Error(`Không đọc được hồ sơ (HTTP ${ps.status})`);
  console.log(`Hồ sơ khớp "${q}": ${(ps.j as any[]).length}`);
  for (const p of ps.j as any[]) {
    const hp = await rest(`host_profiles?select=status&user_id=eq.${p.user_id}`);
    const ms = await rest(`machines?select=id,name,status&owner_id=eq.${p.user_id}`);
    console.log(`  ${p.user_id}  "${p.display_name}"  (đăng ký ${p.created_at})`);
    console.log(`    host: ${(hp.j as any[])?.[0]?.status ?? "chưa vào chế độ Cho thuê máy (không có hồ sơ host)"}`);
    for (const m of (ms.j as any[]) ?? []) console.log(`    máy: ${m.id}  "${m.name}"  trạng thái ${m.status}`);
  }
} else if (cmd === "pending") {
  const hosts = await rest("host_profiles?select=user_id,status,created_at&status=eq.pending&order=created_at.asc");
  const machines = await rest("machines?select=id,name,owner_id,status,created_at&status=eq.review&order=created_at.asc");
  if (hosts.status !== 200 || machines.status !== 200) throw new Error(`Không đọc được danh sách (HTTP ${hosts.status}/${machines.status}): tài khoản admin có quyền admin không?`);
  const ids = [...new Set([...(hosts.j as any[]).map((h) => h.user_id), ...(machines.j as any[]).map((m) => m.owner_id)])];
  const names = ids.length ? await rest(`profiles?select=user_id,display_name&user_id=in.(${ids.join(",")})`) : { j: [] as any[] };
  const nameOf = (id: string) => (names.j as any[])?.find((p) => p.user_id === id)?.display_name ?? "(không rõ)";
  console.log(`Host chờ duyệt: ${hosts.j.length}`);
  for (const h of hosts.j as any[]) console.log(`  ${h.user_id}  ${nameOf(h.user_id)}  (đăng ký ${h.created_at})`);
  console.log(`Máy chờ duyệt: ${machines.j.length}`);
  for (const m of machines.j as any[]) console.log(`  ${m.id}  "${m.name}"  chủ: ${nameOf(m.owner_id)} (${m.owner_id})`);
} else if (cmd === "approve-host-wait") {
  // Chờ tới khi ĐÚNG tài khoản <userId> có hồ sơ host đang chờ duyệt (người dùng chọn "Cho thuê máy" trong app), rồi duyệt đúng tài khoản đó. Chỉ một tài khoản, có hạn giờ.
  if (!a1 || !UUID.test(a1)) usage();
  const minutes = Math.min(30, Math.max(1, Number(a2 ?? "15") || 15));
  const end = Date.now() + minutes * 60_000;
  console.log(`Chờ tối đa ${minutes} phút cho tới khi ${a1} có hồ sơ host, rồi duyệt đúng tài khoản này.`);
  for (;;) {
    const hp = await rest(`host_profiles?select=status&user_id=eq.${a1}`);
    const st = (hp.j as any[])?.[0]?.status;
    if (st === "approved") { console.log("Host đã được duyệt sẵn."); break; }
    if (st === "suspended") throw new Error("Host đang bị đình chỉ: không tự duyệt.");
    if (st === "pending") {
      const r = await jf(`${SU}/rest/v1/rpc/review_host`, { method: "POST", headers: auth, body: JSON.stringify({ p_user: a1, p_status: "approved" }) });
      if (r.status >= 300) throw new Error(`Duyệt thất bại (HTTP ${r.status}${r.j?.message ? `: ${String(r.j.message).slice(0, 80)}` : ""})`);
      console.log(`Đã duyệt host ${a1}.`);
      break;
    }
    if (Date.now() > end) { console.log("Hết thời gian chờ: tài khoản chưa vào chế độ Cho thuê máy (chưa có hồ sơ host)."); process.exit(2); }
    await new Promise((r) => setTimeout(r, 10_000));
  }
} else if (cmd === "approve-host" || cmd === "approve-machine") {
  if (!a1 || !UUID.test(a1)) usage();
  const host = cmd === "approve-host";
  const r = await jf(`${SU}/rest/v1/rpc/${host ? "review_host" : "review_machine"}`, { method: "POST", headers: auth, body: JSON.stringify(host ? { p_user: a1, p_status: "approved" } : { p_machine: a1, p_status: "approved" }) });
  if (r.status >= 300) throw new Error(`Duyệt thất bại (HTTP ${r.status}${r.j?.message ? `: ${String(r.j.message).slice(0, 80)}` : ""})`);
  console.log(`đã duyệt ${host ? "host" : "máy"} ${a1}`);
} else if (cmd === "suspend-machine") {
  // Đình chỉ một máy: không ai giữ được máy đó nữa (booking đang chạy không bị ảnh hưởng). Duyệt lại bằng approve-machine.
  if (!a1 || !UUID.test(a1)) usage();
  const r = await jf(`${SU}/rest/v1/rpc/review_machine`, { method: "POST", headers: auth, body: JSON.stringify({ p_machine: a1, p_status: "suspended" }) });
  if (r.status >= 300) throw new Error(`Đình chỉ máy thất bại (HTTP ${r.status}${r.j?.message ? `: ${String(r.j.message).slice(0, 80)}` : ""})`);
  console.log(`đã đình chỉ máy ${a1} (không ai giữ được máy này nữa; duyệt lại bằng approve-machine)`);
} else if (cmd === "machine") {
  // Chỉ đọc: vì sao máy "unavailable"? In máy, cam kết giờ của host và các booking gần nhất (live = còn chiếm máy theo booking_is_live).
  if (!a1 || !UUID.test(a1)) usage();
  const m = await rest(`machines?select=id,name,status,active_booking_id,owner_id&id=eq.${a1}`);
  const hc = await rest(`host_commitments?select=starts_at,ends_at&machine_id=eq.${a1}&order=ends_at.desc&limit=3`);
  const bk = await rest(`bookings?select=id,state,access_state,created_at&machine_id=eq.${a1}&order=created_at.desc&limit=8`);
  if (m.status !== 200 || !(m.j as any[])[0]) throw new Error(`Không thấy máy ${a1} (HTTP ${m.status})`);
  const mm = (m.j as any[])[0];
  const own = await rest(`profiles?select=display_name&user_id=eq.${mm.owner_id}`);
  console.log(`Máy "${mm.name}" · trạng thái ${mm.status} · active_booking_id ${mm.active_booking_id ?? "(trống)"}`);
  console.log(`Chủ máy (tài khoản HOST phải đăng nhập): tên hiển thị "${(own.j as any[])?.[0]?.display_name ?? "(không rõ)"}", mã ${mm.owner_id}`);
  // Heartbeat THẬT của thiết bị (nhãn "Chưa xác minh online" trong danh sách người thuê là nhãn cố định, không phản ánh cái này).
  const hl = await jf(`${SU}/rest/v1/rpc/my_machine_health`, { method: "POST", headers: auth, body: JSON.stringify({ p_machine: a1 }) });
  const hv = typeof hl.j === "string" ? hl.j : "";
  console.log(`Heartbeat của agent: ${hv === "ok" ? "ỔN (agent đang báo về trong 30 giây)" : hv === "suspect" ? "chậm (quá 30 giây)" : hv === "incident" ? "mất (quá 90 giây)" : hv === "unknown" ? "chưa có heartbeat nào" : `không đọc được (HTTP ${hl.status})`}`);
  console.log(`Cam kết giờ của host (${hc.status === 200 ? "đọc được" : `HTTP ${hc.status}`}):`);
  for (const c of (hc.j as any[]) ?? []) console.log(`  ${c.starts_at} → ${c.ends_at}`);
  const live = (b: any) => !(["settled", "refunded", "resolved", "cancelled", "expired"].includes(b.state) && ["not_granted", "reset_verified"].includes(b.access_state));
  console.log(`Booking gần nhất (${(bk.j as any[]).length}):`);
  for (const b of bk.j as any[]) console.log(`  ${b.id.slice(0, 8)}…  ${b.state.padEnd(10)} access=${b.access_state.padEnd(14)} ${b.created_at}  ${live(b) ? "← LIVE (đang chiếm máy)" : ""}`);
} else if (cmd === "enroll") {
  if (!a1 || !UUID.test(a1) || !a2) usage();
  const apiBase = apiBaseArg ?? "http://127.0.0.1:3000/api";
  if (!/^(https:\/\/[^/\s]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)(\/[^\s]*)?$/.test(apiBase)) throw new Error("apiBase không hợp lệ");
  const ttl = Number(ttlArg ?? "900");
  const h = { authorization: auth.authorization, "content-type": "application/json" };
  const rv = await jf(`${apiBase}/admin/devices/revoke`, { method: "POST", headers: h, body: JSON.stringify({ machineId: a1 }) });
  if (rv.status !== 200) throw new Error(`Thu hồi thiết bị cũ thất bại (HTTP ${rv.status} ${rv.j?.error?.code ?? ""}); API đang chạy ở ${apiBase}?`);
  const en = await jf(`${apiBase}/admin/enrollments`, { method: "POST", headers: h, body: JSON.stringify({ machineId: a1, ttlSeconds: ttl }) });
  if (en.status !== 201 || !en.j?.enrollmentToken) throw new Error(`Tạo mã ghi danh thất bại (HTTP ${en.status} ${en.j?.error?.code ?? ""})`);
  mkdirSync(path.dirname(path.resolve(a2)), { recursive: true });
  writeFileSync(a2, en.j.enrollmentToken + "\n", { mode: 0o600 });
  console.log(`đã ghi mã ghi danh (một lần, hết hạn sau ${Math.round(ttl / 60)} phút) vào ${a2}; không in mã ra đây`);
} else usage();

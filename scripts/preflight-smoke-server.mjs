#!/usr/bin/env node
/**
 * Kiểm tra TRƯỚC khi chạy `npm run smoke:server -w @cpm/server`. CHỈ ĐỌC, không tạo dữ liệu có chủ đích:
 *   1. web/.env.local có đủ tên biến cần cho smoke:server (không in giá trị).
 *   2. Booking `reserved` còn hạn của renter smoke (test 5 cần ≥1; mỗi booking giữ máy chỉ 10 phút).
 * Dùng anon key (desktop/.env.local) + đăng nhập tài khoản smoke renter có sẵn; không đăng ký tài khoản mới.
 * Không in URL, key, mật khẩu, token hay chuỗi kết nối. In danh sách dữ liệu mà smoke:server sẽ ghi.
 *
 * Chạy: node scripts/preflight-smoke-server.mjs
 * Mã thoát: 0 = sẵn sàng; 1 = thiếu điều kiện (nói rõ điều kiện nào).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parse = (f) =>
  existsSync(f)
    ? Object.fromEntries(
        readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
          .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")]),
      )
    : {};

const desktop = parse(path.join(root, "desktop/.env.local"));
const smoke = parse(path.join(root, "desktop/.env.smoke.local"));
const server = parse(path.join(root, "web/.env.local"));
const URL_ = (desktop.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = desktop.VITE_SUPABASE_ANON_KEY ?? "";

let blockers = 0;
const line = (ok, msg) => { if (!ok) blockers++; console.log(`${ok ? "OK  " : "THIẾU"}  ${msg}`); };

console.log("Điều kiện chạy smoke:server (chỉ đọc, không in giá trị):\n");

const hasServerFile = existsSync(path.join(root, "web/.env.local"));
line(hasServerFile, "web/.env.local tồn tại" + (hasServerFile ? "" : " — tạo từ web/.env.example; chuỗi kết nối DB chỉ điền ở máy bạn, KHÔNG gửi qua chat"));
for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_DB_URL"]) line(!!server[k], `web/.env.local: ${k} ${server[k] ? "có giá trị" : "trống/chưa có"}`);
if (server.SUPABASE_URL && URL_ && server.SUPABASE_URL.replace(/\/+$/, "") !== URL_) line(false, "SUPABASE_URL của web và desktop trỏ hai project khác nhau");
for (const k of ["SMOKE_RENTER_EMAIL", "SMOKE_HOST_EMAIL", "SMOKE_ADMIN_EMAIL"]) line(!!smoke[k], `desktop/.env.smoke.local: ${k} ${smoke[k] ? "có" : "chưa có (chạy smoke:supabase để tạo)"}`);

let reservedLive = null;
if (URL_ && KEY && smoke.SMOKE_RENTER_EMAIL && smoke.SMOKE_RENTER_PASSWORD) {
  try {
    const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: smoke.SMOKE_RENTER_EMAIL, password: smoke.SMOKE_RENTER_PASSWORD }),
    });
    if (!r.ok) {
      line(false, `Đăng nhập renter smoke thất bại (HTTP ${r.status})`);
    } else {
      const { access_token: token } = await r.json();
      const b = await fetch(`${URL_}/rest/v1/bookings?select=id,state,fund_by&state=eq.reserved&order=created_at.desc&limit=200`, {
        headers: { apikey: KEY, authorization: `Bearer ${token}` },
      });
      if (!b.ok) {
        line(false, `Đọc bookings của renter thất bại (HTTP ${b.status})`);
      } else {
        const rows = await b.json();
        const horizon = Date.now() + 30_000;
        reservedLive = rows.filter((x) => Date.parse(x.fund_by) > horizon).length;
        console.log(`INFO   Booking reserved của renter smoke: ${rows.length} (còn hạn ≥30 giây: ${reservedLive})`);
      }
    }
  } catch {
    line(false, "Không kết nối được Supabase để kiểm booking (lỗi mạng)");
  }
}

console.log(`
smoke:server GHI vào Supabase dev (không chuỗi khối, không tạo tài khoản mới, không xoá/reset):
  • wallet_challenges: +1 dòng cho host (test 3; thử chữ ký sai rồi chữ ký đúng, sau đó thử dùng lại nonce) và +1 dòng cho renter (test 4, không được tiêu thụ). Mỗi lần chạy lại thêm 2 dòng nữa (giới hạn 8 challenge/10 phút/người dùng).
  • wallet_links: host được liên kết với ví thử MỚI sinh cục bộ (khoá lưu thêm vào desktop/.env.smoke.local; file bị Git bỏ qua; chạy lại dùng cùng khoá). Nếu host đã có ví khác thì bị chặn khi còn booking chưa kết thúc.
  • audit_logs: dòng cho issue_quote, create_enrollment, redeem_enrollment, revoke_device (có thể thêm dòng từ đổi ví)
  • device_enrollments: +1 dòng, đổi một lần rồi thu hồi (revoked_at); thiết bị heartbeat 1 lần
  • workspaces: +1 dòng "smoke-workspace" cho renter NẾU renter chưa có workspace nào
  • KHÔNG tạo máy, KHÔNG tạo booking, KHÔNG gửi giao dịch chuỗi khối.
  • Test 6 chọn BẤT KỲ máy đã duyệt có booking reserved (không lọc theo tài khoản smoke).
`);

if (reservedLive === 0) console.log("Lưu ý: test 5 sẽ ĐỎ (không có booking reserved còn hạn). Chọn: (A) chạy smoke:server luôn, chấp nhận test 5 đỏ, không phát sinh máy/booking; (B) chạy `npm run smoke:supabase` ngay trước đó (tạo thêm 1 máy smoke + 1 booking reserved 10 phút, giữ máy tới khi có đối soát chuỗi).\n");
console.log(blockers ? `Chưa sẵn sàng: ${blockers} điều kiện còn thiếu.` : "Sẵn sàng chạy smoke:server.");
process.exit(blockers ? 1 : 0);

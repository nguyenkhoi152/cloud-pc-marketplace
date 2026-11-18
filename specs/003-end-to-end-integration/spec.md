# Đặc tả: Tích hợp end-to-end Cloud PC Companion

**Feature**: `003-end-to-end-integration` · **Ngày**: 08/11/2026 · **Trạng thái**: Đang triển khai theo mốc
**Nguồn**: `docs/END_TO_END_HANDOFF.md` (chỉ dẫn trực tiếp mới nhất, ưu tiên hơn mô tả web/Sunshine/Moonlight cũ). Không ghi đè `002-desktop-companion-ui` (UI đã duyệt làm nền).
**Phạm vi code**: `desktop/` (nối dữ liệu thật qua adapter), `desktop/src-tauri/` (vỏ native), `host-agent/`, `worker/`, `supabase/migrations/`, `web/` (API), `packages/shared`. Không viết lại UI, không scaffold lại M1–M3.

## Mục tiêu

Một app Windows, một tài khoản, hai chế độ. Renter chọn máy → xác nhận → kết nối → kết thúc trong app. Host kiểm tra máy → đồng ý thành phần/quyền → đặt tài nguyên/giá/lịch → gửi duyệt → nhận thuê. Web chủ yếu giới thiệu/tải app. Đích cuối: một vòng thuê thật trên hai máy (đăng máy → thuê → stream → kết thúc/revoke/cleanup).

## Quyết định kiến trúc (đảo ngược được; lý do ghi ở plan.md)

- **D1 App-first**: nghiệp vụ nằm trong app; `web/` giữ trang giới thiệu/tải app và là nơi chạy route handler API (Next.js) vì đã có sẵn. Luồng web checkout/phiên cũ là bản preview, không phải luồng chính (xem “Migration path”).
- **D2 Streaming = Selkies**, không phải Sunshine/Moonlight. Viewer chạy trong app (WebView2), không mở trình duyệt ngoài. Transport mặc định để thử trước: WebSocket (một cổng TCP, không cần TURN); WebRTC chỉ khi spike cho thấy cần. Không mặc định WebRTC đã hoạt động hay nhanh nhất.
- **D3 Session gateway trong host-agent**: Selkies chỉ lắng nghe nội bộ; renter chỉ đi qua gateway của agent. Gateway kiểm tra grant theo booking (TTL ngắn, băm), có watchdog `endAt` độc lập control plane, và khi revoke thì **đóng mọi kết nối đang mở và chặn reconnect**. Lý do: tài liệu Selkies không nêu cơ chế credential theo phiên/revoke, nên không được dựa vào nó để thu hồi.
- **D4 Host Windows + môi trường Linux (WSL2/Docker)** là giả thuyết cần thử: tài liệu Selkies nêu host Linux; WSL2/Docker Desktop chưa được nêu. Phương án thay thế ghi ở plan.md (Hyper-V Linux VM, máy Linux thử). Không báo đạt trước khi thử trên máy host được chỉ định.
- **D5 Mock là chế độ độc lập**: `VITE_APP_MODE=preview` dùng `mock/service`; `live` dùng API thật và **không bao giờ** fallback sang mock để báo thành công.
- **D6 Tiền giữ nguyên contract**: kết thúc sớm/accept trả cả gói; hủy/hoàn trước activation theo `CONTRACT_SPEC`. Không đổi contract cho khớp mock.

## Bảng đối chiếu thực trạng (kiểm trực tiếp code/migrations/contracts, 08/11/2026)

Ký hiệu hiện trạng: ✅ có + đã test local · 🟡 có một phần · ❌ chưa có · ⛔ chặn bởi đầu vào ngoài.

| # | Màn hình app (002) | API cần | Bảng dữ liệu | Quyền | Trạng thái nghiệp vụ | Hiện trạng | Cách kiểm tra |
|---|---|---|---|---|---|---|---|
| 1 | Đăng nhập/đăng ký/khôi phục | Supabase Auth (client SDK) | auth.users, profiles | anon → authenticated | profile `active/disabled` | 🟡 bảng + RLS ✅ (PGlite); Auth thật ⛔ (cần project Supabase hoặc Docker) | RLS test (có); đăng nhập thật: thủ công khi có Supabase |
| 2 | Chọn chế độ / đổi chế độ | không (UI) | host_profiles | mode không cấp quyền | `hostApproval` do server | ✅ UI+test; server `is_approved_host` ✅ | vitest (có) + RLS test |
| 3 | Khám phá/so sánh/chi tiết | GET /machines, /machines/:id | view `public_machines` | public: chỉ approved | machine `approved` | 🟡 view ✅; route ❌ | route test trên PGlite; thật: thủ công |
| 4 | Lọc/tìm | (lọc client + tham số) | cột khai báo specs | public | — | 🟡 `declared_specs` json; chưa có cột/GIN | test lọc |
| 5 | Xác nhận thuê / giữ máy | POST /bookings (idempotency) | bookings, host_commitments, outbox_jobs | renter từ `auth.uid()`; không tự thuê máy mình | booking `reserved` | 🟡 `reserve_machine` ✅; route ❌; **commitment ≥4h vs lịch UI ≥30 phút (xem Câu hỏi mở Q1)** | db test (có); route test |
| 6 | Ví/PCP, số dư | đọc chain (không DB) | wallet_links, chain_events | ví đã xác minh | balance/locked/credit từ contract | 🟡 challenge ✅; verify chữ ký ❌; `chain_events` ❌ | contract test (có); Fuji ⛔ |
| 7 | Quote + fund | POST /bookings/:id/quote; ký ví phía app | bookings.quote | đúng renter | `funded` chỉ sau receipt confirmed | ✅ contract 47 test; server ký quote ❌ | contract test + local chain |
| 8 | Chuẩn bị phiên | worker → agent `prepare` | remote_sessions ❌, outbox_jobs | worker/service | access `preparing→ready` | ❌ | worker test với provider giả có nhãn; thật ⛔ host |
| 9 | Kích hoạt + vào phiên | POST /bookings/:id/access | remote_sessions, session_grants ❌ | chỉ khi confirmed Funded+Active + guest Ready | access `granted` | ❌ | gateway test (làm ở mốc này) |
| 10 | Viewer (Selkies) | gateway của agent | session_grants | grant theo booking | `granted/revoking/revoked` | ❌ spike ⛔ host | spike trên máy thật |
| 11 | Kết thúc / accept / revoke | POST /bookings/:id/end; contract accept | bookings, audit_logs | renter ký accept; worker revoke | tiền terminal + access `revoked` | 🟡 contract ✅; revoke ❌ | gateway test (đóng kết nối + chặn reconnect) |
| 12 | Cleanup + xác minh | agent `reset`, `verifyReset` | remote_sessions | worker | `reset_verified`; lỗi → máy khóa | 🟡 ràng buộc “một live booking” ✅ | db test (có) + worker test |
| 13 | Workspace / lưu | broker session-scoped | workspaces, workspace_versions ❌ | owner + booking | Saved chỉ khi checkpoint commit | ❌ (M5) | adapter local FS test |
| 14 | Lịch sử / chi tiết phiên | GET /bookings | bookings | renter chỉ của mình | — | 🟡 RLS ✅; route ❌ | route test |
| 15 | Host onboarding (7 bước) | agent cục bộ (kiểm tra máy) ; POST /host/machines | machines, machine_private_config, device_enrollments ❌ | host đã duyệt khi đăng | machine `draft→review→approved` | 🟡 `submit_machine_for_review` ✅; kiểm tra máy/cài thật ⛔ | db test; cài thật cần máy chỉ định + quyền |
| 16 | Tài nguyên/giá/lịch tuần + ngoại lệ | PUT /host/machines/:id/schedule | `host_schedule_rules`, `host_schedule_exceptions`, `host_commitments` | approved owner | cửa sổ UTC từng lần mở (`schedule_windows`) | 🟡 DB ✅ (PGlite); route ❌ | db test: chồng lấn, ngoại lệ, không phá commitment đã phủ booking |
| 17 | Gửi duyệt / chờ / từ chối | POST /host/machines/:id/submit | machines, host_profiles | admin duyệt (`review_machine`) | `review→approved/suspended` | ✅ hàm + test; route ❌ | db test (có) |
| 18 | Dashboard host: nhận/tạm nghỉ | PATCH /host/machines/:id/accepting | `machine_availability`, heartbeat | owner | nhận mới chỉ khi approved ∧ agent sống ∧ trong cửa sổ ∧ không blocked (`can_accept_new`, chưa gắn vào `reserve_machine` — chờ Q1) | 🟡 DB ✅; route ❌ | db test + gateway/agent test |
| 19 | Heartbeat/enrollment | agent → /agent/enroll, /agent/heartbeat | `device_enrollments` | credential riêng, thu hồi được, chống replay | `Suspect 30s / Incident 90s` (`machine_health`) | 🟡 DB ✅ (PGlite); route/agent ❌ | db test replay/expiry/revoke |
| 20 | Thu nhập / sự cố | GET /host/earnings, incidents | bookings, incidents ❌ | host của máy | held tới cleanup OK | ❌ | route test |
| 21 | Chạy nền / dừng cung cấp | agent service (cài thật) | device_enrollments | host đồng ý | đóng UI ≠ dừng ≠ chạy nền | ⛔ cài service cần quyền OS | thủ công trên máy thử |

## Câu hỏi mở (không chặn code, cần chủ dự án chốt)

- **Q1 Cửa sổ lịch tối thiểu**: UI cho khung ≥30 phút; `host_commitments`/REMOTE_ACCESS/MVP yêu cầu ≥4 giờ và phải phủ `fundBy + buffer + gói + recovery`. Mặc định tạm thời trong tích hợp: lịch host (availability) tách khỏi commitment; chỉ nhận booking khi phần còn lại của cửa sổ phủ đủ (đã là logic UI); commitment ≥4h giữ nguyên, **không hạ**. Cần chốt có hạ ngưỡng 4h hay không.
- **Q2 Mạng khác nhau**: P2P/port-forward cần mở router/firewall (không tự làm); relay/tunnel có chi phí băng thông. Cần chọn: thử cùng LAN trước, rồi relay do chủ dự án cung cấp.

- **Q3 Mốc bắt đầu tính giờ (finding khi đối chiếu contract, cần sửa UI khi nối, không sửa contract)**: theo `CONTRACT_SPEC`, `activate` (operator, sau khi guest Ready) đặt `startedAt=block.timestamp`, **trước** khi cấp grant; `cancelBeforeStart` chỉ khi `Funded` và hoàn đủ. UI mock hiện coi “Sẵn sàng” là trạng thái chưa vào phiên nhưng hủy ở đó trả cả gói. Khi nối thật: “Sẵn sàng” (access `ready`, chưa activate) phải hoàn đủ nếu hủy; sau `activate` đồng hồ gói chạy ngay và UI phải hiện thời gian còn lại từ `endAt` trên chain, kể cả khi người dùng chưa mở viewer. Hành động UI: tách “hủy trước kích hoạt (hoàn đủ)” khỏi “kết thúc sau kích hoạt (trả cả gói)”; thêm trạng thái “đang kích hoạt/kết nối”. Việc này là chỉnh UI để phản ánh dữ liệu thật, không đổi chính sách tiền.

## Migration path (không để hai flow chính trái nhau)

1. `web/` giữ `/`, tải app, chính sách. Các route `web/src/app/{machines,checkout,sessions,history,wallet,workspace,host,admin}` hiện là **preview fixture**: giữ nguyên tới khi API tương ứng chạy, sau đó chuyển thành trang thông tin hoặc chuyển hướng “Mở trong app”; không xóa trước khi có thay thế.
2. Bản tài liệu cũ nhắc Sunshine/Moonlight được ghi “thay thế bởi Selkies (feature 003)” tại chỗ; `STREAMING_RESEARCH.md` giữ so sánh làm lịch sử.
3. `RemoteSessionProvider` (shared) giữ nguyên chữ ký; adapter Selkies/gateway là bản cài đặt thật đầu tiên.

## Ngoài phạm vi / không hứa

Mainnet, thu tiền thật, host bond, cash-out, chatbot, app điện thoại. Không hứa mọi game Windows chạy trên Linux, không hứa bảo vệ dữ liệu khỏi host có quyền quản trị, không hứa hiệu năng host không bị ảnh hưởng, WSL/Docker không phải chứng nhận cô lập.

## Tiêu chí hoàn thành toàn feature

App cài được; một vòng thuê thật trên hai máy từ đăng máy tới kết thúc/revoke/cleanup; thanh toán Fuji và workspace xác minh riêng khi có đầu vào. Mục chưa thử thật phải ghi “chưa đạt”.

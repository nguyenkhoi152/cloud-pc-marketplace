# Tasks: Tích hợp end-to-end

Ký hiệu: [x] xong + có bằng chứng · [~] một phần · [ ] chưa · [⛔] chờ đầu vào ngoài (ghi rõ)

## M-A Đặc tả
- [x] T001 spec/plan/tasks + bảng đối chiếu màn hình→API→bảng→quyền→trạng thái→kiểm tra
- [x] T002 Cập nhật ARCHITECTURE, REMOTE_ACCESS 1.1, PRODUCT_WORKFLOW, README, AGENTS, MVP, APPROVAL, SECURITY, STREAMING_RESEARCH, TEST_PLAN, DEVELOPMENT_GUIDE, CONTRACT_SPEC, SOURCES, banner lịch sử UX brief (Sunshine/Moonlight → Selkies; `docs/archive`, `design-preview/`, `specs/001` giữ nguyên là lịch sử)

## M-B Tauri
- [x] T010 Kiểm tra công cụ (`tauri info`, 08/11/2026): WebView2 157.0.4341.42 ✔, Node 26.13.0 ✔; **thiếu** Rust/Cargo/rustup và Visual Studio Build Tools (MSVC + SDK); cũng chưa có WSL/Docker
- [~] T011 `desktop/src-tauri` (tauri.conf.json, Cargo.toml, build.rs, lib.rs/main.rs tối thiểu, capabilities, icon sinh bằng `tauri icon`); `tauri info` đọc được cấu hình (CSP/devUrl/frontendDist). **Rust chưa biên dịch**
- [x] T012 (09/11) Chủ dự án cho phép cài; đã cài VS Build Tools 2022 (C++), rustup, rustc/cargo 1.99.1. `tauri build` thành công → exe + installer NSIS 2,41 MiB (`C:\cpm-tauri-target\release\bundle\nsis\`, chưa ký). Exe chạy trong WebView2, kiểm qua CDP 7/7 (render live, Supabase qua CSP 200, font cục bộ, 0 lỗi console). Đã cài trên máy này (09/11, `/S`, user-level) và bộ kiểm live 28/28 trong cửa sổ app đã cài. **Chưa** máy khác, chưa ký số, chưa Selkies trong WebView2. Sửa trong lúc làm: CSP thiếu Supabase/font (bản cài live sẽ mất kết nối), bỏ Google Fonts → `@fontsource/be-vietnam-pro` cục bộ

## M-C Gateway/agent (độc lập host thật)
- [x] T020 `host-agent/src/gateway.ts`: grant theo booking (token băm, đổi một lần, TTL), proxy HTTP+WebSocket tới upstream cố định, kiểm Origin, chặn `//host`
- [x] T021 Revoke đóng kết nối đang mở (<1s), chặn reconnect + link chưa dùng, idempotent; watchdog `endAt` theo đồng hồ đơn điệu (đổi giờ tường không kéo dài phiên)
- [x] T022 9 test vitest với upstream giả (không phải Selkies); thử phá 5 chỗ (revoke, chặn //, token một lần, watchdog, cookie rò rỉ) đều bị test bắt
- [~] T023 Spike Selkies thật: **video + chuột + bàn phím (lệnh chạy, kết quả trả về) + revoke qua gateway đã kiểm (09/11) trong VM Linux không GPU** (`scripts/vm/gateway-selkies-check.mts` 14/14) **và trong iframe của app Tauri đã cài** (`scripts/vm/webview2-iframe-check.mts` 5/5). Sửa 2 lỗi thật: cookie `SameSite=None` + `frameAncestors` (Selkies trả `frame-ancestors 'self'`). **Chưa**: âm thanh, toàn màn hình, khóa chuột/Keyboard Lock, reconnect, độ trễ/FPS/CPU (VM 2 vCPU quá tải khi mã hóa CPU ở độ phân giải lớn), GPU thật

## M-D Schema
- [x] T030 Migration `20261108000001_schedule_devices.sql`: lịch tuần/ngoại lệ, `schedule_windows`, `machine_availability`, `device_enrollments` + heartbeat/health, `can_accept_new`, guard coverage cho `host_commitments`. (`chain_events`, `session_grants`, `agent_commands`, workspace* đã thêm ở migration 000003–000005; **chưa có** bảng `incidents` — UI sự cố vẫn là mock)
- [x] T031 `db/tests/schedule.test.ts` 11 test (tổng db 47/47): chồng lấn/giờ sai/ngoại lệ, quy đổi UTC, enrollment một lần/hết hạn/thu hồi, replay heartbeat, health 30s/90s, `can_accept_new`, commitment không bị phá; thử phá 4 chỗ đều bị bắt

- [x] T032 Sửa 3 findings review (08/11): khoá máy chung cho guard cam kết, advisory lock lịch, `my_machine_health`; khoá user cho đổi ví/đặt máy (`20261108000002`). Test hai connection trên Postgres 18 thật cục bộ (`db/tests/concurrency.test.ts`, 7 test); **chưa kiểm trên Supabase thật**
- [x] T033 Chuẩn bị Supabase dev (chưa chạy): `docs/SUPABASE_DEV_SETUP.md`, `scripts/supabase-migrations.ps1`, `supabase/verify/post_migration_checks.sql`, `desktop/.env.example`
- [⛔] T034 Áp dụng migrations + chạy verify trên project Supabase dev — người dùng thực hiện theo hướng dẫn rồi gửi kết quả

## M-E API + adapter live
- [x] T040 API server (`server/`, route Next `/api/[...path]`): ví (EIP-191), quote EIP-712 (đã được RentalEscrow thật chấp nhận trên Hardhat), enrollment/heartbeat, xác minh tx + đối soát. 53 test (09/11) trên Postgres thật cục bộ. Migration đã có trên Supabase dev; **code server đã chạy với Supabase thật: `smoke:server` 8/8 (09/11)**, không có chuỗi khối (xem T043)
- [x] T041 `desktop/src/api` adapter live + `VITE_APP_MODE`; fail-closed, từ chối key nhạy cảm, live không fallback mock; 11 test với client giả có nhãn
- [x] T042 Auth/danh mục/đăng máy/giữ máy qua Supabase từ app (RLS + RPC, không service role): `npm run smoke:supabase` 9/9 xanh, 0 skip, chạy 2 lần trên project dev thật (08/11/2026). Chưa kiểm: race đồng thời trên Supabase, UI live trong trình duyệt, ví thật

## M-F Worker · M-G Workspace · M-H Fuji/E2E/đóng gói
- [x] T050 Worker: outbox lease/fencing, retry/dead, hết hạn booking có đối soát chuỗi, prepare/activate/grant/revoke/reset, watchdog endAt; test trên Postgres thật với provider/operator/chuỗi giả có nhãn
- [x] T060 WorkspaceStore local FS + broker (lease một writer, quota, checksum, manifest nguyên tử, bàn giao, GC, xóa) — 13 test; S3 chưa làm
(T070/T071 xem mục bổ sung bên dưới)

## M-C/M-D bổ sung (08/11)
- [x] T024 Kênh agent: `agent_commands` + poll/report + `ControlPlaneProvider`; agent runtime (heartbeat bền, tập lệnh cố định, Unknown khi guest chưa cài); token xem một lần (`grant_claim`); 4 test E2E cục bộ + 10 test agent. Migration `20261108000005`
- [x] T025 Entry `host-agent` enroll/start fail-closed; entry `worker` fail-closed
- [x] T026 Client API server trong app + nút “Mở màn hình” (viewer nhúng); chưa thử với Selkies thật
- [x] T080 Sổ tay demo `docs/DEMO_RUNBOOK.md`, `web/.env.example`
- [⛔] T070 Fuji (deploy + thanh toán thật): cần ví thử, AVAX Fuji, RPC, 5 địa chỉ vai trò
- [⛔] T071 Vòng thuê thật hai máy: cần host + renter được chỉ định
- [x] T072a Migration 000003–000006 đã áp dụng lên Supabase dev (xem T034/T035)
- [⛔] T072b Chạy API/worker với dữ liệu thật: cần bạn điền `web/.env.local` (xem T043)

## Cập nhật 08/11 (sau khi áp dụng migration 000003–000005)
- [x] T034 Migration 000003–000005 trên Supabase dev: **thăm dò API 62/62** (7 bảng, 21 hàm tồn tại và bị chặn 42501; cột mới; RLS owner). Đã có kết quả `post_migration_checks.sql` 1–14 `ok` (xem T035)
- [x] T035 Đã áp dụng `20261108000006_revoke_sequence_grants.sql`; verify SQL bản mở rộng trên Supabase dev: hàng 1–14 `ok = true`, PostgreSQL 17.11 (kết quả do người dùng dán, Claude đối chiếu)
- [x] T027 Q3 phản ánh vào UI live (`bookingPhase`: hủy trước kích hoạt hoàn đủ ≠ sau kích hoạt trả cả gói; đồng hồ theo `endAt`); nút ký khoá có lý do
- [x] T028 Liên kết ví trong app (EIP-1193 + challenge/verify) — test với ví giả; chưa ví thật
- [x] T029 Code-splitting theo route: 749,96 → 447,61 kB (gzip 231 → 145)
- [x] T043 `smoke:server` trên Supabase dev thật (09/11): **8/8 xanh, exit 0**, sau khi sửa `web/.env.local` (URL/key dính chú thích, thiếu `SUPABASE_DB_CA`, sai mật khẩu DB). Lần cách A (không tạo dữ liệu) đạt 7/8, chỉ test 5 đỏ do không có booking còn hạn; chạy `smoke:supabase` (9/9) ngay trước thì 8/8. Chứng minh: kết nối DB qua pooler + `set local role service_role` (không superuser), JWT thật, liên kết ví host bằng chữ ký (nonce một lần, chữ ký sai bị từ chối), đổi ví renter bị chặn khi còn booking, quote ký đúng signer và khớp snapshot DB, enrollment → heartbeat chống replay → sức khỏe ok → thu hồi, workspace + lease bị từ chối khi booking chưa Active. **Không phải**: chuỗi khối (địa chỉ contract giả, khoá quote sinh ngẫu nhiên), concurrency trên Supabase, worker. Kiểm điều kiện: `node scripts/preflight-smoke-server.mjs`

- 09/11: chạy lần đầu (cách A) → 0/8, do lỗi định dạng `web/.env.local` (URL lặp tên biến/dính chú thích) và `self-signed certificate in certificate chain` khi kết nối DB (cần `SUPABASE_DB_CA`). Chưa có bằng chứng về server trên Supabase thật.

## Cập nhật 09/11
- [x] T044 `scripts/preflight-smoke-server.mjs`: kiểm điều kiện + liệt kê dữ liệu `smoke:server` sẽ ghi (chỉ đọc)
- [x] T045 (09/11) Bộ cài NSIS đã cài trên máy dev; `browser-check-live.mjs` có chế độ `CHECK_TAURI_EXE` → 28/28 trong app đã cài
- [x] T046 (09/11) API (Next) + worker trên Supabase thật với chuỗi Hardhat cục bộ (chainId 43113, mô phỏng): API HTTP 11/11 (CORS từ `tauri.localhost`, 401/403/404, quote EIP-712 hợp lệ); worker 8 job xong, 2 booking quá hạn → `expired`
- [x] T047a (10/11) Phiên thuê trọn vẹn với **ví giả lập + chuỗi Hardhat cục bộ**: `scripts/vm/renter-session-e2e.mts` 16/16 (Supabase thật, API, worker, host-agent, gateway, Selkies thật; fund → activate → xem → accept → thu hồi → reset guest → reset_verified)
- [x] T048 (10/11) Ví giả lập trong app (`devWallet.ts`, chỉ loopback) + nút Trả tiền/Hủy/Kết thúc + `/api/chain-info` + tự làm mới + viewer tự đóng; kiểm qua giao diện `scripts/vm/app-session-e2e.mjs` 11/11 (Edge) và 11/11 trong app Tauri đã cài
- [x] T049 (10/11) Lỗ hổng: worker không kết thúc phiên khi người thuê bỏ đi ⇒ job `claim_after_grace` (operator, sau endAt + ân hạn + 30 s, chỉ khi chuỗi Active); 3 test + phá thử + chạy thật (tự settled lúc 02:00:03 UTC)
- [x] T050 (10/11) `scripts/vm/start-demo.ps1` / `stop-demo.ps1` (một lệnh, đã kiểm từ trạng thái nguội); guest Docker (`dockerGuest.ts`) + `WORKER_PROVIDER=agent`
- [⛔] T047b Fund/activate/settle bằng ví thật trên **Fuji**: cần ví thật + Fuji (T070); T071 vòng hai máy cần host Linux có GPU

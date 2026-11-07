# Lộ trình triển khai 1.0

Local bắt đầu theo START_HERE, không cần duyệt lại bộ draft. Đầu vào/quyền ngoài ở APPROVAL.

## M0 — khảo sát, không chặn toàn dự án

Kiểm tra folder/code/Git/Node/npm/Docker và tài nguyên được cấp. Ghi chính xác phiên bản, không bịa công cụ. Chưa có PC thì chuẩn bị spike và hỏi cấu hình/máy ở bước remote; tiếp tục M1/M2/M3.

Khi có máy, thử Sunshine/Moonlight qua hai mạng, guest sạch, grant/revoke/reconnect/watchdog/reset, đo pipeline. Không tự thay OS/mở router/firewall hoặc dùng desktop cá nhân.

## M1 — bộ khung chạy local

Next.js/TypeScript/Tailwind, repo modules có nội dung, shared schemas/providers, cấu hình validation và .env.example placeholder. Node LTS/dependencies tương thích, pin/lockfile.

UI tiếng Việt cho catalog/details/filter, host/admin, checkout, PCP wallet, session/history và workspace. Fixture preview có nhãn; actions thật chưa có thì disable/giải thích, không giả receipt/AI/desktop.

Tạo scripts dev/build/lint/typecheck; ghi vào README trước chạy. Không tạo test rỗng trả exit0 hoặc gọi lệnh chưa tồn tại. Build/typecheck/lint phù hợp qua hoặc ghi blocker thật.

Đạt: source và web local mở được theo hướng dẫn, mock boundary rõ, chưa gọi full MVP.

## M2 — auth/database

Supabase Auth, wallet proof, schema/migrations/RLS, host/admin rights, listing/commitment, atomic reservation/quote và outbox.

Local Supabase/Postgres nếu công cụ đã có; dịch vụ ngoài chỉ khi được cấp. Thiếu Docker không tự cài toàn hệ thống: vẫn viết migrations/domain/API tests độc lập, ghi RLS integration chưa chạy.

Chạy meaningful checks cho quyền, hai request đặt cùng máy, idempotency, quote/hold expiry và wallet nonce. Preview không cấp quyền vào adapters thật.

## M3 — PCP và escrow local

Triển khai CONTRACT_SPEC đầy đủ; không tái dùng native AVAX spec cũ. Token→escrow→configure once, issuer cap, restricted transfer, quote và pull-credit.

Tests local roles/biên/race/conservation/withdraw/pause. Viết scripts deploy/export ABI và deployment manifest. Không broadcast Fuji lúc này.

Đạt: token chuyển đúng qua escrow/refund/withdraw, P2P chặn, tests có bằng chứng, code chuẩn bị kết nối web.

## M4 — worker và remote

Nối chain receipt/indexer/outbox/reconciliation; operator quyền hẹp. Host agent enrollment/commands/health; RemoteSessionProvider thật sau spike.

Grant sau confirmed funding+activation; endAt watchdog; revoke active stream và reconnect; reset verified. Không gắn countdown UI với quyền máy.

Thiếu PC: làm worker/adapter code và deterministic tests, không gọi mock là remote thật. Ghi phần cần thiết bị rồi tiếp tục M5 local.

## M5 — workspace

No-cloud hoặc project-only. Implement broker, LocalFileStore dev và S3-compatible adapter, quota/lease/immutable manifest/version, revoke/cleanup/recovery.

Tests cross-tenant, upload fail/quota/version conflict/rollback/expired grants. Thử hai agent local trước; khi có hai host tương thích chứng minh restore project thật.

Production phải từ chối LocalFileStore/mock và thiếu config mã hóa/access. Chưa có S3 account thì không thuê cloud tự động hoặc nói Saved trên cloud thật.

## M6 — configured E2E và triển khai

Chuẩn bị local end-to-end và toàn bộ cấu hình/scripts có thể review trước. Khi người dùng cấp quyền/tài nguyên:

1. Nhập secret ở môi trường riêng, không gửi vào chat/Git.
2. Deploy PCP+escrow Fuji bằng script đã test, lưu địa chỉ/chain/ABI/tx thật.
3. Dùng ví test riêng; người dùng cần AVAX gas, faucet không bảo đảm luôn chạy.
4. Cấu hình Supabase/S3/host agent, web HTTPS và worker thường trực.
5. Kiểm tra auth redirects/origin/private routes, public access chỉ phần chủ dự án muốn công bố.
6. Chạy happy path + refund/dispute/reload/revoke/reset/restore; ghi deployment record.

Deploy web, tạo tài khoản/cloud trả phí, push GitHub hoặc public PC cần phạm vi/quyền cụ thể khi đến bước, không xin trước khi chưa có cấu hình/source để review.

## M7 — tùy chọn sau core

AI tư vấn catalog có schema/constraints/fallback rule, không project/secret hoặc quyền giao dịch. LLM trả phí cần key/budget được cấp.

x402/relayer, host bond, nhiều gói, fiat cash-out, persistent full OS là mốc riêng có đặc tả/test; không tự làm để giống repo tham khảo.

## Lịch mục tiêu Việt Nam

07–09/11: M0 khảo sát và M1. 09–11/11: M2/M3 theo writer tuần tự. 12–15/11: M4/M5. 16–18/11: M6 nếu đủ tài nguyên, sửa lỗi. 19/11: review/README. 20–21/11: video/slide/link/Submit trước 23:59 ngày21.

Lịch không bảo đảm khi nguồn máy/tài nguyên chưa có. Ưu tiên core đúng tiền/quyền; báo phần chưa đạt thay vì dựng kết quả.

## Sau mỗi mốc

Cập nhật README scripts thực tế và PROGRESS: file/code, commands/thao tác, kết quả, mocks, blocker, job còn chạy và mốc tiếp. Không scaffold lại vì chat mới.

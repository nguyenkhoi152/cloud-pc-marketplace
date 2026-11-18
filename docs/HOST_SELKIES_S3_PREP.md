# Chuẩn bị thử host Selkies, kho S3 và hosting (chưa làm gì thật)

Trạng thái 09/11/2026. **Chưa có host Linux, chưa chạy Selkies, chưa có bucket S3, chưa deploy.** Tài liệu này là danh sách việc và rào chắn; mọi mục chưa kiểm đều ghi "xác minh khi có host". Không cài WSL/Docker/Linux VM, không đổi firewall/router, không dùng PC cá nhân làm host khi chưa được chỉ định bằng lời của chủ dự án.

## 1. Host Linux + Selkies

**Đã có sẵn trong repo (kiểm cục bộ, upstream giả):** host-agent (heartbeat, kéo lệnh), session gateway (token đổi một lần, proxy HTTP/WebSocket tới *một* upstream cố định, kiểm Origin, revoke đóng kết nối), viewer iframe trong app.

**Đã kiểm 09/11 (VM Ubuntu 24.04 không GPU, VirtualBox, xem PROGRESS)**: container `ghcr.io/selkies-project/selkies/desktop:2.2.1-ubuntu26.04` chạy bằng `docker run -d --shm-size=2g -p 8080:8080 -e SELKIES_ENABLE_HTTPS=false -e SELKIES_ENABLE_BASIC_AUTH=false …`; gateway đứng trước (`scripts/vm/gateway-selkies-check.mts` 14/14) và trong iframe của app Tauri (`scripts/vm/webview2-iframe-check.mts`). **Cấu hình gateway khi nhúng trong app**: `GATEWAY_FRAME_ANCESTORS=http://tauri.localhost` (Selkies trả `frame-ancestors 'self'`), `GATEWAY_SAMESITE=None` (mặc định khi có FRAME_ANCESTORS; cần HTTPS ngoài loopback). Cổng Selkies phải chỉ lắng nghe loopback/mạng nội bộ (đã tắt basic auth của Selkies, ranh giới xác thực là gateway). Máy ảo tạo bằng `scripts/vm/new-test-host-vm.ps1` (NAT, chỉ 127.0.0.1; **dùng 2 vCPU, 4 vCPU làm VM treo**; file PowerShell cần UTF-8 BOM). VM không GPU mã hóa bằng CPU; **VM còn bị đình trệ vCPU (`soft lockup` 25–248 s trong log kernel) do VirtualBox trên lớp ảo hóa của Windows, nên không dùng để đo hiệu năng hay vận hành**. Host thật phải là Linux + GPU và cần đo hiệu năng.

**Nguồn đã ghi** (`docs/SOURCES.md`): tài liệu Selkies https://docs.selkies.io/latest/ (kiến trúc, firewall, license) và release 2.0.0. Theo ghi chép trước, docs chỉ nêu host Linux; WSL2/Docker Desktop không được nêu; phiên bản docs 2.2.1 vs release 2.0.0 chưa chốt. **Không có cờ/biến Selkies nào được ghi ở đây vì chưa đọc lại nguồn để đối chiếu** — lấy lệnh cài đặt từ tài liệu chính thức khi bắt đầu.

Cần từ chủ dự án (một trong hai):
- Máy Linux riêng (ưu tiên máy thử không chứa dữ liệu cá nhân), hoặc
- Cho phép tạo Linux VM Hyper-V trên máy dev này (Hyper-V có mặt; chưa kiểm GPU passthrough/encoder trong VM — **xác minh khi có host**).

Danh sách kiểm khi có host (mỗi mục ghi kết quả vào PROGRESS, không suy đoán):
1. Cài Selkies theo tài liệu chính thức; xác nhận cổng mặc định và có cần WebRTC hay chỉ WebSocket.
2. Cấu hình host-agent bằng các biến **đã có trong code**: `AGENT_API_BASE`, `AGENT_ENROLL_TOKEN` (một lần), `AGENT_DATA_DIR`, `GATEWAY_UPSTREAM` (địa chỉ Selkies nội bộ), `GATEWAY_PUBLIC_URL`, `GATEWAY_ALLOWED_ORIGINS` (bắt buộc nếu không loopback), `GATEWAY_BIND`, `GATEWAY_PORT`, `AGENT_INTERVAL_MS`. Lệnh: `npm run enroll -w @cpm/host-agent` rồi `npm run start -w @cpm/host-agent`.
3. Thử video, âm thanh, bàn phím, khoá chuột, toàn màn hình, reconnect, revoke (đóng ≤1 giây) qua gateway.
4. Thử trong WebView2: iframe + cookie bên thứ ba, Keyboard Lock / Pointer Lock (chưa thử).
5. Khác mạng: quyết định relay/tunnel (chi phí do chủ dự án chọn). Chưa chọn.
6. Guest hiện là `unavailableGuest` (trả Unknown, không giả thành công): cần viết adapter thật cho prepare/grant/revoke/reset/verify sau khi biết cách điều khiển guest — **chưa làm**.

## 2. Kho workspace S3

**Đã có:** `server/src/s3store.ts` — driver `S3WorkspaceStore` sau giao diện `ObjectClient`, giữ bất biến của `LocalFsStore` (key `<workspaceId>/<sha256>`, put idempotent, không ghi đè bản hỏng, tính lại checksum). 6 test với client giả trong bộ nhớ.

**Chưa có:** wrapper cho `@aws-sdk/client-s3` (chưa thêm dependency vì chưa có đích), bucket, credential, thử với S3/MinIO/R2 thật. Ghi có điều kiện (`If-None-Match`) không phải kho nào cũng hỗ trợ — cờ `conditionalPut` tắt được; tính đúng đắn dựa vào key theo nội dung + kiểm checksum, không dựa vào điều kiện ghi.

Khi chủ dự án chọn đích (bucket riêng cho dev, region, nhà cung cấp): viết wrapper mỏng, đặt credential chỉ ở môi trường server/worker (IAM giới hạn prefix workspace, không public), bật mã hoá phía kho, đặt vòng đời xoá staging, rồi thêm biến chọn driver trong `web/.env.example`. Ghi chi phí ước tính trước khi tạo bucket.

## 3. Hosting web/API/worker

Chưa deploy gì. API chạy dưới dạng route Next trong `web/` (cần môi trường server có Postgres; **không dùng filesystem của Vercel cho workspace**); worker là tiến trình thường trực riêng (`npm run worker -w @cpm/server`, cần `OPERATOR_PRIVATE_KEY`, `RPC_URL`…). Cần quyết định: nơi chạy worker, có công khai URL không, tên miền. Không mua domain/thuê cloud khi chưa có chỉ định.

# Sổ tay chạy demo Cloud PC Companion

> **Lưu ý (19/11/2026):** các mục "chưa chạy lần nào", "chưa Fuji" và bảng thật/giả dưới đây ghi trạng thái ngày 12/11. Chế độ công khai (Fuji + tunnel) và host WSL2 **đã chạy thật trên một máy** từ 18/11, và có lệnh `scripts\public\start-all.ps1` dựng cả hệ thống. Trạng thái hiện hành: [README mục 6 và 7](../README.md#6-trạng-thái-xác-minh-và-giới-hạn), [PROGRESS](PROGRESS.md).

Trạng thái 12/11/2026 (mục §2.7 và §2.8 là luồng hiện hành; các mục cũ hơn giữ để tra cứu). Tài liệu này nói **cái gì chạy thật, cái gì còn giả**, cách chạy từng phần và đầu vào còn thiếu để có vòng thuê thật trên hai máy. Installer NSIS (chưa ký) đã build **và cài trên máy dev** (09/11, xem `desktop/README.md`); bản đã cài qua bộ kiểm live 28/28; chưa thử trên máy khác.

## 1. Chạy gì được ngay (không cần hạ tầng ngoài)

```powershell
npm install
npm test                       # shared, db (Postgres thật cục bộ + PGlite), contracts (Hardhat), desktop, host-agent, server
npm run dev:desktop            # preview: toàn bộ dữ liệu mẫu có nhãn (http://127.0.0.1:5174)
```
`npm test` gồm **bài tích hợp cục bộ end-to-end** (`server/src/e2e.test.ts`): API HTTP thật + worker + host-agent + gateway + Postgres thật; chuỗi khối, guest/Selkies và operator là bản giả có nhãn.

## 2. Chạy với Supabase dev đã cấu hình

1. Migration `20261108000003`–`000006` đã áp dụng ở project dev bằng SQL Editor (người dùng báo; `post_migration_checks.sql` hàng 1–14 đều `true`, PostgreSQL 17.11; thăm dò API 62/62). Không dùng `supabase db push`, không reset dữ liệu smoke (xem `docs/SUPABASE_DEV_SETUP.md` mục 10).
2. `desktop/.env.local`: `VITE_APP_MODE=live`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, (tuỳ chọn) `VITE_API_BASE_URL=http://localhost:3000/api`.
3. API server: copy `web/.env.example` → `web/.env.local`, điền theo từng dòng (DB URL, RPC Fuji, địa chỉ contract, khoá ký quote…). Thiếu biến → API trả 503 và **nêu tên biến**, không chạy nửa vời. Chạy: `npm run dev -w web`.
4. Worker: `npm run worker -w @cpm/server` (cần `OPERATOR_PRIVATE_KEY`, `RPC_URL`, `ESCROW_DEPLOY_BLOCK`…). Provider remote hiện là “host-agent chưa nối” → các bước cần host trả Unknown, **không giả thành công**.
5. Host-agent (máy host được chỉ định): admin tạo enrollment (`POST /api/admin/enrollments`), rồi `AGENT_API_BASE=… AGENT_ENROLL_TOKEN=… npm run enroll -w @cpm/host-agent`, sau đó `npm run start -w @cpm/host-agent` với `GATEWAY_UPSTREAM` (Selkies nội bộ), `GATEWAY_PUBLIC_URL`, `GATEWAY_ALLOWED_ORIGINS` (bắt buộc nếu không ở loopback). Credential chỉ lưu trong file cục bộ, không in ra.
6. Kiểm server trên Supabase thật (**đã chạy 09/11: 8/8**; các bước dưới dùng để chạy lại): điền `web/.env.local` (có `SUPABASE_DB_URL`, chỉ ở máy bạn), rồi `npm run check:env` và `node scripts/preflight-smoke-server.mjs` (chỉ đọc; liệt kê điều kiện và dữ liệu sẽ ghi). `smoke:server` ghi: `wallet_challenges` (+2 dòng/lần), `wallet_links` (host ↔ ví thử sinh cục bộ, khoá thêm vào `desktop/.env.smoke.local`), `audit_logs`, `device_enrollments` (+1, thu hồi ngay), `workspaces` (+1 "smoke-workspace" nếu chưa có); **không** tạo máy/booking/tài khoản, **không** gửi giao dịch chuỗi. Test 5 cần một booking `reserved` còn hạn (10 phút). Hai cách: **(A)** `npm run smoke:server -w @cpm/server` ngay, test 5 đỏ có lý do, không phát sinh máy/booking; **(B)** chạy `npm run smoke:supabase` ngay trước (tạo thêm 1 máy + 1 booking giữ tới khi có đối soát chuỗi). Lúc viết (09/11) renter smoke có 2 booking `reserved` nhưng 0 còn hạn.
7. Kiểm tra trình duyệt: chạy `npm run dev:desktop` (cổng 5174, chế độ live) rồi `node scripts/browser-check-live.mjs http://127.0.0.1:5174` (Edge headless, dùng tài khoản smoke; script mặc định cổng 5176 nếu không truyền URL).

### Chạy API + worker trên Supabase thật với chuỗi cục bộ (mô phỏng, không Fuji)
Dùng khi chưa có Fuji. Chuỗi là Hardhat cục bộ (khoá công khai, vô giá trị); dữ liệu là Supabase dev thật.
1. `cd contracts; npx hardhat node --chain-id 43113 --port 8545` (cửa sổ riêng), rồi `npx hardhat run scripts/deploy.ts --network localhost` (ghi `contracts/deployments/localhost.json`).
2. Đặt biến chuỗi **trong phiên PowerShell** (không sửa `web/.env.local`): `RPC_URL=http://127.0.0.1:8545`, `ESCROW_ADDRESS`/`PCP_ADDRESS`/`TREASURY_ADDRESS` từ manifest, `QUOTE_SIGNER_PRIVATE_KEY` và `OPERATOR_PRIVATE_KEY` là khoá tài khoản #3 và #1 của Hardhat (khoá công khai in khi chạy `hardhat node`), `MIN_CONFIRMATIONS=1`, `WALLET_DOMAIN=localhost:3000`, `WALLET_URI=http://localhost:3000`, `ALLOWED_ORIGINS=http://tauri.localhost,http://127.0.0.1:5174`, `WORKSPACE_DIR=<thư mục ASCII>`. Biến trong tiến trình ưu tiên hơn `.env.local`.
3. API: `npm run dev -w web` (cổng 3000). Worker: cần nạp `SUPABASE_DB_URL`/`SUPABASE_DB_CA` vào môi trường tiến trình rồi `npm run worker -w @cpm/server` (worker không tự đọc `.env.local`; tên biến xem `web/.env.example`). Worker sẽ chuyển các booking quá hạn sang `expired` và nhả máy khi chuỗi xác nhận không có booking.
4. Kiểm app đã cài: `CHECK_TAURI_EXE='<đường dẫn cloud-pc-companion.exe>' node scripts/browser-check-live.mjs`.

### Demo trên Windows 11: HOST + NGƯỜI THUÊ trên một máy (12/11/2026) — §2.7
Demo này là **bản demo để cài và trình bày**, không phải dịch vụ công khai. Chuỗi là Hardhat **cục bộ** (mô phỏng, không phải Fuji, không mainnet), ví là **VÍ GIẢ LẬP** (PCP không có giá trị), dữ liệu là Supabase dev thật.

**Cài một lần**
1. Bộ cài NSIS (chưa ký số): `powershell -ExecutionPolicy Bypass -File scripts\vm\build-demo-app.ps1 -Install` — build có `VITE_API_BASE_URL=http://127.0.0.1:3000/api` và `VITE_DEV_WALLET_RPC=http://127.0.0.1:8545`, nhúng agent đã đóng gói; cài cho người dùng hiện tại (`/S`, không admin) vào `%LOCALAPPDATA%\Cloud PC Companion`. Cần đóng mọi cửa sổ app trước. Muốn chỉ build: bỏ `-Install`.
2. Guest cho máy cho thuê, **chọn một**:
   - **WSL2 (đích của sản phẩm)**: làm theo `docs/HOST_WINDOWS_WSL.md` §3 (cần quyền admin và khởi động lại — app không tự làm). Máy dev này **chưa có WSL**.
   - **VM Linux thử (VirtualBox, không GPU)**: đã có `cpm-test-host` (`scripts\vm\new-test-host-vm.ps1`). Không đại diện hiệu năng; từng treo.

**Chạy**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\vm\start-demo.ps1                 # guest VM thử; app điều khiển agent (khuyến nghị)
powershell -ExecutionPolicy Bypass -File scripts\vm\start-demo.ps1 -Guest wsl -NewEnrollment   # guest WSL2 do app chọn (cần WSL đã cài); -NewEnrollment lần đầu hoặc khi app báo chưa ghi danh (thu hồi thiết bị cũ, ghi mã vào C:\cpm-demo\enroll-token.txt, hết hạn 15 phút, xoá tệp sau khi dán)
powershell -ExecutionPolicy Bypass -File scripts\vm\start-demo.ps1 -Agent script   # chạy agent từ dòng lệnh, không cần mở app (chỉ VM thử)
```
Script dọn tiến trình cũ, bật VM (nếu dùng), chuỗi Hardhat + deploy, API :3000, worker, bảo đảm cam kết host còn hạn, kiểm guest (chỉ đọc) và cấp **mã ghi danh** (`C:\cpm-demo\enroll-token.txt`, dùng một lần, 15 phút; không in ra) nếu guest chưa ghi danh.

**Hai cửa sổ trên một máy** (mỗi cửa sổ một hồ sơ WebView2 riêng để hai tài khoản và hai ví giả lập không dính nhau):
```powershell
powershell -File scripts\vm\open-app.ps1 -Role host
powershell -File scripts\vm\open-app.ps1 -Role renter
```
- **Cửa sổ host** — đăng nhập tài khoản host (`SMOKE_HOST_*` trong `desktop\.env.smoke.local`) → Cho thuê máy → **Thiết lập & chạy máy**: app dẫn từng bước (WSL2, distro riêng, systemd, Docker/Node, image Selkies ~8 GB, agent, mạng tới API, ghi danh bằng mã, **Bắt đầu nhận thuê**). Bước cần admin/khởi động lại luôn là hướng dẫn, không phải nút. Khi "Heartbeat" báo ổn, máy mới nhận khách. Danh sách "Phiên trên máy của tôi" tự cập nhật.
- **Cửa sổ người thuê** — đăng nhập `DEMO_RENTER_*` → Ví → Liên kết ví (ví giả lập của **cửa sổ này**) → Khám phá → máy `smoke-*` → Giữ máy → Phiên & đặt chỗ của tôi → Trả tiền → chờ "Dùng máy" (khoảng 1,5 phút) → Mở màn hình → Kết thúc.
- **Dừng**: bấm **Dừng nhận thuê** (cắt phiên đang xem, xoá container khách) hoặc đóng cửa sổ host (agent nhận EOF trên stdin và tự dừng/dọn). `scripts\vm\stop-demo.ps1` dừng agent trong guest rồi mọi dịch vụ và tắt VM.
- **Lưu ý**: nếu một phiên bị bỏ giữa chừng (người thuê đóng app, mất ví), máy vẫn bị giữ tới `endAt` + ân hạn 600 s + 30 s rồi worker mới tự kết thúc, reset và nhả máy (thiết kế có chủ ý, đã chạy thật). Muốn đổi ví giả lập của tài khoản thuê (ví dụ dùng cửa sổ/hồ sơ mới) phải đợi hết booking đang sống.

### Demo chỉ phía người thuê, KHÔNG mở cửa sổ host (agent chạy từ dòng lệnh trong guest) — §2.8
Chuỗi là Hardhat cục bộ (mô phỏng, không phải Fuji), ví là **VÍ GIẢ LẬP**, dữ liệu là Supabase dev thật, máy cho thuê là container Selkies thật trong VM Linux không GPU. **Lưu ý**: mặc định `start-demo.ps1` (tức `-Agent app`) **không bật agent**; nếu không ai bấm *Bắt đầu nhận thuê* trong app host thì người thuê dừng ở `funded / preparing`. Muốn demo chỉ phía người thuê, dùng `-Agent script`.
```powershell
powershell -ExecutionPolicy Bypass -File scripts\vm\start-demo.ps1 -Agent script   # dọn tiến trình cũ, bật VM, chuỗi + deploy, API :3000, worker, agent TRONG guest + gateway :18095
# ... dùng app ...
powershell -ExecutionPolicy Bypass -File scripts\vm\stop-demo.ps1     # dừng tất cả và tắt VM
```
Lần đầu cần chạy một lần `scripts/vm/new-test-host-vm.ps1` (VM) và `scripts/vm/session-setup.mts` (tài khoản người thuê demo, máy, enrollment). Nhật ký ở `C:\cpm-demo\logs`.
**Thử trong app** (Start Menu → "Cloud PC Companion", bản build với `VITE_DEV_WALLET_RPC`/`VITE_API_BASE_URL`): đăng nhập bằng tài khoản người thuê demo (`DEMO_RENTER_EMAIL`/`DEMO_RENTER_PASSWORD` trong `desktop\.env.smoke.local`) → **Ví → Liên kết ví** (nhãn VÍ GIẢ LẬP) → Thuê máy → máy `smoke-*` → **Giữ máy** → **Lịch sử thuê → Trả tiền PCP thử** → chờ `active / granted` (~1,5 phút) → **Mở màn hình** (desktop Linux hiện trong khung nhúng) → **Kết thúc sớm** → chờ `settled / reset_verified`.
Kiểm tự động qua giao diện: `node scripts/vm/app-session-e2e.mjs C:/cpm-demo/state.json <thư mục ảnh>` (Edge, cần Vite dev đang chạy với hai biến trên) hoặc `CHECK_TAURI_EXE=<exe> node scripts/vm/app-session-e2e.mjs …` (trong app đã cài). Kiểm không giao diện: `scripts/vm/renter-session-e2e.mts`.
**Lưu ý đã gặp**: tiến trình cũ giữ cổng 3000 làm quote mang token cũ (start-demo dọn bằng dòng lệnh tiến trình, không theo tên tệp); PowerShell 5.1 làm mất dấu nháy kép khi gọi lệnh native; VM VirtualBox trên Windows này có thể treo (đã chọn 1 vCPU); reset guest có lần mất tới ~8 phút; kết nối Supabase từ máy dev đứt thoáng qua vài lần.

### Chế độ công khai: Fuji + tunnel cho người thử ở máy khác (12/11/2026, chưa chạy lần nào)

```powershell
node scripts\fuji\fuji.mjs status                                  # đủ AVAX chưa
node scripts\fuji\fuji.mjs deploy                                  # một lần
powershell -NoProfile -File scripts\public\get-cloudflared.ps1      # tải bản ghim + kiểm SHA-256
powershell -NoProfile -File scripts\vm\build-demo-app.ps1 -Profile tester   # bộ cài cho người thử (C:\cpm-demo\release)
powershell -NoProfile -File scripts\vm\start-demo.ps1 -Chain fuji -Tunnel -Guest wsl   # máy chủ công khai; in MÃ KẾT NỐI
```

`-Chain fuji` không bật chuỗi Hardhat, đọc `C:\cpm-demo\fuji\server.env`, chạy web bản production; `-Tunnel` bật proxy hẹp (cổng 3100, chỉ `/api/*`) và Cloudflare quick tunnel, in địa chỉ `https://….trycloudflare.com` (đổi mỗi lần chạy). `stop-demo.ps1` tắt cả hai. Người thử làm theo [TESTER_GUIDE](TESTER_GUIDE.md); từ 20/11/2026 (sau khi áp migration `20261120000001`) host tự đăng ký, tự đăng máy và tự ghi danh trong app, không cần admin; `npx tsx scripts/public/admin.mts` còn dùng để đình chỉ (`suspend-machine`) và cho các lệnh làm tay cũ. Thật/giả: ví thử + Fuji **thật** (testnet) nhưng chưa chạy lần nào; stream qua tunnel và WSL2 **chưa thử**.

## 3. Thật / giả

| Phần | Trạng thái |
|---|---|
| Đăng nhập, danh mục, đăng máy, cam kết, lịch, giữ máy (Supabase dev) | **Thật**, đã kiểm trên project dev (smoke 9/9, trình duyệt 28/28, chạy lại 09/11 bằng `scripts/browser-check-live.mjs`) |
| API ví / quote / đối soát / enrollment / kênh agent / workspace | Thật trên Postgres cục bộ; migration đã có trên Supabase dev (thăm dò API) **`smoke:server` đã chạy trên Supabase dev thật: 8/8 (09/11)** — ví, quote, enrollment/heartbeat, workspace/lease; không chuỗi khối, chưa chạy worker/API HTTP trên Supabase |
| Chữ ký quote ↔ RentalEscrow, operator activate | Thật trên Hardhat cục bộ; **chưa Fuji** |
| Worker vòng đời phiên | Thật trên Supabase dev + chuỗi **Hardhat cục bộ** (mô phỏng): giữ máy → fund → activate → xem → accept/claim sau ân hạn → thu hồi → reset guest → nhả máy (10/11). Chưa trên Fuji |
| Gateway, host-agent, guest Docker | Thật với **Selkies thật trong VM** (không GPU): stream, chuột, bàn phím, thu hồi, reset container, trong iframe của app Tauri đã cài. VM 1 vCPU hay đình trệ; hiệu năng/độ trễ/âm thanh chưa đo |
| Host trong app (Cho thuê máy → Thiết lập & chạy máy), guest = **VM Linux thử** | Thật trong app đã cài (12/11): kiểm guest, cài agent, ghi danh bằng mã, bắt đầu/dừng nhận thuê, heartbeat do máy chủ ghi nhận, danh sách phiên cho host, tắt cứng app ⇒ agent tự dừng và dọn guest. Agent chạy **trong guest**. VM 1 vCPU, không GPU |
| Host trong app, guest = **WSL2** | **Chưa chạy**: máy dev chưa cài WSL (cần admin + khởi động lại, việc của bạn: `docs/HOST_WINDOWS_WSL.md` §3). Đã có: lớp native biên dịch được, dòng lệnh `wsl.exe --exec` kiểm đơn vị, app báo đúng trạng thái "chưa cài WSL" thật của máy này |
| Selkies/NVENC trong WSL2, hiệu năng GPU | **Chưa thử**; tài liệu Selkies và NVIDIA không nêu |
| Ví trong app | **VÍ GIẢ LẬP** (chỉ chuỗi cục bộ loopback, khoá sinh trong trình duyệt): liên kết bằng chữ ký, trả tiền (approve+fund), hủy trước kích hoạt, kết thúc (accept), đã kiểm qua giao diện (Edge 11/11 và app Tauri đã cài 11/11). **Chưa thử với ví thật** (trong app native chưa có connector) |
| Thanh toán PCP | Chạy với ví giả lập trên chuỗi cục bộ. **Chưa Fuji** (cần ví thật + AVAX Fuji + RPC) |
| Guest Linux + Selkies, stream trong WebView2 | Đã chạy trong VM thử (không GPU) và trong WebView2; **chưa** trên máy Linux có GPU thật |
| App Tauri, installer | Build được (exe + NSIS 2,41 MiB, chưa ký); bản **đã cài** trên máy dev chạy trong WebView2: CDP 7/7 và bộ kiểm live 28/28. **Chưa** thử máy khác, chưa ký số, chưa có command native/Selkies trong WebView2 |
| S3 cho workspace | **Chưa** (chỉ LocalFsStore dev) |

## 4. Đầu vào cần để có vòng thuê thật trên hai máy
Xem danh sách trong báo cáo cuối mốc (`docs/PROGRESS.md`, mục “Tích hợp E2E”). Không có đầu vào nào được suy ra từ việc duyệt UI.

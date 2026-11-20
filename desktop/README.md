# Cloud PC Companion — frontend desktop (bản xem trước)

> **Lưu ý (19/11/2026):** phần "toàn bộ là mô phỏng" dưới đây mô tả **chế độ preview** và trạng thái lúc viết (08/11). Chế độ `live` hiện nối Supabase, Fuji và host WSL2 thật. Trạng thái hiện hành: [README mục 3](../README.md#3-đã-kiểm-và-chưa-kiểm), [PROGRESS](../docs/PROGRESS.md).

Một app cho cả người thuê và người cho thuê máy. **Toàn bộ là mô phỏng**: không backend, blockchain, ví, remote/Selkies, host-agent hay cloud thật. Bản chạy trong trình duyệt là preview giao diện app, không phải sản phẩm web. Frontend dùng lại khi đóng gói Tauri sau này (router hash, không SSR).

## Chạy

```powershell
npm install                      # tại gốc repo (npm workspaces)
npm run dev -w @cpm/desktop      # http://127.0.0.1:5174
npm run build -w @cpm/desktop    # typecheck + vite build
npm run typecheck -w @cpm/desktop
npm run lint -w @cpm/desktop
npm run test -w @cpm/desktop
```

Stack: React 19, TypeScript 6, Vite 8, Tailwind 4, primitives kiểu shadcn/ui (Radix) trong `src/ui`, Lucide, Motion, zustand. Spec Kit: `specs/002-desktop-companion-ui/`.

## Cấu trúc

```
src/domain/    logic thuần + test: pricing, schedule, session (máy trạng thái), compat, access, wallet, filters
src/mock/      fixtures.ts (dữ liệu tập trung), service.ts (dịch vụ giả + kịch bản), scenarios.ts
src/state/     store (zustand), useAsync, filtersStore
src/ui/        Button, Dialog, Tabs, Switch, Slider, Badge, Banner, Skeleton, EmptyState...
src/layout/    AppShell, Sidebar, TopBar, ModeSwitch, DemoPanel, Toast
src/features/  auth, common, renter, host
```
Quy tắc: component không import fixtures; đọc dữ liệu qua `useAsync(service.*)`, thao tác qua store.

## Chế độ preview và live

`VITE_APP_MODE=preview` (mặc định, khi không có `desktop/.env.local`): toàn bộ dữ liệu mẫu có nhãn. `VITE_APP_MODE=live`: nối Supabase dev thật cho **đăng nhập, danh mục máy, đăng máy/cam kết/lịch (host), giữ máy (booking `reserved`)**; mọi mục khác hiện “Tính năng đang được hoàn thiện” (không rơi về dữ liệu mẫu). Cấu hình sai ở chế độ live → màn lỗi cấu hình. Hướng dẫn: `docs/SUPABASE_DEV_SETUP.md` mục 9. Kiểm tra: `npm run check:env` (gốc repo) và `npm run smoke:supabase`.

## Vỏ native Tauri

`src-tauri/` là vỏ Tauri 2 tối thiểu (cửa sổ 1280×800, CSP chặt: `connect-src` cho Supabase + localhost, `font-src` chỉ nội bộ, `frame-src` chỉ localhost cho spike viewer; font Be Vietnam Pro đóng gói cục bộ qua `@fontsource`, không gọi Google Fonts). **Đã build được trên máy dev (09/11/2026)** sau khi cài VS Build Tools 2022 + rustup (rustc/cargo 1.99.1, toolchain stable-msvc). Build (đặt thư mục build Rust ngoài OneDrive, đường dẫn ASCII):

```powershell
# Cách khuyến nghị: script đặt đúng biến, đóng gói agent rồi build (và cài với -Install)
powershell -ExecutionPolicy Bypass -File scripts\vm\build-demo-app.ps1            # chỉ build
powershell -ExecutionPolicy Bypass -File scripts\vm\build-demo-app.ps1 -Install   # build + cài cho người dùng hiện tại (/S, không admin)

# Thủ công
$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path
$env:CARGO_TARGET_DIR = "C:\cpm-tauri-target"      # ngoài OneDrive, đường dẫn ASCII
npm run tauri -w @cpm/desktop -- build               # beforeBuildCommand tự đóng gói agent; bộ cài: C:\cpm-tauri-target\release\bundle\nsis\
```

Lớp native (`src-tauri/src/host.rs`) có 10 lệnh cố định cho chế độ Cho thuê (kiểm tra WSL2/guest, cài, ghi danh, bắt đầu/dừng agent); xem `docs/HOST_WINDOWS_WSL.md`. Agent và script guest được nhúng vào app lúc build (`include_bytes!`), nên phải đóng gói agent (`npm run bundle -w @cpm/host-agent`; script build và `beforeBuildCommand` làm sẵn) trước khi biên dịch Rust. Test Rust: `cargo test --release --lib` trong `desktop/src-tauri`.

Vite đọc `desktop/.env.local` lúc build nên bản cài mang cấu hình live (chỉ key publishable). Khi app chạy trong Tauri origin là `http://tauri.localhost`: nếu dùng API server (`VITE_API_BASE_URL`) thì phải thêm origin này vào `ALLOWED_ORIGINS` của server và thêm domain API https vào `connect-src` trong `tauri.conf.json`. **Đã kiểm**: exe chạy, cửa sổ mở, giao diện live render, fetch tới Supabase qua CSP 200, font nạp cục bộ, không lỗi console (CDP/WebView2). Đã cài trên máy này (09/11) và kiểm live 28/28 trong app đã cài; viewer Selkies trong iframe đã kiểm (xem `docs/PROGRESS.md`). **Chưa**: ký số (installer chưa ký → SmartScreen cảnh báo), cập nhật tự động, command native, Selkies trong WebView2, trình cài trên máy khác.

## Cách xem
1. Mở `/#/welcome` → “Vào nhanh với tài khoản demo” → chọn chế độ.
2. **Hành trình khách**: Thuê máy → Khám phá (tab Game/Đồ họa/Lập trình, lọc, so sánh) → Chi tiết → Thuê máy này → Xác nhận → chuẩn bị (≈4 s) → Vào phiên → viewer minh họa (dùng “Tua nhanh”, “Mô phỏng mất kết nối”) → Kết thúc → lưu workspace → dọn dẹp → hoàn tất → Lịch sử/Số dư.
3. **Hành trình host**: đổi sang Cho thuê máy (thanh trên, không đăng xuất) → Bắt đầu thiết lập (7 bước; thử các “hồ sơ máy mô phỏng” để thấy không đạt/không GPU) → Gửi duyệt → ở bước Trạng thái dùng nút demo “được duyệt/bị từ chối” → Tổng quan: bật/tạm nghỉ nhận phiên, “Demo: mô phỏng có khách thuê”, kết thúc phiên, Thu nhập, Sự cố, Chạy nền & dừng.
4. Nút **Demo** ở thanh trên chọn kịch bản: Thành công, Chưa có dữ liệu, Đang tải chậm, Lỗi dịch vụ, Mất mạng, Host chưa duyệt, Lỗi lưu workspace, Lỗi cleanup.

## Màn hình (đã làm, không có menu trống)
Chung: chào mừng, đăng nhập, đăng ký, khôi phục mật khẩu, chọn chế độ, tài khoản, thông báo, hỗ trợ (FAQ + form), cài đặt, số dư & giao dịch (tách số dư để thuê / thu nhập host).
Thuê: khám phá + tìm/lọc/sắp xếp, so sánh, chi tiết (môi trường, ứng dụng/game có mức hỗ trợ, khung giờ), xác nhận (thời lượng ≤ cửa sổ host, giá, phí 10%, kết thúc sớm vẫn trả cả gói, workspace), phiên (chuẩn bị, sẵn sàng, viewer + toolbar + toàn màn hình, reconnect, kết thúc → lưu → dọn dẹp → hoàn tất, các lỗi), workspace, lịch sử, chi tiết phiên.
Cho thuê: thiết lập 7 bước (quyền → kiểm tra máy → thành phần/quyền/đồng ý → cài mô phỏng → tài nguyên/giá/lịch tuần/ngoại lệ → xem trước/gửi → trạng thái duyệt), tổng quan máy, cấu hình, phiên, thu nhập, sự cố (thử dọn lại), chạy nền / đóng cửa sổ / dừng cung cấp.

## Quy tắc đã mã hóa và có test (`src/domain/domain.test.ts`)
Đổi chế độ không đổi `hostApproval`; không nhận thời lượng vượt cửa sổ host; lịch báo giờ sai, không bội 15′, quá ngắn, chồng lấn, ngoại lệ tạm bỏ ngày; kết thúc sớm trả cả gói / chuẩn bị lỗi hoàn đủ; cleanup lỗi ⇒ máy `blocked`, không nhảy sang hoàn tất; lưu workspace lỗi chờ người dùng; thu nhập host giữ tới khi cleanup xong; số dư và thu nhập tách sổ; lọc máy; kiểm tra tương thích (đạt / không GPU / không đạt).

## Kiểm tra
**Do Codex chạy trong trình duyệt (Edge, 08/11/2026)** — xem `docs/DESKTOP_UI_REVIEW_2026-11-08.md`: 7 màn × 3 kích thước (1024×768, 1280×800, 1440×900) không tràn ngang/lỗi JS; hai hành trình chính thao tác được (khách: tìm → xác nhận → viewer → kết thúc → lưu → cleanup; host: thiết lập → duyệt → nhận phiên); Fullscreen, mất kết nối, dialog/Escape, skip link, kịch bản cleanup lỗi và lưu lỗi, reduced-motion. Codex nêu 3 findings (đã sửa bên dưới, chưa được Codex kiểm lại trên trình duyệt).

**Do Claude chạy (không có trình duyệt)**: `typecheck`, `lint`, `build` đạt; `vitest` 30/30: 19 test domain (có test quyết toán theo đặc tả), 5 smoke render từng màn/phase, 3 test RadioGroup trong jsdom (roving tabindex, mũi tên, Home/End), 3 test tích hợp AppShell + bộ chuyển chế độ thật (xem mục 4).

**Sửa theo review (08/11/2026)**
1. Chính sách tiền: theo `docs/MVP.md` §4 và `docs/CONTRACT_SPEC.md`, kết thúc sớm **trả cả gói** (accept H=P), chưa tính theo phút; chỉ hoàn đủ khi chuẩn bị thất bại trước khi vào phiên. Đã sửa `settle()`, nội dung checkout/viewer/quyết toán/dialog host, fixtures lịch sử và giao dịch, test. Không đổi contract. Hủy ở trạng thái “sẵn sàng” cũng trả cả gói và có hộp xác nhận.
2. Lịch tuần ở 1024px: mỗi ngày dùng 2 hàng (nhãn + thanh 24h tối thiểu 200px; ô giờ ngay dưới), ô giờ rộng 132px, bản xem trước 7 ngày xuống dưới khi viewport < 1280px.
3. Bàn phím: component `RadioGroup` (`src/ui/radio.tsx`) cho bộ chuyển chế độ, `Segmented`, bộ chọn kịch bản demo, thời lượng và workspace ở checkout: roving tabindex, ←/→/↑/↓ chọn và lặp vòng, Home/End, bỏ qua mục bị khóa.

**Codex tái kiểm sau sửa (08/11/2026)**: typecheck/lint/build PASS, Vitest 27/27 PASS. Edge xác nhận quyết toán cả gói; lịch ở 1024/1280/1440 không còn co thanh giờ hoặc tràn ngang. Radio thời lượng hỗ trợ End, Home, mũi tên và bỏ qua mục khóa. **Còn lỗi focus đổi mode**: ArrowRight đổi sang host nhưng AppShell focus main sau đổi route, ArrowLeft tiếp theo không quay lại renter. Xem phần đầu `docs/DESKTOP_UI_REVIEW_2026-11-08.md`; chưa đóng finding bàn phím hoàn toàn.

**Chưa xác minh**: audit bàn phím mọi nhóm, screen reader, Firefox/Safari, hiệu năng, Tauri/WebView2. Build vẫn cảnh báo chunk JS khoảng 701 kB, chưa code-splitting.

## Mô phỏng / chưa làm
Auth, thanh toán, PCP, cài đặt WSL/Docker, Selkies, viewer (khung CSS, không FPS/ping), duyệt host, cleanup, giờ hệ thống (giờ demo cố định Thứ Hai 09/11/2026 20:10 GMT+7). Dữ liệu chỉ ở bộ nhớ, tải lại là reset. Chưa: Tauri, backend, kiểm chứng Selkies/WebView2, app điện thoại, code-splitting (bundle ≈700 kB).

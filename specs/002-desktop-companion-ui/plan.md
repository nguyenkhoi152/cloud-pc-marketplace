# Kế hoạch: Desktop Companion UI

## Kiến trúc
`desktop/` (npm workspace `@cpm/desktop`): React 19 + TypeScript 6 + Vite + Tailwind 4, primitives kiểu shadcn/ui (Radix) trong `src/ui`, Lucide, Motion, zustand cho state.

```
src/
  app/        App.tsx, router (hash), routes
  domain/     types, pricing, schedule (validate), session (state machine), filters   ← thuần, có test
  mock/       fixtures.ts (dữ liệu tập trung), service.ts (async mock + scenario), scenarios.ts
  state/      store (zustand) + actions
  ui/         Button, Badge, Dialog, Tabs, Switch, Slider, Field, Banner, Skeleton, EmptyState...
  layout/     AppShell, Sidebar, TopBar, ModeSwitch, DemoPanel
  features/   auth, common, renter, host (mỗi màn hình một file)
  styles/     index.css (token @theme)
```
Quy tắc: component không import fixtures; chỉ gọi `mock/service` qua hook `useAsync` hoặc action của store.

## Hệ thiết kế (Sky)
- Màu: nền `#EEF6FD`, bề mặt trắng, navy `#0B1F3A`, teal `#0F766E` (nhấn), sky `#CFE9FB`; trạng thái: ok `#15803D`, cảnh báo `#92400E`/`#FEF3C7`, lỗi `#B91C1C`/`#FEE2E2`, thông tin `#1D4ED8`.
- Font: Be Vietnam Pro (dự phòng Segoe UI). Thang: 12/13/14/16/20/24/30.
- Khoảng cách 4px; bo góc 6/10/14; bóng chỉ cho popover/dialog; không gradient/kính mờ.
- Trạng thái luôn có icon + chữ. Motion 120–250ms, `prefers-reduced-motion` tắt.
- Bố cục theo tác vụ: danh sách máy dạng hàng so sánh được; lịch dạng lưới tuần; phiên dạng timeline; chi phí dạng bảng kê.

## Danh mục màn hình
| Nhóm | Route | Màn hình |
|---|---|---|
| Auth | /welcome /login /register /recover /choose-mode | chào mừng, đăng nhập, đăng ký, khôi phục, chọn chế độ |
| Chung | /wallet /notifications /support /settings /account | số dư & giao dịch, thông báo, hỗ trợ, cài đặt, tài khoản |
| Thuê | /rent/discover /rent/compare /rent/machine/:id /rent/checkout/:id /rent/session /rent/workspaces /rent/history /rent/history/:id | khám phá, so sánh, chi tiết, xác nhận, phiên (chuẩn bị/sẵn sàng/viewer/kết thúc/dọn dẹp/hoàn tất/lỗi), workspace, lịch sử, chi tiết phiên |
| Cho thuê | /host /host/onboarding/:step /host/configure /host/sessions /host/earnings /host/incidents /host/runtime | tổng quan máy, thiết lập 7 bước, tài nguyên-giá-lịch, phiên, thu nhập, sự cố, chạy nền & dừng cung cấp |

## Sơ đồ điều hướng
```
Welcome → Login/Register/Recover → ChooseMode ─┬→ Thuê: Discover ⇄ Compare → Machine → Checkout → Session(Prepare→Ready→Live⇄Reconnect→End→Cleanup→Done) → History/Workspace
                                               └→ Host: (chưa duyệt) Onboarding[Intro→Compat→Components→Install→Configure→Preview→Status] → Dashboard ⇄ Sessions/Configure/Earnings/Incidents/Runtime
TopBar: ModeSwitch (không đăng xuất) · Demo ▾ · Tài khoản. Sidebar đổi theo chế độ; mục chung: Số dư, Thông báo, Hỗ trợ, Cài đặt.
```

## Bảng trạng thái
**Phiên**: preparing → ready → active ⇄ reconnecting → ending (lưu workspace nếu chọn) → cleaning → completed. Nhánh lỗi: prepare_failed (hoàn đủ; đã vào phiên thì kết thúc sớm vẫn trả cả gói); save_failed (thử lại/bỏ qua có xác nhận, vẫn cleanup); cleanup_failed (dừng, máy **blocked**, phát sinh sự cố host, không về available).
**Host duyệt**: none → pending → approved | rejected → (sửa/gửi lại) pending. Chế độ host không đổi giá trị này.
**Máy host**: offline | paused | accepting | busy | blocked. Nhận phiên mới chỉ khi approved ∧ agent chạy ∧ accepting ∧ trong khung giờ ∧ không blocked.
**Kịch bản demo**: normal, empty, loading, error, offline, host-pending, workspace-save-fail, cleanup-fail.
**Lịch**: hợp lệ | giờ sai (bắt đầu ≥ kết thúc, không bội 15 phút, <30 phút) | chồng lấn | qua nửa đêm (phải tách khung).

## Kiểm thử
Vitest cho domain: lịch, giới hạn thời lượng theo cửa sổ host, máy trạng thái phiên, đổi chế độ không cấp host, lọc máy, tách số dư/thu nhập. Playwright CLI cho hai hành trình + đa kích thước + bàn phím.

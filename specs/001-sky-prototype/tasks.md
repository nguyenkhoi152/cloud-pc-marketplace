# Tasks: Bản mẫu giao diện "Sky"

**Input**: specs/001-sky-prototype/ (spec, plan, research, data-model, contracts, quickstart)
**Tests**: Kiểm tra bằng ảnh chụp và script Edge headless (không viết bộ test tự động riêng).
**Phạm vi**: chỉ `design-preview/` và `specs/`. Không sửa `web/`, `db/`, `contracts/`, `packages/`.

## Phase 1: Setup

- [x] T001 Chuyển bản "Trust Console" cũ (index/machines/machine/session.html, styles.css) vào `design-preview/archive-v1/` để giữ so trước/sau
- [x] T002 [P] Tạo `design-preview/styles.css` mới: token màu (nền xanh trời, navy `#0b1f3a`, teal `#0f766e`/`#14b8a6`), thang cỡ chữ dùng `clamp()`, thang khoảng cách 4/8, bo góc, bóng; import Be Vietnam Pro có dự phòng hệ thống
- [x] T003 [P] Tạo `design-preview/assets/hero-pc-cloud.svg`: minh hoạ PC tower + đám mây tự vẽ, không mascot/hình của Thinkmay, có `<title>`/`<desc>`
- [x] T004 [P] Tạo `design-preview/app.js` khung: menu mobile (`aria-expanded`), đọc query lọc; không phụ thuộc thư viện

## Phase 2: Foundational (chặn mọi story)

- [x] T005 Trong `styles.css`: header nổi dạng viên thuốc (sticky, trong mờ nhẹ, mobile thu gọn), nút (chính/phụ/khoá), thẻ, chip "Dữ liệu mẫu", focus ring, mục tiêu chạm ≥ 44px
- [x] T006 Trong `styles.css`: nền gradient xanh trời + mây CSS (`transform`), animation nổi/trôi, khối `@media (prefers-reduced-motion: reduce)` tắt hết
- [x] T007 Trong `app.js`: hành vi menu mobile (Enter/Space/Esc, đóng khi bấm liên kết); nav hiện đầy đủ mặc định, chỉ thu gọn khi JS thêm lớp `js` vào thẻ html
- [x] T008 Dựng khung HTML chung (head, skip link, dải thông báo dữ liệu mẫu, header nổi, footer) lặp trong 4 trang; T028 kiểm tra các bản lặp giống nhau

## Phase 3: User Story 1 - Trang giới thiệu (P1)

**Goal**: hiểu sản phẩm và sang trang tìm máy.
**Independent Test**: mở `index.html` ở 1440/390px, đủ các phần, nút Tìm máy hoạt động.

- [x] T009 [US1] `design-preview/index.html`: hero hai cột (tiêu đề navy lớn + dòng nhấn teal, mô tả, CTA "Tìm máy", ghi chú gói demo 15 phút/20 PCP thử, hình SVG), mobile xếp dọc
- [x] T010 [US1] `index.html`: phần chọn nhu cầu (3 thẻ dẫn tới `machines.html` kèm tham số lọc)
- [x] T011 [US1] `index.html`: phần máy minh hoạ (3 thẻ fixture, nhãn dữ liệu mẫu, không số đo)
- [x] T012 [US1] `index.html`: ba bước thuê (Giữ máy và nạp escrow → Kết nối bằng Moonlight → Kết thúc và thanh toán), chú thích phần chưa làm
- [x] T013 [US1] `index.html`: khu vực dành cho host và phần giải thích workspace (đúng MVP: project, 100 MiB, 3 checkpoint; ghi "chưa hoạt động trong bản mẫu")
- [x] T014 [US1] `index.html`: FAQ bằng `<details>` chỉ dựa trên MVP; CTA cuối; footer
- [x] T015 [US1] `styles.css`: bố cục các phần của trang giới thiệu, khoảng thở rộng, hiệu ứng xuất hiện nhẹ bằng CSS

## Phase 4: User Story 2 - Trang tìm máy và so sánh (P1)

**Goal**: lọc và so sánh cấu hình/giá/thời lượng.
**Independent Test**: `machines.html` lọc VRAM ≥ 12 còn 1 máy; chọn 2–3 máy mở so sánh.

- [x] T016 [US2] `design-preview/machines.html`: tiêu đề, bộ lọc (q, RAM, VRAM, giá tối đa, OS, vùng, workspace), số kết quả, vùng thông báo rỗng
- [x] T017 [US2] `machines.html`: 3 thẻ máy với hàng thông số thứ tự cố định, `data-*` cho lọc, nhãn "Dữ liệu mẫu" và "chưa xác định", checkbox "So sánh"
- [x] T018 [US2] `machines.html`: khu so sánh (bảng thẳng hàng desktop, xếp chồng mobile) ẩn khi chưa chọn
- [x] T019 [US2] `app.js`: lọc theo `data-*`, đọc query string, cập nhật số kết quả và thông báo rỗng (`aria-live="polite"`), xoá lọc
- [x] T020 [US2] `app.js`: chọn tối đa 3 máy và dựng bảng so sánh; chặn chọn thứ 4 kèm thông báo
- [x] T021 [US2] `styles.css`: thẻ máy, bộ lọc (cột bên desktop, thu gọn mobile), bảng so sánh

## Phase 5: User Story 3 - Duyệt bản mẫu (P1)

**Goal**: chủ dự án mở, xem ảnh, biết phần chưa kiểm chứng.

- [x] T022 [US3] `design-preview/README.md`: cách mở, cấu trúc, giả định, danh sách chưa kiểm chứng, ghi chú không dùng tài sản Thinkmay
- [x] T023 [US3] Chụp ảnh toàn trang 390/768/1440 cho cả bốn trang vào `design-preview/screenshots/` (bằng script T024)
- [x] T024 [US3] Script Node tạm (ngoài repo, scratchpad) điều khiển Edge headless qua DevTools Protocol: đo `scrollWidth` so với viewport, thu lỗi console, chụp toàn trang; ghi kết quả vào README

## Phase 6: User Story 4 - Chi tiết và phiên thuê (P3)

- [x] T025 [US4] `design-preview/machine.html`: dựng lại theo phong cách mới (cấu hình khai báo, cam kết host, bảng giá 20/2/18 PCP, nút đặt bị khoá kèm lý do, thanh CTA mobile)
- [x] T026 [US4] `design-preview/session.html`: dựng lại theo phong cách mới (8 trạng thái remote riêng, vùng desktop chờ, escrow, workspace NotEnabled, nút khoá kèm lý do)

## Phase 7: Polish & kiểm tra chéo

- [x] T027 Quét chuỗi cấm trong `design-preview/*.html|css|js`: fps, ping, online, đánh giá sao, "Thinkmay", số người dùng; sửa nếu có
- [x] T028 Kiểm tra tương phản các cặp màu chính ≥ 4.5:1, focus bằng bàn phím, reduced-motion, tắt JS vẫn đọc được
- [x] T029 Xem ảnh chụp, sửa lỗi thấy được (dấu bị cắt, tràn ngang, chồng lấn), chụp lại
- [x] T030 Đối chiếu lại spec (FR-001..FR-016, SC-001..SC-008) và cập nhật README + `docs/PROGRESS.md` ghi mốc, ảnh, chưa kiểm chứng

## Dependencies

- T001 trước T002..T004 (không ghi đè bản cũ).
- Phase 2 chặn Phase 3–6.
- US1 và US2 độc lập sau Phase 2; US3 cần US1+US2; US4 sau US2.
- Cờ [P]: T002, T003, T004 song song.

## Chiến lược

MVP là US1 + US2 (hai trang chính) rồi US3 để duyệt; US4 làm sau để đồng bộ phong cách. Dừng sau T030 chờ chủ dự án duyệt, không đưa vào `web/`.

## Phase 8: Hoàn thiện hình ảnh và chuyển động (2026-11-07)

- [x] T031 Sửa lỗi lọc để lại ô trống: ẩn `<li>` thay vì thẻ trong `design-preview/app.js` và `styles.css` (FR-017)
- [x] T032 Sửa trang phiên thuê: thay khung "vùng desktop" bằng sơ đồ trang web, Moonlight, Sunshine trong `session.html` (FR-018)
- [x] T033 Vẽ lại hero nhiều lớp (mây sau, thùng máy, laptop, luồng kết nối, mây trước) trong `assets/hero-pc-cloud.svg`, nhúng vào `index.html` (FR-019)
- [x] T034 Chuyển động hero chỉ trong hero, tạm dừng khi ra khỏi màn hình, giảm trên mobile trong `styles.css`, `app.js` (FR-019)
- [x] T035 Hiện khi cuộn bằng IntersectionObserver, không ẩn phần tử đã trong màn hình, không có JS vẫn đọc được (FR-020)
- [x] T036 Hover/nhấn cho thẻ và nút; bộ thời lượng và đường cong chung (FR-021)
- [x] T037 Mượt hoá lọc (rời đi, FLIP), so sánh, trạng thái rỗng, menu, FAQ (FR-021)
- [x] T038 Reduced-motion tắt mọi chuyển động và hiện nội dung ngay (FR-021)
- [x] T039 Đánh giá thư viện chuyển động và ghi quyết định không thêm vào `research.md` (FR-022)
- [x] T040 Kiểm tra tương tác thật bằng Edge headless: cuộn, hover, nhấn, mở/đóng, lọc, số hoạt ảnh lặp, reduced-motion

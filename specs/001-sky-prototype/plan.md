# Implementation Plan: Bản mẫu giao diện "Sky"

**Branch**: `001-sky-prototype` (chỉ là định danh spec; làm việc trên `main`, không tạo nhánh) | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-sky-prototype/spec.md`

## Summary

Dựng lại `design-preview/` thành hai trang chính (giới thiệu, tìm máy) cộng chi tiết máy và phiên thuê, theo phong cách nền xanh trời, chữ navy, nhấn teal, header nổi, hình PC/cloud SVG tự vẽ. Làm bằng HTML + một file CSS + một file JS nhỏ, không thêm thư viện; kiểm tra bằng Edge headless ở 390/768/1440px. Không sửa `web/`, `db/`, `contracts/`.

## Technical Context

**Language/Version**: HTML5, CSS3 (custom properties, grid, `clamp()`, `@media`), JavaScript ES2020 không build.

**Primary Dependencies**: Không có. Font Be Vietnam Pro tải từ Google Fonts khi có mạng, dự phòng font hệ thống.

**Storage**: N/A (dữ liệu mẫu nằm trong HTML, lấy từ `packages/shared/src/fixtures.ts`).

**Testing**: Edge headless chụp màn hình 390/768/1440; script kiểm tra tràn ngang và lỗi console bằng cờ dòng lệnh của Edge; kiểm tra tương phản bằng tính toán; rà soát thủ công bàn phím và reduced-motion.

**Target Platform**: Trình duyệt hiện đại (Chromium/Edge kiểm chứng; Firefox/Safari chưa kiểm).

**Project Type**: Bản mẫu web tĩnh, tách khỏi ứng dụng Next.js trong `web/`.

**Performance Goals**: Không có mục tiêu số; tránh ảnh nặng (chỉ SVG), hiệu ứng chỉ `transform`/`opacity`.

**Constraints**: Mở trực tiếp bằng `file://` hoặc server tĩnh; không build step; không tràn ngang; không dữ liệu giả ngoài fixture; không tài sản Thinkmay.

**Scale/Scope**: 4 trang HTML, 1 CSS, 1 JS, 1 SVG hero, 3 máy mẫu.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Đánh giá |
| --- | --- |
| I. Giữ kiến trúc | Đạt: không đụng `web/`, `db/`, `contracts/`, `packages/`; chỉ thêm trong `design-preview/` và `specs/`. Việc chuyển sang Next.js/Tailwind để sau khi duyệt. |
| II. Dữ liệu mẫu rõ | Đạt: FR-008, SC-004; chỉ dùng 3 máy fixture, nhãn "Dữ liệu mẫu", trạng thái "chưa xác định". |
| III. Không quảng cáo chưa có | Đạt: FR-009, FR-010; nút cần backend bị khoá; mục nav chưa có trang ghi "chưa có trong bản mẫu". |
| IV. Bất biến tiền/quyền | Không áp dụng trực tiếp (không đụng tiền/quyền). Bảng giá chỉ hiển thị 20 PCP, phí 10% đúng cấu hình; UI nói rõ trả cả gói khi kết thúc sớm. |
| V. Bằng chứng | Kế hoạch kiểm tra bằng ảnh chụp và script; báo rõ phần chưa kiểm chứng. |
| VI. Thiếu đầu vào | Đạt: không cần đầu vào ngoài; ảnh người dùng chưa có thì dùng ảnh khảo sát cục bộ, ghi ở Assumptions. |
| Ràng buộc giao diện | Đạt: tiếng Việt, a11y, mobile, bản mẫu trong `design-preview/`, chờ duyệt. |

Không vi phạm; không cần Complexity Tracking. Re-check sau Phase 1: vẫn đạt.

## Project Structure

### Documentation (this feature)

```text
specs/001-sky-prototype/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ui-contract.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
design-preview/
├── index.html            # trang giới thiệu (thay hub cũ)
├── machines.html         # trang tìm máy + so sánh
├── machine.html          # chi tiết máy (đổi phong cách)
├── session.html          # phiên thuê (đổi phong cách)
├── styles.css            # token + thành phần dùng chung
├── app.js                # menu, lọc, so sánh (không bắt buộc để đọc nội dung)
├── assets/
│   └── hero-pc-cloud.svg # minh hoạ PC/cloud tự vẽ
├── README.md             # cách mở, cấu trúc, giả định, chưa kiểm chứng
├── archive-v1/           # bản "Trust Console" cũ, giữ để so trước/sau
└── screenshots/          # ảnh kiểm tra 390/768/1440
```

**Structure Decision**: Giữ thư mục `design-preview/` phẳng, không build. Bản cũ chuyển vào `archive-v1/` thay vì xoá để chủ dự án đối chiếu trước/sau và không ghi đè công việc đang làm dở.

## Complexity Tracking

Không có vi phạm cần biện minh.

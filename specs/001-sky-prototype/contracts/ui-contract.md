# UI Contract: Bản mẫu giao diện "Sky"

## Trang và liên kết

| Trang | Tệp | Liên kết ra |
| --- | --- | --- |
| Giới thiệu | `index.html` | Tìm máy (`machines.html`) từ header, hero, thẻ nhu cầu, máy minh hoạ, CTA cuối |
| Tìm máy | `machines.html` | Giới thiệu (logo, nav), chi tiết (`machine.html`) |
| Chi tiết máy | `machine.html` | Tìm máy, phiên thuê (`session.html`) |
| Phiên thuê | `session.html` | Tìm máy, giới thiệu |

Mục "Dành cho host" và "Workspace" trong nav là neo cuộn tới phần tương ứng của trang giới thiệu. Chỉ "Ví PCP" chưa có trang: phần tử không điều hướng, `aria-disabled="true"`, chú thích "chưa có trong bản mẫu".

## Thành phần dùng chung

- **Header nổi**: logo chữ + biểu tượng, nav, CTA "Tìm máy"; nút menu `aria-expanded` ở dưới 900px; `aria-current="page"` cho trang hiện tại.
- **Nhãn dữ liệu mẫu**: chip vàng trên mọi thẻ máy; dải thông báo toàn trang nhỏ, không chiếm nhiều chỗ.
- **Nút bị khoá**: `disabled` kèm đoạn lý do ngay dưới.
- **Thẻ máy**: thứ tự thông số cố định (CPU, RAM, GPU/VRAM, OS, vùng, cam kết host, giá/thời lượng, workspace, trạng thái).

## Tham số lọc (client-side, `machines.html`)

`q`, `minRam`, `minVram`, `maxPrice`, `os`, `region`, `workspaceOnly`. Đọc từ chuỗi truy vấn khi mở từ thẻ nhu cầu (ví dụ `machines.html?minVram=12`).

## Quy tắc a11y

Tương phản chữ ≥ 4.5:1; focus nhìn thấy; mục tiêu chạm ≥ 44px; `prefers-reduced-motion` tắt mọi animation; hình hero có `alt` mô tả; biểu tượng trang trí `aria-hidden`.

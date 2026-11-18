# Research: Bản mẫu giao diện "Sky"

Không còn NEEDS CLARIFICATION. Các quyết định thẩm mỹ được tự chọn và ghi lại để chủ dự án sửa.

## Quyết định

| # | Quyết định | Lý do | Phương án đã xét |
| --- | --- | --- | --- |
| 1 | HTML/CSS tĩnh + JS nhỏ trong `design-preview/` | Mở bằng `file://`, không cần build, không đụng `web/` | Dựng trang Next.js trong `web/` (cấm theo yêu cầu); Storybook (thêm dependency không cần) |
| 2 | Không thêm thư viện chuyển động | Hiệu ứng nổi nhẹ, trôi mây, xuất hiện khi cuộn đều làm được bằng CSS `transform`/`opacity`; THINKMAY_UI_REVIEW cũng kết luận chưa cần | Motion (`motion/react`) chỉ hợp khi đã ở trong React; GSAP, Three.js không có lợi ích cụ thể |
| 3 | Hình PC/cloud là SVG tự vẽ (`assets/hero-pc-cloud.svg`) | Sắc nét mọi độ phân giải, nhẹ, không phụ thuộc bản quyền ảnh; tránh mascot/hình của Thinkmay | Ảnh WebP từ nguồn ngoài (bản quyền chưa rõ); model 3D (nặng, không cần) |
| 4 | Font Be Vietnam Pro (Google Fonts) + dự phòng hệ thống | Hỗ trợ dấu tiếng Việt tốt, giấy phép mở (OFL); không dùng "May Display" | Inter (kém trong tiêu đề Việt), font độc quyền (không được) |
| 5 | Bảng màu: nền xanh trời `#cfe8fb → #eaf5ff`, navy `#0b1f3a`, teal `#0f766e` (chữ) / `#14b8a6` (trang trí), nền thẻ trắng | Tương phản navy trên xanh nhạt > 12:1; teal đậm đạt 4.5:1 trên trắng cho chữ nút; teal sáng chỉ dùng trang trí | Dark navy toàn trang (bị loại theo yêu cầu) |
| 6 | Trang tìm máy: thẻ có hàng thông số cố định thứ tự, cộng khu so sánh tối đa 3 máy | Dễ so sánh mà không thêm dữ liệu | Bảng so sánh luôn hiện (chật trên mobile) |
| 7 | Lọc/so sánh bằng JS, thẻ vẫn là HTML tĩnh | Không có JS vẫn đọc được danh sách | Render thẻ hoàn toàn bằng JS (hỏng khi tắt JS) |
| 8 | FAQ dùng `<details>/<summary>` | Truy cập tốt, không cần JS | Accordion tự viết |
| 9 | Menu mobile dùng nút có `aria-expanded` | Tiêu chuẩn a11y, mục tiêu chạm 44px | Nav cuộn ngang (khó khám phá) |
| 10 | Chỉ 3 máy mẫu từ fixture | Không bịa thêm máy hay số liệu | Thêm máy giả cho đẹp (vi phạm nguyên tắc II) |
| 11 | Ảnh tham chiếu: ảnh khảo sát cục bộ của Thinkmay | Ảnh người dùng gửi chưa có trong hội thoại; chỉ học bố cục (header nổi, hero hai cột, dòng nhấn teal, mây) | Sao chép tài sản (cấm) |
| 12 | Kiểm tra bằng Edge headless (`--screenshot`, `--window-size`) | Có sẵn trên máy, không cần cài Playwright | Cài Playwright (thêm công cụ) |

## Vòng chuyển động (2026-11-07)

| # | Quyết định | Lý do | Phương án đã xét |
| --- | --- | --- | --- |
| 13 | Không thêm Motion for React | Motion (`motion/react`) là thư viện cho React; bản mẫu là HTML tĩnh, nên dùng nó phải kéo React vào hoặc dùng gói `motion` thuần JS qua CDN. Mọi hiệu ứng cần (nổi, trôi, nét đứt chạy, hiện khi cuộn, mở/đóng, FLIP) làm được bằng CSS và Web Animations API có sẵn, không thêm byte nào | Motion thuần JS (dư thừa); GSAP/ScrollTrigger (nặng, hay chiếm quyền cuộn); Lottie (cần tài sản ngoài) |
| 14 | Minh hoạ hero là SVG nhúng trực tiếp, các lớp là nhóm `<g>` có lớp CSS | Cho phép chuyển động từng lớp bằng CSS; một nguồn duy nhất `assets/hero-pc-cloud.svg` được nhúng khi sinh trang | `<img src=svg>` (không điều khiển được từng lớp); nhiều tệp SVG rời (khó đồng bộ vị trí) |
| 15 | Bộ nhịp chuyển động: 120ms nhấn, 200ms trạng thái, 320ms bố cục/xuất hiện, đường cong `cubic-bezier(.2,.7,.2,1)` | Nhất quán, đủ nhanh để không làm chậm đọc | Mỗi thành phần một thời lượng |
| 16 | Hiện khi cuộn bằng IntersectionObserver; phần tử đã trong màn hình lúc tải không bị ẩn; hoạt ảnh `backwards` thay vì chuyển tiếp để hover không bị trễ | Không trì hoãn đọc, không chiếm cuộn | Ẩn mọi thứ rồi hiện lần lượt (chậm đọc) |
| 17 | Mở/đóng menu, so sánh, trạng thái rỗng bằng `grid-template-rows: 0fr → 1fr`; FAQ bằng `::details-content` | Chuyển chiều cao không dùng `height` cố định, không cần JS cho FAQ; trình duyệt chưa hỗ trợ `::details-content` thì mở tức thì | Animate `max-height` (cần đoán chiều cao) |
| 18 | Lọc có hiệu ứng rời đi (opacity/scale), sau đó ẩn thẻ khỏi lưới và dịch chuyển các thẻ còn lại bằng FLIP (WAAPI) | Hết ô trống; chuyển mượt | Chỉ ẩn bằng `hidden` trên thẻ (gây ô trống) |

## Điều học từ tham chiếu mà không sao chép

Header dạng viên thuốc nổi cách mép; hero hai cột với tiêu đề navy đậm và dòng teal; minh hoạ lớn bên phải, xếp dọc trên mobile; mây trang trí; thẻ trắng bo tròn. Không dùng: tên, logo, mascot mặt cười, số game/người dùng, giá, tuyên bố "chạy trong trình duyệt", font tiêu đề.

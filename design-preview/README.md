# Bản mẫu giao diện "Sky"

Bản mẫu tĩnh để chủ dự án duyệt. **Chưa nối vào ứng dụng chính** (`web/`), không có backend, không có số liệu thật. Spec và kế hoạch: `specs/001-sky-prototype/`.

## Cách mở

- Mở trực tiếp `design-preview/index.html` bằng trình duyệt, hoặc
- chạy `python -m http.server 4173 -d design-preview` ở thư mục gốc rồi mở http://localhost:4173/.

Không cần cài gói. Font Be Vietnam Pro tải từ Google Fonts khi có mạng; ngoại tuyến sẽ dùng font hệ thống (dấu vẫn đủ nhưng hình dáng chữ khác).

## Trang

| Trang | Tệp |
| --- | --- |
| Giới thiệu | `index.html` |
| Tìm máy (lọc, so sánh tối đa 3 máy) | `machines.html` |
| Chi tiết máy | `machine.html` |
| Phiên thuê (bố cục mô phỏng) | `session.html` |

Tệp chung: `styles.css`, `app.js` (menu mobile, lọc, so sánh), `assets/hero-pc-cloud.svg` (minh hoạ tự vẽ). Bản "Trust Console" cũ giữ ở `archive-v1/` để so trước/sau. Ảnh kiểm tra (`screenshots/`) nằm trên máy cục bộ, không đưa vào Git để repo gọn.

## Giả định đã chọn (sửa được)

- Phong cách: nền xanh trời sáng, chữ navy lớn, nhấn teal, header nổi dạng viên thuốc; khối tối chỉ ở CTA cuối.
- Hình PC/cloud tự vẽ bằng SVG: thùng máy, đám mây, luồng chấm xuống laptop. Không dùng mascot, ảnh, logo, chữ hay số liệu của Thinkmay.
- Ba nhu cầu ở trang giới thiệu chỉ là lối tắt vào bộ lọc (`minVram=8`, `minRam=16`, `minVram=12`).
- Chỉ 3 máy mẫu từ fixture của dự án; không thêm máy hay số đo.
- Ảnh tham chiếu: ảnh khảo sát cục bộ của Thinkmay (ảnh bạn nhắc chưa có trong hội thoại). Chỉ học bố cục.
- Không thêm thư viện; hiệu ứng nổi/trôi mây bằng CSS và tắt khi bật giảm chuyển động.

## Hình ảnh và chuyển động (vòng hoàn thiện)

- **Hero:** SVG nhiều lớp (mây sau, thùng máy có quạt, laptop, hai luồng chấm kết nối, mây trước). Nguồn duy nhất là `assets/hero-pc-cloud.svg`, được nhúng vào `index.html` khi sinh trang để CSS điều khiển từng lớp.
- **Nhịp chung:** 120ms cho nhấn, 200ms cho trạng thái, 320ms cho bố cục/xuất hiện; đường cong `cubic-bezier(.2,.7,.2,1)` (biến `--dur-1/2/3`, `--ease` trong `styles.css`).
- **Lặp liên tục chỉ trong hero** (8 hoạt ảnh trên desktop, 4 trên mobile: bỏ quạt quay và mây trôi), tạm dừng khi hero ra khỏi màn hình.
- **Hiện khi cuộn:** phần dưới màn hình hiện khi tới gần; phần đã thấy lúc tải không bị ẩn; không có JS thì hiện đầy đủ.
- **Tương tác:** hover/nhấn cho thẻ và nút; lọc có hiệu ứng rời đi rồi các thẻ còn lại dịch chuyển; bảng so sánh, trạng thái rỗng, menu mobile mở/đóng mượt; FAQ mở mượt (cần trình duyệt hỗ trợ `::details-content`, nếu không sẽ mở tức thì).
- **Giảm chuyển động:** bật `prefers-reduced-motion` thì mọi hoạt ảnh/chuyển tiếp tắt và nội dung hiện ngay.
- **Thư viện:** không thêm. Đã đánh giá Motion for React: là thư viện cho React nên không hợp bản mẫu HTML tĩnh, và CSS cộng Web Animations API đủ dùng (lý do ở `specs/001-sky-prototype/research.md`, mục 13).
- **Đã sửa:** bộ lọc không còn để ô trống; trang phiên thuê không còn gợi ý desktop chạy trong trang web (nay có sơ đồ: trang web quản lý phiên, Moonlight hiển thị màn hình, Sunshine ở máy host).

## Đã kiểm tra (Edge headless, giả lập viewport)

Vòng chuyển động kiểm tra bằng thao tác thật qua DevTools Protocol (cuộn bằng bánh xe, di chuột, nhấn chuột, bấm, gõ phím), lấy mẫu giá trị trong lúc chuyển:
- Lọc: `minVram=12` còn 1 máy và thẻ đứng ở cột đầu (không ô trống); `minVram=99` hiện trạng thái rỗng; xoá lọc trả lại 3 máy; độ mờ thẻ rời đi giảm dần 1,00 → 0,27 → 0,07 → 0,01.
- So sánh: chiều cao khối mở dần 0 → 328 → 497 → 565 → 616px; đóng lại về 0.
- FAQ: chiều cao 60 → 89 → 117 → 132 → 137px; đóng về 60.
- Menu mobile: chiều cao 0 → 132 → 184 → 237 → 248px; Esc đóng lại và trả focus về nút.
- Hover thẻ nhu cầu: dịch lên 3px; nhấn nút: thu về 0,98; nhấn "Tìm máy phù hợp" mở `machines.html`.
- Cuộn: 11/11 phần tử hiện khi cuộn tới cuối trang desktop; hero tạm dừng khi cuộn đi và chạy lại khi quay về.
- Hoạt ảnh lặp: 8 ở hero (desktop), 4 (mobile), 0 ở trang tìm máy, chi tiết và phiên thuê; 0 khi bật giảm chuyển động.
- Nhịp khung hình: headless không có GPU nên chỉ tham khảo (trung vị 16,7ms), không chứng minh mượt trên máy thật.
- 4 trang × 390/768/1440px sau khi cuộn: không tràn ngang, 0 lỗi console.

Kiểm tra tĩnh trước đó:

- 4 trang × 390/768/1440px: không tràn ngang, 0 lỗi console, ảnh trong `screenshots/` (`<trang>-<rộng>.png`, `report.json`).
- Lọc `minVram=12` còn 1 máy; không khớp thì hiện thông báo rỗng; chọn 3 máy mở bảng so sánh (ảnh `machines-compare-*.png`); menu mobile mở/đóng (`aria-expanded`); FAQ mở được.
- Tắt JavaScript: nav hiện đầy đủ, danh sách máy vẫn đọc được. Bật giảm chuyển động: animation tắt.
- Tương phản tính toán: chữ chính ≥ 5,4:1; chữ trắng trên nút teal 5,47:1. Dòng nhấn teal trên nền xanh trời đạt 3,6:1, chỉ dùng cho tiêu đề lớn.
- Quét chuỗi cấm: không có fps/ping/benchmark/đánh giá/“Thinkmay”; từ “online” chỉ xuất hiện trong câu giải thích vì sao chưa có.

## Chưa kiểm chứng

- Thiết bị thật (điện thoại, tablet) và trình duyệt khác ngoài Edge/Chromium (Firefox, Safari). FAQ mượt cần `::details-content` và `interpolate-size`, chưa thử trên trình duyệt khác.
- Độ mượt thực tế khi cuộn và chuyển động trên máy cấu hình thấp; chưa đo bằng công cụ hiệu năng có GPU.
- Cảm nhận thẩm mỹ của hình hero vòng hai và nhịp chuyển động cần bạn đánh giá bằng mắt.
- Chế độ tối của hệ điều hành (bản mẫu chỉ thiết kế giao diện sáng).
- Bàn phím và trình đọc màn hình mới rà bằng mã (focus ring, nhãn, thứ tự), chưa thử bằng trình đọc màn hình thật.
- Giới hạn "tối đa 3 máy" khi so sánh chưa thử thực tế vì chỉ có 3 máy mẫu.
- Cảm nhận thẩm mỹ (SC-001) cần chủ dự án đánh giá; minh hoạ hero là bản đầu, có thể cần thiết kế lại.
- Chưa chuyển sang Next.js/Tailwind; việc đó chỉ làm sau khi bạn duyệt.

## Chia sẻ qua URL (GitHub Pages)

- Workflow `.github/workflows/pages.yml` chỉ đóng gói bốn trang HTML, `styles.css`, `app.js` và `assets/`; không đưa `archive-v1/`, ảnh kiểm tra, tài liệu hay file cấu hình.
- Mọi đường dẫn là tương đối nên chạy được dưới `/<tên-repo>/` (đã thử mô phỏng dưới `/cloud-pc-marketplace/`: tài nguyên, 7 liên kết nội bộ và điều hướng giữa bốn trang đều chạy).
- Có thẻ `noindex` để công cụ tìm kiếm không lập chỉ mục bản mẫu; ai có URL vẫn mở được.
- URL dự kiến: `https://nguyenkhoi152.github.io/cloud-pc-marketplace/`. Cần bật Pages với nguồn "GitHub Actions" trong Settings → Pages của repo.

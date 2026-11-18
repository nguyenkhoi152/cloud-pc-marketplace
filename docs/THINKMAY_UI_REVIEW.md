# Thinkmay: quan sát giao diện và hướng áp dụng

Ngày 07/11/2026. Reviewer: Codex. Nguồn: https://thinkmay.net/en/.

## Phạm vi kiểm tra

Đã mở trang bằng Edge headless qua Playwright, cuộn qua các section đến footer và chụp màn hình; kiểm tra hero ở viewport 1440×1000 và 390×844. Đây là khảo sát trang công khai, không đăng nhập, thanh toán hoặc kiểm tra desktop từ xa. Không suy ra toàn bộ thư viện nội bộ từ giao diện.

## Quan sát

- Header nổi, trong nhẹ, giữ trên màn hình khi cuộn.
- Hero hai cột, chữ đậm, PC/cloud lớn; mobile xếp dọc.
- Nền xanh trời chuyển sang xanh đêm, điểm chuyển có sắc cam.
- Hình thiết bị và poster tạo điểm nhấn; bảng giá là card trắng.
- Bên dưới có bản đồ, hiệu năng, desktop minh họa, file, rewards, FAQ và footer.
- Có animation CSS đặt tên `ml-drift`, `cp-float`, `cp-flow`, `cp-bob`, `cp-pulse`.
- Minh họa hero có ảnh WebP; không thể kết luận cần mô hình 3D realtime.
- Heading khai báo font “May Display”; không lấy font này nếu chưa có quyền.

Ảnh khảo sát cục bộ: `C:/Users/ADMIN/AppData/Local/Temp/thinkmay-review-nov07/`. Các file `desktop-hero.png`, `mobile-hero.png`, `section-01.png` đến `section-24.png` và `observations.json`. Một số section là nội dung của tab ẩn nên ảnh tại vị trí đó trùng hero. Đã bấm tab giá năm và xác nhận bằng `yearly.png`; đã bấm nút đổi wallpaper trong demo và chụp `desktop-demo.png`. Thao tác tự động mở FAQ và menu mobile bị timeout khi tìm phần tử: chưa xác minh hai tương tác này, không kết luận trang có lỗi từ kết quả đó. Script tương tác dừng trước khi ghi `interactions.json`.

## Đề xuất cho Cloud PC Marketplace

Đây là lựa chọn thiết kế của dự án, không phải chức năng Thinkmay đã cung cấp cho mình.

1. Tách trang giới thiệu và trang tìm máy. Đừng lấy màn danh sách thông số làm toàn bộ trang chủ.
2. Trang chủ: header nổi, hero với PC/cloud riêng, chọn nhu cầu, máy minh họa, ba bước thuê, khu vực dành cho host, giải thích workspace, FAQ và CTA cuối.
3. Trang chợ: giữ nền sáng và nhận diện chung; tăng khả năng so sánh cấu hình. Chỉ dùng dark section ở trang giới thiệu nơi nó hỗ trợ câu chuyện.
4. Chốt asset hero trước. Cần ảnh PC/cloud có chất lượng hoặc minh họa SVG riêng, không thay bằng một thẻ thông số rồi coi là tương đương.
5. Ưu tiên font hỗ trợ tiếng Việt; kiểm tra trực quan dấu ở tiêu đề lớn. Bảng màu, font, kích thước và spacing phải được duyệt trong bản thiết kế.
6. Giữ Sunshine/Moonlight và gói demo hiện hành. Không mang lời hứa chạy trong browser, quyền admin, lưu cả ổ đĩa, benchmark, rewards hay gói tháng của nguồn tham khảo vào MVP.

## Công cụ cần và chưa cần

- Next.js + Tailwind hiện có đủ cho bố cục, gradient, header trong nhẹ, card, accordion, hover và chuyển động lặp đơn giản bằng CSS.
- Tùy chọn: Motion for React (`motion`, import từ `motion/react`) nếu cần phối hợp enter/exit, stagger, layout và scroll. Không bắt buộc và chưa cài vào dự án. Nguồn: https://motion.dev/docs/react.
- Không cần thêm Three.js, React Three Fiber, GSAP hoặc nhiều bộ UI chỉ để bắt đầu làm giống phong cách tham chiếu. Chỉ đánh giá lại khi có yêu cầu tương tác cụ thể vượt giải pháp đơn giản.
- Playwright hữu ích để chụp và so sánh giao diện; không thêm hiệu ứng cho sản phẩm. Nguồn: https://github.com/microsoft/playwright-cli.
- Chuyển động phải hỗ trợ `prefers-reduced-motion`; trên mobile giảm lớp trang trí, không gây tràn ngang hoặc che nội dung.

## Dùng Spec Kit cho một thay đổi giới hạn

Đọc `docs/SPEC_KIT_SETUP.md`. Các lệnh chạy trong chat Claude, từng lệnh một; không gửi toàn bộ như một lệnh và không chạy trong PowerShell.

1. Nếu constitution vẫn là placeholder, chạy `/speckit-constitution` để ghi các quyết định hiện hành của Cloud PC. Không áp lại bối cảnh UniAct cũ hoặc tự thêm quy trình duyệt ngoài yêu cầu của chủ dự án.
2. `/speckit-specify`: chỉ đặc tả việc sửa bản mẫu UI theo tài liệu này và ảnh tham chiếu, chưa sửa ứng dụng chính. Nêu rõ trang, luồng, assets, trạng thái và điều kiện nghiệm thu.
3. `/speckit-clarify`: làm rõ điểm chưa chốt, ưu tiên tên hiển thị, hình minh họa, bảng màu và việc có dùng Motion.
4. `/speckit-plan`: giữ stack, liệt kê file sẽ sửa và phương án tạo/tìm asset hợp lệ. Không tự đổi backend/contracts.
5. `/speckit-tasks` rồi `/speckit-analyze`: chia nhỏ, kiểm tra nhất quán trước khi code.
6. Chủ dự án duyệt kế hoạch rồi dùng `/speckit-implement` để triển khai bản mẫu trong `design-preview/`.
7. `/speckit-converge`: đối chiếu bản mẫu với spec, kiểm tra trình duyệt và các tiêu chí còn thiếu. Lặp sửa đến khi đạt.

Nghiệm thu đề xuất: có trang giới thiệu và trang chợ; liên kết qua lại hoạt động; hình PC/cloud riêng hiển thị thật; tiếng Việt không cắt dấu; chụp 390, 768 và 1440px; không tràn ngang; menu/FAQ/bộ lọc chạy trong phạm vi bản mẫu; không có số liệu hoặc giao dịch giả; không có lỗi console do code của bản mẫu; ảnh trước/sau để chủ dự án duyệt. Chỉ kiểm tra giả lập viewport chưa chứng minh chạy tốt trên thiết bị thật.

Spec Kit giữ yêu cầu và kế hoạch; UI UX Pro Max hỗ trợ các lựa chọn thiết kế; kiểm tra trên trình duyệt mới cung cấp bằng chứng hình ảnh. Cài Spec Kit không tự động làm giao diện đẹp hơn.

Tài liệu: https://github.github.io/spec-kit/how-to/existing-projects.html và https://github.github.io/spec-kit/integrations/claude.html.

## Trạng thái bàn giao

Đây chỉ là nghiên cứu và hướng dẫn cho Claude. Không sửa ứng dụng, không cài thư viện hiệu ứng vào npm, không commit/push. Playwright được dùng trong môi trường tạm riêng cho khảo sát.

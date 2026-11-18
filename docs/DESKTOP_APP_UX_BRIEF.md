# Cloud PC Companion — brief và prompt UI/UX

Ngày 07/11/2026. Trạng thái: đề xuất thiết kế để chủ dự án duyệt; chưa triển khai app native.

> **Lịch sử (08/11/2026)**: brief này đã được thay bởi `DESKTOP_APP_START.md`, `END_TO_END_HANDOFF.md` và `specs/002`/`003`: UI là React (`desktop/`) chứ không phải HTML tĩnh; viewer là Selkies trong app, không phải Moonlight ngoài app.

## Hướng công nghệ

- App thật về sau: Tauri 2 + React/TypeScript + Vite + Tailwind; Rust/helper/service cho tích hợp OS sau khi có đặc tả, quyền và thử nghiệm.
- Web Next.js hiện tại tiếp tục làm web/backend; không nhét server Next.js SSR vào Tauri. App dùng API chung, không có service-role hay private key trong frontend.
- Chỉ thiết kế UI trước: HTML/CSS/JS tĩnh trong `app-design-preview/`, không npm workspace mới hoặc cài Rust/toolchain chỉ để duyệt màn hình.
- UI UX Pro Max hỗ trợ thiết kế; Spec Kit hỗ trợ đặc tả và task. Hai bộ đã có, không cần cài lại.
- Motion là tùy chọn về sau khi frontend đã dùng React. Bản mẫu hiện tại ưu tiên CSS/Web Animations API.
- Lucide là tùy chọn icon nhất quán; có thể dùng SVG riêng hiện có. Không bắt buộc thêm shadcn/ui hoặc component library.

## Repo đã khảo sát

| Repo | Vai trò | Thời điểm |
| --- | --- | --- |
| https://github.com/tauri-apps/tauri | Nền app desktop | Sau khi duyệt prototype |
| https://github.com/tauri-apps/plugins-workspace | Plugin chính thức cho deep link, notification, updater, autostart và chức năng hệ thống | Chọn từng plugin khi có yêu cầu, không bật quyền hàng loạt |
| https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | Hướng dẫn thiết kế, đã cài | Dùng ngay |
| https://github.com/lucide-icons/lucide | Icon SVG/React đồng nhất | Tùy nhu cầu |
| https://github.com/motiondivision/motion | Chuyển động cho React/JS | Không bắt buộc |
| https://github.com/moonlight-stream/moonlight-qt | Client streaming để tích hợp về sau, không viết lại codec | Khảo sát tích hợp sau, chưa fork/nhúng vào prototype |

Kiểm tra license và phiên bản trước khi tích hợp/phân phối. Số sao không thay thế kiểm tra phù hợp kỹ thuật.

Tauri khuyến nghị Vite cho SPA và không cung cấp Next.js SSR nội bộ: https://v2.tauri.app/start/frontend/.

## Prompt giao Claude (một lần, làm đến bản mẫu)

```text
Bạn là agent thiết kế và triển khai bản mẫu UI Cloud PC Companion.
Codex review. Nhiệm vụ chỉ là UI/UX app desktop, chưa tích hợp hệ thống.

Đọc README.md, docs/MVP.md, docs/PROGRESS.md,
docs/PRODUCT_WORKFLOW.md, docs/DESKTOP_APP_UX_BRIEF.md,
docs/THINKMAY_UI_REVIEW.md, docs/REMOTE_ACCESS.md và
constitution/đặc tả hiện có. Dùng UI UX Pro Max đã cài.
Yêu cầu trực tiếp mới nhất của chủ dự án ưu tiên hơn mô tả cũ.

ĐÍNH CHÍNH BẮT BUỘC
- Một app, một tài khoản, hai chế độ: Thuê máy và Cho thuê máy.
- Host cần được cấp quyền/duyệt, không tự có quyền từ nút chọn chế độ.
- Lịch định kỳ là host tự mở máy trên chợ trong khung giờ đã chọn.
  Ví dụ hằng ngày 19:00–23:00. Khách vẫn thuê ngay.
- KHÔNG làm renter đặt thuê định kỳ, phí giữ lịch hay gói tháng.
- Đến lịch nhưng máy offline/không đủ điều kiện thì không mở nhận thuê.
- Lịch không tự bật nguồn PC. Tắt app UI không đồng nghĩa service đã
  dừng; cần thiết kế rõ lựa chọn chạy nền và trạng thái chưa thiết lập.
- Chatbot và public deploy đang tạm gác.

KẾT QUẢ MUỐN CÓ
Tạo prototype tương tác trong app-design-preview/ để tôi mở bằng
trình duyệt và duyệt trải nghiệm app desktop. Đây là mô phỏng giao diện,
không gọi là app đã cài/chạy native. Chưa sửa web/, design-preview/,
backend, DB, contract hoặc cấu hình máy.

App thật về sau hướng Tauri 2 + React/TypeScript + Vite + Tailwind.
Hiện dùng HTML/CSS/JS tĩnh để xem mẫu, không scaffold app native,
không cài toolchain hay tự cài Sunshine/Moonlight/WireGuard.
Không đổi web Next.js sang công nghệ khác.

THIẾT KẾ
- Kế thừa Sky: xanh trời, navy, teal, font tiếng Việt, khoảng thở rõ.
- Đây là ứng dụng quản lý thao tác, không sao chép landing page:
  sidebar, vùng nội dung, thanh trạng thái và hành động chính rõ ràng.
- Chuyển Thuê máy/Cho thuê máy dễ tìm, giữ ngữ cảnh, không gây hiểu nhầm
  đổi chế độ là ngắt phiên đang chạy.
- Hiển thị rõ máy cục bộ của host khác với máy đang thuê từ xa.
- Chữ thân thiện; không đưa raw state/heartbeat/escrow vào vị trí chính
  nếu người dùng không cần. Chi tiết kỹ thuật có thể mở thêm.
- Hiệu ứng nhẹ cho đổi màn, menu, wizard, card và lịch; giảm chuyển động
  theo hệ thống. Ưu tiên CSS, không thêm thư viện để tạo nhiều hiệu ứng.
- Dùng sidebar thu gọn và nội dung tự co ở cửa sổ nhỏ; đây là app desktop,
  không bắt đầu bằng giao diện điện thoại.

CÁC MÀN HÌNH VÀ LUỒNG
1. Đăng nhập/chọn chế độ:
   Bản mẫu chỉ có nút Vào chế độ xem thử; không nhận/lưu mật khẩu thật,
   không giả xác thực. Có trạng thái chưa có quyền host và yêu cầu duyệt.

2. Thiết lập lần đầu theo vai trò:
   Danh sách thành phần cần thiết, đã có/chưa kiểm tra/không tương thích,
   dung lượng dự kiến khi có dữ liệu, quyền, thay đổi, khởi động lại,
   đồng ý/từ chối, tiến độ và lỗi. Người chỉ thuê không cài bộ host.
   Các bước demo phải ghi mô phỏng, không chạy scan/cài hay xin quyền OS thật.

3. Thuê máy:
   Danh sách/lọc theo Chơi game, Làm việc/đồ họa, Lập trình; card cấu hình,
   giá/thời lượng, vùng và trạng thái mẫu. Chi tiết có game/app đã kiểm thử
   hoặc chưa kiểm thử, không bịa FPS/uptime/tương thích.
   Chọn máy → xem giá/điều kiện → màn chờ thanh toán/chuẩn bị minh họa.
   Không tự ký ví hay giả receipt/thanh toán thành công.

4. Phiên của tôi:
   Chưa có phiên; chuẩn bị; sẵn sàng; đang kết nối; mất kết nối;
   hết hạn; thu hồi; dọn lỗi. Trình bày từng tình huống có nhãn mô phỏng.
   Web/app quản lý phiên, Moonlight ngoài app hiển thị desktop.
   Nút backend chưa nối phải khóa kèm lý do. Không mở desktop giả,
   không ghi mã PIN, IP riêng hay credential thật vào mẫu.
   Workspace thể hiện chưa bật/đang lưu/lưu lỗi; không báo đã lưu thật.

5. Host — máy của tôi:
   Máy chưa duyệt/không tương thích/chưa thiết lập/sẵn sàng/đang thuê/
   đang dọn/tạm khóa. Hành động bật nhận thuê, ngừng nhận phiên mới,
   xem thiết lập và lịch. Do là prototype, thao tác chỉ đổi trạng thái mẫu
   với thông báo rõ, không tuyên bố đã đăng máy thật.

6. Lịch nhận thuê của host:
   Thủ công / một lần / hằng ngày / chọn ngày trong tuần.
   Giờ bắt đầu/kết thúc, múi giờ, phạm vi ngày; hiển thị bản tóm tắt
   lịch dễ đọc và các cửa sổ minh họa trong tuần.
   Tạo/sửa/tạm dừng/tiếp tục/bỏ qua một ngày trong dữ liệu tạm.
   Nhắc rằng máy phải bật và service được phép chạy.
   Mẫu đầu hỗ trợ khung cùng ngày, giờ kết thúc > bắt đầu; nếu chưa làm
   qua đêm thì từ chối rõ và hướng dẫn tách hai khung, không tự đoán ngày.
   Phát hiện khung trùng, ngày không hợp lệ, không chọn ngày lặp.
   Lịch không tạo booking định kỳ, không thêm phụ phí giữ lịch.

7. Host — màn chờ/phiên đang phục vụ:
   Sẵn sàng chờ khách, thời điểm mở/đóng theo lịch, lý do chưa nhận được
   khách; đang phục vụ thì hiển thị tài nguyên và thời gian minh họa.
   Ngừng nhận mới khác kết thúc khẩn cấp. Không cho sửa lịch âm thầm
   cắt phiên đã nhận. Hết lịch thì chặn phiên mới không đủ thời gian.

8. Cài đặt và trợ giúp:
   Chạy nền/tự khởi động/nhắc lịch với giải thích, chưa tác động OS.
   Đóng cửa sổ khác dừng nhận thuê; đăng xuất khi có phiên cần giải thích.
   Ngôn ngữ tiếng Việt, hướng dẫn kết nối và cách báo sự cố.

THỰC HIỆN MỘT LƯỢT
- Dùng Spec Kit để đặc tả thay đổi giới hạn, làm rõ, lập kế hoạch,
  task và phân tích nhất quán, rồi triển khai prototype.
- Tự quyết định lựa chọn giao diện có thể sửa lại và ghi giả định.
  Không dừng hỏi sau từng bước; chỉ hỏi khi thiếu quyết định quan trọng
  khiến không thể tiếp tục. Không tự viết lại constitution ngoài phạm vi.
- Tạo docs/DESKTOP_APP_DESIGN.md và đặc tả riêng, giữ spec web cũ.
- app-design-preview/ có index.html, CSS/JS/assets riêng và README chỉ
  cách mở. Dữ liệu nằm trong bộ nhớ; tải lại đặt lại. Không lưu mật khẩu,
  token, file thật hay credential. Có banner Bản mẫu giao diện.
- Không clone cả repo bên ngoài vào dự án, không tự cài các plugin native.

KIỂM TRA VÀ BÀN GIAO
- Mở và thử ở 1024×720, 1280×800, 1440×900; font tiếng Việt không cắt dấu,
  không tràn ngang, cuộn vùng nội dung hợp lý, menu/focus hoạt động.
- Đi hết luồng xem thử của hai chế độ; test lịch tạo/sửa/tạm dừng,
  khung trùng, máy offline đúng lịch, ngừng nhận mới khi có phiên.
- Chụp ảnh và báo rõ đã thử trên browser hay Tauri thật. Không gọi
  trình duyệt là bằng chứng bộ cài/native/GPU/remote hoạt động.
- Cập nhật PROGRESS với những gì đã làm/chưa làm. Dừng để tôi duyệt
  mẫu trước khi tích hợp native/backend. Không commit/push/deploy
  hoặc thay đổi PC trong nhiệm vụ này.
```

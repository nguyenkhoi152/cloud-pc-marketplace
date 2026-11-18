# Feature Specification: Bản mẫu giao diện "Sky" cho Cloud PC Marketplace

**Feature Branch**: `001-sky-prototype` (không tạo nhánh git riêng; thư mục spec là định danh)

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "Thiết kế lại bản mẫu UI trong design-preview/: trang giới thiệu + trang tìm máy, nền xanh trời, chữ navy lớn, điểm nhấn teal, header nổi, hình PC/cloud riêng; tiếng Việt, desktop/mobile; không dùng tài sản/số liệu của Thinkmay; không quảng cáo chức năng chưa có; chờ chủ dự án duyệt trước khi đưa vào ứng dụng chính."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hiểu sản phẩm qua trang giới thiệu (Priority: P1)

Khách lần đầu mở trang giới thiệu và trong vài giây hiểu đây là chợ thuê máy tính từ xa do các host được duyệt đăng, thuê theo gói ngắn bằng điểm thử. Họ cuộn qua các phần (chọn nhu cầu, máy minh hoạ, ba bước thuê, dành cho host, workspace, câu hỏi thường gặp) rồi bấm sang trang tìm máy.

**Why this priority**: Đây là ấn tượng đầu tiên và là thứ chủ dự án duyệt trước nhất; không có nó thì bản mẫu không truyền được định hướng thẩm mỹ.

**Independent Test**: Mở trang giới thiệu ở 1440px và 390px, đọc từ trên xuống; mọi phần hiển thị, hình PC/cloud thấy rõ, nút "Tìm máy" dẫn tới trang tìm máy.

**Acceptance Scenarios**:

1. **Given** trang giới thiệu đã mở, **When** nhìn màn hình đầu tiên, **Then** thấy header nổi, tiêu đề lớn màu navy với một dòng nhấn teal, hình PC/cloud minh hoạ riêng và nút kêu gọi chính.
2. **Given** ở trang giới thiệu, **When** bấm nút hoặc mục "Tìm máy" ở header hoặc CTA, **Then** chuyển sang trang tìm máy và header cho biết trang hiện tại.
3. **Given** màn hình hẹp (390px), **When** mở menu, **Then** điều hướng dùng được bằng chạm/bàn phím và không có cuộn ngang.
4. **Given** người dùng bật giảm chuyển động của hệ thống, **When** mở trang, **Then** hiệu ứng lặp/nổi tắt, nội dung vẫn đầy đủ.

---

### User Story 2 - So sánh máy ở trang tìm máy (Priority: P1)

Khách muốn chọn máy hợp nhu cầu nên lọc và đặt cấu hình, giá, thời lượng cạnh nhau để so sánh nhanh. Họ thấy rõ máy nào là dữ liệu mẫu và trạng thái chưa xác định.

**Why this priority**: Đây là chức năng cốt lõi của chợ; thiết kế phải làm bài toán so sánh dễ hơn bản hiện tại.

**Independent Test**: Mở trang tìm máy, lọc theo RAM/VRAM/OS/vùng và chọn hai đến ba máy để so sánh; kết quả cập nhật trong phạm vi bản mẫu.

**Acceptance Scenarios**:

1. **Given** danh sách máy mẫu, **When** đặt bộ lọc, **Then** danh sách chỉ còn máy khớp và nêu số kết quả; không có kết quả thì hiện thông báo kèm cách xoá lọc.
2. **Given** các thẻ máy, **When** xem một thẻ, **Then** thấy CPU, RAM, GPU/VRAM, hệ điều hành, vùng, giá 20 PCP, thời lượng 15 phút và cam kết cửa sổ host ở cùng một bố cục lặp lại để so sánh.
3. **Given** chọn nhiều máy, **When** mở khu so sánh, **Then** các thông số xếp thành cột/hàng thẳng hàng; trên mobile chuyển thành dạng xếp chồng đọc được.
4. **Given** bất kỳ thẻ nào, **When** nhìn trạng thái, **Then** thấy nhãn "Dữ liệu mẫu" và "chưa xác định" (không "online").

---

### User Story 3 - Chủ dự án duyệt bản mẫu (Priority: P1)

Chủ dự án mở bản mẫu trên trình duyệt bằng một cách rõ ràng, xem ảnh chụp desktop/mobile đã kiểm tra, và biết phần nào chưa kiểm chứng để quyết định có đưa vào ứng dụng chính hay không.

**Why this priority**: Công việc chỉ kết thúc khi chủ dự án duyệt; ứng dụng chính không được đổi trước đó.

**Independent Test**: Làm theo hướng dẫn mở, đi qua hai trang, đối chiếu ảnh chụp và danh sách chưa kiểm chứng.

**Acceptance Scenarios**:

1. **Given** hướng dẫn mở, **When** làm theo, **Then** bản mẫu xem được mà không cần cài thêm gói.
2. **Given** bản mẫu hoàn thành, **When** đọc báo cáo, **Then** có ảnh 390/768/1440px và danh sách phần chưa kiểm chứng.

---

### User Story 4 - Xem chi tiết một máy và luồng phiên thuê (Priority: P3)

Từ thẻ máy, khách xem trang chi tiết với bảng giá/phí và các bước sau khi đặt; trang phiên thuê mô phỏng trạng thái. Hai trang này đã có ở bản mẫu trước và được đổi sang phong cách mới để không lệch giao diện.

**Why this priority**: Không thuộc yêu cầu chính lần này nhưng cần nhất quán để bản mẫu không tự mâu thuẫn.

**Independent Test**: Từ trang tìm máy mở chi tiết rồi sang phiên thuê; phong cách đồng nhất, nút cần backend bị khoá kèm lý do.

**Acceptance Scenarios**:

1. **Given** trang chi tiết, **When** xem nút đặt thuê, **Then** nút bị khoá kèm lý do cụ thể.

### Edge Cases

- Màn hình rất hẹp hoặc phóng chữ lớn: không cắt dấu tiếng Việt, không tràn ngang.
- Hình minh hoạ không tải được: vẫn đọc được toàn bộ nội dung nhờ chữ thay thế và bố cục không vỡ.
- Bộ lọc cho kết quả rỗng; giá trị lọc không hợp lệ (số âm, chữ).
- JavaScript bị tắt: điều hướng và nội dung chính vẫn xem được (lọc và so sánh có thể không hoạt động).
- Hệ điều hành đặt giảm chuyển động hoặc chế độ tối: bản mẫu vẫn đọc được, tương phản đạt yêu cầu.
- Người dùng bấm mục nav chưa có trang (Ví, Workspace, Host): hiển thị trạng thái "chưa có trong bản mẫu", không dẫn tới trang giả.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Bản mẫu MUST nằm trong `design-preview/` và MUST NOT sửa `web/`, backend, `db/`, `contracts/` hay migrations.
- **FR-002**: MUST có trang giới thiệu và trang tìm máy, điều hướng qua lại từ header, CTA và logo; trang hiện tại được đánh dấu.
- **FR-003**: Header MUST nổi (tách khỏi mép, giữ khi cuộn), dùng tốt trên desktop và có menu thu gọn trên mobile.
- **FR-004**: Trang giới thiệu MUST có theo thứ tự: hero (tiêu đề navy lớn có dòng nhấn teal, mô tả ngắn, CTA, hình PC/cloud riêng), chọn nhu cầu, máy minh hoạ, ba bước thuê, khu vực dành cho host, giải thích workspace, câu hỏi thường gặp, CTA cuối, chân trang.
- **FR-005**: Hình PC/cloud MUST là minh hoạ vẽ riêng cho dự án (SVG/CSS), nổi bật ở hero; MUST NOT dùng logo, mascot, hình ảnh, số liệu hay font độc quyền của Thinkmay.
- **FR-006**: Phong cách MUST là nền xanh trời, chữ navy, điểm nhấn teal, khoảng thở rộng; MUST NOT dùng dark dashboard toàn trang (khu vực tối nhỏ chỉ khi hỗ trợ nội dung).
- **FR-007**: Trang tìm máy MUST có bộ lọc (từ khoá, RAM, VRAM, giá tối đa, hệ điều hành, vùng, tương thích workspace), số kết quả, thẻ máy có bố cục thông số thống nhất, và khu so sánh tối đa 3 máy theo cột/hàng thẳng hàng.
- **FR-008**: Mọi máy, giá, cam kết host MUST gắn nhãn dữ liệu mẫu; trạng thái máy MUST hiển thị "chưa xác định"; MUST NOT có số liệu hiệu năng (fps, ping, điểm), đánh giá sao, số người dùng, uptime hay chấm online.
- **FR-009**: Nội dung MUST chỉ nói điều dự án có trong MVP: gói demo 15 phút, 20 PCP thử (không tiền thật), Sunshine/Moonlight, workspace theo project. MUST NOT hứa chạy trong trình duyệt, lưu cả ổ đĩa, gói tháng, rewards, benchmark hay thư viện game.
- **FR-010**: Hành động cần backend (đăng nhập, ví, đặt thuê, ghép cặp) MUST khoá hoặc ghi rõ là minh hoạ kèm lý do; MUST NOT giả kết quả.
- **FR-011**: Tất cả chữ hiển thị MUST là tiếng Việt có dấu đúng; tiêu đề lớn không cắt dấu.
- **FR-012**: Bố cục MUST dùng được ở 390, 768 và 1440px không cuộn ngang, mục tiêu chạm tối thiểu 44px trên mobile.
- **FR-013**: Bản mẫu MUST đạt tương phản chữ 4.5:1, có focus nhìn thấy, điều hướng bằng bàn phím, nhãn cho điều khiển chỉ có biểu tượng, và tôn trọng giảm chuyển động.
- **FR-014**: Hiệu ứng chuyển động MUST thực hiện bằng CSS; MUST NOT thêm thư viện nếu không có lợi ích cụ thể được ghi lại.
- **FR-015**: Trang chi tiết máy và phiên thuê hiện có MUST được đổi sang cùng phong cách và giữ các ràng buộc FR-008 đến FR-010.
- **FR-016**: Báo cáo hoàn thành MUST nêu cách mở, ảnh kiểm tra 390/768/1440px và danh sách phần chưa kiểm chứng; công việc dừng chờ duyệt, MUST NOT đưa vào `web/`.

#### Bổ sung vòng hoàn thiện hình ảnh và chuyển động (2026-11-07)

- **FR-017**: Bộ lọc MUST không để ô trống trong lưới khi ẩn máy; số kết quả, trạng thái rỗng và bảng so sánh MUST cập nhật nhất quán.
- **FR-018**: Trang phiên thuê MUST NOT gợi ý desktop chạy trong trang web; MUST nêu rằng màn hình máy thuê dự kiến hiển thị trong ứng dụng Moonlight.
- **FR-019**: Minh hoạ hero MUST gồm các lớp tách riêng (mây, thùng máy, laptop, luồng kết nối); chuyển động lặp MUST chỉ nằm trong hero, chỉ dùng `transform`/`opacity`/nét đứt, tạm dừng khi hero ra khỏi màn hình và giảm bớt (bỏ quạt quay, mây trôi) trên mobile.
- **FR-020**: Hiệu ứng xuất hiện khi cuộn MUST không che nội dung đang trong màn hình lúc tải, không làm mất quyền cuộn, thời lượng ngắn (≤ 320ms, trễ nối tiếp ≤ 100ms); không có JS thì nội dung hiện đầy đủ.
- **FR-021**: Hover/nhấn của thẻ và nút, chuyển trạng thái của bộ lọc, so sánh, menu, FAQ MUST dùng chung bộ thời lượng và đường cong (120/200/320ms); `prefers-reduced-motion` MUST tắt mọi chuyển động và hiện nội dung ngay.
- **FR-022**: MUST ưu tiên CSS; không thêm thư viện chuyển động. Quyết định và lý do ghi ở `research.md`.

### Key Entities

- **Máy mẫu**: tên, host mẫu, CPU, RAM, GPU/VRAM, hệ điều hành, vùng, ứng dụng khai báo, cửa sổ cam kết (giờ), giá gói, tương thích workspace, nhãn "dữ liệu mẫu" và trạng thái "chưa xác định". Lấy từ fixture hiện có, không thêm số đo.
- **Nhu cầu**: nhóm gợi ý để lọc (ví dụ dựng phim, lập trình, đồ hoạ 3D) trỏ tới bộ lọc trang tìm máy.
- **Mục câu hỏi thường gặp**: câu hỏi và trả lời chỉ dựa trên tài liệu MVP.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Người xem trả lời đúng "đây là gì và thuê như thế nào" sau khi xem màn hình đầu tiên và phần ba bước thuê (kiểm bằng chủ dự án duyệt).
- **SC-002**: Chuyển giữa hai trang chính trong tối đa 1 lần bấm từ bất kỳ vị trí nào; hoàn tất lọc và so sánh 2 máy trong dưới 1 phút.
- **SC-003**: 0 điểm tràn ngang và 0 dấu tiếng Việt bị cắt ở 390, 768, 1440px trong ảnh kiểm tra.
- **SC-004**: 0 số liệu hiệu năng, đánh giá, trạng thái online hoặc giao dịch giả; 100% máy mẫu có nhãn dữ liệu mẫu.
- **SC-005**: 100% hành động cần backend khoá kèm lý do.
- **SC-006**: 0 tài sản/chữ/số liệu của Thinkmay; mọi hình là sản phẩm riêng.
- **SC-007**: 0 lỗi console do mã bản mẫu khi mở hai trang chính.
- **SC-008**: Các bài kiểm tra tương phản, bàn phím và giảm chuyển động đạt trên cả hai trang chính.

## Assumptions

- Tên hiển thị tạm là "Cloud PC Marketplace" (tên làm việc theo README); logo là chữ + biểu tượng đơn giản của dự án, chưa phải nhận diện chính thức.
- Phong cách lấy cảm hứng từ ảnh hero Thinkmay đã chụp trong khảo sát (nền xanh trời, header nổi, chữ đậm navy với dòng teal, PC/cloud lớn); chỉ học bố cục và tinh thần, không sao chép nội dung.
- Ảnh người dùng nhắc đến chưa nằm trong cuộc trò chuyện này; dùng ảnh khảo sát cục bộ `thinkmay-review-nov07` làm nguồn tham khảo hình ảnh.
- Font: Be Vietnam Pro nếu tải được từ Google Fonts khi người xem có mạng, nếu không dùng font hệ thống; không dùng "May Display".
- Bản mẫu là HTML/CSS tĩnh cộng JavaScript nhỏ cho menu, lọc, so sánh và FAQ; chưa phải trang Next.js. Việc chuyển sang `web/` (Next.js + Tailwind) làm sau khi chủ dự án duyệt.
- Không thêm thư viện chuyển động (Motion, GSAP, Three.js); CSS đủ cho hiệu ứng nổi nhẹ.
- Nội dung host và workspace chỉ mô tả mục tiêu theo MVP và ghi rõ chức năng chưa hoạt động.
- Kiểm tra bằng Edge headless ở các khổ 390/768/1440; không có kiểm tra trên thiết bị thật.
- Các mục "Ví PCP", "Workspace", "Dành cho host" ở điều hướng chỉ là phần giới thiệu hoặc khoá, không có trang chức năng.

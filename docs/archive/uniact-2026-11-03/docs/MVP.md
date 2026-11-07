# UniAct — bản mô tả MVP

Ngày: 03/11/2026. Tên sản phẩm tạm thời, có thể đổi.

## 1. Yêu cầu từ chủ dự án

- Sinh viên trong trường cần tham gia hoạt động để đáp ứng yêu cầu CTXH hoặc rèn luyện theo từng năm.
- Có hai khu vực cho sinh viên và người có thẩm quyền tổ chức hoạt động.
- Người tổ chức đăng hoạt động; sinh viên xem và đăng ký tham gia.
- Người tổ chức trả thêm token khi muốn đăng nhiều bài.
- Có ví và phần thanh toán blockchain thật trong bản demo.

Các nội dung bên dưới là đề xuất triển khai; các quy định riêng của trường chưa được cung cấp.

## 2. Phạm vi đề xuất cho bản đầu

Tập trung vào vòng đời CTXH: đăng hoạt động → đăng ký → xác nhận hoàn thành → cập nhật tiến độ cá nhân. Điểm rèn luyện và CTXH phải là hai loại ghi nhận riêng; không tự chuyển đổi giữa chúng. Bản đầu không tự tính điểm rèn luyện chính thức.

### Sinh viên

- Xem danh sách và chi tiết hoạt động: đơn vị tổ chức, mô tả, địa điểm, lịch, hạn đăng ký, số chỗ và mức CTXH dự kiến.
- Đăng ký, hủy trước hạn và xem trạng thái của mình.
- Xem mục Đã đăng ký và mục Đã được xác nhận hoàn thành.
- Xem tổng CTXH đã xác nhận so với mục tiêu năm học được cấu hình.

### Đơn vị tổ chức

- Tài khoản có quyền tổ chức được cấp trước cho demo; không tự chọn vai trò để có quyền đăng.
- Tạo nháp, xuất bản và xem các hoạt động của mình.
- Xem người đã đăng ký và xác nhận hoàn thành hoặc không hoàn thành sau hoạt động.
- Xem số lượt miễn phí còn lại, số dư token và lịch sử thanh toán.
- Không được quản lý hoạt động thuộc đơn vị khác.

## 3. Token và Avalanche

Tạm gọi token **UACT**. Chỉ là token thử nghiệm trên Avalanche Fuji, không có giá trị tiền thật. Token không phải CTXH và không dùng để mua kết quả hoàn thành.

Đề xuất kinh tế demo:

- Mỗi đơn vị được đăng miễn phí một hoạt động.
- Mỗi hoạt động tiếp theo tốn 10 UACT.
- Ví tổ chức mẫu được cấp token thử để thao tác.
- Phí gas là AVAX Fuji, khác với phí đăng bài bằng UACT.

Phần blockchain đề xuất:

- Hợp đồng token thử nghiệm.
- Hợp đồng đăng hoạt động, kiểm tra ví tổ chức được cấp quyền, đếm lượt miễn phí và thu phí các lượt tiếp theo.
- Mỗi hoạt động có mã định danh và dấu vân tay nội dung gắn với bản ghi xuất bản trên chain.
- Giao diện chỉ đánh dấu đã xuất bản sau khi giao dịch được xác nhận; một giao dịch không được dùng để mở nhiều bài.
- Lưu mã giao dịch và dẫn tới explorer để người xem kiểm tra.

Phần ngoài blockchain: nội dung chi tiết, hồ sơ sinh viên, danh sách đăng ký, xác nhận tham gia và bảng tiến độ. Không đưa mã sinh viên hoặc dữ liệu cá nhân lên chain. Chứng thực hoàn thành trên chain là phần mở rộng sau nếu còn thời gian.

## 4. Quy tắc tối thiểu

- Bài nháp không xuất hiện trong danh sách công khai.
- Chỉ nhận đăng ký nếu bài đang mở, chưa hết hạn và còn chỗ.
- Mỗi sinh viên chỉ có một đăng ký đang hiệu lực cho mỗi hoạt động; hủy trả lại chỗ.
- Đăng ký chưa được tính là hoàn thành hoặc cộng CTXH.
- Chỉ người tổ chức sở hữu hoạt động được xác nhận người tham gia của hoạt động đó, sau thời điểm kết thúc.
- Mỗi kết quả chỉ được cộng một lần; bấm xác nhận lặp không cộng thêm.
- Mức CTXH phải được lưu tại thời điểm ghi nhận để thay đổi bài về sau không âm thầm sửa tổng đã cấp.
- Hạn mức năm học và đơn vị ghi nhận phải cấu hình được. Dữ liệu mẫu phải ghi rõ là minh họa, chưa phải quy định trường.
- Quyền trong demo do hệ thống cấp; không tuyên bố đã xác minh hoặc được nhà trường công nhận chính thức.

## 5. Màn hình

1. Đăng nhập/kết nối ví và nhận diện vai trò.
2. Khám phá hoạt động và lọc trạng thái.
3. Chi tiết hoạt động, đăng ký/hủy.
4. Hoạt động của tôi và tiến độ CTXH theo năm học.
5. Bảng quản lý dành cho đơn vị tổ chức.
6. Tạo bài và thanh toán xuất bản.
7. Danh sách người tham gia và xác nhận kết quả.
8. Ví và lịch sử giao dịch.

## 6. Kịch bản demo xuyên suốt

1. Đăng nhập bằng đơn vị tổ chức đã được cấp quyền.
2. Xuất bản bài đầu bằng lượt miễn phí.
3. Tạo bài thứ hai; giao diện hiển thị phí 10 UACT, ký và thanh toán trên Fuji, mở giao dịch trên explorer.
4. Chuyển sang tài khoản sinh viên; xem chi tiết và đăng ký.
5. Với hoạt động mẫu đã kết thúc, chuyển về đơn vị tổ chức và xác nhận sinh viên hoàn thành.
6. Trở lại sinh viên; kết quả và tổng CTXH đã xác nhận được cập nhật đúng một lần.

Hoạt động mẫu ở bước 5 được chuẩn bị riêng để demo không phải chờ thời gian thật; không bỏ kiểm tra thời gian của hoạt động đang mở.

## 7. Điều kiện nghiệm thu đề xuất

- Có bản chạy từ mã nguồn theo README và bản web có thể truy cập.
- Hai vai trò thực hiện đúng quyền, dữ liệu của đơn vị này không bị đơn vị khác sửa.
- Một giao dịch thu phí đăng bài thật trên Fuji, có địa chỉ hợp đồng và mã giao dịch kiểm chứng được.
- Hủy ký, thiếu token hoặc giao dịch lỗi không làm bài được xuất bản nhầm.
- Đăng ký trùng, hết chỗ, hết hạn và xác nhận lặp được xử lý đúng.
- Tải lại trang không mất bài, đăng ký hoặc kết quả đã lưu.
- Có cấu hình mẫu, hướng dẫn cài/chạy, kiểm thử phần hợp đồng và các quy tắc nghiệp vụ quan trọng.
- Chuẩn bị repo GitHub, slide và video demo theo yêu cầu BTC; kiểm tra quyền truy cập trước khi nộp.

## 8. Những gì cần chốt trước khi code tính năng

- Tên sản phẩm và trường/ngữ cảnh demo.
- Ưu tiên ví có sẵn như Core/MetaMask hay ví tạo trong app. Chưa mặc định sao chép cơ chế ví tự làm của SenpAI.
- Công nghệ giao diện, máy chủ, nơi lưu dữ liệu và công cụ smart contract.
- Phí/hạn mức đăng bài; một lượt miễn phí và 10 UACT là giá trị đề xuất.
- Quy định CTXH thực tế nếu muốn trình bày theo trường cụ thể.

Trong lúc chưa có thông tin trường, dùng dữ liệu minh họa và mục tiêu có thể cấu hình; không tự gán tiêu chuẩn chính thức.

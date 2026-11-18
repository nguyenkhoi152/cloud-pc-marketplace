# Workflow sản phẩm: một app hai chế độ và lịch nhận thuê của host

Trạng thái: thiết kế theo yêu cầu chủ dự án, chưa phải tính năng đã triển khai.
Cập nhật 07/11/2026. Bản này thay thế cách hiểu sai trước đó về renter đặt thuê định kỳ.

Nguồn: [MVP](MVP.md), [Remote](REMOTE_ACCESS.md), [Workspace](CLOUD_WORKSPACES.md), [Contract](CONTRACT_SPEC.md).

## 1. Một app, hai chế độ

Người dùng đăng nhập tài khoản nền tảng và chọn Thuê máy hoặc Cho thuê máy. Một tài khoản có thể dùng cả hai; quyền host do server kiểm tra và chỉ được bật sau khi duyệt. Đăng nhập không tự bật cho thuê.

Lần đầu, ứng dụng kiểm tra tương thích, trình bày phần mềm cần cài, dung lượng, quyền, thay đổi và khả năng cần khởi động lại. Chỉ thiết lập sau khi người dùng đồng ý; không cài lại OS, chia ổ hoặc đổi GPU âm thầm. Người chỉ thuê không cài thành phần host.

Ứng dụng hỗ trợ dự kiến điều phối môi trường khách và session gateway cho Selkies (thay Sunshine/Moonlight từ 08/11/2026). Hiện chưa có Companion/host-agent hoạt động. Tauri là hướng đóng gói cần kiểm chứng; không giải quyết tự động GPU hoặc isolation trên mọi máy Windows.

## 2. Thuê máy

Đăng nhập → tìm máy theo nhu cầu (chơi game, làm việc, lập trình, đồ họa) → xem cấu hình và điều kiện → kiểm tra phần mềm kết nối → giữ máy → thanh toán PCP thử → chuẩn bị → cấp quyền và kích hoạt → mở viewer Selkies trong app → sử dụng → kết thúc → checkpoint nếu bật → thu hồi/reset/kiểm tra.

Web/app quản lý phiên; desktop Linux được xem trong viewer Selkies ngay trong app (qua gateway của host-agent). Mốc tính giờ, quote và xử lý tiền theo CONTRACT_SPEC. Chưa có renter đặt trước chuỗi phiên, tự gia hạn hoặc phụ phí giữ lịch trong yêu cầu này.

## 3. Host đăng máy và lịch tự động

Đăng nhập → Cho thuê máy → thêm/liên kết máy → kiểm tra thiết lập → duyệt host/máy → đặt lịch nhận thuê → xác nhận → bật lịch.

Host có thể chọn: mở thủ công, một khung một lần, hằng ngày hoặc các ngày trong tuần. Mỗi quy tắc có giờ bắt đầu/kết thúc, múi giờ và ngày bắt đầu/kết thúc áp dụng. Hiển thị các lần mở thực tế để kiểm tra.

Ví dụ: hằng ngày 19:00–23:00, múi giờ Asia/Ho_Chi_Minh. Đây là lịch host đưa máy lên chợ để khách thuê ngay, không phải booking hay cam kết thanh toán của một khách cụ thể.

## 4. Workflow một khung lịch

Trước giờ mở → nhắc host → probe máy/nguồn mạng/môi trường → đến giờ đánh giá đủ điều kiện → mở nhận thuê → có booking thì phục vụ → ngừng nhận gói không còn đủ thời gian → hoàn tất phiên cuối → thu hồi/reset/kiểm tra → đóng nhận thuê → chờ lịch tiếp theo.

- Đến lịch nhưng máy tắt, service không chạy, heartbeat cũ, bị khóa hoặc chưa duyệt: không đăng là sẵn sàng; ghi lý do và thông báo host.
- Không tự bật được PC đã tắt chỉ nhờ lịch web. Wake-on-LAN/khả năng bật từ xa là tính năng riêng, chưa cam kết hỗ trợ.
- Lịch không ghi đè việc host chủ động tạm dừng; khi tiếp tục phải nói rõ tiếp tục khung hiện tại hay lần tới.
- Thuê ngay chỉ được nhận nếu khoảng còn lại đủ funding/activation, thời lượng thuê và dọn/recovery theo chính sách hiện hành.
- Hết giờ lịch chỉ đóng nhận booking mới; không cắt booking đã nhận chỉ vì lịch thay đổi hoặc hết cửa sổ. Booking và watchdog giữ thời hạn đã xác nhận.
- Nút Ngừng nhận phiên mới khác với kết thúc khẩn cấp phiên đang chạy. Trường hợp khẩn cấp có cảnh báo và xử lý sự cố riêng.
- Host có thể bỏ qua một ngày, tạm dừng lịch, sửa các khoảng chưa cam kết. Không làm mất thời gian đã bảo đảm cho booking hiện có.
- Dispute hoặc cleanup thất bại: máy vẫn bị khóa, lịch sau không tự mở lại.

## 5. Dữ liệu và chống xung đột

Lịch là quy tắc availability của host, không tạo hàng loạt booking. Lưu múi giờ gốc và thời điểm từng cửa sổ theo UTC. Lịch chồng nhau cần được gộp hoặc từ chối rõ ràng; việc mở/đóng và nhắc phải idempotent.

Booking vẫn tạo theo thao tác thuê thật, giữ máy nguyên tử và kiểm tra cửa sổ tại DB. Lịch tự động không bỏ qua duyệt máy, heartbeat, khóa tiền hoặc cleanup. Nếu app UI đóng, lịch chỉ thực hiện được khi service đã được cài, người dùng đồng ý chạy nền và máy còn hoạt động; nếu chưa có service thì báo không khả dụng.

## 6. Phạm vi và giá

Không thêm phụ phí cho renter giữ lịch, chuỗi thuê, tự trừ ví hoặc gói tháng. Phần diễn giải đó trong bản trước là sai ý và đã được bỏ. Bản demo vẫn theo gói/PCP hiện hành.

Chưa chốt chính sách thương mại mới. Lịch availability của host không tự yêu cầu escrow hỗ trợ thanh toán định kỳ. Chu kỳ bật lịch, quyền chạy nền và điều kiện máy tương thích cần đặc tả khi triển khai.

## 7. Nghiệm thu dự kiến

- Host tạo lịch lặp và xem đúng các ngày/giờ; có thao tác tạm dừng, bỏ qua một ngày và tiếp tục.
- Đúng giờ chỉ mở máy đủ điều kiện; máy offline không bị quảng cáo sẵn sàng.
- Không nhận gói vượt thời gian còn lại; không cắt phiên đã nhận; cleanup lỗi không tự mở lại.
- Retry không đăng trùng, tạo trùng booking hoặc gửi nhắc trùng.
- Khách và host thấy thông báo dễ hiểu, trạng thái mẫu/kiểm tra thật phân biệt rõ.

Chỉ ghi thiết kế. Chưa sửa ứng dụng, DB, contract hoặc cấu hình PC; chưa commit/push/deploy.

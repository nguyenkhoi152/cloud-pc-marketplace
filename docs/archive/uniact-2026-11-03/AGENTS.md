# UniAct — hướng dẫn agent

## Bối cảnh

- Đọc README.md, docs/MVP.md và docs/PROGRESS.md trước khi thay đổi dự án.
- Sản phẩm là dApp hoạt động sinh viên/CTXH, có sinh viên và đơn vị tổ chức được cấp quyền.
- Token UACT là token thử nghiệm trên Avalanche Fuji; không phải điểm rèn luyện hoặc CTXH.
- Không tự công bố quy định CTXH hay sự công nhận của trường. Dữ liệu mẫu phải được ghi rõ.

## Cách làm việc

- Làm theo từng mốc có thể chạy và kiểm tra. Giữ các tính năng đã hoạt động.
- Bảo toàn file người dùng; kiểm tra cấu trúc hiện tại trước khi tạo mới hoặc di chuyển.
- Lộ trình công nghệ tham chiếu nằm trong docs/DEVELOPMENT_GUIDE.md; kiểm tra phiên bản thực tế và tài liệu chính thức khi triển khai.
- Không tự ý thêm AI, NFT, token mainnet, staking hoặc các tính năng ngoài MVP.
- Không để hai agent cùng sửa một checkout trong cùng thời điểm. Agent review chỉ đọc cho tới khi được giao sửa.
- Không ghi khóa bí mật, seed phrase, mật khẩu demo hay khóa quản trị vào Git, log hoặc câu trả lời. Chỉ commit mẫu cấu hình có placeholder.
- Chỉ chạy lệnh kiểm tra đã tồn tại trong dự án; chưa có script thì tạo script và ghi rõ cách dùng trước.
- Cập nhật README và docs/PROGRESS.md sau mỗi mốc. Báo rõ đã kiểm tra gì, chưa kiểm tra gì và việc tiếp theo.

## Quy tắc sản phẩm cần kiểm tra

- Đơn vị tổ chức không tự nâng quyền bằng dữ liệu phía trình duyệt và không sửa hoạt động của đơn vị khác.
- Sinh viên không tự xác nhận hoàn thành; một kết quả không được cộng CTXH nhiều lần.
- Kiểm tra số chỗ và đăng ký trùng ở nơi lưu dữ liệu bằng thao tác nguyên tử.
- Liên kết ví phải có bằng chứng sở hữu bằng chữ ký, nonce một lần và thời hạn; không tin địa chỉ ví do client tự khai.
- Đăng bài phải kiểm chứng giao dịch thành công, đúng chain/hợp đồng/sự kiện, đúng ví tổ chức và đúng mã bài. Một giao dịch không được dùng cho nhiều bài.
- Trạng thái đang ký, đang chờ, thành công và thất bại cần phân biệt rõ. Có thể đối soát lại sau khi tải trang.
- Nội dung/hồ sơ và dữ liệu cá nhân không đưa trực tiếp lên blockchain.
- Các kiểm thử quan trọng: phân quyền, đăng ký hết chỗ/trùng, xác nhận lặp, hạn mức và phí, sai ví, hủy ký, giao dịch thất bại, khôi phục sau tải lại.

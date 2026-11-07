# Quyền riêng tư — bản demo

1.0, 07/11/2026. Có thể code UI nhãn demo; không tự công bố là chính sách pháp lý hoàn chỉnh hoặc điền pháp nhân giả.

## 1. Dữ liệu và mục đích

| Nhóm | Mục đích và bên truy cập |
| --- | --- |
| Account/email/display name | Auth, hỗ trợ; nền tảng/provider auth cần thiết |
| Ví và booking | Proof ownership, giá/quote/receipt, quyền renter/host tương ứng |
| Host specs/health | Xét duyệt, availability và hỗ trợ; public chỉ fields an toàn |
| IP/device/network | Bảo vệ và chẩn đoán, không public listing/PII |
| Project/manifest | Chỉ khi bật cloud; renter, dịch vụ sync và storage có scope |
| Incident/audit | Điều tra tối thiểu; admin được phép, không công khai file riêng |

Không mặc định thu địa chỉ nhà/CCCD/phone/keystroke hoặc quay màn hình. Nếu quy trình host/payout tương lai cần thêm dữ liệu, cập nhật chính sách và mục đích trước thu.

## 2. Providers và chia sẻ

Danh mục thực tế điền sau cấu hình: auth/database, object storage, relay/hosting và LLM nếu có. Chỉ trao phần cần thiết, quyền tối thiểu/audit. Không ghi “không bên thứ ba tiếp cận” khi vẫn dùng các dịch vụ này.

Host/renter không được contact/identity của nhau ngoài fields chủ động công bố. Guest nhận định danh booking và workspace scoped, không cloud account chính.

AI chỉ nhận nhu cầu cấu hình/catalog đã lọc; không gửi project/secret mặc định. Provider LLM chưa cấu hình thì không có gọi API, không giả AI đang chạy.

## 3. On-chain

Ví, token balance, booking/amount/public policyHash và giao dịch cần thiết công khai, có thể liên kết. Xóa account không xóa blockchain. Không đưa PII/IP/file/evidence riêng lên chain.

## 4. Retention demo

- Guest: kết thúc quyền, recovery có hạn tối đa600 giây, reset/verify trước khách tiếp.
- Cloud committed: 7 ngày từ checkpoint thành công cuối; tối đa3 versions trong quota.
- Staging cloud chưa commit: tối đa24h, nhưng guest token hết hạn sớm theo phiên/recovery.
- Session/enrollment challenge tokens: expiry ngắn, revoke/cleanup, chỉ hash khi lưu.
- Logs/evidence vận hành: tối đa30 ngày trong demo trừ khi cần xử lý sự cố được ghi rõ; không secret hoặc nội dung màn hình.
- Blockchain: công khai và không xóa.

Storage backup/replica retention của provider thật cần khai báo sau khi kiểm tra; chưa hứa xóa khỏi mọi bản sao vật lý của host. No-cloud không loại bỏ metadata booking/auth tối thiểu.

## 5. Quyền người dùng

Cho xem/sửa profile, xem lịch sử, export/xóa workspace qua portal thiết bị riêng. Xóa/revoke cloud phải thu hồi grants và lease, không để session cũ tiếp tục đọc.

Yêu cầu xóa account xử lý ownership/booking chưa terminal và metadata cần giữ theo thực tế; không hứa mất sạch mọi log/chain ngay. Trước public cần kênh hỗ trợ thật và chính sách thương mại được chủ dự án xác nhận.

## 6. Giới hạn kỹ thuật

TLS/encryption-at-rest/private bucket giảm rủi ro, không ngăn host quản trị đọc runtime hoặc nền tảng giữ key truy cập theo quyền kỹ thuật. Không zero knowledge/bảo mật tuyệt đối.

P2P có thể lộ IP peer; relay cần triển khai và đo riêng. Ví/seed/mật khẩu chính chỉ dùng trên thiết bị riêng, không guest.

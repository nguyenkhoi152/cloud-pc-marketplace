# Cloud workspace 1.0

Core persistence là project nhỏ có checkpoint, không full OS/RAM. Có thể code/test local trước khi có cloud account.

## 1. Modes và mặc định

No-cloud: không upload dự án; guest tạm, khách export trước kết thúc. Vẫn có metadata nghiệp vụ tối thiểu.

Cloud project: workspace thuộc renter, template/app version tương thích; restore checkpoint thành công ở host khác. Quota demo 100 MiB tổng mọi version, tối đa 3 checkpoint, 10 MiB/file, 500 file/checkpoint. Retention demo 7 ngày từ checkpoint thành công cuối; UI báo expiry. Staging chưa commit tối đa 24h ở storage, quyền guest ngắn hơn.

Storage trong demo giới hạn có thể miễn phí thử, không tuyên bố thương mại miễn phí. Không tự trừ PCP cho cloud trong core để tránh một chính sách tiền chưa đặc tả.

## 2. Store và broker

WorkspaceStore interface có LocalFileStore cho dev/tests và S3CompatibleStore cho cloud thật. Local FS không được bật làm durable storage ở production/serverless. Không gọi local file là cloud.

DB giữ owner/template/quota/latest version/lease/manifest. Blobs dùng key ngẫu nhiên, private. Broker kiểm tra quyền mỗi request, không phát root storage key, tài khoản cloud cá nhân hoặc service role vào guest.

Server/guest chỉ nhận scope cần cho booking/workspace/version. Token opaque lưu hash server, expiry/revocation; guest không có full Supabase user session.

Nếu dùng presigned URL, phải thừa nhận bearer/reusable tới expiry và transfer đã mở có thể tiếp tục. MVP ưu tiên broker kiểm tra session, cancellation và scope; không gọi URL có hạn là one-time/revoked ngay.

## 3. Một writer và version bất biến

Lease một workspace cho một booking writer; second writer từ chối. Check expectedVersion khi commit.

Restore đọc checkpoint đã commit. Upload chỉ vào staging của phiên, không overwrite/delete checkpoint cũ hoặc list tenant khác. Canonical path, chống traversal/symlink, limits và checksum.

Commit gồm danh sách object immutable + hash/size/template, kiểm tra mọi object có thật và quota, rồi transaction đổi latest pointer/version. Không báo Saved trước commit.

Giữ tối đa 3 bản; GC chỉ sau commit bản mới và policy/quota cho phép, không xóa bản tốt cuối cùng để tạo chỗ rồi upload thất bại. Quota tính cả versions/staging khả dụng theo giới hạn; reject trước nếu vượt. Hash xác minh byte, không chứng minh host không sửa file.

## 4. Vòng đời

Chọn workspace trên portal thiết bị riêng → acquire lease → restore guest sạch → Ready → file đã save được checkpoint → kết thúc input → checkpoint cuối/recovery → revoke storage grants → reset → release lease.

Sync đề xuất mỗi 60 giây cho file đã ghi disk/ứng dụng có consistency phù hợp. Không khẳng định tự cứu nội dung chưa save trong RAM. UI báo last-confirmed-save/Syncing/Failed, cảnh báo trước endAt.

## 5. Recovery và xóa

EndAt luôn cắt remote input, không vì sync mà cho thuê thêm thời gian.

Đặt effectiveEndAt là thời điểm kết thúc thực tế được server ghi nhận hợp lệ, không muộn hơn endAt on-chain; khóa một lần khi end/revoke/dispute, không lấy clock client. Nếu sync cuối chưa xong, recovery-only tới effectiveEndAt+600 giây, chỉ upload/commit staging đã ràng buộc, không đọc thêm phiên bản hay mở desktop. Kết thúc sớm không được chờ tới endAt cũ rồi cộng thêm10 phút; mất kết nối tạm chưa kết thúc vẫn theo thời hạn phiên.

Sau hạn: revoke tất cả grants, đánh dấu Failed nếu chưa commit, hiển thị checkpoint cuối còn dùng được, dừng/reset guest. Dữ liệu chưa sync có thể mất; công bố trước phiên. Không giữ plaintext/key trên host vô thời hạn để hứa recovery.

Trong demo, không có quarantine guest kéo dài ngoài hạn này. Nếu không reset được, giữ máy unavailable để vận hành; không cho khách tiếp vào guest cũ.

Xóa workspace do chủ tài khoản yêu cầu từ portal: revoke grants/lease, GC blobs/versions theo chính sách và ghi audit tối thiểu. Chưa hứa xóa khỏi mọi backup vật lý hoặc host độc hại; phải xác minh provider backup policy khi deploy.

## 6. Storage security

TLS ngoài máy local; private bucket, tenant access server-side; production phải kiểm tra encryption-at-rest/key config thật. Platform-managed keys không là zero knowledge. Local dev chỉ dùng dữ liệu test, không coi file plaintext local đáp ứng cloud production security.

Host/guest không xóa versions hoặc thay bucket policy; admin/support có least privilege/audit. Không gửi project/credential cho AI tư vấn.

Host quản trị có thể quan sát plaintext/runtime/token đang dùng. Mã hóa ổ/cloud không tự bảo vệ khỏi host này. Ví/email chính/seed/API keys không nhập trên guest. Demo dữ liệu không nhạy cảm.

## 7. Portability

Host A save project → confirm checkpoint → end/revoke/reset → thuê host B với template/app tương thích → restore đúng content/hash và dùng tiếp.

Hai adapter local mô phỏng chứng minh logic, không chứng minh hai host thật. Cần bằng chứng riêng khi có hardware. Không mang nguyên Windows, app license, installed game hoặc RAM sang mọi máy.

Restore time phụ thuộc dữ liệu/mạng; không hứa chuyển tức thời. Template metadata phục vụ lọc máy, app có thể cần tự mở lại.

## 8. Tests

Cross-user read/write/guess key bị chặn; no-cloud không upload; expired/revoked grant; active transfer cancellation; wrong workspace/version; quota/partial-upload/hash fail; atomic pointer; duplicate commit; two writers; rollback; guest không xóa version; last Saved không giả; power loss chỉ restore checkpoint; renter sau không thấy cache/credential trước.

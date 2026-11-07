# Claude và Codex — triển khai theo mốc

## Quyền và nguồn chung

AGENTS ở gốc, APPROVAL, MVP và PROGRESS là đầu vào. START_HERE có prompt đầu tiên.

User đã yêu cầu Claude bắt đầu; không dừng để hỏi lại toàn bộ giá/tham số demo. Mặc định1.0 dùng cho code local; thương mại/tài nguyên ngoài theo quyền cụ thể.

## Một writer

Claude viết/Codex review hoặc ngược lại. Chờ writer dừng trước review/đổi writer. Review chỉ đọc, không tự migration/deploy/đụng phiên remote. Không tự spawn agent hoặc tạo worktree khi chưa cần/được giao.

Local Git có thể chuẩn bị nếu chưa có repo; bảo toàn uncommitted work. Không tự push/publish. Kiểm tra secret/diff trước commit.

## Bàn giao

Sau mốc ghi vào PROGRESS: thay đổi, commit nếu có, scripts/thao tác, evidence, mocks, blockers, process/jobs còn chạy và bước tiếp. Chưa có commit thì nói chưa có, không tạo SHA giả.

Chat mới phải kiểm tra folder/state thực tế. Không tin lời “xong” thay cho receipt/tests hoặc lặp scaffold/deploy.

## Prompt review

~~~text
Đọc AGENTS, MVP, APPROVAL, PROGRESS và diff mốc vừa xong.
Chỉ review, chưa sửa file, chưa migration/deploy hoặc điều khiển PC.
Kiểm tra quyền server/RLS, atomic reservation, wallet proof, quote/PCP transfer policy,
fund/refund/dispute/withdraw và conservation; receipt/recovery; revoke active stream/reconnect;
workspace tenant isolation, lease/version/quota và last-saved.
Mỗi finding có file/vị trí, điều kiện tái hiện và tác động.
Phân biệt lỗi đã chứng minh với nghi vấn; không báo test PASS nếu chưa chạy.
~~~

## Prompt sửa

~~~text
Kiểm tra lại findings có căn cứ trên checkout hiện tại.
Sửa đúng phạm vi, chạy kiểm tra liên quan qua scripts đã có/được tạo và ghi cách dùng.
Không mở rộng feature hoặc đổi money rules âm thầm.
Cập nhật README/PROGRESS, nêu phần đã sửa/chưa thể kiểm tra và bước tiếp.
~~~

## Chặn cục bộ

Thiếu PC không chặn web/contract/storage local tests. Thiếu cloud key không là lý do giả dữ liệu hoặc thuê tài nguyên. Hỏi đúng missing input khi tới bước phụ thuộc, tiếp tục việc local độc lập.

Nếu thay default ảnh hưởng tiền/quyền, cập nhật APPROVAL/CONTRACT_SPEC/MVP/tests trước hoặc cùng code. Không dùng tài liệu research cũ để ghi đè spec.

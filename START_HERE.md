# Bắt đầu tại đây — giao việc cho Claude Code

Hồ sơ 1.0, 07/11/2026. Người dùng đã yêu cầu chuẩn bị để Claude bắt đầu làm. Không yêu cầu duyệt lại toàn bộ tài liệu trước phần local.

## 1. Đặt file

Giữ README.md, AGENTS.md, CLAUDE.md và START_HERE.md ở gốc folder dự án; docs/ là thư mục con. Nếu nhận ZIP, giải nén thành một folder dự án rồi mở folder đó trong VS Code. Không tạo folder dự án lồng bên trong checkout có code mà chưa xem cấu trúc.

Nếu folder hiện có code hoặc thay đổi người dùng, kiểm tra và giữ lại. Khi đã ở chính checkout có bộ 1.0, không cần giải nén đè thêm.

## 2. Thứ tự đọc

1. AGENTS.md, README.md, docs/APPROVAL.md, docs/MVP.md, docs/PROGRESS.md.
2. docs/ARCHITECTURE.md và docs/DEVELOPMENT_GUIDE.md.
3. Theo mốc đọc CONTRACT_SPEC/POINTS, DATA_MODEL, REMOTE_ACCESS, CLOUD_WORKSPACES, SECURITY và TEST_PLAN.

Chỉ dùng các đặc tả 1.0 hiện hành. Tài liệu research và chính sách demo là nguồn bổ sung, không phải lý do dừng code đã được giao.

## 3. Prompt đầu tiên — dán vào Claude Code

~~~text
Bạn là agent triển khai chính của Cloud PC Marketplace.
Đọc AGENTS.md, README.md, START_HERE.md, docs/APPROVAL.md, docs/MVP.md,
docs/PROGRESS.md, docs/ARCHITECTURE.md và docs/DEVELOPMENT_GUIDE.md.

Người dùng đã yêu cầu bắt đầu triển khai local. Làm M1 đến khi có bộ khung chạy được,
không dừng ở việc tóm tắt tài liệu hoặc xin duyệt lại mọi mặc định.

1. Kiểm tra đúng folder, file/code sẵn có, Git, Node/npm và công cụ thực tế.
2. Khởi tạo Next.js + TypeScript + Tailwind cho web; chuẩn bị contracts, worker,
shared types và migrations khi có nội dung cần thiết. Dùng phiên bản tương thích
theo docs chính thức, pin dependency/lockfile, không chép lệnh Hardhat 2.
3. Tạo UI tiếng Việt: danh sách/lọc máy, chi tiết, host dashboard, admin review,
đặt thuê, ví PCP, phiên thuê, lịch sử và workspace.
4. Fixture preview phải gắn nhãn rõ. Không giả đăng nhập, receipt, máy đang online,
remote desktop hoặc cloud sync; chế độ preview không cấp quyền thật.
5. Tạo .gitignore, cấu hình .env.example chỉ placeholder, validation cấu hình.
Không tạo private key demo trong source hoặc log. Tạo scripts dev/build/lint/typecheck
cần thiết, ghi đúng cách dùng vào README rồi mới chạy kiểm tra.
6. Chuẩn bị các interfaces PaymentProvider, RemoteSessionProvider, WorkspaceStore
và RecommendationProvider. M1 chưa cần kết nối host/cloud hoặc LLM.
7. Nếu thiếu Docker/Supabase/PC/cloud, ghi blocker đúng phần và tiếp tục phần local
độc lập; không tự thuê tài nguyên hay cấu hình PC của người khác.
8. Hoàn thành build/typecheck/lint phù hợp, sửa lỗi, cập nhật README và PROGRESS:
đã chạy gì, mock còn lại, chưa kiểm tra gì và mốc tiếp theo.

Chưa broadcast Fuji, deploy web, tạo chi phí, mainnet, cash-out hoặc phát hành thương mại.
Không thêm NFT/staking/token đầu cơ. Chỉ một agent được sửa checkout.
~~~

## 4. Kết quả M1 phải nhận được

Source thật, scripts thật, web local mở được theo README và báo cáo kiểm tra có bằng chứng. Chưa gọi M1 là MVP Cloud PC hoàn chỉnh.

Nếu môi trường không cho cài/chạy, agent vẫn chuẩn bị phần code phù hợp và nói chính xác chưa kiểm tra được gì; không báo PASS giả.

## 5. Prompt tiếp tục sau M1

~~~text
Đọc PROGRESS và thực hiện mốc local tiếp theo trong DEVELOPMENT_GUIDE.
Đừng scaffold lại từ đầu. Làm xong mỗi mốc thì kiểm tra, sửa lỗi và cập nhật tài liệu.
Chỉ hỏi thông tin còn thiếu ở bước phụ thuộc; tiếp tục việc độc lập đã được giao.
Không tự triển khai tài nguyên bên ngoài hoặc thay cấu hình máy chưa được chỉ định.
~~~

## 6. Review

Khi writer dừng, cho Codex review chỉ đọc theo AGENT_WORKFLOW. Không để Claude và Codex cùng sửa một checkout. Chuyển việc sửa findings cho một writer rõ ràng.

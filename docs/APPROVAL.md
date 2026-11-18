# Quyền thực hiện và mặc định triển khai

Handoff 1.0 — 07/11/2026, Asia/Saigon.

## 1. Yêu cầu mới nhất

Chủ dự án yêu cầu: “bây giờ bắt đầu tiến hành gửi hết md cần thiết để tôi đưa claude bắt đầu làm”.

Hệ quả: chuẩn bị bộ thống nhất cho Claude bắt đầu code local. Không tiếp tục chặn bởi trạng thái chờ duyệt của các draft trước. Không ghi rằng người dùng đã duyệt từng giá, thời hạn, license hay điều khoản thương mại.

## 2. Được làm khi nhận việc

Code ứng dụng và contract, dependencies trong dự án, migrations, cấu hình placeholder, tests local, sửa lỗi, tài liệu và chuẩn bị deployment scripts. M1 bắt đầu ngay; các mốc local sau tiếp tục theo yêu cầu giao cho writer.

Không cần xác nhận lại từng thao tác thường lệ trong phạm vi này. User có thể thay mặc định; khi đó cập nhật docs liên quan và code nhất quán.

## 3. Mặc định để code không bị treo

| Mục | Mặc định triển khai demo |
| --- | --- |
| Tên | Cloud PC Marketplace; token PC Point/PCP, có thể đổi trước deploy |
| Người dùng | Renter, host được cấp quyền, admin/operator demo |
| Thuê | Tức thời, một máy/một booking; host window tối thiểu 4 giờ |
| Gói | 900 giây, 20 PCP; fee 1000 bps phần gross host |
| Quote | Tối đa 600 giây; activateBy=fundBy+300 giây |
| Khiếu nại | Trước endAt+600 giây; phân xử trong 86400 giây |
| Điểm | ERC-20 hạn chế chuyển, 18 decimals; supply cap 1.000.000 PCP thử |
| Faucet | 1.000 PCP/ví demo, một lần, allowlist server, không tiền thật |
| Blockchain | Contract test local trước; target Fuji 43113, AVAX trả gas |
| Ví | Core/MetaMask hoặc ví EVM qua connector chuẩn; không tự viết lưu seed trong browser |
| Streaming | Selkies trong app Companion qua session gateway của host-agent (thay Sunshine/Moonlight, 08/11/2026); adapter thật sau spike, preview/mock riêng |
| Guest | Môi trường sạch chuyên dụng; OS/GPU thực tế chốt khi có máy |
| Storage | Project-only, quota 100 MiB gồm versions, tối đa 3 checkpoint, một writer |
| Checkpoint | Tối đa 10 MiB/file, 500 file; giữ 7 ngày từ checkpoint cuối trong demo |
| Sync | Gợi ý mỗi 60 giây cho file đã save; recovery nền tối đa 600 giây sau end |
| Ngoài core | Host bond/slashing, AI trả phí, x402 gasless, fiat/mainnet, full OS migration |

Các con số là lựa chọn kỹ thuật có thể cấu hình cho demo, không phải người dùng đã chốt chính sách kinh doanh. Không chuyển sang giá thật tự động.

## 4. Đầu vào chỉ chặn phần liên quan

| Thiếu | Vẫn làm được | Chỉ dừng ở |
| --- | --- | --- |
| PC cho thuê | Web, schema, contracts, worker, adapters/tests | Cài/kiểm tra remote trên máy thật |
| Supabase/cloud credential | Migrations, RLS tests nếu local khả dụng, storage adapter | Kết nối dịch vụ ngoài có credential |
| Docker | UI/core/contract tests và code adapter | Bằng chứng integration DB/guest cần Docker |
| Ví/AVAX Fuji | Tests local và deploy scripts | Broadcast Fuji |
| LLM key/budget | Bộ lọc, rule recommendation, interface | Gọi model trả phí |
| Host thứ hai | Workspace unit/integration test local | Chứng minh portability thật qua hai host |

Không fake kết quả phần bị chặn và không dùng blocker đó để từ chối mọi phần còn lại.

## 5. Hành động cần đầu vào/quyền cụ thể

Tạo tài khoản/tài nguyên trả phí, cloud production, domain, deploy công khai, broadcast Fuji, push/publish GitHub, sửa máy/OS/router/firewall, mời người khác, thu tiền hoặc công bố điều khoản thương mại. Chuẩn bị kết quả cấu hình/script có thể review trước khi xin đầu vào ở đúng bước.

## 6. Nhật ký

07/11: từ nghiên cứu UniAct → Cloud PC → marketplace → streaming → cloud/chính sách → point.

07/11: yêu cầu hiện tại cho handoff để Claude bắt đầu. Tác vụ soạn tài liệu không tự chạy app hoặc deploy; writer sẽ làm khi nhận prompt. Các bản 0.1–0.3 được lưu trong ZIP backup trước hợp nhất.

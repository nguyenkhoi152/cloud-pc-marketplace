# MVP triển khai 1.0

Nguồn phạm vi cho code local. Quyền tại [APPROVAL](APPROVAL.md); giá/thời hạn demo không là chính sách thương mại.

## 1. Kết quả mục tiêu

Host được duyệt đăng máy và giờ sẵn sàng; renter tìm máy, trả PCP thử vào escrow, dùng desktop thật qua Moonlight, tùy chọn checkpoint project rồi mở lại trên host khác. Hệ thống thu hồi quyền và chia/hoàn point đúng một lần.

## 2. Core bắt buộc

| Phần | Hành vi |
| --- | --- |
| Auth | Đăng nhập, role server, wallet proof, không tự cấp host/admin |
| Listing | Draft/review/approved/suspended; cấu hình khai và kết quả kiểm tra có ngày |
| Availability | Host đăng window >=4h; heartbeat; chỉ thuê ngay, đủ buffer và thời lượng |
| Search | CPU/RAM/GPU/VRAM, OS/template, app, giá, vùng và workspace compatibility |
| Reservation | Atomic lock, quote bất biến có hạn, không double booking |
| Point | PCP thử có balance/allowance; label testnet; không mua/cash-out thật |
| Escrow | Fund/activate/cancel/refund/accept/dispute/timeout/claim/withdraw theo CONTRACT_SPEC |
| Remote | Adapter Sunshine/Moonlight, pairing theo phiên, watchdog/revoke/reconnect/reset |
| Workspace | No-cloud hoặc project cloud; version, last-saved, restore và quyền tenant |
| Policy | Hiện policy version trước xác nhận; incident/appeal cơ bản, không slash tự động |
| Recovery | Refresh/crash/retry không mất state hoặc tạo side effect trùng |

Một tài khoản có thể được cấp host và thuê máy khác; không thuê máy chính mình trong demo.

## 3. Màn hình

Danh sách/lọc máy, chi tiết, đăng nhập/liên kết ví, host dashboard/tạo listing, admin duyệt máy, checkout/quote, ví PCP, phiên thuê, lịch sử/receipt/credit withdraw, workspace/version và báo sự cố.

Tiền: Available/Reserved/Spent/Refunded/Earned/Withdrawable. Remote: Preparing/Ready/Connecting/Active/Disconnected/Expired/Revoking/CleanupFailed. Cloud: NotEnabled/Restoring/Syncing/Saved/Failed. Không gom mọi thứ vào “thành công”.

## 4. Mặc định và điều kiện

Demo 15 phút/20 PCP/10% fee. Chỉ mở khi confirmed Funded + Active, guest sẵn sàng và đúng renter. startedAt lấy từ block activate; chờ xác nhận/grant nằm trong gói, có đường dispute nếu không dùng được.

Chưa auto-renew, chưa tính tiền từng giây, chưa đặt lịch tương lai. Hủy trước activation hoàn đủ; kết thúc sớm và accept trả cả gói, UI phải nói rõ trước ký. Incident không tự là dispute on-chain.

Giữ máy tới khi tiền terminal và access revoked/reset verified. Đây là giới hạn bảo thủ của MVP, có thể làm máy chờ lâu khi dispute; không tự bỏ lock để tăng doanh thu.

## 5. Workspace và bảo mật

Project cloud ở ngoài host, quota/version theo APPROVAL. Chỉ giữ file đã checkpoint xác nhận; không full Windows/RAM/app migration. No-cloud không upload dự án; khách phải export trước kết thúc.

Để chứng minh portability cần hai host thật tuần tự với template tương thích. Một máy mô phỏng hai ID chỉ là test logic, không đạt bằng chứng hai host.

Không đưa khách vào desktop cá nhân. VM/cloud encryption không bảo đảm bí mật runtime trước host quản trị; demo dùng dữ liệu không nhạy cảm.

## 6. Mốc sau core

AI tư vấn chỉ đọc catalog, host bond có chính sách/đặc tả riêng, x402/relayer được benchmark/review, nhiều gói, storage thương mại, Windows/GPU/game phù hợp license. Không dựng nút giả hoạt động cho phần chưa làm.

## 7. Nghiệm thu full MVP

- Host/renter/admin thực hiện đúng quyền; dữ liệu bền vững.
- Hai request đặt cùng máy chỉ một thành công; quote/chain receipt không tái sử dụng.
- Một phiên desktop thật qua hai mạng; revoke cắt active stream và link/pair cũ.
- Watchdog hết hạn vẫn hoạt động khi browser/web/worker trung tâm dừng.
- Token funding/settlement/refund/withdraw thật trên Fuji có receipt; không chỉ mock/local.
- No-cloud và cloud tenant isolation được thử; một project restore trên host thứ hai.
- Sai ví/mạng/amount/token, hủy ký, tx lỗi, RPC lỗi, cleanup fail và reload xử lý rõ.
- README, tests, cấu hình mẫu, deployment record và bài nộp trung thực.

M1 UI preview hoặc contract tests qua không đồng nghĩa full MVP đạt. Những phần cần credential/host ngoài chỉ ghi BLOCKED phần đó.

# Point và thanh toán 1.0

Chi tiết tiền/contract chuẩn ở [CONTRACT_SPEC](CONTRACT_SPEC.md). Đây là cách sản phẩm hiển thị và phân biệt demo với thương mại.

## 1. Lựa chọn core

PC Point (PCP) là ERC-20 restricted-transfer trên local/Fuji, 18 decimals, chỉ thử nghiệm. Mặc định gói 20 PCP/900 giây, fee 10% phần gross host. Có faucet allowlist 1.000 PCP/ví một lần; tổng cap 1.000.000 PCP.

Không có tỷ giá VND/USDC, mua point thật hoặc chuyển test balance thành tiền thật. Không tái sử dụng tên/address MIU.

AVAX Fuji trả gas. 0x là tiền tố địa chỉ EVM, không xác nhận đúng chain/contract. Core/MetaMask ký trên thiết bị riêng, không trên desktop thuê.

## 2. UX

Available: token balance ví đã xác minh. Reserved: principal booking trong escrow. Earned/Withdrawable: credit contract sau tất toán; chưa phải token đã về ví hoặc payout ngân hàng.

Quote khóa token/address/base amount/fee/deadline/parties/policy. Renter approve allowance cần thiết rồi fund; nhận receipt và state thật trước truy cập. Reload đối soát lại, không bắt trả thêm vì tab mất state.

Ví dụ 1.000 PCP, giữ 20 → còn 980 trong ví. Thành công H=20, host credit18/treasury2. Refund đủ trả credit20 renter; withdraw mới về ví. UI phải phân biệt Refund approved/Withdrawable/Withdrawn.

Không dùng float, không tự đổi 0.01 AVAX cũ sang PCP. Wrong token/symbol/address/chain từ chối. Contract không nhận direct token transfer là booking.

## 3. Quyền chuyển

PCP chỉ chuyển khi escrow gọi đúng đường fund/withdraw; user không P2P. Restricted-transfer vẫn có interface ERC-20 nhưng không hứa tương thích sàn/dApp ngoài.

Không dùng ERC20Pausable chặn toàn bộ refund/withdraw. Issuer có quyền mint trong cap; quyền này là tập trung, không quảng cáo point được bảo đảm giá trị.

## 4. x402 và relayer

SenpAI là tham khảo token thử/signature payment; x402 không bắt buộc để có point trên Avalanche. Core MVP dùng approve+fund.

Mốc sau có thể thêm EIP-3009/x402 gas-sponsored funding, phải gắn authorization với booking/asset/amount/payee/nonce/domain/deadline và chuyển/tạo booking nguyên tử. Default facilitator chỉ chuyển token không tự tạo escrow state.

Nếu thêm, test mọi transfer restriction và lối thoát cancel/dispute/withdraw. Relayer cần AVAX/budget và không được ký thay renter trái phép. Sponsor funding không đồng nghĩa người dùng không bao giờ cần gas.

## 5. Chính sách hoàn

Chưa activate: cancel/refund/expiry theo contract, principal đủ, fee0. Active: accept cả gói hoặc dispute; partial refund thông qua arbitrator H, chưa auto billing theo phút.

Gas đã dùng không tự được hoàn bằng PCP. Promo/purchased/fiat refund không có trong core demo. Không cắt cloud đã lưu chỉ vì compute balance hết; storage retention riêng.

Không auto-renew compute, không charge từng giây/frame. Nâng gói hoặc gia hạn cần đặc tả mới và đảm bảo host còn window.

## 6. Khi kinh doanh thật

Cần ledger purchased/promo/reserved/host earnings/host bond và payment/refund records tách biệt; nguồn tiền trả host được đối soát. Point tặng không tạo tiền; nếu được dùng thuê host cần subsidy thực hoặc chương trình host đồng ý.

Không dùng PCP thử mint tùy ý làm cọc có giá trị hoặc hứa rút tiền thật. Host bond/cash-out/tỷ giá/chargeback phải có đặc tả và điều kiện vận hành riêng, không tự mở từ demo.

## 7. Privacy

Ví, số dư/giao dịch công khai có thể liên kết; không xóa được chain history khi xóa account. ID ngẫu nhiên không là ẩn danh tuyệt đối.

Không PII/file/IP/endpoint/credential/chat AI/evidence riêng lên chain. Provider ngoài chỉ nhận dữ liệu cần theo privacy demo, không ghi “không bên thứ ba tiếp cận” khi kiến trúc dùng cloud/auth/AI.

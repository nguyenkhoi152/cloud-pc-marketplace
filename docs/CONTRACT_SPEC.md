# PCP và RentalEscrow — đặc tả triển khai 1.0

Target local trước, Fuji sau khi có quyền/cấu hình broadcast. Chưa có code/deployment. Thay hoàn toàn escrow native AVAX 0.1.

## 1. Token PC Point (PCP)

ERC-20 restricted-transfer, 18 decimals, không upgrade. Tên/symbol là mặc định trước deploy. Supply cap 1.000.000 PCP thử; mint có role issuer và event, không burn tùy ý số dư người khác.

Deploy token → deploy escrow nhận token address → configureEscrowOnce(address) trên token. Hàm chỉ admin, một lần, địa chỉ nonzero có code. Không được đổi escrow hoặc allowlist tùy ý sau đó. Chỉ bật faucet/mint demo sau cấu hình.

Faucet demo: issuer mint 1.000 PCP cho ví allowlist một lần, server chống lặp wallet/account và có ngân sách; cap nằm ở token, không chỉ UI. Hàm mint yêu cầu escrow đã cấu hình và recipient khác escrow để không tạo khoản nạp không booking. Không mở faucet production cho mọi ví hoặc hứa chống Sybil tuyệt đối.

### Transfer policy

Mint hợp lệ từ issuer qua hàm mint. Với chuyển thông thường, chỉ cho phép caller là escrow đã cấu hình và (to=escrow hoặc from=escrow).

Hệ quả: escrow.transferFrom(renter, escrow, P) để fund; escrow.transfer(beneficiary, credit) khi withdraw. User không gửi P2P, không chuyển tay vào escrow, spender khác dù có allowance không chuyển được. Áp dụng kiểm tra tại điểm cập nhật balance chung, test transfer và transferFrom; không chỉ ẩn nút.

Core không có permit/EIP-3009/x402 authorization để tránh thêm đường chuyển chưa kiểm chứng. Approve chuẩn được hỗ trợ; UI chỉ xin allowance cần thiết cho escrow. Không dùng global token pause chặn refund/withdraw.

PCP không có backing/giá tiền thật, không DEX/staking/cash-out. Không dùng nó để tuyên bố bond có giá trị bảo đảm thật.

## 2. Escrow

Một acceptedToken immutable đúng PCP, không upgrade, dùng SafeERC20/ReentrancyGuard phù hợp. Nonpayable funding; không coi AVAX hoặc token lạ là khoản thuê.

Không hỗ trợ fee-on-transfer/rebase; kiểm tra amount nhận chính xác. Không có admin sweep tiền PCP đang giữ hoặc credit. Tài sản ngoài ý muốn không tự tạo booking.

## 3. Quote EIP-712

Domain: name/version/chainId/verifyingContract. Payload:

bookingId ngẫu nhiên bytes32, machineKey canonical ngẫu nhiên, renter, host, token, priceUnits, feeBps, treasury, durationSeconds, issuedAt, fundBy, activateBy, graceSeconds, arbitrationSeconds, policyHash và configVersion.

fund kiểm tra:

- Quote signer được cấp quyền, chữ ký đúng domain, msg.sender=renter, renter khác host.
- Token đúng acceptedToken; địa chỉ nonzero; giá dương; fee/treasury/configVersion khớp cấu hình hiện hành.
- bookingId chưa dùng vĩnh viễn; machineKey chưa occupied.
- issuedAt không ở tương lai theo block time, fundBy=issuedAt+600, block.timestamp < fundBy; activateBy=fundBy+300.
- duration=900, grace=600, arbitration=86400 của cấu hình demo; không nhận deadline tùy ý từ client.

Token pull và tạo booking/occupancy nằm cùng transaction; lỗi bất kỳ phải rollback toàn bộ. Cập nhật config vô hiệu quote chưa fund qua version, không sửa snapshot booking đã fund.

Quote lấy chain timestamp phù hợp để tránh server clock sai; policyHash chỉ hash bản chính sách công khai, không hash dữ liệu cá nhân rồi coi là ẩn danh.

## 4. Role

Renter fund/cancel/accept/dispute; host có thể refund trước start hoặc dispute; operator activate/refund trước start; arbitrator resolve Disputed; admin quản lý role/config/pause cho booking tương lai.

Timeout/claim có thể do bất kỳ ai gọi đúng điều kiện, nhưng tiền luôn ghi có đúng beneficiary. Admin/operator không tự nhận tiền từ booking.

## 5. State và thao tác

~~~text
None --fund--> Funded --activate--> Active --accept/claimAfterGrace--> Settled
                  |                 |
                  |                 +--openDispute--> Disputed --resolve--> Resolved
                  |                                      |
                  +--cancel/refund/expiry--> Refunded      +--timeout--> Refunded
~~~

| Hàm | Điều kiện | Kết quả |
| --- | --- | --- |
| fund | Quote hợp lệ + allowance/số dư đủ | Giữ P PCP, Funded, occupied machine |
| cancelBeforeStart | Renter, Funded | Credit P renter, Refunded |
| refundBeforeStart | Host hoặc operator, Funded | Credit P renter, Refunded |
| refundExpired | Bất kỳ ai, Funded, now >= activateBy | Credit P renter, Refunded |
| activate | Operator, Funded, now < activateBy, activation không pause | Active; startedAt=block timestamp; endAt=startedAt+duration |
| accept | Renter, Active | Settled, H=P; kể cả kết thúc sớm |
| openDispute | Renter hoặc host, Active, now < endAt+grace | Disputed; resolutionDeadline=now+arbitration |
| claimAfterGrace | Bất kỳ ai, Active, now >= endAt+grace | Settled, H=P |
| resolve(id,H) | Arbitrator, Disputed, now < resolutionDeadline, 0<=H<=P | Resolved, split |
| refundUnresolved | Bất kỳ ai, Disputed, now >= resolutionDeadline | Refunded, H=0 |
| withdrawPCP | msg.sender có credit | Chuyển đúng PCP; lỗi không mất credit |

Terminal: Settled/Resolved/Refunded. Gỡ occupancy chain một lần khi terminal; DB chỉ mở máy khi remote/workspace cleanup đạt. BookingId terminal không tái sử dụng.

Các dấu biên cố định như bảng. Cancel/activate hoặc dispute/claim race tuân thứ tự chain; không theo lúc bấm UI.

## 6. Split và invariant

P là priceUnits, H là gross host được phân xử, B là feeBps snapshot.

~~~text
fee = floor(H * B / 10000)
hostCredit = H - fee
renterCredit = P - H
treasuryCredit = fee
totalCreditAdded = P
~~~

Demo feeBps=1000. Accept/claim dùng H=P; refund H=0, không thu phí. Credit nhiều role vào cùng ví phải cộng, không overwrite.

Pull payment: transition chỉ ghi có; withdraw mới chuyển, checks-effects-interactions và reentrancy guard. Failed transfer giữ quyền rút. Token balance escrow >= outstanding locked principal + unwithdrawn credits. Không cộng P hai lần hoặc đếm credit cache DB như tiền mới.

## 7. Pause và quản trị

Pause funding/activation có thể chặn phiên mới; cancel/refund/dispute/resolve/timeouts/claim/withdraw vẫn dùng được theo state. Không có token global pause cắt đường rút.

Role changes/config có events; funded booking giữ host/treasury/fee/deadlines. Admin recovery không được thay beneficiary hay rút principal. Chưa có multisig/timelock thì không quảng cáo đã có.

## 8. Kết nối remote

Operator activate sau funding receipt và preflight guest/workspace. Chờ activate confirmed rồi mới grant. startedAt đã bắt đầu trước grant; đo overhead, incident/dispute nếu thất bại.

Accept/dispute/terminal phát events để worker revoke sớm. EndAt luôn ngắt desktop dù chưa claim/settle. Contract không gọi Selkies/gateway và không tự chạy timeout; UI/worker phải thực hiện transaction.

Không giả vờ blockchain chứng minh desktop mượt hoặc file đã lưu.

## 9. Dispute demo

Admin arbitrator xem evidence ngoài chain, ghi quyết định/lý do audit riêng và ký resolve H. Cho phép partial refund qua H; không quảng cáo có billing theo phút tự động.

Hết 24h không resolve thì full refund cho renter. Có thể làm host mất doanh thu dù đã phục vụ; công bố trong chính sách test. Sau accept/terminal không mở lại hoặc sửa split.

Core chưa có host bond, cash-out, promo expiry, x402 hoặc slashing. Không chèn chúng vào các hàm này mà không đặc tả/test riêng.

## 10. Events và bằng chứng

TokenConfigured/Minted, Funded/Activated/Refunded/DisputeOpened/Resolved/Settled/CreditWithdrawn và role/config/pause changes. Có ID, public parties, token/base amount/deadline cần đối soát; không PII/endpoint/file.

Backend kiểm tra receipt success, đúng chain/token/escrow/event/booking/renter/host/amount và state. Deduplicate chain/contract/tx/log index; xử lý reorg/pending/replace.

Deploy manifest public ghi chainId, token/escrow addresses, ABI/source/compiler/config/deploy tx. Hiện chưa có địa chỉ hoặc tx thật; không lấy của MIU.

## 11. Tests bắt buộc

Cap/issuer/faucet lặp; configure escrow một lần; P2P/direct-deposit/spender khác bị chặn; fund/withdraw hợp lệ qua restricted token; sai quote/asset/domain/time; occupancy; các transition/role/biên; conservation/split rounding; cancel-activate race; dispute-claim race; duplicate resolution; withdraw fail/reentrancy; pause vẫn thoát tiền.

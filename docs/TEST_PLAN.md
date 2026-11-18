# Kiểm tra và bằng chứng 1.0

Hiện chưa có ứng dụng/tests và chưa có PASS. Tạo scripts, ghi cách dùng trong README trước chạy. Không viết test chỉ để lặp implementation hoặc test rỗng.

## M1

Build/typecheck/lint phù hợp thực tế. Kiểm tra preview có nhãn, không gọi production adapters và không lộ secret/config private. Không cần unit test cho văn bản/giao diện tĩnh đơn giản.

## Auth/DB

- User sửa role/localStorage/owner không nâng quyền.
- Host không sửa máy/booking host khác; renter không đọc phiên/workspace người khác.
- RLS/service-role API đều kiểm tra ownership, không dựa user_metadata.
- Wallet domain/nonce/expiry/signature/user sai bị chặn; replay consume nguyên tử.
- Hai request đồng thời một máy chỉ một reservation/quote sống.
- Idempotency same payload không tạo thêm, payload khác bị từ chối.
- Hold hết nhưng receipt đến trễ phải đối soát trước release; RPC lỗi giữ khóa.
- Một device không hai listing active vượt lock; commitment đủ toàn bộ buffer.

## Token/escrow

Issuer/cap/mint trước cấu hình/escrow configuration lặp; faucet wallet lặp. P2P/direct-deposit/spender khác từ chối, đúng escrow fund/withdraw hoạt động.

Quote sai signer/domain/chain/contract/token/renter/host/amount/config/policy/time; allowance/số dư thiếu; token transfer lỗi rollback booking.

Fund/cancel/refund/activate/accept/dispute/claim/resolve/timeout/withdraw mỗi role/state; quote/booking replay; machine occupancy; biên dấu trước/tại/sau deadline.

Race cancel/activate, dispute/claim; resolution trùng; round fee; credit nhiều vai trò; withdraw lỗi/reentrancy; admin không quét principal; pause funding vẫn exits.

Invariant balance escrow >= locked principal + credit outstanding; tổng credit mỗi terminal bằng P, không double credit. Dùng local time control cho grace/24h, không thay timer deployment thật để giả demo.

## Worker/chain

Hủy ký/sai mạng/pending/revert không mở phiên. Tx hash giả/sai asset/event/booking/wallet bị từ chối.

Retry/duplicate events/jobs không side effect trùng. Reload/crash giữa fund/activate/grant/revoke/reset khôi phục đúng. Block hash/reorg/RPC unknown fail closed; không gửi lại fund vì tab mất state.

Nếu Active confirmed nhưng grant fail, incident/dispute có đường xử lý. Worker ngừng thì người dùng vẫn gọi permissionless refund/claim/timeout và withdraw theo điều kiện.

## Remote

Hai mạng mở desktop thật/gõ/chạy app. Grant đúng renter; nhiều tab/reconnect không kéo dài thời gian.

Revoke cắt active stream và pair/link cũ, kể cả client chưa dùng. Watchdog endAt khi browser/web/worker dừng. Reset phiên sau không còn file/process/credential, không route LAN/disk host.

Ghi latency/FPS/encode/decode/direct-relay điều kiện thực tế. Target revoke<=10s là mục tiêu thử, chưa SLA; không đánh PASS từ nút UI.

## Workspace

No-cloud không upload. Cross-tenant ID/key/token/read/write/manifest không truy cập được.

Lease một writer, duplicate commit idempotent, expectedVersion conflict không lost update. Quota/file limits/path traversal/symlink/checksum/partial upload fail không Saved; staging không overwrite/delete version tốt.

Revoke/expiry kiểm tra từng request và active transfer riêng; recovery-only không mở desktop/đọc rộng hoặc tồn tại quá hạn. Rollback hoạt động, last-confirmed-save đúng; power loss không giả phục hồi dữ liệu chưa sync.

Project save hostA → end/revoke/reset → hostB restore đúng. Hai máy local giả lập chỉ test logic, không PASS bằng chứng hai host thật.

## E2E configured

Host đăng/duyệt/window → renter quote/approve/fund PCP Fuji → activate → Selkies thật trong app → checkpoint/end/accept → revoke/reset → credit/withdraw → receipt.

Booking khác thử refund trước start; local thử dispute/split/timeout, Fuji thử nhánh khả thi có receipt. Cloud compatibility qua hai host. Script/tests pass không thay bằng chứng hardware.

## Release

HTTPS/auth redirect/origin, private remote/admin endpoints, worker health, production không mock/LocalFS, secrets không Git/history/bundle/log/video. Repo/slide/video mở được đúng quyền.

## Mẫu kết quả

~~~text
Mốc/commit/môi trường/phiên bản:
Scripts hoặc thao tác đã chạy:
Kỳ vọng / thực tế / PASS-FAIL-BLOCKED:
Bằng chứng đã lọc secret:
Mock còn lại và phần chưa chạy:
Rủi ro/blocker/bước tiếp:
~~~

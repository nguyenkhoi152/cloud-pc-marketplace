# Mô hình bảo mật 1.0

Đặc tả kiểm soát cần thực hiện, chưa là chứng nhận an toàn. Dùng dữ liệu không nhạy cảm và tài sản thử.

## 1. Tin cậy

Renter/client/listing là dữ liệu không tin cậy. Host được duyệt vẫn quản trị máy vật lý; có thể quan sát/tamper plaintext, memory, input, token khi workload chạy. Guest VM, TLS và disk encryption không tự loại bỏ quyền này.

Backend/issuer/operator/arbitrator/cloud key management là các bên tin cậy trong demo. Không pitch trustless/private tuyệt đối. Confidential computing/attestation là nghiên cứu riêng, không mặc định có trên PC dân dụng.

## 2. Bảo vệ host khỏi renter

Guest/máy chuyên dụng sạch; không mount home/raw disks/tài khoản/clipboard cá nhân hoặc Docker socket. Không arbitrary shell/API quản trị từ browser. Network chỉ guest/ports cần thiết, không route LAN/full mesh.

Quyền guest tối thiểu và reset được kiểm tra; GPU/input passthrough cần review đúng phần cứng/OS. Container không tự là VM isolation. Không giải phóng máy khi revoke/reset Unknown.

## 3. Bảo vệ renter khỏi host và renter khác

Cloud ngoài host, cấp read đúng version và write staging đúng booking. Guest không có user portal session/root storage/service key; không xóa checkpoint cũ.

Wallet ký/portal quản lý trên thiết bị riêng. Không yêu cầu email chính/seed/API key/drive password trên guest. Không lưu browser profile cá nhân vào workspace.

Không hứa host chưa copy dữ liệu chỉ vì reset hoặc delete key. IP có thể lộ khi P2P; chế độ relay cần thực hiện và đo trước khi quảng cáo che IP.

## 4. Identity và API

Supabase session verify server/RLS. Role không từ metadata user tự sửa hoặc localStorage. Wallet challenge binding session/domain/chain/address, nonce một lần và expiry, consume nguyên tử.

Mỗi resource authorization, CSRF/origin, schema validation, rate/body/file limits. Chống object ID guessing, traversal/symlink/SSRF; hostname/port remote lấy cấu hình được duyệt, không client tùy ý.

Host enrollment/heartbeat có credential riêng, chống replay và revoke; signature chứng minh nguồn thông báo, không chứng minh host không nói dối.

## 5. Tiền

Token restricted-transfer/issuer cap/escrow once, quote EIP-712 đầy đủ, chain receipt verifier, idempotency và pull payment theo CONTRACT_SPEC.

Pause new funding không chặn exits. Không lấy DB balance làm nguồn chuẩn; không refund/mint để che receipt chưa đối soát. Không dùng free points hứa cash-out, không slash heartbeat tự động.

## 6. Secret

Không seed/private key/password/access token/connection URL nhạy cảm trong Git/log/ảnh/câu trả lời. .env.example placeholder; .env thật ignore; kiểm tra cả build output.

Keys issuer/quote/operator/arbitrator, Supabase service/secret, S3 và Sunshine admin ở server/host secret store, không NEXT_PUBLIC. Không tự tạo ví tiền thật hoặc copy wallet code SenpAI.

Nếu dùng local test accounts, không in private key thành output bàn giao; tránh lệnh node simulator tự dump keys ra log công khai. Khóa thử được biết rộng không được dùng cho tài nguyên thật.

## 7. Dữ liệu

On-chain chỉ random IDs, public policyHash, ví và tiền/thời hạn cần thiết. Không file/PII/IP/endpoint/evidence nhạy cảm. Giao dịch có thể liên kết ví, không xóa được.

Saved chỉ sau commit checkpoint; no-cloud không upload. Version/quotas/recovery/retention ở CLOUD_WORKSPACES. Mã hóa do nền tảng giữ key không là zero knowledge.

Không mặc định quay màn hình/keystroke. Support xem tối thiểu theo quyền/audit; AI tư vấn không đọc project hoặc secret.

## 8. Sự cố

Ngừng phiên mới → revoke theo quyền → ghi evidence đã lọc → đối soát chain/provider → refund/dispute theo state → reset/verify rồi mở máy. Nếu không ngắt được, báo rõ và giữ máy unavailable.

Worker mất RPC không tự bảo đảm host có lỗi. Watchdog local kết thúc quyền theo hạn; token/URL expiry không thay cắt connection đang mở.

## 9. Trước công khai/kinh doanh

Rà soát license Windows/ứng dụng/streamer, terms/provider access, retention/backup, hạ tầng/keys, audit tiền và mô hình payout. Chuẩn bị code local không đồng nghĩa đủ điều kiện thu tiền/công bố SLA.

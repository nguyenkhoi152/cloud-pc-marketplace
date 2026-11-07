# Dữ liệu và API 1.0

Các bảng/endpoints là tên đề xuất để implementation, chưa có migration thật. Giữ bất biến nghiệp vụ khi đổi tên.

## 1. Schema chính

| Bảng | Nội dung/quyền |
| --- | --- |
| profiles | user_id, display_name, status; role từ nguồn server |
| host_profiles | owner, pending/approved/suspended, admin audit |
| wallet_challenges | user/domain/address/chain/nonce hash/expiry/consumed_at |
| wallet_links | user, normalized address, verified_at; demo một ví/một user |
| machines | owner, canonical machineKey, declared/verified specs, template, status, active_booking_id |
| host_commitments | machine, starts_at, ends_at, trạng thái nhận phiên; tối thiểu 4h |
| device_enrollments | machine identity, secret ref/hash, expiry/revocation, heartbeat counter |
| machine_private_config | private endpoint/credential refs, không trả client |
| policy_versions | immutable text/hash/version/effective time cho demo |
| bookings | UUID, random bytes32 chain ID, renter/machine/host, frozen quote, policy/workspace mode |
| chain_events | chain, contract, tx hash, log index, block/hash, event/state |
| remote_sessions | booking/user/provider ref, grants hash/expiry, state và cleanup result |
| workspaces | owner/template, latest version, quota/expires_at, active writer lease |
| workspace_versions | immutable manifest, checksum, size, created_at, committed state |
| workspace_objects | opaque object key/hash/size, ownership/version; không chứa cloud root key |
| session_grants | token hash, booking, workspace/version, scope, expiry, revoked_at |
| incidents/disputes | actors, lý do/evidence riêng, chain state, resolution/audit |
| outbox_jobs | unique action key, job type, attempts, available_at, lease, result |
| audit_logs | actor/action/resource/time/outcome, đã lọc secret |

PCP balance/locked/credit được index từ contract; DB không tự mint/hoàn hoặc coi cache là nguồn chuẩn. Không có purchased/promo/cash-out ledger hoạt động trong core demo.

## 2. RLS và auth

Public chỉ xem listing approved và fields an toàn. Host chỉ quản lý máy mình, không tự duyệt/cấp role/sửa payment snapshot. Renter chỉ thấy booking/workspace của mình. Admin/worker/internal write cấp riêng ở server.

Service role vượt RLS nên API dùng service role vẫn kiểm tra actor/resource. Không tin localStorage, role metadata user tự sửa hoặc machineId tự khai.

Wallet proof dùng challenge gắn session/domain/URI/chain/address/nonce/expiry; verify server và consume nguyên tử. Chặn đổi ví khi booking chưa terminal. EOA trước, ví contract chỉ hỗ trợ khi verifier được kiểm tra.

## 3. Reservation

Transaction khóa machine row, kiểm tra approved/health/commitment/active booking, tạo booking + quote snapshot + outbox. Constraint/unique bảo đảm một live reservation trên canonical machine. Một thiết bị không được tạo nhiều listing active để vượt lock.

Giá lấy server, renter từ auth, host từ listing, token/fee từ config contract. Không nhận override giá/role từ client. Commitment phải phủ fundBy + activation buffer + duration + recovery buffer tối đa.

Không giữ transaction DB mở trong lúc chờ RPC. Đối soát chain occupancy trước cấp quote và bảo vệ lại bằng contract khi fund.

Hold tối đa 600 giây. Hết giờ không release ngay: đối soát chain đã bắt kịp fundBy theo confirmation policy, booking và pending receipt. RPC không rõ thì giữ khóa; fund bị include sau fundBy phải revert.

Chỉ release máy khi tiền terminal, revoke/reset verified và workflow workspace đã kết thúc. Snapshot policy/quote không bị thay khi host sửa listing.

## 4. State độc lập

Money: Reserved (DB) → Funded → Active → Settled hoặc Refunded; Active → Disputed → Resolved/Refunded.

Access: NotGranted → Preparing → Ready → Granted → Revoking → Revoked → Resetting → ResetVerified; Failed/Unknown giữ máy unavailable.

Cloud: Disabled hoặc Restoring → Ready → Syncing → Saved/Failed; Recovery có hạn riêng. Không suy ra Saved từ Settled, hoặc Available từ terminal.

## 5. API

| Nhóm | Endpoint dự kiến và điều kiện |
| --- | --- |
| Catalog | GET /api/machines, /:id; lọc fields/public status |
| Wallet | POST /api/wallet/challenge, /verify; user session và nonce một lần |
| Host | POST/PATCH /api/host/machines, /commitments; approved owner |
| Admin | POST /api/admin/machines/:id/approve, /enroll; admin audit |
| Booking | POST /api/bookings; atomic lock, idempotency; GET /:id theo quyền |
| Chain | POST /api/bookings/:id/reconcile; tx hash là gợi ý, server tự kiểm chứng |
| Access | POST /api/bookings/:id/pair, /access, /end; đúng renter và chain state |
| Sự cố | POST /api/bookings/:id/incidents; không tự tạo dispute on-chain |
| Workspace | GET/POST /api/workspaces; owner; version/restore theo CLOUD_WORKSPACES |
| Sync broker | Session-scoped read/staging/upload/commit; lease/quota/expiry kiểm tra mỗi request |
| Agent | Enrollment/heartbeat/commands/results qua identity riêng, chống replay |
| Recommendation | POST /api/recommendations; structured needs, chỉ catalog đã lọc |

Fund/cancel/accept/dispute/claim/refund-timeout/withdraw dùng ví đúng role trên contract. Backend không tự ký thay renter chỉ vì user đăng nhập.

## 6. Idempotency và jobs

Idempotency key gắn user/action/payload hash; cùng key khác payload từ chối. Unique events theo chain/contract/tx/log index, không credit/grant/reset lặp. Outbox transaction nguyên tử với nghiệp vụ DB.

Worker claim job bằng lease/locking phù hợp, commit trước external call, inspect/retry khi crash chưa biết kết quả. Long-running call không giữ row lock vô hạn. Reorg/block hash mismatch đưa trạng thái cần đối soát, ngừng grant mới.

## 7. Workspace lease

Chỉ một writer cho một workspace. Khóa lease theo booking, version check khi commit; không last-write-wins. Chỉ immutable uploaded objects, staging không được overwrite checkpoint cũ.

Sau revoke quyền tương tác, có thể cấp scope recovery-only tới effectiveEndAt+600 giây theo CLOUD_WORKSPACES; effectiveEndAt không muộn hơn endAt on-chain và không lấy clock client. Chỉ append staging cho workspace đó, không đọc thêm dữ liệu/version hoặc mở desktop. Sau hạn revoke toàn bộ, ghi Failed nếu chưa commit, reset theo quy trình.

## 8. Quy ước

DB UTC, UI Asia/Saigon, contract block time cho deadline. PCP lưu integer base units dạng bigint/string; không float.

CSRF/origin phù hợp auth, validation schema, rate limit, body/file quotas; log correlation ID thay token. Error codes phân biệt forbidden/unavailable/expired/pending/reverted/wrong_chain/wrong_asset/access_unknown/sync_failed.

Retention theo PRIVACY_POLICY_DRAFT và CLOUD_WORKSPACES, không hardcode xóa account thành xóa on-chain history.

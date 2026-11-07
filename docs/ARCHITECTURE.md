# Kiến trúc triển khai 1.0

Đây là đặc tả để code theo mốc local; không phải chứng nhận hệ thống đã chạy.

## 1. Stack và repo

| Thành phần | Lựa chọn |
| --- | --- |
| Web/API | Next.js App Router, TypeScript, Tailwind |
| Auth/DB | Supabase Auth, PostgreSQL, migrations và RLS |
| Ví/chain | Connector chuẩn Core/MetaMask; viem/wagmi tương thích |
| Contracts | Solidity, OpenZeppelin, Hardhat 3; PCP + RentalEscrow không upgrade |
| Worker | Node/TypeScript chạy thường trực, outbox Postgres và reconciliation |
| Remote | Sunshine trong guest, Moonlight native phía khách; host agent giới hạn lệnh |
| Storage | WorkspaceStore: local filesystem cho dev/test, S3-compatible cho cloud thật |
| Runtime | Node LTS được dependency hỗ trợ, mặc định Node 24 LTS khi khả dụng |

Agent kiểm tra tài liệu chính thức/phiên bản trước scaffold, pin package manager, lockfile, compiler và Sunshine tag. Không bịa version đang cài. Không bắt người dùng cài lại toàn bộ môi trường nếu bản sẵn có tương thích.

~~~text
web/                   UI, route handlers, server auth
contracts/             PCP, escrow, tests, deploy/export scripts
worker/                jobs, chain indexer, session reconciliation
host-agent/            enrollment, health, restricted remote/sync adapter
packages/shared/       schemas, enums, IDs, pricing/constants
supabase/migrations/   schema, RLS, reservation RPC, outbox
infra/                 cấu hình mẫu khi cần, không secrets
docs/                  hồ sơ hiện hành
~~~

Dùng npm workspaces nếu phù hợp môi trường. Chỉ tạo folder khi có nội dung; không scaffold đè file người dùng.

## 2. Hai đường riêng

~~~mermaid
flowchart LR
    U[Khách] --> W[Web marketplace]
    H[Host] --> W
    W --> DB[(Auth và PostgreSQL)]
    U --> E[PCP và RentalEscrow]
    K[Worker] --> E
    K --> DB
    K <-->|Lệnh giới hạn và trạng thái| A[Host Agent]
    A --> D[Guest sạch và Sunshine]
    U --> M[Moonlight]
    M <-->|Video audio và input| D
    A <-->|Grant theo phiên| S[Workspace broker]
    S --> O[(Private object storage)]
    S --> DB
~~~

Control plane quản lý auth/booking/tiền/quyền. Streaming plane truyền video/input giữa client và guest. Web serverless không giữ stream hoặc timer dài; blockchain không xử lý frame, file hoặc PII.

## 3. Interfaces phải có

PaymentProvider: quote, fund/read receipt, read booking, credit/withdraw và reconcile. Chỉ adapter local/mock trong preview; adapter chain thật là nguồn tiền.

RemoteSessionProvider: health, prepare, grant, inspect, revoke, reset, verifyReset. Các hành động idempotent theo booking/action ID. Không có arbitrary shell execution.

WorkspaceStore: put/get immutable object, stat/hash, delete theo quyền GC, không expose root key. WorkspaceService/broker chịu auth/lease/quota/manifest; không giao quyền đó cho storage driver.

RecommendationProvider: query catalog theo constraints, giải thích từ dữ liệu thật. Mặc định rule/filter; LLM chỉ mốc sau, không có quyền đọc file hoặc ký giao dịch.

## 4. Luồng cấp phiên

Auth + wallet proof → atomic reservation → signed quote → renter approve/fund PCP → confirmed receipt/state → guest và workspace chuẩn bị → operator activate → confirmed Active → pairing/grant cho renter.

Nếu grant lỗi sau activate, tạo incident và hướng dẫn dispute; không sửa lịch sử thành chưa trả. UI hiển thị thời gian endAt từ chain.

EndAt/accept/dispute/terminal → watchdog/revoke active stream và reconnect → checkpoint/recovery giới hạn nếu bật cloud → reset verify. Chỉ giải phóng máy sau terminal tiền và cleanup đạt.

## 5. State và recovery

- Tiền: contract là nguồn chuẩn.
- Identity/reservation/workspace ownership: DB là nguồn chuẩn.
- Remote health/access/reset: adapter có bằng chứng, Unknown không coi thành công.
- Cloud Saved: manifest checkpoint đã commit, không lấy từ lời client.
- Outbox ghi cùng transaction DB; job lease, idempotency key và retry có backoff.
- Event unique chain/contract/tx/log index; lưu block hash/cursor và đối soát reorg.
- Sau crash: đọc chain và provider state, khôi phục job thiếu; không gửi fund/credit/grant lặp.
- RPC/agent/storage lỗi: không cấp quyền mới khi chưa xác định; giữ máy khóa nếu cleanup chưa rõ.
- Timeout contract cần transaction từ worker/người dùng; watchdog access chạy độc lập trên môi trường host.

## 6. Môi trường

Preview: fixture có nhãn; không fake login/receipt/stream/Saved; không gọi adapters production.

Local integration: contract simulator, DB/Auth local khi công cụ đủ và storage filesystem chỉ dữ liệu dev. Nếu chưa chạy được DB, ghi SQL/RLS integration chưa kiểm tra; không dùng mock để báo auth thật.

Configured integration: Supabase/S3/host thật do người dùng cấp. Web có thể Vercel; worker/host agent cần runtime thường trực. Không lưu file bền vững vào filesystem Vercel.

Production mode phải từ chối boot/enable feature nếu thiếu secret/backend thật, dùng local FS/mock provider hoặc thiếu network/contract config. Không fallback sang giả thành công.

## 7. Bảo mật cấu hình

Không đưa issuer/quote/operator/arbitrator keys, service role, storage master key, host/gateway credentials vào NEXT_PUBLIC, bundle, source hoặc log.

PCP/escrow address, chainId, ABI và public auth config có thể công khai. Mỗi deployment lưu manifest public riêng; không dùng địa chỉ của SenpAI.

Private network route giới hạn guest/ports của phiên, không full LAN. Nếu P2P lộ IP không phù hợp yêu cầu, phải bổ sung relay và benchmark trước công bố chế độ ẩn IP.

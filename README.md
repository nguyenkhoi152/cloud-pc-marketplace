# Cloud PC Marketplace

Hồ sơ triển khai 1.0, ngày 07/11/2026, Asia/Saigon. Tên làm việc tạm thời.

**Đang triển khai local theo mốc. M1 (web preview), M2 (migrations/RLS/đặt máy, kiểm chứng bằng PGlite) và M3 (PCP + RentalEscrow, kiểm thử local) đã có code; chưa có worker, host-agent, workspace, auth/API thật, deploy.**

Đọc [START_HERE](START_HERE.md) để giao việc cho Claude Code. Codex và Claude dùng chung [AGENTS](AGENTS.md); không tiếp tục các prompt AVAX-only hoặc chờ duyệt toàn bộ từ bản cũ.

## Sản phẩm

Chợ kết nối người có máy với người cần thuê. Host được duyệt và đăng khoảng nhận thuê; khách chọn cấu hình, trả point thử, dùng desktop từ xa và tùy chọn lưu project vào workspace để tiếp tục trên máy khác.

Bản demo: PC Point (PCP) trên Avalanche Fuji, escrow theo gói, Sunshine/Moonlight làm baseline, workspace theo project. Token thử không có giá trị tiền thật; không có mua/bán/rút VND trong MVP.

## Đầu vào cho agent

| File | Dùng để làm gì |
| --- | --- |
| [START_HERE](START_HERE.md) | Thứ tự đọc và prompt bắt đầu |
| [Quyền và mặc định](docs/APPROVAL.md) | Phạm vi được bắt đầu, mặc định kỹ thuật, phần cần đầu vào ngoài |
| [MVP](docs/MVP.md) | Tính năng và điều kiện nghiệm thu |
| [Kiến trúc](docs/ARCHITECTURE.md) | Thành phần, stack và deployment boundaries |
| [Dữ liệu/API](docs/DATA_MODEL.md) | Schema, auth, đồng thời, jobs và endpoints |
| [Contract](docs/CONTRACT_SPEC.md) | PCP, escrow, quote, refund và dispute |
| [Point](docs/POINTS_AND_PAYMENTS.md) | UX point, gas, nguồn tài trợ và x402 |
| [Remote](docs/REMOTE_ACCESS.md) | Agent, pairing, revoke và watchdog |
| [Workspace](docs/CLOUD_WORKSPACES.md) | Checkpoint, restore, token và tenant isolation |
| [Bảo mật](docs/SECURITY.md) | Trust boundaries và giới hạn bảo vệ hai bên |
| [Chính sách demo](docs/MARKETPLACE_POLICIES_DRAFT.md) | Cam kết host, sự cố, cọc và refund |
| [Privacy demo](docs/PRIVACY_POLICY_DRAFT.md) | Dữ liệu, providers, retention và quyền |
| [Kiểm tra](docs/TEST_PLAN.md) | Tests và bằng chứng cần có |
| [Lộ trình](docs/DEVELOPMENT_GUIDE.md) | Các mốc và cách tiếp tục khi thiếu hạ tầng |
| [Workflow](docs/AGENT_WORKFLOW.md) | Một writer, một reviewer và bàn giao |
| [Tiến độ](docs/PROGRESS.md) | Trạng thái thực tế để phiên sau tiếp tục |
| [Repo tham khảo](docs/REPO_REFERENCE.md) | Phần học từ SenpAI, không sao chép toàn bộ |
| [Nguồn](docs/SOURCES.md) | Tài liệu chính thức và mức xác minh |
| [Bài nộp](docs/SUBMISSION.md) | Repo, slide, video và deadline |
| [Sản phẩm](docs/PRODUCT.md) | Khách hàng và business model |

PLATFORM_DESIGN_V02, STREAMING_RESEARCH và POLICY_REFERENCE_REVIEW là tài liệu đọc thêm, không có quyền ghi đè đặc tả 1.0. Thư mục archive và các ZIP cũ chỉ giữ lịch sử.

## Mặc định demo

- Host cam kết cửa sổ ít nhất 4 giờ; chỉ thuê tức thời, một booking đang giữ máy.
- Gói demo 15 phút, 20 PCP, phí 10% phần gross trả host. Pilot thương mại chưa triển khai.
- PCP có 18 decimals, token chuyển hạn chế qua escrow; AVAX Fuji chỉ trả gas.
- Cloud: một project nhỏ, tối đa 100 MiB tính cả version, một writer, tối đa 3 checkpoint thành công.
- AI tư vấn và host bond có thiết kế/roadmap; chỉ làm sau core flow, không có cash-out thật.

Đây là mặc định cấu hình để code có thể tiến hành; chủ dự án chưa xác nhận giá/thời hạn thương mại hoặc license của một máy cụ thể.

## Hiện trạng và lệnh chạy

Bộ khung local gồm npm workspaces `packages/shared`, `web`, `db` và `supabase/migrations`. Thêm `contracts/` (Hardhat 3 + viem). Chưa có worker, host-agent. Không có URL deploy hay contract address.

Yêu cầu: Node >= 20.9 (đã chạy với Node 26.13.0, npm 11.20.0). Chạy ở thư mục gốc:

~~~text
npm install        # cài dependency theo package-lock.json
npm run dev        # web dev tại http://localhost:3000
npm run build      # build production
npm run typecheck  # tsc cho shared + web
npm run lint       # eslint cho web + shared
npm test           # vitest shared + db (migrations/RLS trên PGlite) + hardhat test contracts
npm run compile -w @cpm/contracts   # biên dịch Solidity (tải solc 0.8.28 lần đầu)
npm run test:startup -w web   # cần build trước; chạy next start thật với từng bộ env
~~~

Tiền PCP là chuỗi thập phân ở biên (`parsePcp`/`formatPcp`, tối đa 18 chữ số thập phân, ≤ 1.000.000 PCP) và bigint/numeric(78,0) trong code/DB; không dùng number cho số tiền.

Contract: `cd contracts && npx hardhat run scripts/deploy.ts` deploy lên mạng mô phỏng trong tiến trình, ghi `contracts/deployments/local.json` (không commit) và xuất ABI vào `packages/shared/src/abi`. Deploy Fuji (`--network fuji`) cần `FUJI_RPC_URL`, `FUJI_DEPLOYER_PRIVATE_KEY` và các địa chỉ vai trò đặt trong môi trường riêng; **chưa chạy**, chưa có địa chỉ/tx thật.

Chế độ `APP_MODE=preview` (mặc định, xem `.env.example`): mọi dữ liệu là fixture gắn nhãn, các hành động cần backend bị disable kèm lý do. `APP_MODE=production` thiếu/sai cấu hình thì `web/src/instrumentation.ts` ném lỗi lúc server khởi động và mọi request trả 500 (đã kiểm bằng `test:startup`; pha `next build` bỏ qua kiểm tra này). Phiên bản chính: Next 16.4.5, React 19.3.1, Tailwind 4.3.5, TypeScript 6.0.3 (chưa dùng TS 7 vì typescript-eslint chưa hỗ trợ), zod 4.6.7, vitest 5.1.0.

## Phạm vi bàn giao

Bộ Markdown này phục vụ agent code local; dependency dự án đã cài trong thư mục dự án. Chưa cấu hình PC, chưa có Supabase/cloud project, chưa deploy Fuji hoặc web, chưa thu tiền hay công bố điều khoản thương mại.

Bản trước khi hợp nhất được giữ trong ZIP backup tại deliverables ở checkout gốc. Gói handoff chỉ gồm tài liệu hiện hành để tránh agent đọc nhầm lịch sử.

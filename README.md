# Cloud PC Marketplace

Hồ sơ triển khai 1.0, ngày 07/11/2026, Asia/Saigon. Tên làm việc tạm thời.

**Trạng thái 10/11/2026: chạy được MỘT PHIÊN THUÊ TRỌN VẸN qua giao diện app với ví GIẢ LẬP, trên chuỗi Hardhat CỤC BỘ (mô phỏng, không phải Fuji), dữ liệu Supabase dev thật và máy cho thuê là container Selkies thật trong VM Linux không GPU**: đăng nhập → liên kết ví (chữ ký) → giữ máy → trả tiền (approve + fund trên escrow thật) → worker kích hoạt trên chuỗi → host-agent cấp quyền → xem desktop Linux trong khung nhúng của app → kết thúc → thanh toán cho host → thu hồi → reset guest → nhả máy (kiểm 11/11 trong app Tauri đã cài). Một lệnh dựng phần máy chủ: `scripts/vm/start-demo.ps1` (mặc định **không bật agent**: host bấm *Bắt đầu nhận thuê* trong app; demo chỉ phía người thuê thì dùng `-Agent script`; guest WSL2 thì `-Guest wsl`, lần đầu thêm `-NewEnrollment`; xem [DEMO_RUNBOOK](docs/DEMO_RUNBOOK.md)). **Cập nhật 12/11/2026**: phía **host trên Windows** đã có trong app (Cho thuê máy → *Thiết lập & chạy máy*): app kiểm tra WSL2, dẫn cài thành phần trong guest Linux, ghi danh, bắt đầu/dừng nhận thuê; agent chạy **trong guest** (đã chạy thật trong VM Ubuntu; đường **WSL2 mới biên dịch và kiểm đơn vị, chưa chạy vì máy dev chưa cài WSL** — app không tự cài WSL/không xin admin, chỉ hướng dẫn). Hướng dẫn, nguồn đã đọc và bảng bằng chứng: [HOST_WINDOWS_WSL](docs/HOST_WINDOWS_WSL.md). Banner đầu app nói rõ ví GIẢ LẬP / chuỗi Hardhat cục bộ / chưa kết nối. Đã vá thêm: worker tự kết thúc phiên khi người thuê bỏ đi (`claimAfterGrace`). **Chưa có**: Fuji + ví thật (app native chưa có connector ví), host Linux có GPU thật (VM hay đình trệ, chưa đo hiệu năng), âm thanh/toàn màn hình, thu nhập/sự cố/admin UI của host, ký số và thử bộ cài trên máy khác, S3, deploy công khai. Chi tiết và bằng chứng: [PROGRESS](docs/PROGRESS.md), phần thật/giả: [DEMO_RUNBOOK](docs/DEMO_RUNBOOK.md).

Đọc [START_HERE](START_HERE.md) để giao việc cho Claude Code. Codex và Claude dùng chung [AGENTS](AGENTS.md); không tiếp tục các prompt AVAX-only hoặc chờ duyệt toàn bộ từ bản cũ.

## Sản phẩm

Chợ kết nối người có máy với người cần thuê. Host được duyệt và đăng khoảng nhận thuê; khách chọn cấu hình, trả point thử, dùng desktop từ xa và tùy chọn lưu project vào workspace để tiếp tục trên máy khác.

Bản demo: PC Point (PCP) trên Avalanche Fuji, escrow theo gói, app Companion hai chế độ (Tauri) xem desktop qua Selkies (baseline đang thử, cập nhật 08/11: feature 003; Sunshine/Moonlight không còn là luồng chính), workspace theo project. Token thử không có giá trị tiền thật; không có mua/bán/rút VND trong MVP.

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
| [Hướng dẫn thử cho người ngoài](docs/TESTER_GUIDE.md) | Bản thử Fuji + tunnel: người thuê, chủ máy, người tổ chức; cái gì đã kiểm/chưa |
| [Sổ tay demo](docs/DEMO_RUNBOOK.md) | Chạy gì, thật/giả, smoke test và dữ liệu chúng ghi |
| [Fuji](docs/FUJI_RUNBOOK.md) | Đầu vào, preflight chỉ đọc, deploy (chưa chạy) |
| [Host Windows + WSL2](docs/HOST_WINDOWS_WSL.md) | Luồng cho thuê trên Windows, việc người dùng phải tự làm, nguồn, bảng bằng chứng |
| [Host Selkies/S3/hosting](docs/HOST_SELKIES_S3_PREP.md) | Danh sách chuẩn bị, mục chưa xác minh |
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

npm workspaces: `packages/shared`, `web` (API route `/api/[...path]` + trang giới thiệu), `db` (test migration/RLS), `contracts` (Hardhat 3 + viem), `server` (API core, worker, workspace broker), `host-agent` (agent + session gateway), `desktop` (app Companion React/Vite, vỏ Tauri trong `desktop/src-tauri`), cùng `supabase/migrations` (000001–000006). Không có URL deploy hay contract address.

Yêu cầu: Node >= 20.9 (đã chạy với Node 26.13.0, npm 11.20.0). Chạy ở thư mục gốc:

~~~text
npm install        # cài dependency theo package-lock.json
npm run dev        # web dev tại http://localhost:3000
npm run build      # build production
npm run typecheck  # tsc cho mọi workspace
npm run lint       # eslint cho mọi workspace
npm test           # shared, db (PGlite + PostgreSQL 18 thật cục bộ), contracts (Hardhat), desktop, host-agent, server
npm run build:desktop              # build app (Vite)
npm run dev:desktop                # app preview/live tại http://127.0.0.1:5174
npm run check:env                  # kiểm file .env*, không in giá trị
node scripts/preflight-smoke-server.mjs   # chỉ đọc: điều kiện + dữ liệu mà smoke:server sẽ ghi
npm run compile -w @cpm/contracts   # biên dịch Solidity (tải solc 0.8.28 lần đầu)
npm run test:startup -w web   # cần build trước; chạy next start thật với từng bộ env
~~~

Tiền PCP là chuỗi thập phân ở biên (`parsePcp`/`formatPcp`, tối đa 18 chữ số thập phân, ≤ 1.000.000 PCP) và bigint/numeric(78,0) trong code/DB; không dùng number cho số tiền.

Contract: `cd contracts && npx hardhat run scripts/deploy.ts` deploy lên mạng mô phỏng trong tiến trình, ghi `contracts/deployments/local.json` (không commit) và xuất ABI vào `packages/shared/src/abi`. Deploy Fuji (`--network fuji`) cần `FUJI_RPC_URL`, `FUJI_DEPLOYER_PRIVATE_KEY` và các địa chỉ vai trò đặt trong môi trường riêng; **chưa chạy**, chưa có địa chỉ/tx thật.

Chế độ `APP_MODE=preview` (mặc định, xem `.env.example`): mọi dữ liệu là fixture gắn nhãn, các hành động cần backend bị disable kèm lý do. `APP_MODE=production` thiếu/sai cấu hình thì `web/src/instrumentation.ts` ném lỗi lúc server khởi động và mọi request trả 500 (đã kiểm bằng `test:startup`; pha `next build` bỏ qua kiểm tra này). Phiên bản chính: Next 16.4.5, React 19.3.1, Tailwind 4.3.5, TypeScript 6.0.3 (chưa dùng TS 7 vì typescript-eslint chưa hỗ trợ), zod 4.6.7, vitest 5.1.0.

## Phạm vi bàn giao

Có một project Supabase **dev** (do chủ dự án tạo; migration áp dụng bằng SQL Editor nên không có trong migration history của Supabase — không dùng `supabase db push`/reset trên project này). Chưa cấu hình PC host, chưa deploy Fuji hoặc web, chưa thu tiền hay công bố điều khoản thương mại. File `.env*` thật nằm ngoài Git; không gửi secret qua chat.

Bản trước khi hợp nhất được giữ trong ZIP backup tại deliverables ở checkout gốc. Gói handoff chỉ gồm tài liệu hiện hành để tránh agent đọc nhầm lịch sử.

# Tiến độ và bàn giao

Asia/Saigon, hồ sơ1.0 ngày07/11/2026.

## Hiện trạng

**M1 và M2 (phần local) đã có code và kiểm tra. Chưa có contract, worker, remote, deployment.**

User yêu cầu mới nhất: gửi toàn bộ Markdown cần thiết để Claude bắt đầu làm. Đã chuyển từ vòng draft chờ duyệt sang mặc định triển khai; chưa có xác nhận giá/điều khoản thương mại hoặc quyền sử dụng một PC/cloud cụ thể.

| Mốc | Trạng thái |
| --- | --- |
| Handoff1.0 | Đã hợp nhất, kiểm tra và đóng gói26 file Markdown hiện hành |
| M0 khảo sát/spike thật | Chưa bắt đầu; chưa có máy được chỉ định |
| M1 scaffold local | Hoàn thành 07/11: build/typecheck/lint/test qua, web local chạy (xem mục M1) |
| M2 auth/DB | Phần local xong 07/11: migrations + RLS + reservation, 36 test trên PGlite; chưa kiểm chứng trên PostgreSQL/Supabase thật (xem mục M2) |
| M3 PCP/escrow local | Contract + 47 test local xong 07/11; chưa nối web/ví, chưa deploy Fuji (xem mục M3) |
| M4 worker/remote | Chưa bắt đầu |
| M5 workspace | Chưa bắt đầu |
| M6 Fuji/configured E2E/deploy | Chưa bắt đầu, cần tài nguyên/quyền tại bước |
| M7 tùy chọn | AI/x402/bond chưa trong core |

## Việc đã làm ở phiên chuẩn bị handoff

- Đọc docs và cấu trúc thực tế; root chỉ có Markdown/docs/deliverables, chưa có app.
- Sao lưu đủ30 Markdown trước hợp nhất thành ZIP backup; đối chiếu SHA-256 từng entry.
- Thống nhất PCP restricted ERC-20 + escrow token, native AVAX chỉ gas; thay spec AVAX-only.
- Đồng bộ quyền/defaults/MVP/kiến trúc/dữ liệu/remote/cloud/chính sách/tests/lộ trình.
- Thêm START_HERE và prompt M1 để writer code thay vì tiếp tục xin duyệt cả bộ.
- Chưa chạy app/test/build, cài dependency, cấu hình PC, tạo tài khoản/cloud, phát hành token hoặc deploy.

Đã kiểm tra26 Markdown hiện hành: mọi liên kết file tương đối tồn tại và nằm trong chính gói bàn giao; code fence cân bằng. Đã quét bỏ các chặn duyệt cũ và đồng bộ PCP/escrow, mốc, recovery deadline. ZIP CloudPC-Claude-Codex-START-1.0-2026-11-07.zip chứa đúng26 Markdown, không lẫn archive; SHA-256 từng entry khớp source. Nhật ký này được cập nhật vào ZIP và đối chiếu lại trước bàn giao.

Đây là kiểm tra tài liệu/đóng gói, không là kiểm thử ứng dụng hoặc bằng chứng bảo mật. Chưa chạy build/test/deploy ứng dụng vì chưa có code.

## Bước tiếp

Mốc local tiếp theo: nối contract vào web/API (cần Supabase để có auth thật) và M5 workspace local. M0 spike remote vẫn chờ máy được chỉ định. Thiếu máy/credentials chỉ chặn phần liên quan. Codex review chỉ đọc khi writer dừng.

## M1 scaffold local — 07/11/2026

Writer: Claude. Git: thư mục chưa là repo, chưa commit.

- Thay đổi: `package.json` (workspaces), `packages/shared` (schemas zod, lọc máy, splitFee/pcpToUnits, fixture có nhãn, interfaces PaymentProvider/RemoteSessionProvider/WorkspaceStore/RecommendationProvider, `loadConfig`), `web/` (Next App Router, 10 route tiếng Việt: danh sách+lọc, chi tiết, checkout, host, admin, ví, phiên, lịch sử, workspace), `.env.example`.
- Đã chạy, kết quả: `npm install` OK; `npm run typecheck` OK; `npm run lint` 0 lỗi 0 cảnh báo; `npm test` 7/7 qua; `npm run build` OK; `next start` + curl: các route trả 200, bộ lọc `minVramGb=10` chỉ còn demo-3, id không tồn tại trả 404.
- Mock còn lại: toàn bộ dữ liệu máy là fixture; không đăng nhập, ví, receipt, online, remote, cloud giả. Nút hành động thật bị disable kèm lý do.
- Chưa kiểm tra: giao diện trên trình duyệt thật (chỉ kiểm HTTP/HTML), dark mode, responsive, a11y; `next dev` chưa chạy; không có test cho web.
- Blocker: Docker không có trên máy → chưa chạy được Supabase/Postgres local (cần ở M2 cho RLS integration). Chưa có PC/host, ví Fuji, S3.
- Chưa tạo ở M1 (M2 đã thêm supabase/migrations): contracts/, worker/, host-agent/.
- Process còn chạy: không.
- Bước tiếp (đã thực hiện): M2 và sửa findings, xem mục bên dưới.

## Sửa findings M1 + M2 — 07/11/2026

Writer: Claude. Git: thư mục chưa là repo, chưa commit.

**Findings M1 đã sửa**
- loadConfig nối vào khởi động: `web/src/instrumentation.ts` gọi `loadConfig(process.env)` khi server start (bỏ qua pha `next build`). `npm run test:startup -w web` chạy `next start` thật: preview và production đủ cấu hình → 200; production thiếu hết / sai địa chỉ PCP / thiếu SUPABASE_URL / APP_MODE gõ sai → 500. Server vẫn lắng nghe nhưng không phục vụ trang nào. Hạn chế: production đủ cấu hình hiện vẫn phục vụ fixture preview (banner PREVIEW còn hiện); M2+ cần thay bằng dữ liệu thật.
- PCP: bỏ `number`/`Math.round`. `parsePcp` (chuỗi thập phân → bigint 18 decimals), `parsePositivePcp`, `formatPcp`; `pricePcp` và `maxPrice` là chuỗi thập phân; `pcpToUnits` đã xoá. Test: số âm, +/-, mũ, dấu phẩy, khoảng trắng, số 0 đầu, >18 chữ số thập phân, chữ số không phải ASCII, kiểu number, supply cap (1.000.000 PCP), round-trip, 0.1+0.2=0.3, phí 1 wei bảo toàn tổng. 13 test shared qua.

**M2 (phần local)**
- File: `supabase/migrations/2026110700000{1,2,3}_*.sql` (schema lõi, hàm/trigger, RLS/grants), `db/` (harness PGlite + 36 test).
- Có: profiles, user_roles, host_profiles, wallet_challenges/links, contract_config, policy_versions (bất biến), machines (+machine_key duy nhất), machine_private_config, host_commitments (≥4h), bookings (snapshot bất biến, máy trạng thái tiền, index duy nhất một booking còn giữ máy), outbox_jobs, audit_logs, view `public_machines`. Hàm: `reserve_machine` (renter từ `auth.uid()`, giá/phí/host từ DB, idempotency, commitment phủ fundBy+buffer+gói+recovery), `release_machine`, `expire_unfunded_booking` (cần xác nhận đối soát chain), `consume_wallet_challenge` (nguyên tử, một lần), `review_host`, `review_machine`, `submit_machine_for_review`.
- RLS: mặc định từ chối; revoke mặc định kiểu Supabase rồi cấp theo cột/hàng; client không ghi bookings/outbox/roles; hàm server-only chỉ cấp `service_role`; test khẳng định mọi bảng public bật RLS.
- Kiểm tra: `npm test` → shared 13/13, db 36/36 qua; typecheck, lint, build qua. Đã thử phá migration (bỏ revoke, bỏ unique index, mở hàm server-only, sửa snapshot giá, cho tự thuê máy mình) và test đều bắt được; một test yếu (tự thuê máy) đã siết.
- **Chưa kiểm chứng:** (1) chạy trên PostgreSQL/Supabase thật — PGlite là Postgres WASM một kết nối, có shim `auth.uid()` và roles tự viết, không phải Supabase thật (role/grant mặc định, `auth` schema, PostgREST, JWT claims thật chưa thử); (2) **đồng thời thật**: PGlite chỉ có một kết nối nên hai transaction không chạy song song; test "hai renter cùng máy" chạy tuần tự. An toàn đồng thời dựa vào `SELECT … FOR UPDATE` trên dòng máy và unique partial index, chưa quan sát race thật; (3) chưa có API route, wallet signature verification (chỉ phần consume challenge trong DB), worker/outbox consumer, chain_events, workspaces, device_enrollments.
- Blocker: không có Docker/Postgres/Supabase CLI. Khi có Docker cần chạy lại migrations và test song song nhiều kết nối.
- Mock còn lại: như M1; DB chưa nối vào web (web vẫn dùng fixture).
- Process còn chạy: không.
- Bước tiếp: M3 contracts; khi có Docker: chạy migrations trên Supabase local + test đồng thời.

## M3 PCP + RentalEscrow (local) — 07/11/2026

Writer: Claude. Git: chưa là repo.

- File: `contracts/contracts/{PCP,RentalEscrow}.sol`, `contracts/contracts/mocks/TestTokens.sol` (chỉ test), `contracts/test/*.test.ts`, `contracts/scripts/deploy.ts`; ABI xuất ra `packages/shared/src/abi`.
- Stack: Hardhat 3.21.2 + toolbox-viem, solc 0.8.28 (optimizer + viaIR), OpenZeppelin 5.6.1, viem 2.57.16; test chạy bằng `hardhat test nodejs` (node:test).
- Triển khai theo CONTRACT_SPEC: PCP restricted ERC-20 (không permit/burn/mint tự do, cap 1.000.000, faucet 1.000/ví một lần, `configureEscrowOnce` admin-only một lần và phải là contract); escrow với quote EIP-712 16 trường, fund + pull token cùng giao dịch kèm kiểm tra số nhận chính xác, đủ các hàm cancel/refund/activate/accept/dispute/claim/resolve/refundUnresolved/withdrawPCP, pull-payment, pause chỉ chặn fund/activate, không có sweep.
- Kiểm tra: `npm test` → contracts 47/47 qua (cùng shared 13, db 36); typecheck/lint/build sạch. Test gồm: sai quote/asset/domain/thời gian/chữ ký, biên thời gian đúng một giây, occupancy, race cancel↔activate và dispute↔claim theo thứ tự chain, bảo toàn + làm tròn phí, credit cộng dồn, config version, pause vẫn thoát tiền, transfer lỗi giữ credit, reentrancy hook, fee-on-transfer, P2P/nạp tay/spender khác bị chặn, cap 1000 ví.
- Mutation đã thử (tất cả bị test bắt): đổi biên activate/dispute, bỏ kiểm tra delta token, credit ghi đè, không nhả occupancy, bỏ kiểm tra caller=escrow ở PCP, bỏ chống faucet lặp. Ngoại lệ: bỏ `nonReentrant` ở withdraw không làm test đỏ vì checks-effects-interactions (zero credit trước khi chuyển) đã chặn re-entry; giữ cả hai lớp.
- Chưa làm/chưa kiểm tra: audit độc lập; gas report; chạy trên Fuji (evm cancun trên Fuji chưa xác nhận bằng deploy thật); fuzz/invariant test; nối web/ví, xác minh receipt/indexer, worker gọi activate/timeouts (M4). Thiếu: ví Fuji có AVAX gas, RPC URL, địa chỉ các vai trò → blocker cho deploy.
- Mock/preview: web vẫn dùng fixture; ABI mới chỉ xuất ra file.
- Process còn chạy: không.

## Bản mẫu UI "Sky" (design-preview) — 07/11/2026

Writer: Claude. Git: các file mới chưa commit.

- Quy trình Spec Kit đã chạy: constitution 1.1.0, `specs/001-sky-prototype/` (spec, plan, research, data-model, contracts, quickstart, tasks, checklist) và phân tích nhất quán (không CRITICAL; các điểm HIGH/MEDIUM đã sửa trong tài liệu).
- Triển khai: `design-preview/` gồm trang giới thiệu, tìm máy (lọc + so sánh), chi tiết máy, phiên thuê; SVG hero tự vẽ; bản cũ ở `archive-v1/`. Không sửa `web/`, `db/`, `contracts/`, backend.
- Kiểm tra: Edge headless 390/768/1440 cho 4 trang — không tràn ngang, 0 lỗi console; lọc/so sánh/menu/FAQ chạy; chạy được khi tắt JS; reduced-motion tắt animation. Chi tiết và danh sách chưa kiểm chứng: `design-preview/README.md`.
- Chưa kiểm chứng: thiết bị thật, Firefox/Safari, chế độ tối, trình đọc màn hình. Ảnh bạn nhắc chưa có trong hội thoại nên dùng ảnh khảo sát cục bộ.
- Mock còn lại: toàn bộ dữ liệu là fixture; mọi hành động cần backend khoá kèm lý do.
- Vòng hoàn thiện hình ảnh/chuyển động (07/11): sửa lỗi lọc để lại ô trống và nội dung phiên thuê gây hiểu nhầm; hero SVG nhiều lớp; hiện khi cuộn, hover/nhấn, lọc/so sánh/menu/FAQ mượt, nhịp 120/200/320ms; reduced-motion; không thêm thư viện (đã đánh giá Motion for React). Kiểm tra bằng thao tác thật qua Edge headless; xem `design-preview/README.md`. Chưa kiểm chứng: thiết bị thật, trình duyệt khác, hiệu năng có GPU.
- Bước tiếp: chờ chủ dự án duyệt bản mẫu; sau đó mới chuyển sang `web/` (Next.js/Tailwind).

### Frontend desktop Companion (UI để duyệt) — 08/11/2026

Writer: Claude. Git: chưa commit. Spec Kit: `specs/002-desktop-companion-ui/` (spec, plan có danh mục màn hình/sơ đồ điều hướng/bảng trạng thái, tasks).

- Tạo workspace `desktop/` (`@cpm/desktop`; thêm vào `workspaces` và scripts gốc `dev:desktop`, `build:desktop`, lint/typecheck/test): React 19 + TS 6 + Vite 8 + Tailwind 4, primitives kiểu shadcn (Radix), Lucide, Motion, zustand. Không sửa `web/`, `design-preview/`, `db/`, `contracts/`.
- Đã làm đủ các màn trong phạm vi: auth mô phỏng, chuyển chế độ (không cấp quyền host), thuê (khám phá/lọc/so sánh/chi tiết/xác nhận/phiên đầy đủ/viewer minh họa/workspace/lịch sử), cho thuê (7 bước thiết lập, lịch tuần + ngoại lệ có validation, gửi duyệt/chờ/từ chối, dashboard, phiên, thu nhập, sự cố, chạy nền/dừng), số dư tách thu nhập host, thông báo, hỗ trợ, cài đặt. Bộ chọn 8 kịch bản demo; fixtures tập trung + lớp dịch vụ mock.
- Kiểm tra: typecheck, lint, build đạt; vitest 24/24 (logic domain + smoke render mọi màn/phase). **Chưa kiểm tra bằng trình duyệt**: Playwright CLI không có trên máy (không có bản global; chạy qua `npx` bị chặn quyền) nên chưa kiểm layout 3 kích thước, tràn ngang, console, bàn phím, ảnh chụp. Cần chạy kiểm tra này trước khi coi UI là đã duyệt.
- Mock: toàn bộ (auth, PCP, cài đặt, duyệt host, Selkies viewer, cleanup, giờ demo cố định). Chưa: Tauri/Rust, backend, WSL/Docker/Selkies thật, code-splitting.
- Chạy: `npm run dev -w @cpm/desktop` → http://127.0.0.1:5174 (process do Claude khởi động, cổng 5174). Chi tiết: `desktop/README.md`.
- Bước tiếp: duyệt UI bằng mắt; chạy Playwright khi có công cụ; sửa theo góp ý; sau đó mới tích hợp backend/Tauri.

### Sửa frontend theo review Codex — 08/11/2026

Writer: Claude. Nguồn: `docs/DESKTOP_UI_REVIEW_2026-11-08.md`.

- **Bằng chứng Codex đã chạy** (Edge qua Playwright): 7 màn × 3 kích thước, hai hành trình, viewer/fullscreen/reconnect, dialog, kịch bản cleanup/lưu lỗi, reduced-motion; Vitest 24/24. Review ghi 3 findings P2.
- **Đã sửa**: (1) quyết toán theo đặc tả hiện hành — kết thúc sớm trả cả gói, chuẩn bị lỗi hoàn đủ; sửa logic, nội dung UI, fixtures, test; không đổi contract/đặc tả tiền. (2) Lịch tuần không còn co cột ở 1024px (bố cục 2 hàng, preview xuống dưới < 1280px, ô giờ rộng hơn). (3) `RadioGroup` có roving tabindex và phím mũi tên/Home/End cho bộ chuyển chế độ, bộ chọn demo, `Segmented`, các nhóm ở checkout.
- **Kiểm tra Claude đã chạy**: typecheck, lint, vitest 27/27 (thêm test quyết toán đã sửa và 3 test bàn phím RadioGroup bằng jsdom; thêm devDependency `jsdom` vào `@cpm/desktop`). Claude vẫn không có Playwright trong môi trường của mình.
- **Chưa xác minh**: layout lịch 1024px và bàn phím sau sửa trên trình duyệt thật — cần Codex chạy lại; audit bàn phím toàn app, screen reader, trình duyệt khác, Tauri/WebView2.
- Process: dev server 5174 (khởi động trước đó) vẫn chạy; không khởi động thêm. Chưa commit/push/deploy.

### Sửa focus bộ chuyển chế độ — 08/11/2026

Writer: Claude. Nguồn: phần tái kiểm tra đầu `docs/DESKTOP_UI_REVIEW_2026-11-08.md`.

- **Codex đã xác minh trên Edge**: finding tiền (kết thúc sớm giữ/tính 80, hoàn 0) và lịch 1024px (cột thanh giờ 356/330/442 px) đã đạt; radio thời lượng ở checkout hoạt động. Còn P2: đổi chế độ bằng ArrowRight làm `AppShell` focus `main`.
- **Đã sửa**: `RadioGroup` nhận `keepFocus` (gắn `data-keep-focus`); `AppShell` bỏ qua focus `main` khi `activeElement` nằm trong vùng đó; điều hướng khác và skip link giữ nguyên. Chỉ bộ chuyển chế độ dùng `keepFocus`.
- **Kiểm tra Claude đã chạy**: typecheck, lint, build đạt; vitest 30/30, gồm `src/layout/modeFocus.test.tsx` (jsdom, AppShell + router hash + store thật): ArrowRight → ArrowLeft liên tiếp xác minh aria-checked, hash, `document.activeElement` và `hostApproval` không đổi; sidebar → focus `main`; skip link → `main`. Thử bỏ dòng bảo vệ thì test đỏ.
- **Chưa xác minh**: hành vi này trên trình duyệt thật (cần Codex chạy lại); audit bàn phím toàn app, screen reader, Tauri/WebView2. Dev server 5174 giữ nguyên, không khởi động thêm. Chưa commit/push/deploy; chưa nối backend/Tauri.

## Việc còn lại và đầu vào cần từ chủ dự án

### Codex xác minh bản sửa focus cuối — 08/11/2026, 14:53 GMT+7

- **Đóng 3/3 findings review UI ban đầu** trong phạm vi kiểm tra, không phải chứng nhận toàn bộ app hoàn thiện.
- Edge: ArrowRight -> ArrowLeft liên tiếp không refocus giữ đúng focus/radio/route; Home/End và lặp vòng cũng đạt. Sidebar và skip link vẫn đưa focus về main. Click đổi mode giữ focus, không tự cấp quyền host; không console/page error.
- Chạy lại Vitest: 30/30 PASS. Không chạy lại typecheck/lint/build ở lượt cuối; có kết quả Codex PASS ở lần trước và báo cáo Claude PASS sau sửa focus.
- Ảnh và bằng chứng mới nhất ở đầu `docs/DESKTOP_UI_REVIEW_2026-11-08.md`. Các finding còn mở trong mục review trước phía dưới đã được đóng bởi mục này.
- Bước tiếp: chủ dự án duyệt UI/workflow và lấy phản hồi người thử. Chưa tự triển khai backend/Tauri. Chưa commit/push/deploy; Vite 5174 giữ nguyên. Codex chỉ sửa tài liệu review/tiến độ.

### Codex tái kiểm tra desktop sau sửa — 08/11/2026

- Đọc source và thử lại bằng Edge/Playwright; không sửa source app. Chi tiết mới nhất ở đầu `docs/DESKTOP_UI_REVIEW_2026-11-08.md`.
- Codex chạy lại: typecheck, lint, build PASS; Vitest 27/27 PASS. Build vẫn cảnh báo JS chunk 700.99 kB (gzip 214.76 kB), chưa tối ưu chia tải.
- Đóng 2 findings: kết thúc sớm tính cả gói (trình duyệt: 80 PCP giữ, tính 80, hoàn 0); lịch host 1024/1280/1440 không tràn, thanh giờ có chiều rộng và ô giờ đọc được.
- Finding bàn phím còn P2: ArrowRight đổi mode nhưng route effect ở AppShell lấy focus về main; ArrowLeft kế tiếp không đổi ngược được. Component RadioGroup và test Segmented riêng đã tốt hơn nhưng chưa kiểm tình huống điều hướng tích hợp.
- Frontend hai vai trò và kịch bản demo đã có; toàn bộ auth/remote/host-install/PCP/workspace vẫn mô phỏng. Chưa có Tauri/backend/host-agent/Selkies thật. Chưa commit/push/deploy.
- Bước tiếp: Claude sửa focus khi đổi mode và kiểm tích hợp; chủ dự án tiếp tục duyệt UI/workflow. Chưa tự chuyển mốc backend. Browser kiểm tra riêng đóng sau review; Vite 5174 của Claude được giữ nguyên.

- **Auth/dữ liệu thật (M2 nối web):** tạo project Supabase miễn phí, đưa `SUPABASE_URL` và `SUPABASE_ANON_KEY` (service role chỉ đặt ở môi trường server riêng); hoặc cài Docker để chạy Supabase local.
- **Deploy Fuji:** ví test riêng có AVAX Fuji (faucet), `FUJI_RPC_URL`, và 5 địa chỉ vai trò (operator, arbitrator, quote signer, issuer, treasury). Khoá riêng chỉ nhập ở môi trường riêng.
- **Deploy web:** chọn hosting miễn phí (ví dụ Vercel) và quyền công khai cho URL.
- **M4 remote:** cần một PC được chỉ định làm host (hệ điều hành, GPU, quyền cài Sunshine) và máy khách có Moonlight; không dùng desktop cá nhân.
- **M5 hai host thật:** cần host thứ hai để chứng minh restore project; phần local filesystem có thể làm trước.

## Ghi mốc mới

### Workflow sản phẩm bổ sung — 07/11/2026

- Codex ghi `docs/PRODUCT_WORKFLOW.md`, sau đó sửa theo lời đính chính của chủ dự án: một app hai chế độ; host tự mở nhận thuê theo lịch (ví dụ mỗi tối), không phải renter đặt thuê định kỳ hoặc trả phụ phí giữ lịch.
- Liên kết từ MVP và PRODUCT để phân biệt yêu cầu mới với core thuê ngay hiện tại.
- Chỉ cập nhật thiết kế; chưa code UI/API/DB/agent/contract, chưa commit/push/deploy. Lịch điều khiển availability của host, không thêm thanh toán chuỗi hay auto-renew. Có brief/prompt UI app tại `docs/DESKTOP_APP_UX_BRIEF.md`.
- Kiểm tra: đọc đối chiếu MVP/contract, kiểm tra diff và liên kết tài liệu. Không chạy build/test vì không thay code.

~~~text
Ngày/mốc:
Writer/reviewer:
Commit nếu có:
Thay đổi/file:
Scripts/thao tác và kết quả:
Evidence:
Mock/chưa kiểm tra:
Blocker/input cần ở bước:
Process/job còn chạy:
Bước tiếp:
~~~

## Lịch sử

03/11: UniAct chỉ tài liệu. 07/11: chuyển Cloud PC, marketplace, nghiên cứu streaming, cloud/policies và point theo SenpAI/EZYCLOUDX. Các ZIP draft trước và backup pre-handoff giữ nội dung cũ.

Không đọc trạng thái “chờ duyệt/chưa scaffold” trong lịch sử như quyền hiện tại. Không xem việc hợp nhất tài liệu là ứng dụng đã hoàn thành.

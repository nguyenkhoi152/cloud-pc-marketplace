# Cloud PC Companion — triển khai sau mốc UI

Ngày 08/11/2026. Yêu cầu trực tiếp mới của chủ dự án: “nói chung cũng ổn áp rồi bắt đầu làm đến cuối luôn đi”. Chủ dự án đồng ý dùng frontend hiện tại làm nền để tiếp tục; không đồng nghĩa đã duyệt mọi giá, chính sách thương mại hoặc giả định kỹ thuật.

Writer: Claude. Codex: giám sát/review; không cùng sửa checkout. Không tự tạo nhiều agent/worktree nếu chưa phân công.

## Hiện trạng có bằng chứng

- Commit local gần nhất quan sát: `04ed4f8 feat(desktop): add interactive Companion UI preview (mock only)`. Không suy ra đã push nếu chưa kiểm tra remote.
- `desktop/` là frontend React/Vite, một tài khoản hai chế độ. Toàn bộ auth, giá/số dư, phiên, cài host, streaming, workspace đang mô phỏng.
- Codex đã xác minh ba findings UI ban đầu đóng; Vitest 30/30 ở lần kiểm cuối. Xem `docs/DESKTOP_UI_REVIEW_2026-11-08.md`.
- `web/`, DB migrations/tests và contracts đã có từ M1–M3; không scaffold lại. Chưa được coi là backend sản phẩm hoạt động end-to-end.
- Tài liệu kiến trúc cũ chủ yếu web + Sunshine/Moonlight. Quyết định mới là web quảng bá/tải app, app chứa nghiệp vụ thuê/cho thuê; hướng host Windows + WSL/Docker + desktop Linux Selkies cần xác minh thực tế.
- Repo có thay đổi chưa commit và tài liệu mới ngoài commit desktop. Đọc Git status/diff, bảo toàn toàn bộ; không dùng reset/clean/stash tự động. `web/next-env.d.ts` có thay đổi tại thời điểm handoff, không tự loại bỏ.

## Prompt giao Claude

Bạn là writer triển khai Cloud PC Companion từ frontend đã duyệt tới bản demo end-to-end có thể cài và thử trên hai máy. Codex giám sát/review. Không chỉ trả lại kế hoạch hoặc scaffold lại UI.

Đọc AGENTS.md, CLAUDE.md, README.md, docs/PROGRESS.md, docs/END_TO_END_HANDOFF.md, docs/DESKTOP_APP_START.md và spec 002. Theo mốc đọc ARCHITECTURE, DATA_MODEL, CONTRACT_SPEC, REMOTE_ACCESS, CLOUD_WORKSPACES, SECURITY và TEST_PLAN. Chỉ dẫn sản phẩm mới trong handoff này ưu tiên hơn mô tả công nghệ/UI cũ; giữ các bất biến quyền, tiền và dữ liệu.

### Mục tiêu

Một app Windows dùng chung tài khoản với hai chế độ. Người thuê chọn máy, xác nhận, kết nối và kết thúc từ app. Host kiểm tra máy, đồng ý thành phần/quyền, đặt tài nguyên/giá/lịch lặp, gửi duyệt và nhận thuê. Web chủ yếu giới thiệu/tải app; backend/API có thể tiếp tục nằm trong dự án Next.js hiện có.

Giữ thiết kế UI đã duyệt; chỉ chỉnh khi cần phản ánh dữ liệu/quyền/tình huống thật. Mock preview là chế độ độc lập có nhãn; production không fallback sang mock để báo thành công. Không nhúng credential quản trị vào app hoặc remote viewer.

### 0. Đối chiếu và cập nhật đặc tả thực thi

- Kiểm tra code/migrations/contracts thật thay vì coi mọi tài liệu cũ là hiện trạng. Lập bảng màn hình -> API -> bảng dữ liệu -> quyền -> trạng thái -> cách kiểm tra.
- Tạo feature Spec Kit tiếp theo cho phần tích hợp, không ghi đè feature UI. Cập nhật ARCHITECTURE/REMOTE_ACCESS/PRODUCT_WORKFLOW và tài liệu liên quan cho quyết định app-first/Selkies. Ghi migration path rõ; không âm thầm duy trì hai flow chính trái nhau.
- Giữ chính sách tiền hiện hành: kết thúc sớm accept trả cả gói; hủy/hoàn trước activation theo contract. Không sửa contract chỉ để khớp mock. Ánh xạ chuẩn bị/ready/activation thực tế phải rõ trước khi nối UI để không thu tiền hoặc cấp quyền sai thời điểm.
- Các lựa chọn kỹ thuật thường lệ có thể đảo ngược: tự quyết định và ghi lý do. Chỉ hỏi khi thiếu đầu vào, có thay đổi sản phẩm quan trọng, chi phí hoặc hành động hệ thống chưa được cho phép.

### 1. Chứng minh khả năng app/native và streaming sớm

- Thêm vỏ Tauri 2 cho frontend hiện tại, không viết lại UI. Kiểm tra công cụ Windows/Rust/C++/WebView2 trước khi yêu cầu cài; hướng dẫn chính xác những phần thiếu.
- Làm spike viewer Selkies trong WebView2 với phiên được cấp quyền có kiểm soát: video/audio, bàn phím, khóa chuột, toàn màn hình, reconnect, ngắt phiên và chặn reconnect sau revoke.
- Pin phiên bản image/transport, đọc docs/source chính thức. Selkies có nhiều phiên bản/transport; không mặc định WebRTC đã hoạt động hoặc nhanh nhất.
- Chưa có host thì chuẩn bị code/adapter/harness và ghi chưa thử. Không báo viewer CSS mô phỏng là stream. Không mở browser bên ngoài rồi coi đã đạt yêu cầu dùng máy trong app.
- Nếu WebView2 không đáp ứng, báo bằng chứng và các lựa chọn thay thế; không âm thầm thay trải nghiệm sản phẩm. Không viết lại codec.

### 2. Backend tài khoản và marketplace thật

- Tận dụng Supabase Auth/Postgres và migrations hiện có; nối auth vào app, session refresh/logout, dữ liệu bền vững, phân quyền renter/host/admin từ server. App chỉ giữ token người dùng theo cơ chế phù hợp, không service-role key.
- API catalog, đăng/sửa/gửi duyệt máy, tài nguyên, giá, lịch host tuần/ngoại lệ/múi giờ và các ràng buộc booking. Host chọn chế độ không tự được duyệt.
- Enrollment thiết bị có expiry/một lần, credential riêng thu hồi được; heartbeat có xác thực. Listing chỉ thuê được khi có sức khỏe thiết bị và cửa sổ lịch hợp lệ. Lịch không bật nguồn PC.
- Reservation nguyên tử, chống trùng, freeze quote/policy và outbox trong transaction. Host không được sửa/xóa khoảng cam kết để phá booking đang tồn tại.
- Kiểm lại finding cũ nếu còn: wallet challenge và reservation cần phối hợp khóa theo user để tránh đổi ví giữa lúc đặt; commitment không được sửa làm mất coverage booking.
- API/service adapters thay mock từng nhóm màn hình; không rải fetch/client admin quyền cao vào component. Dùng tiền chuỗi thập phân/bigint và helpers đã có, không đưa phép tính number/Math.round từ prototype vào luồng tiền thật.
- Kiểm RLS/auth/concurrency bằng Postgres/Supabase thật khi có môi trường; PGlite/test mock không thay bằng chứng đó.

### 3. Worker và vòng đời phiên bền vững

- Worker thường trực, outbox/job lease/idempotency/retry/reconciliation. Không dùng timer trong tab/app UI làm nguồn chuẩn duy nhất.
- Các trạng thái tiền, quyền truy cập, lưu trữ và cleanup độc lập. Không có funded/active hợp lệ hoặc không rõ provider state thì không cấp remote.
- Crash/restart không cấp phiên trùng hoặc ghi thu/hoàn hai lần. Unknown/failure giữ máy unavailable cho tới khi được đối soát.

### 4. Host app/agent và phiên thật

- Host app giải thích thành phần/quyền/tác động; user consent trước mọi cài đặt. Người chỉ thuê không phải cài thành phần host. Không đổi OS/BIOS/firewall/router hoặc cài WSL/Docker thật khi chưa có máy thử được chỉ định và quyền cụ thể.
- Agent chỉ nhận tập lệnh đã định nghĩa và xác thực, không arbitrary shell/đường dẫn/URL/port do renter gửi. Điều phối tài nguyên, heartbeat, prepare, grant, inspect, revoke, reset và verifyReset theo booking/action ID.
- Tạo môi trường riêng từ template, không dùng desktop/home/shared folder cá nhân của host. Giới hạn CPU/RAM/disk/GPU theo khả năng thực tế; unsupported thì từ chối hoặc ghi rõ mức hỗ trợ.
- WSL/Docker không phải chứng nhận cô lập đủ cho marketplace công khai hoặc bảo vệ người thuê trước host có quyền admin. Bản demo thật giới hạn host được duyệt và người thử tin cậy trên máy thử riêng. Không hứa hỗ trợ mọi game/GPU hay hiệu năng không ảnh hưởng host.
- Mạng chỉ cấp đường tới môi trường thuê; không cấp đường vào LAN host. Thử khác mạng và NAT; nếu cần relay thì cấu hình/bandwidth phải minh bạch, không hứa kết nối mọi mạng miễn phí.
- Ngắt phiên đang mở và chặn reconnect, watchdog host độc lập khi control plane chết; checkpoint nếu bật -> reset -> xác minh. Kết thúc tiền chưa đủ để mở nhận khách mới.
- Host đóng UI khác với chạy nền và dừng dịch vụ. Phiên đang chạy không bị bỏ rơi do đóng cửa sổ; lịch không cắt phiên đã nhận. Hết hạn hoặc cưỡng chế mất mạng phải có xử lý sự cố rõ.

### 5. Nối PCP/escrow thử nghiệm

- Tận dụng contracts/test hiện có, kiểm ABI/chain/config thực tế. Nối ví qua connector được hỗ trợ trong app; thử browser-wallet/deep link trước khi chốt. Không tự giữ seed/private key hoặc đưa khóa operator vào app.
- Wallet proof, approve/fund, receipt/state/event confirmations, activate/accept/refund/dispute/withdraw và reconcile sau restart theo CONTRACT_SPEC. Không suy ra đã trả chỉ từ tx hash/client callback.
- Local integration trước; Fuji sau khi có ví test/RPC/roles/AVAX faucet. Không mainnet, không thu tiền thật. Faucet/PCP thử phải gắn nhãn rõ, không hứa đổi ra tiền.

### 6. Workspace thật

- Giữ lựa chọn không lưu/lưu project. No-cloud không upload file. Không hứa lưu toàn bộ OS/RAM hoặc mọi save game.
- Local adapter cho dev; S3-compatible private cho demo cấu hình thật. Broker phân quyền theo user/booking/version, quota/checksum/immutable checkpoint/lease và manifest nguyên tử. Không root key trong guest.
- Chỉ ghi “Đã lưu” khi checkpoint xác nhận; có lỗi/retry/bỏ qua rõ và recovery có giới hạn. Restore trên máy khác phải kiểm tương thích template/app và thử hai host thật trước khi công bố.

### 7. Hoàn thiện, đóng gói và bàn giao

- Code-splitting theo feature/viewer, giảm import dư; đo thay vì chỉ tăng ngưỡng warning. Không bỏ UX hoặc kiểm tra quyền để giảm bundle.
- Kiểm end-to-end với dữ liệu thật: auth, đăng/duyệt host, lịch, hai renter tranh cùng máy, booking/payment, mở stream trong app, hết hạn/revoke/reconnect, mất mạng/crash, save-fail, cleanup-fail và restore.
- Build bộ cài Windows để thử. Ghi rõ dev/unsigned build; không vô hiệu hóa bảo vệ OS hoặc hứa đã ký nếu chưa có signing. Kiểm update/uninstall và quyền tối thiểu khi triển khai tính năng đó.
- Chuẩn bị cấu hình deployment miễn phí trong phạm vi quota; web/API, worker, DB/storage và host là các thành phần khác nhau. Không gọi deploy frontend là hoàn thành toàn nền tảng.
- Chỉ deploy công khai, cấp quyền tài khoản ngoài hoặc broadcast sau khi xác định đúng đầu vào/quyền hiện có. Không tự phát sinh chi phí, tạo tài khoản hoặc đổi repo private thành public.
- Git: giữ nhánh hiện tại/nhánh feature phù hợp, kiểm danh tính/remote và diff. Không force-push/merge main. Chuẩn bị lệnh hoặc commit/push khi được giao trực tiếp; không coi handoff này là lệnh push mọi thay đổi có sẵn.

### Cách tiếp tục và báo cáo

Làm theo mốc: code -> kiểm tra -> sửa -> cập nhật README/PROGRESS -> tiếp tục phần độc lập. Có blocker thì ghi rõ phần đang chặn và tiếp tục việc không phụ thuộc; không giả kết quả và không lách quyền bị từ chối.

Mỗi mốc báo ngắn: chức năng thật đã chạy, bằng chứng, phần mock còn lại, file thay đổi, process đang chạy, đầu vào cần tiếp theo. Chỉ hỏi đúng đầu vào ở thời điểm cần. Secret nhập bằng môi trường riêng, không trong chat/Git/log.

Tiêu chí hoàn thành: app cài được và có một vòng thuê thật trên hai máy từ đăng máy tới kết thúc/revoke/cleanup; thanh toán Fuji và workspace được xác minh riêng khi có đủ đầu vào. Mục nào chưa thử thật phải đánh dấu chưa đạt, không gọi full app production.

## Đầu vào ngoài code sẽ cần

- Máy host thử được chỉ định: Windows/CPU/RAM/GPU/dung lượng/mạng và quyền cài thành phần; ưu tiên máy thử riêng không chứa dữ liệu cá nhân.
- Một máy renter riêng để thử app/stream, tốt nhất thử cả mạng khác.
- Supabase/Postgres, storage và nơi chạy worker/API: tài khoản do chủ dự án quản lý, secrets ở môi trường riêng. Có thể làm phần local trước.
- Ví Fuji test và cấu hình chain khi tới mốc thanh toán; không nhập private key vào hội thoại.
- Các bước cấp quyền OS/công khai/chi phí là quyết định riêng, không suy ra từ việc duyệt UI.

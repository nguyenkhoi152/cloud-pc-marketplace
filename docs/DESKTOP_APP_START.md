# Bắt đầu UI Cloud PC Companion

Ngày: 08/11/2026. Handoff cho Claude; Codex chuẩn bị tài liệu và review, không sửa ứng dụng.

## Quyết định sản phẩm mới nhất

- Một app desktop cho cả người thuê và người cho thuê. Một tài khoản, đổi chế độ không cần đăng xuất. Đổi chế độ không tự cấp quyền host.
- Web chủ yếu giới thiệu, hướng dẫn, chính sách và tải app. Các tác vụ thuê/cho thuê nằm trong app.
- Host Windows dự kiến cung cấp môi trường Linux qua WSL/Docker; renter dự kiến sử dụng desktop riêng qua Selkies trong app. Đây là hướng cần thử nghiệm trên máy thật, chưa phải tích hợp hoạt động.
- Host có thể tiếp tục dùng Windows; không hứa hiệu năng không bị ảnh hưởng, không hứa mọi máy hỗ trợ GPU, không hứa mọi game Windows chạy được.
- Lịch lặp là lịch host cung cấp máy; không tự bật nguồn, không đặt thuê định kỳ cho khách, không nhận phiên vượt cửa sổ sẵn sàng.
- Mục tiêu trước mắt: UI tương tác để duyệt, chưa phải dịch vụ cho thuê hoạt động.

Yêu cầu mới này thay các đoạn trái ngược trong brief UI cũ: HTML tĩnh không còn là yêu cầu cho bản UI mới; Moonlight không phải luồng UI chính; web không phải nơi sử dụng dịch vụ chính. Không vì thay đổi thiết kế mà xóa code web/contracts/backend hiện có hoặc tuyên bố Selkies đã được tích hợp.

## Bộ công cụ đề xuất

| Công cụ | Vai trò | Cách áp dụng |
| --- | --- | --- |
| UI UX Pro Max | Màu sắc, typography, bố cục và tiêu chí UX | Đã có trong .claude/skills; dùng bản hiện có |
| Spec Kit | Spec, plan, tasks và kiểm tra nhất quán | Đã có; không init lại hoặc ghi đè constitution |
| React + TypeScript + Vite + Tailwind | Frontend app có thể xem trước trong trình duyệt | Claude tạo workspace desktop riêng sau khi kiểm tra repo |
| shadcn/ui | Form, dialog, sidebar, tabs, slider... | Chọn component cần dùng; không tải toàn bộ registry/template |
| lucide-react | Icon thống nhất | Import từng icon |
| Motion | Chuyển động React có mục đích | Chọn hiệu ứng nhẹ, hỗ trợ reduced-motion |
| Playwright CLI | Mở preview, thao tác và chụp ảnh kiểm tra | Một đường kiểm tra trình duyệt; không bắt buộc cài thêm MCP trùng chức năng |
| Tauri 2 | Đóng gói native dự kiến sau khi duyệt UI | Chưa cài Rust/Build Tools chỉ để duyệt frontend; khả năng Selkies trong WebView2 phải được thử riêng |

Tauri/React không mặc định là lựa chọn nhanh nhất cho streaming: phải thử decode video, bàn phím, chuột khóa, toàn màn hình, âm thanh và reconnect trên Windows WebView2 trước khi chốt viewer native. Playwright kiểm tra frontend trong trình duyệt không thay cho kiểm tra app Tauri thật.

## Cài đặt phía người dùng

Mở PowerShell terminal thường tại gốc repo trong VS Code. Không gõ lệnh shell vào ô chat Claude.

UI UX Pro Max và Spec Kit đã có, không cài lại. Để thêm công cụ kiểm tra giao diện theo README chính thức của Microsoft:

```powershell
npm.cmd install -g @playwright/cli@latest
playwright-cli.cmd --help
playwright-cli.cmd install --skills
```

Sau đó kiểm tra những file skill vừa sinh và mở lại Claude nếu chưa nhận diện. Chỉ thêm file công cụ cần thiết; không ghi đè hướng dẫn dự án. Không cần cài Playwright MCP đồng thời. Nếu chính sách máy chặn global install, gửi lỗi để chọn cách cài phù hợp; không đổi execution policy.

Claude sẽ cài dependencies giao diện đúng workspace, chọn phiên bản tương thích và lưu lockfile. Không chạy lệnh shadcn init/scaffold tại root monorepo một cách mù quáng.

## Trạng thái công cụ đã kiểm tra — 08/11/2026

- Đã cài global `@playwright/cli`, phiên bản chạy được: 0.1.23.
- Đã cài skill tại `.claude/skills/playwright-cli/`; installer thêm ignore `.playwright-cli/` và tạo `.playwright/cli.config.json` chọn Microsoft Edge. Skill đang được quy tắc ignore chung loại khỏi Git, nhưng vẫn có trên máy này; chưa commit/push.
- Đã mở phiên browser riêng `codex-install-check` tới `about:blank`, kiểm tra `document.readyState` trả `complete`, rồi đóng đúng phiên đó. Đây là kiểm tra công cụ, không phải kiểm tra UI app.
- UI UX Pro Max có script/data và đã chạy truy vấn thử thành công bằng Python 3.14.6. Spec Kit CLI báo 1.3.2; các skill và constitution hiện có được giữ nguyên.
- Nếu terminal hiện tại chưa nhận PATH mới, dùng `& "$env:APPDATA\npm\playwright-cli.cmd" --help`; Python thực chạy được tại `C:\Users\ADMIN\AppData\Local\Python\bin\python.exe`. Khởi động lại Claude/VS Code để nhận PATH/skill mới khi cần.
- Chưa có workspace desktop. Chưa cài các package shadcn/ui, lucide-react, motion, React/Vite/Tauri vào web hoặc root để tránh đặt sai chỗ. Claude được phép tạo frontend theo prompt dưới rồi cài đúng workspace, lưu lockfile. Không cần chủ dự án cài thủ công các thư viện này.
- Chưa cài Rust/C++ Build Tools/WSL/Docker hoặc dịch vụ host; chúng không cần cho mốc frontend UI đang giao.

## Prompt giao Claude

Bạn là writer chính cho UI app Cloud PC Companion. Codex review, không có hai writer cùng sửa checkout.

Đọc AGENTS.md, CLAUDE.md, README.md, docs/PROGRESS.md và file docs/DESKTOP_APP_START.md này trước. Đọc có chọn lọc docs/PRODUCT_WORKFLOW.md, docs/DESKTOP_APP_UX_BRIEF.md, docs/THINKMAY_UI_REVIEW.md và spec hiện có để tận dụng tài sản. Yêu cầu sản phẩm trong file này là chỉ dẫn trực tiếp mới hơn, ưu tiên khi mâu thuẫn; không chạy prompt M1 cũ hoặc scaffold lại repo. Giữ các bất biến về quyền, tiền và dữ liệu còn phù hợp.

### Phạm vi mốc này

Làm frontend desktop tương tác bằng React/TypeScript/Vite/Tailwind, shadcn/ui, Lucide và Motion khi cần. Nếu đã có app desktop thì tiếp tục, không tạo trùng. Nếu chưa có, tạo workspace desktop/ phù hợp npm workspaces hiện có; sửa scripts/lockfile tối thiểu, giữ nguyên web/, design-preview/, DB và contracts. Không tạo repo lồng. Chưa đóng gói Tauri hoặc cài toolchain hệ thống ở mốc UI này. Frontend này sẽ được dùng lại khi đóng gói native, không làm một bộ HTML bỏ đi.

Dùng UI UX Pro Max hiện có. Tạo một feature Spec Kit mới cho UI desktop, ghi spec/plan/tasks bằng skill đã cài; không viết lại constitution hoặc đặc tả toàn dự án. Kiểm tra số feature hiện có, không dùng nhầm specs/001-sky-prototype. Ghi các giả định UI có thể đảo ngược rồi tiếp tục tới bản chạy được; chỉ hỏi nếu quyết định thật sự chặn việc hoặc thay đổi phạm vi đã giao.

### Hình thức

- Tiếng Việt, Sky: nền sáng xanh nhạt, chữ navy, teal làm màu nhấn. Kế thừa tinh thần Thinkmay qua tài sản hiện có, không sao chép logo, hình và các số liệu của họ.
- Đây là ứng dụng desktop thao tác, không phải landing page trong cửa sổ: sidebar, thanh tài khoản/chuyển chế độ, vùng nội dung rõ thứ bậc.
- Thiết kế trước hệ token màu/font/khoảng cách/bo góc/bóng/trạng thái; component dùng lại. Không để toàn bộ app trong một file.
- Hướng tới 1280x800 và 1440x900; 1024x768 vẫn sử dụng được. Chưa làm app điện thoại.
- Motion 120–250 ms khi phù hợp: chuyển tab, mở panel, thông báo, progress; không autoplay video, parallax nặng, icon nhảy liên tục hoặc blur toàn trang. Tôn trọng prefers-reduced-motion.
- Focus bàn phím, label, contrast, thông báo lỗi rõ; không dùng màu làm tín hiệu duy nhất.

### Luồng và màn hình

1. Chào mừng/đăng nhập mẫu, chọn chế độ Thuê máy hoặc Cho thuê máy; một tài khoản chuyển được hai chế độ. Đây là preview, không giả auth thật.
2. Thuê: trang khám phá theo Game / Đồ họa / Lập trình, lọc cấu hình/giá/vị trí, danh sách máy, chi tiết và tương thích ứng dụng. Online/benchmark chỉ được ghi là dữ liệu mô phỏng. Linux hỗ trợ từng ứng dụng/game đã kiểm tra; không hứa tất cả game Windows.
3. Xác nhận thuê: thời lượng không vượt cửa sổ host, giá và phí rõ, lựa chọn không lưu/lưu workspace; point thử không phải tiền thật.
4. Vòng đời phiên: đang chuẩn bị -> sẵn sàng -> đang dùng -> reconnect khi phù hợp -> kết thúc -> đang dọn -> đã kết thúc; có lỗi chuẩn bị, mất mạng, lưu thất bại, cleanup thất bại. Không cho lỗi cleanup tự trở thành sẵn sàng nhận khách.
5. Viewer mẫu trong app: toolbar, toàn màn hình, kết nối, thời gian còn lại và kết thúc; dùng khung desktop minh họa, ghi rõ chưa có stream thật. Không nhúng endpoint remote bên ngoài, không giả FPS/ping thật.
6. Host onboarding: quyền/điều khoản -> kiểm tra CPU/RAM/GPU/OS/mạng/WSL -> danh sách thành phần dự kiến cài và quyền cần cấp -> đồng ý -> tiến trình mô phỏng -> tài nguyên chia sẻ -> giá/lịch -> xem trước đăng máy -> chờ duyệt. Có máy không tương thích và không có GPU hỗ trợ. Không cài WSL/Docker thật.
7. Host dashboard: trạng thái agent/máy, nhận phiên mới hay tạm nghỉ, phiên đang chạy, tài nguyên minh họa và lịch. Host chưa được duyệt không được nhận thuê chỉ vì chọn chế độ host. Đóng UI và dừng cung cấp máy là hai hành động khác nhau.
8. Lịch: thứ trong tuần, giờ bắt đầu/kết thúc, múi giờ Asia/Ho_Chi_Minh, tạm bỏ một ngày, hiển thị validation lịch chồng lấn và giờ không hợp lệ. Máy offline không tự online nhờ lịch.
9. Số dư/thu nhập tách biệt, lịch sử phiên, workspace, thông báo, cài đặt/hỗ trợ. Không làm chatbot, mainnet, cash-out hoặc host bond.

Đi theo hai kịch bản xuyên suốt: khách chọn máy đến kết thúc; host thiết lập máy đến lịch và nhận phiên. Tránh làm nhiều trang rời không có đường đi. Fixtures đặt tập trung có schema/trạng thái rõ; demo mode banner trong app, các nút mô phỏng có giải thích. Không gọi API ghi thật. Đăng nhập/ thanh toán / cài đặt / remote / cloud là mô phỏng, không cấp quyền thật.

### Quy trình và bằng chứng

- Trước code, ghi ngắn cấu trúc, thiết kế và task; sau đó thực hiện, không chỉ trả kế hoạch.
- Dùng các thư viện đã chọn với phiên bản tương thích và lockfile. Không thêm framework UI thứ hai, MCP/skill trùng lặp hoặc template dashboard lớn nếu không có lý do cụ thể.
- Không đọc node_modules, bundle hoặc ZIP lịch sử để nhồi context. Chỉ đọc spec/task liên quan và diff. Khi đổi session, dùng spec, task và progress để tiếp tục.
- Chạy typecheck/lint/build của workspace mới; kiểm tra các phần chung bị sửa. Kiểm tra hành vi quan trọng: đổi chế độ không cấp quyền host, lọc máy, xác nhận phiên theo thời gian còn lại, lịch host và lỗi cleanup. Không viết test chỉ mirror JSX.
- Dùng Playwright CLI nếu có để mở preview, thao tác cả hai luồng, kiểm tra console/overflow/focus ở các kích thước nêu trên và chụp ảnh. Nếu browser/tool không dùng được thì ghi chưa kiểm tra, không báo PASS thay.
- Cập nhật README workspace và docs/PROGRESS.md: lệnh chạy, ảnh, phần mô phỏng, checks và phần chưa làm. Cho biết server/port/process nào bạn khởi động; không tắt process của người khác.
- Không push/deploy, sửa OS/firewall/router, tải installer host hoặc gửi giao dịch chain trong mốc này. Không tự commit thay đổi ngoài phạm vi.
- Hoàn thành khi có preview chạy local cho tôi duyệt, đầy đủ hai luồng và báo cáo kiểm tra. Dừng tại mốc duyệt UI trước khi nối backend/native service.

## Nguồn chính thức đã đối chiếu

- https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- https://github.com/github/spec-kit
- https://github.github.com/spec-kit/integrations/claude.html
- https://github.com/microsoft/playwright-cli
- https://github.com/shadcn-ui/ui
- https://ui.shadcn.com/docs/installation/vite
- https://github.com/lucide-icons/lucide
- https://github.com/motiondivision/motion
- https://github.com/tauri-apps/tauri
- https://v2.tauri.app/start/prerequisites/

Đây là lựa chọn phù hợp cho mốc UI, không phải cam kết thư viện tự tạo thiết kế đẹp hay giảm token theo một tỷ lệ đã đo. Spec ngắn, component dùng lại và kiểm tra trực quan mới giúp hạn chế sửa đi sửa lại.

# Review frontend desktop — 08/11/2026

## Xác minh bản sửa focus cuối — 08/11/2026, khoảng 14:53 GMT+7

**Trạng thái mới nhất: đóng cả 3 findings ban đầu trong phạm vi đã kiểm tra.** Các lần review phía dưới là lịch sử. Không đồng nghĩa đã audit toàn bộ ứng dụng hoặc có backend/native hoạt động.

- Codex đọc `RadioGroup.keepFocus`, bảo vệ `[data-keep-focus]` trong AppShell và test tích hợp mới.
- Edge thật: focus Thuê máy một lần, rồi ArrowRight -> ArrowLeft liên tiếp, không refocus. Route lần lượt `#/host` và `#/rent/discover`; focus và aria-checked luôn ở radio vừa chọn.
- Thử tiếp End -> Home và lặp vòng ArrowLeft -> ArrowRight: route, selected và focus đúng.
- Click sidebar “Lịch sử thuê”: focus về `#main`. Focus skip link rồi Enter: focus về `#main`, không phá hash route.
- Click “Cho thuê máy” bằng chuột: focus giữ tại bộ chọn; vẫn có nhãn Chưa được duyệt. Đổi chế độ không tự cấp quyền host.
- Không pageerror/console error trong lượt browser này. Ảnh: `.playwright-cli/final-focus-host.png`.
- Codex chạy lại Vitest: **30/30 PASS**, 4 test files. Không chạy lại typecheck/lint/build trong lượt xác minh focus cuối; chúng đạt ở lần review trước, và Claude báo đã chạy sau sửa mới.
- Không phát hiện finding mới trong phạm vi bản sửa focus. Chưa audit mọi nhóm bàn phím/screen reader/trình duyệt khác/Tauri WebView2; bundle chưa code-splitting. App vẫn toàn bộ mô phỏng.
- Chỉ cập nhật tài liệu review/tiến độ; không sửa code app. Đóng browser session riêng `codex-focus-final`, không đụng Vite 5174, không commit/push/deploy.

## Tái kiểm tra sau sửa của Claude — 08/11/2026, khoảng 14:47–14:50 GMT+7

**Trạng thái mới nhất: 2 findings đã xác minh sửa xong; finding bàn phím chỉ sửa một phần, còn P2 bên dưới.** Các mục review ban đầu phía sau được giữ làm lịch sử, không phải kết luận rằng mọi lỗi vẫn còn.

- Codex chạy lại tại workspace desktop: typecheck PASS, lint PASS, Vitest **27/27 PASS**, build PASS. Build vẫn cảnh báo chunk lớn: JS 700.99 kB, gzip 214.76 kB; chưa code-splitting. Không coi đây là lỗi build hoặc bằng chứng đã đo hiệu năng người dùng.
- Quyết toán kiểm tra qua Edge: thuê Falcon 60 phút, vào viewer rồi kết thúc sớm -> giữ 80 PCP, tính cả gói 80, hoàn 0. Nội dung checkout/dialog/settlement đã đổi, settle() chuẩn bị lỗi vẫn hoàn đủ theo source và test. Đóng finding chính sách hoàn theo phạm vi kiểm tra này.
- Đi lại onboarding qua đồng ý, kiểm tra máy, cài mô phỏng và cấu hình; tab Lịch tuần ở 1024/1280/1440 không tràn ngang main/document. Cột thanh giờ đo lần lượt **356/330/442 px**, không còn 0. Ô giờ 132/~129/132 px. Đã xem ảnh 1024: thanh giờ và AM/PM đọc được. Đóng finding lịch.
- Radio thời lượng trên checkout: End chọn 2 giờ 45 phút, ArrowRight lặp về 15 phút và bỏ qua nút 3 giờ bị disabled; Home và các mũi tên đổi lựa chọn được.
- **[P2 còn lại] Đổi chế độ bằng bàn phím mất focus sau lần đổi đầu tiên.** Tái hiện: focus radio Thuê máy -> ArrowRight -> chuyển sang Cho thuê máy và URL /host, nhưng activeElement trở thành #main -> ArrowLeft không đổi lại được. `RadioGroup` gọi focus/click đúng, nhưng `desktop/src/layout/AppShell.tsx:12` tự focus main sau mỗi route change; `desktop/src/layout/Chrome.tsx:37` đổi route ngay khi chọn mode. Test jsdom hiện chỉ mount Segmented độc lập nên không bắt tương tác này.
- Sửa quản lý focus theo nguồn điều hướng: giữ focus ở radio khi thao tác mũi tên đổi mode, vẫn giữ skip link và hành vi focus hợp lý cho điều hướng trang khác. Không tắt toàn bộ quản lý focus. Thêm kiểm tra tích hợp: ArrowRight rồi ArrowLeft liên tiếp mà không phải refocus, xác minh cả selected và activeElement. Chưa sửa source trong review này.
- Ảnh mới: `.playwright-cli/recheck-weekly-1024.png`, `recheck-weekly-1280.png`, `recheck-weekly-1440.png`, `recheck-settlement.png`. Phiên browser riêng: `codex-ui-recheck`; đóng sau review, giữ nguyên Vite 5174.
- Chưa audit mọi radio/màn hình/screen reader, không xác minh native Tauri/WebView2 hoặc backend. Chưa commit/push/deploy. Hướng tiếp theo vẫn là duyệt UI/workflow, chưa chuyển sang tích hợp hệ thống thật.

Reviewer: Codex. Chỉ đọc source, chạy Vitest và kiểm tra trình duyệt; không sửa code app, dependencies, lockfile hoặc đặc tả của Claude. Các ảnh/output nằm trong `.playwright-cli/` (đang ignore Git). Không commit/push/deploy.

## Kết luận

Frontend hoạt động trong Microsoft Edge qua Vite 127.0.0.1:5174. Đã thao tác các hành trình chính, không chỉ kiểm tra HTTP hoặc SSR. Chưa nên gọi là đã duyệt hoàn toàn: có 3 findings bên dưới, đặc biệt chính sách tiền chưa nhất quán.

Playwright có tại môi trường Codex: `C:\Users\ADMIN\AppData\Roaming\npm\playwright-cli.cmd`, phiên bản cài trước đó 0.1.23. Claude báo không thấy cùng đường dẫn; lần kiểm tra này không xác định nguyên nhân khác biệt môi trường và không thay đổi quyền của Claude. Không cần Claude lách quyền hoặc chạy lại lệnh bị chặn.

## Findings

### [P2] Chính sách hoàn tiền UI lệch contract/đặc tả hiện có

- `desktop/src/features/renter/Checkout.tsx:93` hứa hoàn các khung 15 phút chưa dùng khi kết thúc sớm.
- `desktop/src/domain/session.ts:174` thực hiện cách tính đó; sau khi dùng ít hơn 15 phút của phiên 60 phút, UI quyết toán 1 khung và hoàn 3 khung.
- Đã thấy trên trình duyệt: phiên Orion 60 phút giữ 48 PCP, kết thúc ngay hiển thị tính 12, hoàn 36.
- `docs/MVP.md:37` và `docs/CONTRACT_SPEC.md:70` quy định kết thúc sớm và accept trả cả gói. Chỉ dẫn UI mới chưa quyết định đổi chính sách này.
- Sửa UI/mock về đúng chính sách hiện hành, hoặc trình chủ dự án lựa chọn chính sách mới rồi sửa nhất quán đặc tả/contract/tests. Không chỉ đổi contract để hợp với fixture. Chưa nối thanh toán thật trong lượt sửa UI.

### [P2] Thanh lịch 24 giờ co về 0 px ở 1024x768

- `desktop/src/features/host/ScheduleEditor.tsx:61` và `:66` dùng grid có cột nhãn 88 px, thanh thời gian 1fr và phần nhập giờ tới 330 px.
- Trong bố cục có sidebar và cột “7 ngày tới”, đo DOM tại 1024x768: cột nhãn 88 px, cột thanh thời gian **0 px**, phần nhập 308 px. Các nhãn 0h/6h/12h/18h/24h dính nhau. Không có overflow toàn trang nhưng thành phần trực quan đã mất.
- Hai ô native time rộng 104 px (`:37`, `:39`) cũng hiển thị chật phần AM/PM trong cấu hình Edge kiểm tra.
- Chuyển bố cục ở chiều rộng nhỏ: đưa preview xuống dưới hoặc tách nhãn/thanh/input thành các hàng; giữ thanh thời gian có chiều rộng tối thiểu và ô giờ đọc đầy đủ. Kiểm tra lại cả ba kích thước.

### [P2] Bộ chuyển chế độ có role radio nhưng thiếu điều khiển bàn phím tương ứng

- `desktop/src/layout/Chrome.tsx:44–55`: button có role=radio, aria-checked, onClick; không có arrow-key handling/roving tabIndex.
- Tái hiện: focus “Cho thuê máy”, nhấn ArrowLeft; focus và lựa chọn vẫn là “Cho thuê máy”. Tab chuyển ra phần số dư thay vì cung cấp điều hướng radio bằng mũi tên.
- Dùng primitive RadioGroup hỗ trợ bàn phím hoặc triển khai đúng ArrowLeft/Right, roving tabindex và checked. Rà tương tự bộ chọn demo và `desktop/src/ui/controls.tsx:97–99`; chưa kiểm đầy đủ bàn phím mọi nhóm.

## Bằng chứng đã kiểm tra

- 7 màn: khám phá, chi tiết Falcon, xác nhận thuê Falcon, tổng quan host, giới thiệu onboarding, số dư, cài đặt; mỗi màn ở 1024x768, 1280x800, 1440x900 (21 lượt). Không tràn ngang document/main trong lượt đo, không lỗi JavaScript.
- Tab lịch host ở cả 3 kích thước: không tràn ngang toàn trang nhưng có finding co cột ở 1024 như trên.
- Nhập tìm kiếm không có kết quả -> empty state; chọn 2 máy -> mở so sánh; xem chi tiết -> xác nhận -> chuẩn bị -> vào viewer minh họa.
- Viewer: Fullscreen API vào được và thoát được; nút mô phỏng mất kết nối chuyển sang reconnect; kết thúc -> hộp xác nhận -> lưu workspace -> cleanup -> hoàn tất.
- Dialog: focus vào trong khi mở; Escape đóng được. Skip link “Bỏ qua điều hướng” đưa focus tới `main`. Focus được kiểm tra có outline ở phần tử mẫu, chưa phải audit toàn bộ bàn phím/contrast.
- Host: đổi chế độ không tự được duyệt; đồng ý trách nhiệm -> kiểm tra tương thích -> đồng ý thành phần -> cài mô phỏng -> cấu hình -> gửi duyệt -> mô phỏng được duyệt -> bắt đầu cung cấp -> dashboard nhận phiên mới.
- Lịch: đặt giờ bắt đầu 23:00 và kết thúc 19:00 hiện lỗi; sau đó khôi phục 19:00–23:00.
- Kịch bản cleanup lỗi hiện máy bị khóa. Sau quay về checkout cùng Falcon thì máy không cho thuê lại; vì vậy lượt kiểm tra lỗi lưu dùng Orion thay cho máy đang bị khóa.
- Kịch bản lưu workspace lỗi dừng ở bước lưu, không tự cleanup; chuyển về kịch bản thành công và bấm thử lại -> hoàn tất.
- Emulate prefers-reduced-motion=reduce hoạt động; Motion phát 1 warning thông tin rằng reduced motion đang bật, không phải lỗi runtime. CSS có quy tắc giảm animation/transition. Chưa đánh giá định lượng motion/hiệu năng.
- Chạy lại `npm.cmd run test -w @cpm/desktop`: **24/24 PASS**, 2 test files.

Không chạy lại typecheck/lint/build trong review này vì không sửa source; kết quả các lệnh đó trước đây là báo cáo của Claude, không phải bằng chứng mới của Codex.

## Ảnh cục bộ

- `.playwright-cli/1024-rent-checkout-falcon-4070.png` (đã xem bằng mắt)
- `.playwright-cli/host-weekly-1024.png` (đã xem bằng mắt, có lỗi grid)
- `.playwright-cli/host-weekly-1280.png`, `host-weekly-1440.png`
- `.playwright-cli/1024-rent-discover.png`, `1280-rent-discover.png`, `1440-rent-discover.png`
- `.playwright-cli/1024-host-onboarding-intro.png`, `1280-host-onboarding-intro.png`, `1440-host-onboarding-intro.png`
- `.playwright-cli/renter-viewer.png`, `renter-completed.png`
- `.playwright-cli/host-configure.png`, `host-dashboard.png`
- `.playwright-cli/cleanup-failed.png`, `save-failed.png`

Các ảnh chụp là frontend mô phỏng, không phải remote thật. App dùng main cuộn riêng nên screenshot viewport/fullPage không luôn ghi hết phần main nằm ngoài vùng cuộn.

## Phần chưa xác minh

- Chưa audit mọi màn/kịch bản, mọi nút, toàn bộ keyboard navigation hoặc screen reader; chưa kiểm Safari/Firefox/máy người dùng khác.
- Chưa đo bundle/performance, chưa xác minh Tauri/WebView2, auth/backend/payment/host-agent/Selkies/cleanup/cloud thật.
- Các phép thử browser là local preview. Không suy ra khả năng cung cấp PC thực tế từ kết quả này.
- Không đụng server Vite 5174 do Claude khởi động. Chỉ đóng browser session riêng `codex-ui-review` sau kiểm tra.

## Việc giao Claude tiếp theo

Đọc findings, sửa 3 vấn đề trong frontend, kiểm tra lại phần liên quan và cập nhật README/PROGRESS để phân biệt bằng chứng Codex đã chạy với kiểm tra chưa có. Chưa tích hợp backend/Tauri và không sửa toàn bộ contract. Nếu muốn thay chính sách tiền, cần quyết định sản phẩm rõ trước.

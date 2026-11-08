# Đặc tả: Frontend tương tác Cloud PC Companion (desktop)

**Feature**: `002-desktop-companion-ui` · **Ngày**: 08/11/2026 · **Trạng thái**: Triển khai để duyệt UI
**Nguồn**: `docs/DESKTOP_APP_START.md` và prompt giao việc 08/11/2026 (chỉ dẫn mới nhất, ưu tiên khi mâu thuẫn tài liệu cũ).
**Phạm vi**: chỉ `desktop/` (workspace mới) và cấu hình npm workspaces tối thiểu. Không sửa `web/`, `design-preview/`, `db/`, `contracts/`.

## Mục tiêu
Một app desktop chung cho người thuê và người cho thuê; một tài khoản, đổi chế độ không đăng xuất, **chọn chế độ không cấp quyền host**. Mọi thứ là mô phỏng (demo) để chủ dự án duyệt UI trước khi tích hợp backend/Tauri/Selkies.

## Hành trình (độc lập, kiểm tra được)
- **J1 – Khách**: chào mừng → (mô phỏng) đăng nhập → chọn chế độ Thuê máy → khám phá (Game/Đồ họa/Lập trình) → lọc/so sánh → chi tiết → xác nhận thời lượng + workspace → chuẩn bị → sẵn sàng → đang dùng (viewer minh họa) → kết thúc → dọn dẹp → hoàn tất → lịch sử/chi tiết.
- **J2 – Host**: chuyển chế độ Cho thuê máy → quyền & trách nhiệm → kiểm tra tương thích (gồm không đạt) → thành phần/quyền/đồng ý → cài mô phỏng → tài nguyên, giá, lịch tuần + ngoại lệ → xem trước → gửi duyệt → chờ duyệt/bị từ chối/được duyệt → dashboard, bật/tạm nghỉ nhận phiên, phiên đang chạy, thu nhập, sự cố, chạy nền/dừng cung cấp.

## Yêu cầu chức năng (FR)
- FR-01 Màn hình mô phỏng: chào mừng, đăng nhập, đăng ký, khôi phục mật khẩu, chọn chế độ.
- FR-02 Chuyển chế độ luôn thấy ở thanh trên; đổi chế độ không đổi `hostApproval`.
- FR-03 Tài khoản, thông báo, hỗ trợ, cài đặt, số dư PCP thử + lịch sử giao dịch; **số dư sử dụng tách khỏi thu nhập host**.
- FR-04 Thuê: khám phá theo danh mục, tìm kiếm, lọc (giá, RAM, VRAM, vị trí, workspace), sắp xếp, so sánh 2–3 máy, chi tiết (môi trường, ứng dụng/game tương thích có nhãn mức hỗ trợ, khung giờ thuê).
- FR-05 Xác nhận thuê: thời lượng bội của 15 phút, **không vượt cửa sổ host**, giá + phí 10% rõ, đủ số dư, chọn không lưu/lưu workspace. Tiền theo MVP/CONTRACT_SPEC: kết thúc sớm trả cả gói (không hoàn phần chưa dùng, không tính theo phút); chuẩn bị thất bại trước khi vào phiên hoàn đủ.
- FR-06 Vòng đời phiên: chuẩn bị → sẵn sàng → đang dùng (⇄ reconnect) → kết thúc → dọn dẹp → hoàn tất; lỗi chuẩn bị, mất mạng, lưu workspace lỗi, cleanup lỗi. **Cleanup lỗi không bao giờ thành "máy sẵn sàng"**.
- FR-07 Viewer minh họa trong app: toolbar, toàn màn hình, trạng thái kết nối, thời gian còn lại, kết thúc; ghi rõ chưa có stream thật; không FPS/ping giả.
- FR-08 Workspace, lịch sử thuê, chi tiết phiên.
- FR-09 Host onboarding (7 bước) với các hồ sơ máy mô phỏng: đạt / thiếu RAM / không GPU hỗ trợ / thiếu ảo hóa.
- FR-10 Cấu hình tài nguyên, giá, lịch tuần và ngoại lệ từng ngày; validation giờ không hợp lệ, chồng lấn; múi giờ Asia/Ho_Chi_Minh (GMT+7) luôn hiển thị; lịch **không tự bật nguồn máy**.
- FR-11 Xem trước bài đăng, gửi duyệt, trạng thái chờ duyệt/bị từ chối/đã duyệt; host chưa duyệt không nhận phiên.
- FR-12 Dashboard host: nhận/tạm nghỉ phiên mới, phiên đang chạy, thu nhập, lịch sử, sự cố; phân biệt **đóng cửa sổ** / **chạy nền** / **dừng cung cấp máy**.
- FR-13 Bộ chọn kịch bản demo: bình thường, trống, đang tải, lỗi dịch vụ, mất mạng, host chưa duyệt, lỗi lưu workspace, lỗi cleanup.
- FR-14 Banner demo cố định; không mô tả auth/thanh toán/cài đặt/remote/cloud là đã hoạt động.

## Ngoài phạm vi
Backend, blockchain, ví thật, remote/Selkies thật, host-agent, Tauri đóng gói, app điện thoại, chatbot, host bond, cash-out, mainnet.

## Không hứa (nội dung)
Không hứa mọi game Windows chạy trên Linux; không hứa dữ liệu được bảo vệ tuyệt đối khỏi chủ máy; không hứa host không bị ảnh hưởng hiệu năng.

## Giả định UI (đảo ngược được)
- Giờ "hiện tại" của demo cố định: Thứ Hai 09/11/2026 20:10 (GMT+7) để kết quả xác định.
- Một host có một máy. Điều hướng bằng hash-router tự viết (tương thích Tauri). Dữ liệu chỉ nằm trong bộ nhớ (tải lại là reset).
- Thang giá: PCP thử / 15 phút; phí nền tảng 10% tính trên phần host nhận (hiển thị minh bạch, đã gồm trong giá).

## Tiêu chí hoàn thành
Typecheck/lint/build/test đạt; Playwright thao tác J1 và J2 ở 1024×768, 1280×800, 1440×900 không lỗi console/tràn ngang; điều hướng bàn phím; ảnh chụp đã xem; README + PROGRESS cập nhật.

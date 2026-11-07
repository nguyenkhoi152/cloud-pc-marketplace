# Spec Kit cho Cloud PC Marketplace

Cài ngày 07/11/2026: Specify CLI 1.3.2 (gói chính thức `specify-cli` trên PyPI, cài bằng `uv tool install specify-cli`). Tích hợp Claude Code, script PowerShell. CLI nằm trong môi trường riêng do uv quản lý, không thêm dependency vào npm.

## Đã cài

- `.specify/`: templates, scripts, workflow và trạng thái tích hợp.
- `.claude/skills/speckit-*/`: 9 skill để Claude sử dụng.
- Tắt runtime events bằng `--integration-options="--events false"`; không cài hook tự động.
- Giữ skill UI UX Pro Max; chỉ cho phép các skill Spec Kit mới đi vào Git, không mở toàn bộ `.claude/`.

Chưa tạo đặc tả tính năng hoặc triển khai code. `.specify/memory/constitution.md` đã có bản 1.0.0 (xem file); đây là bản cô đọng quyết định hiện có, thay đổi phạm vi/nguyên tắc cần chủ dự án xác nhận.

## Bắt đầu trong Claude Code

Đợi công việc đang chạy kết thúc. Nếu phiên hiện tại chưa nhận skill mới, thoát rồi chạy `claude --continue` tại thư mục dự án. Nếu chưa nhận lệnh `specify`, mở terminal mới.

Chạy từng lệnh dưới đây trong chat Claude, xem và duyệt kết quả trước khi chuyển bước:

1. `/speckit-constitution Đọc README.md và tài liệu dự án hiện hành, đối chiếu code. Đề xuất nguyên tắc dựa trên các quyết định đã có; không áp dụng lại quy định UniAct cũ, không tự mở rộng MVP. Giữ kiến trúc và code đang hoạt động. Chỉ chuẩn bị tài liệu, chưa sửa ứng dụng.`
2. `/speckit-specify Đặc tả một phiên thuê PC qua Sunshine/Moonlight: chuẩn bị, cấp quyền, kích hoạt, mất kết nối, hết hạn, thu hồi kết nối đang mở, chặn reconnect và cleanup. Phân biệt chức năng đã có với phần dự kiến. Làm rõ các quyết định chưa chốt với tôi; chưa triển khai code.`
3. `/speckit-clarify`
4. `/speckit-plan` sau khi đã duyệt yêu cầu.
5. `/speckit-tasks` rồi `/speckit-analyze`.
6. Chỉ chạy `/speckit-implement` khi chủ dự án giao triển khai tính năng.

Không viết lại toàn bộ sản phẩm để chuyển sang Spec Kit. Tái sử dụng tài liệu hiện tại, dẫn chiếu nguồn và xử lý các mâu thuẫn trước khi triển khai. UI UX Pro Max tiếp tục phục vụ thiết kế giao diện, Spec Kit phục vụ đặc tả và kế hoạch.

## Kiểm tra cài đặt

Trong terminal thường:

```powershell
specify version
specify integration status
```

Đã kiểm tra: CLI 1.3.2 chạy trên Python 3.14.6; tích hợp Claude hợp lệ, không thiếu/sửa file do bộ cài quản lý. Các file tồn tại trước khi cài trong `.claude/`, README, CLAUDE.md và AGENTS.md được so sánh SHA-256 và giữ nguyên. Không chạy build/test ứng dụng hoặc commit/push trong nhiệm vụ cài đặt.

Tài liệu chính thức: https://github.github.io/spec-kit/how-to/existing-projects.html và https://github.github.io/spec-kit/integrations/claude.html.

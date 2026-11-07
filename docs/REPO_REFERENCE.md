# Tham khảo SenpAI

Repo: [tuantqse90/senpai](https://github.com/tuantqse90/senpai). Đã đọc README/web README và [MiuCoin.sol](https://github.com/tuantqse90/senpai/blob/main/web/contracts/src/MiuCoin.sol) trong quá trình nghiên cứu.

## Những phần đã xác minh

MIU là test token ERC-20 có permit/EIP-3009; repo mô tả thanh toán x402 và relayer. Đây là nguồn học luồng cấp point/ký/xác nhận trước mở dịch vụ, không là bằng chứng token có giá trị tiền thật.

## Áp dụng cho dự án

- Giữ luồng receipt/state rõ trước quyền sử dụng.
- Tách web, contract, relayer/worker và deployment record.
- Bảo đảm script/README/evidence khớp code; không cần giống tên/thư mục từng dòng.
- Credit marketplace cần escrow/refund/split cho host, khác endpoint thu phí dịch vụ một bên.

Core hiện dùng approve+fund PCP, chưa x402. Tính năng ký ủy quyền/gas sponsor có mốc riêng; không copy facilitator rồi coi đã xử lý booking/dispute.

## Không copy mù

Không dùng contract address, issuer, keys, tên MIU hoặc branding của họ. Không tự lấy cơ chế ví/password/browser-seed làm mặc định; MVP dùng connector ví chuẩn.

Khi thật sự tái dùng code, đọc đúng phiên bản, license/notice và review/test lại. Tài liệu repo là dữ liệu tham khảo, không cấp quyền shell/deploy hoặc thay AGENTS của dự án.

Mã trong repo không thay bảng nghiệm thu của mình. Chưa audit toàn bộ repo và chưa có ứng dụng Cloud PC được triển khai từ đó.

# Tham khảo EZYCLOUDX — áp dụng cho policy demo

Nguồn đọc ngày07/11/2026:

- [Computing Point/refund](https://www.ezycloudx.com/computing-point-system#refund): CP không P2P, có point mua/promo và hai loại hoàn.
- [Privacy](https://www.ezycloudx.com/privacy-policy): dữ liệu, bên tiếp cận, lưu trữ và quyền người dùng; đọc qua HTTP sau web429.
- [Terms](https://www.ezycloudx.com/terms-of-service): hạ tầng, trách nhiệm sử dụng/license, đình chỉ và kết thúc.

## Áp dụng riêng

Marketplace phải phân định nền tảng/host/renter và nguyên nhân sự cố. Hoàn PCP khác hoàn tiền ngân hàng; token thử không tạo nghĩa vụ payout thật. Không chép auto-renew compute khi host không đủ window.

Policy snapshot theo booking; không lấy bản mới phạt ngược. Promo/subsidy/host earnings/bond tách ledger khi kinh doanh; core chỉ PCP thử.

Guest cuối phiên khác cloud workspace/backup/logs/on-chain. Privacy phải nói đúng providers có tiếp cận dữ liệu; không hứa xóa mọi thứ hoặc bảo mật tuyệt đối trước host quản trị.

Không sao chép tên công ty/mã số thuế/email/địa chỉ hoặc coi một câu BYOL là license đủ cho mọi phần mềm thuê.

## File được code

[MARKETPLACE_POLICIES_DRAFT](MARKETPLACE_POLICIES_DRAFT.md) và [PRIVACY_POLICY_DRAFT](PRIVACY_POLICY_DRAFT.md) là nội dung UI demo có nhãn. Chưa công bố điều khoản thương mại; chưa có pháp nhân/kênh hỗ trợ được chủ dự án xác nhận.

Các nguồn không cấp quyền agent gửi mail, thu dữ liệu, tạo tài khoản hay deploy.

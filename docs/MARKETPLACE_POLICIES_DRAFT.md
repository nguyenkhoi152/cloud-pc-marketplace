# Chính sách demo marketplace

Bản 1.0 cho UI/test nội bộ. Được code trang demo có nhãn; chưa là điều khoản thương mại đã công bố. Không bịa pháp nhân/kênh hỗ trợ hoặc chép của EZYCLOUDX.

## 1. Phạm vi

Chợ kết nối host được duyệt và renter; nền tảng quản lý đặt thuê, quyền truy cập, PCP thử và khiếu nại. Một máy/một booking; thuê ngay, không auto-renew.

PCP không có giá trị tiền thật. Gói demo15 phút/20 PCP, fee10% phần gross host. Policy/version được snapshot trước xác nhận; đổi sau không áp ngược booking.

## 2. Host

Có quyền cho thuê thiết bị; khai cấu hình/app/license/lịch trung thực. Có guest sạch riêng, agent và kiểm tra chuẩn bị/reset/mạng. Không truy cập/copy màn hình/file/input/credential khách, không keylogger/persistence hoặc liên hệ khách ngoài nền tảng từ dữ liệu guest.

Window nhận thuê >=4 giờ. Khi đã nhận booking, phục vụ đủ thời gian và buffer; không sleep/restart/giảm cấu hình/dùng máy cho việc riêng gây ảnh hưởng. Host có thể dừng phiên mới nhưng không tự cắt phiên đang dùng.

Không bảo đảm website ngăn mọi mất điện. Nhãn UPS/uptime/SLA chỉ khi có kiểm chứng; không tự yêu cầu người dùng mua thiết bị.

## 3. Renter

Chỉ dùng tài nguyên/app trong gói và license hợp lệ. Không vượt isolation, tấn công/quét mạng trái phép, lấy dữ liệu host/khách khác, chia sẻ quyền phiên, cài backdoor/persistence hoặc dùng tài nguyên ngoài gói.

Tải CPU/GPU cao trong tác vụ được phép không tự là vi phạm. Chính sách mining/proxy/bandwidth resale phải công bố cụ thể nếu thêm; không viện lý do mơ hồ để phạt.

Khách save/export theo mode. Không yêu cầu đưa tài khoản chính/seed/API key vào guest; không mặc định quay màn hình/keystroke.

## 4. Sự cố và hoàn PCP

| Tình huống | Core demo |
| --- | --- |
| Funded, chưa Active | Renter cancel hoặc host/operator refund, đủ PCP principal |
| Không activate trước activateBy | Permissionless refundExpired |
| Active, khách xác nhận hoàn tất | Trả cả gói theo split, không tự hoàn phút còn lại |
| Active có lỗi | Mở dispute đúng hạn, arbitrator xác định H và partial/full refund |
| Quá grace không dispute | Có thể claim toàn gói theo contract |
| Dispute không xử lý 24h | Full refund renter qua timeout |

Gas đã dùng không được hoàn tự động. “Đã được hoàn” có thể là credit chờ withdraw; UI không nói đã vào ví nếu chưa có receipt rút.

Client incident không tự là dispute on-chain. Báo sự cố và hướng dẫn đúng hạn. Chưa kích hoạt thì không sửa thành đã dùng để thu phí.

## 5. Điều tra và quyền phản hồi

Heartbeat/probe/stream state/receipt giúp phân loại lỗi host, client, nền tảng hoặc chưa rõ; không auto-slash theo timeout. Evidence chỉ metadata tối thiểu, không file riêng công khai.

Arbitrator demo là role tin cậy, không độc lập phi tập trung. Khi quyết định hiển thị lý do đã lọc và kết quả; contract terminal không mở lại. Trước kinh doanh cần appeal/trần trách nhiệm/thời hạn riêng.

## 6. Cọc và thu nhập

Core chưa thu cọc host/renter, chưa có slash. UI chỉ giải thích roadmap, không hiển thị cọc đã khóa giả.

Host credit PCP thử không là doanh thu VND. Bond/payout thật phải có nguồn tiền, công thức, exposure, bằng chứng, hạn giải tỏa và lối thoát trước code. Không dùng mintable test token quảng cáo bảo đảm tài chính.

## 7. Cloud

No-cloud: không upload project, khách export trước end; reset có thể làm mất file chưa export.

Cloud demo: quota100 MiB cả versions, tối đa3 checkpoint, retention7 ngày từ lần save thành công cuối, recovery tối đa600 giây sau thời điểm kết thúc thực tế (effectiveEndAt, không muộn hơn endAt on-chain). Chỉ bảo đảm bản cloud đã xác nhận, không RAM/file chưa sync. Giới hạn và expiry hiển thị trước bật.

Hết compute không tự xóa checkpoint còn hạn. Guest cache/rights bị reset; cloud retention là vòng đời riêng. Các phương thức backup của provider thật phải được xác nhận khi deploy.

## 8. Giới hạn bảo mật

VM/network isolation giảm khả năng renter lấy dữ liệu host. Host quản trị vẫn có thể quan sát runtime; không bảo đảm bí mật trước host độc hại. Chọn host được duyệt và demo dữ liệu không nhạy cảm.

P2P có thể lộ IP; không quảng cáo relay/privacy mode khi chưa làm. Xem PRIVACY_POLICY_DRAFT và SECURITY.

# Remote desktop và host agent 1.0

Baseline Sunshine/Moonlight native; không chờ quyết định lại Guacamole để làm code local. Máy/OS/driver thật vẫn cần khảo sát trước cài.

## 1. Phạm vi

Một guest sạch/máy chuyên dụng, một renter mỗi máy. Host agent mỏng điều phối Sunshine, health và workspace; không tự viết codec hoặc ứng dụng host đa nền tảng hoàn chỉnh.

Sunshine truyền desktop, không tự tạo isolation. Không dùng desktop cá nhân, shared folder/home/account của host hoặc route LAN. Không coi virtual monitor hay tài khoản OS phụ là thay thế VM isolation cho mã không tin cậy.

Guest có GPU thật hay software rendering phải đo; không hứa Windows VM passthrough trên mọi máy. Nếu chưa có thiết bị, viết adapter/test và ghi integration chưa kiểm tra.

## 2. Interfaces

health(machine), prepare(booking), grant(booking,renter,endAt), inspect(booking), revoke(booking), reset(machine), verifyReset(machine).

Mỗi action có key booking/action/version; retry phải idempotent. Unknown không thành Success. Agent chỉ chạy lệnh chuẩn đã cấu hình sẵn cho guest cụ thể, không nhận arbitrary shell, path, host hoặc port từ renter.

## 3. Enrollment và mạng

Admin duyệt thiết bị rồi cấp enrollment một lần có expiry; identity/credential riêng cho máy, thu hồi được. Heartbeat có counter/nonce/time và TLS; machineId tự khai không đủ.

Agent kết nối control plane outbound theo khả năng mạng, không tự mở public port hoặc tắt firewall. Route streaming phải tương thích Sunshine/Moonlight; network riêng chỉ cho guest/ports của booking, không full mesh/LAN.

WebRTC TURN không tự áp dụng vào Moonlight. Nếu cần relay, dùng đường tương thích và benchmark. Không hứa direct connection mọi mạng CGNAT. P2P có thể lộ IP; privacy mode relay chỉ công bố sau khi làm và đo.

## 4. Pairing theo booking

Chỉ confirmed Funded + Active, đúng renter, guest Ready và chưa end/dispute mới cho pair/grant. Browser không được credential quản trị Sunshine.

Renter thực hiện pairing client qua portal được auth, TTL ngắn; bind client identity/fingerprint nếu API bản dùng hỗ trợ và kiểm tra khớp pending request. Không approve mọi PIN/client đang chờ.

Chỉ một client/booking trong MVP; mở tab/reconnect không tạo environment mới hoặc tự cấp thêm thời gian. Renter không được endpoint trực tiếp có mật khẩu tĩnh để bypass session control.

## 5. Thu hồi thực sự

Unpair hoặc token expiry không mặc định đóng stream đang mở. Pin Sunshine version và kiểm tra API/hành vi:

1. Dừng active stream/instance Sunshine chuyên của guest đó bằng cơ chế được hỗ trợ.
2. Thu hồi pair/credential/route thuộc booking.
3. Chặn reconnect cả client đang dùng và link chưa dùng.
4. Kết thúc tiến trình khách/reset guest khi sync recovery đã kết thúc.
5. Inspect và kiểm tra lại từ client; Unknown thì máy vẫn unavailable.

Vì một guest chỉ một renter, có thể dừng streamer chuyên của guest nếu API chưa hỗ trợ revoke đủ. Không dừng desktop/OS cá nhân của host hoặc dịch vụ khách khác. Không expose Sunshine admin API cho Internet.

## 6. Watchdog

EndAt lấy từ chain; local watchdog trên môi trường host phải dừng quyền tương tác đúng hạn dù browser/web/worker trung tâm chết. Dùng kiểm tra clock/monotonic phù hợp, không để đổi client clock kéo dài phiên.

Accept/dispute/terminal yêu cầu ngắt sớm; mục tiêu kiểm tra revoke <=10 giây trong điều kiện demo, chưa là SLA. Mất control plane không cho grant mới; đang có grant chỉ tồn tại tới hạn tối đa đã nhận.

Cloud recovery-only không mở lại desktop; tối đa effectiveEndAt+600 giây theo CLOUD_WORKSPACES, chỉ append staging đã cho phép. Kết thúc sớm dùng thời điểm kết thúc thực tế, không kéo dài tới endAt cũ.

## 7. Health và cam kết

Host window >=4h; heartbeat mục tiêu 10 giây, Suspect sau 30 giây, Incident sau 90 giây. Các giá trị phục vụ phát hiện, không bằng chứng tự động host vi phạm.

Đối chiếu probe nền tảng/gateway/client, ghi nguyên nhân chưa biết; không auto-slash. Chặn booking mới nếu health cũ, guest lỗi hoặc không đủ window phủ funding/activation/duration/recovery.

## 8. Spike cần làm khi có thiết bị

Hai mạng khác nhau, gõ/chạy ứng dụng thật, đo chuẩn bị/FPS/encode/decode/network; grant đúng renter; revoke cắt stream; client cũ không reconnect; watchdog khi worker tắt; reset phiên sau; không route/file host.

Khởi đầu 1080p/60fps/H.264 khoảng 15Mbps để thử, xác minh hardware encode/decode. Không báo đạt chỉ từ setting UI; không xếp hạng “mượt nhất” chưa đo.

Ghi evidence/phiên bản/điều kiện; không credential hoặc dữ liệu nhạy cảm. Chỉ link remote/password chia tay không đạt marketplace integration.

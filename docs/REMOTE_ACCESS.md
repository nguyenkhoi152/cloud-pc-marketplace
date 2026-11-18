# Remote desktop và host agent 1.1

**Cập nhật 08/11/2026 (feature 003)**: baseline đổi từ Sunshine/Moonlight sang **Selkies xem trong app Companion**, qua **session gateway** của host-agent. Bản 1.0 (Sunshine/Moonlight) chỉ còn là lịch sử; các bất biến quyền/thu hồi/watchdog giữ nguyên. Chưa có host thật: mọi mục “spike” dưới đây là **chưa thử**.

## 1. Phạm vi

Một guest sạch/máy chuyên dụng, một renter mỗi máy. Host agent mỏng điều phối môi trường guest, health, gateway và workspace; không tự viết codec.

Selkies truyền desktop Linux; nó không tự tạo isolation. Không dùng desktop cá nhân, shared folder/home/account của host hoặc route LAN. WSL/Docker/VM không phải chứng nhận cô lập đủ cho marketplace công khai và không bảo vệ renter trước host có quyền quản trị: bản demo thật chỉ dành cho host được duyệt và người thử tin cậy trên máy thử riêng.

**Ràng buộc đã đối chiếu từ tài liệu Selkies (docs.selkies.io, release 2.0.0)**: host của Selkies là Linux (Windows/macOS “planned”); tài liệu **không nêu** WSL2/Docker Desktop. Vì vậy “host Windows + Linux trong WSL2/Docker” là giả thuyết phải thử; phương án thay thế: Linux VM (Hyper-V) hoặc máy Linux thử. Docs site đang nhãn phiên bản 2.2.1 còn trang phát hành 2.0.0 nêu image `ghcr.io/selkies-project/selkies/desktop:2.0.0-ubuntu26.04`: **chốt phiên bản khi có host**, không đoán.

**Cập nhật 12/11/2026 — host Windows**: hướng dẫn, nguồn đã đọc và bảng bằng chứng nằm ở [HOST_WINDOWS_WSL](HOST_WINDOWS_WSL.md). Tóm tắt: Selkies/NVIDIA không nêu WSL2 hay NVENC trong WSL2; OctaSpace cho node Windows chạy trong WSL (chỉ từ bản tóm tắt tìm kiếm, chưa tự đọc được trang). Đường đã chạy thật là guest Linux trong VM (agent chạy **trong guest**, app điều khiển bằng lệnh cố định); đường WSL2 mới biên dịch và kiểm đơn vị, **chưa chạy** vì máy dev chưa cài WSL.

GPU thật hay encode phần mềm phải đo (Selkies hỗ trợ NVENC/VA-API và fallback phần mềm; docs nêu 60 fps 1080p phần mềm là khả thi nhưng không nêu cấu hình). Không hứa passthrough hoặc mọi GPU/game Windows.

## 2. Interfaces

health(machine), prepare(booking), grant(booking,renter,endAt), inspect(booking), revoke(booking), reset(machine), verifyReset(machine) — giữ chữ ký `RemoteSessionProvider`.

Mỗi action có key booking/action/version; retry idempotent. Unknown không thành Success. Agent chỉ chạy lệnh chuẩn đã cấu hình cho guest cụ thể, không nhận arbitrary shell, path, URL, host hoặc port từ renter.

## 3. Session gateway (quyết định D3)

Selkies chỉ lắng nghe nội bộ (loopback/mạng container). Renter không nhận URL/mật khẩu Selkies mà đi qua gateway trong agent:

- Grant theo booking: token ngẫu nhiên, TTL ngắn, chỉ lưu băm; gắn renter, booking, `endAt`; dùng được cho một viewer tại một thời điểm (MVP: một client/booking).
- Proxy HTTP + WebSocket tới đúng một upstream cố định theo cấu hình guest; không nhận đích từ client.
- Revoke: đóng **mọi kết nối đang mở**, vô hiệu mọi grant (đã dùng và chưa dùng), từ chối reconnect.
- Watchdog `endAt` chạy trong agent bằng đồng hồ đơn điệu, độc lập với control plane/web/worker; mất control plane không cấp grant mới.
- Lý do tách: docs Selkies không nêu credential theo phiên hay revoke đã kiểm chứng; không dựa vào chúng để thu hồi. Nếu sau này Selkies có cơ chế token theo phiên đã kiểm chứng, gateway vẫn là lớp thực thi `endAt`/revoke.

Trạng thái: gateway cùng test (upstream giả) ở `host-agent/` — **không phải bằng chứng với Selkies thật**.

## 4. Enrollment và mạng

Admin duyệt thiết bị rồi cấp enrollment một lần có expiry; credential riêng cho máy, thu hồi được. Heartbeat có counter/nonce/time và TLS; machineId tự khai không đủ.

Agent kết nối control plane outbound, không tự mở public port, không tắt firewall, không đổi router/OS. Mặc định thử: **cùng LAN** trước (một cổng TCP của gateway). Khác mạng/NAT: cần relay/tunnel do chủ dự án chọn và cung cấp; băng thông/chi phí phải minh bạch; không hứa kết nối mọi mạng miễn phí. WebSocket mode không cần STUN/TURN; WebRTC mode cần UDP rộng hoặc TURN, chỉ dùng nếu đo cho thấy cần.

Mạng chỉ cấp đường tới môi trường thuê, không vào LAN host.

## 5. Cấp phiên theo booking

Chỉ confirmed Funded + Active (chain), đúng renter, guest Ready, chưa end/dispute mới cấp grant. `startedAt` đã chạy từ lúc activate (xem CONTRACT_SPEC, Q3 trong spec 003). Viewer trong app lấy grant qua API (đúng renter), TTL ngắn; app không giữ credential quản trị nào. Một client/booking; reconnect trong hạn không tạo environment mới hay thêm thời gian.

## 6. Thu hồi thực sự

Token expiry không mặc định đóng stream đang mở; gateway phải chủ động:

1. Đóng mọi kết nối viewer đang mở của booking.
2. Vô hiệu grant/credential/route thuộc booking; chặn reconnect của client cũ và link chưa dùng.
3. Dừng/kết thúc tiến trình khách hoặc reset guest sau khi recovery sync kết thúc.
4. Inspect và kiểm tra lại từ phía client; Unknown thì máy vẫn unavailable.

Không dừng desktop/OS cá nhân của host hay dịch vụ khác. Không expose cổng quản trị của Selkies/agent ra Internet.

## 7. Watchdog

EndAt lấy từ chain, đã gửi cho agent khi grant; watchdog cục bộ ngắt quyền tương tác đúng hạn dù browser/web/worker chết, không để đổi clock client kéo dài phiên. Accept/dispute/terminal yêu cầu ngắt sớm; mục tiêu kiểm tra revoke ≤10 giây trong điều kiện demo (chưa là SLA).

Cloud recovery-only không mở lại desktop; tối đa effectiveEndAt+600 giây theo CLOUD_WORKSPACES. Kết thúc sớm dùng thời điểm kết thúc thực tế.

## 8. Health và cam kết

Heartbeat mục tiêu 10 giây, Suspect sau 30 giây, Incident sau 90 giây (phục vụ phát hiện, không là bằng chứng host vi phạm; không auto-slash). Cam kết `host_commitments` ≥4h giữ nguyên; lịch availability của host là lớp riêng (xem Q1 trong spec 003). Chặn booking mới nếu health cũ, guest lỗi hoặc cửa sổ không phủ funding/activation/duration/recovery.

## 9. Spike cần làm khi có thiết bị (CHƯA thử)

Viewer Selkies **trong WebView2 của app** (không mở trình duyệt ngoài): video, audio, bàn phím (gồm Keyboard Lock), khóa chuột, toàn màn hình, clipboard, reconnect, ngắt phiên, chặn reconnect sau revoke. Docs Selkies nói Keyboard Lock chỉ ở trình duyệt Chromium; WebView2 dựa Chromium nhưng phải kiểm thực tế. Đo chuẩn bị/FPS/encode/decode/mạng, hai mạng khác nhau, gõ/chạy ứng dụng thật, watchdog khi worker tắt, reset sau phiên, không route/file host.

Khởi điểm thử 1080p/60fps/H.264; xác minh hardware encode/decode. Không báo đạt từ setting UI; không xếp hạng “mượt nhất” chưa đo. Nếu WebView2 không đáp ứng: báo bằng chứng, phương án thay (webview con/cửa sổ Tauri riêng), không âm thầm đổi trải nghiệm. Ghi evidence/phiên bản/điều kiện; không credential hay dữ liệu nhạy cảm.

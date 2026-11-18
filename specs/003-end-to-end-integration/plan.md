# Kế hoạch: Tích hợp end-to-end

## Cấu trúc (chỉ tạo thư mục khi có nội dung)

```
desktop/             UI đã duyệt; thêm src/api (adapter live) bên cạnh mock/service; chọn bằng VITE_APP_MODE
desktop/src-tauri/   vỏ Tauri 2 (cấu hình + Rust tối thiểu); CHƯA biên dịch được tới khi có Rust + MSVC
host-agent/          Node/TS: session gateway, bộ lệnh cố định, heartbeat; chạy được và test không cần Selkies thật
worker/              Node/TS: outbox lease, vòng đời phiên, đối soát (mốc sau)
supabase/migrations/ thêm: lịch host, device_enrollments, heartbeats, remote_sessions, session_grants
web/                 giới thiệu/tải app + route handler API (mỗi nhóm một adapter, không rải service-role vào component)
packages/shared/     schema API (zod), RemoteSessionProvider, hằng số
```

## Quyết định kỹ thuật và lý do

| Quyết định | Lý do | Đảo ngược |
|---|---|---|
| Gateway trong host-agent đứng trước Selkies | Selkies docs không nêu credential theo phiên hay revoke; invariant “revoke cắt stream + chặn reconnect + watchdog độc lập” phải do mình kiểm soát | Có thể bỏ nếu Selkies bổ sung token theo phiên đã kiểm chứng |
| WebSocket mode làm mặc định thử trước | Một cổng TCP, không cần TURN/UDP range; WebRTC đòi UDP 49152–65535 hoặc TURN | Chuyển `--mode=webrtc` nếu độ trễ/độ mượt không đạt |
| Pin Selkies theo tag container đã ghi trong docs 2.0.0 (`ghcr.io/selkies-project/selkies/desktop:2.0.0-ubuntu26.04`), kiểm tra lại khi có host; docs site đang nhãn “2.2.1” nên cần chốt phiên bản khi thử | Docs/phát hành không cùng số phiên bản; không đoán | Đổi tag sau spike |
| Viewer nhúng bằng iframe có `allow` (fullscreen, keyboard-map, clipboard) tới URL gateway; harness spike kiểm khóa chuột/bàn phím | Đơn giản nhất, giữ trong app; nếu WebView2 thiếu Keyboard Lock/Pointer Lock thì chuyển sang webview con của Tauri | Webview con / cửa sổ riêng trong app |
| Tiền: chỉ chuỗi thập phân/bigint | Handoff + `parsePcp` đã có; tuyệt đối không `number` trong luồng tiền thật | — |
| Adapter live tách khỏi mock | Production không được báo thành công giả | — |
| Agent: bộ lệnh định sẵn, không shell/path/URL/port từ renter | Bất biến AGENTS | — |

## Phương án nếu WebView2/Windows-host không đáp ứng

1. Viewer: webview con của Tauri thay iframe; hoặc cửa sổ Tauri riêng nạp URL gateway (vẫn trong app, không trình duyệt ngoài).
2. Host Windows: Linux VM (Hyper-V) hoặc máy Linux thử riêng thay WSL2/Docker Desktop. Không đổi âm thầm: báo bằng chứng và hỏi chủ dự án.

## Kiểm tra và bằng chứng

- Test tự động có nhãn: *stand-in upstream* (không phải Selkies), PGlite (không phải Supabase thật), contract simulator (không phải Fuji).
- Chỉ ghi “đạt” cho tích hợp thật khi chạy trên đúng môi trường: Supabase thật, Selkies thật trên host chỉ định, Fuji.

## Mốc trong feature này

M-A đặc tả + đối chiếu tài liệu · M-B vỏ Tauri + kiểm tra công cụ · M-C gateway + agent (test local) · M-D schema lịch/enrollment/phiên (PGlite) · M-E API + adapter live · M-F worker · M-G workspace local · M-H Fuji/E2E/đóng gói. Mốc ⛔ đợi host/Supabase/ví được đánh dấu tại tasks.md.

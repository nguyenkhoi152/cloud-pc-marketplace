# host-agent (Cloud PC Companion)

Phần chạy trên máy host. Hiện chỉ có **session gateway** (`src/gateway.ts`); chưa có enrollment/heartbeat client, bộ lệnh `prepare/reset`, cài đặt WSL/Docker, hay kết nối control plane.

Gateway đứng trước Selkies (chỉ lắng nghe nội bộ): grant theo booking, token đổi một lần, proxy HTTP + WebSocket tới upstream cố định, revoke đóng kết nối đang mở và chặn reconnect, watchdog `endAt` bằng đồng hồ đơn điệu. Thiết kế: `docs/REMOTE_ACCESS.md` §3.

```powershell
npm run test -w @cpm/host-agent    # 9 test với upstream giả (HTTP + WebSocket echo)
```

**Giới hạn của bằng chứng**: test dùng upstream giả, không phải Selkies. Chưa thử: Selkies thật, WebView2 (cookie bên thứ ba trong iframe, Keyboard/Pointer Lock), TLS, mạng khác nhau. Gateway đang cấp một grant/booking và không cấp lại sau revoke; nếu mất cookie giữa phiên cần cơ chế cấp lại riêng (chưa làm).

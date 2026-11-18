# Streaming — kết luận áp dụng trong 1.0

Tài liệu đọc thêm; REMOTE_ACCESS và ARCHITECTURE là nguồn code.

## Lựa chọn

**Cập nhật 08/11/2026**: chủ dự án thống nhất app Companion + Selkies; Sunshine/Moonlight chuyển thành phương án đối chứng, không là luồng chính. Selkies docs: host Linux, mặc định WebSocket một cổng TCP, WebRTC opt-in; WSL2/Docker Desktop chưa được nêu nên phải thử (xem REMOTE_ACCESS 1.1).

(Lịch sử) Sunshine/Moonlight native từng là baseline. M0 trên thiết bị thật kiểm tra route/capture/encode/decode/revoke/reset. Không chờ thêm bảng so sánh mới để scaffold.

Browser Linux có thể khảo sát Selkies; Windows/browser xem DCV/giải pháp có quyền thương mại. Parsec là đối chứng khi có license phù hợp. Guacamole chỉ ứng viên văn phòng/browser, không mặc định của MVP hiện tại.

Nguồn: [Sunshine](https://github.com/LizardByte/Sunshine), [Moonlight](https://moonlight-stream.org/), [Selkies](https://docs.selkies.io/latest/), [DCV](https://docs.aws.amazon.com/dcv/latest/adminguide/), [Parsec](https://unity.com/products/parsec).

## Điều cần đo

Cùng host/client/OS/template/GPU/network/workload khi so sánh; xác minh hardware encode/decode, FPS/drop, RTT/jitter/loss, bitrate/direct-relay, input và thời gian revoke/reset.

1080p60/H.264 khoảng15Mbps là điểm bắt đầu, không bảo đảm hiệu năng. Ping không đo toàn bộ input-to-photon. Không cộng benchmark khác OS/GPU thành bảng xếp hạng.

P2P phụ thuộc NAT/CGNAT và route; relay cần tính bandwidth/chi phí. Ví dụ20Mbps≈9GB/giờ một chiều chưa overhead. WebRTC TURN không tự gắn vào giao thức Moonlight.

Pairing/unpair không mặc định cắt active stream; watchdog và dừng streamer guest theo phiên cần chứng minh. Không stream desktop cá nhân để vượt kiểm tra.

Chưa có benchmark hoặc license review toàn bộ stack dự án.

# Data Model: Bản mẫu giao diện "Sky"

Dữ liệu mẫu nằm trực tiếp trong HTML (thuộc tính `data-*`) và lấy nguyên từ `packages/shared/src/fixtures.ts`. Không thêm trường đo đạc.

## Máy mẫu (3 bản ghi: demo-1, demo-2, demo-3)

| Trường | Ví dụ | Ghi chú |
| --- | --- | --- |
| id | demo-1 | định danh mẫu |
| name | Máy dựng phim 4K | có thêm nhãn "Dữ liệu mẫu" khi hiển thị |
| hostName | Host demo A | không phải host thật |
| cpu / ramGb | Ryzen 7 5800X / 32 | khai báo |
| gpu / vramGb | RTX 3070 / 8 hoặc không có | khai báo |
| os | Windows 11 | |
| region | Hà Nội | |
| apps | DaVinci Resolve, Blender | khai báo |
| windowHours | 6 | cam kết host ≥ N giờ |
| workspaceCompatible | true/false | |
| pricePcp | 20 | gói demo, PCP thử |
| durationMinutes | 15 | gói demo |
| status | "chưa xác định" | luôn cố định, không có online/offline |

Quy tắc kiểm tra: không có trường fps, ping, điểm, đánh giá, số lượt thuê, uptime.

## Nhu cầu (gợi ý lọc)

Dựng phim → lọc `minVram=8`; Lập trình → không yêu cầu GPU; Đồ hoạ 3D → VRAM ≥ 12. Chỉ là đường dẫn tới bộ lọc, không phải khuyến nghị AI.

## Trạng thái UI (không lưu trữ)

- Bộ lọc hiện tại (từ khoá, RAM, VRAM, giá tối đa, OS, vùng, workspace).
- Danh sách máy được chọn để so sánh (tối đa 3).
- Menu mobile mở/đóng.

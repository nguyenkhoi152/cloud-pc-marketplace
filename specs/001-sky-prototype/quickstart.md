# Quickstart: kiểm tra bản mẫu "Sky"

## Mở bản mẫu

- Mở `design-preview/index.html` bằng trình duyệt, hoặc
- chạy `python -m http.server 4173 -d design-preview` ở thư mục gốc rồi mở http://localhost:4173/.

Không cần cài gói. Font Be Vietnam Pro tải khi có mạng.

## Kịch bản kiểm tra

1. Trang giới thiệu 1440px và 390px: đủ các phần theo FR-004; hình hero hiển thị; không cuộn ngang.
2. Bấm "Tìm máy" từ header, hero, thẻ nhu cầu: tới đúng trang tìm máy; mục nav hiện tại được đánh dấu.
3. Trang tìm máy: đặt bộ lọc VRAM ≥ 12 chỉ còn 1 máy; bộ lọc không khớp hiện thông báo rỗng; chọn 2–3 máy mở khu so sánh.
4. Bàn phím: Tab qua header, bộ lọc, thẻ; focus luôn nhìn thấy; menu mobile mở/đóng bằng Enter/Space.
5. Reduced-motion: bật giảm chuyển động của hệ thống, hiệu ứng nổi/trôi tắt.
6. Tìm chuỗi cấm trong `design-preview/*.html`: không có fps, ping, "online", sao đánh giá, "Thinkmay".

## Ảnh chụp bằng Edge headless

```text
msedge --headless --disable-gpu --hide-scrollbars --window-size=1440,3200 --screenshot=<out>.png file:///.../design-preview/index.html
```

Lặp lại với 768 và 390 chiều rộng cho từng trang. Ảnh lưu ở `design-preview/screenshots/`.

## Kết quả mong đợi

Ảnh không có tràn ngang, dấu tiếng Việt đầy đủ; danh sách phần chưa kiểm chứng nằm ở `design-preview/README.md`.

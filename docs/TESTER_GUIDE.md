# Hướng dẫn thử Cloud PC Companion (bản thử cho người ngoài)

Trạng thái 18/11/2026. **Đây là bản thử trên testnet, không phải sản phẩm hoàn chỉnh.** Mọi "tiền" là PCP thử và AVAX testnet, không có giá trị tiền và không đổi ra tiền được. Tài khoản và dữ liệu nằm trên một project Supabase dev của người tổ chức, người tổ chức xem được email/tên hiển thị của bạn.

## 0. Cái gì đã kiểm, cái gì chưa (đọc trước)

| Phần | Trạng thái |
|---|---|
| Đăng ký/đăng nhập, danh mục máy, giữ máy | Chạy thật trên Supabase dev |
| Ví thử trong app + vòi PCP/gas trên Avalanche **Fuji** | Đã chạy thật trên Fuji (18/11): ví tạm tự nhận 1000 PCP và gas từ vòi của máy chủ, rồi trả tiền được. Kiểm bằng script trên một máy; **chưa có người ngoài thử bằng app** |
| Thanh toán, kích hoạt, kết thúc, hoàn tất bằng escrow | Đã kiểm trên **Fuji thật** (18/11, một máy, script dùng chính mã của app): giữ máy → approve + fund → kích hoạt → kết thúc sớm → chia tiền (phí nền tảng 10%, host nhận phần còn lại) → máy sạch lại. Hủy trước khi kích hoạt: tiền hoàn **được ghi có ở ví giữ tiền, không tự về ví**: vào **Ví → Rút về ví** (nút mới, **chưa thử bằng tay trong app**). **Chưa kiểm giữa hai máy khác mạng** |
| Xem màn hình máy thuê (Selkies qua cổng xem của host) | 18/11: qua tunnel công khai, trình duyệt thật đổi token một lần lấy phiên (HTTP 200), WebSocket nhận luồng hình (~1400 khung/25 giây), hiện desktop Linux 1280×720; không token thì bị từ chối (401). Kiểm trên một máy (host và người kiểm cùng mạng). **Chưa thử từ máy khác mạng, chưa thử trong khung xem của app, chưa đo độ trễ/FPS** |
| Host bằng WSL2 | Trên máy phát triển (18/11): WSL2 + Docker + image Selkies; agent ghi danh, nhận lệnh, chạy trọn một phiên thuê trên Fuji (chuẩn bị, cấp quyền xem, thu hồi, dựng lại container sạch). Chưa chạy qua các màn hình thiết lập trong app và chưa thử trên máy nào khác, nên vẫn có thể gặp lỗi mà chúng tôi chưa thấy |
| Hiệu năng, độ trễ, FPS, âm thanh, toàn màn hình, GPU | **Chưa đo.** Không có tuyên bố nào về hiệu năng |
| Khay hệ thống, nút cài WSL giúp, rút PCP về ví (người thuê: màn Ví; host: Thu nhập) | Có code và test đơn vị, **chưa thử trên máy thật** |

Vì vậy mục tiêu của đợt thử là **tìm ra chỗ hỏng**, không phải xác nhận mọi thứ chạy.

## 1. Người thuê (cần: Windows 11, kết nối Internet)

1. Cài bộ cài `Cloud PC Companion_..._x64-setup.exe` người tổ chức gửi. Bộ cài **chưa ký số** nên Windows SmartScreen có thể cảnh báo: chọn "More info → Run anyway" chỉ khi bạn đã đối chiếu SHA-256 trong `SHA256SUMS.txt` với `Get-FileHash <tệp> -Algorithm SHA256`. **Nếu máy bật Smart App Control** (thường gặp trên Windows 11 mới cài), nó chặn hẳn và không có nút bỏ qua: chỉ tắt được trong Windows Security → App & browser control → Smart App Control settings → Off (trên bản Windows cũ, tắt xong không bật lại được nếu không cài lại Windows). Không muốn tắt thì dùng máy khác.
2. Mở app, đăng ký/đăng nhập (email thật hoặc email thử, bạn chọn mật khẩu riêng cho bản thử).
3. **Cách nhanh:** bấm **liên kết kết nối** người tổ chức gửi (dạng `https://….trycloudflare.com/api/connect`) trên máy đã cài app. Trình duyệt hỏi "Mở Cloud PC Companion?", chọn **Mở**; app hiện hộp "Kết nối máy chủ mới?", bấm **Kết nối** (app luôn hỏi trước, không tự đổi). **Cách thủ công** nếu liên kết không mở được app: **Cài đặt → Kết nối máy chủ**: dán "mã kết nối" (dạng `https://….trycloudflare.com`, chính là phần đầu của liên kết). Chỉ dán mã từ người bạn tin: app gửi phiên đăng nhập của bạn tới địa chỉ này. Mã **đổi mỗi lần người tổ chức khởi động lại**; nếu app báo không kết nối được, xin mã mới.
4. **Ví**: app tự sinh một "ví thử" **riêng cho từng tài khoản** (khoá lưu trong app trên máy bạn; đăng nhập tài khoản khác trên cùng máy là một ví khác; đăng nhập cùng tài khoản trên máy khác cũng là ví khác, bấm "Liên kết ví khác" để dùng ví của máy đó; xoá dữ liệu app là mất ví, không sao vì là testnet). Bấm **Liên kết ví**, rồi **Nhận PCP và AVAX** (mỗi ví nhận 1000 PCP một lần và một ít AVAX testnet để trả phí giao dịch, tối đa một lần mỗi 24 giờ).
5. **Khám phá** → chọn máy → **Giữ máy** → **Trả tiền** → chờ các bước tiến trình → **Mở màn hình**. Máy đang **offline** (chủ máy chưa bật hoặc đã dừng nhận thuê) bị ẩn mặc định, danh sách tự làm mới mỗi 10 giây; muốn xem cả máy offline thì tích **Hiện cả máy đang offline**.
6. Kết thúc phiên bằng nút trong app. Dữ liệu trong máy thuê bị xoá khi phiên kết thúc: đừng để thứ cần giữ trong đó. Kết thúc sớm sau khi kích hoạt vẫn trả cả gói.
7. Nếu **hủy trước khi kích hoạt** (hoặc bị hoàn tiền), PCP hoàn lại **chưa về ví ngay**: vào **Ví**, dòng "PCP đang chờ rút" → **Rút về ví** (tốn một chút gas AVAX testnet).
8. Sau khi một lần trả tiền bị gián đoạn giữa chừng, máy có thể bị giữ tới ~12 phút (hạn trả 10 phút + đệm 2 phút). Hãy chờ rồi thử lại, đừng bấm giữ máy liên tục.

## 2. Chủ máy (host) — khó hơn, và chưa kiểm trên máy thật

Cần: Windows 11 Home/Pro, ảo hoá bật, ≥ 16 GB RAM khuyến nghị, ≥ 40 GB trống, mạng không chặn kết nối ra Cloudflare. **Chỉ cho thuê cho người bạn tin**: bạn là quản trị máy nên không thể bảo vệ dữ liệu của khách khỏi chính bạn, và WSL2/Docker không phải chứng nhận cô lập.

1. Đăng nhập, chọn **Cho thuê máy → Thiết lập & chạy máy**. App kiểm tra WSL.
2. Nếu chưa có WSL: bấm **Cài WSL giúp tôi** (hộp thoại quyền quản trị của Windows hiện ra, bạn bấm Có; app không tự khởi động lại máy, hãy khởi động lại khi được yêu cầu). Hoặc tự chạy `wsl --install --no-distribution` trong PowerShell (Run as administrator).
3. Mở cửa sổ cài Ubuntu-24.04 (app mở sẵn), đặt tên người dùng/mật khẩu Linux, gõ `exit`, quay lại app, **Kiểm tra lại**.
4. Chọn bản Linux **dùng riêng** cho việc cho thuê, rồi làm theo các bước app liệt kê (cài Docker/Node và tải image Selkies ~8 GB một lần, cài agent).
5. **Không cần admin duyệt.** Ở màn **Máy của tôi**: bấm **Đăng ký làm host** (có hiệu lực ngay), đặt **tên máy** và viết **mô tả ngắn** (kèm giá và vị trí) rồi **Tạo máy**, sau đó bấm **Quét & đăng máy**. Bạn không phải nhập thông số: app tự đọc CPU, số nhân, RAM, GPU và ổ đĩa từ máy. App quét guest (Docker, Node, image Selkies, agent); đạt thì máy hiện cho người thuê ngay, chưa đạt thì app nói còn thiếu gì. Rồi quay lại **Thiết lập & chạy máy**, bước **Ghi danh thiết bị**: chọn máy vừa đăng và bấm **Ghi danh máy này** (app tự xin mã một lần và đưa thẳng vào guest, bạn không phải dán gì). Nếu cài lại guest và máy đã ghi danh trước đó, tick "thay thiết bị cũ". Cần quét xong WSL/Docker/image ở các bước trên trước.
6. Ở bước **Nhận thuê**: chọn giới hạn RAM/CPU cho khách (khuyến nghị ≥ 4 GB và ≥ 2 CPU; số nhân và RAM trên thẻ máy của bạn chính là mức này, còn CPU/GPU tự đọc từ máy và tự cập nhật mỗi lần bắt đầu nhận thuê hoặc mở màn Máy của tôi), tick **Cho phép người ở mạng khác thuê máy này** nếu muốn người ở xa vào được (app mở kênh Cloudflare chỉ kết nối ra, không mở cổng router/tường lửa; địa chỉ công khai đổi mỗi lần bắt đầu), rồi **Bắt đầu nhận thuê**.
7. Muốn app vẫn nhận thuê khi đóng cửa sổ: **Cài đặt → Cho thuê máy → Chạy nền khi đóng cửa sổ**; thoát hẳn bằng biểu tượng ở khay hệ thống → "Dừng nhận thuê và thoát". Chưa có tự khởi động cùng Windows.
8. Dừng nhận thuê: bấm **Dừng nhận thuê** ở Thiết lập & chạy máy, hoặc cứ **Đăng xuất** (app sẽ hỏi lại rồi tự dừng). Máy chuyển sang **offline** trong vài giây và người thuê không đặt được nữa; nếu đang có người thuê, phiên của họ bị ngắt. Chỉ đóng cửa sổ khi đã bật "Chạy nền" thì máy vẫn nhận thuê. Một PC chỉ phục vụ một máy tại một thời điểm: nếu bạn đăng nhập tài khoản khác trên cùng PC, app yêu cầu **ghi danh lại** cho máy của tài khoản đó trước khi cho bắt đầu nhận thuê (không thể bật lại máy của tài khoản trước).
9. Thu nhập và rút PCP về ví: **Thu nhập**.

## 3. Hãy báo lại cho người tổ chức

Mỗi lần thử, ghi: (a) bạn làm bước nào, (b) app hiện thông báo gì (chụp màn hình, **che mã kết nối/mã ghi danh/địa chỉ ví nếu bạn không muốn lộ**), (c) máy bạn: Windows build, RAM, CPU, có GPU không, đang ở mạng nhà hay cơ quan/di động. Đặc biệt cần biết:

- Bước nào treo hoặc báo lỗi; thời gian từ "Trả tiền" tới "Mở màn hình".
- Màn hình máy thuê có hiện không, chuột/bàn phím có ăn không, có giật không (chỉ cảm nhận, chưa có số đo).
- Với host: WSL có cài được không, image Selkies tải được không, `docker` chạy được không, tunnel có nhận địa chỉ không.
- Đóng app/cửa sổ có làm phiên đang chạy bị cắt đúng như app nói không.

## 4. Giới hạn đã biết

- Tunnel nhanh của Cloudflare là dịch vụ không cam kết, địa chỉ ngẫu nhiên và đổi mỗi lần. Cloudflare là bên trung gian có thể thấy lưu lượng (hình ảnh/thao tác của phiên).
- Máy chủ API của đợt thử chạy trên **máy của người tổ chức**: tắt máy đó là mọi thứ dừng.
- Chưa có giới hạn dung lượng đĩa cho khách, chưa có tự khởi động cùng Windows, chưa có trọng tài/tranh chấp/hỗ trợ/thông báo thật.
- Không có benchmark hiệu năng: màn hình chỉ hiện CPU/RAM/đĩa máy tự đọc, không phải số đo.
- Dùng thử với email/mật khẩu **không trùng** tài khoản quan trọng của bạn.

---

## Phần dành cho người tổ chức

Làm theo thứ tự. Mỗi bước nói rõ ai làm và cần quyền gì.

1. **Khoá Fuji** (đã làm): `node scripts/fuji/fuji.mjs gen` tạo khoá ở `C:\cpm-demo\fuji\keys.json` (ngoài repo, ngoài OneDrive; không bao giờ in khoá riêng). `node scripts/fuji/fuji.mjs status` in địa chỉ cần nạp AVAX testnet (deployer, operator, issuer/vòi).
2. **Nạp AVAX testnet** (bạn làm) vào MỘT địa chỉ là `issuer`, rồi chia: `node scripts/fuji/fuji.mjs fund --each 0.03 --keep 0.2 --testers 2 --dry` (xem trước), bỏ `--dry` để chuyển thật sang deployer và operator. Sau khi deploy: `node scripts/fuji/verify.mjs` đối chiếu manifest, on-chain và `server.env` (chỉ đọc, không in bí mật); kiểm phần chuỗi của luồng thuê bằng `npx tsx scripts/public/fuji-rental-check.mts` (tạo một tài khoản tạm trên Supabase dev và gửi giao dịch trên Fuji).
3. **Deploy**: `node scripts/fuji/fuji.mjs deploy` (tốn gas testnet). Ghi `contracts/deployments/fuji.json` (có khối deploy) và `C:\cpm-demo\fuji\server.env` (bí mật).
4. **Tải cloudflared bản ghim**: `powershell -NoProfile -File scripts\public\get-cloudflared.ps1` (chỉ tải và kiểm SHA-256 theo `scripts/public/cloudflared.json`, không chạy).
5. **Build bản cho người thử**: `powershell -NoProfile -File scripts\vm\build-demo-app.ps1 -Profile tester`. Ra `C:\cpm-demo\release\*-setup.exe` + `SHA256SUMS.txt`. Gửi kèm tệp này.
6. **Bật máy chủ công khai** (giữ máy bật và cửa sổ này mở suốt đợt thử): `powershell -NoProfile -File scripts\vm\start-demo.ps1 -Chain fuji -Tunnel -Guest wsl`. Script in **mã kết nối**; gửi cho tester (đổi mỗi lần chạy lại). Tắt: `scripts\vm\stop-demo.ps1`.
7. **Không còn duyệt host/máy hay cấp mã ghi danh** (từ 20/11/2026, sau khi áp migration `20261120000001_self_service_listing.sql` ở SQL Editor và chạy lại `supabase/verify/post_migration_checks.sql`: hàng 15 phải `true`). Host tự đăng ký, tự đăng máy, tự ghi danh. Phanh khẩn cấp khi có người đăng máy xấu: mở app bằng tài khoản admin → **Quản trị → Máy** → **Đình chỉ** (hoặc ở terminal: `npx tsx scripts/public/admin.mts find <tên>` rồi `suspend-machine <machineId>`). Màn Quản trị còn cho xem host/phiên/nhật ký, thu hồi thiết bị và xóa máy chưa có tiền/phiên. Các lệnh cũ `approve-host`, `approve-machine`, `enroll <machineId> <tệp>` vẫn chạy được.

Máy chủ công khai chạy bản production của Next (không phải `next dev`), đứng sau proxy chỉ cho `/api/*` và chặn `/api/admin/*` từ Internet. Rủi ro khi mở tunnel xem `docs/SECURITY.md` mục "Bản thử công khai".

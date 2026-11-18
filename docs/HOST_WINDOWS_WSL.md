# Host Windows: app + guest Linux (WSL2) cho Selkies

Trạng thái 12/11/2026. Đây là hướng dẫn và bảng bằng chứng cho luồng **Cho thuê máy trên Windows 11** của app Cloud PC Companion. Linux cài trực tiếp vẫn là phương án bổ sung (cùng agent và script guest, không cần app).

## 1. Thiết kế

```text
Windows 11 (máy của host)                         guest Linux (WSL2, distro RIÊNG)
┌──────────────────────────┐   wsl.exe --exec    ┌───────────────────────────────────────────┐
│ Cloud PC Companion       │ ──────────────────► │ ~/.cpm-host/cpm-guest.sh  (tập lệnh cố định) │
│  (chế độ Cho thuê)       │  stdin giữ mở       │ ~/.cpm-host/cpm-host-agent.cjs (Node)        │
│  lớp native Rust: host.rs│                     │   heartbeat + kéo lệnh (chỉ gọi RA NGOÀI)    │
└──────────────────────────┘                     │   gateway :18095 (token theo phiên)          │
        ▲ localhost:18095 (WSL2 chuyển tiếp)     │   docker: container Selkies (127.0.0.1:8080) │
        └────────────────────────────────────────┴───────────────────────────────────────────┘
```

- App chỉ gọi **10 lệnh native cố định** (`host_overview`, `host_probe`, `host_install_agent`, `host_configure`, `host_enroll`, `host_provision_start`, `host_agent_start`, `host_agent_stop`, `host_cleanup`, `host_set_wsl_distro`). Không lệnh nào nhận chuỗi shell, đường dẫn hay URL tuỳ ý; renter không có đường nào đưa lệnh vào guest. Mọi tham số qua kiểm dạng ở cả Rust và script guest; cấu hình agent và mã ghi danh đi qua stdin, không `source`/`eval`.
- Agent kết nối **ra ngoài** tới máy chủ API; không mở cổng vào từ Internet. Gateway nghe `127.0.0.1` trong guest; Selkies publish chỉ ở `127.0.0.1:8080` trong guest. Desktop của Windows không được chia sẻ với khách.
- **Dừng nhận thuê**: app đóng stdin của agent (hoặc app thoát) → agent đóng gateway (cắt mọi phiên xem), xoá container khách, rồi thoát. Dọn guest còn có nút riêng khi agent không chạy.
- App **không tự cài WSL**, không bật tính năng Windows, không xin quyền admin, không khởi động lại máy, không sửa tường lửa/router. Các bước đó hiện trong app dưới dạng hướng dẫn kèm lệnh chép sẵn.

## 2. Điều tài liệu chính thức xác nhận (và điều không)

| Chủ đề | Xác nhận | Nguồn / mức xác minh |
| --- | --- | --- |
| Cài WSL | `wsl --install` cần PowerShell **quản trị** và **khởi động lại**; mặc định cài Ubuntu, WSL 2; chỉ chạy khi chưa cài WSL; có `--no-distribution`, `-d`, `--web-download` | Microsoft Learn `windows/wsl/install`, `basic-commands` — đã đọc 10/11 |
| systemd | `[boot] systemd=true` trong `/etc/wsl.conf`, WSL ≥ 0.67.6, rồi `wsl --shutdown`; "systemd services will NOT keep your WSL instance alive" | Microsoft Learn `wsl-config`, `systemd` — đã đọc |
| Mạng | Mặc định NAT; `localhostForwarding` mặc định `true` (cổng bind ở wildcard hoặc localhost trong VM truy cập được từ Windows qua `localhost`); LAN vào WSL ở NAT cần `netsh portproxy`; chế độ `mirrored` cần Windows 11 22H2+, có tường lửa Hyper-V | Microsoft Learn `networking`, `wsl-config` — đã đọc |
| Nhàn rỗi | `vmIdleTimeout` 60000 ms (Windows 11), `instanceIdleTimeout` 15000 ms | Microsoft Learn `wsl-config` — đã đọc |
| GPU trong WSL2 | NVIDIA: CUDA qua driver Windows; **không cài driver NVIDIA trong WSL**; container chỉ hỗ trợ `--gpus all`; **không nêu NVENC/NVDEC**; OpenGL-CUDA interop chưa hỗ trợ; chỉ GeForce/RTX chế độ WDDM | NVIDIA "CUDA on WSL User Guide" (bản 13.5) — đã đọc. NVENC trong WSL: **không có tuyên bố nào trên các trang đã đọc** |
| Selkies | Host Linux (Ubuntu/Debian, Fedora/EL, Alpine, Arch…); `docker run … -p 8080:8080 --shm-size=2g`; GPU NVIDIA cần `--gpus 1 --runtime nvidia` + NVIDIA Container Toolkit ≥ 1.20.1; không GPU thì dựng hình và mã hoá bằng phần mềm; **WSL, Windows host, Docker Desktop không được nhắc trên bất kỳ trang đã đọc** | `docs.selkies.io` (2.2.1): trang chủ, Start, Settings, FAQ, Desktop container, Native; GitHub README/releases — đã đọc 10/11. Chưa đọc: Usage, Secure Mode, WebRTC/Firewall, Licensing |
| OctaSpace | Có node Windows chạy **trong WSL**: trình cài "Node Manager" kiểm tương thích, tự cài thành phần thiếu, chọn dung lượng đĩa/RAM chia sẻ, cấp token để ghi danh trên web; khuyến cáo **không bật dịch vụ VPN/cổng dịch vụ vì chuyển tiếp cổng của WSL phức tạp**; điểm OPTIX không có trên WSL; node WSL chỉ x86_64; lệnh khắc phục `wsl --shutdown`, `wsl --unregister octanode`, `wsl --install -d ubuntu-24.04` | **Chỉ từ bản tóm tắt của công cụ tìm kiếm** về `docs.octa.space/windows-wsl` và `/nodes`. Tôi **chưa tự đọc được nội dung trang**: lần tải trực tiếp trả HTTP 404. Dùng như gợi ý thiết kế, không như xác nhận |

Kết luận về khả năng: tài liệu Selkies **không nói** WSL2 được hay không. "Selkies chạy trong container Docker trong WSL2" là **giả thuyết của dự án**, chỉ được coi là đã thử khi chạy thật trên máy host có WSL2 (mục 4).

## 3. Việc BẠN cần làm (app không tự làm)

Máy dev này **chưa cài WSL** (`wsl --status` báo "The Windows Subsystem for Linux is not installed", mã 50). Trình tự để chạy luồng WSL2 thật:

1. **PowerShell chạy bằng quyền quản trị** (cần quyền admin và khởi động lại):
   ```powershell
   wsl --install --no-distribution
   ```
   Khởi động lại Windows khi được yêu cầu. Hệ thống cần bật ảo hoá trong BIOS/UEFI; máy dev này chạy được VirtualBox nên ảo hoá đang có.
2. **PowerShell thường** (không cần admin): tạo bản Linux riêng cho việc cho thuê và đặt user/mật khẩu Linux khi được hỏi, rồi `exit`:
   ```powershell
   wsl --install -d Ubuntu-24.04
   ```
   Dùng bản này **chỉ cho việc cho thuê**, không để dữ liệu cá nhân trong đó.
3. Dựng phần máy chủ của demo: `powershell -ExecutionPolicy Bypass -File scripts\vm\start-demo.ps1 -Guest wsl -NewEnrollment` (script **xoá tệp backend VM thử còn sót** để app dùng WSL2, rồi cấp mã ghi danh một lần vào `C:\cpm-demo\enroll-token.txt`, hết hạn sau 15 phút; xoá tệp sau khi dán; những lần sau bỏ `-NewEnrollment`). Rồi mở app → **Cho thuê máy → Thiết lập & chạy máy**. App tự kiểm tra lại và dẫn từng bước: chọn distro, bật systemd nếu thiếu (hiện lệnh để bạn chạy), cài Docker/Node và tải image Selkies (khoảng 8 GB; chạy bằng `wsl -u root`, tức quyền root **của guest** chứ không phải quyền admin Windows; với guest thử qua SSH thì dùng `sudo -n`), cài agent, ghi danh bằng mã do admin cấp, bắt đầu nhận thuê.
4. Chỉ khi máy chủ API chạy **ngay trên máy Windows này** (demo cục bộ): WSL2 ở chế độ mạng NAT mặc định không thấy `127.0.0.1` của Windows. App sẽ hiện lệnh cho `networkingMode=mirrored` (Windows 11 22H2+) — việc này đổi cấu hình WSL của bạn nên bạn tự chạy. Nếu máy chủ API ở máy khác thì không cần.

Không cần: sửa tường lửa/router (bản thử chạy cùng máy), mở cổng ra Internet.

## 4. Bảng bằng chứng

| Hạng mục | Kết quả | Mức |
| --- | --- | --- |
| Kiểm tra WSL ở Windows (`wsl.exe --status/--version/-l`) bằng lớp native; app diễn giải đầu ra "chưa cài" thật của máy này thành bước "cần cài WSL" kèm lệnh admin + khởi động lại | Có test (đầu ra thật của máy này, 10/11) | **Đã chạy thật** với trường hợp "chưa cài" |
| Phân tích đầu ra khi WSL **đã cài** (`--list --verbose`, nhiều distro, WSL1, ngôn ngữ khác) | Test theo định dạng tài liệu mô tả | **Chưa quan sát trên máy thật** (máy chưa có WSL) |
| Tập lệnh guest `cpm-guest.sh`: `probe`, `provision` (root), `install-agent` (kiểm checksum), `configure` (danh sách cho phép), `enroll`, `run`, `stop`, `cleanup`; tham số xấu bị từ chối | Chạy trong **VM Ubuntu 24.04 thật** (không phải WSL) | Đã chạy thật trong VM |
| Agent trong guest: khởi tạo container sạch, heartbeat tới máy chủ, gateway 401 khi không token, dừng ⇒ cắt phiên + xoá container + xoá pid | Chạy trong VM; 50 test đơn vị | Đã chạy thật trong VM |
| Backend `wsl` của app: dựng đúng dòng lệnh `wsl.exe -d <distro> --exec bash …` | Test đơn vị chỉ kiểm cách dựng đối số | **Chưa chạy thật** (chưa có WSL) |
| **Luồng host trong app đã cài** (guest = VM thử): kiểm tra → cài agent → ghi danh → bắt đầu nhận thuê → người thuê (cửa sổ riêng) dùng máy trong khi host thấy phiên → dừng → bắt đầu lại → tắt cứng app | `scripts/vm/host-flow-e2e.mjs` **28/28** (12/11), gồm người thuê 12/12 trong cửa sổ riêng | Đã chạy thật trong app Tauri đã cài, **guest là VM, không phải WSL2** |
| Viewer trong app hiển thị desktop thật | Đo điểm sáng ở dải đáy khung rồi xem ảnh: thấy hình nền logo + **thanh tác vụ LXQt**; Selkies báo "Poor connection" (VM không GPU) | Đã chạy thật. Các lượt trước chỉ kiểm kích thước khung, chưa chứng minh có hình |
| Tắt cứng app (`taskkill /F`) ⇒ agent trong guest tự dừng và xoá container | Đạt, qua SSH (log agent: "agent dừng theo yêu cầu → guest đã dọn") | Đã chạy thật với VM |
| Đóng app êm (WM_CLOSE → `RunEvent::Exit`): app đóng stdin rồi gọi `stop` tường minh trong guest (chỉ khi phiên app này đã bật agent) | Agent dừng + guest dọn sau 12 s, tiến trình app thoát sạch | Đã chạy thật với VM; **chưa qua `wsl.exe`** |
| Mở lại app (URL không hash) với phiên đã lưu | Vào thẳng `#/host` (trước đây luôn hiện Welcome như chưa đăng nhập) | Đã chạy thật |
| Đường WSL trên máy KHÔNG có WSL (`scripts/vm/wsl-mode-check.mjs`) | **9/9**: bước WSL là `manual` + huy hiệu quản trị/khởi động lại + lệnh, không có nút tự cài, các bước sau chưa tới, không banner VM | Đã chạy thật: chỉ chứng minh phát hiện "chưa cài WSL", **không** chứng minh phần còn lại của đường WSL |
| Nội dung do gateway của host phục vụ (iframe viewer) gọi lệnh native của app | `scripts/vm/iframe-ipc-check.mjs` **4/4**: mọi lệnh bị `not allowed by ACL`; đối chứng dương đạt | Đã chạy thật |
| Hai cửa sổ host/renter, hồ sơ WebView2 riêng (`open-app.ps1`) | Mỗi cửa sổ có `EBWebView` riêng; hai tài khoản và hai ví giả lập cùng chạy | Đã chạy thật |
| `stdin` đóng đi xuyên `wsl.exe` tới tiến trình trong guest (cơ chế dừng khi app thoát) | Đã kiểm xuyên SSH ở VM | **Chưa kiểm xuyên `wsl.exe`** |
| Distro WSL có bị tắt khi nhàn rỗi dù agent đang chạy (`vmIdleTimeout`) | Thiết kế dựa vào tiến trình `wsl.exe` đang mở | **Chưa kiểm** |
| `localhost:18095` của Windows tới gateway trong WSL2 (`localhostForwarding`) | Theo tài liệu Microsoft | **Chưa kiểm** |
| Guest WSL2 thật (17/11/2026): Ubuntu-24.04, WSL 2, user `cpmuser`, systemd bật; probe chỉ đọc bằng `cpm-guest.sh` | Đọc được 16 CPU, 31,8 GB RAM, 954 GB trống, phát hiện `/dev/dxg` + card NVIDIA GeForce RTX 5070 Laptop (chỉ là thiết bị phát hiện được) | Đã chạy thật |
| Cài thành phần trong guest bằng `provision` (root của guest): `docker.io`, `nodejs`, image Selkies ghim digest `sha256:5e877dfc…9015` | `provision_done=1`; Docker 29.1.3, Node 18.19.1, `cpmuser` gọi được docker, image có | Đã chạy thật |
| Selkies trong Docker trong WSL2 | Container tạm lên `healthy` sau ~15 giây, HTTP 200 trong guest và từ Windows qua `127.0.0.1` (chuyển tiếp localhost của WSL); chạy với `--memory=4096m --memory-swap=4096m --cpus=2` thì docker ghi nhận đúng (mem=4294967296, swap=4294967296, nanocpus=2000000000); dùng 342 MiB RAM lúc rảnh; đã xoá container sau khi thử | Đã chạy thật (chỉ khởi động và HTTP; **chưa** xem hình, chưa gateway/agent) |
| Guest WSL2 (NAT mặc định, không có `.wslconfig`) gọi máy chủ API chạy trên Windows (17/11/2026) | `probe` với `http://127.0.0.1:3000/api` ⇒ `api_reachable=0`; nhưng `curl` tới IP Windows như guest thấy (`172.27.160.1`, lấy từ `ip route`) ⇒ HTTP 200 với `/api/chain-info`. Kết luận: demo cục bộ cần `networkingMode=mirrored` (bước thủ công có sẵn trong app) hoặc IP Windows (đổi khi khởi động lại); đường tunnel https không bị ảnh hưởng | Đã chạy thật |
| Mã hoá bằng GPU (NVENC) trong WSL2; hiệu năng, độ trễ, FPS | — | **Chưa thử.** Container chạy KHÔNG có `--gpus`, tức mã hoá bằng CPU; Selkies và NVIDIA đều không có tuyên bố về WSL2/NVENC |
| Máy ảo VirtualBox (1 vCPU, không GPU) | Dùng để chạy cùng luồng khi chưa có WSL | Chỉ chứng minh luồng, **không đại diện hiệu năng**, từng treo/`soft lockup` |

## 5. Điều bản thử KHÔNG hứa

Không có GPU/stream hiệu năng thật; không có chạy nền khi đóng app; không mở mạng cho khách ở máy khác (cần relay/tunnel do chủ dự án chọn); WSL2/Docker không phải chứng nhận cô lập và không bảo vệ khách khỏi chủ máy có quyền quản trị; chưa ký số bộ cài.

## 6. Linux cài trực tiếp (bổ sung)

Trên máy Linux Ubuntu/Debian: chép `host-agent/guest/cpm-guest.sh` và `host-agent/dist/cpm-host-agent.cjs`, rồi dùng cùng các hành động (`provision` bằng root, `install-agent <sha256>` đọc agent từ stdin, `configure`, `enroll`, `run`). Chưa có giao diện cho đường này; chưa thử trên máy Linux thật.

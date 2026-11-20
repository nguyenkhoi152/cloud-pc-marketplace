# Mô hình bảo mật 1.0

Đặc tả kiểm soát cần thực hiện, chưa là chứng nhận an toàn. Dùng dữ liệu không nhạy cảm và tài sản thử.

## 1. Tin cậy

Renter/client/listing là dữ liệu không tin cậy. Host được duyệt vẫn quản trị máy vật lý; có thể quan sát/tamper plaintext, memory, input, token khi workload chạy. Guest VM, TLS và disk encryption không tự loại bỏ quyền này.

Backend/issuer/operator/arbitrator/cloud key management là các bên tin cậy trong demo. Không pitch trustless/private tuyệt đối. Confidential computing/attestation là nghiên cứu riêng, không mặc định có trên PC dân dụng.

## 2. Bảo vệ host khỏi renter

Guest/máy chuyên dụng sạch; không mount home/raw disks/tài khoản/clipboard cá nhân hoặc Docker socket. Không arbitrary shell/API quản trị từ browser. Network chỉ guest/ports cần thiết, không route LAN/full mesh.

Quyền guest tối thiểu và reset được kiểm tra; GPU/input passthrough cần review đúng phần cứng/OS. Container không tự là VM isolation. Không giải phóng máy khi revoke/reset Unknown.

## 3. Bảo vệ renter khỏi host và renter khác

Cloud ngoài host, cấp read đúng version và write staging đúng booking. Guest không có user portal session/root storage/service key; không xóa checkpoint cũ.

Wallet ký/portal quản lý trên thiết bị riêng. Không yêu cầu email chính/seed/API key/drive password trên guest. Không lưu browser profile cá nhân vào workspace.

Không hứa host chưa copy dữ liệu chỉ vì reset hoặc delete key. IP có thể lộ khi P2P; chế độ relay cần thực hiện và đo trước khi quảng cáo che IP.

## 4. Identity và API

Supabase session verify server/RLS. Role không từ metadata user tự sửa hoặc localStorage. Wallet challenge binding session/domain/chain/address, nonce một lần và expiry, consume nguyên tử.

Mỗi resource authorization, CSRF/origin, schema validation, rate/body/file limits. Chống object ID guessing, traversal/symlink/SSRF; hostname/port remote lấy cấu hình được duyệt, không client tùy ý.

Host enrollment/heartbeat có credential riêng, chống replay và revoke; signature chứng minh nguồn thông báo, không chứng minh host không nói dối.

## 5. Tiền

Token restricted-transfer/issuer cap/escrow once, quote EIP-712 đầy đủ, chain receipt verifier, idempotency và pull payment theo CONTRACT_SPEC.

Pause new funding không chặn exits. Không lấy DB balance làm nguồn chuẩn; không refund/mint để che receipt chưa đối soát. Không dùng free points hứa cash-out, không slash heartbeat tự động.

## 6. Secret

Không seed/private key/password/access token/connection URL nhạy cảm trong Git/log/ảnh/câu trả lời. .env.example placeholder; .env thật ignore; kiểm tra cả build output.

Keys issuer/quote/operator/arbitrator, Supabase service/secret, S3, credential Selkies và khóa gateway/agent ở server/host secret store, không NEXT_PUBLIC. Không tự tạo ví tiền thật hoặc copy wallet code SenpAI.

Nếu dùng local test accounts, không in private key thành output bàn giao; tránh lệnh node simulator tự dump keys ra log công khai. Khóa thử được biết rộng không được dùng cho tài nguyên thật.

## 7. Dữ liệu

On-chain chỉ random IDs, public policyHash, ví và tiền/thời hạn cần thiết. Không file/PII/IP/endpoint/evidence nhạy cảm. Giao dịch có thể liên kết ví, không xóa được.

Saved chỉ sau commit checkpoint; no-cloud không upload. Version/quotas/recovery/retention ở CLOUD_WORKSPACES. Mã hóa do nền tảng giữ key không là zero knowledge.

Không mặc định quay màn hình/keystroke. Support xem tối thiểu theo quyền/audit; AI tư vấn không đọc project hoặc secret.

## 8. Sự cố

Ngừng phiên mới → revoke theo quyền → ghi evidence đã lọc → đối soát chain/provider → refund/dispute theo state → reset/verify rồi mở máy. Nếu không ngắt được, báo rõ và giữ máy unavailable.

Worker mất RPC không tự bảo đảm host có lỗi. Watchdog local kết thúc quyền theo hạn; token/URL expiry không thay cắt connection đang mở.

## 9. Trước công khai/kinh doanh

Rà soát license Windows/ứng dụng/streamer, terms/provider access, retention/backup, hạ tầng/keys, audit tiền và mô hình payout. Chuẩn bị code local không đồng nghĩa đủ điều kiện thu tiền/công bố SLA.

## 10. Bề mặt lệnh của app host và khoá thử công khai (12/11/2026)

- **Lệnh native của app (chế độ Cho thuê)**: UI chỉ gọi được 16 lệnh cố định (từ 12/11 thêm: tunnel ×3, cài WSL giúp ×2, chạy nền ×1) (`desktop/src-tauri/src/host.rs`). Không có lệnh nhận chuỗi shell, đường dẫn hay URL tuỳ ý; `wsl.exe`/`ssh.exe` gọi bằng đường dẫn tuyệt đối trong System32 và đối số dạng mảng (WSL dùng `--exec`, không qua shell của Windows). Tham số được kiểm dạng ở Rust **và** lần nữa trong `host-agent/guest/cpm-guest.sh`; cấu hình agent và mã ghi danh đi qua stdin, không bao giờ `source`/`eval`. Backend `ssh-dev` chỉ đọc từ tệp do script ghi, UI không đặt được. Người thuê và nội dung do host phục vụ không có đường nào gọi các lệnh này: kiểm bằng `scripts/vm/iframe-ipc-check.mjs` (kết quả ở PROGRESS).
- **Quyền**: app không tự cài WSL, không tự bật tính năng Windows, không sửa tường lửa/router, không khởi động lại máy. Ngoại lệ DUY NHẤT (12/11, theo yêu cầu "giống OctaSpace"): nút **Cài WSL giúp tôi** chạy đúng một lệnh cố định `wsl --install --no-distribution` qua hộp thoại UAC của Windows và chỉ khi người dùng bấm; từ chối UAC thì không có gì được cài; không nhận tham số từ UI; chưa kiểm trên máy thật. Bước cài thành phần chạy bằng root **của guest** (`wsl -u root`), không phải quyền quản trị Windows.
- **Guest**: Selkies chỉ publish ở `127.0.0.1` trong guest; gateway chỉ cấp phiên theo token; agent chỉ gọi RA NGOÀI. Credential thiết bị chỉ nằm trong guest (`~/.cpm-host/data`, chế độ 0600); app không giữ credential và không hiện mã ghi danh. WSL2/Docker không phải chứng nhận cô lập và không bảo vệ khách khỏi chủ máy có quyền quản trị.
- **Khoá thử công khai (Hardhat)**: 20 khoá mặc định của Hardhat ai cũng biết. `loadServerConfig` và worker **từ chối khởi động** nếu quote signer/operator là một trong số đó mà `RPC_URL` không phải `http://127.0.0.1|localhost`; ví giả lập trong app chỉ ký khi RPC là loopback **và** nút tự nhận là Hardhat (`hardhat_metadata` có `instanceId` + `web3_clientVersion` bắt đầu `HardhatNetwork/`), kiểm lại mỗi lần ký — một cổng loopback chuyển tiếp tới mạng thật bị từ chối.
- **Thu hồi thiết bị**: `POST /api/admin/devices/revoke` (chỉ admin, quyền kiểm ở hàm DB); credential cũ bị từ chối ngay ở heartbeat/kênh lệnh.

## 11. Bản thử công khai: tunnel, vòi testnet, ví thử trong app (12/11/2026)

Áp dụng khi chạy `start-demo.ps1 -Chain fuji -Tunnel` và bản cài `-Profile tester`. Đây là mức bảo vệ cho **đợt thử có người tổ chức và người thử tự nguyện**, không phải cho dịch vụ công khai.

- **Mở Internet**: máy tổ chức chạy `cloudflared` (bản ghim + SHA-256 trong `scripts/public/cloudflared.json`, đối chiếu với mô tả release chính thức) chỉ kết nối RA. Tunnel trỏ vào `scripts/public/api-proxy.mjs`, KHÔNG trỏ vào Next: chỉ `/api/*` được chuyển tiếp, `/api/admin/*` bị chặn từ Internet, thân ≤ 1 MiB, 300 yêu cầu/phút/khách, hạn chờ upstream 60 giây (có test). Web chạy bản production (`next build` + `next start`), không phải `next dev`. Cloudflare là bên trung gian thấy được lưu lượng. Tắt máy/`stop-demo.ps1` là đóng lối vào.
- **Mã kết nối**: app chỉ nhận địa chỉ `https://*.trycloudflare.com` (hoặc loopback) vì app gửi phiên Supabase tới đó; danh sách này đối chiếu tự động với `connect-src` trong `tauri.conf.json` (test). Một mã độc hại vẫn nhận được phiên đăng nhập của người dán nó: người tổ chức phải gửi mã qua kênh tin cậy.
- **Vòi testnet** (`POST /api/faucet`): server tự lấy địa chỉ ví đã liên kết (client không chọn), mint PCP một lần/ví, nhỏ giọt gas một lần/24 giờ **theo ví và theo tài khoản**, 4 yêu cầu/10 phút/tài khoản (đếm cả yêu cầu lỗi), khoá cố vấn theo ví chống đua. Khoá vòi là khoá `issuer` (chỉ quyền mint PCP thử + AVAX testnet), `FAUCET_PRIVATE_KEY` bị từ chối nếu là khoá Hardhat công khai. Rủi ro còn lại: ai đăng ký được nhiều tài khoản thì rút được nhiều gas testnet; chấp nhận được vì là testnet và ví vòi chỉ nạp ngân sách nhỏ.
- **Khoá**: sinh bởi `scripts/fuji/fuji.mjs gen` ở `C:\cpm-demo\fuji\keys.json`, từ chối thư mục trong repo/OneDrive, không in khoá riêng; `server.env` cũng bí mật. Khoá nằm trong biến môi trường của tiến trình node khi chạy; không có bản sao trong repo hay `chain.env.sh`.
- **Ví thử trong app (Fuji)**: khoá sinh trong app, lưu `localStorage` của WebView (không mã hoá; mất khi xoá dữ liệu app; chỉ dùng cho testnet). KHÔNG có đường nào dùng khoá Hardhat công khai hay `hardhat_*`. Mỗi lần ký/gửi/đọc, RPC phải trả đúng `chainId` mà máy chủ công bố; RPC chỉ được thuộc danh sách (`api.avax-test.network`, `avalanche-fuji-c-chain-rpc.publicnode.com`). **Ví giả lập cũ giữ nguyên chốt chặn loopback + nhận diện Hardhat**; hai loại ví tách khỏi nhau (`kind`), UI gắn nhãn khác nhau.
- **Host qua tunnel**: cổng xem của host (`127.0.0.1:18095`) được tunnel chỉ khi host tick đồng ý và bấm bắt đầu; tunnel đóng khi dừng/thoát/lỗi (có test trình tự, kể cả đóng tunnel khi agent không chạy được). Không có token xem hợp lệ thì gateway từ chối (401); cookie `SameSite=None; Secure` trên https. **Chưa kiểm** WebView2 chấp nhận cookie bên thứ ba từ tên miền tunnel.
- **Chưa làm / rủi ro biết trước**: bộ cài chưa ký số; máy chủ API chạy trên PC của tổ chức (không HA, không WAF); không giới hạn tần suất theo tài khoản ngoài vòi; log của Next/API chạy trên máy tổ chức có thể chứa dữ liệu yêu cầu; tunnel nhanh không có cam kết dịch vụ.

## 12. Tự đăng máy, không admin duyệt (20/11/2026, quyết định của chủ dự án, tạm thời cho bản thử)

Migration `20261120000001_self_service_listing.sql` bỏ ba cổng do admin giữ: duyệt host, duyệt máy, cấp mã ghi danh thiết bị. Nay: host tự đăng ký (approved ngay) → tạo máy → **Quét & đăng máy** (máy `approved` ngay nếu `declared_specs` có `cores` và `ramGb` là số ≥ 1) → **tự xin mã ghi danh** cho máy mình (`POST /api/host/enrollments`, đi qua proxy công khai; DB kiểm người gọi là chủ máy và host chưa bị đình chỉ).

- **Cái đã đổi trong mô hình tin cậy:** bất kỳ ai có tài khoản đều đăng được máy hiện cho mọi người thuê, kể cả máy giả hoặc không có agent thật. Trước đây admin là bước người thật chặn việc này.
- **Cổng "quét máy đạt điều kiện" chỉ có ở app Windows** (`machineEligibility`/`assertMachineEligible`): máy chủ KHÔNG kiểm chứng được kết quả quét. Ai gọi thẳng RPC `submit_machine_for_review` bỏ qua app vẫn đăng được, miễn thông số tối thiểu hợp lệ. Cái duy nhất máy chủ tự thấy là heartbeat của agent đã ghi danh (`machine_health`); việc gắn heartbeat vào điều kiện giữ máy (`can_accept_new`, câu hỏi Q1) vẫn chưa làm.
- **Rủi ro cho người thuê:** host xấu có thể nhận tiền cho phiên không phục vụ nếu người thuê không `accept` hoặc `dispute` trong thời gian ân hạn (`claimAfterGrace`). Chấp nhận được vì chỉ là PCP thử trên testnet; KHÔNG chấp nhận được khi có tiền thật. Cần lại một cổng (duyệt thủ công, host bond, hoặc điều kiện heartbeat) trước khi đó.
- **Nội dung do host tự viết** (tên, mô tả) hiện công khai không qua kiểm duyệt. React tự escape khi hiển thị; chưa có bộ lọc nội dung.
- **Thông số máy (CPU, số nhân, RAM, GPU, VRAM, ổ đĩa) nay do app tự đọc từ máy** (20/11/2026): chủ máy chỉ gõ tên và mô tả; lúc **Quét & đăng máy** app ghi thông số đọc được vào `declared_specs` rồi mới đăng (nút **Đọc lại cấu hình** làm mới cho máy đã đăng). Đây là tài nguyên mà bản Linux dành cho thuê thấy, tức đúng phần người thuê dùng được (RAM của WSL thường nhỏ hơn RAM Windows). **Mô hình tin cậy không đổi:** việc đọc chạy trong app, máy chủ không kiểm chứng; host gọi thẳng PostgREST vẫn ghi được `declared_specs` tùy ý (grant UPDATE theo cột cho chủ máy). App không đo được tốc độ mạng nên bỏ trường `networkMbps` khi ghi thông số; màn chi tiết máy ẩn dòng "Mạng" nếu thiếu số đo.
- **Phanh khẩn cấp còn nguyên:** `review_host(..., 'suspended')` và `review_machine(..., 'suspended')` (script `admin.mts suspend-machine`). Host bị đình chỉ không tự gỡ được (client không có UPDATE/DELETE trên `host_profiles`), mất quyền đăng máy, tự ghi danh/thu hồi thiết bị và không còn trong `public_machines`; máy bị đình chỉ không đăng lại được. Mỗi lần đăng máy và ghi danh có dòng `audit_logs` (`publish_machine`, `create_enrollment`).
- **Bỏ trigger `machines_spec_change`:** trước đây sửa thông số máy đã duyệt đưa máy về `review`; không còn ai duyệt lại nên máy sẽ kẹt, trigger bị bỏ. Hệ quả: host sửa thông số máy đã đăng không cần duyệt lại.
- **Muốn quay lại có admin duyệt:** cần migration mới khôi phục default `pending` của `host_profiles`, policy `status = 'pending'`, nhánh `review` của `submit_machine_for_review`, trigger spec và điều kiện chỉ-admin của `create_enrollment`/`revoke_device`.

**Màn Quản trị trong app (20/11/2026, migration `20261120000002`).** Thay `admin.mts` ở terminal; chỉ hiện ở chế độ live với tài khoản có dòng `admin` trong `user_roles`.
- **Cờ `isAdmin` ở giao diện chỉ để ẩn/hiện màn.** Quyền thật do DB: mọi lần đọc đi qua RLS (admin đọc được `profiles`, `host_profiles`, `machines`, `bookings`, `user_roles`, `audit_logs`; người khác chỉ thấy phần của mình), mọi thao tác ghi đi qua hàm kiểm admin (`review_host`, `review_machine`, `admin_delete_machine`) hoặc hàm chủ-máy-hoặc-admin (`create_enrollment`, `revoke_device`). Người không phải admin gọi thẳng RPC vẫn nhận `forbidden` (có test DB).
- **Thu hồi thiết bị đi qua `POST /api/host/devices/revoke`** (không phải `/api/admin/*`, vốn bị proxy công khai chặn). Hệ quả: admin cũng làm được qua đường công khai, quyền vẫn do hàm DB kiểm.
- **`admin_delete_machine` chỉ xoá máy chưa từng có tiền hay phiên** (mọi booking đều `expired`/`cancelled` và `not_granted`); máy đã có lịch sử tiền bị từ chối (`has_history`) và chỉ đình chỉ được, để không mất dấu vết tiền. Có audit `delete_machine` (tên máy, số lượt giữ máy đã xoá). Không hoàn tác được: màn hỏi xác nhận.
- **Trạng thái online công khai** (`public_machines.availability`: `online`/`busy`/`offline`) tính từ heartbeat và booking đang sống, viết thẳng điều kiện trong view vì Postgres kiểm quyền hàm gọi trong view theo người truy vấn. Lộ cho người chưa đăng nhập việc một máy đang online hay đang bận (không lộ chủ máy hay địa chỉ). Đây là tín hiệu HIỂN THỊ: `reserve_machine` không từ chối máy offline; giao diện chỉ khoá nút thuê. Máy sang offline trong vài giây khi chủ máy dừng nhận thuê hoặc đăng xuất (agent gọi `POST /api/agent/offline` bằng credential thiết bị, chỉ xoá dấu thời gian heartbeat của đúng thiết bị đó); agent bị tắt cứng hoặc mất mạng thì chờ nhịp tim quá hạn (tới 90 giây). Lời báo offline không cấp thêm quyền nào: không có credential hợp lệ thì 401, và không đụng `last_counter` nên không mở đường replay.
- **Rủi ro còn lại:** tài khoản admin duy nhất hiện là tài khoản `Smoke admin` với mật khẩu do bộ kiểm tra sinh trong `desktop/.env.smoke.local` (tệp bị Git bỏ qua). Nên cấp role admin cho một tài khoản thật của người tổ chức rồi bỏ role của tài khoản smoke khi xong đợt thử.

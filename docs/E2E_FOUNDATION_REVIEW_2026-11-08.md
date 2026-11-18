# Review nền tích hợp feature 003 — 08/11/2026

Reviewer: Codex. Phạm vi: gateway, migration lịch/thiết bị, vỏ Tauri, tiến độ nối app và các kiểm tra repo. Không sửa source, migration, dependencies hoặc policy. Không commit/push/deploy/cài hệ thống. Chạy test/build có tạo output/cache thông thường; script tái hiện riêng nằm trong `.playwright-cli/` đang ignore Git.

## Kết luận

Có tiến triển thật ở phần nền: gateway HTTP/WebSocket local có test, schema lịch/enrollment/heartbeat và bộ khung native. Chưa phải app đã nối backend, chưa có stream Selkies thật, chưa có binary Tauri được build.

Ba findings cần xử lý dưới đây. Một finding tái hiện trực tiếp bằng PGlite; hai finding đồng thời được xác định từ đường code và cơ chế khóa, chưa chạy được nhiều connection trên Postgres thật. Không coi test tuần tự hoặc mutation test là bằng chứng loại trừ race.

## Findings

### [P1] Coverage guard chưa đồng bộ với transaction đặt máy

Vị trí: `supabase/migrations/20261108000001_schedule_devices.sql:12–34`.

`commitments_coverage_guard` chỉ SELECT bookings/commitments, không khóa dòng máy hoặc khóa chung với `reserve_machine`. Hàm reserve hiện khóa `machines` ở migration 2 dòng 201 nhưng đọc commitment thường ở dòng 217. Host cập nhật thời gian hoặc xóa commitment không cần lấy cùng khóa đó.

Interleaving ở READ COMMITTED: A reserve khóa máy, đọc commitment hợp lệ nhưng chưa commit booking; B host xóa/rút commitment, guard không nhìn thấy booking chưa commit của A và cho qua; A tạo/commit booking dựa trên commitment cũ. Cả hai có thể hoàn tất, booking sống không còn cam kết phủ. Partial unique booking index chỉ chống hai booking cùng máy, không bảo vệ coverage.

Sửa: serialize cả đặt máy lẫn sửa/xóa cam kết theo cùng machine lock hoặc cơ chế tương đương, với thứ tự khóa thống nhất và kiểm coverage sau khi có khóa. Thêm integration test hai connection thật có barrier để ép đúng thứ tự; khi chưa có Postgres thì giữ nhãn race chưa kiểm chứng thay vì kết luận đã chặn hoàn toàn. Đây là phân tích đường code, không phải race đã tái hiện trên DB thật trong lượt review này.

### [P2] machine_health được grant cho authenticated nhưng không gọi được

Vị trí: `supabase/migrations/20261108000001_schedule_devices.sql:184–194`, grant dòng 250.

Hàm SQL dùng quyền caller (không SECURITY DEFINER), nhưng truy vấn `device_enrollments`, bảng cố ý không cho authenticated SELECT. Host đã duyệt được cấp EXECUTE vẫn lỗi `permission denied for table device_enrollments`.

Tái hiện thật bằng harness PGlite hiện có: tạo host được duyệt và máy, chạy `select public.machine_health($1)` trong `as(db, {user: host}, ...)` -> lỗi trên. Cùng hàm dưới service_role trả `unknown` bình thường. Script review: `.playwright-cli/review-new-db.mjs`. Test hiện tại kiểm health bằng role đặc quyền nên bỏ lọt đường gọi host.

Sửa theo một trong hai mô hình rõ: (1) health chỉ gọi server/service_role, bỏ grant authenticated và cung cấp API lọc quyền; hoặc (2) hàm được bảo vệ kiểm tra actor/ownership và trả duy nhất trạng thái an toàn. Không cấp SELECT toàn bảng credential để chữa lỗi. Thêm test đúng role host và role không sở hữu máy.

### [P2] Trigger chống lịch chồng lấn chưa chống ghi đồng thời

Vị trí: `supabase/migrations/20261108000001_schedule_devices.sql:74–86`.

Trigger kiểm EXISTS trước INSERT/UPDATE, không có exclusion constraint hoặc khóa chung theo machine/weekday. Hai transaction có thể cùng không thấy lịch chưa commit của nhau rồi thêm hai khoảng chồng lấn. Test hiện tại ghi từng lệnh tuần tự nên chỉ bắt overlap khi dòng trước đã nhìn thấy.

Sửa bằng constraint PostgreSQL phù hợp hoặc serialize theo máy/ngày trước kiểm tra. Kiểm cả insert/insert và update/insert bằng nhiều connection. Tương tự finding 1, đây là suy ra từ code và mức cô lập dự kiến; chưa có DB thật để quan sát race.

## Kiểm tra Codex đã chạy

- `npm.cmd run typecheck`: PASS toàn repo, gồm workspace host-agent mới.
- `npm.cmd run lint`: PASS toàn repo.
- `npm.cmd test`: **146/146 PASS** = shared 13 + DB 47 + contracts 47 + desktop 30 + host-agent 9.
- `npm.cmd run build`: web PASS, 9 route; `npm.cmd run build:desktop`: PASS.
- Desktop JS vẫn 701.10 kB (gzip 214.82 kB), build có warning chunk lớn. Hardhat cũng có warning API network.connect deprecated. Các warning không làm các lệnh thất bại.
- `git diff --check`: PASS trên phần tracked diff. Không phải kiểm định dữ liệu thật hoặc audit bảo mật.
- Không tự lặp lại mutation experiments của Claude; việc chúng bắt được 5/4 biến đổi là báo cáo Claude, không phải bằng chứng mới do Codex thực hiện.

## Phần code hiện có và giới hạn

- Gateway: 9 test thực thi HTTP/WS với upstream giả; grant một lần, revoke và watchdog có test. Chưa có runtime enrollment/control-plane commands, chưa chứng minh với Selkies/TLS/WebView2/NAT thật. `allowedOrigins` mặc định chưa bắt buộc; khi có cấu hình runtime phải fail closed, không dùng mặc định test cho public deployment.
- DB: migration mới và 11 test lịch/thiết bị có thật, revoke PUBLIC EXECUTE và CHECK NULL đã có. Chưa nối `can_accept_new` vào reserve; đây là phần còn thiếu đã được ghi trong spec, không phải tính năng nhận thuê đã hoàn tất.
- Tauri: có Rust/config/capabilities/icon tối thiểu; chưa biên dịch do thiếu Rust/MSVC. `tauri info` đọc config không chứng minh app chạy. Chưa thử CSP/remote frame trong native.
- UI vẫn gọi mock/service; chưa có API/catalog/auth live, worker, chain indexer, remote_sessions/session_grants/incidents và workspace broker. Không thấy worker/ trong repo tại thời điểm review.
- Old finding đồng bộ đổi ví/đặt máy vẫn cần xử lý: consume_wallet_challenge và reserve_machine chưa có khóa user chung trong migrations đã đọc. Chưa kiểm concurrency DB thật; không coi đã đóng chỉ vì suite xanh.

## Bước tiếp đề nghị cho Claude

1. Sửa 3 findings trên, giữ tests fail trước/pass sau và phân biệt test thật với PGlite/stand-in.
2. Không chờ đủ mọi hạ tầng mới làm API contracts/service adapters, worker logic và WorkspaceStore local. Các phần này có thể tiếp tục local, ghi rõ chưa auth/storage/host thật. Chỉ đánh dấu phần thực sự phụ thuộc là blocked.
3. Khi tới phần tích hợp thật, cần chỉ định host/renter, Supabase/Postgres, Rust/MSVC và cấu hình Fuji theo đúng mốc; không cài hoặc công khai PC cá nhân từ báo cáo review này.
4. Giữ Q1 (cửa sổ lịch/commitment), Q2 (mạng/relay) và Q3 (activation vs grant) có trạng thái rõ. Q3 là mapping theo contract đã có, không tự đổi tiền để khớp mock.

Không kết luận “xong A–D” là “xong backend”: tasks hiện đánh dấu Tauri và schema một phần là phù hợp. Cần sửa các khẳng định quá rộng như cam kết không bị phá nếu chưa có bảo vệ/kiểm tra đồng thời.

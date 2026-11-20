# Cấu hình Supabase dev và áp dụng migrations

> **Lưu ý (19/11/2026):** các câu "chưa chạy lên database ngoài nào" và "5 migration" là trạng thái lúc viết (08/11). Hiện có **11 migration** trong `supabase/migrations/` (áp theo thứ tự tên file); 9 cái đầu đã áp lên project dev của nhóm. Cái thứ 10 `20261120000001_self_service_listing.sql` (bỏ admin duyệt host/máy/ghi danh) người dùng báo đã áp. Cái thứ 11 `20261120000002_admin_dashboard_availability.sql` (cột `availability` online thật cho danh mục công khai và hàm `admin_delete_machine` cho màn Quản trị) **chưa áp**: dán vào SQL Editor (chạy lặp lại được; app vẫn chạy trước khi áp, chỉ là nhãn online quay về "Chưa xác minh online" và nút Xóa báo lỗi) rồi chạy `supabase/verify/post_migration_checks.sql`, hàng **1–16** phải `true`. Chỗ dưới nói "1–14" là trạng thái trước các migration này. Các bước dưới vẫn đúng để dựng project của bạn; trạng thái hiện hành: [README mục 7C](../README.md#c-tự-dựng-toàn-bộ-hệ-thống).

Trạng thái: **hướng dẫn chuẩn bị, chưa chạy lên database ngoài nào** (08/11/2026). Chỉ dùng cho project **dev** do bạn tạo, không có dữ liệu thật. Không dán secret vào chat, Git, log hoặc ảnh chụp màn hình.

Migrations đã kiểm tra trên PGlite và trên PostgreSQL 18 thật chạy cục bộ (nhiều connection). **Chưa kiểm trên Supabase thật** — các bước dưới đây chính là lần đầu tiên, nên dừng ở lỗi đầu tiên và gửi nguyên văn thông báo lỗi.

## 0. Kiểm tra cục bộ trước khi áp dụng

```powershell
npm test -w @cpm/db-tests        # PGlite + Postgres thật cục bộ; phải xanh toàn bộ
npm run test -w @cpm/db-tests -- verify   # kiểm chính script kiểm tra sau-áp-dụng
.\scripts\supabase-migrations.ps1          # chỉ liệt kê 5 migration + SHA-256, không kết nối mạng
```

Ghi lại SHA-256 để sau này đối chiếu file đã áp dụng. Thứ tự (theo tên file): `20261107000001` schema lõi → `…02` hàm/trigger → `…03` RLS/grants → `20261108000001` lịch + thiết bị + guard cam kết → `…02` khoá theo user.

## 1. Giá trị cần lấy từ Supabase và nơi đặt

Tên menu trong dashboard có thể khác theo phiên bản; tìm theo từ khoá. Giá trị chính xác bạn chỉ xem trong dashboard của mình.

| Giá trị | Ở đâu trong dashboard | Nhạy cảm? | Đặt ở đâu |
|---|---|---|---|
| Project URL `https://<ref>.supabase.co` | Project Settings → API (hoặc Data API) | Không | `SUPABASE_URL` (server) và `VITE_SUPABASE_URL` (app) |
| Anon / publishable key | Project Settings → API Keys | Công khai (bị nhúng vào app) | `SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY` |
| Service-role / secret key | cùng trang | **Rất nhạy cảm** — vượt RLS | Chỉ biến môi trường **server** `SUPABASE_SERVICE_ROLE_KEY`; không bao giờ trong `VITE_*`, app, Git, chat |
| Mật khẩu database | Lúc tạo project / Project Settings → Database | **Rất nhạy cảm** | Chỉ trong chuỗi kết nối ở biến môi trường của phiên shell |
| Chuỗi kết nối Postgres | Project Settings → Database → Connection string (Direct / Session pooler) | **Có mật khẩu** | Biến `SUPABASE_DB_URL` trong phiên shell, không lưu file |

Ghi chú kết nối: theo tài liệu Supabase, kết nối *direct* dùng IPv6; nếu mạng của bạn chỉ có IPv4 hãy dùng chuỗi **Session pooler**. Transaction pooler cũng dùng được với migrations này vì chỉ dùng khoá mức transaction (`pg_advisory_xact_lock`), nhưng Session pooler/direct là lựa chọn an toàn hơn cho việc chạy file DDL.

## 2. Tạo file môi trường (không commit)

`.gitignore` đã bỏ qua `.env`, `.env.*` (trừ `*.example`). Kiểm tra: `git check-ignore -v .env.local desktop/.env.local`.

```powershell
Copy-Item .env.example .env.local                  # server/web: APP_MODE, SUPABASE_URL, SUPABASE_ANON_KEY
Copy-Item desktop\.env.example desktop\.env.local  # app: VITE_APP_MODE, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

Mở hai file bằng trình soạn thảo và điền URL + anon key. **Không** điền service-role key hay mật khẩu DB vào `desktop/.env.local` (mọi `VITE_*` bị nhúng vào bundle). `VITE_APP_MODE=preview` giữ app ở chế độ mock có nhãn; `live` chưa có adapter nên chưa bật.

Service-role key, khi tới bước cần (API/worker), đặt vào môi trường **của tiến trình server**, không vào repo.

## 3. Áp dụng migrations — chọn MỘT đường

Áp dụng lần lượt, **dừng khi có lỗi**; nếu một file lỗi giữa chừng, các file sau chưa được chạy. Mỗi file nên chạy trong một transaction (đường B và C đã làm sẵn).

**A. SQL Editor (không cần cài công cụ)**
1. `.\scripts\supabase-migrations.ps1 -Bundle "$env:TEMP\cpm-migrations.sql"` tạo file gộp UTF-8 không BOM (chưa chạy ở đâu).
2. Dashboard → SQL Editor → New query → dán **từng file** (hoặc cả file gộp nếu editor chịu được kích thước) → Run. Nên chạy từng file để biết chính xác file nào lỗi.
3. Lưu ý: cách này không ghi bảng `supabase_migrations`; không sao cho dev, nhưng sẽ lệch nếu sau này dùng CLI trên cùng project (khi đó nên reset project dev rồi dùng CLI từ đầu).

**B. psql qua script (cần cài `psql`; máy này chưa có)**
```powershell
$env:SUPABASE_DB_URL = "<dán chuỗi kết nối, chỉ trong cửa sổ này>"
.\scripts\supabase-migrations.ps1 -Apply -ProjectName "<tên project dev>"   # gõ lại tên để xác nhận
Remove-Item Env:SUPABASE_DB_URL
```
Script dừng ngay khi `psql` lỗi, không in chuỗi kết nối.

**C. Supabase CLI (cần cài CLI + Docker không bắt buộc cho `db push`)**
Chưa cài trên máy này; cài theo tài liệu chính thức của Supabase rồi: `supabase init` (tạo `supabase/config.toml`, không đụng `migrations/`), `supabase login`, `supabase link --project-ref <ref>`, `supabase db push --dry-run` để xem trước, rồi `supabase db push`. `login`/`link` hỏi token/mật khẩu DB ngay trong terminal của bạn.

## 4. Kiểm tra sau khi áp dụng

Chạy nguyên nội dung `supabase/verify/post_migration_checks.sql` trong SQL Editor (một câu SELECT chỉ đọc) và **gửi nguyên bảng kết quả**. Mọi dòng 1–14 phải `ok = true` (bản mở rộng; 15–16 là thông tin). Script kiểm: mọi bảng public có RLS; không hàm public nào cho PUBLIC/anon gọi; đúng 9 hàm cho `authenticated`; không quyền ghi của client lên bookings/outbox/roles/audit/config; có đủ trigger bảo vệ cam kết/lịch/booking; chỉ mục “một booking sống mỗi máy”; seed cấu hình; múi giờ `Asia/Ho_Chi_Minh`.

Nếu dòng nào `false`, **không sửa tay trên database**: gửi bảng kết quả để sửa migration và áp dụng lại trên project dev trống.

## 5. Auth tối thiểu và admin đầu tiên

1. Authentication → Providers: bật Email. Cho dev có thể tắt xác nhận email; ghi nhận đó là cấu hình dev, không phải production.
2. Đăng ký một tài khoản qua app/dashboard, lấy `User UID` ở Authentication → Users.
3. App phải tạo dòng `profiles` cho user (không có trigger tự tạo; `reserve_machine` yêu cầu profile `active`).
4. Cấp admin **bằng SQL Editor** (không có đường nào từ client để tự cấp role):
```sql
insert into public.user_roles (user_id, role) values ('<UUID admin>', 'admin');
```

## 6. Quay lại / làm lại

Project dev: nếu áp dụng sai, cách sạch nhất là dùng chức năng reset database trong dashboard (xoá toàn bộ dữ liệu, **chỉ dùng cho project dev trống**) rồi áp dụng lại từ file 1. Không chạy bất kỳ lệnh xoá/reset nào trên project có dữ liệu cần giữ.

## 7. Còn chưa được kiểm chứng sau khi áp dụng

- RLS và grants đã kiểm trên shim `auth.uid()` của PGlite/Postgres cục bộ; **JWT thật, PostgREST, GoTrue, pooler** chỉ được kiểm khi có project thật.
- Race đã kiểm trên Postgres cục bộ với hai connection (xem `db/tests/concurrency.test.ts`); chưa kiểm qua pooler/PostgREST của Supabase.
- App đã có chế độ live nối Supabase (đăng nhập, danh mục, giữ máy, đăng máy/cam kết/lịch); chưa có route API phía server, worker, ví/PCP, host-agent. Xem mục 9.

Khi bạn báo đã áp dụng và gửi kết quả bước 4, bước kế tiếp của writer là một bộ smoke test chỉ dùng anon key + hai tài khoản test (đọc catalog công khai; xác nhận client không đọc/ghi được bảng cấm), chạy đúng lệnh bạn cho phép.

## 8. Nếu lỡ lộ secret

Dashboard → xoay (rotate/regenerate) key hoặc đổi mật khẩu database ngay, cập nhật lại biến môi trường, và coi mọi thứ từng dùng key cũ là đã lộ. Với project dev trống, tạo lại project cũng được.

## 9. Điền môi trường → kiểm tra kết nối → chạy app ở chế độ live

Làm sau khi đã áp dụng migrations và bảng verify đạt (mục 4). Không bước nào cần dán mật khẩu hay service-role key vào chat.

**9.1 Lấy hai giá trị công khai.** Dashboard → Project Settings → API: sao chép *Project URL* (`https://<ref>.supabase.co`) và key **publishable** (hoặc *anon*). **Không** lấy key *secret* / *service_role*.

**9.2 Tạo file môi trường trên máy bạn** (cả hai file đã bị Git bỏ qua):
```powershell
Copy-Item desktop\.env.example desktop\.env.local
notepad desktop\.env.local        # đặt VITE_APP_MODE=live, dán URL và key publishable
Copy-Item .env.example .env.local
notepad .env.local                # dán SUPABASE_URL và SUPABASE_ANON_KEY (giữ APP_MODE=preview)
```
Mỗi dòng dạng `TÊN=giá trị`, không dấu cách quanh `=`, không dấu ngoặc.

**9.3 Kiểm tra file (không mạng, không in giá trị):**
```powershell
npm run check:env
```
Kỳ vọng: “Cấu hình hợp lệ”. Nếu báo key là SECRET/service_role thì xóa khỏi file và **xoay key** trong dashboard.

**9.4 Tắt xác nhận email cho môi trường dev** (để tài khoản test tự đăng nhập được): Authentication → Providers → Email → tắt *Confirm email*. Smoke test sẽ tự dừng, không tạo tài khoản, nếu bước này chưa làm.

**9.5 Chạy smoke test với project dev thật:**
```powershell
npm run smoke:supabase
```
Lần đầu nó tạo 4 tài khoản test (email `cpm-smoke-…@example.com`, mật khẩu ngẫu nhiên lưu ở `desktop/.env.smoke.local`, không in ra), rồi **dừng (test đỏ, không phải xanh) và in tối đa 3 câu SQL** cần chạy trong SQL Editor: 1 câu cấp role admin cho tài khoản admin test và 1 câu gắn **địa chỉ ví giả (dev)** cho mỗi renter test (2 renter) — client không có đường nào tự làm các việc này. Số câu in ra bằng số thứ còn thiếu (lần đầu: 3; câu nào đã chạy rồi sẽ không in lại). Chạy SQL, rồi chạy lại `npm run smoke:supabase`. Quy tắc kết quả: **không có test nào bị skip** — thiếu cấu hình, còn bật xác nhận email, thiếu role/ví đều làm test tương ứng ĐỎ kèm lý do; xanh nghĩa là bước đó thật sự đã chạy. Gửi nguyên đầu ra (không chứa secret). Dữ liệu `smoke-*` còn lại trên project dev (client không xóa được) — vô hại; muốn dọn thì reset project dev.

**9.6 Chạy app ở chế độ live:** dừng dev server cũ (Vite chỉ đọc `.env` lúc khởi động), rồi:
```powershell
npm run dev:desktop     # http://127.0.0.1:5174 (chế độ live: chip "Testnet" ở thanh trên)
```
Đăng ký/đăng nhập thật, chọn Thuê máy → Khám phá (danh mục thật; nếu trống, chưa có máy nào được duyệt — smoke test hoặc chế độ Cho thuê sẽ tạo) → Giữ máy. Chế độ Cho thuê: đăng ký host (**tự động được duyệt** sau migration `20261120000001_self_service_listing.sql`; trước migration này thì phải chờ admin qua RPC `review_host`) → tạo máy → Quét & đăng máy (máy hiện ngay, không admin) → cam kết, lịch → ghi danh thiết bị.

Nếu cấu hình sai khi `VITE_APP_MODE=live`, app hiện màn lỗi cấu hình và **không** rơi về dữ liệu mẫu.

## 10. Migration 000003–000006 và kiểm tra sau áp dụng

Trạng thái 08/11/2026: bạn báo đã áp dụng `20261108000003` (sự kiện chuỗi, outbox có lease), `…04` (workspace), `…05` (kênh host-agent) bằng SQL Editor. **Claude đã thăm dò bằng API (chỉ đọc, anon + một tài khoản smoke có sẵn)**: `node scripts/probe-supabase-migrations.mjs` → 62/62 đạt: 7 bảng và 21 hàm mới tồn tại và bị chặn đúng mã `42501` cho cả anon lẫn authenticated; `bookings.started_at/end_at` đọc được; `workspaces`, `workspace_versions` đọc được qua RLS owner (0 dòng); client không tự INSERT được workspaces. Đây là bằng chứng *từ phía API*, **chưa phải** kết quả `post_migration_checks.sql` — bước đó vẫn cần bạn chạy.

**Trạng thái 09/11/2026: bước 1–2 bên dưới ĐÃ XONG** (người dùng áp dụng 000006 bằng SQL Editor và dán kết quả: hàng 1–14 đều `true`, PostgreSQL 17.11, số migration CLI ghi nhận = 0 vì áp dụng tay). Vì không có bản ghi migration phía Supabase, nếu sau này dùng `supabase db push` trên project này sẽ lệch: khi đó reset project dev rồi dùng CLI từ đầu, hoặc đánh dấu migration đã áp dụng một cách có chủ ý. Phần còn mở: `web/.env.local` + `smoke:server` (xem `docs/DEMO_RUNBOOK.md` mục 2.6).

**Việc đã làm (theo thứ tự, không reset dữ liệu smoke) — giữ để tham khảo/dựng project mới:**
1. Áp dụng thêm **`20261108000006_revoke_sequence_grants.sql`** (vá nhỏ: gỡ quyền anon/authenticated trên các sequence mới `chain_events_id_seq`, `agent_commands_id_seq`; không khai thác trực tiếp được nhưng kiểm tra mới sẽ báo). Chỉ file này, trong SQL Editor.
2. Chạy lại **`supabase/verify/post_migration_checks.sql`** (đã mở rộng: hàng 1–14 phải `ok = true`, 15–16 là thông tin) rồi dán nguyên bảng kết quả. Trước khi áp dụng 000006, hàng 14 sẽ `false` với `chain_events_id_seq, agent_commands_id_seq` — đó là điều đúng.
3. Nếu thăm dò báo `PGRST205/PGRST202` sau khi đã áp dụng: SQL Editor → `NOTIFY pgrst, 'reload schema';` rồi chạy lại thăm dò (đây là lệnh an toàn, không phải DDL).

Từ nay server/worker nối bằng chuỗi kết nối Postgres đặt ở biến môi trường server (`SUPABASE_DB_URL` trong `web/.env.local`), **không** phải service-role key REST và không đặt trong `desktop/.env*`. Chạy `npm run smoke:server -w @cpm/server` để kiểm server trên Supabase thật (cần `web/.env.local`; xem `docs/DEMO_RUNBOOK.md`).

### Cách nhanh (không cần SQL Editor, không cần psql)
Sau khi bạn điền `SUPABASE_DB_URL` vào `web/.env.local` (một lần; file bị Git bỏ qua), Claude có thể chạy giúp bằng thư viện `pg` của Node:
```powershell
node scripts/db-run.mjs verify                                          # chỉ đọc: in bảng kiểm 1–14
node scripts/db-run.mjs apply 20261108000006_revoke_sequence_grants.sql --yes   # đúng MỘT file đã duyệt, một transaction
```
Rào chắn: chỉ file trong danh sách cho phép **và** đúng SHA-256 đã duyệt; thiếu `--yes` thì không làm gì; không `db push`, không reset; lỗi thì rollback; không bao giờ in chuỗi kết nối/mật khẩu/host (đã kiểm bằng test với mật khẩu giả). Nếu Node báo lỗi chuỗi chứng chỉ: đặt `SUPABASE_DB_CA=<file PEM>` trong cùng file.

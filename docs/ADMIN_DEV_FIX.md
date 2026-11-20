# Sửa tài khoản admin của Supabase dev (khi `admin.mts` hoặc `issue-enrollment.mts` báo đăng nhập admin thất bại)

> **Cập nhật 20/11/2026: có màn Quản trị trong app (thay terminal).** Đăng nhập app bằng một tài khoản có role admin rồi chọn **Quản trị** ở thanh bên (chế độ live). Nếu chưa có tài khoản admin nào bạn đăng nhập được (admin hiện có là tài khoản `Smoke admin`, mật khẩu do bộ kiểm tra sinh ngẫu nhiên và nằm trong `desktop\.env.smoke.local`), cấp role admin cho TÀI KHOẢN CỦA BẠN bằng câu SQL "Cấp vai trò admin" bên dưới (thay email), rồi đăng xuất và đăng nhập lại để app đọc role mới. Phần còn lại của tài liệu này chỉ cần khi dùng script `admin.mts`.

> **Đã giải quyết 18/11/2026.** Nguyên nhân thật: `Invalid API key` do **chú thích cùng dòng** trong `desktop/.env.local` (dạng `VITE_SUPABASE_ANON_KEY=… # ghi chú`) bị script đọc luôn vào giá trị khoá. Các script cũ trong `scripts/vm/` đã bỏ chú thích cùng dòng (`.split(/\s#/)[0]`); riêng hai script mới `scripts/public/admin.mts` và `fuji-rental-check.mts` bỏ sót, nay đã sửa. Sau khi sửa, `admin.mts pending` chạy được (liệt kê 2 host chờ duyệt, 0 máy chờ duyệt) và `admin.mts enroll` cấp được mã ghi danh. Tài liệu bên dưới giữ lại cho trường hợp lỗi khác.

Cần tài khoản admin để: duyệt host/máy và cấp **mã ghi danh** cho host (không có mã này agent trong WSL2 không ghi danh được). Ghi 17/11/2026: `npx tsx scripts/public/admin.mts pending` trả `Đăng nhập admin thất bại (HTTP 401)`; công cụ của tôi bị hệ thống chặn khi đăng nhập bằng thông tin lưu sẵn nên **bạn tự chạy lệnh dưới đây** (tiền tố `!` để chạy trong phiên Claude Code, hoặc chạy ở PowerShell):

```powershell
cd "C:\Users\ADMIN\OneDrive\เอกสาร\Coding\Unihack"
npx tsx scripts/public/admin.mts pending
```

Lệnh in mã HTTP và thông báo của Supabase (không in mật khẩu/khoá). Làm theo dòng khớp với kết quả:

| Kết quả | Nghĩa | Cách sửa |
|---|---|---|
| `HTTP 400 … invalid_credentials` | Tài khoản `SMOKE_ADMIN_EMAIL` không tồn tại hoặc mật khẩu đã đổi | Supabase Dashboard → **Authentication → Users**. Nếu có user đó: menu `…` → **Send password recovery** hoặc đặt lại mật khẩu; nếu không: **Add user → Create new user**, đánh dấu **Auto Confirm User**. Rồi sửa `SMOKE_ADMIN_EMAIL`/`SMOKE_ADMIN_PASSWORD` trong `desktop\.env.smoke.local` |
| `HTTP 401` và chữ `Invalid API key` / `No API key found` | Khoá công khai trong `desktop\.env.local` đã bị xoay hoặc sai | Dashboard → **Project Settings → API** (hoặc **API Keys**), chép khoá **anon / publishable** (KHÔNG phải `service_role` hay `sb_secret_`) vào `VITE_SUPABASE_ANON_KEY` trong `desktop\.env.local` |
| Đăng nhập được nhưng `pending` báo `Không đọc được danh sách (HTTP 403/…)` hoặc rỗng bất thường | Tài khoản chưa có vai trò admin | Dashboard → **SQL Editor**, chạy câu SQL bên dưới (thay email) |
| `HTTP 429` | Bị giới hạn tần suất đăng nhập | Đợi vài phút rồi chạy lại |

Cấp vai trò admin (chạy trong SQL Editor, quyền chủ project; bảng `user_roles` chỉ ghi được từ server/SQL):

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'EMAIL_ADMIN_CUA_BAN'
on conflict do nothing;

-- kiểm lại: phải thấy dòng admin
select u.email, r.role from public.user_roles r join auth.users u on u.id = r.user_id;
```

Muốn dùng một tài khoản MỚI làm admin: đăng ký nó (trong app hoặc **Add user**), chạy SQL trên với email đó, rồi điền email/mật khẩu vào `SMOKE_ADMIN_EMAIL`/`SMOKE_ADMIN_PASSWORD` ở `desktop\.env.smoke.local`.

Sau khi `pending` in được danh sách:

```powershell
npx tsx scripts/public/admin.mts approve-host <userId>
npx tsx scripts/public/admin.mts approve-machine <machineId>
npx tsx scripts/public/admin.mts enroll <machineId> C:\cpm-demo\enroll-token.txt      # mã dùng một lần, ghi vào tệp, không in
```

Chỉ duyệt bằng SQL (không cần đăng nhập admin) làm được host/máy nhưng **không** cấp được mã ghi danh (cần API `POST /api/admin/enrollments` với JWT admin):

```sql
update public.host_profiles set status = 'approved', reviewed_at = now() where user_id = 'UUID_HOST';
update public.machines      set status = 'approved'                       where id      = 'UUID_MAY';
```

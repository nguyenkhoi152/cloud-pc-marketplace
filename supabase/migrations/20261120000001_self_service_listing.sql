-- Tự đăng máy: bỏ bước admin duyệt host và duyệt máy (quyết định của chủ dự án 20/11/2026, tạm thời cho bản thử).
--
-- Trước: host đăng ký -> admin duyệt host -> host tạo máy -> gửi duyệt -> admin duyệt máy -> admin cấp mã ghi danh.
-- Nay:   host đăng ký (tự động approved) -> tạo máy -> "Đăng máy" (submit_machine_for_review) => approved ngay.
--
-- Admin KHÔNG còn là cổng, nhưng vẫn là phanh khẩn cấp: review_host(..., 'suspended') và review_machine(..., 'suspended') còn nguyên.
-- host_profiles 'suspended' không tự gỡ được (client không có UPDATE/DELETE); machines 'suspended' không đăng lại được
-- (submit_machine_for_review chỉ nhận draft/review).
--
-- LƯU Ý AN TOÀN: việc "quét máy đủ điều kiện" do app Windows làm (lớp native), máy chủ KHÔNG tự kiểm chứng được. Ở DB chỉ có kiểm tra
-- tối thiểu về dữ liệu (cores/ramGb hợp lệ). Hệ quả: bất kỳ tài khoản nào cũng đăng được máy hiển thị cho mọi người thuê.

-- ---------------------------------------------------------------- 1. Host tự động approved
alter table public.host_profiles alter column status set default 'approved';
alter policy host_profiles_insert on public.host_profiles
  with check (user_id = auth.uid() and status = 'approved');
-- Client chỉ có quyền INSERT cột user_id (xem migration 3), nên không tự đặt được status khác.
update public.host_profiles
   set status = 'approved', reviewed_at = coalesce(reviewed_at, now())
 where status = 'pending';

-- ---------------------------------------------------------------- 2. Sửa thông số không còn đẩy máy về "review"
-- Trigger cũ hạ máy approved về review khi sửa declared_specs. Không còn ai duyệt lại, nên máy sẽ kẹt vĩnh viễn: bỏ.
drop trigger if exists machines_spec_change on public.machines;
drop function if exists public.machines_spec_change();

-- ---------------------------------------------------------------- 3. Đăng máy = approved ngay
-- Giữ tên hàm submit_machine_for_review (quyền thực thi và client cũ không đổi); nghĩa của nó nay là "đăng".
create or replace function public.submit_machine_for_review(p_machine uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_specs jsonb;
begin
  if auth.uid() is null or not public.is_approved_host(auth.uid()) then raise exception 'forbidden'; end if;
  select declared_specs into v_specs
    from public.machines
   where id = p_machine and owner_id = auth.uid() and status in ('draft', 'review')
     for update;
  if not found then raise exception 'unavailable'; end if;
  if jsonb_typeof(v_specs) is distinct from 'object'
     or jsonb_typeof(v_specs -> 'cores') is distinct from 'number' or (v_specs ->> 'cores')::numeric < 1
     or jsonb_typeof(v_specs -> 'ramGb') is distinct from 'number' or (v_specs ->> 'ramGb')::numeric < 1 then
    raise exception 'invalid_request';
  end if;
  update public.machines set status = 'approved' where id = p_machine;
  insert into public.audit_logs (actor, action, resource, outcome)
  values (auth.uid(), 'publish_machine', 'machine:' || p_machine, 'ok');
end $$;

-- Máy đang chờ duyệt từ trước: đăng luôn (không còn ai duyệt).
update public.machines set status = 'approved' where status = 'review';

-- ---------------------------------------------------------------- 4. Chủ máy tự ghi danh thiết bị của MÁY MÌNH
-- Trước: chỉ admin tạo mã ghi danh / thu hồi thiết bị. Không có bước này thì host từ xa vẫn phải nhờ admin và máy đã đăng không phục vụ được.
-- Nay: admin HOẶC chủ máy (host còn approved) làm được cho máy của chính họ. Giữ nguyên chữ ký và tên tham số p_admin (nghĩa là "người gọi").
-- Hàm vẫn CHỈ service_role gọi được (server truyền id người dùng đã xác thực); quyền thật do hàm này kiểm, không tin client.
create or replace function public.create_enrollment(p_admin uuid, p_machine uuid, p_token_hash bytea, p_ttl_seconds integer)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not (
    public.is_admin(p_admin)
    or exists (select 1 from public.machines m where m.id = p_machine and m.owner_id = p_admin and public.is_approved_host(p_admin))
  ) then raise exception 'forbidden'; end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 60 and 3600 then raise exception 'invalid_request'; end if;
  if not exists (select 1 from public.machines where id = p_machine and status = 'approved') then raise exception 'unavailable'; end if;
  -- Enrollment cũ chưa dùng bị thay; thiết bị đã enroll phải thu hồi tường minh (revoke_device) trước.
  update public.device_enrollments set revoked_at = now()
   where machine_id = p_machine and revoked_at is null and enrolled_at is null;
  begin
    insert into public.device_enrollments (machine_id, token_hash, expires_at, created_by)
    values (p_machine, p_token_hash, now() + make_interval(secs => p_ttl_seconds), p_admin) returning id into v_id;
  exception when unique_violation then
    raise exception 'unavailable';
  end;
  insert into public.audit_logs (actor, action, resource, outcome) values (p_admin, 'create_enrollment', 'machine:' || p_machine, 'ok');
  return v_id;
end $$;

create or replace function public.revoke_device(p_admin uuid, p_machine uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (
    public.is_admin(p_admin)
    or exists (select 1 from public.machines m where m.id = p_machine and m.owner_id = p_admin and public.is_approved_host(p_admin))
  ) then raise exception 'forbidden'; end if;
  update public.device_enrollments set revoked_at = now() where machine_id = p_machine and revoked_at is null;
  insert into public.audit_logs (actor, action, resource, outcome) values (p_admin, 'revoke_device', 'machine:' || p_machine, 'ok');
end $$;

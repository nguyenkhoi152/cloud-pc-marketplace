-- Feature 003 / M-D: lịch availability của host, nhận/tạm nghỉ, enrollment + heartbeat thiết bị,
-- và chốt chặn: host không được sửa/xoá cam kết làm mất coverage của booking đang sống.
-- Múi giờ demo cố định Asia/Ho_Chi_Minh; mỗi cửa sổ lưu theo phút trong ngày, quy ra UTC khi tính.

-- ---------------------------------------------------------------- 0. Ghi chú về quyền EXECUTE
-- Hàm mới mặc định cho PUBLIC gọi (`alter default privileges in schema ... revoke` ở migration 3 không gỡ được).
-- Migration này KHÔNG đổi default privileges toàn cục (tránh ảnh hưởng nền tảng được quản lý); thay vào đó revoke tường
-- minh từng hàm ở cuối file, và test `mọi hàm public` (db/tests/rls.test.ts) bắt hàm nào bị bỏ sót.

-- ---------------------------------------------------------------- 1. Coverage guard
-- Serialize sửa/xoá cam kết với reserve_machine bằng CÙNG khoá dòng `machines` (reserve_machine khoá dòng này trước khi
-- đọc cam kết). Thứ tự khoá: (user, nếu có) -> machines -> không khoá nào khác, nên không có chu trình.
-- BEFORE: lấy khoá trước khi thay đổi. AFTER: kiểm coverage SAU khi đã giữ khoá (thấy booking đã commit của reserve khác).
-- SECURITY DEFINER để khoá/đọc không bị RLS của người gọi làm lệch (host bị suspend vẫn bị serialize).
-- Booking còn sống cần một commitment phủ [created_at, activate_by + duration + recovery].
create function public.commitments_machine_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.machines
   where id in (old.machine_id, case when tg_op = 'UPDATE' then new.machine_id end)
   order by id for update;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger host_commitments_lock before update or delete on public.host_commitments
  for each row execute function public.commitments_machine_lock();

create function public.commitments_coverage_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_machine uuid := coalesce(old.machine_id, new.machine_id);
  v_recovery integer;
  v_b record;
begin
  select recovery_buffer_seconds into v_recovery from public.contract_config;
  for v_b in
    select b.id, b.created_at,
           b.activate_by + make_interval(secs => b.duration_seconds + v_recovery) as need_until
      from public.bookings b
     where b.machine_id = v_machine and public.booking_is_live(b.state, b.access_state)
  loop
    if not exists (
      select 1 from public.host_commitments c
       where c.machine_id = v_machine and c.starts_at <= v_b.created_at and c.ends_at >= v_b.need_until
    ) then
      raise exception 'commitment_in_use' using detail = 'booking ' || v_b.id;
    end if;
  end loop;
  return null;
end $$;
create trigger host_commitments_coverage after update or delete on public.host_commitments
  for each row execute function public.commitments_coverage_guard();

-- ---------------------------------------------------------------- 2. Lịch availability
create table public.host_schedule_rules (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Thứ Hai
  start_minute integer not null check (start_minute between 0 and 1425 and start_minute % 15 = 0),
  end_minute integer not null check (end_minute between 15 and 1440 and end_minute % 15 = 0),
  created_at timestamptz not null default now(),
  constraint rule_order check (end_minute > start_minute),
  constraint rule_min_30 check (end_minute - start_minute >= 30) -- không có khung qua nửa đêm: tách khung
);
create index host_schedule_rules_idx on public.host_schedule_rules (machine_id, weekday);

create table public.host_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines (id) on delete cascade,
  on_date date not null,
  kind text not null check (kind in ('skip', 'custom')),
  start_minute integer,
  end_minute integer,
  created_at timestamptz not null default now(),
  unique (machine_id, on_date),
  constraint exc_shape check (
    (kind = 'skip' and start_minute is null and end_minute is null)
    or (kind = 'custom' and start_minute is not null and end_minute is not null
        and start_minute between 0 and 1425 and start_minute % 15 = 0
        and end_minute between 15 and 1440 and end_minute % 15 = 0 and end_minute - start_minute >= 30)
  )
);

-- Nhận/tạm nghỉ do host chọn; lịch không bao giờ tự bật nguồn máy hay ghi đè việc tạm nghỉ.
create table public.machine_availability (
  machine_id uuid primary key references public.machines (id) on delete cascade,
  accepting boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Serialize ghi lịch theo máy bằng advisory lock theo transaction rồi mới kiểm chồng lấn (đọc lại sau khi có khoá,
-- nên thấy khung đã commit của transaction khác). Update đổi máy: khoá cả hai máy theo thứ tự cố định.
create function public.schedule_rules_overlap_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare k text;
begin
  for k in
    select distinct 'schedule:' || x::text from (values (new.machine_id), (case when tg_op = 'UPDATE' then old.machine_id end)) v(x)
     where x is not null order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(k, 0));
  end loop;
  if exists (
    select 1 from public.host_schedule_rules r
     where r.machine_id = new.machine_id and r.weekday = new.weekday and r.id <> new.id
       and r.start_minute < new.end_minute and new.start_minute < r.end_minute
  ) then
    raise exception 'schedule_overlap';
  end if;
  return new;
end $$;
create trigger host_schedule_rules_overlap before insert or update on public.host_schedule_rules
  for each row execute function public.schedule_rules_overlap_guard();

-- Các lần mở thực tế (UTC) trong [p_from, p_to] theo giờ Asia/Ho_Chi_Minh; ngoại lệ thay/bỏ luật của ngày đó.
create function public.schedule_windows(p_machine uuid, p_from date, p_to date)
returns table (day date, starts_at timestamptz, ends_at timestamptz)
language sql stable set search_path = public, pg_temp as $$
  with days as (select d::date as day from generate_series(p_from, p_to, interval '1 day') d),
  base as (
    select d.day, r.start_minute, r.end_minute
      from days d
      join public.host_schedule_rules r on r.machine_id = p_machine and r.weekday = extract(isodow from d.day)::int - 1
     where not exists (select 1 from public.host_schedule_exceptions e where e.machine_id = p_machine and e.on_date = d.day)
    union all
    select e.on_date, e.start_minute, e.end_minute
      from public.host_schedule_exceptions e
     where e.machine_id = p_machine and e.on_date between p_from and p_to and e.kind = 'custom'
  )
  select day,
         (day::timestamp + make_interval(mins => start_minute)) at time zone 'Asia/Ho_Chi_Minh',
         (day::timestamp + make_interval(mins => end_minute)) at time zone 'Asia/Ho_Chi_Minh'
    from base order by 1, 2
$$;

-- ---------------------------------------------------------------- 3. Enrollment + heartbeat thiết bị
-- Token enrollment và credential chỉ lưu băm (SHA-256 do server tính); không bảng nào cho client.
create table public.device_enrollments (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines (id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users (id),
  enrolled_at timestamptz,
  credential_hash bytea unique check (credential_hash is null or octet_length(credential_hash) = 32),
  revoked_at timestamptz,
  last_counter bigint not null default 0,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  constraint enrolled_has_credential check ((enrolled_at is null) = (credential_hash is null))
);
-- Một thiết bị đang hiệu lực (chưa thu hồi) cho mỗi máy.
create unique index device_enrollments_one_active on public.device_enrollments (machine_id) where revoked_at is null;

create function public.create_enrollment(p_admin uuid, p_machine uuid, p_token_hash bytea, p_ttl_seconds integer)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not public.is_admin(p_admin) then raise exception 'forbidden'; end if;
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

-- Dùng một lần, trong hạn, chưa thu hồi; nguyên tử.
create function public.redeem_enrollment(p_token_hash bytea, p_credential_hash bytea)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_machine uuid;
begin
  update public.device_enrollments
     set enrolled_at = now(), credential_hash = p_credential_hash
   where token_hash = p_token_hash and enrolled_at is null and revoked_at is null and expires_at > now()
  returning machine_id into v_machine;
  if v_machine is null then raise exception 'invalid_enrollment'; end if;
  insert into public.audit_logs (actor, action, resource, outcome) values (null, 'redeem_enrollment', 'machine:' || v_machine, 'ok');
  return v_machine;
end $$;

create function public.revoke_device(p_admin uuid, p_machine uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(p_admin) then raise exception 'forbidden'; end if;
  update public.device_enrollments set revoked_at = now() where machine_id = p_machine and revoked_at is null;
  insert into public.audit_logs (actor, action, resource, outcome) values (p_admin, 'revoke_device', 'machine:' || p_machine, 'ok');
end $$;

-- Heartbeat: counter phải tăng nghiêm ngặt (chống replay); thiết bị chưa enroll/đã thu hồi bị từ chối.
create function public.record_heartbeat(p_credential_hash bytea, p_counter bigint)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_machine uuid;
begin
  update public.device_enrollments
     set last_counter = p_counter, last_heartbeat_at = now()
   where credential_hash = p_credential_hash and revoked_at is null and enrolled_at is not null and p_counter > last_counter
  returning machine_id into v_machine;
  if v_machine is null then raise exception 'invalid_heartbeat'; end if;
  return v_machine;
end $$;

-- Sức khoẻ: ok ≤30s, suspect >30s, incident >90s; unknown nếu chưa từng có heartbeat hoặc đã thu hồi.
create function public.machine_health(p_machine uuid, p_now timestamptz default now()) returns text
language sql stable set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when d.last_heartbeat_at is null then 'unknown'
      when p_now - d.last_heartbeat_at <= interval '30 seconds' then 'ok'
      when p_now - d.last_heartbeat_at <= interval '90 seconds' then 'suspect'
      else 'incident' end
    from public.device_enrollments d where d.machine_id = p_machine and d.revoked_at is null and d.enrolled_at is not null
  ), 'unknown')
$$;

-- Client (host chủ máy / admin) chỉ nhận trạng thái an toàn qua hàm này; không có SELECT trên device_enrollments.
create function public.my_machine_health(p_machine uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.machines m where m.id = p_machine and (m.owner_id = auth.uid() or public.is_admin(auth.uid()))
  ) then
    raise exception 'forbidden';
  end if;
  return public.machine_health(p_machine, now());
end $$;

-- Điều kiện nhận phiên mới (chưa gắn vào reserve_machine — chờ quyết định Q1 trong spec 003):
-- approved ∧ host approved ∧ accepting ∧ agent sống ∧ trong cửa sổ phủ đủ thời gian ∧ không có booking sống.
create function public.can_accept_new(p_machine uuid, p_now timestamptz, p_need_seconds integer) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.machines m
     where m.id = p_machine and m.status = 'approved' and public.is_approved_host(m.owner_id)
       and coalesce((select a.accepting from public.machine_availability a where a.machine_id = m.id), false)
       and public.machine_health(m.id, p_now) = 'ok'
       and m.active_booking_id is null
       and not exists (select 1 from public.bookings b where b.machine_id = m.id and public.booking_is_live(b.state, b.access_state))
       and exists (
         select 1 from public.schedule_windows(m.id, ((p_now at time zone 'Asia/Ho_Chi_Minh')::date), ((p_now at time zone 'Asia/Ho_Chi_Minh')::date)) w
          where w.starts_at <= p_now and w.ends_at >= p_now + make_interval(secs => p_need_seconds)
       )
  )
$$;

-- ---------------------------------------------------------------- 4. RLS và grants
alter table public.host_schedule_rules enable row level security;
alter table public.host_schedule_exceptions enable row level security;
alter table public.machine_availability enable row level security;
alter table public.device_enrollments enable row level security;

grant all on public.host_schedule_rules, public.host_schedule_exceptions, public.machine_availability,
  public.device_enrollments to service_role;

grant select, insert (machine_id, weekday, start_minute, end_minute), update (weekday, start_minute, end_minute), delete
  on public.host_schedule_rules to authenticated;
create policy schedule_rules_all on public.host_schedule_rules for all to authenticated
  using (exists (select 1 from public.machines m where m.id = machine_id and m.owner_id = auth.uid()))
  with check (public.is_approved_host(auth.uid())
    and exists (select 1 from public.machines m where m.id = machine_id and m.owner_id = auth.uid()));

grant select, insert (machine_id, on_date, kind, start_minute, end_minute), update (on_date, kind, start_minute, end_minute), delete
  on public.host_schedule_exceptions to authenticated;
create policy schedule_exceptions_all on public.host_schedule_exceptions for all to authenticated
  using (exists (select 1 from public.machines m where m.id = machine_id and m.owner_id = auth.uid()))
  with check (public.is_approved_host(auth.uid())
    and exists (select 1 from public.machines m where m.id = machine_id and m.owner_id = auth.uid()));

grant select, insert (machine_id, accepting), update (accepting) on public.machine_availability to authenticated;
create policy availability_all on public.machine_availability for all to authenticated
  using (exists (select 1 from public.machines m where m.id = machine_id and m.owner_id = auth.uid()))
  with check (public.is_approved_host(auth.uid())
    and exists (select 1 from public.machines m where m.id = machine_id and m.owner_id = auth.uid()));
-- device_enrollments: không grant/policy cho client.

revoke all on function public.commitments_machine_lock(), public.commitments_coverage_guard(), public.schedule_rules_overlap_guard(),
  public.schedule_windows(uuid, date, date), public.machine_health(uuid, timestamptz), public.my_machine_health(uuid),
  public.can_accept_new(uuid, timestamptz, integer), public.create_enrollment(uuid, uuid, bytea, integer),
  public.redeem_enrollment(bytea, bytea), public.revoke_device(uuid, uuid), public.record_heartbeat(bytea, bigint)
  from public, anon, authenticated, service_role;

grant execute on function public.schedule_windows(uuid, date, date), public.my_machine_health(uuid) to authenticated, service_role;
-- machine_health đọc device_enrollments: chỉ server (hàm nội bộ cho can_accept_new/worker).
grant execute on function public.machine_health(uuid, timestamptz) to service_role;
grant execute on function public.can_accept_new(uuid, timestamptz, integer),
  public.create_enrollment(uuid, uuid, bytea, integer),
  public.redeem_enrollment(bytea, bytea),
  public.revoke_device(uuid, uuid),
  public.record_heartbeat(bytea, bigint) to service_role;

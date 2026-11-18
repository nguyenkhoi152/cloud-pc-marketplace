-- Feature 003 / M-C, M-D: kênh điều khiển worker → host-agent (agent chủ động kéo lệnh; không mở cổng vào máy host)
-- và cấp quyền xem một lần cho renter. Agent chỉ nhận tập lệnh CỐ ĐỊNH; không có shell/đường dẫn/URL/port từ renter.
-- Mọi hàm chỉ cho service_role (server nối Postgres rồi set role).

create table public.agent_commands (
  id bigint generated always as identity primary key,
  machine_id uuid not null references public.machines (id),
  booking_id uuid not null references public.bookings (id),
  base_action text not null, -- ví dụ 'revoke:<booking>' (idempotency theo booking/hành động)
  attempt integer not null default 1,
  command text not null check (command in ('prepare', 'grant', 'revoke', 'reset', 'verify_reset')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'done', 'failed')),
  lease_until timestamptz,
  ok boolean,
  unknown boolean,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (base_action, attempt)
);
create index agent_commands_poll_idx on public.agent_commands (machine_id, id) where status in ('pending', 'delivered');

-- Xếp lệnh idempotent: lệnh đang chờ/đang chạy hoặc đã thành công thì dùng lại; thất bại/không thành công thì tạo lần thử mới.
create function public.agent_enqueue_command(p_booking uuid, p_base_action text, p_command text, p_payload jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_machine uuid; v_last public.agent_commands; v_id bigint;
begin
  select machine_id into v_machine from public.bookings where id = p_booking;
  if v_machine is null then raise exception 'unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agentcmd:' || p_base_action, 0));
  select * into v_last from public.agent_commands where base_action = p_base_action order by attempt desc limit 1;
  if found and (v_last.status in ('pending', 'delivered') or (v_last.status = 'done' and v_last.ok is true)) then return v_last.id; end if;
  insert into public.agent_commands (machine_id, booking_id, base_action, attempt, command, payload)
  values (v_machine, p_booking, p_base_action, coalesce(v_last.attempt, 0) + 1, p_command, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

-- Thiết bị (credential còn hiệu lực) nhận lệnh của CHÍNH máy mình; lệnh đã giao mà quá lease thì giao lại.
create function public.agent_poll(p_credential_hash bytea, p_limit integer, p_lease_seconds integer)
returns setof public.agent_commands language plpgsql security definer set search_path = public, pg_temp as $$
declare v_machine uuid;
begin
  select machine_id into v_machine from public.device_enrollments where credential_hash = p_credential_hash and revoked_at is null and enrolled_at is not null;
  if v_machine is null then raise exception 'invalid_credential'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 or p_lease_seconds is null or p_lease_seconds < 5 then raise exception 'invalid_request'; end if;
  return query
    update public.agent_commands c set status = 'delivered', lease_until = now() + make_interval(secs => p_lease_seconds)
     where c.id in (
       select id from public.agent_commands
        where machine_id = v_machine and (status = 'pending' or (status = 'delivered' and lease_until < now()))
        order by id limit p_limit for update skip locked)
    returning c.*;
end $$;

-- Thiết bị báo kết quả; chỉ máy sở hữu lệnh, chỉ khi đang 'delivered'. Báo lại cùng lệnh đã xong là no-op (idempotent).
create function public.agent_report(p_credential_hash bytea, p_command_id bigint, p_ok boolean, p_unknown boolean, p_result jsonb)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_machine uuid; v public.agent_commands;
begin
  select machine_id into v_machine from public.device_enrollments where credential_hash = p_credential_hash and revoked_at is null and enrolled_at is not null;
  if v_machine is null then raise exception 'invalid_credential'; end if;
  select * into v from public.agent_commands where id = p_command_id for update;
  if not found or v.machine_id <> v_machine then raise exception 'unknown_command'; end if;
  if v.status in ('done', 'failed') then return 'duplicate'; end if;
  update public.agent_commands
     set status = case when p_ok then 'done' else 'failed' end, ok = p_ok, unknown = coalesce(p_unknown, false),
         result = p_result, completed_at = now(), lease_until = null
   where id = p_command_id;
  return 'recorded';
end $$;

create function public.agent_command_state(p_id bigint)
returns table (status text, ok boolean, unknown boolean, result jsonb)
language sql security definer set search_path = public, pg_temp as $$
  select status, ok, unknown, result from public.agent_commands where id = p_id
$$;

-- Quyền xem: token đổi-một-lần do gateway của host phát; chỉ giữ ở đây tới khi renter nhận (hoặc hết hạn).
create table public.session_grants (
  booking_id uuid primary key references public.bookings (id),
  gateway_url text not null check (gateway_url ~ '^https?://[^/@\s]+(/[^\s]*)?$' and char_length(gateway_url) <= 200),
  redeem_token text,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create function public.grant_store(p_booking uuid, p_gateway_url text, p_token text, p_ttl_seconds integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_ttl_seconds is null or p_ttl_seconds not between 30 and 900 then raise exception 'invalid_request'; end if;
  insert into public.session_grants (booking_id, gateway_url, redeem_token, expires_at)
  values (p_booking, p_gateway_url, p_token, now() + make_interval(secs => p_ttl_seconds))
  on conflict (booking_id) do update
     set gateway_url = excluded.gateway_url, redeem_token = excluded.redeem_token, expires_at = excluded.expires_at, claimed_at = null
   where public.session_grants.claimed_at is null; -- đã nhận thì không ghi đè
end $$;

-- Renter nhận token MỘT lần: đúng chủ booking, booking Active + access granted, chưa nhận, chưa hết hạn. Token bị xoá khỏi DB.
create function public.grant_claim(p_booking uuid, p_user uuid)
returns table (gateway_url text, redeem_token text) language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.session_grants; b public.bookings;
begin
  select * into b from public.bookings where id = p_booking and renter_id = p_user;
  if not found then raise exception 'forbidden'; end if;
  if b.state <> 'active' or b.access_state <> 'granted' then raise exception 'no_grant'; end if;
  select * into g from public.session_grants where booking_id = p_booking for update;
  if not found or g.redeem_token is null or g.claimed_at is not null or g.expires_at <= now() then raise exception 'no_grant'; end if;
  update public.session_grants set claimed_at = now(), redeem_token = null where booking_id = p_booking;
  gateway_url := g.gateway_url;
  redeem_token := g.redeem_token;
  return next;
end $$;

alter table public.agent_commands enable row level security;
alter table public.session_grants enable row level security;
grant all on public.agent_commands, public.session_grants to service_role;

revoke all on function public.agent_enqueue_command(uuid, text, text, jsonb), public.agent_poll(bytea, integer, integer),
  public.agent_report(bytea, bigint, boolean, boolean, jsonb), public.agent_command_state(bigint),
  public.grant_store(uuid, text, text, integer), public.grant_claim(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.agent_enqueue_command(uuid, text, text, jsonb), public.agent_poll(bytea, integer, integer),
  public.agent_report(bytea, bigint, boolean, boolean, jsonb), public.agent_command_state(bigint),
  public.grant_store(uuid, text, text, integer), public.grant_claim(uuid, uuid) to service_role;

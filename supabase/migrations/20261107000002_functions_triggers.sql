-- M2 / 2: helper, trigger bất biến và hàm nghiệp vụ. Quyền thực thi cấp ở migration 3.
-- Lỗi nghiệp vụ dùng message là mã ổn định: forbidden, unavailable, invalid_request, wallet_required,
-- idempotency_conflict, invalid_transition, immutable, cleanup_pending, reconcile_required, hold_not_expired,
-- invalid_challenge, wallet_taken, wallet_change_blocked.

create function public.is_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.user_roles where user_id = p_user and role = 'admin');
$$;

create function public.is_approved_host(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.host_profiles where user_id = p_user and status = 'approved');
$$;

create function public.booking_is_live(p_state public.booking_state, p_access public.access_state) returns boolean
language sql immutable as $$
  select not (
    p_state in ('settled', 'refunded', 'resolved', 'cancelled', 'expired')
    and p_access in ('not_granted', 'reset_verified')
  );
$$;

-- ---------------------------------------------------------------- triggers

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger machines_touch before update on public.machines
  for each row execute function public.touch_updated_at();
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

-- Host sửa thông số máy đã duyệt/đang review -> quay về review (không giữ trạng thái approved cho dữ liệu chưa duyệt).
create function public.machines_spec_change() returns trigger language plpgsql as $$
begin
  if new.declared_specs is distinct from old.declared_specs and old.status in ('approved', 'review') then
    new.status := case when old.status = 'approved' then 'review' else old.status end;
  end if;
  return new;
end $$;
create trigger machines_spec_change before update on public.machines
  for each row execute function public.machines_spec_change();

-- Snapshot booking bất biến + máy trạng thái tiền hợp lệ, áp dụng cho mọi role (kể cả service_role).
create function public.bookings_guard() returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.chain_booking_id is distinct from old.chain_booking_id
     or new.renter_id is distinct from old.renter_id
     or new.machine_id is distinct from old.machine_id
     or new.host_id is distinct from old.host_id
     or new.price_units is distinct from old.price_units
     or new.fee_bps is distinct from old.fee_bps
     or new.duration_seconds is distinct from old.duration_seconds
     or new.fund_by is distinct from old.fund_by
     or new.activate_by is distinct from old.activate_by
     or new.policy_version_id is distinct from old.policy_version_id
     or new.workspace_mode is distinct from old.workspace_mode
     or new.quote is distinct from old.quote
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_hash is distinct from old.request_hash then
    raise exception 'immutable';
  end if;

  if new.state is distinct from old.state then
    if not (
      (old.state = 'reserved' and new.state in ('funded', 'cancelled', 'expired'))
      or (old.state = 'funded' and new.state in ('active', 'cancelled', 'refunded'))
      or (old.state = 'active' and new.state in ('settled', 'disputed'))
      or (old.state = 'disputed' and new.state in ('resolved', 'refunded'))
    ) then
      raise exception 'invalid_transition';
    end if;
  end if;
  return new;
end $$;
create trigger bookings_guard before update on public.bookings
  for each row execute function public.bookings_guard();

create function public.forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'immutable';
end $$;
create trigger policy_versions_immutable before update or delete on public.policy_versions
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------- admin / host

create function public.review_host(p_user uuid, p_status public.host_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if p_status = 'pending' then raise exception 'invalid_request'; end if;
  update public.host_profiles set status = p_status, reviewed_by = auth.uid(), reviewed_at = now()
   where user_id = p_user;
  if not found then raise exception 'unavailable'; end if;
  insert into public.audit_logs (actor, action, resource, outcome, detail)
  values (auth.uid(), 'review_host', 'host:' || p_user, 'ok', jsonb_build_object('status', p_status));
end $$;

create function public.submit_machine_for_review(p_machine uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_approved_host(auth.uid()) then raise exception 'forbidden'; end if;
  update public.machines set status = 'review'
   where id = p_machine and owner_id = auth.uid() and status = 'draft';
  if not found then raise exception 'unavailable'; end if;
end $$;

create function public.review_machine(p_machine uuid, p_status public.machine_status) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if p_status = 'review' then raise exception 'invalid_request'; end if;
  update public.machines set status = p_status where id = p_machine;
  if not found then raise exception 'unavailable'; end if;
  insert into public.audit_logs (actor, action, resource, outcome, detail)
  values (auth.uid(), 'review_machine', 'machine:' || p_machine, 'ok', jsonb_build_object('status', p_status));
end $$;

-- ---------------------------------------------------------------- wallet (service_role only)

-- Consume nguyên tử: challenge dùng một lần, còn hạn, đúng user/domain/address/chain.
create function public.consume_wallet_challenge(
  p_user uuid, p_nonce_hash text, p_address text, p_chain_id integer, p_domain text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_addr text := lower(p_address);
  v_current public.wallet_links;
  v_id uuid;
begin
  select * into v_current from public.wallet_links where user_id = p_user;
  if found and v_current.address <> v_addr and exists (
    select 1 from public.bookings b
     where (b.renter_id = p_user or b.host_id = p_user) and public.booking_is_live(b.state, b.access_state)
  ) then
    raise exception 'wallet_change_blocked';
  end if;

  update public.wallet_challenges
     set consumed_at = now()
   where nonce_hash = p_nonce_hash and user_id = p_user and address = v_addr
     and chain_id = p_chain_id and domain = p_domain
     and consumed_at is null and expires_at > now()
  returning id into v_id;
  if v_id is null then raise exception 'invalid_challenge'; end if;

  begin
    insert into public.wallet_links (user_id, address, chain_id) values (p_user, v_addr, p_chain_id)
    on conflict (user_id) do update set address = excluded.address, chain_id = excluded.chain_id, verified_at = now();
  exception when unique_violation then
    raise exception 'wallet_taken';
  end;
end $$;

-- ---------------------------------------------------------------- reservation

-- Renter lấy từ auth.uid(); giá/host/phí/thời lượng lấy từ DB. Không nhận override từ client.
create function public.reserve_machine(
  p_machine_id uuid, p_idempotency_key text, p_request_hash text, p_workspace_mode text default 'none'
) returns public.bookings language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_cfg public.contract_config;
  v_m public.machines;
  v_existing public.bookings;
  v_policy public.policy_versions;
  v_fund_by timestamptz;
  v_activate_by timestamptz;
  v_need_until timestamptz;
  v_b public.bookings;
begin
  if v_uid is null then raise exception 'forbidden'; end if;
  if p_machine_id is null or p_idempotency_key is null or p_request_hash is null
     or char_length(p_idempotency_key) not between 8 and 128 or char_length(p_request_hash) = 0
     or p_workspace_mode is null or p_workspace_mode not in ('none', 'project') then
    raise exception 'invalid_request';
  end if;

  -- Idempotency: cùng key + cùng payload -> trả lại booking cũ; khác payload -> từ chối.
  select * into v_existing from public.bookings where renter_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash = p_request_hash and v_existing.machine_id = p_machine_id then
      return v_existing;
    end if;
    raise exception 'idempotency_conflict';
  end if;

  if not exists (select 1 from public.profiles where user_id = v_uid and status = 'active') then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.wallet_links where user_id = v_uid) then
    raise exception 'wallet_required';
  end if;

  -- Khoá dòng máy: các reservation cùng máy được tuần tự hoá.
  select * into v_m from public.machines where id = p_machine_id for update;
  if not found then raise exception 'unavailable'; end if;
  if v_m.owner_id = v_uid then raise exception 'forbidden'; end if;
  if v_m.status <> 'approved' or not public.is_approved_host(v_m.owner_id) then raise exception 'unavailable'; end if;
  if v_m.active_booking_id is not null
     or exists (select 1 from public.bookings b where b.machine_id = v_m.id and public.booking_is_live(b.state, b.access_state)) then
    raise exception 'unavailable';
  end if;

  select * into v_cfg from public.contract_config;
  v_fund_by := now() + make_interval(secs => v_cfg.quote_ttl_seconds);
  v_activate_by := v_fund_by + make_interval(secs => v_cfg.activate_buffer_seconds);
  v_need_until := v_activate_by + make_interval(secs => v_cfg.package_seconds + v_cfg.recovery_buffer_seconds);

  -- Commitment phải phủ fundBy + activation buffer + thời lượng + recovery buffer tối đa.
  if not exists (
    select 1 from public.host_commitments c
     where c.machine_id = v_m.id and c.starts_at <= now() and c.ends_at >= v_need_until
  ) then
    raise exception 'unavailable';
  end if;

  select * into v_policy from public.policy_versions where effective_at <= now() order by effective_at desc limit 1;
  if not found then raise exception 'unavailable'; end if;

  begin
    insert into public.bookings (
      renter_id, machine_id, host_id, price_units, fee_bps, duration_seconds, fund_by, activate_by,
      policy_version_id, workspace_mode, idempotency_key, request_hash, quote
    ) values (
      v_uid, v_m.id, v_m.owner_id, v_m.price_units, v_cfg.fee_bps, v_cfg.package_seconds, v_fund_by, v_activate_by,
      v_policy.id, p_workspace_mode, p_idempotency_key, p_request_hash,
      jsonb_build_object(
        'price_units', v_m.price_units::text, 'fee_bps', v_cfg.fee_bps, 'duration_seconds', v_cfg.package_seconds,
        'chain_id', v_cfg.chain_id, 'fund_by', v_fund_by, 'activate_by', v_activate_by,
        'policy_version', v_policy.version, 'policy_sha256', v_policy.body_sha256
      )
    ) returning * into v_b;
  exception when unique_violation then
    -- Index một-booking-sống-mỗi-máy (hoặc đua idempotency key) là chốt chặn cuối.
    raise exception 'unavailable';
  end;

  update public.machines set active_booking_id = v_b.id where id = v_m.id;

  insert into public.outbox_jobs (action_key, job_type, payload)
  values ('issue_quote:' || v_b.id, 'issue_quote', jsonb_build_object('booking_id', v_b.id));
  insert into public.audit_logs (actor, action, resource, outcome)
  values (v_uid, 'reserve_machine', 'booking:' || v_b.id, 'ok');

  return v_b;
end $$;

-- ---------------------------------------------------------------- release / expiry (service_role only)

-- Chỉ nhả máy khi tiền terminal và quyền truy cập đã thu hồi/reset xác minh (hoặc chưa từng cấp).
create function public.release_machine(p_booking uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  if not found then raise exception 'unavailable'; end if;
  if public.booking_is_live(v_b.state, v_b.access_state) then raise exception 'cleanup_pending'; end if;
  update public.machines set active_booking_id = null where id = v_b.machine_id and active_booking_id = v_b.id;
  insert into public.audit_logs (actor, action, resource, outcome)
  values (auth.uid(), 'release_machine', 'booking:' || v_b.id, 'ok');
end $$;

-- Hết hold không nhả ngay: chỉ khi server xác nhận đã đối soát chain (không có fund pending/đã include).
create function public.expire_unfunded_booking(p_booking uuid, p_chain_reconciled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking for update;
  if not found then raise exception 'unavailable'; end if;
  if v_b.state <> 'reserved' then raise exception 'invalid_transition'; end if;
  if now() <= v_b.fund_by then raise exception 'hold_not_expired'; end if;
  if p_chain_reconciled is not true then raise exception 'reconcile_required'; end if;
  update public.bookings set state = 'expired' where id = v_b.id;
  if v_b.access_state in ('not_granted', 'reset_verified') then
    update public.machines set active_booking_id = null where id = v_b.machine_id and active_booking_id = v_b.id;
  end if;
  insert into public.audit_logs (actor, action, resource, outcome)
  values (auth.uid(), 'expire_unfunded_booking', 'booking:' || v_b.id, 'ok');
end $$;

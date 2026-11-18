-- Feature 003: khoá theo user để phối hợp đổi ví với đặt máy (finding cũ "wallet challenge vs reservation").
-- Thứ tự khoá thống nhất: user (renter và chủ máy, sắp xếp) -> machines(dòng). consume_wallet_challenge chỉ giữ MỘT khoá user.
-- create or replace giữ nguyên grants/owner; thân hàm giống migration 2 trừ các dòng khoá.

create or replace function public.consume_wallet_challenge(
  p_user uuid, p_nonce_hash text, p_address text, p_chain_id integer, p_domain text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_addr text := lower(p_address);
  v_current public.wallet_links;
  v_id uuid;
begin
  -- Khoá theo user: điều phối với reserve_machine (cùng khoá) để không đổi ví giữa lúc đặt máy.
  perform pg_advisory_xact_lock(hashtextextended('user:' || p_user::text, 0));
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

create or replace function public.reserve_machine(
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
  v_owner uuid;
begin
  if v_uid is null then raise exception 'forbidden'; end if;
  if p_machine_id is null or p_idempotency_key is null or p_request_hash is null
     or char_length(p_idempotency_key) not between 8 and 128 or char_length(p_request_hash) = 0
     or p_workspace_mode is null or p_workspace_mode not in ('none', 'project') then
    raise exception 'invalid_request';
  end if;

  -- Khoá renter và chủ máy THEO THỨ TỰ SẮP XẾP, trước khi khoá dòng máy (cùng khoá user với consume_wallet_challenge).
  -- Chủ máy đọc không khoá: owner_id không đổi được qua client; kiểm lại sau khi khoá máy.
  select owner_id into v_owner from public.machines where id = p_machine_id;
  if not found then raise exception 'unavailable'; end if;
  if v_uid <= v_owner then
    perform pg_advisory_xact_lock(hashtextextended('user:' || v_uid::text, 0));
    if v_owner <> v_uid then perform pg_advisory_xact_lock(hashtextextended('user:' || v_owner::text, 0)); end if;
  else
    perform pg_advisory_xact_lock(hashtextextended('user:' || v_owner::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('user:' || v_uid::text, 0));
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
  if v_m.owner_id <> v_owner then raise exception 'unavailable'; end if;
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

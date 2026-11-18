-- Feature 003 / M-E, M-F: sự kiện chuỗi áp dụng idempotent vào booking, thời điểm phiên, hàng đợi outbox có lease/fencing.
-- Mọi hàm ở đây CHỈ cho service_role (server/worker). Client không có đường nào tới chúng.

-- ---------------------------------------------------------------- 1. Thời điểm phiên (từ block activate)
alter table public.bookings add column started_at timestamptz, add column end_at timestamptz;

-- ---------------------------------------------------------------- 2. chain_events
create table public.chain_events (
  id bigint generated always as identity primary key,
  chain_id integer not null,
  contract text not null check (contract ~ '^0x[0-9a-f]{40}$'),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number bigint not null check (block_number >= 0),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  event text not null check (event in ('Funded', 'Activated', 'Refunded', 'DisputeOpened', 'Resolved', 'Settled')),
  booking_chain_id bytea not null check (octet_length(booking_chain_id) = 32),
  data jsonb not null default '{}'::jsonb,
  outcome text, -- applied | mismatch | ignored_state | unknown_booking
  created_at timestamptz not null default now(),
  unique (chain_id, contract, tx_hash, log_index)
);
create index chain_events_booking_idx on public.chain_events (booking_chain_id, block_number, log_index);

-- Áp dụng một sự kiện chuỗi đã được server xác minh (receipt đủ confirmation, đúng contract).
-- Idempotent theo (chain, contract, tx, log_index); block_hash khác với bản đã lưu → nghi reorg, không áp dụng lại.
create function public.apply_chain_event(
  p_chain_id integer, p_contract text, p_tx_hash text, p_log_index integer, p_block_number bigint, p_block_hash text,
  p_event text, p_booking_chain_id bytea, p_data jsonb
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id bigint;
  v_old text;
  v_b public.bookings;
  v_to public.booking_state;
  v_outcome text;
begin
  insert into public.chain_events (chain_id, contract, tx_hash, log_index, block_number, block_hash, event, booking_chain_id, data)
  values (p_chain_id, lower(p_contract), lower(p_tx_hash), p_log_index, p_block_number, lower(p_block_hash), p_event, p_booking_chain_id, coalesce(p_data, '{}'::jsonb))
  on conflict (chain_id, contract, tx_hash, log_index) do nothing
  returning id into v_id;

  if v_id is null then
    select block_hash into v_old from public.chain_events
     where chain_id = p_chain_id and contract = lower(p_contract) and tx_hash = lower(p_tx_hash) and log_index = p_log_index;
    if v_old is distinct from lower(p_block_hash) then
      insert into public.audit_logs (actor, action, resource, outcome, detail)
      values (null, 'chain_reorg_suspected', 'tx:' || lower(p_tx_hash), 'needs_reconcile', jsonb_build_object('old', v_old, 'new', lower(p_block_hash)));
      return 'reorg_suspected';
    end if;
    return 'duplicate';
  end if;

  select * into v_b from public.bookings where chain_booking_id = p_booking_chain_id for update;
  if not found then
    update public.chain_events set outcome = 'unknown_booking' where id = v_id;
    return 'unknown_booking';
  end if;

  -- Chuyển trạng thái theo bảng của CONTRACT_SPEC; sự kiện lệch trạng thái không bị ép áp dụng.
  if p_event = 'Funded' then
    if v_b.state <> 'reserved' then v_outcome := 'ignored_state';
    elsif (p_data ->> 'priceUnits') is distinct from v_b.price_units::text
       or (p_data ->> 'feeBps') is distinct from v_b.fee_bps::text then v_outcome := 'mismatch';
    else v_to := 'funded'; end if;
  elsif p_event = 'Activated' then
    if v_b.state <> 'funded' then v_outcome := 'ignored_state'; else v_to := 'active'; end if;
  elsif p_event = 'Refunded' then
    if v_b.state not in ('funded', 'disputed') then v_outcome := 'ignored_state'; else v_to := 'refunded'; end if;
  elsif p_event = 'DisputeOpened' then
    if v_b.state <> 'active' then v_outcome := 'ignored_state'; else v_to := 'disputed'; end if;
  elsif p_event = 'Resolved' then
    if v_b.state <> 'disputed' then v_outcome := 'ignored_state'; else v_to := 'resolved'; end if;
  elsif p_event = 'Settled' then
    if v_b.state <> 'active' then v_outcome := 'ignored_state'; else v_to := 'settled'; end if;
  end if;

  if v_to is null then
    update public.chain_events set outcome = v_outcome where id = v_id;
    insert into public.audit_logs (actor, action, resource, outcome, detail)
    values (null, 'chain_event_not_applied', 'booking:' || v_b.id, v_outcome, jsonb_build_object('event', p_event, 'state', v_b.state));
    return v_outcome;
  end if;

  update public.bookings set
    state = v_to,
    started_at = case when p_event = 'Activated' then to_timestamp((p_data ->> 'startedAt')::double precision) else started_at end,
    end_at = case when p_event = 'Activated' then to_timestamp((p_data ->> 'endAt')::double precision) else end_at end
  where id = v_b.id;
  update public.chain_events set outcome = 'applied' where id = v_id;
  insert into public.audit_logs (actor, action, resource, outcome, detail)
  values (null, 'chain_event_applied', 'booking:' || v_b.id, 'ok', jsonb_build_object('event', p_event, 'tx', lower(p_tx_hash)));
  return 'applied';
end $$;

-- ---------------------------------------------------------------- 3. Hàng đợi outbox: lease, fencing, retry, dead
alter table public.outbox_jobs
  add column status text not null default 'pending' check (status in ('pending', 'done', 'dead')),
  add column last_error text,
  add column max_attempts integer not null default 8 check (max_attempts between 1 and 50),
  add column locked_by text,
  add column done_at timestamptz;
create index outbox_jobs_ready_idx on public.outbox_jobs (available_at, id) where status = 'pending';

-- Đưa job vào hàng đợi, idempotent theo action_key.
create function public.enqueue_job(p_action_key text, p_job_type text, p_payload jsonb, p_delay_seconds integer default 0)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  insert into public.outbox_jobs (action_key, job_type, payload, available_at)
  values (p_action_key, p_job_type, coalesce(p_payload, '{}'::jsonb), now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 0), 0)))
  on conflict (action_key) do nothing returning id into v_id;
  return v_id is not null;
end $$;

-- Nhận tối đa p_limit job sẵn sàng; lease p_lease_seconds. SKIP LOCKED → nhiều worker không nhận trùng.
-- Lease hết hạn thì job được nhận lại (attempts tăng) — worker cũ bị chặn bởi fencing ở complete/fail.
create function public.claim_jobs(p_worker text, p_limit integer, p_lease_seconds integer)
returns setof public.outbox_jobs language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_worker is null or char_length(p_worker) = 0 or p_limit is null or p_limit < 1 or p_lease_seconds is null or p_lease_seconds < 1 then
    raise exception 'invalid_request';
  end if;
  return query
    update public.outbox_jobs j
       set lease_until = now() + make_interval(secs => p_lease_seconds), locked_by = p_worker, attempts = j.attempts + 1
     where j.id in (
       select id from public.outbox_jobs
        where status = 'pending' and available_at <= now() and (lease_until is null or lease_until < now())
        order by available_at, id limit p_limit for update skip locked)
    returning j.*;
end $$;

-- Fencing: chỉ chủ lease hiện tại (đúng worker VÀ đúng lần thử) mới kết thúc được job.
create function public.complete_job(p_id bigint, p_worker text, p_attempt integer, p_result jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  update public.outbox_jobs
     set status = 'done', done_at = now(), result = p_result, lease_until = null, last_error = null
   where id = p_id and status = 'pending' and locked_by = p_worker and attempts = p_attempt and lease_until >= now();
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- Thất bại: retry với backoff mũ (5·2^attempts giây, tối đa 1 giờ) hoặc dead nếu hết lượt/không retry được.
create function public.fail_job(p_id bigint, p_worker text, p_attempt integer, p_error text, p_retry boolean)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.outbox_jobs;
begin
  select * into v from public.outbox_jobs where id = p_id for update;
  if not found or v.status <> 'pending' or v.locked_by is distinct from p_worker or v.attempts <> p_attempt then return 'stale'; end if;
  if not p_retry or v.attempts >= v.max_attempts then
    update public.outbox_jobs set status = 'dead', last_error = left(p_error, 500), lease_until = null where id = p_id;
    return 'dead';
  end if;
  update public.outbox_jobs
     set last_error = left(p_error, 500), lease_until = null,
         available_at = now() + make_interval(secs => least(3600, 5 * power(2, v.attempts)::integer))
   where id = p_id;
  return 'retry';
end $$;

-- Hold hết hạn: xếp job `expire_booking` cho booking reserved quá fund_by (worker đối soát chain rồi mới expire).
create function public.enqueue_expiry_jobs() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer := 0; r record;
begin
  for r in select id from public.bookings where state = 'reserved' and fund_by < now() loop
    if public.enqueue_job('expire:' || r.id, 'expire_booking', jsonb_build_object('booking_id', r.id), 0) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------- 4. RLS và quyền: chỉ service_role
alter table public.chain_events enable row level security;
grant all on public.chain_events to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.apply_chain_event(integer, text, text, integer, bigint, text, text, bytea, jsonb),
  public.enqueue_job(text, text, jsonb, integer), public.claim_jobs(text, integer, integer),
  public.complete_job(bigint, text, integer, jsonb), public.fail_job(bigint, text, integer, text, boolean),
  public.enqueue_expiry_jobs() from public, anon, authenticated, service_role;
grant execute on function public.apply_chain_event(integer, text, text, integer, bigint, text, text, bytea, jsonb),
  public.enqueue_job(text, text, jsonb, integer), public.claim_jobs(text, integer, integer),
  public.complete_job(bigint, text, integer, jsonb), public.fail_job(bigint, text, integer, text, boolean),
  public.enqueue_expiry_jobs() to service_role;

-- Feature 003 / M-G: workspace project của renter. Chỉ server ghi (service_role). Mỗi workspace một writer (lease),
-- commit nguyên tử theo version, quota tính cả object đang staging, object bất biến theo checksum.
-- "Đã lưu" chỉ đúng khi ws_commit thành công; không suy ra từ upload.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  quota_bytes bigint not null default 536870912 check (quota_bytes between 1 and 10737418240),
  latest_version integer not null default 0 check (latest_version >= 0),
  created_at timestamptz not null default now()
);
create index workspaces_owner_idx on public.workspaces (owner_id);

create table public.workspace_objects (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  primary key (workspace_id, sha256)
);

create table public.workspace_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version integer not null check (version >= 1),
  booking_id uuid references public.bookings (id),
  manifest jsonb not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  total_bytes bigint not null check (total_bytes >= 0),
  committed_at timestamptz not null default now(),
  unique (workspace_id, version)
);
create trigger workspace_versions_immutable before update on public.workspace_versions
  for each row execute function public.forbid_mutation();

-- Một writer tại một thời điểm: khoá theo workspace (khoá chính). token_hash = SHA-256 của token lease.
create table public.workspace_leases (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  booking_id uuid not null references public.bookings (id),
  token_hash bytea not null check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create function public.ws_create(p_owner uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.profiles where user_id = p_owner and status = 'active') then raise exception 'forbidden'; end if;
  if (select count(*) from public.workspaces where owner_id = p_owner) >= 5 then raise exception 'workspace_limit'; end if;
  insert into public.workspaces (owner_id, name) values (p_owner, p_name) returning id into v_id;
  return v_id;
end $$;

-- Lease ghi/khôi phục: chủ workspace + chủ booking, booking Active; hạn không vượt endAt + 600s (recovery giới hạn).
-- Lease còn hạn của booking KHÁC chặn cấp; cùng booking thì thay token mới (token cũ vô hiệu).
create function public.ws_acquire_lease(p_workspace uuid, p_user uuid, p_booking uuid, p_token_hash bytea, p_ttl_seconds integer)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare v_w public.workspaces; v_b public.bookings; v_l public.workspace_leases; v_cap timestamptz; v_exp timestamptz;
begin
  if p_ttl_seconds is null or p_ttl_seconds not between 30 and 3600 then raise exception 'invalid_request'; end if;
  select * into v_w from public.workspaces where id = p_workspace for update;
  if not found or v_w.owner_id <> p_user then raise exception 'forbidden'; end if;
  select * into v_b from public.bookings where id = p_booking;
  if not found or v_b.renter_id <> p_user then raise exception 'forbidden'; end if;
  if v_b.state <> 'active' or v_b.end_at is null then raise exception 'booking_not_active'; end if;
  v_cap := v_b.end_at + interval '600 seconds';
  if now() >= v_cap then raise exception 'recovery_window_closed'; end if;
  select * into v_l from public.workspace_leases where workspace_id = p_workspace;
  if found and v_l.expires_at > now() and v_l.booking_id <> p_booking then raise exception 'lease_held'; end if;
  v_exp := least(now() + make_interval(secs => p_ttl_seconds), v_cap);
  insert into public.workspace_leases (workspace_id, booking_id, token_hash, expires_at) values (p_workspace, p_booking, p_token_hash, v_exp)
  on conflict (workspace_id) do update set booking_id = excluded.booking_id, token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_at = now();
  return v_exp;
end $$;

create function public.ws_check_lease(p_workspace uuid, p_token_hash bytea) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_booking uuid;
begin
  select booking_id into v_booking from public.workspace_leases
   where workspace_id = p_workspace and token_hash = p_token_hash and expires_at > now();
  if v_booking is null then raise exception 'lease_invalid'; end if;
  return v_booking;
end $$;

-- Đăng ký object (đã ghi vào store) vào workspace; quota tính mọi object, kể cả chưa commit. Idempotent theo sha256.
create function public.ws_register_object(p_workspace uuid, p_token_hash bytea, p_sha text, p_size bigint) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_w public.workspaces; v_used bigint; v_n integer;
begin
  perform public.ws_check_lease(p_workspace, p_token_hash);
  select * into v_w from public.workspaces where id = p_workspace for update;
  if exists (select 1 from public.workspace_objects where workspace_id = p_workspace and sha256 = p_sha) then return false; end if;
  select coalesce(sum(size_bytes), 0) into v_used from public.workspace_objects where workspace_id = p_workspace;
  if v_used + p_size > v_w.quota_bytes then raise exception 'quota_exceeded'; end if;
  insert into public.workspace_objects (workspace_id, sha256, size_bytes) values (p_workspace, p_sha, p_size);
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- Commit nguyên tử: đúng lease, đúng version kỳ vọng (không last-write-wins), mọi object trong manifest đã đăng ký đúng kích thước.
create function public.ws_commit(p_workspace uuid, p_token_hash bytea, p_expected_version integer, p_manifest jsonb, p_manifest_sha text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_w public.workspaces; v_booking uuid; v_total bigint := 0; f jsonb; v_size bigint; v_next integer;
begin
  v_booking := public.ws_check_lease(p_workspace, p_token_hash);
  select * into v_w from public.workspaces where id = p_workspace for update;
  if v_w.latest_version <> p_expected_version then raise exception 'version_conflict'; end if;
  if jsonb_typeof(p_manifest -> 'files') is distinct from 'array' then raise exception 'invalid_manifest'; end if;
  for f in select * from jsonb_array_elements(p_manifest -> 'files') loop
    select size_bytes into v_size from public.workspace_objects where workspace_id = p_workspace and sha256 = f ->> 'sha256';
    if v_size is null or v_size <> (f ->> 'size')::bigint then raise exception 'missing_object'; end if;
    v_total := v_total + v_size;
  end loop;
  v_next := v_w.latest_version + 1;
  insert into public.workspace_versions (workspace_id, version, booking_id, manifest, manifest_sha256, total_bytes)
  values (p_workspace, v_next, v_booking, p_manifest, p_manifest_sha, v_total);
  update public.workspaces set latest_version = v_next where id = p_workspace;
  return v_next;
end $$;

create function public.ws_release_lease(p_workspace uuid, p_token_hash bytea) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  delete from public.workspace_leases where workspace_id = p_workspace and token_hash = p_token_hash;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- Worker gọi khi thu hồi phiên: mọi lease của booking chấm dứt (không còn writer).
create function public.ws_release_for_booking(p_booking uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  delete from public.workspace_leases where booking_id = p_booking;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Dọn staging: object không nằm trong p_keep_versions version gần nhất và đã quá 1 giờ. Trả sha để xoá blob ở store.
create function public.ws_gc(p_workspace uuid, p_keep_versions integer) returns setof text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_keep_versions is null or p_keep_versions < 1 then raise exception 'invalid_request'; end if;
  perform 1 from public.workspaces where id = p_workspace for update;
  return query
    delete from public.workspace_objects o
     where o.workspace_id = p_workspace and o.created_at < now() - interval '1 hour'
       and not exists (
         select 1 from public.workspace_versions v, jsonb_array_elements(v.manifest -> 'files') f
          where v.workspace_id = p_workspace and v.version > (select latest_version from public.workspaces where id = p_workspace) - p_keep_versions
            and f ->> 'sha256' = o.sha256)
    returning o.sha256;
end $$;

-- Xoá workspace theo yêu cầu chủ sở hữu; từ chối khi còn lease. Trả mọi sha để xoá blob.
create function public.ws_delete(p_workspace uuid, p_owner uuid) returns setof text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shas text[];
begin
  perform 1 from public.workspaces where id = p_workspace and owner_id = p_owner for update;
  if not found then raise exception 'forbidden'; end if;
  if exists (select 1 from public.workspace_leases where workspace_id = p_workspace and expires_at > now()) then raise exception 'lease_held'; end if;
  select coalesce(array_agg(sha256), '{}') into v_shas from public.workspace_objects where workspace_id = p_workspace;
  delete from public.workspaces where id = p_workspace;
  return query select unnest(v_shas);
end $$;

-- RLS: chủ sở hữu chỉ ĐỌC workspace và version của mình; mọi ghi qua server.
alter table public.workspaces enable row level security;
alter table public.workspace_objects enable row level security;
alter table public.workspace_versions enable row level security;
alter table public.workspace_leases enable row level security;
grant all on public.workspaces, public.workspace_objects, public.workspace_versions, public.workspace_leases to service_role;
grant select on public.workspaces, public.workspace_versions to authenticated;
create policy workspaces_owner_select on public.workspaces for select to authenticated using (owner_id = auth.uid());
create policy workspace_versions_owner_select on public.workspace_versions for select to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid()));

revoke all on function public.ws_create(uuid, text), public.ws_acquire_lease(uuid, uuid, uuid, bytea, integer), public.ws_check_lease(uuid, bytea),
  public.ws_register_object(uuid, bytea, text, bigint), public.ws_commit(uuid, bytea, integer, jsonb, text), public.ws_release_lease(uuid, bytea),
  public.ws_release_for_booking(uuid), public.ws_gc(uuid, integer), public.ws_delete(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.ws_create(uuid, text), public.ws_acquire_lease(uuid, uuid, uuid, bytea, integer), public.ws_check_lease(uuid, bytea),
  public.ws_register_object(uuid, bytea, text, bigint), public.ws_commit(uuid, bytea, integer, jsonb, text), public.ws_release_lease(uuid, bytea),
  public.ws_release_for_booking(uuid), public.ws_gc(uuid, integer), public.ws_delete(uuid, uuid) to service_role;

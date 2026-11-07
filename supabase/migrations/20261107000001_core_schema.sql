-- M2 / 1: schema lõi. Tiền lưu numeric(78,0) = đơn vị nhỏ nhất (18 decimals), không float.
-- Giả định Supabase: schema auth (auth.users, auth.uid()) và roles anon/authenticated/service_role đã có.

create type public.host_status as enum ('pending', 'approved', 'suspended');
create type public.machine_status as enum ('draft', 'review', 'approved', 'suspended');
create type public.app_role as enum ('admin', 'operator');
-- Money state (độc lập với access state).
create type public.booking_state as enum
  ('reserved', 'funded', 'active', 'settled', 'refunded', 'disputed', 'resolved', 'cancelled', 'expired');
create type public.access_state as enum
  ('not_granted', 'preparing', 'ready', 'granted', 'revoking', 'revoked', 'resetting', 'reset_verified', 'failed', 'unknown');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

-- Role chỉ ghi từ server (service_role); client không có quyền ghi.
create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.host_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status public.host_status not null default 'pending',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.wallet_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null,
  address text not null check (address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer not null check (chain_id > 0),
  nonce_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Demo: một ví / một user, địa chỉ chuẩn hoá chữ thường, mỗi ví chỉ thuộc một user.
create table public.wallet_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  address text not null unique check (address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer not null check (chain_id > 0),
  verified_at timestamptz not null default now()
);

-- Cấu hình hợp đồng/booking do server kiểm soát (một dòng duy nhất); client không ghi.
create table public.contract_config (
  singleton boolean primary key default true check (singleton),
  chain_id integer not null default 43113 check (chain_id > 0),
  package_seconds integer not null default 900 check (package_seconds > 0),
  fee_bps integer not null default 1000 check (fee_bps between 0 and 10000),
  quote_ttl_seconds integer not null default 600 check (quote_ttl_seconds between 1 and 600),
  activate_buffer_seconds integer not null default 300 check (activate_buffer_seconds > 0),
  recovery_buffer_seconds integer not null default 600 check (recovery_buffer_seconds >= 0)
);
insert into public.contract_config default values;

create table public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  body text not null,
  body_sha256 text not null,
  effective_at timestamptz not null default now()
);
insert into public.policy_versions (version, body, body_sha256)
select 'demo-0.1',
       'Chính sách demo (bản nháp, không phải điều khoản thương mại). Xem docs/MARKETPLACE_POLICIES_DRAFT.md.',
       encode(sha256(convert_to('Chính sách demo (bản nháp, không phải điều khoản thương mại). Xem docs/MARKETPLACE_POLICIES_DRAFT.md.', 'UTF8')), 'hex');

create table public.machines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id),
  -- Canonical key của thiết bị: một thiết bị chỉ có một listing, tránh vượt lock bằng nhiều listing.
  machine_key text not null unique check (machine_key ~ '^[a-z0-9][a-z0-9-]{7,63}$'),
  name text not null check (char_length(name) between 1 and 120),
  declared_specs jsonb not null default '{}'::jsonb,
  price_units numeric(78, 0) not null check (price_units > 0 and price_units <= 1000000 * 10::numeric ^ 18),
  status public.machine_status not null default 'draft',
  active_booking_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Endpoint/credential ref riêng tư: không có policy nào cho client.
create table public.machine_private_config (
  machine_id uuid primary key references public.machines (id) on delete cascade,
  config_ref text not null
);

create table public.host_commitments (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint commitment_min_4h check (ends_at - starts_at >= interval '4 hours')
);
create index host_commitments_machine_idx on public.host_commitments (machine_id, starts_at, ends_at);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  -- bytes32 ngẫu nhiên dùng làm ID on-chain; không suy ra từ dữ liệu người dùng.
  chain_booking_id bytea not null unique
    default sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())),
  renter_id uuid not null references auth.users (id),
  machine_id uuid not null references public.machines (id),
  host_id uuid not null references auth.users (id),
  -- Snapshot bất biến (xem trigger bookings_guard).
  price_units numeric(78, 0) not null check (price_units > 0 and price_units <= 1000000 * 10::numeric ^ 18),
  fee_bps integer not null check (fee_bps between 0 and 10000),
  duration_seconds integer not null check (duration_seconds > 0),
  fund_by timestamptz not null,
  activate_by timestamptz not null,
  policy_version_id uuid not null references public.policy_versions (id),
  workspace_mode text not null default 'none' check (workspace_mode in ('none', 'project')),
  quote jsonb not null,
  state public.booking_state not null default 'reserved',
  access_state public.access_state not null default 'not_granted',
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  request_hash text not null check (char_length(request_hash) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_renter_not_host check (renter_id <> host_id),
  constraint bookings_chain_id_len check (octet_length(chain_booking_id) = 32),
  unique (renter_id, idempotency_key)
);

-- Bất biến cốt lõi: tối đa một booking "còn giữ máy" trên mỗi máy.
-- Còn giữ = chưa terminal về tiền, hoặc đã terminal nhưng quyền truy cập chưa được thu hồi/reset xác minh.
create unique index bookings_one_live_per_machine on public.bookings (machine_id)
  where not (
    state in ('settled', 'refunded', 'resolved', 'cancelled', 'expired')
    and access_state in ('not_granted', 'reset_verified')
  );

alter table public.machines
  add constraint machines_active_booking_fk foreign key (active_booking_id) references public.bookings (id);

create table public.outbox_jobs (
  id bigint generated always as identity primary key,
  action_key text not null unique,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  result jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  resource text not null,
  outcome text not null,
  detail jsonb not null default '{}'::jsonb, -- đã lọc secret
  created_at timestamptz not null default now()
);

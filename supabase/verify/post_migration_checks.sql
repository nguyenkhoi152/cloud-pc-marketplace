-- Kiểm tra SAU KHI áp dụng migrations lên Supabase. CHỈ ĐỌC: một câu SELECT duy nhất, không ghi gì.
-- Dán vào SQL Editor của project dev, chạy, gửi nguyên bảng kết quả (không chứa secret) cho writer/reviewer.
-- Hàng 1–9: kiểm migration 000001–000002; hàng 10–14: kiểm migration 000003–000006. Hàng 15–16 chỉ là thông tin.
-- Cột `ok`: true nếu khớp kỳ vọng. Mọi dòng phải là true. Dòng `info` chỉ để ghi lại, không phải đạt/trượt.

with
fns as (
  select p.oid, p.proname, p.oid::regprocedure::text as sig, p.proacl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
),
auth_fns as (
  select string_agg(proname, ', ' order by proname) as names, count(*) as n
    from fns where has_function_privilege('authenticated', oid, 'execute')
),
grants as (
  select grantee, privilege_type, table_name
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'public')
),
checks as (
  select 1 as o, 'bảng public thiếu RLS' as name, 'không có' as expected,
         coalesce((select string_agg(tablename, ', ') from pg_tables where schemaname = 'public' and not rowsecurity), 'không có') as actual
  union all
  select 2, 'hàm public còn EXECUTE cho PUBLIC/anon', 'không có',
         coalesce((select string_agg(sig, ', ') from fns
                    where proacl is null
                       or exists (select 1 from aclexplode(proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
                       or has_function_privilege('anon', oid, 'execute')), 'không có')
  union all
  select 3, 'hàm authenticated gọi được (9 hàm)',
         'booking_is_live, is_admin, is_approved_host, my_machine_health, reserve_machine, review_host, review_machine, schedule_windows, submit_machine_for_review',
         (select names from auth_fns)
  union all
  select 4, 'quyền bảng nhạy cảm cho anon/authenticated', 'không có',
         coalesce((select string_agg(grantee || ' ' || privilege_type || ' ' || table_name, '; ') from grants
                    where table_name in ('device_enrollments', 'outbox_jobs', 'wallet_challenges', 'machine_private_config', 'chain_events', 'agent_commands', 'session_grants', 'workspace_leases', 'workspace_objects')), 'không có')
  union all
  select 5, 'client ghi được bookings/outbox/roles/audit/config/policy', 'không có',
         coalesce((select string_agg(grantee || ' ' || privilege_type || ' ' || table_name, '; ') from grants
                    where table_name in ('bookings', 'outbox_jobs', 'user_roles', 'audit_logs', 'contract_config', 'policy_versions', 'workspaces', 'workspace_versions', 'workspace_objects', 'workspace_leases', 'chain_events', 'agent_commands', 'session_grants')
                      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')), 'không có')
  union all
  select 6, 'trigger bảo vệ cam kết/lịch/booking (4)',
         'bookings_guard, host_commitments_coverage, host_commitments_lock, host_schedule_rules_overlap',
         coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger
                    where not tgisinternal and tgname in ('host_commitments_lock', 'host_commitments_coverage', 'host_schedule_rules_overlap', 'bookings_guard')), 'không có')
  union all
  select 7, 'chỉ mục một booking sống mỗi máy', 'bookings_one_live_per_machine',
         coalesce((select string_agg(indexname, ', ') from pg_indexes where schemaname = 'public' and indexname = 'bookings_one_live_per_machine'), 'không có')
  union all
  select 8, 'seed contract_config / policy_versions', '1 config; policy >= 1',
         (select count(*) from public.contract_config)::text || ' config; ' || (select count(*) from public.policy_versions)::text || ' policy'
  union all
  select 9, 'múi giờ: 19:00 Asia/Ho_Chi_Minh = 12:00 UTC', '2026-11-09 12:00:00+00',
         ((timestamp '2026-11-09 19:00') at time zone 'Asia/Ho_Chi_Minh' at time zone 'UTC')::text || '+00'
  union all
  select 10, '7 bảng mới của migration 000003–000005 tồn tại',
         'agent_commands, chain_events, session_grants, workspace_leases, workspace_objects, workspace_versions, workspaces',
         coalesce((select string_agg(t, ', ' order by t) from unnest(array['agent_commands', 'chain_events', 'session_grants', 'workspace_leases', 'workspace_objects', 'workspace_versions', 'workspaces']) t
                    where to_regclass('public.' || t) is not null), 'không có')
  union all
  select 11, '21 hàm mới (service_role) tồn tại', '21',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'apply_chain_event', 'enqueue_job', 'claim_jobs', 'complete_job', 'fail_job', 'enqueue_expiry_jobs',
             'ws_create', 'ws_acquire_lease', 'ws_check_lease', 'ws_register_object', 'ws_commit', 'ws_release_lease', 'ws_release_for_booking', 'ws_gc', 'ws_delete',
             'agent_enqueue_command', 'agent_poll', 'agent_report', 'agent_command_state', 'grant_store', 'grant_claim'))
  union all
  select 12, '7 cột mới (bookings.started_at/end_at; outbox_jobs.status/last_error/max_attempts/locked_by/done_at)', '7',
         (select count(*)::text from information_schema.columns where table_schema = 'public'
           and ((table_name = 'bookings' and column_name in ('started_at', 'end_at'))
             or (table_name = 'outbox_jobs' and column_name in ('status', 'last_error', 'max_attempts', 'locked_by', 'done_at'))))
  union all
  select 13, 'trigger version workspace bất biến', 'workspace_versions_immutable',
         coalesce((select string_agg(tgname, ', ') from pg_trigger where not tgisinternal and tgname = 'workspace_versions_immutable'), 'không có')
  union all
  select 14, 'quyền sequence public cho anon/authenticated', 'không có',
         coalesce((select string_agg(sequencename, ', ') from pg_sequences
                    where schemaname = 'public'
                      and (has_sequence_privilege('anon', 'public.' || quote_ident(sequencename), 'USAGE,SELECT,UPDATE')
                        or has_sequence_privilege('authenticated', 'public.' || quote_ident(sequencename), 'USAGE,SELECT,UPDATE'))), 'không có')
)
select o, name, expected, actual,
       case when name = 'seed contract_config / policy_versions' then actual ~ '^1 config; [1-9][0-9]* policy$'
            else actual = expected end as ok
  from checks
union all
select 15, 'info: phiên bản Postgres', '(ghi lại, cần >= 13)', version(), null
union all
select 16, 'info: số migration CLI đã ghi nhận', '(0 nếu dán vào SQL Editor)',
       case when to_regclass('supabase_migrations.schema_migrations') is null then '0 (không có bảng)'
            else (xpath('/row/c/text()', query_to_xml('select count(*) as c from supabase_migrations.schema_migrations', false, true, '')))[1]::text end, null
order by 1;

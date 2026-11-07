-- M2 / 3: RLS, grants, view công khai. Nguyên tắc: mặc định từ chối, chỉ mở đúng cột/hàng cần thiết.
-- Supabase mặc định cấp ALL cho anon/authenticated trên bảng mới -> thu hồi hết rồi cấp lại từng phần.

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated, service_role;

-- service_role vượt RLS (BYPASSRLS) nhưng vẫn cần đặc quyền bảng; API vẫn phải tự kiểm actor/resource.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Giữ mặc định an toàn cho bảng/hàm tạo sau này.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- ------------------------------------------------------------- profiles
grant select, insert (user_id, display_name), update (display_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (user_id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------- roles (chỉ đọc phần của mình)
grant select on public.user_roles to authenticated;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- ------------------------------------------------------------- host_profiles
grant select, insert (user_id) on public.host_profiles to authenticated;
create policy host_profiles_select on public.host_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));
create policy host_profiles_insert on public.host_profiles for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

-- ------------------------------------------------------------- wallet
grant select on public.wallet_links to authenticated;
create policy wallet_links_select on public.wallet_links for select to authenticated
  using (user_id = auth.uid());
-- wallet_challenges: không có policy/grant cho client (chỉ service_role).

-- ------------------------------------------------------------- cấu hình & chính sách (công khai, không bí mật)
grant select on public.contract_config, public.policy_versions to anon, authenticated;
create policy contract_config_read on public.contract_config for select to anon, authenticated using (true);
create policy policy_versions_read on public.policy_versions for select to anon, authenticated using (true);

-- ------------------------------------------------------------- machines
grant select on public.machines to authenticated;
grant insert (owner_id, machine_key, name, declared_specs, price_units) on public.machines to authenticated;
grant update (name, declared_specs, price_units) on public.machines to authenticated;
create policy machines_select on public.machines for select to authenticated
  using (owner_id = auth.uid() or public.is_admin(auth.uid()));
create policy machines_insert on public.machines for insert to authenticated
  with check (owner_id = auth.uid() and public.is_approved_host(auth.uid()) and status = 'draft' and active_booking_id is null);
create policy machines_update on public.machines for update to authenticated
  using (owner_id = auth.uid() and public.is_approved_host(auth.uid()))
  with check (owner_id = auth.uid());
-- machine_private_config: không policy/grant cho client.

-- View công khai: chỉ máy đã duyệt của host đã duyệt, chỉ trường an toàn (không owner_id, không endpoint).
create view public.public_machines with (security_invoker = false) as
  select m.id, m.name, m.declared_specs, m.price_units, m.created_at
    from public.machines m
    join public.host_profiles h on h.user_id = m.owner_id
   where m.status = 'approved' and h.status = 'approved';
revoke all on public.public_machines from public, anon, authenticated;
grant select on public.public_machines to anon, authenticated;

-- ------------------------------------------------------------- host_commitments
grant select, insert (machine_id, starts_at, ends_at), update (starts_at, ends_at), delete on public.host_commitments to authenticated;
create policy commitments_all on public.host_commitments for all to authenticated
  using (exists (select 1 from public.machines m where m.id = machine_id and m.owner_id = auth.uid()))
  with check (
    public.is_approved_host(auth.uid())
    and exists (select 1 from public.machines m where m.id = machine_id and m.owner_id = auth.uid())
  );

-- ------------------------------------------------------------- bookings: client chỉ đọc
grant select on public.bookings to authenticated;
create policy bookings_select on public.bookings for select to authenticated
  using (renter_id = auth.uid() or host_id = auth.uid() or public.is_admin(auth.uid()));

-- ------------------------------------------------------------- audit (admin đọc), outbox (không client)
grant select on public.audit_logs to authenticated;
create policy audit_select on public.audit_logs for select to authenticated using (public.is_admin(auth.uid()));

-- ------------------------------------------------------------- quyền thực thi hàm
grant execute on function public.is_admin(uuid), public.is_approved_host(uuid),
  public.booking_is_live(public.booking_state, public.access_state) to authenticated, service_role;
grant execute on function public.review_host(uuid, public.host_status),
  public.submit_machine_for_review(uuid),
  public.review_machine(uuid, public.machine_status),
  public.reserve_machine(uuid, text, text, text) to authenticated, service_role;
-- Chỉ server:
grant execute on function public.consume_wallet_challenge(uuid, text, text, integer, text),
  public.release_machine(uuid),
  public.expire_unfunded_booking(uuid, boolean) to service_role;

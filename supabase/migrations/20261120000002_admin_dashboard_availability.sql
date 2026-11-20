-- Dashboard admin + trạng thái online thật của máy trong danh mục công khai (20/11/2026).
-- Chạy lặp lại được (dán hai lần ở SQL Editor không lỗi).

-- ---------------------------------------------------------------- 1. public_machines.availability
-- Trước: app luôn hiện "Chưa xác minh online" vì danh mục công khai không có tín hiệu nào về agent của host.
-- Nay: cột `availability` tính từ HEARTBEAT của agent đã ghi danh và booking đang sống, KHÔNG dùng lịch/accepting:
--   busy    : máy đang có booking sống (hoặc active_booking_id còn đặt)
--   online  : heartbeat ok (<= 30 giây) hoặc suspect (<= 90 giây); chịu được một hai nhịp bị trễ
--   offline : còn lại (chưa từng có agent, agent đã thu hồi, hoặc mất heartbeat quá 90 giây)
-- Cố ý KHÔNG dùng can_accept_new: nó đòi thêm `accepting` và khung lịch mà reserve_machine không kiểm, nên sẽ chặn ở giao diện một lượt thuê
-- mà máy chủ vẫn nhận. Đây là tín hiệu HIỂN THỊ; reserve_machine không từ chối máy offline (câu hỏi Q1 vẫn mở).
-- Cột mới đặt CUỐI, các cột cũ giữ nguyên (create or replace view yêu cầu vậy). Quyền xem giữ nguyên: chỉ anon/authenticated SELECT.
-- VIẾT THẲNG điều kiện, KHÔNG gọi booking_is_live()/machine_health(): Postgres kiểm quyền EXECUTE của hàm gọi trong view theo NGƯỜI TRUY VẤN
-- (khác với bảng, kiểm theo chủ view), mà hai hàm đó cố ý không cấp cho anon. Cấp thêm quyền hàm cho anon là mở rộng bề mặt không cần thiết.
-- Hai điều kiện dưới đây PHẢI khớp định nghĩa của hai hàm đó (test db/tests/admin.test.ts đối chiếu trực tiếp với machine_health).
create or replace view public.public_machines with (security_invoker = false) as
  select m.id, m.name, m.declared_specs, m.price_units, m.created_at,
         case
           when m.active_booking_id is not null
             or exists (
               select 1 from public.bookings b
                where b.machine_id = m.id
                  and not (b.state in ('settled', 'refunded', 'resolved', 'cancelled', 'expired') and b.access_state in ('not_granted', 'reset_verified'))
             ) then 'busy'
           when exists (
             select 1 from public.device_enrollments d
              where d.machine_id = m.id and d.revoked_at is null and d.enrolled_at is not null
                and d.last_heartbeat_at is not null and now() - d.last_heartbeat_at <= interval '90 seconds'
           ) then 'online'
           else 'offline'
         end as availability
    from public.machines m
    join public.host_profiles h on h.user_id = m.owner_id
   where m.status = 'approved' and h.status = 'approved';
revoke all on public.public_machines from public, anon, authenticated;
grant select on public.public_machines to anon, authenticated;

-- ---------------------------------------------------------------- 2. Admin xoá máy (chỉ khi chưa từng có tiền/phiên)
-- Máy đã có booking từng nhận tiền hoặc từng cấp quyền xem thì KHÔNG xoá (mất lịch sử tiền): chỉ đình chỉ (review_machine 'suspended').
-- Điều kiện xoá: mọi booking của máy đều là expired/cancelled VÀ access_state = not_granted (tức chưa từng qua bước thanh toán hay cấp quyền).
-- Thứ tự: bỏ active_booking_id -> xoá job outbox của các booking đó -> xoá booking -> xoá cam kết (trigger khoá/coverage chạy khi máy còn tồn tại)
-- -> xoá máy (các bảng lịch/ghi danh/availability tự cascade). Lỗi khoá ngoại bất ngờ (bảng khác còn tham chiếu) => has_history, không xoá gì.
create or replace function public.admin_delete_machine(p_machine uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text;
  v_ids text[];
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  select name into v_name from public.machines where id = p_machine for update;
  if not found then raise exception 'unavailable'; end if;
  if exists (
    select 1 from public.bookings b
     where b.machine_id = p_machine and not (b.state in ('expired', 'cancelled') and b.access_state = 'not_granted')
  ) then raise exception 'has_history'; end if;
  select coalesce(array_agg(id::text), '{}') into v_ids from public.bookings where machine_id = p_machine;
  begin
    update public.machines set active_booking_id = null where id = p_machine;
    delete from public.outbox_jobs where payload ->> 'booking_id' = any (v_ids);
    delete from public.bookings where machine_id = p_machine;
    delete from public.host_commitments where machine_id = p_machine;
    delete from public.machines where id = p_machine;
  exception when foreign_key_violation then
    raise exception 'has_history';
  end;
  insert into public.audit_logs (actor, action, resource, outcome, detail)
  values (auth.uid(), 'delete_machine', 'machine:' || p_machine, 'ok', jsonb_build_object('name', v_name, 'bookings_removed', coalesce(array_length(v_ids, 1), 0)));
end $$;
revoke all on function public.admin_delete_machine(uuid) from public, anon;
grant execute on function public.admin_delete_machine(uuid) to authenticated, service_role;

-- Để PostgREST thấy cột mới ngay (Supabase thường tự làm sau DDL; lệnh này chỉ đảm bảo).
notify pgrst, 'reload schema';

-- Vá nhỏ: chuỗi (sequence) tạo ở migration 000003–000005 (identity của chain_events, agent_commands) thừa hưởng quyền mặc định
-- cho anon/authenticated vì migration 000002/000003 chỉ gỡ mặc định của bảng và hàm, không gỡ của sequence.
-- Không có đường khai thác trực tiếp (client không gọi được nextval qua PostgREST), nhưng đóng lại cho chặt và để kiểm tra sạch.
-- service_role (server/worker) vẫn giữ usage/select.

revoke all on all sequences in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

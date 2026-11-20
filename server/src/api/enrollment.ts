/**
 * Enrollment thiết bị host: chủ máy (host đã đăng ký) HOẶC admin tạo token một lần có hạn cho máy đã đăng; thiết bị đổi lấy credential
 * riêng (chỉ lưu băm), thu hồi được; heartbeat có counter tăng nghiêm ngặt (chống replay). Token/credential chỉ trả về MỘT lần, DB chỉ giữ SHA-256.
 * Quyền do hàm DB kiểm (create_enrollment / revoke_device): chủ máy chỉ làm được cho máy CỦA MÌNH, admin làm được cho mọi máy.
 * Đường /api/host/* dành cho chủ máy (đi qua proxy công khai); /api/admin/* chỉ chạy trên máy chủ (proxy chặn).
 */
import { ApiError, ok, pgMessage, randomToken, sha256Bytes, type ApiResult, type ApiUser, type Deps } from "../core";

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);

export async function createEnrollment(deps: Deps, actor: ApiUser, body: unknown): Promise<ApiResult> {
  const b = (body ?? {}) as { machineId?: unknown; ttlSeconds?: unknown };
  if (!uuid(b.machineId)) throw new ApiError(400, "bad_request", "Thiếu machineId.");
  const ttl = b.ttlSeconds === undefined ? 900 : b.ttlSeconds;
  if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 60 || ttl > 3600) throw new ApiError(400, "bad_request", "ttlSeconds phải từ 60 đến 3600.");
  const token = randomToken(32);
  try {
    await deps.db.tx(async (c) => {
      await c.query("select public.create_enrollment($1, $2, $3, $4)", [actor.id, b.machineId, sha256Bytes(token), ttl]);
    });
  } catch (e) {
    const m = pgMessage(e);
    if (m.includes("forbidden")) throw new ApiError(403, "forbidden", "Chỉ chủ máy (host đã đăng ký) hoặc quản trị viên mới ghi danh được máy này.");
    if (m.includes("unavailable")) throw new ApiError(409, "unavailable", "Máy chưa được đăng hoặc đã có thiết bị đang hoạt động. Nếu bạn cài lại bản Linux, hãy tick \"thay thiết bị cũ\" rồi ghi danh lại.");
    throw e;
  }
  return ok({ enrollmentToken: token, ttlSeconds: ttl }, 201);
}

/**
 * Chủ máy (hoặc admin) thu hồi thiết bị đang hiệu lực của một máy (credential cũ lập tức bị từ chối ở heartbeat và kênh lệnh). Cần trước khi
 * ghi danh lại, ví dụ khi host chuyển agent sang môi trường guest khác. Quyền do hàm DB kiểm (không tin claim của client).
 */
export async function revokeDevice(deps: Deps, actor: ApiUser, body: unknown): Promise<ApiResult> {
  const b = (body ?? {}) as { machineId?: unknown };
  if (!uuid(b.machineId)) throw new ApiError(400, "bad_request", "Thiếu machineId.");
  try {
    await deps.db.tx(async (c) => {
      await c.query("select public.revoke_device($1, $2)", [actor.id, b.machineId]);
    });
  } catch (e) {
    if (pgMessage(e).includes("forbidden")) throw new ApiError(403, "forbidden", "Chỉ chủ máy (host đã đăng ký) hoặc quản trị viên mới thu hồi được thiết bị của máy này.");
    throw e;
  }
  return ok({ revoked: true });
}

/** Thiết bị (chưa có credential) đổi token enrollment lấy credential. Không cần đăng nhập người dùng. */
export async function redeemEnrollment(deps: Deps, body: unknown): Promise<ApiResult> {
  const b = (body ?? {}) as { token?: unknown };
  if (typeof b.token !== "string" || b.token.length < 20 || b.token.length > 200) throw new ApiError(400, "bad_request", "Token không hợp lệ.");
  const credential = randomToken(32);
  try {
    const machineId = await deps.db.tx(async (c) => (await c.query<{ m: string }>("select public.redeem_enrollment($1, $2) as m", [sha256Bytes(b.token as string), sha256Bytes(credential)])).rows[0]!.m);
    return ok({ credential, machineId }, 201);
  } catch (e) {
    if (pgMessage(e).includes("invalid_enrollment")) throw new ApiError(400, "invalid_enrollment", "Token không hợp lệ, đã dùng hoặc hết hạn.");
    throw e;
  }
}

/**
 * Agent báo "tôi sắp dừng" (chủ máy dừng nhận thuê, đăng xuất hoặc thoát app): xoá dấu thời gian heartbeat để máy hiện OFFLINE ngay,
 * thay vì chờ hết hạn nhịp tim (tới 90 giây). Cùng cách xác thực credential thiết bị như heartbeat và chỉ ảnh hưởng đúng thiết bị đó.
 * KHÔNG đụng last_counter: lần heartbeat kế tiếp (counter lớn hơn) đưa máy online lại. Cố ý không cần migration (service_role đã có quyền bảng).
 * Agent bị tắt cứng hoặc mất điện không kịp gọi: máy vẫn sang offline khi nhịp tim quá hạn.
 */
export async function agentOffline(deps: Deps, authorization: string | null | undefined): Promise<ApiResult> {
  const m = /^Device ([A-Za-z0-9_-]{20,200})$/.exec(authorization ?? "");
  if (!m) throw new ApiError(401, "unauthorized", "Thiếu credential thiết bị.");
  const machineId = await deps.db.tx(
    async (c) =>
      (await c.query<{ machine_id: string }>(
        "update public.device_enrollments set last_heartbeat_at = null where credential_hash = $1 and revoked_at is null and enrolled_at is not null returning machine_id",
        [sha256Bytes(m[1]!)],
      )).rows[0]?.machine_id ?? null,
  );
  if (!machineId) throw new ApiError(401, "invalid_heartbeat", "Credential không hợp lệ hoặc đã thu hồi.");
  return ok({ ok: true, machineId });
}

/** Heartbeat của thiết bị: Authorization: Device <credential>. */
export async function heartbeat(deps: Deps, authorization: string | null | undefined, body: unknown): Promise<ApiResult> {
  const m = /^Device ([A-Za-z0-9_-]{20,200})$/.exec(authorization ?? "");
  const counter = (body as { counter?: unknown } | null)?.counter;
  if (!m) throw new ApiError(401, "unauthorized", "Thiếu credential thiết bị.");
  if (typeof counter !== "number" || !Number.isSafeInteger(counter) || counter < 1) throw new ApiError(400, "bad_request", "counter phải là số nguyên dương.");
  try {
    const machineId = await deps.db.tx(async (c) => (await c.query<{ m: string }>("select public.record_heartbeat($1, $2) as m", [sha256Bytes(m[1]!), counter])).rows[0]!.m);
    return ok({ ok: true, machineId });
  } catch (e) {
    if (pgMessage(e).includes("invalid_heartbeat")) throw new ApiError(401, "invalid_heartbeat", "Credential không hợp lệ, đã thu hồi hoặc counter không tăng.");
    throw e;
  }
}

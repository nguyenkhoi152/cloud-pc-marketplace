/**
 * Enrollment thiết bị host: admin tạo token một lần có hạn; thiết bị đổi lấy credential riêng (chỉ lưu băm), thu hồi được;
 * heartbeat có counter tăng nghiêm ngặt (chống replay). Token/credential chỉ trả về MỘT lần, DB chỉ giữ SHA-256.
 */
import { ApiError, ok, pgMessage, randomToken, sha256Bytes, type ApiResult, type ApiUser, type Deps } from "../core";

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);

export async function createEnrollment(deps: Deps, admin: ApiUser, body: unknown): Promise<ApiResult> {
  const b = (body ?? {}) as { machineId?: unknown; ttlSeconds?: unknown };
  if (!uuid(b.machineId)) throw new ApiError(400, "bad_request", "Thiếu machineId.");
  const ttl = b.ttlSeconds === undefined ? 900 : b.ttlSeconds;
  if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 60 || ttl > 3600) throw new ApiError(400, "bad_request", "ttlSeconds phải từ 60 đến 3600.");
  const token = randomToken(32);
  try {
    await deps.db.tx(async (c) => {
      await c.query("select public.create_enrollment($1, $2, $3, $4)", [admin.id, b.machineId, sha256Bytes(token), ttl]);
    });
  } catch (e) {
    const m = pgMessage(e);
    if (m.includes("forbidden")) throw new ApiError(403, "forbidden", "Chỉ admin được tạo enrollment.");
    if (m.includes("unavailable")) throw new ApiError(409, "unavailable", "Máy chưa được duyệt hoặc đã có thiết bị đang hiệu lực.");
    throw e;
  }
  return ok({ enrollmentToken: token, ttlSeconds: ttl }, 201);
}

/**
 * Admin thu hồi thiết bị đang hiệu lực của một máy (credential cũ lập tức bị từ chối ở heartbeat và kênh lệnh). Cần trước khi
 * ghi danh lại, ví dụ khi host chuyển agent sang môi trường guest khác. Quyền admin do hàm DB kiểm (không tin claim của client).
 */
export async function revokeDevice(deps: Deps, admin: ApiUser, body: unknown): Promise<ApiResult> {
  const b = (body ?? {}) as { machineId?: unknown };
  if (!uuid(b.machineId)) throw new ApiError(400, "bad_request", "Thiếu machineId.");
  try {
    await deps.db.tx(async (c) => {
      await c.query("select public.revoke_device($1, $2)", [admin.id, b.machineId]);
    });
  } catch (e) {
    if (pgMessage(e).includes("forbidden")) throw new ApiError(403, "forbidden", "Chỉ admin được thu hồi thiết bị.");
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

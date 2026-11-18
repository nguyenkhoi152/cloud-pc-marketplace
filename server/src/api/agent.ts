/**
 * Kênh agent ↔ control plane. Agent (thiết bị đã enroll) chủ động kéo lệnh qua HTTPS — host không mở cổng vào.
 * Lệnh thuộc tập cố định; renter không gửi được shell/đường dẫn/URL/port. Token xem do gateway của host phát, được
 * giữ tới khi renter nhận MỘT lần rồi xoá khỏi DB.
 */
import { ApiError, ok, pgMessage, sha256Bytes, type ApiResult, type ApiUser, type Deps, type ServiceDb } from "../core";
import type { RemoteResult, SessionProvider } from "../worker";

const deviceHash = (authorization: string | null | undefined) => {
  const m = /^Device ([A-Za-z0-9_-]{20,200})$/.exec(authorization ?? "");
  if (!m) throw new ApiError(401, "unauthorized", "Thiếu credential thiết bị.");
  return sha256Bytes(m[1]!);
};

interface CmdRow {
  id: string; booking_id: string; base_action: string; attempt: number; command: string; payload: Record<string, unknown>;
}

export async function pollCommands(deps: Deps, authorization: string | null | undefined): Promise<ApiResult> {
  const hash = deviceHash(authorization);
  try {
    const rows = await deps.db.tx(async (c) => (await c.query<CmdRow>("select id::text, booking_id, base_action, attempt, command, payload from public.agent_poll($1, 5, 60)", [hash])).rows);
    return ok({ commands: rows.map((r) => ({ id: r.id, bookingId: r.booking_id, actionId: `${r.base_action}#${r.attempt}`, command: r.command, payload: r.payload })) });
  } catch (e) {
    if (pgMessage(e).includes("invalid_credential")) throw new ApiError(401, "invalid_credential", "Credential thiết bị không hợp lệ hoặc đã thu hồi.");
    throw e;
  }
}

/** Chỉ chấp nhận URL gateway dạng http(s)://host[:port][/path], không userinfo/query/hash, tối đa 200 ký tự. */
export function cleanGatewayUrl(v: unknown): string {
  if (typeof v !== "string" || v.length > 200) throw new ApiError(400, "bad_request", "gatewayUrl không hợp lệ.");
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ApiError(400, "bad_request", "gatewayUrl không hợp lệ.");
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password || !u.hostname || u.search || u.hash) throw new ApiError(400, "bad_request", "gatewayUrl không hợp lệ.");
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
}

export async function reportCommand(deps: Deps, authorization: string | null | undefined, commandId: unknown, body: unknown): Promise<ApiResult> {
  const hash = deviceHash(authorization);
  if (typeof commandId !== "string" || !/^[0-9]{1,18}$/.test(commandId)) throw new ApiError(400, "bad_request", "Mã lệnh không hợp lệ.");
  const b = (body ?? {}) as { ok?: unknown; unknown?: unknown; evidence?: unknown; gatewayUrl?: unknown; redeemToken?: unknown };
  if (typeof b.ok !== "boolean") throw new ApiError(400, "bad_request", "Thiếu ok.");
  const evidence = typeof b.evidence === "string" ? b.evidence.slice(0, 300) : "";
  try {
    const outcome = await deps.db.tx(async (c) => {
      const cmd = (await c.query<{ command: string; booking_id: string; payload: { redeemTtlSeconds?: number } }>("select command, booking_id, payload from public.agent_commands where id = $1", [commandId])).rows[0];
      if (!cmd) throw new ApiError(404, "unknown_command", "Không có lệnh này.");
      // agent_report kiểm credential ↔ máy sở hữu lệnh (raise nếu không phải) TRƯỚC khi ghi bất cứ gì khác.
      const r = (await c.query<{ r: string }>("select public.agent_report($1, $2, $3, $4, $5::jsonb) as r", [hash, commandId, b.ok, b.unknown === true, JSON.stringify({ evidence })])).rows[0]!.r;
      if (r === "recorded" && cmd.command === "grant" && b.ok) {
        if (typeof b.redeemToken !== "string" || !/^[A-Za-z0-9_-]{20,100}$/.test(b.redeemToken)) throw new ApiError(400, "bad_request", "Thiếu redeemToken hợp lệ cho lệnh grant.");
        const ttl = Math.min(Math.max(Number(cmd.payload.redeemTtlSeconds ?? 600), 30), 900);
        await c.query("select public.grant_store($1, $2, $3, $4)", [cmd.booking_id, cleanGatewayUrl(b.gatewayUrl), b.redeemToken, ttl]);
      }
      return r;
    });
    return ok({ result: outcome });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const m = pgMessage(e);
    if (m.includes("invalid_credential")) throw new ApiError(401, "invalid_credential", "Credential thiết bị không hợp lệ hoặc đã thu hồi.");
    if (m.includes("unknown_command")) throw new ApiError(404, "unknown_command", "Lệnh không thuộc thiết bị này.");
    throw e;
  }
}

/** Renter nhận đường dẫn xem MỘT lần (token đổi một lần của gateway). Không có token thì không có đường vào. */
export async function connectToSession(deps: Deps, user: ApiUser, bookingId: unknown): Promise<ApiResult> {
  if (typeof bookingId !== "string" || !/^[0-9a-f-]{36}$/.test(bookingId)) throw new ApiError(400, "bad_request", "Mã booking không hợp lệ.");
  try {
    const g = await deps.db.tx(async (c) => (await c.query<{ gateway_url: string; redeem_token: string }>("select * from public.grant_claim($1, $2)", [bookingId, user.id])).rows[0]!);
    return ok({ viewerUrl: `${g.gateway_url}/__gw/redeem?t=${encodeURIComponent(g.redeem_token)}`, note: "Đường dẫn dùng một lần; mở trong viewer của app." });
  } catch (e) {
    const m = pgMessage(e);
    if (m.includes("forbidden")) throw new ApiError(404, "not_found", "Không tìm thấy booking.");
    if (m.includes("no_grant")) throw new ApiError(409, "no_grant", "Chưa có quyền xem (phiên chưa Active/chưa cấp, đã nhận hoặc đã hết hạn).");
    throw e;
  }
}

/**
 * SessionProvider thật phía control plane: biến mỗi bước thành lệnh cho host-agent và chờ kết quả có hạn.
 * Hết hạn chờ ⇒ Unknown (không bao giờ coi là thành công); lệnh vẫn nằm trong hàng đợi và được dùng lại khi thử lại.
 */
export function makeControlPlaneProvider(db: ServiceDb, o: { timeoutMs: number; pollMs: number; redeemTtlSeconds?: number }): SessionProvider {
  const run = async (i: { bookingId: string; actionId: string }, command: string, payload: object): Promise<RemoteResult> => {
    const id = await db.tx(async (c) => (await c.query<{ id: string }>("select public.agent_enqueue_command($1, $2, $3, $4::jsonb)::text as id", [i.bookingId, i.actionId, command, JSON.stringify(payload)])).rows[0]!.id);
    const t0 = Date.now();
    for (;;) {
      const st = await db.tx(async (c) => (await c.query<{ status: string; ok: boolean | null; unknown: boolean | null; result: { evidence?: string } | null }>("select * from public.agent_command_state($1)", [id])).rows[0]);
      if (st && (st.status === "done" || st.status === "failed")) {
        if (st.ok) return { ok: true, evidence: st.result?.evidence ?? "" };
        return { ok: false, reason: st.result?.evidence || "agent báo thất bại", unknown: st.unknown === true };
      }
      if (Date.now() - t0 >= o.timeoutMs) return { ok: false, reason: "agent chưa phản hồi", unknown: true };
      await new Promise((r) => setTimeout(r, o.pollMs));
    }
  };
  return {
    prepare: (i) => run(i, "prepare", {}),
    grant: (i) => run(i, "grant", { renterId: i.renterId, endAtMs: i.endAtMs, redeemTtlSeconds: o.redeemTtlSeconds ?? 600 }),
    revoke: (i) => run(i, "revoke", {}),
    reset: (i) => run(i, "reset", {}),
    verifyReset: (i) => run(i, "verify_reset", {}),
  };
}

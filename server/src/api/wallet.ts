/**
 * Liên kết ví bằng challenge một lần. Client không bao giờ gửi thông điệp: server dựng lại từ challenge đã lưu
 * (domain, URI, chain, địa chỉ, tài khoản, nonce, hạn) rồi mới kiểm chữ ký. Hết hạn/dùng lại tính bằng now() của DB.
 */
import { isAddress } from "viem";
import { verifyWalletSignature, walletMessage } from "@cpm/shared/src/wallet";
import { ApiError, ok, pgMessage, randomToken, sha256Hex, type ApiResult, type ApiUser, type Deps } from "../core";

const MAX_OPEN_CHALLENGES = 8; // trong 10 phút / người dùng

export async function walletChallenge(deps: Deps, user: ApiUser, body: unknown): Promise<ApiResult> {
  const b = (body ?? {}) as { address?: unknown; chainId?: unknown };
  if (typeof b.address !== "string" || !isAddress(b.address, { strict: false })) throw new ApiError(400, "bad_address", "Địa chỉ ví không hợp lệ.");
  if (b.chainId !== deps.cfg.chainId) throw new ApiError(400, "wrong_chain", `Sai mạng: cần chain ${deps.cfg.chainId}.`);
  const address = b.address.toLowerCase();
  const nonce = randomToken(16);
  const row = await deps.db.tx(async (c) => {
    const recent = await c.query<{ n: number }>("select count(*)::int as n from public.wallet_challenges where user_id = $1 and created_at > now() - interval '10 minutes'", [user.id]);
    if (recent.rows[0]!.n >= MAX_OPEN_CHALLENGES) throw new ApiError(429, "rate_limited", "Quá nhiều yêu cầu xác minh ví. Thử lại sau ít phút.");
    const r = await c.query<{ created_at: Date; expires_at: Date }>(
      "insert into public.wallet_challenges (user_id, domain, address, chain_id, nonce_hash, expires_at) values ($1, $2, $3, $4, $5, now() + interval '5 minutes') returning created_at, expires_at",
      [user.id, deps.cfg.walletDomain, address, deps.cfg.chainId, sha256Hex(nonce)],
    );
    return r.rows[0]!;
  });
  const message = walletMessage({
    domain: deps.cfg.walletDomain, uri: deps.cfg.walletUri, address, chainId: deps.cfg.chainId, userId: user.id, nonce,
    issuedAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
  });
  return ok({ message, nonce, expiresAt: row.expires_at.toISOString() });
}

export async function walletVerify(deps: Deps, user: ApiUser, body: unknown): Promise<ApiResult> {
  const b = (body ?? {}) as { nonce?: unknown; signature?: unknown };
  if (typeof b.nonce !== "string" || b.nonce.length < 16 || b.nonce.length > 64 || typeof b.signature !== "string") throw new ApiError(400, "bad_request", "Thiếu nonce hoặc chữ ký.");
  const hash = sha256Hex(b.nonce);

  const ch = await deps.db.tx(async (c) => {
    const r = await c.query<{ domain: string; address: string; chain_id: number; created_at: Date; expires_at: Date; live: boolean }>(
      "select domain, address, chain_id, created_at, expires_at, (consumed_at is null and expires_at > now()) as live from public.wallet_challenges where nonce_hash = $1 and user_id = $2",
      [hash, user.id],
    );
    return r.rows[0];
  });
  // Cùng một mã cho không tồn tại / của người khác / đã dùng / hết hạn: không lộ trạng thái.
  if (!ch || !ch.live) throw new ApiError(400, "invalid_challenge", "Yêu cầu xác minh không hợp lệ hoặc đã hết hạn. Hãy tạo yêu cầu mới.");

  const message = walletMessage({
    domain: ch.domain, uri: deps.cfg.walletUri, address: ch.address, chainId: ch.chain_id, userId: user.id, nonce: b.nonce,
    issuedAt: ch.created_at.toISOString(), expiresAt: ch.expires_at.toISOString(),
  });
  if (!(await verifyWalletSignature(message, b.signature, ch.address))) throw new ApiError(401, "bad_signature", "Chữ ký không khớp ví đã khai báo.");

  try {
    await deps.db.tx(async (c) => {
      await c.query("select public.consume_wallet_challenge($1, $2, $3, $4, $5)", [user.id, hash, ch.address, ch.chain_id, ch.domain]);
    });
  } catch (e) {
    const m = pgMessage(e);
    if (m.includes("wallet_change_blocked")) throw new ApiError(409, "wallet_change_blocked", "Không đổi ví khi còn booking chưa kết thúc.");
    if (m.includes("wallet_taken")) throw new ApiError(409, "wallet_taken", "Ví này đã được liên kết với tài khoản khác.");
    if (m.includes("invalid_challenge")) throw new ApiError(400, "invalid_challenge", "Yêu cầu xác minh đã được dùng hoặc hết hạn.");
    throw e;
  }
  return ok({ linked: true, address: ch.address, chainId: ch.chain_id });
}

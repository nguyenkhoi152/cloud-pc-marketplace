/**
 * POST /api/faucet — vòi testnet cho ví ĐÃ XÁC MINH của chính người dùng đang đăng nhập (không nhận địa chỉ từ client).
 *  - PCP: mint một lần/ví (hợp đồng ép bằng faucetClaimed; server cũng kiểm trước để không tốn gas vô ích).
 *  - Gas: nếu số dư AVAX thấp hơn ngưỡng và ví/tài khoản chưa được nhỏ giọt trong 24 giờ qua thì chuyển một ít AVAX.
 *  - Chống lạm dụng: tối đa 4 yêu cầu/10 phút/người dùng (đếm cả yêu cầu lỗi); khoá cố vấn theo ví để hai yêu cầu đồng thời không nhỏ giọt hai lần.
 * Tắt hẳn nếu server không được cấp khoá vòi (503). Mọi quyết định ghi audit_logs.
 *
 * Hai transaction riêng: (1) kiểm hạn mức + ghi dòng yêu cầu và COMMIT ngay, (2) hành động trên chuỗi. Lỗi chuỗi được trả về SAU khi commit (không ném bên
 * trong transaction), nếu không dòng đếm yêu cầu và bản ghi nhỏ giọt gas đã gửi sẽ bị hoàn tác theo.
 */
import { ApiError, ok, type ApiResult, type ApiUser, type Deps } from "../core";
import type { FaucetChain } from "../chainFaucet";

export interface FaucetDeps {
  chain: FaucetChain;
  /** Lượng AVAX gas nhỏ giọt mỗi lần (wei). */
  gasWei: bigint;
  /** Chỉ nhỏ giọt khi số dư thấp hơn mức này (wei). */
  minGasWei: bigint;
}

const REQUESTS_PER_WINDOW = 4;

type Outcome = { ok: Record<string, unknown> } | { fail: string };

export async function requestFaucet(deps: Deps & { faucet?: FaucetDeps }, user: ApiUser): Promise<ApiResult> {
  const f = deps.faucet;
  if (!f) throw new ApiError(503, "faucet_disabled", "Máy chủ này không bật vòi testnet.");

  // (1) Hạn mức: dòng yêu cầu được ghi (và commit) trước khi chạm chuỗi, kể cả khi bước sau lỗi.
  const address = await deps.db.tx(async (c) => {
    const w = await c.query<{ address: string }>("select address from public.wallet_links where user_id = $1", [user.id]);
    const addr = w.rows[0]?.address;
    if (!addr) throw new ApiError(409, "wallet_required", "Cần liên kết ví đã xác minh trước khi nhận PCP thử.");
    const recent = await c.query<{ n: number }>("select count(*)::int as n from public.audit_logs where actor = $1 and action = 'faucet_request' and created_at > now() - interval '10 minutes'", [user.id]);
    if (recent.rows[0]!.n >= REQUESTS_PER_WINDOW) throw new ApiError(429, "rate_limited", "Quá nhiều yêu cầu nhận PCP thử. Thử lại sau ít phút.");
    await c.query("insert into public.audit_logs (actor, action, resource, outcome) values ($1, 'faucet_request', $2, 'ok')", [user.id, `wallet:${addr}`]);
    return addr;
  });

  // (2) Hành động trên chuỗi, mỗi ví một lúc (khoá giữ tới hết transaction).
  const out = await deps.db.tx<Outcome>(async (c) => {
    await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`faucet:${address}`]);
    let pcp: { claimed: boolean; minted: boolean; txHash?: string } = { claimed: false, minted: false };
    let gas: { balanceWei: string; sent: boolean; txHash?: string; reason?: string } = { balanceWei: "0", sent: false };
    try {
      if (await f.chain.pcpClaimed(address)) pcp = { claimed: true, minted: false };
      else {
        try {
          const tx = await f.chain.mintPcp(address);
          pcp = { claimed: true, minted: true, txHash: tx };
          await c.query("insert into public.audit_logs (actor, action, resource, outcome) values ($1, 'faucet_pcp', $2, 'ok')", [user.id, `wallet:${address}`]);
        } catch {
          // Hợp đồng từ chối (ví dụ vừa được nhận ở yêu cầu khác): đọc lại để báo đúng trạng thái.
          pcp = { claimed: await f.chain.pcpClaimed(address), minted: false };
        }
      }
      const before = await f.chain.gasBalance(address);
      gas = { balanceWei: before.toString(), sent: false };
      if (before < f.minGasWei) {
        const dripped = await c.query<{ n: number }>("select count(*)::int as n from public.audit_logs where action = 'faucet_gas' and (resource = $1 or actor = $2) and created_at > now() - interval '24 hours'", [`wallet:${address}`, user.id]);
        // Theo ví VÀ theo người dùng: liên kết ví mới liên tục không né được giới hạn để rút cạn ví vòi.
        if (dripped.rows[0]!.n > 0) gas = { ...gas, reason: "Bạn đã nhận AVAX trong 24 giờ qua. Nếu cần thêm, hãy nạp AVAX Fuji vào địa chỉ ví của bạn." };
        else {
          const tx = await f.chain.sendGas(address, f.gasWei);
          // Ghi NGAY sau khi gửi (gas đã rời ví vòi): không có bước nào có thể ném lỗi giữa gửi và ghi.
          await c.query("insert into public.audit_logs (actor, action, resource, outcome) values ($1, 'faucet_gas', $2, 'ok')", [user.id, `wallet:${address}`]);
          gas = { balanceWei: (before + f.gasWei).toString(), sent: true, txHash: tx };
        }
      }
    } catch (e) {
      return { fail: String((e as Error).message).slice(0, 120) };
    }
    return { ok: { address, pcp, gas } };
  });
  if ("fail" in out) throw new ApiError(502, "faucet_chain_error", `Vòi gặp lỗi khi gọi chuỗi: ${out.fail}`);
  return ok(out.ok);
}

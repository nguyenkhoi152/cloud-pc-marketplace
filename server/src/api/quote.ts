/**
 * Cấp quote EIP-712 đã ký cho booking `reserved` của chính renter. Mọi giá trị lấy từ snapshot bất biến trong DB;
 * client không gửi giá/ví/hạn. Không cấp khi: không phải chủ booking, sai trạng thái, sắp/đã hết hạn giữ máy,
 * thiếu ví renter/host, hoặc máy còn bị chiếm trên chuỗi.
 */
import { keccak256, toBytes, type Hex } from "viem";
import { ApiError, ok, type ApiResult, type ApiUser, type Deps } from "../core";
import { buildQuote, QuoteError, quoteDomain, quoteToJson, signQuote } from "@cpm/shared/src/quote";

interface Row {
  id: string; state: string; price_units: string; fee_bps: number; duration_seconds: number;
  fund_by: string; activate_by: string; cid: string; machine_key: string; body_sha256: string;
  quotable: boolean; renter_wallet: string | null; host_wallet: string | null;
}

export async function issueQuote(deps: Deps, user: ApiUser, bookingId: unknown, escrowReader?: { machineOccupied(key: Hex): Promise<boolean> }): Promise<ApiResult> {
  if (typeof bookingId !== "string" || !/^[0-9a-f-]{36}$/.test(bookingId)) throw new ApiError(400, "bad_request", "Mã booking không hợp lệ.");
  const r = await deps.db.tx(async (c) => {
    const q = await c.query<Row>(
      `select b.id, b.state, b.price_units::text, b.fee_bps, b.duration_seconds,
              floor(extract(epoch from b.fund_by))::bigint::text as fund_by, floor(extract(epoch from b.activate_by))::bigint::text as activate_by,
              encode(b.chain_booking_id, 'hex') as cid, m.machine_key, pv.body_sha256,
              (b.fund_by > now() + interval '5 seconds') as quotable, rw.address as renter_wallet, hw.address as host_wallet
         from public.bookings b
         join public.machines m on m.id = b.machine_id
         join public.policy_versions pv on pv.id = b.policy_version_id
         left join public.wallet_links rw on rw.user_id = b.renter_id
         left join public.wallet_links hw on hw.user_id = b.host_id
        where b.id = $1 and b.renter_id = $2`,
      [bookingId, user.id],
    );
    return q.rows[0];
  });
  if (!r) throw new ApiError(404, "not_found", "Không tìm thấy booking.");
  if (r.state !== "reserved") throw new ApiError(409, "invalid_state", "Booking không còn ở trạng thái chờ thanh toán.");
  if (!r.quotable) throw new ApiError(410, "quote_expired", "Hết hạn giữ máy; hãy giữ máy lại.");
  if (!r.renter_wallet) throw new ApiError(409, "wallet_required", "Cần liên kết ví đã xác minh trước khi thanh toán.");
  if (!r.host_wallet) throw new ApiError(409, "host_wallet_required", "Host chưa liên kết ví nhận tiền.");

  if (escrowReader && (await escrowReader.machineOccupied(keccak256(toBytes(r.machine_key))))) {
    throw new ApiError(409, "machine_occupied_onchain", "Máy đang bị chiếm trên chuỗi; chưa thể cấp quote.");
  }
  let quote;
  try {
    quote = buildQuote({
      bookingId: `0x${r.cid}`, machineKey: r.machine_key, renter: r.renter_wallet, host: r.host_wallet, token: deps.cfg.pcp, treasury: deps.cfg.treasury,
      priceUnits: r.price_units, feeBps: r.fee_bps, durationSeconds: r.duration_seconds, fundBy: Number(r.fund_by), activateBy: Number(r.activate_by),
      graceSeconds: deps.cfg.graceSeconds, arbitrationSeconds: deps.cfg.arbitrationSeconds, policySha256: r.body_sha256, configVersion: deps.cfg.configVersion,
    });
  } catch (e) {
    if (e instanceof QuoteError) throw new ApiError(409, "quote_invalid", `Không thể dựng quote: ${e.message}`);
    throw e;
  }
  const signature = await signQuote(deps.cfg.quoteSigner, quote, quoteDomain(deps.cfg.chainId, deps.cfg.escrow));
  await deps.db.tx(async (c) => {
    await c.query("insert into public.audit_logs (actor, action, resource, outcome) values ($1, 'issue_quote', $2, 'ok')", [user.id, `booking:${bookingId}`]);
  });
  return ok({ quote: quoteToJson(quote), signature, escrow: deps.cfg.escrow, chainId: deps.cfg.chainId });
}

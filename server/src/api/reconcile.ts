/**
 * Xác minh giao dịch và đối soát: sự kiện chuỗi chỉ được áp dụng sau khi (1) đọc từ receipt/log thật, đủ confirmation,
 * đúng địa chỉ escrow; (2) khớp snapshot trong DB (ví renter/host, token, treasury, giá, phí, hạn, khoá máy); (3) qua
 * apply_chain_event idempotent theo (chain, contract, tx, log). Tx hash từ client chỉ là gợi ý để biết đọc receipt nào.
 */
import { keccak256, toBytes, type Hex } from "viem";
import { readEscrowEvents, type EscrowEvent, type EscrowReadResult } from "@cpm/shared/src/chainEvents";
import { ApiError, ok, type ApiResult, type ApiUser, type Deps, type ServerConfig, type Tx } from "../core";

export interface BookingChainRow {
  id: string; state: string; cid: string; price_units: string; fee_bps: number; duration_seconds: number;
  fund_by: string; activate_by: string; machine_key: string; renter_id: string;
  renter_wallet: string | null; host_wallet: string | null;
}

export const BOOKING_CHAIN_SQL = `
  select b.id, b.state, encode(b.chain_booking_id, 'hex') as cid, b.price_units::text, b.fee_bps, b.duration_seconds, b.renter_id,
         floor(extract(epoch from b.fund_by))::bigint::text as fund_by, floor(extract(epoch from b.activate_by))::bigint::text as activate_by,
         m.machine_key, rw.address as renter_wallet, hw.address as host_wallet
    from public.bookings b
    join public.machines m on m.id = b.machine_id
    left join public.wallet_links rw on rw.user_id = b.renter_id
    left join public.wallet_links hw on hw.user_id = b.host_id`;

const eq = (a: string | null | undefined, b: string) => (a ?? "").toLowerCase() === b.toLowerCase();

/** Trả lý do từ chối nếu sự kiện không khớp snapshot; null nếu hợp lệ. */
export function validateEvent(cfg: ServerConfig, r: BookingChainRow, ev: EscrowEvent): string | null {
  if (ev.bookingId.toLowerCase() !== `0x${r.cid}`) return "booking_id";
  const d = ev.data;
  if (ev.event === "Funded") {
    if (!r.renter_wallet || !eq(d.renter, r.renter_wallet)) return "renter";
    if (!r.host_wallet || !eq(d.host, r.host_wallet)) return "host";
    if (!eq(d.token, cfg.pcp)) return "token";
    if (!eq(d.treasury, cfg.treasury)) return "treasury";
    if (!eq(d.machineKey, keccak256(toBytes(r.machine_key)))) return "machine_key";
    if (d.priceUnits !== r.price_units) return "price";
    if (d.feeBps !== String(r.fee_bps)) return "fee";
    if (d.fundBy !== r.fund_by || d.activateBy !== r.activate_by) return "deadline";
  }
  if (ev.event === "Activated" && BigInt(d.endAt ?? "0") - BigInt(d.startedAt ?? "0") !== BigInt(r.duration_seconds)) return "duration";
  return null;
}

export interface AppliedEvent {
  event: string; tx: string; logIndex: number; outcome: string;
}

/** Áp dụng các sự kiện (đã sắp theo block, logIndex) cho một booking; mỗi sự kiện hợp lệ đi qua apply_chain_event. */
export async function applyEvents(deps: Deps, c: Tx, r: BookingChainRow, events: EscrowEvent[]): Promise<AppliedEvent[]> {
  const out: AppliedEvent[] = [];
  for (const ev of [...events].sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex)) {
    const bad = validateEvent(deps.cfg, r, ev);
    if (bad) {
      await c.query("insert into public.audit_logs (actor, action, resource, outcome, detail) values (null, 'chain_event_rejected', $1, $2, $3::jsonb)", [
        `booking:${r.id}`, `mismatch:${bad}`, JSON.stringify({ event: ev.event, tx: ev.txHash }),
      ]);
      out.push({ event: ev.event, tx: ev.txHash, logIndex: ev.logIndex, outcome: `rejected_${bad}` });
      continue;
    }
    const res = await c.query<{ r: string }>("select public.apply_chain_event($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) as r", [
      deps.cfg.chainId, deps.cfg.escrow.toLowerCase(), ev.txHash.toLowerCase(), ev.logIndex, ev.blockNumber.toString(), ev.blockHash.toLowerCase(),
      ev.event, Buffer.from(r.cid, "hex"), JSON.stringify(ev.data),
    ]);
    const outcome = res.rows[0]!.r;
    // Bước tiếp của vòng đời được xếp hàng cùng transaction: không phụ thuộc client/tab còn mở.
    if (outcome === "applied" && ev.event === "Funded") await c.query("select public.enqueue_job($1, 'prepare_session', $2::jsonb, 0)", [`prepare:${r.id}`, JSON.stringify({ booking_id: r.id })]);
    if (outcome === "applied" && ev.event === "Activated") await c.query("select public.enqueue_job($1, 'grant_session', $2::jsonb, 0)", [`grant:${r.id}`, JSON.stringify({ booking_id: r.id })]);
    if (outcome === "applied" && (ev.event === "Settled" || ev.event === "Refunded" || ev.event === "Resolved" || ev.event === "DisputeOpened"))
      await c.query("select public.enqueue_job($1, 'revoke_session', $2::jsonb, 0)", [`revoke:${r.id}:${ev.event}`, JSON.stringify({ booking_id: r.id, reason: ev.event })]);
    out.push({ event: ev.event, tx: ev.txHash, logIndex: ev.logIndex, outcome });
  }
  return out;
}

/** API cho renter: đọc receipt của tx họ gợi ý và áp dụng sự kiện thuộc booking của họ. */
export async function reconcileByTx(deps: Deps, user: ApiUser, bookingId: unknown, txHash: unknown): Promise<ApiResult> {
  if (typeof bookingId !== "string" || !/^[0-9a-f-]{36}$/.test(bookingId)) throw new ApiError(400, "bad_request", "Mã booking không hợp lệ.");
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new ApiError(400, "bad_request", "Mã giao dịch không hợp lệ.");
  if (!deps.chain) throw new ApiError(503, "chain_unavailable", "Máy chủ chưa cấu hình RPC chuỗi.");
  const row = await deps.db.tx(async (c) => (await c.query<BookingChainRow>(`${BOOKING_CHAIN_SQL} where b.id = $1 and b.renter_id = $2`, [bookingId, user.id])).rows[0]);
  if (!row) throw new ApiError(404, "not_found", "Không tìm thấy booking.");

  let read: EscrowReadResult;
  try {
    read = await readEscrowEvents(deps.chain, { escrow: deps.cfg.escrow, txHash: txHash as Hex, minConfirmations: deps.cfg.minConfirmations });
  } catch {
    throw new ApiError(503, "chain_unavailable", "Không đọc được dữ liệu chuỗi; thử lại sau.");
  }
  if (read.status !== "ok") {
    if (read.status === "reverted") throw new ApiError(409, "tx_reverted", "Giao dịch bị revert; không có khoản tiền nào được ghi nhận.");
    return ok({ status: "pending" }, 202);
  }
  const mine = read.events.filter((e) => e.bookingId.toLowerCase() === `0x${row.cid}`);
  if (mine.length === 0) throw new ApiError(422, "no_matching_event", "Giao dịch không chứa sự kiện của booking này.");
  const applied = await deps.db.tx((c) => applyEvents(deps, c, row, mine));
  return ok({ status: "ok", applied });
}

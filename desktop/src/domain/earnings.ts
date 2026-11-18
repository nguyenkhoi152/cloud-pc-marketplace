/**
 * Thu nhập của host từ các phiên thuê, suy ra từ booking mà host đọc được (RLS: chỉ booking của máy mình).
 * Chỉ tính phần host nhận theo công thức phí của escrow (splitFeeUnits). Phiên "đã phân xử" (resolved) bị trọng tài chia theo cách khác
 * nên KHÔNG đưa vào tổng (không biết số tiền); hiện riêng. Số tiền là chuỗi số nguyên (đơn vị nhỏ nhất), cộng bằng bigint.
 * Đây là số do máy chủ ghi nhận; số DƯ CÓ THỂ RÚT thật nằm trên escrow (đọc riêng bằng ví) — hai con số có thể lệch tới khi worker đối soát.
 */
import { splitFeeUnits } from "../api/live";

export interface EarningInput { id: string; state: string; priceUnits: string; feeBps: number; createdAt: string; endAt: string | null }
export interface EarningRow { id: string; hostUnits: string; createdAt: string; endAt: string | null }
export interface Earnings {
  /** Đã hoàn tất (settled): host được ghi có trên escrow. */
  settled: EarningRow[];
  /** Đang giữ trong escrow, chưa hoàn tất (funded/active). */
  pending: EarningRow[];
  /** Đã phân xử: số tiền do trọng tài quyết định, không cộng vào tổng. */
  resolved: EarningRow[];
  settledTotal: string;
  pendingTotal: string;
}

const sum = (rows: EarningRow[]) => rows.reduce((a, r) => a + BigInt(r.hostUnits), 0n).toString();

export function summarizeEarnings(bookings: EarningInput[]): Earnings {
  const row = (b: EarningInput): EarningRow => ({ id: b.id, hostUnits: splitFeeUnits(b.priceUnits, b.feeBps).host, createdAt: b.createdAt, endAt: b.endAt });
  const by = (f: (s: string) => boolean) => bookings.filter((b) => f(b.state)).map(row).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const settled = by((s) => s === "settled");
  const pending = by((s) => s === "funded" || s === "active");
  const resolved = by((s) => s === "resolved");
  return { settled, pending, resolved, settledTotal: sum(settled), pendingTotal: sum(pending) };
}

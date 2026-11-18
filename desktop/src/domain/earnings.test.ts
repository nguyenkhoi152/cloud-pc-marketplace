import { describe, expect, it } from "vitest";
import { summarizeEarnings, type EarningInput } from "./earnings";

const b = (id: string, state: string, price: string, createdAt: string, feeBps = 1000): EarningInput => ({ id, state, priceUnits: price, feeBps, createdAt, endAt: null });

describe("summarizeEarnings", () => {
  it("chỉ tính phần host sau phí; settled và pending tách riêng; hết hạn/hủy/hoàn tiền không có thu nhập", () => {
    const e = summarizeEarnings([
      b("a", "settled", "1000000000000000000", "2026-11-12T10:00:00Z"), // 1 PCP, phí 10% ⇒ host 0.9
      b("b", "settled", "500000000000000000", "2026-11-12T11:00:00Z"), // 0.5 ⇒ 0.45
      b("c", "active", "2000000000000000000", "2026-11-12T12:00:00Z"), // pending 1.8
      b("d", "funded", "100", "2026-11-12T12:30:00Z", 1000),
      b("e", "expired", "999", "2026-11-12T09:00:00Z"),
      b("f", "refunded", "999", "2026-11-12T09:00:00Z"),
      b("g", "cancelled", "999", "2026-11-12T09:00:00Z"),
      b("h", "reserved", "999", "2026-11-12T09:00:00Z"),
    ]);
    expect(e.settled.map((r) => r.id)).toEqual(["b", "a"]); // mới nhất trước
    expect(e.settledTotal).toBe("1350000000000000000");
    expect(e.pending.map((r) => r.id)).toEqual(["d", "c"]);
    expect(e.pendingTotal).toBe((1800000000000000000n + 90n).toString());
    expect(e.resolved).toEqual([]);
  });
  it("phần lẻ khi chia phí về host (khớp escrow); số rất lớn không mất chính xác", () => {
    expect(summarizeEarnings([b("x", "settled", "999", "2026-11-12T00:00:00Z", 1000)]).settledTotal).toBe("900"); // phí 99, host 900
    expect(summarizeEarnings([b("x", "settled", "9", "2026-11-12T00:00:00Z", 1000)]).settledTotal).toBe("9"); // phí 0 do làm tròn xuống, host nhận cả 9
    const big = "123456789012345678901234567890";
    expect(summarizeEarnings([b("x", "settled", big, "2026-11-12T00:00:00Z", 0)]).settledTotal).toBe(big);
  });
  it("phiên đã phân xử (resolved) hiện riêng và KHÔNG cộng vào tổng", () => {
    const e = summarizeEarnings([b("r", "resolved", "1000", "2026-11-12T00:00:00Z"), b("s", "settled", "1000", "2026-11-12T01:00:00Z")]);
    expect(e.resolved.map((r) => r.id)).toEqual(["r"]);
    expect(e.settledTotal).toBe("900");
  });
  it("không có booking ⇒ mọi tổng bằng 0", () => {
    expect(summarizeEarnings([])).toMatchObject({ settledTotal: "0", pendingTotal: "0", settled: [], pending: [], resolved: [] });
  });
});

// Quét sự kiện theo trang (RPC công khai giới hạn khoảng khối). Client là bản GIẢ có nhãn mô phỏng giới hạn của RPC thật đã đo ngày 12/11/2026:
// api.avax-test.network = 100 khối ("exceeds the maximum of 100 blocks"), publicnode = 50.000, drpc free = 10.000.
import { describe, expect, it } from "vitest";
import { scanBookingEvents, type LogsClientLike } from "@cpm/shared/src/chainEvents";

const bookingId = ("0x" + "ab".repeat(32)) as `0x${string}`;
const log = (blockNumber: bigint, logIndex = 0) => ({ eventName: "Funded", args: { bookingId, renter: "0x" + "11".repeat(20) }, logIndex, blockNumber, blockHash: ("0x" + "cd".repeat(32)) as `0x${string}`, transactionHash: ("0x" + "ef".repeat(32)) as `0x${string}` });

function fakeClient(o: { head: bigint; limit: bigint | null; logs?: ReturnType<typeof log>[]; errFor?: (from: bigint, to: bigint) => Error | null; msg?: (limit: bigint) => string }) {
  const calls: [bigint, bigint][] = [];
  const client = {
    getBlockNumber: async () => o.head,
    getContractEvents: async (a: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push([a.fromBlock, a.toBlock]);
      const forced = o.errFor?.(a.fromBlock, a.toBlock);
      if (forced) throw forced;
      if (o.limit !== null && a.toBlock - a.fromBlock + 1n > o.limit) throw new Error(o.msg ? o.msg(o.limit) : `block range too large: total block range in this request exceeds the maximum of ${o.limit} blocks`);
      return (o.logs ?? []).filter((l) => l.blockNumber >= a.fromBlock && l.blockNumber <= a.toBlock);
    },
  } as unknown as LogsClientLike;
  return { client, calls };
}
const scan = (c: LogsClientLike, extra: object = {}) => scanBookingEvents(c, { escrow: "0x" + "e5".repeat(20), bookingId, fromBlock: 1_000n, minConfirmations: 1, ...extra });

describe("scanBookingEvents theo trang", () => {
  it("RPC giới hạn 100 khối (Fuji công khai): tự học giới hạn từ thông báo, phủ KÍN [from, safe] không sót khối, tìm đủ log ở mọi trang", async () => {
    const logs = [log(1_005n), log(1_099n), log(1_100n), log(2_345n, 1), log(2_345n, 0), log(5_000n)];
    const { client, calls } = fakeClient({ head: 5_000n, limit: 100n, logs });
    const r = await scan(client);
    expect(r.safeBlock).toBe(5_000n);
    expect(r.events.map((e) => [e.blockNumber, e.logIndex])).toEqual([[1_005n, 0], [1_099n, 0], [1_100n, 0], [2_345n, 0], [2_345n, 1], [5_000n, 0]]); // đủ + đúng thứ tự (block, logIndex)
    // Phủ liền mạch: mỗi trang bắt đầu ngay sau trang thành công trước, kết thúc đúng ở safeBlock.
    const ok = calls.filter(([f, t]) => t - f + 1n <= 100n);
    expect(ok[0]![0]).toBe(1_000n);
    for (let i = 1; i < ok.length; i++) expect(ok[i]![0]).toBe(ok[i - 1]![1] + 1n);
    expect(ok.at(-1)![1]).toBe(5_000n);
    // Chỉ lần đầu đi qua thông báo để học giới hạn: các trang sau đã dùng ≤ 100, không đập vào lỗi lặp lại.
    expect(calls.filter(([f, t]) => t - f + 1n > 100n)).toHaveLength(1);
  });
  it("RPC không nêu con số trong thông báo: giảm một nửa cho tới khi vừa", async () => {
    const { client } = fakeClient({ head: 3_000n, limit: 700n, logs: [log(1_500n), log(2_900n)], msg: () => "query returned more than allowed: range too wide" });
    expect((await scan(client)).events.map((e) => e.blockNumber)).toEqual([1_500n, 2_900n]);
  });
  it("không cần phân trang khi RPC cho phép khoảng lớn: đúng MỘT lần gọi (như trước)", async () => {
    const { client, calls } = fakeClient({ head: 6_000n, limit: null, logs: [log(1_200n)] });
    const r = await scan(client);
    expect(calls).toEqual([[1_000n, 6_000n]]);
    expect(r.events).toHaveLength(1);
  });
  it("giới hạn 50.000 của publicnode: một ngày dữ liệu (~43k khối) vẫn chỉ một lần gọi khi trang mặc định rộng hơn", async () => {
    const { client, calls } = fakeClient({ head: 44_000n, limit: 50_000n, logs: [log(30_000n)] });
    await scan(client, { maxBlockRange: 50_000n });
    expect(calls).toHaveLength(1);
  });
  it("lỗi KHÔNG liên quan khoảng khối (mạng, 5xx) ném ra ngay để worker thử lại sau, không vòng lặp", async () => {
    const { client, calls } = fakeClient({ head: 5_000n, limit: null, errFor: () => new TypeError("fetch failed") });
    await expect(scan(client)).rejects.toThrow(/fetch failed/);
    expect(calls).toHaveLength(1);
  });
  it("lỗi 'khoảng khối' dai dẳng ở cỡ 1 khối không treo vô hạn", async () => {
    const { client } = fakeClient({ head: 1_010n, limit: null, errFor: () => new Error("block range too large") });
    await expect(scan(client)).rejects.toThrow(/block range/);
  });
  it("chưa đủ confirmation / head thấp hơn from: không gọi getLogs", async () => {
    const { client, calls } = fakeClient({ head: 999n, limit: null });
    expect((await scan(client)).events).toEqual([]);
    expect(calls).toHaveLength(0);
    const c2 = fakeClient({ head: 1_001n, limit: null });
    expect((await scan(c2.client, { minConfirmations: 5 })).events).toEqual([]); // safe = 997 < from
    expect(c2.calls).toHaveLength(0);
  });
});

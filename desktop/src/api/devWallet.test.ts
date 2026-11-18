// Ví giả lập: kiểm cổng bảo vệ (chỉ loopback), khoá bền, provider EIP-1193 ký được và server khôi phục đúng địa chỉ, lỗi hợp đồng dịch sang tiếng Việt.
import { recoverMessageAddress } from "viem";
import { describe, expect, it } from "vitest";
import { ServiceError } from "../mock/scenarios";
import { assertLocalHardhat, createDevWallet, devWalletRpc, loadDevKey, makeSender, mapChainError, reconcileAfterTx, STALE_NONCE, toQuote } from "./devWallet";

const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
/**
 * Nút RPC GIẢ có nhãn. Dạng trả lời của "hardhat" chép từ nút Hardhat 3.21.2 THẬT (12/11/2026): hardhat_metadata có
 * clientVersion "edr/…" (không chứa chữ hardhat) + instanceId; web3_clientVersion là "HardhatNetwork/…".
 * "real" giống một RPC thật (Fuji/mainnet): không biết hardhat_metadata. "liar" trả lời hardhat_metadata nhưng tự nhận là Geth.
 * "half" có hardhat_metadata đúng dạng nhưng web3_clientVersion của mạng khác.
 */
const rpcFetch = (kind: "hardhat" | "real" | "liar" | "half", seen: string[] = []) =>
  (async (_u: unknown, init: { body?: string }) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string };
    seen.push(req.method);
    const reply = (body: object) => new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, ...body }), { headers: { "content-type": "application/json" } });
    if (req.method === "hardhat_metadata") {
      if (kind === "hardhat" || kind === "half") return reply({ result: { clientVersion: "edr/0.3.8/revm/42.0.1", chainId: 43113, instanceId: "0x629a64b2843fea5b8de64d993ef6d44918e18a1f8255b93c644367736af819b7", latestBlockNumber: 3 } });
      if (kind === "liar") return reply({ result: { clientVersion: "Geth/v1.13.0" } });
      return reply({ error: { code: -32601, message: "the method hardhat_metadata does not exist/is not available" } });
    }
    if (req.method === "web3_clientVersion") return reply({ result: kind === "hardhat" ? "HardhatNetwork/3.21.2/@nomicfoundation/edr/0.3.8" : kind === "half" ? "avalanchego/1.13.0" : "Geth/v1.13.0" });
    return reply({ result: "0xa869" });
  }) as unknown as typeof fetch;
const chainIdFetch = rpcFetch("hardhat");
const utf8Hex = (s: string) => "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

describe("cổng bảo vệ: chỉ chuỗi loopback", () => {
  it("chấp nhận http loopback, từ chối mọi thứ khác (https, host ngoài, chuỗi trống, có đường dẫn, Fuji RPC)", () => {
    expect(devWalletRpc("http://127.0.0.1:8545")).toBe("http://127.0.0.1:8545");
    expect(devWalletRpc(" http://localhost:8545/ ")).toBe("http://localhost:8545");
    for (const bad of [undefined, "", "https://127.0.0.1:8545", "http://10.0.0.5:8545", "https://api.avax-test.network/ext/bc/C/rpc", "http://127.0.0.1:8545/rpc", "http://127.0.0.1.evil.example:8545", "ws://127.0.0.1:8545"]) {
      expect(devWalletRpc(bad as string | undefined), String(bad)).toBeNull();
    }
  });
  it("createDevWallet từ chối RPC không phải loopback", () => {
    expect(() => createDevWallet({ rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc", key: loadDevKey(memStore()) })).toThrow(ServiceError);
  });
});

describe("cổng bảo vệ thứ hai: nút ở loopback phải tự nhận là Hardhat (chống cổng loopback bị chuyển tiếp tới mạng thật)", () => {
  const key = () => loadDevKey(memStore());
  const server = { issueQuote: async () => { throw new Error("không được gọi máy chủ khi ví đã từ chối"); }, reconcile: async () => { throw new Error("không được gọi"); } };
  const chain = { chainId: 43113, escrow: ("0x" + "e5".repeat(20)) as `0x${string}` };
  const id = ("0x" + "12".repeat(32)) as `0x${string}`;

  it("RPC thật sau cổng loopback (không biết hardhat_metadata): KHÔNG ký, KHÔNG gửi giao dịch, KHÔNG xin quote", async () => {
    const seen: string[] = [];
    const dw = createDevWallet({ rpcUrl: "http://127.0.0.1:8545", key: key(), fetchFn: rpcFetch("real", seen) });
    const refused = { code: "unsupported", message: expect.stringContaining("không phải nút Hardhat") };
    await expect(dw.provider.request({ method: "personal_sign", params: [utf8Hex("x"), dw.address] })).rejects.toMatchObject(refused);
    await expect(dw.provider.request({ method: "eth_chainId" })).rejects.toMatchObject(refused);
    await expect(dw.pay("b1", server)).rejects.toMatchObject(refused);
    await expect(dw.accept({ bookingId: "b1", chainBookingId: id, chain }, server)).rejects.toMatchObject(refused);
    await expect(dw.cancelBeforeStart({ bookingId: "b1", chainBookingId: id, chain }, server)).rejects.toMatchObject(refused);
    await expect(dw.balance(("0x" + "c1".repeat(20)) as `0x${string}`)).rejects.toMatchObject(refused);
    // Chỉ có lời hỏi hardhat_metadata đi ra; không có giao dịch, không nạp ví, không đọc gì khác.
    expect([...new Set(seen)]).toEqual(["hardhat_metadata"]);
    for (const m of ["eth_sendRawTransaction", "eth_sendTransaction", "hardhat_setBalance", "eth_call"]) expect(seen).not.toContain(m);
  });
  it("ví đã liên kết khác ví của cửa sổ này ⇒ báo đúng việc cần làm, KHÔNG nạp ví/approve/fund", async () => {
    const seen: string[] = [];
    const dw = createDevWallet({ rpcUrl: "http://127.0.0.1:8545", key: key(), fetchFn: rpcFetch("hardhat", seen) });
    const quote = { bookingId: id, machineKey: id, renter: "0x" + "ab".repeat(20), host: "0x" + "cd".repeat(20), token: "0x" + "c1".repeat(20), priceUnits: "20000000000000000000" };
    const srv = { issueQuote: async () => ({ quote, signature: "0x00", escrow: chain.escrow, chainId: 43113 }), reconcile: async () => { throw new Error("không được gọi"); } };
    await expect(dw.pay("b1", srv)).rejects.toMatchObject({ code: "rejected", message: expect.stringContaining("Liên kết ví") });
    for (const m of ["eth_sendRawTransaction", "eth_sendTransaction", "hardhat_setBalance", "eth_call"]) expect(seen).not.toContain(m);
  });
  it("nút trả lời hardhat_metadata nhưng không phải Hardhat (thiếu instanceId, hoặc web3_clientVersion của mạng khác) ⇒ vẫn từ chối", async () => {
    for (const kind of ["liar", "half"] as const) {
      const dw = createDevWallet({ rpcUrl: "http://127.0.0.1:8545", key: key(), fetchFn: rpcFetch(kind) });
      await expect(dw.pay("b1", server), kind).rejects.toMatchObject({ code: "unsupported" });
    }
  });
  it("nút chưa chạy ⇒ báo offline (không phải từ chối vĩnh viễn), vẫn không ký gì", async () => {
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const dw = createDevWallet({ rpcUrl: "http://127.0.0.1:8545", key: key(), fetchFn: down });
    await expect(dw.pay("b1", server)).rejects.toMatchObject({ code: "offline" });
    await expect(dw.provider.request({ method: "personal_sign", params: [utf8Hex("x"), dw.address] })).rejects.toMatchObject({ code: "offline" });
  });
  it("kiểm lại MỖI lần (không nhớ kết quả cũ): nút đổi thành mạng thật giữa chừng thì lần sau bị từ chối", async () => {
    let kind: "hardhat" | "real" = "hardhat";
    const sw = (async (u: unknown, init: { body?: string }) => rpcFetch(kind)(u as never, init as never)) as unknown as typeof fetch;
    const dw = createDevWallet({ rpcUrl: "http://127.0.0.1:8545", key: key(), fetchFn: sw });
    expect(await dw.provider.request({ method: "eth_chainId" })).toBe("0xa869");
    kind = "real";
    await expect(dw.provider.request({ method: "eth_chainId" })).rejects.toMatchObject({ code: "unsupported" });
  });
  it("assertLocalHardhat: chấp nhận ĐÚNG dạng trả lời của nút Hardhat 3.21.2 thật; mọi dạng khác bị từ chối", async () => {
    const real = (a: { method: string }) => Promise.resolve(a.method === "hardhat_metadata" ? { clientVersion: "edr/0.3.8/revm/42.0.1", chainId: 43113, instanceId: "0x629a64b2843fea5b8de64d993ef6d44918e18a1f8255b93c644367736af819b7" } : "HardhatNetwork/3.21.2/@nomicfoundation/edr/0.3.8");
    await expect(assertLocalHardhat(real)).resolves.toBeUndefined();
    await expect(assertLocalHardhat(async () => null)).rejects.toMatchObject({ code: "unsupported" });
    await expect(assertLocalHardhat(async () => "0xa869")).rejects.toMatchObject({ code: "unsupported" });
    await expect(assertLocalHardhat(async (a) => (a.method === "hardhat_metadata" ? { instanceId: "0x" + "1".repeat(64) } : "Geth/v1.13.0"))).rejects.toMatchObject({ code: "unsupported" });
    await expect(assertLocalHardhat(async (a) => (a.method === "hardhat_metadata" ? { clientVersion: "HardhatNetwork/x" } : "HardhatNetwork/3.21.2"))).rejects.toMatchObject({ code: "unsupported" }); // thiếu instanceId
  });
});

describe("khoá ví giả lập", () => {
  it("sinh một lần rồi dùng lại; giá trị hỏng trong storage bị thay; storage lỗi vẫn cho khoá tạm", () => {
    const s = memStore();
    const k1 = loadDevKey(s);
    expect(k1).toMatch(/^0x[0-9a-f]{64}$/);
    expect(loadDevKey(s)).toBe(k1);
    s.m.set("cpm.devWallet.v1", "rác");
    const k2 = loadDevKey(s);
    expect(k2).not.toBe("rác");
    expect(k2).toMatch(/^0x[0-9a-f]{64}$/);
    expect(loadDevKey({ getItem: () => { throw new Error("chặn"); }, setItem: () => { throw new Error("chặn"); } })).toMatch(/^0x[0-9a-f]{64}$/);
    expect(loadDevKey(null)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("provider EIP-1193", () => {
  const w = () => createDevWallet({ rpcUrl: "http://127.0.0.1:8545", key: loadDevKey(memStore()), fetchFn: chainIdFetch });
  it("trả địa chỉ, chainId; personal_sign ký đúng và địa chỉ khôi phục được trùng ví (như server xác minh)", async () => {
    const dw = w();
    expect(await dw.provider.request({ method: "eth_requestAccounts" })).toEqual([dw.address]);
    expect(await dw.provider.request({ method: "eth_chainId" })).toBe("0xa869");
    const msg = "Đăng nhập Cloud PC\nnonce: abc";
    const sig = (await dw.provider.request({ method: "personal_sign", params: [utf8Hex(msg), dw.address] })) as `0x${string}`;
    expect(await recoverMessageAddress({ message: msg, signature: sig })).toBe(dw.address);
  });
  it("không ký cho địa chỉ khác; phương thức lạ bị từ chối với mã 4200", async () => {
    const dw = w();
    await expect(dw.provider.request({ method: "personal_sign", params: [utf8Hex("x"), "0x" + "1".repeat(40)] })).rejects.toMatchObject({ code: -32602 });
    await expect(dw.provider.request({ method: "eth_sendTransaction", params: [{}] })).rejects.toMatchObject({ code: 4200 });
  });
});

describe("dịch lỗi và quote", () => {
  it("lỗi hợp đồng thành thông báo tiếng Việt; lỗi mạng nói rõ chuỗi cục bộ chưa chạy", () => {
    expect(mapChainError(new Error("reverted\n\nError: InvalidQuote()\n")).message).toMatch(/không khớp cấu hình escrow/);
    expect(mapChainError(new Error("Error: BadSignature()")).message).toMatch(/người ký/);
    expect(mapChainError(new Error("Error: Lạ()")).message).toMatch(/Lạ|lỗi/i);
    expect(mapChainError(new Error("fetch failed")).message).toMatch(/chuỗi cục bộ/);
    const se = new ServiceError("rejected", "giữ nguyên");
    expect(mapChainError(se)).toBe(se);
  });
  it("toQuote: số nguyên → bigint, bytes32 và địa chỉ giữ nguyên chuỗi (kể cả bookingId toàn chữ số hex)", () => {
    const q = toQuote({ bookingId: "0x" + "12".repeat(32), priceUnits: "12345678901234567000", token: "0x" + "ab".repeat(20), policyHash: "1234", feeBps: "1000" }) as Record<string, unknown>;
    expect(q.priceUnits).toBe(12345678901234567000n);
    expect(q.feeBps).toBe(1000n);
    expect(q.bookingId).toBe("0x" + "12".repeat(32));
    expect(q.policyHash).toBe("1234");
  });
});

describe("gửi giao dịch: nonce cũ từ RPC công khai (Fuji)", () => {
  const tx = ("0x" + "cd".repeat(32)) as `0x${string}`;
  const NONCE_MSG = "Nonce provided for the transaction is lower than the current nonce of the account.\nTry increasing the nonce or find the latest nonce with `getTransactionCount`.";
  const pubOk = { waitForTransactionReceipt: async () => ({ status: "success" }) } as never;
  const send = (pub: never, writes: unknown[]) => {
    const waits: number[] = [];
    let calls = 0;
    const from = { writeContract: async () => { const w = writes[Math.min(calls++, writes.length - 1)]; if (w instanceof Error) throw w; return w as `0x${string}`; } } as never;
    const s = makeSender(pub, { sleep: async (ms) => void waits.push(ms) });
    return { run: () => s(from, "0x" + "1".repeat(40) as `0x${string}`, [], "fund", []), calls: () => calls, waits };
  };
  it("nhận ra đúng thông báo lỗi nonce của viem/nút RPC, không nhận lỗi khác", () => {
    expect(STALE_NONCE.test(NONCE_MSG)).toBe(true);
    expect(STALE_NONCE.test("nonce too low: next nonce 3, tx nonce 2")).toBe(true);
    expect(STALE_NONCE.test("insufficient funds for gas")).toBe(false);
    expect(STALE_NONCE.test("Error: InvalidQuote()")).toBe(false);
    expect(STALE_NONCE.test("replacement transaction underpriced")).toBe(false);
  });
  it("nonce cũ ở lần đầu: chờ rồi thử lại và thành công (trả đúng hash, chỉ một giao dịch thật)", async () => {
    const t = send(pubOk, [new Error(NONCE_MSG), new Error(NONCE_MSG), tx]);
    expect(await t.run()).toBe(tx);
    expect(t.calls()).toBe(3);
    expect(t.waits).toEqual([1500, 3000]);
  });
  it("nonce cũ kéo dài: dừng sau số lần thử có hạn và báo lỗi tiếng Việt", async () => {
    const t = send(pubOk, [new Error(NONCE_MSG)]);
    await expect(t.run()).rejects.toMatchObject({ message: expect.stringMatching(/Giao dịch lỗi: Nonce/) });
    expect(t.calls()).toBe(5);
    expect(t.waits).toHaveLength(4);
  });
  it("lỗi khác KHÔNG được thử lại (không che lỗi hợp đồng, không gửi trùng)", async () => {
    const t = send(pubOk, [new Error("reverted\n\nError: InvalidQuote()\n"), tx]);
    await expect(t.run()).rejects.toMatchObject({ message: expect.stringMatching(/không khớp cấu hình escrow/) });
    expect(t.calls()).toBe(1);
    expect(t.waits).toEqual([]);
  });
  it("giao dịch đã gửi nhưng bị hoàn tác trên chuỗi: báo lỗi, không gửi lại", async () => {
    const t = send({ waitForTransactionReceipt: async () => ({ status: "reverted" }) } as never, [tx]);
    await expect(t.run()).rejects.toMatchObject({ message: expect.stringMatching(/hoàn tác/) });
    expect(t.calls()).toBe(1);
  });
});

describe("đối soát sau giao dịch đã thành công", () => {
  const tx = ("0x" + "ab".repeat(32)) as `0x${string}`;
  it("thành công ngay: trả trạng thái từ máy chủ", async () => {
    expect(await reconcileAfterTx({ reconcile: async () => ({ status: "ok", pending: false }) }, "b", tx)).toEqual({ txHash: tx, status: "ok" });
  });
  it("lỗi mạng thoáng qua ở lần đầu được thử lại và thành công", async () => {
    let n = 0;
    const r = await reconcileAfterTx({ reconcile: async () => { if (n++ === 0) throw new ServiceError("auth", "Không kết nối được dịch vụ xác thực."); return { status: "ok", pending: false }; } }, "b", tx);
    expect(n).toBe(2);
    expect(r.status).toBe("ok");
  });
  it("lỗi kéo dài KHÔNG ném lỗi (tiền đã xử lý trên chuỗi): trả trạng thái chờ đối soát tự động và vẫn có txHash", async () => {
    const r = await reconcileAfterTx({ reconcile: async () => { throw new ServiceError("offline", "Không kết nối được máy chủ API."); } }, "b", tx);
    expect(r.txHash).toBe(tx);
    expect(r.status).toMatch(/đã thành công trên chuỗi/);
    expect(r.status).toMatch(/tự đối soát/);
  });
});

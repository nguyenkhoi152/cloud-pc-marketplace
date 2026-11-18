// Ví thử Fuji + địa chỉ máy chủ cấu hình lúc chạy + chain-info. RPC và máy chủ là bản GIẢ có nhãn (không đụng mạng thật).
import { recoverMessageAddress } from "viem";
import { describe, expect, it } from "vitest";
import { ServiceError } from "../mock/scenarios";
import { apiHost, effectiveApiBase, normalizeApiBase, readApiOverride, saveApiOverride, API_OVERRIDE_KEY } from "./endpoint";
import { fetchChainInfo } from "./server";
import { createTestnetWallet, loadTestnetKey, MIN_GAS_WEI, TESTNET_RPC_HOSTS, TESTNET_STORAGE_KEY, testnetRpc } from "./testnetWallet";
import { readFileSync } from "node:fs";
import { isAllowedOverride, OVERRIDE_HOST_SUFFIXES } from "./endpoint";

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const utf8Hex = (s: string) => "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
const PCP = ("0x" + "c1".repeat(20)) as `0x${string}`;
const ESCROW = ("0x" + "e5".repeat(20)) as `0x${string}`;
const word = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");
const FAUCET_OK = { address: "0x" + "00".repeat(20), pcp: { claimed: true, minted: true }, gas: { balanceWei: "0", sent: true } };

/** Nút RPC GIẢ có nhãn: chainId + số dư gas/PCP chỉnh được; ghi lại mọi phương thức được gọi. */
function fakeNode(o: { chainId?: number; gas?: bigint; pcp?: bigint } = {}) {
  const s = { chainId: o.chainId ?? 43113, gas: o.gas ?? 0n, pcp: o.pcp ?? 0n, seen: [] as string[] };
  const fetchFn = (async (_u: unknown, init: { body?: string }) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string };
    s.seen.push(req.method);
    const reply = (body: object) => new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, ...body }), { headers: { "content-type": "application/json" } });
    switch (req.method) {
      case "eth_chainId": return reply({ result: "0x" + s.chainId.toString(16) });
      case "eth_getBalance": return reply({ result: "0x" + s.gas.toString(16) });
      case "eth_call": return reply({ result: word(s.pcp) });
      default: return reply({ error: { code: -32000, message: `giả lập: không hỗ trợ ${req.method}` } });
    }
  }) as unknown as typeof fetch;
  return { s, fetchFn };
}
const wallet = (n: ReturnType<typeof fakeNode>, chainId = 43113) =>
  createTestnetWallet({ rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc", chainId, key: loadTestnetKey(memStore()), fetchFn: n.fetchFn, retryDelayMs: 0 });
const quoteFor = (renter: string, price = "1000000000000000000") => ({
  chainId: 43113, escrow: ESCROW, signature: "0x" + "ab".repeat(65),
  quote: { bookingId: "0x" + "12".repeat(32), machineKey: "0x" + "34".repeat(32), renter, host: "0x" + "99".repeat(20), token: PCP, priceUnits: price, feeBps: "500", treasury: "0x" + "d7".repeat(20), durationSeconds: "3600", issuedAt: "1", fundBy: "2", activateBy: "3", graceSeconds: "600", arbitrationSeconds: "86400", policyHash: "0x" + "56".repeat(32), configVersion: "1" },
});

describe("testnetRpc: chỉ https công khai (hoặc loopback để kiểm thử), fail-closed", () => {
  it("nhận https không userinfo/query; từ chối mọi dạng khác", () => {
    expect(testnetRpc("https://api.avax-test.network/ext/bc/C/rpc/")).toBe("https://api.avax-test.network/ext/bc/C/rpc");
    expect(testnetRpc("https://avalanche-fuji-c-chain-rpc.publicnode.com")).toBe("https://avalanche-fuji-c-chain-rpc.publicnode.com");
    expect(testnetRpc("https://other-rpc.example.com/ext/bc/C/rpc")).toBeNull(); // https nhưng ngoài danh sách (CSP sẽ chặn): từ chối sớm
    expect(testnetRpc("http://127.0.0.1:8545")).toBe("http://127.0.0.1:8545");
    for (const bad of [undefined, "", "http://10.0.0.5:8545", "http://rpc.example.com", "https://user:pw@rpc.example.com", "https://rpc.example.com/?key=1", "ws://x", "ftp://x", "javascript:alert(1)"])
      expect(testnetRpc(bad as string | undefined), String(bad)).toBeNull();
  });
  it("createTestnetWallet từ chối RPC xấu hoặc chainId vô nghĩa", () => {
    const key = loadTestnetKey(memStore());
    expect(() => createTestnetWallet({ rpcUrl: "http://10.0.0.5:8545", chainId: 43113, key })).toThrow(ServiceError);
    expect(() => createTestnetWallet({ rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc", chainId: 0, key })).toThrow(ServiceError);
    expect(() => createTestnetWallet({ rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc", chainId: 1.5, key })).toThrow(ServiceError);
  });
});

describe("danh sách tên miền khớp CSP của app (nếu lệch, WebView chặn và lỗi chỉ hiện là 'không trả lời')", () => {
  const csp = (JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { app: { security: { csp: string } } }).app.security.csp;
  const connect = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("connect-src"))!.split(/\s+/);
  it("mọi RPC ví thử được phép đều có trong connect-src", () => {
    for (const h of TESTNET_RPC_HOSTS) expect(connect, h).toContain(`https://${h}`);
  });
  it("mọi hậu tố mã kết nối được phép đều có dạng *.hậu-tố trong connect-src", () => {
    for (const s of OVERRIDE_HOST_SUFFIXES) expect(connect, s).toContain(`https://*.${s}`);
  });
  it("isAllowedOverride: đúng hậu tố ở ranh giới nhãn; loopback http; từ chối mọi thứ khác", () => {
    expect(isAllowedOverride("https://abc-def.trycloudflare.com/api")).toBe(true);
    expect(isAllowedOverride("http://127.0.0.1:3000/api")).toBe(true);
    for (const bad of ["https://trycloudflare.com/api", "https://eviltrycloudflare.com/api", "https://trycloudflare.com.evil.example/api", "https://abc.example.com/api", "http://abc.trycloudflare.com/api", "http://10.0.0.5:3000/api"])
      expect(isAllowedOverride(bad), bad).toBe(false);
  });
});

describe("khoá ví thử", () => {
  it("sinh một lần rồi giữ nguyên; dùng khoá lưu RIÊNG với ví giả lập; giá trị hỏng ⇒ sinh khoá mới", () => {
    const st = memStore();
    const k1 = loadTestnetKey(st);
    expect(loadTestnetKey(st)).toBe(k1);
    expect(st.m.has(TESTNET_STORAGE_KEY)).toBe(true);
    expect(st.m.has("cpm.devWallet.v1")).toBe(false);
    st.m.set(TESTNET_STORAGE_KEY, "không phải khoá");
    expect(loadTestnetKey(st)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(loadTestnetKey(null)).toMatch(/^0x[0-9a-f]{64}$/); // storage không có ⇒ khoá tạm
  });
});

describe("chốt chặn chainId: RPC phải đúng chuỗi mà máy chủ công bố", () => {
  const server = { issueQuote: async () => { throw new Error("không được xin quote khi ví đã từ chối"); }, reconcile: async () => { throw new Error("không được gọi"); } };
  const id = ("0x" + "12".repeat(32)) as `0x${string}`;
  it("RPC trả chainId khác ⇒ KHÔNG ký, KHÔNG xin quote, KHÔNG gửi giao dịch, chỉ hỏi eth_chainId", async () => {
    const n = fakeNode({ chainId: 1 }); // mainnet Ethereum
    const w = wallet(n);
    const refused = { code: "unsupported", message: expect.stringContaining("không ký trên mạng khác") };
    await expect(w.provider.request({ method: "personal_sign", params: [utf8Hex("x"), w.address] })).rejects.toMatchObject(refused);
    await expect(w.provider.request({ method: "eth_chainId" })).rejects.toMatchObject(refused);
    await expect(w.pay("b1", server)).rejects.toMatchObject(refused);
    await expect(w.accept({ bookingId: "b1", chainBookingId: id, chain: { chainId: 43113, escrow: ESCROW } }, server)).rejects.toMatchObject(refused);
    await expect(w.cancelBeforeStart({ bookingId: "b1", chainBookingId: id, chain: { chainId: 43113, escrow: ESCROW } }, server)).rejects.toMatchObject(refused);
    await expect(w.balance(PCP)).rejects.toMatchObject(refused);
    await expect(w.gasBalance()).rejects.toMatchObject(refused);
    expect([...new Set(n.s.seen)]).toEqual(["eth_chainId"]);
  });
  it("RPC không trả lời ⇒ báo mạng thử Fuji không kết nối được (không nhắc node Hardhat cục bộ)", async () => {
    const w = createTestnetWallet({ rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc", chainId: 43113, key: loadTestnetKey(memStore()), fetchFn: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    const e = await w.balance(PCP).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ServiceError);
    expect((e as ServiceError).code).toBe("offline");
    expect((e as ServiceError).message).toContain("Fuji");
    expect((e as ServiceError).message).not.toContain("Hardhat");
  });
  it("rút/đọc credit cũng qua chốt chainId: RPC sai chuỗi ⇒ không đọc, không gửi giao dịch", async () => {
    const n = fakeNode({ chainId: 1 });
    const w = wallet(n);
    await expect(w.credit(ESCROW)).rejects.toMatchObject({ code: "unsupported" });
    await expect(w.withdraw(ESCROW)).rejects.toMatchObject({ code: "unsupported" });
    expect([...new Set(n.s.seen)]).toEqual(["eth_chainId"]);
  });
  it("credit đọc số dư ghi có trên escrow cho đúng ví của app", async () => {
    const n = fakeNode({ pcp: 4_500_000_000_000_000_000n });
    const w = wallet(n);
    expect(await w.credit(ESCROW)).toBe("4500000000000000000");
    expect(n.s.seen).toContain("eth_call");
  });
  it("chainId đúng: provider ký được và máy chủ khôi phục đúng địa chỉ; địa chỉ lạ bị từ chối", async () => {
    const w = wallet(fakeNode());
    expect(w.kind).toBe("testnet");
    expect(w.label).toContain("VÍ THỬ");
    expect(await w.provider.request({ method: "eth_chainId" })).toBe("0xa869");
    const sig = (await w.provider.request({ method: "personal_sign", params: [utf8Hex("liên kết ví"), w.address] })) as `0x${string}`;
    expect(await recoverMessageAddress({ message: "liên kết ví", signature: sig })).toBe(w.address);
    await expect(w.provider.request({ method: "personal_sign", params: [utf8Hex("x"), "0x" + "11".repeat(20)] })).rejects.toMatchObject({ code: -32602 });
    await expect(w.provider.request({ method: "eth_sendTransaction", params: [] })).rejects.toMatchObject({ code: 4200 });
  });
});

describe("nạp ví từ vòi của máy chủ trước khi trả tiền", () => {
  it("thiếu gas và KHÔNG có vòi: dừng, nói địa chỉ ví, KHÔNG gửi giao dịch", async () => {
    const n = fakeNode({ gas: 0n, pcp: 10n ** 21n });
    const w = wallet(n);
    const server = { issueQuote: async () => quoteFor(w.address), reconcile: async () => ({ status: "x", pending: false }) };
    const e = await w.pay("b1", server).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ServiceError);
    expect((e as ServiceError).message).toContain("chưa có AVAX testnet");
    expect((e as ServiceError).message).toContain(w.address);
    expect(n.s.seen.some((m) => /^eth_send|^eth_estimateGas$/.test(m))).toBe(false);
  });
  it("thiếu gas/PCP và có vòi: gọi vòi ĐÚNG MỘT lần, đọc lại số dư, rồi mới đi tiếp tới approve (giao dịch)", async () => {
    const n = fakeNode({ gas: 0n, pcp: 0n });
    const w = wallet(n);
    let faucetCalls = 0;
    const server = {
      issueQuote: async () => quoteFor(w.address),
      reconcile: async () => ({ status: "x", pending: false }),
      faucet: async () => { faucetCalls++; n.s.gas = 10n ** 17n; n.s.pcp = 10n ** 21n; return FAUCET_OK; },
    };
    const e = await w.pay("b1", server).catch((x: unknown) => x);
    expect(faucetCalls).toBe(1);
    // Đã vượt qua bước nạp ví: lỗi (nếu có) đến từ nút giả không hỗ trợ ký/gửi, không phải "thiếu gas/PCP".
    expect(String((e as Error)?.message)).not.toMatch(/chưa có AVAX|chưa đủ PCP/);
    expect(n.s.seen.some((m) => m === "eth_estimateGas" || m === "eth_getTransactionCount" || m === "eth_sendRawTransaction" || m === "eth_getBlockByNumber")).toBe(true);
  });
  it("vòi chạy xong mà số dư vẫn thiếu (vòi hết hạn mức/24 giờ): báo thiếu rõ ràng, không treo", async () => {
    const n = fakeNode({ gas: 0n, pcp: 0n });
    const w = wallet(n);
    let faucetCalls = 0;
    const server = { issueQuote: async () => quoteFor(w.address), reconcile: async () => ({ status: "x", pending: false }), faucet: async () => { faucetCalls++; return FAUCET_OK; } };
    const e = await w.pay("b1", server).catch((x: unknown) => x);
    expect(faucetCalls).toBe(1);
    expect((e as ServiceError).message).toContain("chưa có AVAX testnet");
  });
  it("đủ gas và PCP: không gọi vòi", async () => {
    const n = fakeNode({ gas: MIN_GAS_WEI * 10n, pcp: 10n ** 21n });
    const w = wallet(n);
    let faucetCalls = 0;
    const server = { issueQuote: async () => quoteFor(w.address), reconcile: async () => ({ status: "x", pending: false }), faucet: async () => { faucetCalls++; return FAUCET_OK; } };
    await w.pay("b1", server).catch(() => undefined);
    expect(faucetCalls).toBe(0);
  });
  it("quote ghi ví đã liên kết KHÁC ví của cửa sổ này: chặn sớm, không nạp ví, không gọi vòi", async () => {
    const n = fakeNode();
    const w = wallet(n);
    let faucetCalls = 0;
    const server = { issueQuote: async () => quoteFor("0x" + "77".repeat(20)), reconcile: async () => ({ status: "x", pending: false }), faucet: async () => { faucetCalls++; return FAUCET_OK; } };
    const e = await w.pay("b1", server).catch((x: unknown) => x);
    expect((e as ServiceError).message).toContain("Ví thử của cửa sổ này không phải ví đã liên kết");
    expect(faucetCalls).toBe(0);
  });
  it("quote cho chuỗi khác chainId ví đang kết nối bị chặn", async () => {
    const n = fakeNode({ chainId: 43113 });
    const w = wallet(n);
    const server = { issueQuote: async () => ({ ...quoteFor(w.address), chainId: 43114 }), reconcile: async () => ({ status: "x", pending: false }) };
    await expect(w.pay("b1", server)).rejects.toMatchObject({ code: "rejected", message: expect.stringContaining("chainId 43113, máy chủ cần 43114") });
  });
});

describe("địa chỉ máy chủ API lúc chạy", () => {
  it("chuẩn hoá: https bất kỳ, loopback http; thêm /api khi chỉ có origin; từ chối dạng nguy hiểm", () => {
    expect(normalizeApiBase(" https://abc-def.trycloudflare.com/ ")).toBe("https://abc-def.trycloudflare.com/api");
    expect(normalizeApiBase("https://abc.trycloudflare.com/api/")).toBe("https://abc.trycloudflare.com/api");
    expect(normalizeApiBase("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/api");
    expect(normalizeApiBase("http://localhost:3000/api")).toBe("http://localhost:3000/api");
    for (const bad of [undefined, null, "", "abc.trycloudflare.com", "http://evil.example.com", "http://10.0.0.5:3000", "https://user:pw@x.example.com", "https://x.example.com/api?token=1", "https://x.example.com/#frag", "javascript:alert(1)", "https://x.example.com/a b", "http://127.0.0.1.evil.example:3000", "ftp://x.example.com"])
      expect(normalizeApiBase(bad as string | null | undefined), String(bad)).toBeNull();
  });
  it("ghi đè lưu/đọc/xoá; giá trị hỏng trong storage bị bỏ qua; storage lỗi không làm app sập", () => {
    const st = memStore();
    expect(readApiOverride(st)).toBeNull();
    expect(saveApiOverride(st, "https://abc.trycloudflare.com")).toBe(true);
    expect(st.m.get(API_OVERRIDE_KEY)).toBe("https://abc.trycloudflare.com/api");
    expect(readApiOverride(st)).toBe("https://abc.trycloudflare.com/api");
    expect(effectiveApiBase("http://127.0.0.1:3000/api", st)).toBe("https://abc.trycloudflare.com/api"); // ghi đè thắng giá trị lúc build
    expect(saveApiOverride(st, "http://evil.example.com")).toBe(false); // không lưu giá trị không hợp lệ
    expect(readApiOverride(st)).toBe("https://abc.trycloudflare.com/api");
    expect(saveApiOverride(st, null)).toBe(true);
    expect(effectiveApiBase("http://127.0.0.1:3000/api", st)).toBe("http://127.0.0.1:3000/api");
    st.m.set(API_OVERRIDE_KEY, "http://evil.example.com");
    expect(readApiOverride(st)).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(readApiOverride(broken)).toBeNull();
    expect(saveApiOverride(broken, "https://abc.trycloudflare.com")).toBe(false);
    expect(effectiveApiBase(undefined, null)).toBeNull();
    expect(apiHost("https://abc.trycloudflare.com/api")).toBe("abc.trycloudflare.com");
  });
});

describe("fetchChainInfo (chain-info là công khai, gọi được trước khi đăng nhập)", () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("đọc đủ trường; không đặt Authorization", async () => {
    let headers: Record<string, string> = {};
    const f = (async (_u: string, init: { headers: Record<string, string> }) => { headers = init.headers; return new Response(JSON.stringify({ chainId: 43113, escrow: ESCROW, pcp: PCP, rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc", faucet: true })); }) as unknown as typeof fetch;
    expect(await fetchChainInfo("https://abc.trycloudflare.com/api/", f)).toEqual({ chainId: 43113, escrow: ESCROW, pcp: PCP, rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc", faucet: true });
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");
  });
  it("định dạng sai / lỗi HTTP / lỗi mạng ⇒ null, không đoán", async () => {
    expect(await fetchChainInfo("https://x/api", ok({ chainId: "43113", escrow: ESCROW }))).toBeNull();
    expect(await fetchChainInfo("https://x/api", ok({ chainId: 43113, escrow: "không phải địa chỉ" }))).toBeNull();
    expect(await fetchChainInfo("https://x/api", ok({ error: "x" }, 503))).toBeNull();
    expect(await fetchChainInfo("https://x/api", (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchChainInfo("https://x/api", (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch)).toBeNull();
  });
  it("máy chủ/tunnel không trả lời: có hạn chót, trả null thay vì treo app lúc khởi động", async () => {
    const hang = ((_u: unknown, init: { signal: AbortSignal }) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(await fetchChainInfo("https://x/api", hang, 60)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("faucet chỉ true khi máy chủ nói đúng true", async () => {
    expect((await fetchChainInfo("https://x/api", ok({ chainId: 43113, escrow: ESCROW, faucet: "yes" })))?.faucet).toBe(false);
  });
});

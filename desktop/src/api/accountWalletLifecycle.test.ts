// @vitest-environment node
/**
 * Vòng đời ví thử trong app: trước đăng nhập chỉ có ví tạm (để hiện nhãn mạng, KHÔNG lưu), đăng nhập ⇒ ví riêng của tài khoản,
 * đổi tài khoản ⇒ ví khác, đăng xuất ⇒ gỡ ví. Máy chủ, Supabase và lớp live là BẢN GIẢ có nhãn (không đụng mạng thật).
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TESTNET_STORAGE_KEY, testnetAccountKeyName } from "./testnetWallet";

const fake = vi.hoisted(() => ({
  linked: null as null | { address: string } | "error",
  linkedCalls: 0,
  chain: { chainId: 43113, escrow: "0x" + "e5".repeat(20), pcp: "0x" + "c1".repeat(20), rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc", faucet: true } as null | object,
}));

vi.mock("./env", () => ({
  ENV: { mode: "live", url: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co", anonKey: "sb_publishable_x", apiBase: "https://abc.trycloudflare.com/api" },
  isLive: () => true,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));
vi.mock("./server", () => ({
  fetchChainInfo: async () => fake.chain,
  createServerApi: () => ({}),
}));
vi.mock("./live", () => ({
  createLiveApi: () => ({
    wallet: {
      linked: async () => {
        fake.linkedCalls++;
        if (fake.linked === "error") throw new Error("máy chủ tắt");
        return fake.linked ? { address: fake.linked.address, chainId: 43113, verifiedAt: "" } : null;
      },
    },
  }),
}));

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  fake.linked = null;
  fake.linkedCalls = 0;
  fake.chain = { chainId: 43113, escrow: "0x" + "e5".repeat(20), pcp: "0x" + "c1".repeat(20), rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc", faucet: true };
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  vi.resetModules();
});
afterEach(() => { vi.unstubAllGlobals(); });

async function boot() {
  const api = await import("./index");
  await api.bootLive();
  return api;
}
const addrOf = (api: Awaited<ReturnType<typeof boot>>) => api.getDevWallet()?.address.toLowerCase() ?? null;

describe("ví thử theo tài khoản (vòng đời trong app)", () => {
  it("trước đăng nhập: có ví tạm để hiện nhãn mạng nhưng KHÔNG lưu khoá nào", async () => {
    const api = await boot();
    expect(api.getDevWallet()?.kind).toBeDefined();
    expect(addrOf(api)).toMatch(/^0x[0-9a-f]{40}$/);
    expect([...store.keys()]).toEqual([]); // không để lại khoá của ai
    expect(api.walletAccountId()).toBeNull();
  });

  it("hai tài khoản trên cùng PC có hai ví khác nhau; quay lại tài khoản cũ thì ví cũ; đăng xuất gỡ ví", async () => {
    const api = await boot();
    await api.activateWalletForAccount(A);
    const a = addrOf(api);
    expect(api.walletAccountId()).toBe(A);
    await api.activateWalletForAccount(null); // đăng xuất
    expect(api.walletAccountId()).toBeNull();
    expect(addrOf(api)).not.toBe(a); // ví của A không còn gắn với app
    await api.activateWalletForAccount(B);
    const b = addrOf(api);
    expect(b).not.toBe(a); // tài khoản thứ hai liên kết được ví của riêng mình
    await api.activateWalletForAccount(A);
    expect(addrOf(api)).toBe(a); // ổn định
    expect(store.has(testnetAccountKeyName(A))).toBe(true);
    expect(store.has(testnetAccountKeyName(B))).toBe(true);
    expect(store.has(TESTNET_STORAGE_KEY)).toBe(false);
  });

  it("kế thừa ví dùng chung cũ: chỉ tài khoản đang liên kết đúng địa chỉ đó; tài khoản khác nhận ví mới", async () => {
    const legacy = generatePrivateKey();
    store.set(TESTNET_STORAGE_KEY, legacy);
    const legacyAddr = privateKeyToAccount(legacy).address.toLowerCase();
    const api = await boot();
    fake.linked = null; // B chưa liên kết gì
    await api.activateWalletForAccount(B);
    expect(addrOf(api)).not.toBe(legacyAddr);
    fake.linked = { address: legacyAddr }; // A đang liên kết đúng ví cũ
    await api.activateWalletForAccount(A);
    expect(addrOf(api)).toBe(legacyAddr);
    expect(store.get(testnetAccountKeyName(A))).toBe(legacy);
    expect(store.get(TESTNET_STORAGE_KEY)).toBe(legacy); // khoá cũ không bị xoá
  });

  it("không tra cứu được ví đã liên kết (máy chủ tắt) ⇒ tạm dùng ví cũ, không lưu khoá riêng, lần sau tra lại", async () => {
    const legacy = generatePrivateKey();
    store.set(TESTNET_STORAGE_KEY, legacy);
    const legacyAddr = privateKeyToAccount(legacy).address.toLowerCase();
    const api = await boot();
    fake.linked = "error";
    await api.activateWalletForAccount(A);
    expect(addrOf(api)).toBe(legacyAddr);
    expect(store.has(testnetAccountKeyName(A))).toBe(false);
    fake.linked = { address: "0x" + "ab".repeat(20) }; // lần sau tra được: liên kết ví khác ⇒ ví mới
    await api.activateWalletForAccount(A);
    expect(addrOf(api)).not.toBe(legacyAddr);
    expect(store.has(testnetAccountKeyName(A))).toBe(true);
  });

  it("đã có khoá riêng thì không hỏi máy chủ nữa; máy chủ chưa trả lời lúc mở app thì thử lại khi đăng nhập; gọi chồng chỉ lấy lần mới nhất", async () => {
    store.set(TESTNET_STORAGE_KEY, generatePrivateKey());
    const api = await boot();
    await api.activateWalletForAccount(A);
    const calls = fake.linkedCalls;
    await api.activateWalletForAccount(A);
    expect(fake.linkedCalls).toBe(calls); // đã có khoá riêng
    // Máy chủ chưa trả lời khi mở app: không có ví; đăng nhập sau khi máy chủ lên thì có ví.
    store.clear();
    vi.resetModules();
    const saved = fake.chain;
    fake.chain = null;
    const api2 = await boot();
    expect(api2.getDevWallet()).toBeNull();
    fake.chain = saved;
    await api2.activateWalletForAccount(A);
    expect(addrOf(api2)).toMatch(/^0x[0-9a-f]{40}$/);
    // Gọi chồng (đăng nhập A rồi nhanh chóng B): kết quả cuối là của B.
    await Promise.all([api2.activateWalletForAccount(A), api2.activateWalletForAccount(B)]);
    expect(api2.walletAccountId()).toBe(B);
    expect(addrOf(api2)).toBe(privateKeyToAccount(store.get(testnetAccountKeyName(B)) as `0x${string}`).address.toLowerCase());
  });
});

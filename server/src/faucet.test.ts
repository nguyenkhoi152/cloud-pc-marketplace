/**
 * Vòi testnet trên PostgreSQL THẬT cục bộ (không phải Supabase). Chuỗi là bản GIẢ có nhãn ghi lại lời gọi; việc `faucetMint` thật trên hợp đồng
 * (issuer-only, một lần/ví) đã được kiểm riêng trong contracts/test.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { linkWallet, newUser } from "../../db/tests/harness";
import { asPglite, startRealPg, type RealPg } from "../../db/tests/realpg";
import { ApiError, pgServiceDb, type ApiUser, type Deps, type ServerConfig } from "./core";
import { makeViemFaucetChain } from "./chainFaucet";
import { requestFaucet, type FaucetDeps } from "./api/faucet";

let real: RealPg;
let admin: pg.Client;
let pool: pg.Pool;
let base: Deps;
const A = () => asPglite(admin);
const user = (id: string): ApiUser => ({ id, email: null });
const AVAX = 10n ** 18n;

beforeAll(async () => {
  const r = await startRealPg();
  if (!r) throw new Error("Không có binary Postgres cục bộ (xem db/tests/realpg.ts)");
  real = r;
  admin = await real.connect();
  pool = new pg.Pool({ host: "127.0.0.1", port: real.port, user: "postgres", database: "postgres", max: 6 });
  const cfg = { supabaseUrl: "https://auth.example.test", anonKey: "k", chainId: 43113, escrow: "0x" + "e5".repeat(20), pcp: "0x" + "c1".repeat(20), treasury: "0x" + "d7".repeat(20), quoteSigner: privateKeyToAccount(generatePrivateKey()), minConfirmations: 1, graceSeconds: 600, arbitrationSeconds: 86_400, configVersion: 1, walletDomain: "t", walletUri: "https://t", allowedOrigins: [] } as ServerConfig;
  base = { db: pgServiceDb(pool), cfg };
}, 120_000);
afterAll(async () => { await pool?.end(); await admin?.end(); await real?.stop(); }, 60_000);

/** Chuỗi GIẢ có nhãn: ghi lại mọi lời gọi; hành vi chỉnh được. */
function fakeChain(o: { claimed?: boolean; balance?: bigint; mintFails?: boolean; gasFails?: boolean } = {}) {
  const calls: string[] = [];
  const s = { claimed: o.claimed ?? false, balance: o.balance ?? 0n };
  const chain = {
    async pcpClaimed() { calls.push("pcpClaimed"); return s.claimed; },
    async gasBalance() { calls.push("gasBalance"); return s.balance; },
    async mintPcp(a: string) { calls.push(`mint:${a}`); if (o.mintFails) { s.claimed = true; throw new Error("AlreadyClaimed"); } s.claimed = true; return ("0x" + "aa".repeat(32)) as `0x${string}`; },
    async sendGas(a: string, wei: bigint) { calls.push(`gas:${a}:${wei}`); if (o.gasFails) throw new Error("insufficient funds for gas"); s.balance += wei; return ("0x" + "bb".repeat(32)) as `0x${string}`; },
  };
  return { chain, calls, s };
}
const mk = (c: ReturnType<typeof fakeChain>): Deps & { faucet: FaucetDeps } => ({ ...base, faucet: { chain: c.chain, gasWei: AVAX / 20n, minGasWei: AVAX / 100n } });
const rejects = async (p: Promise<unknown>, status: number, code: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e, `kỳ vọng lỗi ${status}/${code}`).toBeInstanceOf(ApiError);
  expect([(e as ApiError).status, (e as ApiError).code]).toEqual([status, code]);
};
const walletUser = async () => { const id = await newUser(A(), "renter"); const addr = await linkWallet(A(), id); return { id, addr }; };
const auditCount = async (action: string, addr: string) => Number((await admin.query("select count(*)::int as n from public.audit_logs where action = $1 and resource = $2", [action, `wallet:${addr}`])).rows[0].n);

describe("POST /api/faucet", () => {
  it("không bật khi server không có khoá vòi (503); chưa liên kết ví (409)", async () => {
    const { id } = await walletUser();
    await rejects(requestFaucet(base, user(id)), 503, "faucet_disabled");
    const lonely = await newUser(A(), "renter");
    await rejects(requestFaucet(mk(fakeChain()), user(lonely)), 409, "wallet_required");
  });

  it("ví mới: mint PCP và nhỏ giọt gas, dùng ĐÚNG ví đã liên kết (client không chọn địa chỉ), ghi audit", async () => {
    const { id, addr } = await walletUser();
    const c = fakeChain();
    const r = await requestFaucet(mk(c), user(id));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ address: addr, pcp: { claimed: true, minted: true }, gas: { sent: true } });
    expect(c.calls).toEqual(["pcpClaimed", `mint:${addr}`, "gasBalance", `gas:${addr}:${AVAX / 20n}`]);
    expect(await auditCount("faucet_pcp", addr)).toBe(1);
    expect(await auditCount("faucet_gas", addr)).toBe(1);
  });

  it("ví đã nhận PCP và đủ gas: không gửi giao dịch nào", async () => {
    const { id } = await walletUser();
    const c = fakeChain({ claimed: true, balance: AVAX });
    const r = await requestFaucet(mk(c), user(id));
    expect(r.body).toMatchObject({ pcp: { claimed: true, minted: false }, gas: { sent: false } });
    expect(c.calls).toEqual(["pcpClaimed", "gasBalance"]);
  });

  it("gas chỉ nhỏ giọt MỘT lần mỗi 24 giờ cho mỗi ví (số dư vẫn thấp thì nói rõ lý do, không gửi thêm)", async () => {
    const { id, addr } = await walletUser();
    const c = fakeChain({ claimed: true });
    expect(((await requestFaucet(mk(c), user(id))).body as { gas: { sent: boolean } }).gas.sent).toBe(true);
    c.s.balance = 0n; // giả sử ví tiêu hết
    const again = await requestFaucet(mk(c), user(id));
    expect((again.body as { gas: { sent: boolean; reason?: string } }).gas).toMatchObject({ sent: false, reason: expect.stringContaining("24 giờ") });
    expect(c.calls.filter((x) => x.startsWith("gas:"))).toHaveLength(1);
    expect(await auditCount("faucet_gas", addr)).toBe(1);
  });

  it("giới hạn gas theo NGƯỜI DÙNG: liên kết ví khác trong 24 giờ không nhận thêm gas (chống rút cạn vòi bằng ví mới)", async () => {
    const id = await newUser(A(), "renter");
    const w1 = await linkWallet(A(), id);
    const c = fakeChain({ claimed: true });
    expect(((await requestFaucet(mk(c), user(id))).body as { gas: { sent: boolean } }).gas.sent).toBe(true);
    await admin.query("delete from public.wallet_links where user_id = $1", [id]);
    const w2 = await linkWallet(A(), id);
    expect(w2).not.toBe(w1);
    c.s.balance = 0n;
    const again = (await requestFaucet(mk(c), user(id))).body as { address: string; gas: { sent: boolean; reason?: string } };
    expect(again.address).toBe(w2);
    expect(again.gas).toMatchObject({ sent: false, reason: expect.stringContaining("24 giờ") });
    expect(c.calls.filter((x) => x.startsWith("gas:"))).toHaveLength(1);
  });

  it("hợp đồng từ chối mint (đã nhận ở yêu cầu khác): báo trạng thái thật, không lỗi 5xx", async () => {
    const { id } = await walletUser();
    const r = await requestFaucet(mk(fakeChain({ mintFails: true, balance: AVAX })), user(id));
    expect(r.body).toMatchObject({ pcp: { claimed: true, minted: false } });
  });

  it("lỗi chuỗi khi gửi gas ⇒ 502, nhưng dòng đếm yêu cầu VẪN được giữ (không né được hạn mức bằng cách gây lỗi)", async () => {
    const { id, addr } = await walletUser();
    const c = fakeChain({ claimed: true, gasFails: true });
    await rejects(requestFaucet(mk(c), user(id)), 502, "faucet_chain_error");
    expect(Number((await admin.query("select count(*)::int as n from public.audit_logs where action = 'faucet_request' and actor = $1", [id])).rows[0].n)).toBe(1);
    expect(await auditCount("faucet_gas", addr)).toBe(0); // gas chưa gửi ⇒ chưa tính là đã nhỏ giọt: lần sau thử lại được
  });

  it("hạn mức 4 yêu cầu/10 phút/người dùng (kể cả yêu cầu lỗi) ⇒ 429", async () => {
    const { id } = await walletUser();
    const c = fakeChain({ claimed: true, balance: AVAX });
    for (let i = 0; i < 4; i++) expect((await requestFaucet(mk(c), user(id))).status).toBe(200);
    await rejects(requestFaucet(mk(c), user(id)), 429, "rate_limited");
  });

  it("hai yêu cầu ĐỒNG THỜI cho cùng ví không nhỏ giọt gas hai lần (khoá cố vấn theo ví)", async () => {
    const { id, addr } = await walletUser();
    const c = fakeChain({ claimed: true });
    const slow = { ...c.chain, async sendGas(a: string, w: bigint) { await new Promise((r) => setTimeout(r, 150)); return c.chain.sendGas(a, w); } };
    const deps: Deps & { faucet: FaucetDeps } = { ...base, faucet: { chain: slow, gasWei: AVAX / 20n, minGasWei: AVAX / 100n } };
    const [x, y] = await Promise.all([requestFaucet(deps, user(id)), requestFaucet(deps, user(id))]);
    const sent = [x, y].filter((r) => (r.body as { gas: { sent: boolean } }).gas.sent).length;
    expect(sent).toBe(1);
    expect(c.calls.filter((k) => k.startsWith("gas:"))).toHaveLength(1);
    expect(await auditCount("faucet_gas", addr)).toBe(1);
  });
});

describe("makeViemFaucetChain (client giả có nhãn)", () => {
  it("gọi đúng hàm hợp đồng, chờ receipt, và ném lỗi khi giao dịch bị hoàn tác", async () => {
    const log: string[] = [];
    const pub = {
      readContract: async (a: { functionName: string }) => { log.push(`read:${a.functionName}`); return true; },
      getBalance: async () => 7n,
      waitForTransactionReceipt: async ({ hash }: { hash: string }) => ({ status: hash.endsWith("00") ? "reverted" : "success" }),
    };
    const wallet = {
      account: { address: ("0x" + "11".repeat(20)) as `0x${string}` },
      writeContract: async (a: { functionName: string; args: readonly unknown[] }) => { log.push(`write:${a.functionName}:${String(a.args[0]).slice(0, 6)}`); return ("0x" + "ab".repeat(32)) as `0x${string}`; },
      sendTransaction: async (a: { value: bigint }) => { log.push(`send:${a.value}`); return (a.value === 1n ? "0x" + "00".repeat(32) : "0x" + "cd".repeat(32)) as `0x${string}`; },
    };
    const ch = makeViemFaucetChain(pub as never, wallet as never, "0x" + "c1".repeat(20));
    expect(await ch.pcpClaimed("0x" + "22".repeat(20))).toBe(true);
    expect(await ch.gasBalance("0x" + "22".repeat(20))).toBe(7n);
    expect(await ch.mintPcp("0x" + "22".repeat(20))).toBe("0x" + "ab".repeat(32));
    expect(await ch.sendGas("0x" + "22".repeat(20), 5n)).toBe("0x" + "cd".repeat(32));
    await expect(ch.sendGas("0x" + "22".repeat(20), 1n)).rejects.toThrow(/hoàn tác/);
    expect(log).toEqual(["read:faucetClaimed", "write:faucetMint:0x2222", "send:5", "send:1"]);
    // Thiếu tài khoản ⇒ Promise bị từ chối (không ném đồng bộ), có thông điệp rõ.
    await expect(makeViemFaucetChain(pub as never, { ...wallet, account: undefined } as never, "0x" + "c1".repeat(20)).mintPcp("0x" + "22".repeat(20))).rejects.toThrow(/chưa có tài khoản/);
  });
});

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { buildQuote, machineKeyHash, quoteDomain, quoteToJson, recoverQuoteSigner, signQuote, QuoteError, type QuoteInput } from "./quote";
import { verifyWalletSignature, walletMessage, type WalletChallengeFields } from "./wallet";

const A = "0x" + "a1".repeat(20);
const B = "0x" + "b2".repeat(20);
const T = "0x" + "c3".repeat(20);
const base = (): QuoteInput => ({
  bookingId: "0x" + "11".repeat(32), machineKey: "m-0123456789ab", renter: A, host: B, token: T, treasury: "0x" + "d4".repeat(20),
  priceUnits: "20000000000000000000", feeBps: 1000, durationSeconds: 900, fundBy: 1_800_000_600, activateBy: 1_800_000_900,
  graceSeconds: 600, arbitrationSeconds: 86_400, policySha256: "ab".repeat(32), configVersion: 1,
});

describe("chữ ký ví (EIP-191)", () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const fields = (): WalletChallengeFields => ({ domain: "app.test", uri: "https://app.test", address: acct.address, chainId: 43113, userId: "u-1", nonce: "n0nce", issuedAt: "2026-11-09T00:00:00.000Z", expiresAt: "2026-11-09T00:05:00.000Z" });

  it("chữ ký đúng người ký → hợp lệ; ví khác, thông điệp bị sửa, chữ ký xấu → từ chối", async () => {
    const msg = walletMessage(fields());
    const sig = await acct.signMessage({ message: msg });
    expect(await verifyWalletSignature(msg, sig, acct.address)).toBe(true);
    expect(await verifyWalletSignature(msg, sig, acct.address.toLowerCase())).toBe(true);
    const other = privateKeyToAccount(generatePrivateKey());
    expect(await verifyWalletSignature(msg, sig, other.address)).toBe(false);
    expect(await verifyWalletSignature(walletMessage({ ...fields(), nonce: "khac" }), sig, acct.address)).toBe(false);
    expect(await verifyWalletSignature(msg, "0x1234", acct.address)).toBe(false);
    expect(await verifyWalletSignature(msg, "không phải hex", acct.address)).toBe(false);
    expect(await verifyWalletSignature(msg, ("0x" + "00".repeat(65)) as `0x${string}`, acct.address)).toBe(false);
  });
  it("thông điệp gắn domain, URI, chain, tài khoản, nonce, hạn", () => {
    const m = walletMessage(fields());
    for (const s of ["app.test", "https://app.test", "43113", "u-1", "n0nce", "2026-11-09T00:05:00.000Z"]) expect(m).toContain(s);
    expect(() => walletMessage({ ...fields(), address: "0xnope" })).toThrow();
  });
});

describe("buildQuote kiểm bất biến trước khi ký", () => {
  it("dựng đúng: issuedAt = fundBy − 600, machineKey = keccak(text), policyHash từ sha256", () => {
    const q = buildQuote(base());
    expect(q.issuedAt).toBe(1_800_000_000n);
    expect(q.activateBy - q.fundBy).toBe(300n);
    expect(q.machineKey).toBe(machineKeyHash("m-0123456789ab"));
    expect(q.policyHash).toBe("0x" + "ab".repeat(32));
    expect(q.priceUnits).toBe(20n * 10n ** 18n);
  });
  it.each<[string, Partial<QuoteInput>]>([
    ["renter trùng host", { host: A }],
    ["địa chỉ 0", { renter: "0x" + "00".repeat(20) }],
    ["địa chỉ rác", { token: "0xabc" }],
    ["giá 0", { priceUnits: "0" }],
    ["giá vượt trần", { priceUnits: (1_000_001n * 10n ** 18n).toString() }],
    ["giá dạng số thập phân/mũ", { priceUnits: "1e18" }],
    ["fee > 100%", { feeBps: 10_001 }],
    ["activateBy sai khoảng", { activateBy: 1_800_000_901 }],
    ["bookingId không phải bytes32", { bookingId: "0x1234" }],
    ["policy hash sai", { policySha256: "zz" }],
    ["thời lượng 0", { durationSeconds: 0 }],
  ])("từ chối: %s", (_n, over) => {
    expect(() => buildQuote({ ...base(), ...over })).toThrow(QuoteError);
  });
});

describe("ký quote", () => {
  it("chữ ký khôi phục đúng signer; đổi một trường thì ra người ký khác", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const dom = quoteDomain(43113, "0x" + "e5".repeat(20));
    const q = buildQuote(base());
    const sig = await signQuote(signer, q, dom);
    expect(await recoverQuoteSigner(q, dom, sig)).toBe(signer.address);
    expect(await recoverQuoteSigner({ ...q, priceUnits: q.priceUnits + 1n }, dom, sig)).not.toBe(signer.address);
    expect(await recoverQuoteSigner(q, quoteDomain(1, "0x" + "e5".repeat(20)), sig)).not.toBe(signer.address);
    expect(Object.values(quoteToJson(q)).every((v) => typeof v === "string")).toBe(true);
  });
});

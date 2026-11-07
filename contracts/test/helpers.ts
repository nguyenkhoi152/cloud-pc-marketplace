import assert from "node:assert/strict";
import { network } from "hardhat";
import { keccak256, parseEther, toHex, type Address, type Hex } from "viem";

export const { viem, networkHelpers } = await network.connect();

export const FEE_BPS = 1000n;
export const DURATION = 900n;
export const GRACE = 600n;
export const ARBITRATION = 86_400n;
export const PRICE = parseEther("20");
export const State = { None: 0, Funded: 1, Active: 2, Disputed: 3, Settled: 4, Resolved: 5, Refunded: 6 } as const;

export const QUOTE_TYPES = {
  Quote: [
    { name: "bookingId", type: "bytes32" },
    { name: "machineKey", type: "bytes32" },
    { name: "renter", type: "address" },
    { name: "host", type: "address" },
    { name: "token", type: "address" },
    { name: "priceUnits", type: "uint256" },
    { name: "feeBps", type: "uint256" },
    { name: "treasury", type: "address" },
    { name: "durationSeconds", type: "uint256" },
    { name: "issuedAt", type: "uint256" },
    { name: "fundBy", type: "uint256" },
    { name: "activateBy", type: "uint256" },
    { name: "graceSeconds", type: "uint256" },
    { name: "arbitrationSeconds", type: "uint256" },
    { name: "policyHash", type: "bytes32" },
    { name: "configVersion", type: "uint256" },
  ],
} as const;

export type Quote = {
  bookingId: Hex; machineKey: Hex; renter: Address; host: Address; token: Address; priceUnits: bigint;
  feeBps: bigint; treasury: Address; durationSeconds: bigint; issuedAt: bigint; fundBy: bigint;
  activateBy: bigint; graceSeconds: bigint; arbitrationSeconds: bigint; policyHash: Hex; configVersion: bigint;
};

/** Deploy PCP + escrow thật, cấu hình escrow một lần, trả về clients theo vai trò. */
export async function deployAll() {
  const wallets = await viem.getWalletClients();
  const [admin, operator, arbitrator, signer, issuer, treasury, renter, host, renter2, stranger] = wallets;
  assert.ok(admin && operator && arbitrator && signer && issuer && treasury && renter && host && renter2 && stranger);
  const pcp = await viem.deployContract("PCP", [admin.account.address, issuer.account.address]);
  const escrow = await viem.deployContract("RentalEscrow", [
    pcp.address, admin.account.address, operator.account.address, arbitrator.account.address, signer.account.address,
    FEE_BPS, treasury.account.address, DURATION, GRACE, ARBITRATION,
  ]);
  await pcp.write.configureEscrowOnce([escrow.address], { account: admin.account });
  const publicClient = await viem.getPublicClient();
  return { admin, operator, arbitrator, signer, issuer, treasury, renter, host, renter2, stranger, pcp, escrow, publicClient };
}
export type Env = Awaited<ReturnType<typeof deployAll>>;

let counter = 0n;
export function newId(label: string): Hex {
  counter += 1n;
  return keccak256(toHex(`${label}-${counter}`));
}

export async function makeQuote(env: Env, over: Partial<Quote> = {}): Promise<Quote> {
  const now = BigInt(await networkHelpers.time.latest());
  const fundBy = now + 600n;
  return {
    bookingId: newId("booking"), machineKey: newId("machine"),
    renter: env.renter.account.address, host: env.host.account.address, token: env.pcp.address,
    priceUnits: PRICE, feeBps: FEE_BPS, treasury: env.treasury.account.address,
    durationSeconds: DURATION, issuedAt: now, fundBy, activateBy: fundBy + 300n,
    graceSeconds: GRACE, arbitrationSeconds: ARBITRATION, policyHash: keccak256(toHex("policy-demo-0.1")),
    configVersion: 1n, ...over,
  };
}

export async function signQuote(
  env: Env, q: Quote, opts: { by?: Env["signer"]; chainId?: number; verifyingContract?: Address } = {},
): Promise<Hex> {
  const by = opts.by ?? env.signer;
  return by.signTypedData({
    account: by.account,
    domain: {
      name: "CloudPCRentalEscrow", version: "1",
      chainId: opts.chainId ?? (await env.publicClient.getChainId()),
      verifyingContract: opts.verifyingContract ?? env.escrow.address,
    },
    types: QUOTE_TYPES, primaryType: "Quote", message: q,
  });
}

/** Cấp faucet + approve cho renter. */
export async function fundWallet(env: Env, who: Env["renter"]) {
  await env.pcp.write.faucetMint([who.account.address], { account: env.issuer.account });
  await env.pcp.write.approve([env.escrow.address, PRICE * 10n], { account: who.account });
}

export async function fundBooking(env: Env, over: Partial<Quote> = {}) {
  const q = await makeQuote(env, over);
  const sig = await signQuote(env, q);
  await env.escrow.write.fund([q, sig], { account: env.renter.account });
  return q;
}

export async function activated(env: Env, over: Partial<Quote> = {}) {
  const q = await fundBooking(env, over);
  await env.escrow.write.activate([q.bookingId], { account: env.operator.account });
  return q;
}

/** Khẳng định lời gọi revert và thông báo chứa tên lỗi tuỳ chỉnh. */
export async function expectRevert(p: Promise<unknown>, name: string | RegExp) {
  await assert.rejects(p, (e: unknown) => {
    const msg = String((e as Error).message) + String((e as { details?: string }).details ?? "");
    const ok = typeof name === "string" ? msg.includes(name) : name.test(msg);
    if (!ok) console.error("revert khác mong đợi:", msg.slice(0, 400));
    return ok;
  });
}

export async function credit(env: Env, who: Address): Promise<bigint> {
  return env.escrow.read.credit([who]);
}
export const addr = (c: { account: { address: Address } }) => c.account.address;

/**
 * Quote EIP-712 cho RentalEscrow. Không import tương đối để contracts/test nạp trực tiếp được.
 * Key ký (quote signer) chỉ nằm ở server; module này nhận `account` đã dựng sẵn, không đọc env.
 */
import { getAddress, isAddress, isHex, keccak256, recoverTypedDataAddress, toBytes, zeroAddress, type Address, type Hex } from "viem";
import type { LocalAccount } from "viem/accounts";

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

export const QUOTE_TTL_SECONDS = 600;
export const ACTIVATE_WINDOW_SECONDS = 300;
const PRICE_CAP = 1_000_000n * 10n ** 18n;

export interface Quote {
  bookingId: Hex;
  machineKey: Hex;
  renter: Address;
  host: Address;
  token: Address;
  priceUnits: bigint;
  feeBps: bigint;
  treasury: Address;
  durationSeconds: bigint;
  issuedAt: bigint;
  fundBy: bigint;
  activateBy: bigint;
  graceSeconds: bigint;
  arbitrationSeconds: bigint;
  policyHash: Hex;
  configVersion: bigint;
}

export interface QuoteInput {
  /** bytes32 ngẫu nhiên của booking (bookings.chain_booking_id) dạng hex 0x + 64. */
  bookingId: string;
  /** Khoá máy dạng văn bản trong DB (machines.machine_key); on-chain dùng keccak256 của nó. */
  machineKey: string;
  renter: string;
  host: string;
  token: string;
  treasury: string;
  /** Đơn vị nhỏ nhất, chuỗi nguyên (không number). */
  priceUnits: string;
  feeBps: number;
  durationSeconds: number;
  /** Epoch giây từ snapshot booking trong DB. */
  fundBy: number;
  activateBy: number;
  graceSeconds: number;
  arbitrationSeconds: number;
  /** policy_versions.body_sha256 (hex 64, không tiền tố). */
  policySha256: string;
  configVersion: number | string;
}

export class QuoteError extends Error {}

export const machineKeyHash = (machineKey: string): Hex => keccak256(toBytes(machineKey));

const addr = (label: string, v: string): Address => {
  if (!isAddress(v, { strict: false }) || v.toLowerCase() === zeroAddress) throw new QuoteError(`${label}: địa chỉ không hợp lệ`);
  return getAddress(v);
};
const int = (label: string, v: number | string): bigint => {
  if (typeof v === "number" && !Number.isSafeInteger(v)) throw new QuoteError(`${label}: số không an toàn`);
  if (typeof v === "string" && !/^(0|[1-9][0-9]*)$/.test(v)) throw new QuoteError(`${label}: không phải số nguyên`);
  const n = BigInt(v);
  if (n < 0n) throw new QuoteError(`${label}: âm`);
  return n;
};

/** Dựng quote từ snapshot DB và kiểm các bất biến của CONTRACT_SPEC trước khi ký (không ký thứ không hợp lệ). */
export function buildQuote(i: QuoteInput): Quote {
  if (!isHex(i.bookingId, { strict: true }) || i.bookingId.length !== 66) throw new QuoteError("bookingId phải là bytes32");
  if (!/^[0-9a-f]{64}$/i.test(i.policySha256)) throw new QuoteError("policySha256 không hợp lệ");
  const renter = addr("renter", i.renter);
  const host = addr("host", i.host);
  if (renter === host) throw new QuoteError("renter trùng host");
  const priceUnits = int("priceUnits", i.priceUnits);
  if (priceUnits === 0n || priceUnits > PRICE_CAP) throw new QuoteError("priceUnits ngoài giới hạn");
  const feeBps = int("feeBps", i.feeBps);
  if (feeBps > 10_000n) throw new QuoteError("feeBps > 10000");
  const durationSeconds = int("durationSeconds", i.durationSeconds);
  if (durationSeconds === 0n) throw new QuoteError("durationSeconds = 0");
  const fundBy = int("fundBy", i.fundBy);
  const activateBy = int("activateBy", i.activateBy);
  if (activateBy - fundBy !== BigInt(ACTIVATE_WINDOW_SECONDS)) throw new QuoteError("activateBy phải = fundBy + 300");
  const issuedAt = fundBy - BigInt(QUOTE_TTL_SECONDS);
  if (issuedAt <= 0n) throw new QuoteError("issuedAt không hợp lệ");
  return {
    bookingId: i.bookingId.toLowerCase() as Hex,
    machineKey: machineKeyHash(i.machineKey),
    renter,
    host,
    token: addr("token", i.token),
    priceUnits,
    feeBps,
    treasury: addr("treasury", i.treasury),
    durationSeconds,
    issuedAt,
    fundBy,
    activateBy,
    graceSeconds: int("graceSeconds", i.graceSeconds),
    arbitrationSeconds: int("arbitrationSeconds", i.arbitrationSeconds),
    policyHash: `0x${i.policySha256.toLowerCase()}` as Hex,
    configVersion: int("configVersion", i.configVersion),
  };
}

export const quoteDomain = (chainId: number, verifyingContract: string) =>
  ({ name: "CloudPCRentalEscrow", version: "1", chainId, verifyingContract: addr("escrow", verifyingContract) }) as const;

export function signQuote(account: LocalAccount, quote: Quote, domain: ReturnType<typeof quoteDomain>): Promise<Hex> {
  if (!account.signTypedData) throw new QuoteError("account không hỗ trợ signTypedData");
  return account.signTypedData({ domain, types: QUOTE_TYPES, primaryType: "Quote", message: quote });
}

export function recoverQuoteSigner(quote: Quote, domain: ReturnType<typeof quoteDomain>, signature: Hex): Promise<Address> {
  return recoverTypedDataAddress({ domain, types: QUOTE_TYPES, primaryType: "Quote", message: quote, signature });
}

/** JSON an toàn cho API: mọi số lớn là chuỗi. */
export function quoteToJson(q: Quote): Record<string, string> {
  return Object.fromEntries(Object.entries(q).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
}

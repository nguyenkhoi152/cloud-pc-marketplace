/**
 * Đọc và giải mã sự kiện RentalEscrow từ receipt. Tx hash chỉ là gợi ý: kết quả phụ thuộc vào receipt thật,
 * đúng địa chỉ escrow, đủ confirmation và chưa revert. Không import tương đối.
 */
import { parseAbi, parseEventLogs, type Hex } from "viem";

export const ESCROW_EVENTS_ABI = parseAbi([
  "event Funded(bytes32 indexed bookingId, address indexed renter, address indexed host, bytes32 machineKey, address token, uint256 priceUnits, uint256 feeBps, address treasury, uint256 fundBy, uint256 activateBy)",
  "event Activated(bytes32 indexed bookingId, uint256 startedAt, uint256 endAt)",
  "event Refunded(bytes32 indexed bookingId, address indexed renter, uint256 amount)",
  "event DisputeOpened(bytes32 indexed bookingId, address indexed by, uint256 resolutionDeadline)",
  "event Resolved(bytes32 indexed bookingId, uint256 hostGross, uint256 renterRefund)",
  "event Settled(bytes32 indexed bookingId, uint256 hostGross)",
]);

export type EscrowEventName = "Funded" | "Activated" | "Refunded" | "DisputeOpened" | "Resolved" | "Settled";

export interface EscrowEvent {
  event: EscrowEventName;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
  bookingId: Hex;
  /** Mọi số lớn là chuỗi; địa chỉ chữ thường. */
  data: Record<string, string>;
}

export interface ReceiptLike {
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: Hex;
  logs: readonly { address: string; topics: readonly Hex[]; data: Hex; logIndex: number | null; blockNumber: bigint | null; blockHash: Hex | null; transactionHash: Hex | null }[];
}
/** Tập con của viem PublicClient (để test được bằng client thật của Hardhat hoặc bản giả có nhãn). */
export interface ChainClientLike {
  getTransactionReceipt(a: { hash: Hex }): Promise<ReceiptLike>;
  getBlockNumber(): Promise<bigint>;
}

export type EscrowReadResult =
  | { status: "not_found" | "pending" | "reverted" }
  | { status: "ok"; confirmations: number; events: EscrowEvent[] };

const str = (v: unknown) => (typeof v === "bigint" ? v.toString() : typeof v === "string" ? v.toLowerCase() : String(v));

export async function readEscrowEvents(client: ChainClientLike, o: { escrow: string; txHash: Hex; minConfirmations: number }): Promise<EscrowReadResult> {
  let r: ReceiptLike;
  try {
    r = await client.getTransactionReceipt({ hash: o.txHash });
  } catch (e) {
    if (/could not be found|not found/i.test(String((e as Error).message))) return { status: "not_found" };
    throw e;
  }
  if (r.status === "reverted") return { status: "reverted" };
  const head = await client.getBlockNumber();
  const confirmations = Number(head - r.blockNumber) + 1;
  if (confirmations < o.minConfirmations) return { status: "pending" };
  const mine = r.logs.filter((l) => l.address.toLowerCase() === o.escrow.toLowerCase());
  const decoded = parseEventLogs({ abi: ESCROW_EVENTS_ABI, logs: mine as never, strict: false });
  const events: EscrowEvent[] = decoded.map((l) => {
    const a = (l as unknown as { args: Record<string, unknown>; eventName: EscrowEventName; logIndex: number }).args;
    const { bookingId, ...rest } = a;
    return {
      event: (l as unknown as { eventName: EscrowEventName }).eventName,
      txHash: o.txHash,
      logIndex: (l as unknown as { logIndex: number }).logIndex,
      blockNumber: r.blockNumber,
      blockHash: r.blockHash,
      bookingId: String(bookingId).toLowerCase() as Hex,
      data: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, str(v)])),
    };
  });
  return { status: "ok", confirmations, events };
}

/** Tập con của PublicClient để quét sự kiện theo booking (worker đối soát sau restart/crash). */
export interface LogsClientLike extends ChainClientLike {
  getContractEvents(a: { abi: typeof ESCROW_EVENTS_ABI; address: `0x${string}`; fromBlock: bigint; toBlock: bigint; args: { bookingId: Hex }; strict?: boolean }): Promise<readonly unknown[]>;
}

/**
 * Quét mọi sự kiện escrow của một booking trong [fromBlock, head − confirmations + 1]. Chỉ trả block đã đủ confirmation,
 * sắp theo (block, logIndex) để áp dụng đúng thứ tự.
 */
type RawLog = { eventName: EscrowEventName; args: Record<string, unknown>; logIndex: number; blockNumber: bigint; blockHash: Hex; transactionHash: Hex };
const RANGE_ERR = /block range|range (is )?too (large|wide)|exceed|too many|maximum|limit/i;
export const DEFAULT_LOGS_RANGE = 10_000n;

/**
 * Lấy log theo TRANG. RPC công khai giới hạn khoảng khối của eth_getLogs (Fuji api.avax-test.network chỉ 100 khối), nên không được hỏi
 * một lần từ khối deploy. Khi RPC báo vượt giới hạn: giảm cỡ trang (theo số trong thông báo nếu có, không thì một nửa) rồi thử lại cùng đoạn;
 * lỗi khác (mạng, v.v.) ném ra ngay để worker thử lại sau. Trả log theo thứ tự trang (đã tăng dần theo khối).
 */
async function getLogsPaged(client: LogsClientLike, o: { escrow: string; bookingId: Hex; from: bigint; to: bigint; range: bigint }): Promise<RawLog[]> {
  const out: RawLog[] = [];
  let from = o.from;
  let step = o.range < 1n ? 1n : o.range;
  while (from <= o.to) {
    const to = from + step - 1n < o.to ? from + step - 1n : o.to;
    try {
      out.push(...((await client.getContractEvents({ abi: ESCROW_EVENTS_ABI, address: o.escrow as `0x${string}`, fromBlock: from, toBlock: to, args: { bookingId: o.bookingId }, strict: false })) as unknown as RawLog[]));
      from = to + 1n;
    } catch (e) {
      const msg = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
      if (!RANGE_ERR.test(msg) || step <= 1n) throw e;
      const hinted = /(\d[\d,_]*)\s*(blocks)?\s*$/i.exec(msg.replace(/[.\s]+$/, ""))?.[1];
      const cap = hinted ? BigInt(hinted.replace(/[,_]/g, "")) : 0n;
      step = cap > 0n && cap < step ? cap : step / 2n || 1n;
    }
  }
  return out;
}

export async function scanBookingEvents(client: LogsClientLike, o: { escrow: string; bookingId: Hex; fromBlock: bigint; minConfirmations: number; maxBlockRange?: bigint }): Promise<{ safeBlock: bigint; events: EscrowEvent[] }> {
  const head = await client.getBlockNumber();
  const safeBlock = head - BigInt(Math.max(o.minConfirmations, 1) - 1);
  if (safeBlock < o.fromBlock) return { safeBlock, events: [] };
  const logs = await getLogsPaged(client, { escrow: o.escrow, bookingId: o.bookingId, from: o.fromBlock, to: safeBlock, range: o.maxBlockRange ?? DEFAULT_LOGS_RANGE });
  const events = logs
    .map((l) => {
      const { bookingId, ...rest } = l.args;
      return {
        event: l.eventName, txHash: l.transactionHash, logIndex: l.logIndex, blockNumber: l.blockNumber, blockHash: l.blockHash,
        bookingId: String(bookingId).toLowerCase() as Hex, data: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, str(v)])),
      } satisfies EscrowEvent;
    })
    .sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
  return { safeBlock, events };
}

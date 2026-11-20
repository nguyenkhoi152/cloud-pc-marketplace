/**
 * VÍ GIẢ LẬP cho thử nghiệm với chuỗi Hardhat CỤC BỘ. KHÔNG phải ví thật, KHÔNG có giá trị tiền.
 * Bảo vệ hai lớp, đều fail-closed:
 *  1. Chỉ tạo được khi VITE_DEV_WALLET_RPC là địa chỉ loopback (http://127.0.0.1|localhost) — không dựa vào chainId vì
 *     43113 cũng là chainId Fuji.
 *  2. Trước MỖI lần ký/gửi, nút ở địa chỉ đó phải tự nhận là Hardhat (`hardhat_metadata`). Một cổng loopback bị chuyển tiếp
 *     tới mạng thật (tunnel/proxy tới Fuji hay mainnet) không trả lời phương thức này ⇒ ví từ chối, không ký gì.
 * Khoá riêng sinh ngay trong trình duyệt và lưu localStorage (không nằm trong VITE_*, không gửi đi đâu).
 * Nạp ví thử dùng các khoá Hardhat CÔNG KHAI (issuer = tài khoản #4 của deploy cục bộ): chỉ có tác dụng trên chuỗi Hardhat cục bộ,
 * vô nghĩa trên chuỗi thật. UI luôn gắn nhãn VÍ GIẢ LẬP.
 */
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ServiceError } from "../mock/scenarios";
import type { ServerApi } from "./server";
import type { Eip1193 } from "./wallet";

export const DEV_WALLET_LABEL = "VÍ GIẢ LẬP — chỉ dành cho chuỗi cục bộ, không có giá trị tiền";
const STORAGE_KEY = "cpm.devWallet.v1";
/** Khoá Hardhat #4 CÔNG KHAI = ISSUER của deploy cục bộ (scripts/deploy.ts). */
const LOCAL_ISSUER_KEY: Hex = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
const HUNDRED_ETH = "0x56BC75E2D63100000";

/** Trả URL chuẩn hoá nếu là loopback http; ngược lại null (fail-closed). */
export function devWalletRpc(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(v) ? v : null;
}

/** Nạp/sinh khoá ví thử theo tên khoá lưu trữ. Giá trị hỏng hoặc storage lỗi ⇒ khoá mới (tạm nếu không lưu được). */
export function loadKey(storage: Pick<Storage, "getItem" | "setItem"> | null, storageKey: string): Hex {
  try {
    const cur = storage?.getItem(storageKey);
    if (cur && /^0x[0-9a-fA-F]{64}$/.test(cur)) return cur as Hex;
  } catch {
    /* storage không dùng được: tạo khoá tạm */
  }
  const k = generatePrivateKey();
  try {
    storage?.setItem(storageKey, k);
  } catch {
    /* khoá chỉ sống trong phiên */
  }
  return k;
}
export const loadDevKey = (storage: Pick<Storage, "getItem" | "setItem"> | null): Hex => loadKey(storage, STORAGE_KEY);

export const pcpAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function faucetClaimed(address) view returns (bool)",
  "function faucetMint(address to)",
]);
export const escrowAbi = parseAbi([
  "struct Quote { bytes32 bookingId; bytes32 machineKey; address renter; address host; address token; uint256 priceUnits; uint256 feeBps; address treasury; uint256 durationSeconds; uint256 issuedAt; uint256 fundBy; uint256 activateBy; uint256 graceSeconds; uint256 arbitrationSeconds; bytes32 policyHash; uint256 configVersion; }",
  "function fund(Quote q, bytes signature)",
  "function accept(bytes32 id)",
  "function cancelBeforeStart(bytes32 id)",
  "function credit(address) view returns (uint256)",
  "function withdrawPCP()",
]);

const BYTES_FIELDS = new Set(["bookingId", "machineKey", "policyHash"]);
/** Quote từ API là chuỗi; số nguyên → bigint, bytes32/địa chỉ giữ nguyên. */
export function toQuote(raw: Record<string, string>) {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, /^[0-9]+$/.test(v) && !BYTES_FIELDS.has(k) ? BigInt(v) : v]));
}

const CHAIN_ERRORS: Record<string, string> = {
  BadSignature: "Không xác thực được báo giá. Hãy giữ máy lại và thử lần nữa.",
  InvalidQuote: "Báo giá không còn hợp lệ. Hãy giữ máy lại và thử lần nữa.",
  TooLate: "Đã quá hạn thanh toán; hãy giữ máy lại.",
  MachineOccupied: "Máy đang có giao dịch khác chưa hoàn tất.",
  BookingUsed: "Phiên thuê này đã được thanh toán trước đó.",
  InvalidState: "Phiên thuê không ở trạng thái cho phép thao tác này.",
  NotAuthorized: "Ví này không có quyền thực hiện thao tác này.",
  NothingToWithdraw: "Chưa có PCP nào để rút về ví này.",
};
export function mapChainError(e: unknown): ServiceError {
  if (e instanceof ServiceError) return e;
  const msg = String((e as Error)?.message ?? e);
  const name = /Error: ([A-Za-z0-9_]+)\(/.exec(msg)?.[1];
  if (/User rejected|denied/i.test(msg)) return new ServiceError("rejected", "Đã từ chối giao dịch.");
  if (name) return new ServiceError("rejected", CHAIN_ERRORS[name] ?? "Giao dịch bị từ chối. Hãy thử lại sau.");
  if (/fetch failed|Failed to fetch|ECONNREFUSED|network/i.test(msg)) return new ServiceError("offline", "Không kết nối được chuỗi cục bộ (node Hardhat chưa chạy?).");
  if (typeof console !== "undefined") console.warn("[wallet]", msg.slice(0, 300));
  return new ServiceError("server", "Giao dịch chưa thực hiện được. Hãy thử lại sau ít phút.");
}

/**
 * Báo máy chủ đối soát một giao dịch ĐÃ thành công trên chuỗi. Nếu việc báo lỗi (mạng, đăng nhập hết hạn), giao dịch vẫn có hiệu lực
 * và worker tự đối soát theo định kỳ, nên KHÔNG được báo thất bại cho người dùng: trả trạng thái "chờ đối soát tự động".
 * Thử lại một lần cho lỗi mạng thoáng qua.
 */
export async function reconcileAfterTx(server: Pick<ServerApi, "reconcile">, bookingId: string, txHash: Hex): Promise<{ txHash: Hex; status: string }> {
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await server.reconcile(bookingId, txHash);
      return { txHash, status: r.status };
    } catch (e) {
      last = e;
      if (i === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  const why = String((last as Error)?.message ?? last).slice(0, 80);
  return { txHash, status: `giao dịch đã thành công trên chuỗi; chưa báo được máy chủ (${why}) nên worker sẽ tự đối soát` };
}

export interface ChainInfo {
  escrow: Address;
  chainId: number;
}

type RpcRequest = (a: { method: string; params?: unknown[] }) => Promise<unknown>;
const NOT_HARDHAT = "Ví giả lập từ chối: RPC này không phải nút Hardhat cục bộ. Ví giả lập không bao giờ ký trên mạng thật.";
/**
 * Fail-closed: chỉ đi tiếp khi nút RPC là mạng mô phỏng Hardhat. Phải đạt CẢ HAI (đối chiếu với nút Hardhat 3.21.2 thật, 12/11/2026):
 *  - `hardhat_metadata` trả một đối tượng có `instanceId` (nút thật như Fuji/mainnet trả "method not found"; lưu ý trường
 *    `clientVersion` ở đây là "edr/…", KHÔNG chứa chữ "hardhat", nên không dùng nó để nhận diện);
 *  - `web3_clientVersion` bắt đầu bằng "HardhatNetwork/".
 * Nút không chạy ⇒ báo offline. Không lưu kết quả: kiểm lại mỗi lần.
 */
export async function assertLocalHardhat(request: RpcRequest): Promise<void> {
  let meta: unknown, client: unknown;
  try {
    meta = await request({ method: "hardhat_metadata" });
    client = await request({ method: "web3_clientVersion" });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/fetch failed|Failed to fetch|ECONNREFUSED|NetworkError|HTTP request failed/i.test(msg) && !/not (found|supported|exist|available)|does not exist|unsupported/i.test(msg))
      throw new ServiceError("offline", "Không kết nối được chuỗi cục bộ (node Hardhat chưa chạy?).");
    throw new ServiceError("unsupported", NOT_HARDHAT);
  }
  const instanceId = (meta as { instanceId?: unknown } | null)?.instanceId;
  if (typeof instanceId !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(instanceId)) throw new ServiceError("unsupported", NOT_HARDHAT);
  if (typeof client !== "string" || !/^HardhatNetwork\//.test(client)) throw new ServiceError("unsupported", NOT_HARDHAT);
}
type PayServer = Pick<ServerApi, "issueQuote" | "reconcile"> & Partial<Pick<ServerApi, "faucet">>;
type ReconcileServer = Pick<ServerApi, "reconcile">;

export interface DevWallet {
  /** "dev": ví GIẢ LẬP trên chuỗi Hardhat cục bộ. "testnet": ví thử trong app trên chuỗi thử công khai (Fuji). */
  kind: "dev" | "testnet";
  address: Address;
  label: string;
  rpcUrl: string;
  provider: Eip1193;
  /** quote → (nạp ví thử nếu thiếu) → approve → fund → đối soát. */
  pay(bookingId: string, server: PayServer): Promise<{ txHash: Hex; status: string }>;
  /** Kết thúc sớm: accept ⇒ trả cả gói cho host (Settled). */
  accept(o: { bookingId: string; chainBookingId: Hex; chain: ChainInfo }, server: ReconcileServer): Promise<{ txHash: Hex; status: string }>;
  /** Hủy trước khi kích hoạt: hoàn đủ. */
  cancelBeforeStart(o: { bookingId: string; chainBookingId: Hex; chain: ChainInfo }, server: ReconcileServer): Promise<{ txHash: Hex; status: string }>;
  /** Số dư PCP thử của ví (đơn vị nhỏ nhất, dạng chuỗi). Chỉ đọc. */
  balance(token: Address): Promise<string>;
  /** Số dư AVAX (gas) của ví, wei dạng chuỗi. Chỉ đọc. */
  gasBalance(): Promise<string>;
  /** PCP ví được ghi có trên escrow nhưng chưa rút (host sau khi phiên hoàn tất). Đơn vị nhỏ nhất, chuỗi. Chỉ đọc. */
  credit(escrow: Address): Promise<string>;
  /** Rút toàn bộ số được ghi có về ví (escrow.withdrawPCP). Trả hash giao dịch; ném lỗi nếu không có gì để rút. */
  withdraw(escrow: Address): Promise<Hex>;
}

/** Tối thiểu của client công khai/ví viem mà lõi cần (ép kiểu ở nơi dựng để tránh phụ thuộc generic của viem). */
export interface PubLike {
  request(a: never): Promise<unknown>;
  getChainId(): Promise<number>;
  getBalance(a: { address: Address }): Promise<bigint>;
  readContract(a: never): Promise<unknown>;
  waitForTransactionReceipt(a: { hash: Hex }): Promise<{ status: string }>;
}
export interface WalletLike {
  writeContract(a: never): Promise<Hex>;
}

/**
 * RPC công khai (Fuji) đứng sau bộ cân bằng tải: ngay sau khi giao dịch trước có receipt, nút trả "số giao dịch của ví" có thể còn cũ,
 * giao dịch kế tiếp mang nonce cũ và bị từ chối ("Nonce provided for the transaction is lower than the current nonce"). Giao dịch bị từ chối
 * KHÔNG được gửi đi nên thử lại không thể gửi trùng; viem lấy lại nonce ở mỗi lần thử. Chỉ lỗi nonce thấp mới được thử lại.
 */
export const STALE_NONCE = /nonce[^.]{0,80}(lower than|too low)|nonce too low/i;
const NONCE_RETRIES = 4;

/** Gửi một giao dịch hợp đồng bằng `from`, chờ receipt, dịch lỗi sang tiếng Việt. `sleep` chỉ để test. */
export function makeSender(pub: PubLike, o: { sleep?: (ms: number) => Promise<void> } = {}) {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async (from: WalletLike, address: Address, abi: unknown, functionName: string, args: unknown[]): Promise<Hex> => {
    try {
      let hash: Hex | undefined;
      for (let attempt = 0; hash === undefined; attempt++) {
        try {
          hash = await from.writeContract({ address, abi, functionName, args, chain: null } as never);
        } catch (e) {
          if (attempt >= NONCE_RETRIES || !STALE_NONCE.test(String((e as Error)?.message ?? e))) throw e;
          await sleep(1500 * (attempt + 1));
        }
      }
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new ServiceError("rejected", "Giao dịch bị hoàn tác trên chuỗi.");
      return hash;
    } catch (e) {
      throw mapChainError(e);
    }
  };
}

export interface WalletCore {
  kind: DevWallet["kind"];
  label: string;
  rpcUrl: string;
  account: ReturnType<typeof privateKeyToAccount>;
  pub: PubLike;
  wallet: WalletLike;
  /** Gọi trước MỌI thao tác ký/gửi/đọc: fail-closed nếu RPC không đúng loại mạng mong đợi. */
  guard(): Promise<void>;
  /** Bảo đảm đủ gas + PCP trước approve/fund (khác nhau theo loại ví). */
  ensureFunds(token: Address, need: bigint, server: PayServer): Promise<void>;
  /** Tên gọi trong thông báo "ví đã liên kết khác ví của cửa sổ này". */
  noun: string;
}

/** Lõi dùng chung: provider EIP-1193 (liên kết ví bằng chữ ký), trả tiền, hủy, kết thúc, đọc số dư. Chốt chặn nằm ở `guard` do nơi dựng truyền vào. */
export function buildWallet(c: WalletCore): DevWallet {
  const { account, pub, wallet, guard } = c;
  const send = makeSender(pub);
  const provider: Eip1193 = {
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address];
        case "eth_chainId":
          await guard();
          return `0x${(await pub.getChainId()).toString(16)}`;
        case "personal_sign": {
          await guard();
          const [msg, addr] = (params ?? []) as [string, string];
          if (String(addr).toLowerCase() !== account.address.toLowerCase()) throw Object.assign(new Error(`địa chỉ không phải của ${c.noun}`), { code: -32602 });
          return account.signMessage({ message: { raw: msg as Hex } });
        }
        case "wallet_switchEthereumChain":
          return null;
        default:
          throw Object.assign(new Error(`${c.noun} không hỗ trợ ${method}`), { code: 4200 });
      }
    },
  };
  const reconcile = (server: ReconcileServer, bookingId: string, txHash: Hex) => reconcileAfterTx(server, bookingId, txHash);
  return {
    kind: c.kind,
    address: account.address,
    label: c.label,
    rpcUrl: c.rpcUrl,
    provider,
    async pay(bookingId, server) {
      await guard();
      const r = await server.issueQuote(bookingId);
      const chainId = await pub.getChainId().catch((e) => { throw mapChainError(e); });
      if (chainId !== r.chainId) throw new ServiceError("rejected", "Ví đang kết nối sai mạng. Hãy chuyển ví sang đúng mạng rồi thử lại.");
      const q = toQuote(r.quote) as { token: Address; priceUnits: bigint; renter: Address };
      // Quote ghi địa chỉ renter lấy từ ví ĐÃ LIÊN KẾT trong DB. Mỗi cửa sổ/hồ sơ có khoá ví riêng: nếu khác ví đã liên kết,
      // escrow sẽ trả InvalidQuote (thông báo khó hiểu). Chặn sớm, trước khi nạp ví/approve/fund, và chỉ đúng việc cần làm.
      if (String(q.renter).toLowerCase() !== account.address.toLowerCase())
        throw new ServiceError("rejected", "Ví đang dùng trong ứng dụng không phải ví đã liên kết với tài khoản. Vào Ví → Liên kết ví rồi thử trả tiền lại.");
      await c.ensureFunds(q.token, q.priceUnits, server);
      await send(wallet, q.token, pcpAbi, "approve", [r.escrow as Address, q.priceUnits]);
      const tx = await send(wallet, r.escrow as Address, escrowAbi, "fund", [q, r.signature]);
      return reconcile(server, bookingId, tx);
    },
    async accept(a, server) {
      await guard();
      return reconcile(server, a.bookingId, await send(wallet, a.chain.escrow, escrowAbi, "accept", [a.chainBookingId]));
    },
    async cancelBeforeStart(a, server) {
      await guard();
      return reconcile(server, a.bookingId, await send(wallet, a.chain.escrow, escrowAbi, "cancelBeforeStart", [a.chainBookingId]));
    },
    async balance(token) {
      await guard();
      try {
        return ((await pub.readContract({ address: token, abi: pcpAbi, functionName: "balanceOf", args: [account.address] } as never)) as bigint).toString();
      } catch (e) {
        throw mapChainError(e);
      }
    },
    async credit(escrow) {
      await guard();
      try {
        return ((await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "credit", args: [account.address] } as never)) as bigint).toString();
      } catch (e) {
        throw mapChainError(e);
      }
    },
    async withdraw(escrow) {
      await guard();
      return send(wallet, escrow, escrowAbi, "withdrawPCP", []);
    },
    async gasBalance() {
      await guard();
      try {
        return (await pub.getBalance({ address: account.address })).toString();
      } catch (e) {
        throw mapChainError(e);
      }
    },
  };
}

export function createDevWallet(o: { rpcUrl: string; key: Hex; fetchFn?: typeof fetch }): DevWallet {
  if (!devWalletRpc(o.rpcUrl)) throw new ServiceError("unsupported", "Ví giả lập chỉ chạy với chuỗi loopback.");
  const account = privateKeyToAccount(o.key);
  const transport = http(o.rpcUrl, o.fetchFn ? { fetchFn: o.fetchFn } : undefined);
  const pub = createPublicClient({ transport }) as unknown as PubLike;
  const wallet = createWalletClient({ account, transport }) as unknown as WalletLike;
  const issuer = createWalletClient({ account: privateKeyToAccount(LOCAL_ISSUER_KEY), transport }) as unknown as WalletLike;
  const send = makeSender(pub);
  async function ensureFunds(token: Address, need: bigint) {
    try {
      const gas = await pub.getBalance({ address: account.address });
      if (gas < 10n ** 17n) await pub.request({ method: "hardhat_setBalance", params: [account.address, HUNDRED_ETH] } as never);
      const read = async (fn: "balanceOf" | "faucetClaimed") => pub.readContract({ address: token, abi: pcpAbi, functionName: fn, args: [account.address] } as never);
      let bal = (await read("balanceOf")) as bigint;
      if (bal < need && !((await read("faucetClaimed")) as boolean)) {
        await send(issuer, token, pcpAbi, "faucetMint", [account.address]);
        bal = (await read("balanceOf")) as bigint;
      }
      if (bal < need) throw new ServiceError("rejected", "Ví giả lập không đủ PCP (faucet chỉ cấp một lần cho mỗi ví).");
    } catch (e) {
      throw mapChainError(e);
    }
  }
  return buildWallet({
    kind: "dev", label: DEV_WALLET_LABEL, rpcUrl: o.rpcUrl, account, pub, wallet, noun: "ví giả lập",
    // Chốt chặn thứ hai: nút ở loopback phải tự nhận là Hardhat trước MỖI lần ký/gửi/đọc.
    guard: () => assertLocalHardhat((a) => pub.request(a as never)),
    ensureFunds,
  });
}

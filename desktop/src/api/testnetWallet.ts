/**
 * VÍ THỬ TRONG APP cho chuỗi thử CÔNG KHAI (Avalanche Fuji) — để người thử trên máy khác có ví mà không cần cài ví ngoài.
 * KHÔNG có giá trị tiền: PCP và AVAX testnet. Khoá riêng sinh trong app và lưu localStorage THEO TỪNG TÀI KHOẢN trên máy này (chỉ dùng cho testnet;
 * xoá dữ liệu app là mất ví; đăng nhập cùng tài khoản trên máy khác là một ví khác).
 *
 * Khác ví giả lập (devWallet.ts) ở chốt chặn và cách nạp tiền:
 *  - KHÔNG có đường nào dùng khoá Hardhat công khai hay `hardhat_*` (mọi thao tác chỉ là RPC chuẩn);
 *  - mỗi lần ký/gửi/đọc, RPC phải trả đúng chainId mà máy chủ công bố, nếu không thì dừng (không ký trên mạng khác);
 *  - gas và PCP lấy từ vòi PHÍA MÁY CHỦ (POST /api/faucet), không phải từ khoá nhúng trong app.
 */
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ServiceError } from "../mock/scenarios";
import { buildWallet, loadKey, mapChainError, pcpAbi, type DevWallet, type PubLike, type WalletLike } from "./devWallet";

export const TESTNET_WALLET_LABEL = "VÍ THỬ — Avalanche Fuji testnet, không có giá trị tiền";
export const TESTNET_STORAGE_KEY = "cpm.testWallet.v1";
/** Dưới mức này coi là thiếu gas cho approve + fund. */
export const MIN_GAS_WEI = parseEther("0.01");

/** Máy chủ RPC mà ví thử được phép dùng. PHẢI khớp connect-src trong src-tauri/tauri.conf.json (có test đối chiếu). */
export const TESTNET_RPC_HOSTS = ["api.avax-test.network", "avalanche-fuji-c-chain-rpc.publicnode.com"] as const;

/** RPC cho ví thử: https tới máy chủ trong danh sách cho phép (không userinfo/query), hoặc http loopback (kiểm thử cục bộ). Mọi dạng khác ⇒ null (fail-closed). */
export function testnetRpc(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  const m = /^https:\/\/([^/\s?#@:]+)(\/[^\s?#]*)?$/.exec(v);
  if (m) return (TESTNET_RPC_HOSTS as readonly string[]).includes(m[1]!) ? v : null;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(v)) return v;
  return null;
}
export const loadTestnetKey = (storage: Pick<Storage, "getItem" | "setItem"> | null): Hex => loadKey(storage, TESTNET_STORAGE_KEY);

/**
 * VÍ THEO TÀI KHOẢN. Trước đây cả app dùng MỘT khoá (`cpm.testWallet.v1`) nên mọi tài khoản trên cùng PC dùng chung một ví, mà máy chủ chỉ cho
 * một địa chỉ ví thuộc một tài khoản ⇒ tài khoản thứ hai không liên kết được ví. Nay mỗi tài khoản có khoá riêng trên PC này.
 */
export const TESTNET_ACCOUNT_KEY_PREFIX = "cpm.testWallet.v2:";
export const testnetAccountKeyName = (userId: string) => `${TESTNET_ACCOUNT_KEY_PREFIX}${userId}`;

type KeyStore = Pick<Storage, "getItem" | "setItem">;
const KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const readKey = (storage: KeyStore | null, name: string): Hex | null => {
  try {
    const v = storage?.getItem(name);
    return v && KEY_RE.test(v) ? (v as Hex) : null;
  } catch {
    return null;
  }
};

/** Địa chỉ (chữ thường) của khoá ví thử dùng chung cũ trên PC này; null nếu chưa có khoá cũ. */
export function legacyTestnetAddress(storage: KeyStore | null): string | null {
  const k = readKey(storage, TESTNET_STORAGE_KEY);
  return k ? privateKeyToAccount(k).address.toLowerCase() : null;
}

/** Cần tra ví đã liên kết của tài khoản không? Chỉ khi tài khoản chưa có khoá riêng nhưng PC còn khoá dùng chung cũ (để xem có kế thừa không). */
export const needsLinkedLookup = (storage: KeyStore | null, userId: string): boolean =>
  readKey(storage, testnetAccountKeyName(userId)) === null && readKey(storage, TESTNET_STORAGE_KEY) !== null;

/**
 * Khoá ví thử của MỘT tài khoản trên PC này.
 *  1. Đã có khoá riêng ⇒ dùng.
 *  2. Chưa có, PC còn khoá dùng chung cũ:
 *     - `linkedAddress` trùng địa chỉ của khoá cũ (máy chủ nói tài khoản này đang liên kết đúng ví đó) ⇒ KẾ THỪA: chép sang khoá riêng, giữ nguyên số dư;
 *     - `linkedAddress === undefined` (không tra cứu được, ví dụ máy chủ tắt) ⇒ tạm dùng khoá cũ, KHÔNG lưu khoá riêng (không nhận nhầm, lần sau tra lại);
 *     - còn lại (chưa liên kết ví nào, hoặc liên kết ví khác) ⇒ khoá mới. Khoá cũ giữ nguyên trong máy, không ai kế thừa được ngoài tài khoản đang liên kết nó.
 *  3. Chưa có gì ⇒ khoá mới, lưu riêng cho tài khoản.
 * Lưu trữ lỗi ⇒ khoá tạm của phiên (như `loadKey`).
 */
export function loadAccountTestnetKey(storage: KeyStore | null, userId: string, linkedAddress: string | null | undefined): Hex {
  const own = testnetAccountKeyName(userId);
  const mine = readKey(storage, own);
  if (mine) return mine;
  const legacy = readKey(storage, TESTNET_STORAGE_KEY);
  if (legacy) {
    if (linkedAddress === undefined) return legacy;
    if (linkedAddress !== null && linkedAddress.toLowerCase() === privateKeyToAccount(legacy).address.toLowerCase()) {
      try {
        storage?.setItem(own, legacy);
      } catch {
        /* không lưu được: vẫn dùng trong phiên */
      }
      return legacy;
    }
  }
  return loadKey(storage, own);
}

const NET_RE = /fetch failed|Failed to fetch|ECONNREFUSED|NetworkError|HTTP request failed|network|timeout|timed out/i;
/** Lỗi mạng ⇒ nói đúng là mạng thử không trả lời (không nhắc node Hardhat cục bộ); lỗi khác dịch như thường. */
function mapNet(e: unknown): ServiceError {
  if (e instanceof ServiceError) return e;
  if (NET_RE.test(String((e as Error)?.message ?? e)) && !/User rejected|denied/i.test(String((e as Error)?.message ?? e)))
    return new ServiceError("offline", "Không kết nối được mạng Avalanche Fuji. Kiểm tra mạng rồi thử lại.");
  return mapChainError(e);
}

export function createTestnetWallet(o: { rpcUrl: string; chainId: number; key: Hex; fetchFn?: typeof fetch; retryDelayMs?: number }): DevWallet {
  const rpc = testnetRpc(o.rpcUrl);
  if (!rpc) throw new ServiceError("unsupported", "RPC của ví thử phải là địa chỉ https công khai.");
  if (!Number.isInteger(o.chainId) || o.chainId <= 0) throw new ServiceError("unsupported", "Thiếu chainId hợp lệ cho ví thử.");
  const account = privateKeyToAccount(o.key);
  const transport = http(rpc, o.fetchFn ? { fetchFn: o.fetchFn } : undefined);
  const pub = createPublicClient({ transport }) as unknown as PubLike;
  const wallet = createWalletClient({ account, transport }) as unknown as WalletLike;
  const delay = o.retryDelayMs ?? 2000;

  /** Mỗi lần: RPC phải đúng chainId máy chủ công bố. */
  const guard = async () => {
    let id: number;
    try {
      id = await pub.getChainId();
    } catch (e) {
      throw mapNet(e);
    }
    if (id !== o.chainId) throw new ServiceError("unsupported", "Mạng đang kết nối không khớp với hệ thống nên ví không ký giao dịch. Hãy thử lại sau.");
  };

  const read = (token: Address, fn: "balanceOf") => pub.readContract({ address: token, abi: pcpAbi, functionName: fn, args: [account.address] } as never) as Promise<bigint>;
  async function ensureFunds(token: Address, need: bigint, server: { faucet?: () => Promise<unknown> }) {
    try {
      const state = async () => ({ gas: await pub.getBalance({ address: account.address }), bal: await read(token, "balanceOf") });
      let { gas, bal } = await state();
      if ((gas < MIN_GAS_WEI || bal < need) && server.faucet) {
        await server.faucet(); // máy chủ chờ receipt; RPC công khai có thể chậm vài giây ⇒ đọc lại vài lần
        for (let i = 0; i < 4; i++) {
          ({ gas, bal } = await state());
          if (gas >= MIN_GAS_WEI && bal >= need) break;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      if (gas < MIN_GAS_WEI) throw new ServiceError("rejected", `Ví chưa có AVAX để trả phí giao dịch. Vào Ví để nhận AVAX, hoặc nạp AVAX Fuji vào địa chỉ ${account.address} rồi thử lại.`);
      if (bal < need) throw new ServiceError("rejected", "Số dư PCP chưa đủ để thuê máy này. Vào Ví để kiểm tra số dư.");
    } catch (e) {
      throw mapNet(e);
    }
  }

  return buildWallet({ kind: "testnet", label: TESTNET_WALLET_LABEL, rpcUrl: rpc, account, pub, wallet, noun: "ví thử", guard, ensureFunds });
}

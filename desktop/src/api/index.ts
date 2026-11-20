import { service as mockService } from "../mock/service";
import { ServiceError } from "../mock/scenarios";
import { ENV, isLive } from "./env";
import { createLiveApi, type LiveApi } from "./live";
import { createDevWallet, devWalletRpc, loadDevKey, type DevWallet } from "./devWallet";
import { effectiveApiBase, saveApiOverride } from "./endpoint";
import { createServerApi, fetchChainInfo, type ServerApi } from "./server";
import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import { createTestnetWallet, loadAccountTestnetKey, needsLinkedLookup, testnetRpc } from "./testnetWallet";

let live: LiveApi | null = null;

const safeStorage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** Địa chỉ máy chủ API đang dùng: ghi đè lúc chạy (người thử dán mã kết nối) ưu tiên hơn giá trị lúc build. null nếu chưa cấu hình. */
export function apiBase(): string | null {
  if (ENV.mode !== "live") return null;
  return effectiveApiBase(ENV.apiBase, safeStorage());
}

/**
 * Nạp supabase-js CHỈ khi ở chế độ live (tách chunk riêng, preview không tải). Phải await trước khi render app.
 * Cấu hình sai thì ném lỗi: không bao giờ tạo bản giả.
 */
export async function bootLive(): Promise<void> {
  if (ENV.mode !== "live") throw new ServiceError("unsupported", "Ứng dụng không ở chế độ live.");
  if (live) return;
  const { createClient } = await import("@supabase/supabase-js");
  live = createLiveApi(
    createClient(ENV.url, ENV.anonKey, {
      // Phiên lưu trong localStorage của WebView/trình duyệt; refresh token tự động. Không có service-role.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    }),
  );
  await initTestnetWallet(); // không chặn khởi động nếu máy chủ chưa trả lời
}

/** Chỉ dùng sau `bootLive()`. Ném lỗi nếu chưa nạp: không trả bản giả. */
export function getLiveApi(): LiveApi {
  if (!live) throw new ServiceError("unsupported", "Kết nối live chưa được khởi tạo.");
  return live;
}

let server: ServerApi | null = null;
/** Client API server; báo rõ khi chưa cấu hình (VITE_API_BASE_URL hoặc mã kết nối) thay vì giả thành công. */
export function getServerApi(): ServerApi {
  const base = apiBase();
  if (!base) throw new ServiceError("unsupported", "Ứng dụng chưa kết nối máy chủ. Vào Cài đặt → Kết nối máy chủ để nhập địa chỉ.");
  server ??= createServerApi({ baseUrl: base, getToken: () => getLiveApi().accessToken() });
  return server;
}
export const serverApiConfigured = () => apiBase() !== null;

/** Đổi địa chỉ máy chủ lúc chạy (null ⇒ về giá trị lúc build). Làm mới client API và ví thử cho khớp máy chủ mới. */
export async function setApiOverride(value: string | null): Promise<boolean> {
  if (!saveApiOverride(safeStorage(), value)) return false;
  server = null;
  testnetWallet = null;
  await initTestnetWallet();
  return true;
}

let devWallet: DevWallet | null | undefined;
let testnetWallet: DevWallet | null = null;
let walletIssue: string | null = null;
/** Lý do app chưa có ví thử dù máy chủ có khai chuỗi (null nếu không có vấn đề hoặc máy chủ không khai chuỗi). */
export const walletProblem = (): string | null => walletIssue;
/**
 * Ví của app: VÍ GIẢ LẬP (chỉ chuỗi cục bộ) nếu bản build bật VITE_DEV_WALLET_RPC loopback; ngược lại VÍ THỬ cho chuỗi công khai nếu
 * máy chủ công bố RPC + chainId (xem `initTestnetWallet`). Không có đường nào khác để bật ví (fail-closed).
 */
export function getDevWallet(): DevWallet | null {
  if (devWallet === undefined) {
    devWallet = null;
    if (ENV.mode === "live") {
      const rpc = devWalletRpc((import.meta.env as unknown as Record<string, string | undefined>).VITE_DEV_WALLET_RPC);
      if (rpc) devWallet = createDevWallet({ rpcUrl: rpc, key: loadDevKey(safeStorage()) });
    }
  }
  return devWallet ?? testnetWallet;
}

/** Chuỗi công khai mà máy chủ khai (đã kiểm RPC trong danh sách cho phép); null nếu không có ví thử. */
let chainCfg: { rpc: string; chainId: number } | null = null;
/** Tài khoản mà ví thử hiện đang dựng cho (null = chưa đăng nhập). */
let walletUserId: string | null = null;
let walletSeq = 0;
/** Tài khoản đang gắn với ví thử của app (để kiểm thử và để `applyLiveAccount` tự bù nếu nơi gọi quên). */
export const walletAccountId = (): string | null => walletUserId;

/**
 * Dựng ví thử cho tài khoản đang đăng nhập: mỗi tài khoản một khoá riêng trên PC này (xem `loadAccountTestnetKey`), vì máy chủ chỉ cho một địa chỉ
 * ví thuộc một tài khoản. Chưa đăng nhập: khoá tạm KHÔNG lưu, chỉ để các nhãn mạng ("Mạng thử nghiệm") có dữ liệu; không ai dùng nó để ký.
 * Gọi lại liên tục an toàn: chỉ kết quả của lần gọi MỚI NHẤT được áp dụng.
 */
async function rebuildTestnetWallet(): Promise<void> {
  const seq = ++walletSeq;
  const cfg = chainCfg;
  const user = walletUserId;
  let built: DevWallet | null = null;
  if (cfg) {
    try {
      let key: Hex;
      if (!user) key = generatePrivateKey();
      else {
        const storage = safeStorage();
        // Chỉ khi cần phân xử kế thừa ví cũ mới hỏi máy chủ; tra lỗi ⇒ undefined (tạm dùng khoá cũ, không lưu).
        const linked = needsLinkedLookup(storage, user) ? await getLiveApi().wallet.linked().then((r) => r?.address ?? null, () => undefined) : null;
        key = loadAccountTestnetKey(storage, user, linked);
      }
      built = createTestnetWallet({ rpcUrl: cfg.rpc, chainId: cfg.chainId, key });
    } catch {
      built = null;
    }
  }
  if (seq === walletSeq) testnetWallet = built;
}

/** Gắn ví thử của app với tài khoản đang đăng nhập (userId) hoặc gỡ khi đăng xuất (null). Không ném lỗi. */
export async function activateWalletForAccount(userId: string | null): Promise<void> {
  walletUserId = userId;
  if (ENV.mode !== "live") return;
  if (!chainCfg && userId) await loadChainConfig(); // máy chủ chưa trả lời lúc mở app: thử lại khi người dùng đăng nhập
  await rebuildTestnetWallet();
}

/** Đọc RPC + chainId công khai từ máy chủ vào `chainCfg`. Không ném lỗi; ghi lý do vào walletIssue khi có vấn đề. */
async function loadChainConfig(): Promise<void> {
  chainCfg = null;
  walletIssue = null;
  if (ENV.mode !== "live") return;
  if (getDevWalletFromEnvOnly()) return;
  const base = apiBase();
  if (!base) return;
  const info = await fetchChainInfo(base);
  if (!info) {
    walletIssue = "Chưa đọc được thông tin mạng từ máy chủ (máy chủ đang tắt hoặc mạng lỗi). Hãy thử lại sau.";
    return;
  }
  if (!info.rpcUrl) return; // máy chủ không khai RPC công khai: không có ví thử, đó là cấu hình hợp lệ
  const rpc = testnetRpc(info.rpcUrl);
  if (!rpc) {
    walletIssue = "Máy chủ đang dùng một mạng không được ứng dụng này hỗ trợ nên ví chưa hoạt động.";
    return;
  }
  chainCfg = { rpc, chainId: info.chainId };
}

/** Lấy RPC + chainId công khai từ máy chủ rồi dựng ví thử. Bỏ qua khi bản build đã bật ví giả lập hoặc máy chủ không khai RPC. Không ném lỗi. */
export async function initTestnetWallet(): Promise<void> {
  testnetWallet = null;
  await loadChainConfig();
  await rebuildTestnetWallet();
}
const getDevWalletFromEnvOnly = (): DevWallet | null => {
  if (devWallet === undefined) getDevWallet();
  return devWallet ?? null;
};

type MockService = typeof mockService;

/**
 * Dịch vụ dữ liệu cho UI. Preview: mock có nhãn. Live: chỉ phần đã nối API thật (danh mục máy); mọi thao tác chưa nối
 * từ chối với ServiceError("unsupported") — KHÔNG trả dữ liệu mẫu, KHÔNG báo thành công giả.
 */
function makeLiveService(): MockService {
  const unsupported = (what: string) => new ServiceError("unsupported", `${what} đang được hoàn thiện.`);
  const real = {
    listMachines: () => getLiveApi().catalog.list(),
    getMachine: (id: string) => getLiveApi().catalog.get(id).then((r) => r?.machine ?? null),
  } as const;
  return new Proxy({} as MockService, {
    get(_t, prop: string) {
      if (prop in real) return real[prop as keyof typeof real];
      // Hàm ghi đồng bộ của mock (add*/delete*/mark*/set*/resolve*): không có tác dụng ở live.
      if (/^(add|delete|mark|set|resolve)/.test(prop)) return () => undefined;
      return () => Promise.reject(unsupported(prop));
    },
  });
}

export const service: MockService = isLive() ? makeLiveService() : mockService;

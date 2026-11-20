/**
 * Client cho API server (server/): ví, quote, đối soát, nhận đường dẫn xem. Chỉ gửi token người dùng Supabase
 * (Authorization: Bearer); không có khoá nào khác trong app. Tiền luôn là chuỗi. Không gọi được thì báo lỗi, không giả.
 */
import { ServiceError } from "../mock/scenarios";

export interface ServerApiOptions {
  baseUrl: string;
  /** Trả access token hiện tại của người dùng (Supabase session) hoặc null. */
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

const MESSAGES: Record<string, string> = {
  unauthorized: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.",
  wallet_required: "Hãy liên kết ví trước (Ví → Liên kết ví).",
  host_wallet_required: "Chủ máy chưa liên kết ví nhận tiền nên chưa thể thuê máy này.",
  quote_expired: "Hết thời gian giữ máy. Hãy giữ máy lại.",
  invalid_state: "Phiên thuê không còn ở trạng thái phù hợp để thực hiện việc này.",
  no_grant: "Chưa có quyền xem màn hình: phiên chưa bắt đầu, đã kết thúc hoặc đã hết hạn.",
  rate_limited: "Quá nhiều yêu cầu, hãy thử lại sau ít phút.",
  server_not_configured: "Dịch vụ chưa sẵn sàng. Hãy thử lại sau.",
  wallet_taken: "Ví này đã được liên kết với tài khoản khác.",
  wallet_change_blocked: "Chưa thể đổi ví khi còn phiên thuê chưa kết thúc.",
  bad_signature: "Chữ ký không khớp với ví. Hãy thử lại.",
  invalid_challenge: "Yêu cầu xác minh đã hết hạn hoặc đã dùng. Hãy bắt đầu lại.",
  machine_occupied_onchain: "Máy đang có giao dịch khác chưa hoàn tất. Hãy thử lại sau ít phút.",
  chain_unavailable: "Chưa đọc được dữ liệu từ mạng blockchain. Hãy thử lại sau.",
  faucet_disabled: "Hiện chưa phát PCP miễn phí.",
  faucet_chain_error: "Chưa nhận được PCP lúc này. Hãy thử lại sau ít phút.",
  // Cố ý KHÔNG khai `forbidden`/`unavailable` ở đây: bảng này áp cho MỌI endpoint (workspace, quote…), còn mỗi endpoint đã tự trả thông báo
  // cụ thể trong `error.message` (ví dụ enrollment: "Chỉ chủ máy…"). Khai chung sẽ đè thông báo đúng bằng thông báo sai ngữ cảnh.
};

export interface ChainInfoPublic {
  chainId: number;
  escrow: string;
  pcp?: string;
  /** RPC công khai của chuỗi (có khi máy chủ khai PUBLIC_RPC_URL hoặc chạy chuỗi cục bộ). */
  rpcUrl?: string;
  /** Máy chủ có bật vòi testnet không. */
  faucet?: boolean;
}

/** chain-info là CÔNG KHAI (không bí mật): gọi được trước khi đăng nhập. Lỗi/định dạng sai ⇒ null (không đoán). */
export async function fetchChainInfo(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 4000): Promise<ChainInfoPublic | null> {
  try {
    // Có hạn chót: máy chủ/tunnel của người tổ chức tắt thì app vẫn mở được (bootLive đợi hàm này).
    const r = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chain-info`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const j = (await r.json()) as Partial<ChainInfoPublic>;
    if (!Number.isInteger(j.chainId) || typeof j.escrow !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(j.escrow)) return null;
    return { chainId: j.chainId as number, escrow: j.escrow, pcp: typeof j.pcp === "string" ? j.pcp : undefined, rpcUrl: typeof j.rpcUrl === "string" ? j.rpcUrl : undefined, faucet: j.faucet === true };
  } catch {
    return null;
  }
}

export function createServerApi(o: ServerApiOptions) {
  const f = o.fetchImpl ?? fetch;
  const base = o.baseUrl.replace(/\/+$/, "");
  async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const token = await o.getToken();
    if (!token) throw new ServiceError("auth", "Cần đăng nhập.");
    let r: Response;
    try {
      r = await f(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ServiceError("offline", "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
    }
    const data = (await r.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
    if (r.status >= 400) {
      const code = data.error?.code ?? "server";
      throw new ServiceError(r.status === 401 ? "auth" : r.status >= 500 ? "server" : "rejected", MESSAGES[code] ?? data.error?.message ?? "Có lỗi xảy ra. Hãy thử lại sau ít phút.");
    }
    return { status: r.status, data };
  }
  return {
    walletChallenge: (address: string, chainId: number) => call<{ message: string; nonce: string; expiresAt: string }>("POST", "/wallet/challenge", { address, chainId }).then((r) => r.data),
    walletVerify: (nonce: string, signature: string) => call<{ linked: boolean; address: string }>("POST", "/wallet/verify", { nonce, signature }).then((r) => r.data),
    issueQuote: (bookingId: string) => call<{ quote: Record<string, string>; signature: string; escrow: string; chainId: number }>("POST", `/bookings/${bookingId}/quote`).then((r) => r.data),
    reconcile: (bookingId: string, txHash: string) => call<{ status: string; applied?: { event: string; outcome: string }[] }>("POST", `/bookings/${bookingId}/reconcile`, { txHash }).then((r) => ({ pending: r.status === 202, ...r.data })),
    chainInfo: () => call<ChainInfoPublic>("GET", "/chain-info").then((r) => r.data),
    /** Xin PCP thử + một ít AVAX gas cho ví ĐÃ LIÊN KẾT của chính mình (máy chủ tự lấy địa chỉ, client không chọn). */
    faucet: () => call<{ address: string; pcp: { claimed: boolean; minted: boolean; txHash?: string }; gas: { balanceWei: string; sent: boolean; txHash?: string; reason?: string } }>("POST", "/faucet").then((r) => r.data),
    connect: (bookingId: string) => call<{ viewerUrl: string }>("POST", `/bookings/${bookingId}/connect`).then((r) => r.data),
    /**
     * Chủ máy tự xin mã ghi danh thiết bị cho máy ĐÃ ĐĂNG của mình (không cần admin). Mã dùng một lần, hết hạn sau 10 phút; trả về CHỈ để đưa
     * thẳng vào guest (hostNative.enroll). Người gọi không được hiển thị, ghi log hay lưu mã này.
     */
    createMyEnrollment: (machineId: string) => call<{ enrollmentToken: string }>("POST", "/host/enrollments", { machineId, ttlSeconds: 600 }).then((r) => r.data.enrollmentToken),
    /** Chủ máy thu hồi thiết bị đang ghi danh của máy mình (thiết bị cũ ngừng hoạt động ngay). Cần trước khi ghi danh lại. */
    revokeMyDevice: (machineId: string) => call<{ revoked: boolean }>("POST", "/host/devices/revoke", { machineId }).then((r) => r.data),
  };
}
export type ServerApi = ReturnType<typeof createServerApi>;

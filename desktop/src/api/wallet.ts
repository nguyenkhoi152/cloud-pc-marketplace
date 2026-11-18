/**
 * Liên kết ví qua provider chuẩn EIP-1193 (ví trình duyệt/extension). App KHÔNG giữ seed/khoá riêng: chỉ nhờ ví ký
 * thông điệp xác minh (không giao dịch, không phí) do server dựng. Không tự đổi mạng thay người dùng.
 * Trong shell Tauri chưa có connector ví: khi không có provider, UI báo rõ thay vì giả.
 */
import { ServiceError } from "../mock/scenarios";
import type { ServerApi } from "./server";

export interface Eip1193 {
  request(a: { method: string; params?: unknown[] }): Promise<unknown>;
}

const utf8Hex = (s: string) => "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

function mapWalletError(e: unknown): never {
  const err = e as { code?: number; message?: string };
  if (err.code === 4001 || /user rejected|user denied/i.test(String(err.message))) throw new ServiceError("rejected", "Bạn đã từ chối trong ví. Chưa liên kết gì.");
  if (err.code === -32002) throw new ServiceError("rejected", "Ví đang chờ bạn xử lý một yêu cầu khác; mở ví để tiếp tục.");
  throw e instanceof ServiceError ? e : new ServiceError("server", `Ví báo lỗi: ${String(err.message ?? e).slice(0, 120)}`);
}

export async function linkWallet(provider: Eip1193, server: Pick<ServerApi, "walletChallenge" | "walletVerify">, chainId: number): Promise<{ address: string }> {
  let address: string;
  try {
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as unknown;
    address = Array.isArray(accounts) ? String(accounts[0] ?? "") : "";
  } catch (e) {
    return mapWalletError(e);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ServiceError("rejected", "Ví không trả về địa chỉ hợp lệ.");

  let current: number;
  try {
    current = parseInt(String(await provider.request({ method: "eth_chainId" })), 16);
  } catch (e) {
    return mapWalletError(e);
  }
  // Không tự gọi wallet_switchEthereumChain: đổi mạng là quyết định của người dùng trong ví.
  if (current !== chainId) throw new ServiceError("rejected", `Ví đang ở mạng ${Number.isFinite(current) ? current : "không rõ"}; hãy chuyển sang mạng ${chainId} (Avalanche Fuji) rồi thử lại.`);

  const ch = await server.walletChallenge(address, chainId);
  let signature: string;
  try {
    // personal_sign nhận thông điệp dạng hex; ví hiển thị lại chữ cho người dùng đọc trước khi ký.
    signature = String(await provider.request({ method: "personal_sign", params: [utf8Hex(ch.message), address] }));
  } catch (e) {
    return mapWalletError(e);
  }
  const r = await server.walletVerify(ch.nonce, signature);
  return { address: r.address };
}

/**
 * Cầu nối tới lớp native của app Windows (desktop/src-tauri/src/host.rs) cho chế độ Cho thuê máy.
 * Chỉ có trong app đã cài (Tauri). Trong trình duyệt (Vite dev) lớp này KHÔNG tồn tại: mọi lời gọi báo "unsupported",
 * không bao giờ trả kết quả giả. UI chỉ gọi được đúng các lệnh cố định dưới đây.
 */
import type { Captured, Overview } from "../domain/hostEnv";
import type { TunnelInfo } from "../domain/hostStart";
import { ServiceError } from "../mock/scenarios";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function invoker(): Invoke | null {
  const t = (globalThis as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__;
  return typeof t?.core?.invoke === "function" ? t.core.invoke : null;
}

/** true khi chạy trong app Windows đã cài (có lớp native). */
export const hostNativeAvailable = () => invoker() !== null;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const inv = invoker();
  if (!inv) throw new ServiceError("unsupported", "Chức năng này chỉ có trong app Windows đã cài (không chạy trong trình duyệt).");
  try {
    return await inv<T>(cmd, args);
  } catch (e) {
    // Lớp native trả lỗi dạng chuỗi tiếng Việt đã lọc (không chứa token/credential).
    throw new ServiceError("rejected", typeof e === "string" ? e : String((e as Error)?.message ?? e).slice(0, 200));
  }
}

export interface AgentConfigInput {
  apiBase: string;
  frameAncestors: string[];
  gpu?: boolean;
  /** URL https công khai của tunnel (từ tunnelState). Không có ⇒ gateway chỉ cho người thuê trên chính máy này. */
  publicUrl?: string;
  /** Giới hạn tài nguyên của container khách. Không có ⇒ không giới hạn. */
  memoryMb?: number;
  cpus?: number;
}

export const hostNative = {
  /** Chỉ đọc: trạng thái WSL của Windows, backend đã chọn, tiến trình agent/cài đặt do app quản lý. */
  overview: () => call<Overview>("host_overview"),
  setWslDistro: (distro: string) => call<void>("host_set_wsl_distro", { distro }),
  /** Chỉ đọc trong guest. */
  probe: (apiBase?: string) => call<Captured>("host_probe", { apiBase: apiBase ?? null }),
  installAgent: () => call<Captured>("host_install_agent"),
  configure: (config: AgentConfigInput) => call<Captured>("host_configure", { config }),
  enroll: (token: string) => call<Captured>("host_enroll", { token }),
  provisionStart: (user: string) => call<void>("host_provision_start", { user }),
  agentStart: () => call<void>("host_agent_start"),
  agentStop: () => call<Captured>("host_agent_stop"),
  cleanup: () => call<Captured>("host_cleanup"),
  /** Cho phép app thu về khay hệ thống khi đóng cửa sổ trong lúc đang nhận thuê. */
  setBackground: (enabled: boolean) => call<void>("host_set_background", { enabled }),
  /** "Cài giúp tôi": bật WSL bằng hộp thoại UAC (không kèm bản Linux). Có thể cần khởi động lại; app không tự khởi động lại. */
  wslInstallFeatures: () => call<Captured>("host_wsl_install_features"),
  /** Mở cửa sổ riêng cài bản Linux (Ubuntu-24.04); người dùng tự đặt user/mật khẩu trong cửa sổ đó. */
  wslInstallDistro: () => call<void>("host_wsl_install_distro"),
  /** Tunnel Cloudflare tới gateway cục bộ (chỉ kết nối RA). Cần thành phần cloudflared đi kèm bộ cài. */
  tunnelStart: () => call<void>("host_tunnel_start"),
  tunnelState: () => call<TunnelInfo>("host_tunnel_state"),
  tunnelStop: () => call<void>("host_tunnel_stop"),
};
export type HostNative = typeof hostNative;

/**
 * Origin được phép nhúng viewer của gateway: origin của chính app (Tauri Windows: http://tauri.localhost). Khi app đang ở
 * chế độ demo cục bộ (ví giả lập bật) thêm origin của Vite dev để kiểm bằng trình duyệt.
 */
export function viewerOrigins(appOrigin: string, localDemo: boolean): string[] {
  const out = new Set<string>(["http://tauri.localhost"]);
  if (/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(appOrigin)) out.add(appOrigin);
  if (localDemo) for (const o of ["http://127.0.0.1:5174", "http://localhost:5174"]) out.add(o);
  return [...out];
}

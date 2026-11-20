/**
 * Trình tự bắt đầu/dừng nhận thuê, tách khỏi giao diện để kiểm thử được.
 *
 * Mỗi lần BẮT ĐẦU đều ghi lại cấu hình agent (địa chỉ máy chủ API hiện tại + địa chỉ công khai của tunnel), vì cả hai có thể đã đổi từ lần
 * chạy trước: tunnel nhanh của Cloudflare cho địa chỉ mới mỗi lần mở, và người tổ chức có thể đã đổi mã kết nối. Nếu không ghi lại, agent
 * dùng địa chỉ cũ và máy "đang nhận thuê" nhưng không ai vào được.
 * Bất kỳ bước nào lỗi ⇒ tunnel vừa mở bị đóng lại (không để lối vào Internet mở mà agent không chạy).
 */
import { guestError } from "./hostEnv";

export interface Captured { code: number; stdout: string; stderr: string }
export interface TunnelInfo { state: "never" | "running" | "exited"; url: string | null; exitCode: number | null; logTail: string }

export interface HostStartDeps {
  tunnelStart(): Promise<void>;
  tunnelState(): Promise<TunnelInfo>;
  tunnelStop(): Promise<void>;
  configure(c: { apiBase: string; frameAncestors: string[]; publicUrl?: string; memoryMb?: number; cpus?: number }): Promise<Captured>;
  agentStart(): Promise<void>;
  agentStop(): Promise<Captured>;
  sleep(ms: number): Promise<void>;
}

const TUNNEL_URL = /^https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com$/;
export const isTunnelUrl = (s: string | null | undefined): s is string => !!s && TUNNEL_URL.test(s);

/** Chờ tunnel có địa chỉ công khai. Tiến trình thoát hoặc quá hạn ⇒ lỗi kèm gợi ý. */
export async function waitForTunnelUrl(d: Pick<HostStartDeps, "tunnelState" | "sleep">, timeoutMs = 60_000, stepMs = 1_000): Promise<string> {
  let waited = 0;
  for (;;) {
    const s = await d.tunnelState();
    if (s.state === "running" && isTunnelUrl(s.url)) return s.url;
    if (s.state === "exited") throw new Error(`Chưa tạo được địa chỉ truy cập từ xa (mã ${s.exitCode ?? "?"}). Mạng của bạn có thể đang chặn kết nối ra ngoài. ${lastLine(s.logTail)}`.trim());
    if (waited >= timeoutMs) throw new Error(`Chưa tạo được địa chỉ truy cập từ xa sau ${Math.round(timeoutMs / 1000)} giây. ${lastLine(s.logTail)}`.trim());
    await d.sleep(stepMs);
    waited += stepMs;
  }
}
const lastLine = (t: string) => {
  const l = t.split("\n").map((x) => x.trim()).filter(Boolean).pop() ?? "";
  return l ? `Dòng cuối nhật ký: ${l.slice(0, 160)}` : "";
};

export async function startHosting(d: HostStartDeps, o: { apiBase: string; frameAncestors: string[]; share: boolean; timeoutMs?: number; memoryMb?: number; cpus?: number }): Promise<{ publicUrl: string | null }> {
  let tunnelOpened = false;
  try {
    let publicUrl: string | null = null;
    if (o.share) {
      await d.tunnelStart();
      tunnelOpened = true;
      publicUrl = await waitForTunnelUrl(d, o.timeoutMs);
    }
    const c = await d.configure({ apiBase: o.apiBase, frameAncestors: o.frameAncestors, ...(publicUrl ? { publicUrl } : {}), ...(o.memoryMb ? { memoryMb: o.memoryMb } : {}), ...(o.cpus ? { cpus: o.cpus } : {}) });
    const e = guestError(c);
    if (e) throw new Error(e);
    await d.agentStart();
    return { publicUrl };
  } catch (err) {
    if (tunnelOpened) await d.tunnelStop().catch(() => undefined);
    throw err;
  }
}

/** Dừng agent (cắt phiên, dọn guest) rồi LUÔN đóng tunnel, kể cả khi dừng agent báo lỗi. */
export async function stopHosting(d: Pick<HostStartDeps, "agentStop" | "tunnelStop">): Promise<Captured> {
  try {
    return await d.agentStop();
  } finally {
    await d.tunnelStop().catch(() => undefined);
  }
}

/**
 * Đăng xuất khi máy đang nhận thuê. Trước đây đăng xuất chỉ xoá phiên đăng nhập, còn agent ở bản Linux vẫn gửi nhịp tim
 * nên máy của chủ máy vẫn hiện ONLINE cho người thuê dù chủ máy đã thoát (người thuê đặt được máy không còn ai phục vụ).
 * Nay: đăng xuất trong app Windows kiểm tra xem agent có đang chạy không; nếu có thì hỏi lại, dừng nhận thuê
 * (agent báo offline, cắt phiên, dọn môi trường khách, đóng tunnel) rồi mới đăng xuất.
 * Tách khỏi giao diện để kiểm thử được. Không bao giờ chặn đăng xuất: lỗi dừng chỉ được báo cho người dùng.
 */
import { guestError, parseProbe, type Captured, type Overview } from "./hostEnv";
import { stopHosting } from "./hostStart";

export interface SignOutDeps {
  /** false ⇒ không có lớp native (trình duyệt): không có gì để dừng. */
  available(): boolean;
  overview(): Promise<Pick<Overview, "backend" | "agent">>;
  probe(): Promise<Captured>;
  agentStop(): Promise<Captured>;
  tunnelStop(): Promise<void>;
}

/** running: agent đang chạy (hỏi + dừng). none: chắc chắn không chạy. unknown: không kiểm tra được (WSL lỗi, hết giờ). */
export type HostingStatus = "none" | "running" | "unknown";

const TIMEOUT = Symbol("timeout");
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(TIMEOUT), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Agent có đang chạy không? Nhìn cả tiến trình do app quản lý lẫn agent chạy nền độc lập trong bản Linux (do script khởi động),
 * vì agent loại sau không nằm trong `overview().agent`.
 */
export async function hostingStatus(d: SignOutDeps, timeoutMs = 20_000): Promise<HostingStatus> {
  if (!d.available()) return "none";
  try {
    const r = await withTimeout(
      (async (): Promise<HostingStatus> => {
        const o = await d.overview();
        if (o.agent.state === "running") return "running";
        if (!o.backend) return "none"; // chưa chọn bản Linux ⇒ chưa từng nhận thuê trên máy này
        const p = parseProbe(await d.probe());
        if (!p.ok) return "unknown";
        return p.agentRunning ? "running" : "none";
      })(),
      timeoutMs,
    );
    return r === TIMEOUT ? "unknown" : r;
  } catch {
    return "unknown";
  }
}

export type StopOutcome = { ok: true } | { ok: false; error: string };

/** Dừng nhận thuê để đăng xuất. Luôn đóng tunnel (kể cả khi dừng agent lỗi). Không ném lỗi. */
export async function stopForSignOut(d: Pick<SignOutDeps, "agentStop" | "tunnelStop">): Promise<StopOutcome> {
  try {
    const e = guestError(await stopHosting(d));
    return e ? { ok: false, error: e } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const SIGN_OUT_WARNINGS = {
  /** Không kiểm tra được: vẫn đăng xuất, nhưng nói rõ để chủ máy tự kiểm. */
  unknown: "Chưa kiểm tra được máy có đang nhận thuê không. Nếu có, máy vẫn hiện online cho tới khi bạn dừng trong Thiết lập & chạy máy.",
  stopFailed: (reason: string) => `Chưa dừng được nhận thuê (${reason}). Máy có thể còn hiện online tối đa khoảng 90 giây, hoặc tới khi bạn dừng trong Thiết lập & chạy máy.`,
} as const;

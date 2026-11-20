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
  /** Mã các máy thuộc tài khoản đang đăng nhập. Dùng để KHÔNG dừng nhầm máy của chủ máy khi người khác đăng xuất trên cùng PC. */
  ownMachineIds(): Promise<string[]>;
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
 * Tài khoản đang đăng xuất có đang nhận thuê trên PC này không? Nhìn cả tiến trình do app quản lý lẫn agent chạy nền độc lập
 * trong bản Linux (do script khởi động), vì agent loại sau không nằm trong `overview().agent`.
 * Agent chạy nền chỉ tính là của tài khoản này khi máy nó ghi danh nằm trong các máy của tài khoản: người thuê (hoặc host khác)
 * đăng xuất trên PC của chủ máy KHÔNG được dừng máy của chủ máy. Không tra cứu được ⇒ coi là của mình (hỏi lại cho chắc).
 */
export async function hostingStatus(d: SignOutDeps, timeoutMs = 20_000): Promise<HostingStatus> {
  if (!d.available()) return "none";
  try {
    const r = await withTimeout(
      (async (): Promise<HostingStatus> => {
        const o = await d.overview();
        if (o.agent.state === "running") return "running"; // do CHÍNH app này bật, nên là phiên của người đang dùng app
        if (!o.backend) return "none"; // chưa chọn bản Linux ⇒ chưa từng nhận thuê trên máy này
        const p = parseProbe(await d.probe());
        if (!p.ok) return "unknown";
        if (!p.agentRunning) return "none";
        if (!p.machineId) return "running"; // đang chạy nhưng không rõ máy nào: không đoán là của người khác
        const mine = await d.ownMachineIds().then((ids) => ids.includes(p.machineId!), () => true);
        return mine ? "running" : "none";
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

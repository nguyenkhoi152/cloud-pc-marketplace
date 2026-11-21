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
  /** Xoá credential cục bộ của agent trong bản Linux (lệnh native `host_unenroll`). Không có ⇒ bỏ qua bước này. */
  unenroll?(): Promise<Captured>;
  /** Thu hồi thiết bị của máy phía máy chủ (credential cũ hết hiệu lực). Không có ⇒ bỏ qua bước này. */
  revokeDevice?(machineId: string): Promise<void>;
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

/** Kết quả kiểm tra trước khi đăng xuất. */
export interface SignOutInspection {
  hosting: HostingStatus;
  /**
   * Máy THUỘC tài khoản đang đăng xuất mà bản Linux đang ghi danh (cần gỡ ghi danh khi đăng xuất, để tài khoản khác đăng nhập
   * trên cùng PC bắt đầu từ đầu). null: không có, hoặc không chắc là của tài khoản này (không bao giờ gỡ ghi danh của máy khác).
   */
  ownMachineId: string | null;
}

/**
 * Tài khoản đang đăng xuất có đang nhận thuê trên PC này không, và bản Linux có đang ghi danh cho máy của tài khoản này không?
 * Nhìn cả tiến trình do app quản lý lẫn agent chạy nền độc lập trong bản Linux (do script khởi động), vì agent loại sau không
 * nằm trong `overview().agent`. Agent chạy nền chỉ tính là của tài khoản này khi máy nó ghi danh nằm trong các máy của tài khoản:
 * người thuê (hoặc host khác) đăng xuất trên PC của chủ máy KHÔNG được dừng máy của chủ máy. Không tra cứu được danh sách máy ⇒
 * coi agent là của mình (hỏi lại cho chắc), nhưng KHÔNG gỡ ghi danh (không chắc là của mình).
 */
export async function inspectForSignOut(d: SignOutDeps, timeoutMs = 20_000): Promise<SignOutInspection> {
  if (!d.available()) return { hosting: "none", ownMachineId: null };
  try {
    const r = await withTimeout(
      (async (): Promise<SignOutInspection> => {
        const o = await d.overview();
        if (o.agent.state === "running") return { hosting: "running", ownMachineId: null }; // do CHÍNH app này bật, nên là phiên của người đang dùng app
        if (!o.backend) return { hosting: "none", ownMachineId: null }; // chưa chọn bản Linux ⇒ chưa từng nhận thuê trên máy này
        const p = parseProbe(await d.probe());
        if (!p.ok) return { hosting: "unknown", ownMachineId: null };
        // null = không tra cứu được danh sách máy của tài khoản.
        const ids = p.machineId ? await d.ownMachineIds().then((x): string[] | null => x, () => null) : null;
        const ownMachineId = p.enrolled && p.machineId && ids?.includes(p.machineId) ? p.machineId : null;
        if (!p.agentRunning) return { hosting: "none", ownMachineId };
        if (!p.machineId) return { hosting: "running", ownMachineId: null }; // đang chạy nhưng không rõ máy nào: không đoán là của người khác
        const mine = ids === null ? true : ids.includes(p.machineId);
        return { hosting: mine ? "running" : "none", ownMachineId };
      })(),
      timeoutMs,
    );
    return r === TIMEOUT ? { hosting: "unknown", ownMachineId: null } : r;
  } catch {
    return { hosting: "unknown", ownMachineId: null };
  }
}

/** Chỉ cần biết có đang nhận thuê không. */
export async function hostingStatus(d: SignOutDeps, timeoutMs = 20_000): Promise<HostingStatus> {
  return (await inspectForSignOut(d, timeoutMs)).hosting;
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

export interface ReleaseOutcome {
  /** Đã xoá credential cục bộ trong bản Linux. */
  localCleared: boolean;
  /** Đã thu hồi thiết bị phía máy chủ (credential cũ không còn dùng được dù ai giữ bản sao). */
  serverRevoked: boolean;
  errors: string[];
}

/**
 * Gỡ ghi danh máy của tài khoản đang đăng xuất khỏi PC này: xoá credential cục bộ VÀ thu hồi thiết bị phía máy chủ. Hai việc độc lập
 * (một việc lỗi thì vẫn làm việc kia). Chỉ gọi khi agent đã dừng. Không bao giờ ném lỗi: đăng xuất không bị chặn.
 */
export async function releaseEnrollment(d: Pick<SignOutDeps, "unenroll" | "revokeDevice">, machineId: string): Promise<ReleaseOutcome> {
  const out: ReleaseOutcome = { localCleared: false, serverRevoked: false, errors: [] };
  if (d.unenroll) {
    try {
      const e = guestError(await d.unenroll());
      if (e) out.errors.push(e);
      else out.localCleared = true;
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (d.revokeDevice) {
    try {
      await d.revokeDevice(machineId);
      out.serverRevoked = true;
    } catch (e) {
      out.errors.push(`Chưa thu hồi được thiết bị trên máy chủ (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return out;
}

export const SIGN_OUT_WARNINGS = {
  /** Không kiểm tra được: nói rõ hậu quả để chủ máy quyết định (hộp thoại), thay vì lặng lẽ đăng xuất. */
  unknown: "Chưa kiểm tra được máy có đang nhận thuê không. Nếu có, máy vẫn hiện online cho tới khi bạn dừng trong Thiết lập & chạy máy.",
  stopFailed: (reason: string) => `Chưa dừng được nhận thuê (${reason}). Máy có thể còn hiện online tối đa khoảng 90 giây, hoặc tới khi bạn dừng trong Thiết lập & chạy máy.`,
  released: "Đã gỡ ghi danh máy khỏi bản Linux này: tài khoản khác đăng nhập trên máy này sẽ bắt đầu từ đầu.",
  releaseFailed: (reasons: string) => `Chưa gỡ hết ghi danh của máy khỏi bản Linux này (${reasons}). Tài khoản khác đăng nhập trên máy này có thể vẫn thấy máy của bạn; hãy gỡ trong Thiết lập & chạy máy nếu cần.`,
} as const;

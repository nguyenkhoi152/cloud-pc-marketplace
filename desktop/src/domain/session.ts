import { quote, SLOT_MINUTES } from "./pricing";
import type { Quote } from "./types";

/**
 * Vòng đời phiên: preparing → ready → active ⇄ reconnecting → ending → cleaning → completed.
 * Nhánh lỗi: prepare_failed, cleanup_failed (dừng ở đó; máy KHÔNG trở lại sẵn sàng).
 */
export type SessionPhase =
  | "preparing"
  | "ready"
  | "active"
  | "reconnecting"
  | "ending"
  | "cleaning"
  | "completed"
  | "prepare_failed"
  | "cleanup_failed";

export type SaveStatus = "n/a" | "saving" | "saved" | "failed" | "skipped";

export const PREPARE_STEPS = [
  "Giữ máy và tạm giữ số dư thử",
  "Khởi tạo môi trường Linux của phiên",
  "Mở desktop trong app (Selkies — mô phỏng)",
  "Kiểm tra kết nối",
] as const;

export interface SessionState {
  id: string;
  machineId: string;
  machineName: string;
  hostAlias: string;
  pricePer15: number;
  quote: Quote;
  durationMin: number;
  remainingSec: number;
  workspaceMode: "none" | "save";
  phase: SessionPhase;
  prepareStep: number;
  saveStatus: SaveStatus;
  reconnectFailed: boolean;
  failureReason?: string;
  log: string[];
}

export type SessionEvent =
  | { type: "PREPARE_STEP" }
  | { type: "PREPARE_FAIL"; reason: string }
  | { type: "ENTER" }
  | { type: "TICK"; sec: number }
  | { type: "DISCONNECT" }
  | { type: "RECONNECT_OK" }
  | { type: "RECONNECT_FAIL" }
  | { type: "RECONNECT_RETRY" }
  | { type: "END" }
  | { type: "SAVE_OK" }
  | { type: "SAVE_FAIL" }
  | { type: "SAVE_RETRY" }
  | { type: "SAVE_SKIP" }
  | { type: "CLEANUP_OK" }
  | { type: "CLEANUP_FAIL" }
  | { type: "CLEANUP_RETRY" };

export function newSession(input: {
  id: string;
  machineId: string;
  machineName: string;
  hostAlias: string;
  pricePer15: number;
  durationMin: number;
  workspaceMode: "none" | "save";
}): SessionState {
  const q = quote(input.pricePer15, input.durationMin);
  return {
    ...input,
    quote: q,
    durationMin: q.minutes,
    remainingSec: q.minutes * 60,
    phase: "preparing",
    prepareStep: 0,
    saveStatus: "n/a",
    reconnectFailed: false,
    log: ["Đã gửi yêu cầu thuê (mô phỏng)"],
  };
}

const withLog = (s: SessionState, text: string, patch: Partial<SessionState>): SessionState => ({
  ...s,
  ...patch,
  log: [...s.log, text],
});

function beginEnding(s: SessionState, why: string): SessionState {
  return s.workspaceMode === "save"
    ? withLog(s, why, { phase: "ending", saveStatus: "saving" })
    : withLog(s, why, { phase: "cleaning", saveStatus: "n/a" });
}

/** Hàm thuần: sự kiện không hợp lệ ở phase hiện tại bị bỏ qua (trả về cùng state). */
export function sessionReducer(s: SessionState, e: SessionEvent): SessionState {
  switch (e.type) {
    case "PREPARE_STEP": {
      if (s.phase !== "preparing") return s;
      const next = s.prepareStep + 1;
      return next >= PREPARE_STEPS.length
        ? withLog(s, "Môi trường sẵn sàng", { prepareStep: next, phase: "ready" })
        : { ...s, prepareStep: next };
    }
    case "PREPARE_FAIL":
      if (s.phase !== "preparing") return s;
      return withLog(s, `Chuẩn bị thất bại: ${e.reason}`, { phase: "prepare_failed", failureReason: e.reason });
    case "ENTER":
      return s.phase === "ready" ? withLog(s, "Bạn vào phiên", { phase: "active" }) : s;
    case "TICK": {
      if (s.phase !== "active" && s.phase !== "reconnecting") return s;
      const remainingSec = Math.max(0, s.remainingSec - e.sec);
      if (remainingSec === 0) return beginEnding({ ...s, remainingSec }, "Hết thời lượng đã thuê");
      return { ...s, remainingSec };
    }
    case "DISCONNECT":
      return s.phase === "active" ? withLog(s, "Mất kết nối, đang thử kết nối lại", { phase: "reconnecting", reconnectFailed: false }) : s;
    case "RECONNECT_OK":
      return s.phase === "reconnecting" ? withLog(s, "Đã kết nối lại", { phase: "active", reconnectFailed: false }) : s;
    case "RECONNECT_FAIL":
      return s.phase === "reconnecting" ? { ...s, reconnectFailed: true } : s;
    case "RECONNECT_RETRY":
      return s.phase === "reconnecting" ? { ...s, reconnectFailed: false } : s;
    case "END":
      if (s.phase !== "ready" && s.phase !== "active" && s.phase !== "reconnecting") return s;
      return beginEnding(s, "Bạn kết thúc phiên");
    case "SAVE_OK":
      return s.phase === "ending" && s.saveStatus === "saving" ? withLog(s, "Đã lưu workspace", { phase: "cleaning", saveStatus: "saved" }) : s;
    case "SAVE_FAIL":
      return s.phase === "ending" && s.saveStatus === "saving" ? withLog(s, "Lưu workspace thất bại", { saveStatus: "failed" }) : s;
    case "SAVE_RETRY":
      return s.phase === "ending" && s.saveStatus === "failed" ? withLog(s, "Thử lưu lại workspace", { saveStatus: "saving" }) : s;
    case "SAVE_SKIP":
      return s.phase === "ending" && s.saveStatus === "failed"
        ? withLog(s, "Bỏ qua lưu workspace (bạn đã xác nhận)", { phase: "cleaning", saveStatus: "skipped" })
        : s;
    case "CLEANUP_OK":
      return s.phase === "cleaning" ? withLog(s, "Dọn dẹp xong, phiên hoàn tất", { phase: "completed" }) : s;
    case "CLEANUP_FAIL":
      return s.phase === "cleaning" ? withLog(s, "Dọn dẹp thất bại — máy bị khóa", { phase: "cleanup_failed" }) : s;
    case "CLEANUP_RETRY":
      return s.phase === "cleanup_failed" ? withLog(s, "Thử dọn dẹp lại", { phase: "cleaning" }) : s;
  }
}

/** Trạng thái máy sau phiên. Chỉ `completed` mới trả máy về sẵn sàng. */
export function machineAfter(s: SessionState): "available" | "blocked" | "busy" {
  if (s.phase === "completed" || s.phase === "prepare_failed") return "available";
  if (s.phase === "cleanup_failed") return "blocked";
  return "busy";
}

export const isTerminal = (p: SessionPhase) => p === "completed" || p === "prepare_failed" || p === "cleanup_failed";
export const isLive = (p: SessionPhase) => p === "active" || p === "reconnecting";

export interface Settlement {
  billedSlots: number;
  charged: number;
  refunded: number;
  hostNet: number;
  hostStatus: "settled" | "held" | "none";
}

/**
 * Tính tiền khi phiên kết thúc, theo MVP/CONTRACT_SPEC hiện hành: chuẩn bị thất bại (chưa dùng được) hoàn đủ;
 * đã vào phiên thì kết thúc sớm vẫn trả cả gói (accept = H=P), chưa tính tiền theo phút.
 * Thu nhập host chỉ ghi nhận sau cleanup.
 */
export function settle(s: SessionState): Settlement {
  if (s.phase === "prepare_failed") {
    return { billedSlots: 0, charged: 0, refunded: s.quote.gross, hostNet: 0, hostStatus: "none" };
  }
  const billed = quote(s.pricePer15, s.quote.slots * SLOT_MINUTES);
  return {
    billedSlots: billed.slots,
    charged: billed.gross,
    refunded: 0,
    hostNet: billed.hostNet,
    hostStatus: s.phase === "completed" ? "settled" : s.phase === "cleanup_failed" ? "held" : "none",
  };
}

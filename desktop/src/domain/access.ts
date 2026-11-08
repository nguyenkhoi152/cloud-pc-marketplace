import type { Account, HostApproval, HostMachineState, Mode } from "./types";

/** Đổi chế độ chỉ đổi `mode`; không bao giờ đổi `hostApproval`. */
export function switchMode(account: Account, mode: Mode): Account {
  return { ...account, mode };
}

export interface ReceiveInputs {
  approval: HostApproval;
  agentRunning: boolean;
  accepting: boolean;
  insideWindow: boolean;
  blocked: boolean;
  online: boolean;
}

/** Điều kiện để host nhận phiên mới. Trả lý do mọi điều kiện chưa đạt. */
export function receiveGate(i: ReceiveInputs): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (i.approval !== "approved") reasons.push("Máy chưa được duyệt đăng.");
  if (!i.online) reasons.push("Thiết bị đang mất mạng.");
  if (!i.agentRunning) reasons.push("Dịch vụ cung cấp máy đang dừng. Lịch không tự bật máy.");
  if (i.blocked) reasons.push("Máy bị khóa do dọn dẹp phiên trước chưa thành công.");
  if (!i.accepting) reasons.push("Bạn đang tạm nghỉ nhận phiên mới.");
  if (!i.insideWindow) reasons.push("Hiện ngoài khung giờ cung cấp.");
  return { ok: reasons.length === 0, reasons };
}

export function hostMachineState(i: ReceiveInputs & { hasActiveSession: boolean }): HostMachineState {
  if (i.blocked) return "blocked";
  if (!i.agentRunning || !i.online) return "offline";
  if (i.hasActiveSession) return "busy";
  return i.accepting && i.approval === "approved" ? "accepting" : "paused";
}

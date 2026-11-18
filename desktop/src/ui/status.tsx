import type { SessionPhase } from "@/domain/session";
import type { HostApproval, HostMachineState, MachineState, SupportLevel } from "@/domain/types";
import { Badge } from "./badge";

export function MachineStateBadge({ state }: { state: MachineState }) {
  switch (state) {
    case "available":
      return <Badge tone="ok">Sẵn sàng</Badge>;
    case "busy":
      return <Badge tone="info">Đang có phiên</Badge>;
    case "offline":
      return <Badge tone="neutral">Offline</Badge>;
    case "blocked":
      return <Badge tone="warn">Đang xử lý sự cố</Badge>;
    case "unverified":
      return <Badge tone="neutral">Chưa xác minh online</Badge>;
  }
}

export const SUPPORT_LABEL: Record<SupportLevel, string> = {
  verified: "Đã kiểm tra trên máy mẫu",
  limited: "Chạy được, có hạn chế",
  untested: "Chưa kiểm tra / có thể không chạy",
};
export function SupportBadge({ level }: { level: SupportLevel }) {
  const tone = level === "verified" ? "ok" : level === "limited" ? "warn" : "neutral";
  return <Badge tone={tone}>{SUPPORT_LABEL[level]}</Badge>;
}

export const PHASE_LABEL: Record<SessionPhase, string> = {
  preparing: "Đang chuẩn bị",
  ready: "Sẵn sàng",
  active: "Đang sử dụng",
  reconnecting: "Đang kết nối lại",
  ending: "Đang kết thúc",
  cleaning: "Đang dọn dẹp",
  completed: "Đã hoàn tất",
  prepare_failed: "Chuẩn bị thất bại",
  cleanup_failed: "Dọn dẹp thất bại",
};
export function PhaseBadge({ phase }: { phase: SessionPhase }) {
  const tone =
    phase === "completed" || phase === "active" || phase === "ready"
      ? "ok"
      : phase === "prepare_failed"
        ? "danger"
        : phase === "cleanup_failed" || phase === "reconnecting"
          ? "warn"
          : "info";
  return <Badge tone={tone}>{PHASE_LABEL[phase]}</Badge>;
}

export const APPROVAL_LABEL: Record<HostApproval, string> = {
  none: "Chưa gửi duyệt",
  pending: "Chờ duyệt",
  rejected: "Bị từ chối",
  approved: "Đã duyệt",
};
export function ApprovalBadge({ approval }: { approval: HostApproval }) {
  const tone = approval === "approved" ? "ok" : approval === "rejected" ? "danger" : approval === "pending" ? "warn" : "neutral";
  return <Badge tone={tone}>{APPROVAL_LABEL[approval]}</Badge>;
}

export const HOST_STATE_LABEL: Record<HostMachineState, string> = {
  offline: "Offline — không cung cấp",
  paused: "Tạm nghỉ nhận phiên mới",
  accepting: "Đang nhận phiên mới",
  busy: "Đang có phiên",
  blocked: "Bị khóa — chờ dọn dẹp",
};
export function HostStateBadge({ state }: { state: HostMachineState }) {
  const tone = state === "accepting" ? "ok" : state === "busy" ? "info" : state === "blocked" ? "danger" : state === "paused" ? "warn" : "neutral";
  return <Badge tone={tone}>{HOST_STATE_LABEL[state]}</Badge>;
}

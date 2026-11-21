import type { SetupStep } from "./hostEnv";

/**
 * Trình hướng dẫn "Thiết lập cho thuê máy" của chế độ thật: gom các bước THẬT của buildSteps (WSL, bản Linux, Docker, dịch vụ,
 * ghi danh, nhận thuê…) thành sáu bước dễ theo dõi như trong video demo. Trạng thái từng bước suy ra từ trạng thái thật của các
 * bước con; không bước nào được coi là xong khi bước con chưa xong.
 */
export type WizardId = "intro" | "check" | "install" | "enroll" | "share" | "run";

export interface WizardDef {
  id: WizardId;
  label: string;
  /** Các bước thật (buildSteps) thuộc nhóm này. */
  members: SetupStep["id"][];
}

export const WIZARD: readonly WizardDef[] = [
  { id: "intro", label: "Quyền và trách nhiệm", members: [] },
  { id: "check", label: "Kiểm tra máy", members: ["wsl", "distro", "connect", "systemd"] },
  { id: "install", label: "Cài đặt thành phần", members: ["packages", "image", "agent", "network"] },
  { id: "enroll", label: "Ghi danh máy", members: ["enroll"] },
  { id: "share", label: "Tài nguyên và chia sẻ", members: [] },
  { id: "run", label: "Nhận thuê", members: ["run"] },
];

export type WizardState = "done" | "current" | "todo";
export interface WizardItem {
  id: WizardId;
  label: string;
  state: WizardState;
  /** Chỉ bước nào mà mọi bước trước đã xong mới mở được. */
  reachable: boolean;
}

const OK = new Set(["ok", "info"]);

/** Bước con đã ổn? Bước không có trong danh sách (vd. systemd không áp dụng) coi là không cần làm. */
function memberOk(steps: SetupStep[], id: SetupStep["id"]): boolean {
  const s = steps.find((x) => x.id === id);
  return s === undefined || OK.has(s.status);
}

/**
 * `steps` rỗng nghĩa là chưa có kết quả kiểm tra: không nhóm nào có bước con được coi là xong.
 * `introAck`: chủ máy đã xác nhận đọc quyền và trách nhiệm.
 */
export function wizardItems(steps: SetupStep[], introAck: boolean): { items: WizardItem[]; currentId: WizardId | null } {
  const done: boolean[] = [];
  for (const w of WIZARD) {
    if (w.id === "intro") done.push(introAck);
    else if (w.id === "share") done.push(done[WIZARD.findIndex((x) => x.id === "enroll")] === true); // chỉ là tùy chỉnh: xong khi đã tới được
    else done.push(steps.length > 0 && w.members.every((m) => memberOk(steps, m)));
  }
  const firstTodo = done.findIndex((d) => !d);
  const items = WIZARD.map((w, i): WizardItem => ({
    id: w.id,
    label: w.label,
    state: done[i] ? "done" : i === firstTodo ? "current" : "todo",
    reachable: done.slice(0, i).every(Boolean),
  }));
  return { items, currentId: firstTodo === -1 ? null : WIZARD[firstTodo]!.id };
}

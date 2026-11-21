import type { GuestProbe } from "./hostEnv";

/**
 * Agent chạy NỀN trong bản Linux mà app này không quản lý (vd. do script demo, hoặc tài khoản trước bật rồi đăng xuất/đóng app).
 * App chỉ có nút dừng cho agent do chính nó bật, nên trước đây tài khoản khác đăng nhập trên cùng PC KHÔNG thể ghi danh máy của mình
 * (bản Linux từ chối: "Dịch vụ cho thuê đang chạy; hãy dừng trước.") và cũng không có cách nào dừng agent đó.
 *
 *  - none:    không có agent chạy nền (hoặc agent do chính app này quản lý, đã có nút Dừng riêng).
 *  - mine:    agent chạy nền của máy THUỘC tài khoản đang đăng nhập.
 *  - other:   agent chạy nền của máy KHÔNG thuộc tài khoản đang đăng nhập.
 *  - unknown: có agent chạy nền nhưng chưa rõ của máy nào (chưa ghi danh, hoặc chưa tải được danh sách máy của tài khoản).
 */
export type BackgroundAgent = { kind: "none" } | { kind: "mine" | "other" | "unknown"; machineId: string | null };

export function backgroundAgent(p: Pick<GuestProbe, "ok" | "agentRunning" | "machineId"> | null, appManagedRunning: boolean, ownMachineIds: string[] | null): BackgroundAgent {
  if (appManagedRunning) return { kind: "none" };
  if (!p?.ok || !p.agentRunning) return { kind: "none" };
  if (!p.machineId || ownMachineIds === null) return { kind: "unknown", machineId: p.machineId };
  return { kind: ownMachineIds.includes(p.machineId) ? "mine" : "other", machineId: p.machineId };
}

/** Có agent chạy nền chắc chắn hoặc có thể của máy khác ⇒ chưa được ghi danh lại (bản Linux sẽ từ chối). */
export const blocksEnroll = (b: BackgroundAgent): boolean => b.kind === "other" || b.kind === "unknown" || b.kind === "mine";

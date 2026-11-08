import { DEMO_DATE, DEMO_MINUTES, parseHM } from "./clock";
import type { Machine, OfferWindow, Quote } from "./types";

export const SLOT_MINUTES = 15;
export const FEE_RATE = 0.1;
export const DURATION_OPTIONS = [15, 30, 60, 90, 120, 180] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function quote(pricePer15: number, minutes: number): Quote {
  const slots = Math.floor(minutes / SLOT_MINUTES);
  const gross = round2(pricePer15 * slots);
  const fee = round2(gross * FEE_RATE);
  return { slots, minutes: slots * SLOT_MINUTES, gross, fee, hostNet: round2(gross - fee) };
}

/** Khung giờ đang mở tại thời điểm demo, nếu có. */
export function currentWindow(machine: Pick<Machine, "windows">): OfferWindow | null {
  return (
    machine.windows.find((w) => {
      if (w.date !== DEMO_DATE) return false;
      const s = parseHM(w.start);
      const e = parseHM(w.end);
      return s !== null && e !== null && s <= DEMO_MINUTES && DEMO_MINUTES < e;
    }) ?? null
  );
}

/** Số phút tối đa có thể thuê ngay: không vượt cửa sổ host, làm tròn xuống bội 15. */
export function maxBookableMinutes(machine: Pick<Machine, "windows" | "state">): number {
  if (machine.state !== "available") return 0;
  const w = currentWindow(machine);
  if (!w) return 0;
  const end = parseHM(w.end) ?? 0;
  return Math.max(0, Math.floor((end - DEMO_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES);
}

export type DurationFailure = "outside_window" | "exceeds_window" | "not_slot" | "too_short";
export type DurationCheck = { ok: true } | { ok: false; reason: DurationFailure };

export function checkDuration(machine: Pick<Machine, "windows" | "state">, minutes: number): DurationCheck {
  if (minutes < SLOT_MINUTES) return { ok: false, reason: "too_short" };
  if (minutes % SLOT_MINUTES !== 0) return { ok: false, reason: "not_slot" };
  const max = maxBookableMinutes(machine);
  if (max === 0) return { ok: false, reason: "outside_window" };
  if (minutes > max) return { ok: false, reason: "exceeds_window" };
  return { ok: true };
}

export const DURATION_REASON_TEXT: Record<DurationFailure, string> = {
  outside_window: "Máy hiện không trong khung giờ cung cấp của host.",
  exceeds_window: "Thời lượng vượt khung giờ host còn lại. Chọn thời lượng ngắn hơn.",
  not_slot: "Thời lượng phải là bội của 15 phút.",
  too_short: "Tối thiểu 15 phút.",
};

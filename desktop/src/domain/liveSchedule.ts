import { formatHM, parseEndHM, parseHM } from "./clock";
import { emptyWeek } from "./schedule";
import type { WeeklySchedule } from "./types";

/**
 * Chuyển đổi giữa lịch tuần trong cơ sở dữ liệu (mỗi dòng một khung: weekday 0 = Thứ Hai, start/end tính bằng phút)
 * và bảng lịch trên màn hình (7 ngày, mỗi ngày nhiều khung "HH:mm"). Khung kết thúc lúc nửa đêm (1440 phút) hiện là "00:00".
 */
export interface RuleRow {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}
export interface NewRule {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export function rulesToWeekly(rules: RuleRow[]): WeeklySchedule {
  const week = emptyWeek();
  for (const r of rules) {
    if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) continue;
    week[r.weekday]!.push({ start: formatHM(r.startMinute), end: r.endMinute >= 1440 ? "00:00" : formatHM(r.endMinute) });
  }
  return week.map((d) => d.sort((a, b) => (parseHM(a.start) ?? 0) - (parseHM(b.start) ?? 0)));
}

/** Các khung của bảng lịch ở dạng dòng cơ sở dữ liệu. Chỉ gọi khi lịch đã hợp lệ (validateWeekly không báo lỗi). */
export function weeklyToRules(weekly: WeeklySchedule): NewRule[] {
  const out: NewRule[] = [];
  weekly.forEach((day, weekday) => {
    for (const r of day) {
      const s = parseHM(r.start);
      const e = parseEndHM(r.end);
      if (s !== null && e !== null) out.push({ weekday, startMinute: s, endMinute: e });
    }
  });
  return out;
}

const keyOf = (r: NewRule) => `${r.weekday}:${r.startMinute}:${r.endMinute}`;

/**
 * Cần xóa dòng nào và thêm dòng nào để cơ sở dữ liệu khớp bảng lịch. Khung không đổi thì không đụng tới
 * (tránh xóa rồi tạo lại vô ích, và giữ nguyên các khung đang có phiên dựa vào).
 */
export function diffRules(current: RuleRow[], next: WeeklySchedule): { remove: string[]; add: NewRule[] } {
  const want = weeklyToRules(next);
  const left = new Map<string, number>();
  for (const w of want) left.set(keyOf(w), (left.get(keyOf(w)) ?? 0) + 1);
  const remove: string[] = [];
  for (const c of current) {
    const k = keyOf(c);
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else remove.push(c.id);
  }
  const add: NewRule[] = [];
  for (const w of want) {
    const k = keyOf(w);
    const n = left.get(k) ?? 0;
    if (n > 0) {
      add.push(w);
      left.set(k, n - 1);
    }
  }
  return { remove, add };
}

export const hasScheduleChanges = (current: RuleRow[], next: WeeklySchedule): boolean => {
  const d = diffRules(current, next);
  return d.remove.length > 0 || d.add.length > 0;
};

import { addDays, DEMO_DATE, DEMO_MINUTES, formatHM, parseEndHM, parseHM, weekdayIndex } from "./clock";
import type { OfferWindow, ScheduleException, TimeRange, WeeklySchedule } from "./types";

export type IssueCode = "invalid_time" | "start_not_before_end" | "not_quarter" | "too_short" | "overlap";
export interface ScheduleIssue {
  index: number;
  code: IssueCode;
  message: string;
}

export const MIN_RANGE_MINUTES = 30;

export const ISSUE_TEXT: Record<IssueCode, string> = {
  invalid_time: "Giờ không hợp lệ. Nhập dạng HH:mm.",
  start_not_before_end:
    "Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày. Khung qua nửa đêm: tách thành hai khung (đến 23:45 và từ 00:00 hôm sau).",
  not_quarter: "Giờ phải là bội của 15 phút (00, 15, 30, 45).",
  too_short: `Mỗi khung tối thiểu ${MIN_RANGE_MINUTES} phút.`,
  overlap: "Khung này chồng lấn với khung khác trong cùng ngày.",
};

/** Kiểm tra danh sách khung giờ của một ngày. Trả về mọi lỗi, theo chỉ số khung. */
export function validateRanges(ranges: TimeRange[]): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const add = (index: number, code: IssueCode) => issues.push({ index, code, message: ISSUE_TEXT[code] });
  const parsed: { i: number; s: number; e: number }[] = [];

  ranges.forEach((r, i) => {
    const s = parseHM(r.start);
    const e = parseEndHM(r.end);
    if (s === null || e === null) return add(i, "invalid_time");
    if (s % 15 !== 0 || e % 15 !== 0) return add(i, "not_quarter");
    if (s >= e) return add(i, "start_not_before_end");
    if (e - s < MIN_RANGE_MINUTES) return add(i, "too_short");
    parsed.push({ i, s, e });
  });

  const sorted = [...parsed].sort((a, b) => a.s - b.s);
  for (let k = 1; k < sorted.length; k++) {
    const prev = sorted[k - 1]!;
    const cur = sorted[k]!;
    if (cur.s < prev.e) {
      add(cur.i, "overlap");
      if (!issues.some((x) => x.index === prev.i && x.code === "overlap")) add(prev.i, "overlap");
    }
  }
  return issues.sort((a, b) => a.index - b.index);
}

export function validateWeekly(weekly: WeeklySchedule): ScheduleIssue[][] {
  return weekly.map((d) => validateRanges(d));
}

export function validateException(ex: ScheduleException): ScheduleIssue[] {
  return ex.kind === "custom" ? validateRanges(ex.ranges) : [];
}

export function hasIssues(weekly: WeeklySchedule, exceptions: ScheduleException[]): boolean {
  return validateWeekly(weekly).some((x) => x.length > 0) || exceptions.some((e) => validateException(e).length > 0);
}

export function totalWeeklyMinutes(weekly: WeeklySchedule): number {
  return weekly.reduce(
    (sum, day) =>
      sum +
      day.reduce((s, r) => {
        const a = parseHM(r.start);
        const b = parseEndHM(r.end);
        return a !== null && b !== null && b > a ? s + (b - a) : s;
      }, 0),
    0,
  );
}

export type DaySource = "weekly" | "skip" | "custom";
export function effectiveRanges(
  date: string,
  weekly: WeeklySchedule,
  exceptions: ScheduleException[],
): { ranges: TimeRange[]; source: DaySource } {
  const ex = exceptions.find((e) => e.date === date);
  if (ex?.kind === "skip") return { ranges: [], source: "skip" };
  if (ex?.kind === "custom") return { ranges: ex.ranges, source: "custom" };
  return { ranges: weekly[weekdayIndex(date)] ?? [], source: "weekly" };
}

/** Các khung sắp tới (từ giờ demo) trong `days` ngày; bỏ ngày có lỗi lịch. */
export function upcomingWindows(
  weekly: WeeklySchedule,
  exceptions: ScheduleException[],
  days = 7,
  fromDate = DEMO_DATE,
  fromMinutes = DEMO_MINUTES,
): (OfferWindow & { source: DaySource })[] {
  const out: (OfferWindow & { source: DaySource })[] = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(fromDate, d);
    const { ranges, source } = effectiveRanges(date, weekly, exceptions);
    if (validateRanges(ranges).length) continue;
    for (const r of [...ranges].sort((a, b) => (parseHM(a.start) ?? 0) - (parseHM(b.start) ?? 0))) {
      const e = parseEndHM(r.end) ?? 0;
      if (d === 0 && e <= fromMinutes) continue;
      out.push({ date, start: r.start, end: r.end, source });
    }
  }
  return out;
}

export function isInsideOfferWindow(
  weekly: WeeklySchedule,
  exceptions: ScheduleException[],
  date = DEMO_DATE,
  minutes = DEMO_MINUTES,
): boolean {
  const { ranges } = effectiveRanges(date, weekly, exceptions);
  if (validateRanges(ranges).length) return false;
  return ranges.some((r) => (parseHM(r.start) ?? 1e9) <= minutes && minutes < (parseEndHM(r.end) ?? -1));
}

export function describeRange(r: TimeRange): string {
  const s = parseHM(r.start);
  const e = parseEndHM(r.end);
  return s !== null && e !== null ? `${formatHM(s)}–${formatHM(e)}` : `${r.start}–${r.end}`;
}

export const emptyWeek = (): WeeklySchedule => [[], [], [], [], [], [], []];

/** Giờ demo cố định (GMT+7) để kết quả xác định. Không phải đồng hồ thật. */
export const TIMEZONE_LABEL = "Asia/Ho_Chi_Minh (GMT+7)";
export const DEMO_DATE = "2026-11-09"; // Thứ Hai
export const DEMO_MINUTES = 20 * 60 + 10; // 20:10

export const DAY_LABELS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"] as const;
export const DAY_SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;

export function parseHM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function formatHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 0 = Thứ Hai … 6 = Chủ nhật, từ chuỗi YYYY-MM-DD. */
export function weekdayIndex(date: string): number {
  const d = new Date(`${date}T00:00:00Z`);
  return (d.getUTCDay() + 6) % 7;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatDateVi(date: string): string {
  const [y, m, d] = date.split("-");
  return `${DAY_SHORT[weekdayIndex(date)]} ${d}/${m}${y === "2026" ? "" : `/${y}`}`;
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} phút`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, "0");
  const sss = String(ss).padStart(2, "0");
  return h ? `${h}:${mm}:${sss}` : `${mm}:${sss}`;
}

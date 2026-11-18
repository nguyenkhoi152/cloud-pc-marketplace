/**
 * Lựa chọn giới hạn tài nguyên cho container khách (RAM, CPU) trong màn Cho thuê máy.
 * Giá trị đi tới `docker run --memory/--memory-swap/--cpus` (xem host-agent/src/dockerGuest.ts). Không có thanh trượt dung lượng đĩa:
 * bản này chưa giới hạn được đĩa của container nên không giả vờ có.
 */
const RAM_STEPS_GB = [2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];
const CPU_STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
/** Phần tối đa của tổng RAM/CPU mà khách được dùng: phần còn lại để Windows và guest vận hành. */
const MAX_SHARE = 0.8;
/** Dưới mức này desktop Selkies chạy rất chậm; cho chọn nhưng cảnh báo. */
export const RECOMMENDED_MIN = { ramGb: 4, cpus: 2 } as const;

export function ramChoicesGb(totalMb: number | null): number[] {
  if (!totalMb || totalMb <= 0) return [];
  const cap = Math.floor((totalMb * MAX_SHARE) / 1024);
  return RAM_STEPS_GB.filter((g) => g <= cap);
}
export function cpuChoices(count: number | null): number[] {
  if (!count || count <= 0) return [];
  // Không cấp hết lõi: chừa ít nhất một lõi cho chủ máy khi có từ 2 lõi trở lên.
  const cap = count >= 2 ? Math.max(1, Math.floor(count * MAX_SHARE)) : 1;
  return CPU_STEPS.filter((c) => c <= cap);
}

export interface Limits { ramGb: number | null; cpus: number | null }
const KEY = "cpm.hostLimits.v1";
type Store = Pick<Storage, "getItem" | "setItem"> | null | undefined;

export function loadLimits(storage: Store): Limits {
  try {
    const j = JSON.parse(storage?.getItem(KEY) ?? "null") as Partial<Limits> | null;
    const ok = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : null);
    return { ramGb: ok(j?.ramGb, 256), cpus: ok(j?.cpus, 128) };
  } catch {
    return { ramGb: null, cpus: null };
  }
}
export function saveLimits(storage: Store, l: Limits): void {
  try {
    storage?.setItem(KEY, JSON.stringify(l));
  } catch {
    /* không lưu được: chỉ áp dụng phiên này */
  }
}

/** Đưa lựa chọn về trường gửi cho lớp native; bỏ giá trị không còn hợp lệ với máy hiện tại (ví dụ lưu từ máy khác). */
export function toLimitInput(l: Limits, totalMb: number | null, cpuCount: number | null): { memoryMb?: number; cpus?: number } {
  const out: { memoryMb?: number; cpus?: number } = {};
  if (l.ramGb && ramChoicesGb(totalMb).includes(l.ramGb)) out.memoryMb = l.ramGb * 1024;
  if (l.cpus && cpuChoices(cpuCount).includes(l.cpus)) out.cpus = l.cpus;
  return out;
}

export function limitWarning(l: Limits): string | null {
  const low: string[] = [];
  if (l.ramGb && l.ramGb < RECOMMENDED_MIN.ramGb) low.push(`RAM dưới ${RECOMMENDED_MIN.ramGb} GB`);
  if (l.cpus && l.cpus < RECOMMENDED_MIN.cpus) low.push(`dưới ${RECOMMENDED_MIN.cpus} CPU`);
  return low.length ? `${low.join(" và ")}: desktop của khách có thể rất chậm hoặc không mở được.` : null;
}

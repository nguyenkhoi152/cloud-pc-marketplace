/**
 * Quét máy trước khi đăng. Không còn admin duyệt, nên đây là cổng duy nhất trước khi máy hiện công khai.
 * Quét chạy ở app Windows (lớp native, chỉ đọc trong guest); máy chủ KHÔNG kiểm chứng được kết quả này.
 * Cũng là nơi đọc thông số máy (CPU, RAM, GPU, ổ đĩa) để chủ máy không phải tự gõ.
 * Ném Error với câu tiếng Việt nói rõ phải làm gì tiếp; không bao giờ coi "chưa quét được" là đạt.
 */
import { apiBase } from "@/api";
import { hostNative, hostNativeAvailable } from "@/api/hostNative";
import { machineEligibility, parseProbe, type Captured, type GuestProbe } from "@/domain/hostEnv";
import type { DeclaredSpecs } from "@/api/live";
import { mergeDetectedSpecs, specsFromProbe, type DetectedSpecs } from "@/domain/machineSpecs";

export interface ScanDeps {
  available: () => boolean;
  overview: () => Promise<{ backend: unknown | null }>;
  probe: (apiBase?: string) => Promise<Captured>;
  apiBase: () => string | null;
}

export const defaultScanDeps = (): ScanDeps => ({ available: hostNativeAvailable, overview: hostNative.overview, probe: hostNative.probe, apiBase });

/** Quét một lần; trả kết quả đã đọc được hoặc ném lỗi nói rõ vì sao chưa quét được. */
async function scan(d: ScanDeps): Promise<GuestProbe> {
  if (!d.available()) throw new Error("Quét máy cần app Cloud PC Companion trên Windows (bạn đang mở bằng trình duyệt). Mở app đã cài rồi thử lại.");
  const o = await d.overview();
  if (!o.backend) throw new Error("Chưa chọn bản Linux để quét. Vào Thiết lập & chạy máy, chọn bản Linux và cài đặt các thành phần, rồi quay lại.");
  const p = parseProbe(await d.probe(d.apiBase() ?? undefined));
  if (!p.ok) throw new Error(`Chưa quét được máy: ${p.error ?? "không đọc được trạng thái"}. Vào Thiết lập & chạy máy để kiểm tra lại.`);
  return p;
}

function assertEligible(p: GuestProbe): void {
  const e = machineEligibility(p);
  if (!e.ok) throw new Error(`Máy chưa đủ điều kiện để đăng: còn thiếu ${e.missing.join("; ")}. Vào Thiết lập & chạy máy để hoàn tất rồi đăng lại.`);
}

function specsOf(p: GuestProbe): DetectedSpecs {
  const r = specsFromProbe(p);
  if (!r.ok) throw new Error(`Chưa đọc được cấu hình máy: ${r.reason}. Vào Thiết lập & chạy máy để kiểm tra lại.`);
  return r.specs;
}

/** Chỉ kiểm tra máy đủ điều kiện để đăng (không đọc thông số). */
export async function assertMachineEligible(d: ScanDeps): Promise<void> {
  assertEligible(await scan(d));
}

/** Đăng máy: một lần quét vừa kiểm tra đủ điều kiện vừa đọc thông số mới nhất. */
export async function scanForPublish(d: ScanDeps): Promise<DetectedSpecs> {
  const p = await scan(d);
  assertEligible(p);
  return specsOf(p);
}

/** Đọc lại cấu hình từ máy (không bắt buộc máy đã đủ điều kiện đăng). */
export async function readMachineSpecs(d: ScanDeps): Promise<DetectedSpecs> {
  return specsOf(await scan(d));
}

/** Phần của API host mà hai thao tác dưới đây cần (để kiểm thử mà không cần máy chủ). */
export interface SpecsApi<S> {
  updateMachineSpecs: (machineId: string, specs: DeclaredSpecs) => Promise<void>;
  publishMachine: (machineId: string) => Promise<S>;
}

/**
 * Đăng máy: quét một lần (đủ điều kiện + đọc thông số), ghi thông số vào máy, rồi mới đăng.
 * Quét hoặc kiểm tra điều kiện thất bại thì KHÔNG ghi và KHÔNG đăng gì cả.
 */
export async function scanAndPublish<S>(api: SpecsApi<S>, m: { id: string; specs: DeclaredSpecs }, d: ScanDeps): Promise<S> {
  const detected = await scanForPublish(d);
  await api.updateMachineSpecs(m.id, mergeDetectedSpecs(m.specs, detected));
  return api.publishMachine(m.id);
}

/** Đọc lại cấu hình của máy đã đăng và ghi đè phần phần cứng (mô tả, vị trí, giá giữ nguyên). Quét thất bại thì không ghi gì. */
export async function rescanSpecs(api: Pick<SpecsApi<unknown>, "updateMachineSpecs">, m: { id: string; specs: DeclaredSpecs }, d: ScanDeps): Promise<void> {
  const detected = await readMachineSpecs(d);
  await api.updateMachineSpecs(m.id, mergeDetectedSpecs(m.specs, detected));
}

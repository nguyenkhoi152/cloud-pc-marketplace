/**
 * Thông số máy do app TỰ ĐỌC từ máy của chủ máy (kết quả quét bản Linux dành cho thuê), thay cho việc để chủ máy tự gõ.
 * Chủ máy chỉ đặt tên và mô tả ngắn; CPU, số nhân, RAM, GPU, VRAM, ổ đĩa đến từ đây.
 *
 * Lưu ý về nguồn: đây là tài nguyên mà bản Linux (WSL2) thấy, tức đúng phần người thuê sẽ được dùng (RAM của WSL thường nhỏ hơn
 * RAM Windows). Quét chạy trong app; máy chủ không kiểm chứng được (cùng mô hình tin cậy với bước quét đủ điều kiện, xem docs/SECURITY.md).
 * Không đoán: thiếu số nhân hoặc RAM thì không đăng; có GPU mà chưa đọc được VRAM thì không xếp vào Game/Đồ họa.
 */
import type { GuestProbe } from "./hostEnv";
import { toLimitInput, type Limits } from "./hostLimits";
import type { Category } from "./types";

export interface DetectedSpecs {
  cpu: string;
  cores: number;
  ramGb: number;
  gpu: string | null;
  vramGb: number;
  storageGb: number;
  categories: Category[];
}

/** Ngưỡng VRAM để xếp vào Game và Đồ họa; trùng ngưỡng "đạt" ở domain/compat (GPU ≥ 6 GB). */
export const MIN_GPU_VRAM_GB = 6;

export type SpecsResult = { ok: true; specs: DetectedSpecs } | { ok: false; reason: string };

/** Tên hiển thị khi bản Linux thấy thiết bị GPU nhưng không đọc được tên (ví dụ GPU AMD/Intel: chỉ đọc được tên GPU NVIDIA). */
export const GPU_UNNAMED = "GPU (chưa đọc được tên)";

/**
 * Số nhân và RAM trên thẻ là PHẦN KHÁCH ĐƯỢC DÙNG. Nguồn, theo thứ tự:
 *  1. Dịch vụ cho thuê đang chạy: mức đã cấu hình cho container khách (`applied*`; không có khoá = không giới hạn = toàn bộ phần bản Linux thấy).
 *  2. Chưa chạy: `share`, mức RAM/CPU chủ máy chọn (hợp lệ với máy này), sẽ áp dụng ở lần bắt đầu tới; không chọn thì toàn bộ phần bản Linux thấy.
 * CPU/GPU/VRAM/ổ đĩa là số đọc được.
 */
export function specsFromProbe(p: GuestProbe | null, share: Limits = { ramGb: null, cpus: null }): SpecsResult {
  if (!p || !p.ok) return { ok: false, reason: "chưa quét được máy" };
  if (!p.cpuCount || p.cpuCount < 1) return { ok: false, reason: "không đọc được số nhân CPU" };
  if (!p.memTotalMb || p.memTotalMb < 1) return { ok: false, reason: "không đọc được dung lượng RAM" };
  const named = p.gpuNvidia.trim();
  const gpu = named || (p.gpuDxg || p.gpuRenderNode ? GPU_UNNAMED : null);
  const vramGb = named && p.gpuVramMb ? Math.max(1, Math.round(p.gpuVramMb / 1024)) : 0;
  const categories: Category[] = named && vramGb >= MIN_GPU_VRAM_GB ? ["game", "graphics", "dev"] : ["dev"];
  const limit = toLimitInput(share, p.memTotalMb, p.cpuCount);
  // Khi dịch vụ cho thuê ĐANG CHẠY, mức đã cấu hình cho container khách là sự thật về phần khách được dùng (có thể khác mức đang chọn trong app,
  // ví dụ bật bằng script); chưa chạy thì dùng mức chủ máy đã chọn (sẽ áp dụng ở lần bắt đầu tới). Không vượt quá phần bản Linux thấy.
  // Đang chạy mà cấu hình không có khoá giới hạn nghĩa là khách được dùng toàn bộ: KHÔNG rơi về mức "đã chọn" (chưa áp dụng) để khỏi nói sai.
  const running = p.agentRunning;
  const cores = running ? Math.min(p.appliedCpus ?? p.cpuCount, p.cpuCount) : (limit.cpus ?? p.cpuCount);
  const memMb = running ? Math.min(p.appliedMemoryMb ?? p.memTotalMb, p.memTotalMb) : (limit.memoryMb ?? p.memTotalMb);
  return {
    ok: true,
    specs: {
      cpu: p.cpuModel.trim(),
      cores,
      ramGb: Math.max(1, Math.round(memMb / 1024)),
      gpu,
      vramGb,
      storageGb: Math.max(0, p.diskFreeGb ?? 0),
      categories,
    },
  };
}

/**
 * Gộp thông số đọc được vào thông số hiện có: ghi đè phần phần cứng, giữ nguyên mô tả, vị trí, bí danh, workspace do chủ máy đặt.
 * Bỏ `networkMbps`: app không đo được tốc độ mạng nên không giữ con số tự khai cũ.
 */
export function mergeDetectedSpecs<T extends object>(existing: T, d: DetectedSpecs): Omit<T, "networkMbps"> & DetectedSpecs {
  const out = { ...existing, ...d } as Record<string, unknown>;
  delete out.networkMbps;
  return out as Omit<T, "networkMbps"> & DetectedSpecs;
}

/** Một dòng tóm tắt cấu hình đã đọc; null nếu máy chưa được đọc lần nào (chưa có số nhân/RAM). */
export function specsSummary(s: { cpu?: string; cores?: number; ramGb?: number; gpu?: string | null; vramGb?: number; storageGb?: number }): string | null {
  if (!s.cores || !s.ramGb) return null;
  const parts = [
    s.cpu ? `${s.cpu} · ${s.cores} nhân` : `${s.cores} nhân`,
    `${s.ramGb} GB RAM`,
    s.gpu ? (s.vramGb ? `${s.gpu} · ${s.vramGb} GB VRAM` : s.gpu) : "Không có GPU rời",
  ];
  if (s.storageGb) parts.push(`${s.storageGb} GB ổ trống`);
  return parts.join(" · ");
}

import type { HostProfile } from "./types";

export type CheckStatus = "pass" | "warn" | "fail";
export interface CheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}
export type Verdict = "eligible" | "limited" | "ineligible";

export const MIN_CORES = 6;
export const MIN_RAM_GB = 16;
export const MIN_DISK_GB = 100;
export const MIN_UPLOAD_MBPS = 20;

/** Kiểm tra tương thích máy host (mô phỏng, dựa trên hồ sơ giả lập — không đọc phần cứng thật). */
export function checkCompatibility(p: HostProfile): { items: CheckItem[]; verdict: Verdict } {
  const items: CheckItem[] = [];
  const add = (i: CheckItem) => items.push(i);

  add({
    id: "os",
    label: "Hệ điều hành",
    status: /Windows 1[01] (Pro|Enterprise|Education|Home)/.test(p.os) ? "pass" : "fail",
    detail: p.os,
    fix: "Cần Windows 10/11 64-bit hỗ trợ WSL 2.",
  });
  add({
    id: "cpu",
    label: "CPU",
    status: p.cores >= MIN_CORES ? "pass" : "fail",
    detail: `${p.cpu} · ${p.cores} nhân`,
    fix: `Cần tối thiểu ${MIN_CORES} nhân để chia sẻ mà vẫn dùng được máy.`,
  });
  add({
    id: "ram",
    label: "RAM",
    status: p.ramGb >= MIN_RAM_GB ? "pass" : "fail",
    detail: `${p.ramGb} GB`,
    fix: `Cần tối thiểu ${MIN_RAM_GB} GB (chia sẻ một phần, phần còn lại giữ cho Windows).`,
  });
  add({
    id: "gpu",
    label: "GPU",
    status: p.gpu && p.vramGb >= 6 ? "pass" : "warn",
    detail: p.gpu ? `${p.gpu} · ${p.vramGb} GB VRAM` : "Không có GPU rời được hỗ trợ",
    fix: p.gpu ? undefined : "Vẫn có thể đăng máy ở danh mục Lập trình (không GPU). Game và Đồ họa cần GPU được hỗ trợ.",
  });
  add({
    id: "virt",
    label: "Ảo hóa phần cứng",
    status: p.virtualization ? "pass" : "fail",
    detail: p.virtualization ? "Đã bật trong BIOS/UEFI" : "Đang tắt",
    fix: "Bật ảo hóa (VT-x/AMD-V) trong BIOS/UEFI, rồi kiểm tra lại. App không tự đổi BIOS.",
  });
  add({
    id: "wsl",
    label: "WSL 2",
    status: p.wsl === "ready" ? "pass" : "warn",
    detail: p.wsl === "ready" ? "Có sẵn" : "Chưa cài — sẽ được liệt kê ở bước cài đặt, cần bạn đồng ý",
  });
  add({
    id: "disk",
    label: "Ổ đĩa trống",
    status: p.freeDiskGb >= MIN_DISK_GB ? "pass" : "fail",
    detail: `${p.freeDiskGb} GB trống`,
    fix: `Cần tối thiểu ${MIN_DISK_GB} GB trống cho môi trường phiên.`,
  });
  add({
    id: "net",
    label: "Mạng",
    status: p.uploadMbps >= MIN_UPLOAD_MBPS ? "pass" : "warn",
    detail: `Upload ≈ ${p.uploadMbps} Mbps (số đo mô phỏng)`,
    fix: "Upload thấp có thể làm hình ảnh giật; vẫn cho phép thử.",
  });

  const verdict: Verdict = items.some((i) => i.status === "fail")
    ? "ineligible"
    : items.some((i) => i.id === "gpu" && i.status === "warn")
      ? "limited"
      : "eligible";
  return { items, verdict };
}

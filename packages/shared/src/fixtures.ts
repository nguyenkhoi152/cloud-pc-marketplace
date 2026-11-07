import type { Machine } from "./domain";

/** FIXTURE PREVIEW — dữ liệu minh hoạ, không phải máy thật, không có heartbeat. */
export const PREVIEW_LABEL = "Dữ liệu minh hoạ (preview) — không phải máy thật";

export const previewMachines: Machine[] = [
  {
    id: "demo-1", name: "Máy dựng phim 4K (minh hoạ)", hostName: "Host demo A", status: "approved",
    cpu: "Ryzen 7 5800X", ramGb: 32, gpu: "RTX 3070", vramGb: 8, os: "Windows 11",
    apps: ["DaVinci Resolve", "Blender"], region: "Hà Nội", pricePcp: "20", windowHours: 6,
    workspaceCompatible: true, lastCheckedAt: "2026-11-07", online: "unknown",
  },
  {
    id: "demo-2", name: "Máy lập trình / build (minh hoạ)", hostName: "Host demo B", status: "approved",
    cpu: "Core i5-12400", ramGb: 16, gpu: null, vramGb: 0, os: "Ubuntu 24.04",
    apps: ["VS Code", "Docker"], region: "TP.HCM", pricePcp: "20", windowHours: 4,
    workspaceCompatible: true, lastCheckedAt: "2026-11-07", online: "unknown",
  },
  {
    id: "demo-3", name: "Máy đồ hoạ 3D (minh hoạ)", hostName: "Host demo C", status: "approved",
    cpu: "Core i7-13700", ramGb: 64, gpu: "RTX 4070", vramGb: 12, os: "Windows 11",
    apps: ["Blender", "Unreal Engine"], region: "Đà Nẵng", pricePcp: "20", windowHours: 8,
    workspaceCompatible: false, lastCheckedAt: "2026-11-07", online: "unknown",
  },
];

export const previewPendingReview: Machine[] = [
  {
    id: "demo-4", name: "Máy chờ duyệt (minh hoạ)", hostName: "Host demo D", status: "review",
    cpu: "Ryzen 5 5600", ramGb: 16, gpu: "GTX 1660", vramGb: 6, os: "Windows 11",
    apps: ["Photoshop"], region: "TP.HCM", pricePcp: "20", windowHours: 4,
    workspaceCompatible: true, lastCheckedAt: "2026-11-06", online: "unknown",
  },
];

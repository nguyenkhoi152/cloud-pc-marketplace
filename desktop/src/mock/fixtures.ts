/**
 * Dữ liệu mẫu TẬP TRUNG. Toàn bộ là giả lập: tên host, cấu hình, giá, ứng dụng và khung giờ
 * không phản ánh máy hay người thật. Chỉ `mock/service.ts` và `state/store.ts` được import file này.
 */
import { emptyWeek } from "../domain/schedule";
import type {
  Account,
  AppCompat,
  AppNotification,
  HistoryItem,
  HostConfig,
  HostProfile,
  Incident,
  Machine,
  Transaction,
  Wallet,
  Workspace,
} from "../domain/types";

const T = "2026-11-09";
const TOMORROW = "2026-11-10";

const app = (name: string, kind: AppCompat["kind"], level: AppCompat["level"], note: string): AppCompat => ({ name, kind, level, note });

export const MACHINES: Machine[] = [
  {
    id: "falcon-4070",
    name: "Falcon · RTX 4070",
    hostAlias: "Host Minh An",
    categories: ["game", "graphics"],
    location: "Hà Nội",
    cpu: "Intel Core i7-13700",
    cores: 16,
    ramGb: 32,
    gpu: "NVIDIA RTX 4070",
    vramGb: 12,
    storageGb: 300,
    networkMbps: 300,
    pricePer15: 20,
    workspace: true,
    state: "available",
    windows: [
      { date: T, start: "19:00", end: "23:00" },
      { date: TOMORROW, start: "19:00", end: "23:00" },
    ],
    summary: "Cấu hình cân bằng cho game và dựng hình nhẹ.",
    apps: [
      app("Counter-Strike 2", "game", "verified", "Bản Linux gốc, đã thử trên máy mẫu."),
      app("Dota 2", "game", "verified", "Bản Linux gốc."),
      app("Blender", "app", "verified", "Render bằng GPU qua CUDA."),
      app("Cyberpunk 2077", "game", "limited", "Chạy qua lớp tương thích; hiệu năng phụ thuộc bản game."),
      app("Valorant", "game", "untested", "Anti-cheat thường chặn môi trường Linux. Chưa kiểm tra."),
    ],
  },
  {
    id: "orion-3060",
    name: "Orion · RTX 3060",
    hostAlias: "Host Lan Chi",
    categories: ["game"],
    location: "TP.HCM",
    cpu: "AMD Ryzen 5 5600",
    cores: 12,
    ramGb: 16,
    gpu: "NVIDIA RTX 3060",
    vramGb: 12,
    storageGb: 200,
    networkMbps: 200,
    pricePer15: 12,
    workspace: true,
    state: "available",
    windows: [{ date: T, start: "18:00", end: "22:00" }],
    summary: "Giá mềm, phù hợp game nhẹ đến vừa.",
    apps: [
      app("Counter-Strike 2", "game", "verified", "Bản Linux gốc."),
      app("Apex Legends", "game", "limited", "Có thể gặp giới hạn anti-cheat tùy thời điểm."),
      app("Minecraft", "game", "verified", "Bản Java chạy tốt."),
    ],
  },
  {
    id: "atlas-4090",
    name: "Atlas · RTX 4090",
    hostAlias: "Host Quang Vinh",
    categories: ["graphics", "game"],
    location: "Đà Nẵng",
    cpu: "AMD Ryzen 9 7950X",
    cores: 32,
    ramGb: 64,
    gpu: "NVIDIA RTX 4090",
    vramGb: 24,
    storageGb: 500,
    networkMbps: 500,
    pricePer15: 45,
    workspace: true,
    state: "available",
    windows: [{ date: T, start: "20:00", end: "21:00" }],
    summary: "Cấu hình mạnh; hôm nay chỉ mở một khung ngắn.",
    apps: [
      app("Blender", "app", "verified", "Render GPU nhanh, cần nhiều VRAM."),
      app("DaVinci Resolve", "app", "limited", "Một số codec cần cấu hình thêm."),
      app("Unreal Engine 5", "app", "limited", "Biên dịch shader lần đầu lâu."),
      app("Cyberpunk 2077", "game", "limited", "Qua lớp tương thích."),
    ],
  },
  {
    id: "nimbus-dev",
    name: "Nimbus · Lập trình 16 nhân",
    hostAlias: "Host Đức Hiếu",
    categories: ["dev"],
    location: "Hà Nội",
    cpu: "AMD Ryzen 7 5700X",
    cores: 16,
    ramGb: 32,
    gpu: null,
    vramGb: 0,
    storageGb: 400,
    networkMbps: 300,
    pricePer15: 6,
    workspace: true,
    state: "available",
    windows: [{ date: T, start: "19:00", end: "23:45" }],
    summary: "Không GPU, nhiều nhân và RAM cho build, Docker, thử nghiệm.",
    apps: [
      app("VS Code", "app", "verified", "Chạy trong desktop Linux."),
      app("Docker", "app", "verified", "Chạy trong môi trường phiên."),
      app("Node.js / Python", "app", "verified", "Cài sẵn."),
      app("Android Studio", "app", "limited", "Emulator chậm vì không có GPU."),
    ],
  },
  {
    id: "pixel-a5000",
    name: "Pixel · RTX A5000",
    hostAlias: "Host Thảo Vy",
    categories: ["graphics"],
    location: "TP.HCM",
    cpu: "Intel Xeon W-2245",
    cores: 16,
    ramGb: 128,
    gpu: "NVIDIA RTX A5000",
    vramGb: 24,
    storageGb: 1000,
    networkMbps: 200,
    pricePer15: 38,
    workspace: true,
    state: "available",
    windows: [{ date: TOMORROW, start: "19:00", end: "23:00" }],
    summary: "Nhiều RAM/VRAM cho đồ họa. Hôm nay chưa mở; khung kế tiếp 19:00 ngày mai.",
    apps: [
      app("Blender", "app", "verified", "Render GPU ổn định."),
      app("Houdini", "app", "untested", "Chưa kiểm tra trên máy này."),
    ],
  },
  {
    id: "cinder-1660",
    name: "Cinder · GTX 1660",
    hostAlias: "Host Bảo Ngọc",
    categories: ["game"],
    location: "Hà Nội",
    cpu: "Intel Core i5-10400",
    cores: 12,
    ramGb: 16,
    gpu: "NVIDIA GTX 1660",
    vramGb: 6,
    storageGb: 200,
    networkMbps: 100,
    pricePer15: 8,
    workspace: false,
    state: "busy",
    windows: [{ date: T, start: "19:00", end: "23:00" }],
    summary: "Đang có người thuê. Mở lại khi phiên kết thúc và dọn dẹp xong.",
    apps: [app("Counter-Strike 2", "game", "verified", "Bản Linux gốc."), app("Dota 2", "game", "verified", "Bản Linux gốc.")],
  },
  {
    id: "lumen-dev",
    name: "Lumen · Lập trình 8 nhân",
    hostAlias: "Host Khánh Linh",
    categories: ["dev"],
    location: "Hải Phòng",
    cpu: "Intel Core i5-12400",
    cores: 12,
    ramGb: 16,
    gpu: null,
    vramGb: 0,
    storageGb: 200,
    networkMbps: 100,
    pricePer15: 4,
    workspace: false,
    state: "available",
    windows: [{ date: T, start: "20:00", end: "22:00" }],
    summary: "Gọn nhẹ, giá thấp; không hỗ trợ lưu workspace.",
    apps: [app("VS Code", "app", "verified", "Chạy trong desktop Linux."), app("Node.js / Python", "app", "verified", "Cài sẵn.")],
  },
  {
    id: "vega-7800",
    name: "Vega · RX 7800 XT",
    hostAlias: "Host Tuấn Kiệt",
    categories: ["game", "graphics"],
    location: "Đà Nẵng",
    cpu: "AMD Ryzen 7 7700",
    cores: 16,
    ramGb: 32,
    gpu: "AMD RX 7800 XT",
    vramGb: 16,
    storageGb: 300,
    networkMbps: 300,
    pricePer15: 22,
    workspace: true,
    state: "offline",
    windows: [{ date: T, start: "19:00", end: "23:00" }],
    summary: "Máy offline (mô phỏng): lịch không tự bật máy nên chưa nhận phiên.",
    apps: [app("Counter-Strike 2", "game", "verified", "Bản Linux gốc."), app("Blender", "app", "limited", "Render qua HIP, tùy phiên bản.")],
  },
  {
    id: "kite-4060ti",
    name: "Kite · RTX 4060 Ti",
    hostAlias: "Host Hà My",
    categories: ["graphics", "game"],
    location: "Hà Nội",
    cpu: "Intel Core i5-13600K",
    cores: 20,
    ramGb: 32,
    gpu: "NVIDIA RTX 4060 Ti",
    vramGb: 16,
    storageGb: 300,
    networkMbps: 300,
    pricePer15: 28,
    workspace: false,
    state: "available",
    windows: [{ date: T, start: "19:30", end: "22:30" }],
    summary: "16 GB VRAM ở tầm giá vừa; không lưu workspace.",
    apps: [
      app("Blender", "app", "verified", "Render GPU qua CUDA."),
      app("Counter-Strike 2", "game", "verified", "Bản Linux gốc."),
      app("Elden Ring", "game", "limited", "Qua lớp tương thích."),
    ],
  },
];

export const LOCATIONS = ["Hà Nội", "TP.HCM", "Đà Nẵng", "Hải Phòng"];

export const ACCOUNT: Account = { name: "Nguyễn Minh Anh", email: "minhanh@example.test", mode: "rent", hostApproval: "none" };

const tx = (id: string, at: string, kind: Transaction["kind"], amount: number, label: string): Transaction => ({
  id, at, kind, ledger: "usable", amount, status: "done", label,
});
export const WALLET: Wallet = {
  usable: 644,
  hostSettled: 0,
  hostHeld: 0,
  faucetClaimed: true,
  transactions: [
    tx("t6", "08/11 22:05", "charge", -96, "Thuê Orion · RTX 3060 (2 giờ)"),
    tx("t5", "07/11 21:30", "charge", -180, "Thuê Atlas · RTX 4090 (1 giờ)"),
    tx("t3", "05/11 19:00", "charge", -80, "Thuê Falcon · RTX 4070 (1 giờ)"),
    tx("t2", "03/11 10:03", "refund", 24, "Hoàn đủ — chuẩn bị phiên Nimbus thất bại"),
    tx("t1", "03/11 10:01", "hold", -24, "Tạm giữ cho phiên Nimbus · Lập trình (4 giờ)"),
    tx("t0", "03/11 10:00", "faucet", 1000, "Nhận PCP thử (một lần, mô phỏng)"),
  ],
};

export const HISTORY: HistoryItem[] = [
  { id: "h4", machineName: "Orion · RTX 3060", hostAlias: "Host Lan Chi", startedAt: "08/11 20:05", minutes: 120, charged: 96, refunded: 0, workspace: "saved", outcome: "completed" },
  { id: "h3", machineName: "Atlas · RTX 4090", hostAlias: "Host Quang Vinh", startedAt: "07/11 20:30", minutes: 60, charged: 180, refunded: 0, workspace: "none", outcome: "completed" },
  { id: "h2", machineName: "Falcon · RTX 4070", hostAlias: "Host Minh An", startedAt: "05/11 19:00", minutes: 45, charged: 80, refunded: 0, workspace: "failed", outcome: "completed" },
  { id: "h1", machineName: "Nimbus · Lập trình 16 nhân", hostAlias: "Host Đức Hiếu", startedAt: "03/11 10:05", minutes: 0, charged: 0, refunded: 24, workspace: "none", outcome: "prepare_failed" },
];

export const WORKSPACES: Workspace[] = [
  { id: "w1", name: "dự-án-blender-phòng-khách", machineName: "Orion · RTX 3060", sizeMb: 62, checkpoints: 3, savedAt: "08/11 22:04", status: "saved" },
  { id: "w2", name: "api-thử-nghiệm", machineName: "Nimbus · Lập trình 16 nhân", sizeMb: 18, checkpoints: 2, savedAt: "03/11 14:10", status: "saved" },
  { id: "w3", name: "map-đồ-án-game", machineName: "Falcon · RTX 4070", sizeMb: 0, checkpoints: 0, savedAt: "05/11 19:45", status: "save_failed" },
];

export const NOTIFICATIONS: AppNotification[] = [
  { id: "n1", at: "08/11 22:10", scope: "rent", tone: "ok", read: false, title: "Phiên đã hoàn tất", body: "Phiên Orion · RTX 3060 đã dọn dẹp xong. Workspace đã lưu (mô phỏng)." },
  { id: "n2", at: "08/11 09:00", scope: "all", tone: "info", read: false, title: "Đây là bản xem trước", body: "Mọi dữ liệu, thanh toán và kết nối trong app đều là mô phỏng." },
  { id: "n3", at: "05/11 19:50", scope: "rent", tone: "warn", read: true, title: "Lưu workspace chưa thành công", body: "Workspace map-đồ-án-game chưa lưu được ở phiên ngày 05/11. Bạn đã chọn bỏ qua." },
  { id: "n4", at: "03/11 10:03", scope: "rent", tone: "error", read: true, title: "Chuẩn bị phiên thất bại", body: "Phiên trên Nimbus không khởi tạo được; số dư thử đã được hoàn." },
  { id: "n5", at: "07/11 18:00", scope: "host", tone: "info", read: true, title: "Chế độ Cho thuê máy", body: "Chọn chế độ này không tự cấp quyền host. Cần hoàn tất thiết lập và chờ duyệt." },
];

export const INCIDENTS_SEED: Incident[] = [];

export const HOST_PROFILES: HostProfile[] = [
  { id: "ok", label: "Máy mạnh đủ điều kiện", cpu: "AMD Ryzen 7 5800X", cores: 16, ramGb: 32, gpu: "NVIDIA RTX 3070", vramGb: 8, os: "Windows 11 Pro", virtualization: true, wsl: "not_installed", freeDiskGb: 420, uploadMbps: 60 },
  { id: "nogpu", label: "Không có GPU được hỗ trợ", cpu: "Intel Core i7-12700", cores: 20, ramGb: 32, gpu: null, vramGb: 0, os: "Windows 11 Home", virtualization: true, wsl: "ready", freeDiskGb: 250, uploadMbps: 40 },
  { id: "lowram", label: "Thiếu RAM", cpu: "Intel Core i5-8400", cores: 6, ramGb: 8, gpu: "NVIDIA GTX 1050", vramGb: 2, os: "Windows 10 Pro", virtualization: true, wsl: "not_installed", freeDiskGb: 180, uploadMbps: 25 },
  { id: "novirt", label: "Chưa bật ảo hóa", cpu: "AMD Ryzen 5 3600", cores: 12, ramGb: 16, gpu: "NVIDIA RTX 2060", vramGb: 6, os: "Windows 11 Pro", virtualization: false, wsl: "not_installed", freeDiskGb: 300, uploadMbps: 30 },
];

export const DEFAULT_HOST_CONFIG: HostConfig = {
  name: "Máy của Minh Anh",
  cores: 8,
  ramGb: 16,
  shareGpu: true,
  storageGb: 150,
  pricePer15: 20,
  categories: ["game", "graphics"],
  weekly: (() => {
    const w = emptyWeek();
    for (const d of [0, 1, 2, 3, 4]) w[d] = [{ start: "19:00", end: "23:00" }];
    w[5] = [{ start: "14:00", end: "23:00" }];
    w[6] = [{ start: "14:00", end: "22:00" }];
    return w;
  })(),
  exceptions: [{ id: "ex-seed", date: "2026-11-11", kind: "skip" }],
};

export const INSTALL_COMPONENTS = [
  { id: "wsl", name: "WSL 2 (Windows Subsystem for Linux)", why: "Chạy môi trường Linux của phiên thuê, tách khỏi Windows của bạn.", perm: "Quyền quản trị để bật tính năng Windows; có thể cần khởi động lại.", required: true },
  { id: "docker", name: "Docker Engine trong WSL", why: "Đóng gói môi trường mỗi phiên để dễ dọn dẹp.", perm: "Chạy trong WSL; không mở cổng ra Internet ngoài kênh của ứng dụng.", required: true },
  { id: "selkies", name: "Selkies (desktop từ xa trong app)", why: "Truyền desktop Linux của phiên tới app của người thuê.", perm: "Kết nối ra ngoài qua máy chủ trung gian; hướng này còn cần kiểm chứng trên máy thật.", required: true },
  { id: "agent", name: "Cloud PC Companion Agent", why: "Nhận/kết thúc phiên, báo trạng thái máy, dọn dẹp sau phiên.", perm: "Chạy nền như dịch vụ người dùng; bạn dừng được bất cứ lúc nào.", required: true },
  { id: "gpu", name: "Cấu hình GPU cho WSL/Docker", why: "Cho phiên dùng GPU của bạn khi bạn bật chia sẻ GPU.", perm: "Tùy chọn. Không hỗ trợ mọi GPU; hiệu năng Windows của bạn có thể bị ảnh hưởng khi có phiên.", required: false },
];

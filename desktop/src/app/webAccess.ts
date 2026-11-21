import { matchPath } from "./router";

/**
 * Bản web (xem IS_WEB trong api/env.ts) chỉ để XEM. Thuê máy, cho thuê máy, ví và mọi thứ cần tài khoản chạy trong app,
 * nên trên web các màn đó thay bằng lời nhắc tải app. Danh sách dưới đây là các màn MỞ trên web; mọi đường dẫn khác bị chặn
 * (kể cả /login, /register: web không có tài khoản nên không được hiện luồng đăng nhập giả).
 */
export const WEB_OPEN_ROUTES = ["/welcome", "/rent/discover", "/rent/compare", "/rent/machine/:id", "/about", "/settings", "/support"] as const;

export const isOpenOnWeb = (path: string): boolean => WEB_OPEN_ROUTES.some((p) => matchPath(p, path) !== null);

/** Tên mục hiện trên lời nhắc tải app. Khớp theo tiền tố; không biết thì dùng câu chung. */
const GATE_TITLES: [prefix: string, title: string][] = [
  ["/rent/checkout", "Thuê máy"],
  ["/rent/session", "Phiên thuê hiện tại"],
  ["/rent/workspaces", "Workspace"],
  ["/rent/history", "Lịch sử thuê"],
  ["/host", "Cho thuê máy"],
  ["/wallet", "Số dư & giao dịch"],
  ["/notifications", "Thông báo"],
  ["/account", "Tài khoản"],
  ["/admin", "Quản trị"],
  ["/login", "Đăng nhập"],
  ["/register", "Tạo tài khoản"],
  ["/recover", "Khôi phục mật khẩu"],
  ["/choose-mode", "Chọn chế độ"],
];

export function gateTitle(path: string): string {
  const p = path.split("?")[0]!.replace(/\/+$/, "");
  return GATE_TITLES.find(([prefix]) => p === prefix || p.startsWith(`${prefix}/`))?.[1] ?? "Mục này";
}

/**
 * Nơi tải bộ cài. Mặc định là trang Releases của repo. Chỉ nhận https (giá trị lạ về mặc định) để không bao giờ
 * dựng ra liên kết javascript:/data:. Đặt VITE_DOWNLOAD_URL trong môi trường khi dựng bản web nếu bộ cài ở chỗ khác.
 */
export const DEFAULT_DOWNLOAD_URL = "https://github.com/nguyenkhoi152/cloud-pc-marketplace/releases/latest";

export function safeDownloadUrl(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : DEFAULT_DOWNLOAD_URL;
  } catch {
    return DEFAULT_DOWNLOAD_URL;
  }
}

export const DOWNLOAD_URL = safeDownloadUrl(import.meta.env.VITE_DOWNLOAD_URL as string | undefined);

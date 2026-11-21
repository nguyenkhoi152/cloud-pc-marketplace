import {
  Bell,
  BadgeInfo,
  Compass,
  Coins,
  FolderOpen,
  History,
  LifeBuoy,
  MonitorPlay,
  Power,
  Rocket,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Khớp tiền tố để tô sáng mục đang xem. */
  match?: string[];
  /** Chỉ có ở chế độ live (không hiện trong bản xem trước giao diện). */
  liveOnly?: boolean;
  /** Nhãn dùng ở chế độ live khi khác bản xem trước. */
  liveLabel?: string;
}

export const RENT_NAV: NavItem[] = [
  { to: "/rent/discover", label: "Khám phá máy", icon: Compass, match: ["/rent/discover", "/rent/compare", "/rent/machine", "/rent/checkout"] },
  { to: "/rent/session", label: "Phiên hiện tại", icon: MonitorPlay },
  { to: "/rent/workspaces", label: "Workspace", icon: FolderOpen },
  { to: "/rent/history", label: "Lịch sử thuê", liveLabel: "Phiên & đặt chỗ của tôi", icon: History },
];

export const HOST_NAV: NavItem[] = [
  { to: "/host", label: "Tổng quan máy", liveLabel: "Máy của tôi", icon: Server },
  { to: "/host/setup", label: "Thiết lập & chạy máy", icon: Rocket, liveOnly: true },
  { to: "/host/onboarding/intro", label: "Thiết lập cho thuê", icon: Rocket, match: ["/host/onboarding"] },
  { to: "/host/configure", label: "Tài nguyên, giá & lịch", icon: SlidersHorizontal },
  { to: "/host/sessions", label: "Phiên đang chạy", icon: MonitorPlay },
  { to: "/host/earnings", label: "Thu nhập", icon: Coins },
  { to: "/host/incidents", label: "Sự cố", icon: ShieldAlert },
  { to: "/host/runtime", label: "Chạy nền & dừng", icon: Power },
];

/**
 * Mục điều hướng đã nối dữ liệu thật ở chế độ live. Mục KHÁC vẫn hiện trên thanh bên (để app và bản web giống nhau)
 * nhưng gắn nhãn "Sắp có" và dẫn tới trang "Tính năng đang được hoàn thiện" (NotWired), không hiện dữ liệu mẫu.
 */
export const LIVE_NAV = new Set(["/rent/discover", "/rent/history", "/host", "/host/setup", "/host/configure", "/host/sessions", "/host/earnings", "/wallet", "/settings", "/about"]);

/** Chỉ hiện ở chế độ live cho tài khoản admin (xem Sidebar). Không thuộc LIVE_NAV vì không phải mục của người thuê/host. */
export const ADMIN_NAV: NavItem = { to: "/admin", label: "Quản trị", icon: ShieldCheck, liveOnly: true };

export const COMMON_NAV: NavItem[] = [
  { to: "/wallet", label: "Số dư & giao dịch", liveLabel: "Ví", icon: Wallet },
  { to: "/notifications", label: "Thông báo", icon: Bell },
  { to: "/support", label: "Hỗ trợ", icon: LifeBuoy },
  { to: "/settings", label: "Cài đặt", icon: Settings },
  { to: "/about", label: "Giới thiệu", icon: BadgeInfo },
];

/**
 * Mục thuê máy trên thanh bên. Preview/web: "Phiên hiện tại" chỉ hiện khi đang có phiên. Live: ẩn mục đó vì nó trùng với
 * "Phiên & đặt chỗ của tôi" (cùng một màn); các mục còn lại hiện đủ như bản web.
 */
export const rentNav = ({ live, hasSession }: { live: boolean; hasSession: boolean }): NavItem[] =>
  RENT_NAV.filter((i) => (live ? i.to !== "/rent/session" : !i.liveOnly && (i.to !== "/rent/session" || hasSession)));

/**
 * Mục cho thuê máy trên thanh bên. Live có thêm "Thiết lập & chạy máy" (việc thật của host) và bỏ "Thiết lập cho thuê"
 * (bản mô phỏng của đúng việc đó); preview/web giữ nguyên: "Thiết lập cho thuê" chỉ hiện khi chưa được duyệt.
 */
export const hostNav = ({ live, approved }: { live: boolean; approved: boolean }): NavItem[] =>
  HOST_NAV.filter((i) => (live ? i.to !== "/host/onboarding/intro" : i.liveOnly ? false : i.to === "/host/onboarding/intro" ? !approved : true));

/** Mục chưa nối chức năng thật ở live: hiện nhãn "Sắp có". Ngoài live (preview/web) không có khái niệm này. */
export const isComingSoon = (to: string, live: boolean): boolean => live && !LIVE_NAV.has(to);

export const isActive = (item: NavItem, path: string) => {
  const p = path.split("?")[0]!;
  if (item.match) return item.match.some((m) => p === m || p.startsWith(`${m}/`));
  return item.to === "/host" ? p === "/host" : p === item.to || p.startsWith(`${item.to}/`);
};

/** Biểu tượng của màn đang xem (theo mục điều hướng khớp đường dẫn); dùng cho huy hiệu ở đầu trang. Không khớp thì không có. */
export const iconForPath = (path: string): LucideIcon | undefined => [...RENT_NAV, ...HOST_NAV, ADMIN_NAV, ...COMMON_NAV].find((i) => isActive(i, path))?.icon;

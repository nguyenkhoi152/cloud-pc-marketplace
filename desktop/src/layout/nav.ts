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

/** Mục điều hướng đã nối dữ liệu thật ở chế độ live; mục khác bị ẩn (route vẫn trả màn "chưa nối"). */
export const LIVE_NAV = new Set(["/rent/discover", "/rent/history", "/host", "/host/setup", "/host/sessions", "/host/earnings", "/wallet", "/settings", "/about"]);

export const COMMON_NAV: NavItem[] = [
  { to: "/wallet", label: "Số dư & giao dịch", liveLabel: "Ví", icon: Wallet },
  { to: "/notifications", label: "Thông báo", icon: Bell },
  { to: "/support", label: "Hỗ trợ", icon: LifeBuoy },
  { to: "/settings", label: "Cài đặt", icon: Settings },
  { to: "/about", label: "Bản thử này gồm gì", icon: BadgeInfo },
];

export const isActive = (item: NavItem, path: string) => {
  const p = path.split("?")[0]!;
  if (item.match) return item.match.some((m) => p === m || p.startsWith(`${m}/`));
  return item.to === "/host" ? p === "/host" : p === item.to || p.startsWith(`${item.to}/`);
};

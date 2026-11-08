import {
  Bell,
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
}

export const RENT_NAV: NavItem[] = [
  { to: "/rent/discover", label: "Khám phá máy", icon: Compass, match: ["/rent/discover", "/rent/compare", "/rent/machine", "/rent/checkout"] },
  { to: "/rent/session", label: "Phiên hiện tại", icon: MonitorPlay },
  { to: "/rent/workspaces", label: "Workspace", icon: FolderOpen },
  { to: "/rent/history", label: "Lịch sử thuê", icon: History },
];

export const HOST_NAV: NavItem[] = [
  { to: "/host", label: "Tổng quan máy", icon: Server },
  { to: "/host/onboarding/intro", label: "Thiết lập cho thuê", icon: Rocket, match: ["/host/onboarding"] },
  { to: "/host/configure", label: "Tài nguyên, giá & lịch", icon: SlidersHorizontal },
  { to: "/host/sessions", label: "Phiên đang chạy", icon: MonitorPlay },
  { to: "/host/earnings", label: "Thu nhập", icon: Coins },
  { to: "/host/incidents", label: "Sự cố", icon: ShieldAlert },
  { to: "/host/runtime", label: "Chạy nền & dừng", icon: Power },
];

export const COMMON_NAV: NavItem[] = [
  { to: "/wallet", label: "Số dư & giao dịch", icon: Wallet },
  { to: "/notifications", label: "Thông báo", icon: Bell },
  { to: "/support", label: "Hỗ trợ", icon: LifeBuoy },
  { to: "/settings", label: "Cài đặt", icon: Settings },
];

export const isActive = (item: NavItem, path: string) => {
  const p = path.split("?")[0]!;
  if (item.match) return item.match.some((m) => p === m || p.startsWith(`${m}/`));
  return item.to === "/host" ? p === "/host" : p === item.to || p.startsWith(`${item.to}/`);
};

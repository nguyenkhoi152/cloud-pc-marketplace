import { MotionConfig } from "motion/react";
import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from "react";
import { isLive, ENV } from "@/api/env";
import { AppShell } from "@/layout/AppShell";
import { useAppStore } from "@/state/store";
import { matchPath, navigate, usePath } from "./router";

/**
 * Tách mã theo màn hình: mỗi nhóm tải khi người dùng vào route. Preview không tải màn live và ngược lại.
 * Trạng thái chờ tải ngắn hiển thị `role="status"` (không để trắng màn).
 */
const lz = <P,>(load: () => Promise<ComponentType<P>>) => lazy(() => load().then((c) => ({ default: c })));
const Welcome = lz(() => import("@/features/auth/Auth").then((m) => m.Welcome));
const Login = lz(() => import("@/features/auth/Auth").then((m) => m.Login));
const Register = lz(() => import("@/features/auth/Auth").then((m) => m.Register));
const Recover = lz(() => import("@/features/auth/Auth").then((m) => m.Recover));
const ChooseMode = lz(() => import("@/features/auth/Auth").then((m) => m.ChooseMode));
const AccountScreen = lz(() => import("@/features/common/Common").then((m) => m.AccountScreen));
const Notifications = lz(() => import("@/features/common/Common").then((m) => m.Notifications));
const SettingsScreen = lz(() => import("@/features/common/Common").then((m) => m.SettingsScreen));
const Support = lz(() => import("@/features/common/Common").then((m) => m.Support));
const WalletScreen = lz(() => import("@/features/common/Common").then((m) => m.WalletScreen));
const HostConfigure = lz(() => import("@/features/host/HostScreens").then((m) => m.HostConfigure));
const HostDashboard = lz(() => import("@/features/host/HostScreens").then((m) => m.HostDashboard));
const HostEarnings = lz(() => import("@/features/host/HostScreens").then((m) => m.HostEarnings));
const HostIncidents = lz(() => import("@/features/host/HostScreens").then((m) => m.HostIncidents));
const HostRuntime = lz(() => import("@/features/host/HostScreens").then((m) => m.HostRuntime));
const HostSessions = lz(() => import("@/features/host/HostScreens").then((m) => m.HostSessions));
const Onboarding = lz(() => import("@/features/host/Onboarding").then((m) => m.Onboarding));
const Checkout = lz(() => import("@/features/renter/Checkout").then((m) => m.Checkout));
const Discover = lz(() => import("@/features/renter/Discover").then((m) => m.Discover));
const Compare = lz(() => import("@/features/renter/MachineViews").then((m) => m.Compare));
const MachineDetail = lz(() => import("@/features/renter/MachineViews").then((m) => m.MachineDetail));
const SessionScreen = lz(() => import("@/features/renter/Session").then((m) => m.SessionScreen));
const HistoryDetail = lz(() => import("@/features/renter/WorkspacesHistory").then((m) => m.HistoryDetail));
const HistoryList = lz(() => import("@/features/renter/WorkspacesHistory").then((m) => m.HistoryList));
const Workspaces = lz(() => import("@/features/renter/WorkspacesHistory").then((m) => m.Workspaces));
const HostLive = lz(() => import("@/features/live/LiveScreens").then((m) => m.HostLive));
const LiveBookings = lz(() => import("@/features/live/LiveScreens").then((m) => m.LiveBookings));
const LiveCheckout = lz(() => import("@/features/live/LiveScreens").then((m) => m.LiveCheckout));
const LiveWallet = lz(() => import("@/features/live/LiveScreens").then((m) => m.LiveWallet));
const NotWired = lz(() => import("@/features/live/LiveScreens").then((m) => m.NotWired));
const HostSessionsPage = lz(() => import("@/features/live/LiveScreens").then((m) => m.HostSessionsPage));
const HostSetup = lz(() => import("@/features/live/HostSetup").then((m) => m.HostSetup));
const LiveHostEarnings = lz(() => import("@/features/live/HostEarnings").then((m) => m.HostEarnings));
const About = lz(() => import("@/features/live/About").then((m) => m.About));

interface Route {
  pattern: string;
  public?: boolean;
  mode?: "rent" | "host";
  render: (p: Record<string, string>) => ReactNode;
}

const ROUTES: Route[] = [
  { pattern: "/welcome", public: true, render: () => <Welcome /> },
  { pattern: "/login", public: true, render: () => <Login /> },
  { pattern: "/register", public: true, render: () => <Register /> },
  { pattern: "/recover", public: true, render: () => <Recover /> },
  { pattern: "/choose-mode", render: () => <ChooseMode /> },

  { pattern: "/rent/discover", mode: "rent", render: () => <Discover /> },
  { pattern: "/rent/compare", mode: "rent", render: () => <Compare /> },
  { pattern: "/rent/machine/:id", mode: "rent", render: (p) => <MachineDetail id={p.id!} /> },
  { pattern: "/rent/checkout/:id", mode: "rent", render: (p) => <Checkout id={p.id!} /> },
  { pattern: "/rent/session", mode: "rent", render: () => <SessionScreen /> },
  { pattern: "/rent/workspaces", mode: "rent", render: () => <Workspaces /> },
  { pattern: "/rent/history", mode: "rent", render: () => <HistoryList /> },
  { pattern: "/rent/history/:id", mode: "rent", render: (p) => <HistoryDetail id={p.id!} /> },

  { pattern: "/host", mode: "host", render: () => <HostDashboard /> },
  { pattern: "/host/onboarding/:step", mode: "host", render: (p) => <Onboarding step={p.step!} /> },
  { pattern: "/host/setup", mode: "host", render: () => <Onboarding step="intro" /> },
  { pattern: "/host/configure", mode: "host", render: () => <HostConfigure /> },
  { pattern: "/host/sessions", mode: "host", render: () => <HostSessions /> },
  { pattern: "/host/earnings", mode: "host", render: () => <HostEarnings /> },
  { pattern: "/host/incidents", mode: "host", render: () => <HostIncidents /> },
  { pattern: "/host/runtime", mode: "host", render: () => <HostRuntime /> },

  { pattern: "/wallet", render: () => <WalletScreen /> },
  { pattern: "/notifications", render: () => <Notifications /> },
  { pattern: "/support", render: () => <Support /> },
  { pattern: "/settings", render: () => <SettingsScreen /> },
  { pattern: "/account", render: () => <AccountScreen /> },
  { pattern: "/about", render: () => <About /> },
];

/** Chế độ live: chỉ các route đã nối API thật; còn lại báo thẳng là chưa nối (không hiện dữ liệu mẫu). */
const LIVE_OVERRIDES: Record<string, (p: Record<string, string>) => ReactNode> = {
  "/rent/checkout/:id": (p) => <LiveCheckout id={p.id!} />,
  "/rent/history": () => <LiveBookings />,
  "/host": () => <HostLive />,
  "/rent/session": () => <LiveBookings />,
  "/rent/workspaces": () => <NotWired what="Workspace" why="Kho lưu workspace (broker, checkpoint) chưa làm." />,
  "/rent/history/:id": () => <NotWired what="Chi tiết phiên" why="Chi tiết từng phiên chưa có màn riêng; xem tiến trình ở Phiên & đặt chỗ của tôi." />,
  "/host/onboarding/:step": () => <HostSetup />,
  "/host/setup": () => <HostSetup />,
  "/host/configure": () => <NotWired what="Tài nguyên, giá & lịch" why="Dùng màn Cho thuê máy (đăng máy, cam kết, lịch) ở chế độ live." />,
  "/host/sessions": () => <HostSessionsPage />,
  "/host/earnings": () => <LiveHostEarnings />,
  "/host/incidents": () => <NotWired what="Sự cố" why="Chưa có bảng sự cố." />,
  "/host/runtime": () => <NotWired what="Chạy nền & dừng" why="Bật chạy nền khi đóng cửa sổ ở Cài đặt → Cho thuê máy. Bắt đầu và dừng nhận thuê nằm ở Thiết lập & chạy máy." />,
  "/wallet": () => <LiveWallet />,
  "/notifications": () => <NotWired what="Thông báo" why="Hệ thống thông báo thật chưa có." />,
  "/support": () => <NotWired what="Hỗ trợ" why="Kênh hỗ trợ thật chưa có." />,
};

const Loading = () => (
  <p className="p-6 text-sm text-ink-soft" role="status">
    Đang tải màn hình…
  </p>
);

function ConfigError({ problems }: { problems: string[] }) {
  return (
    <div className="mx-auto mt-16 max-w-xl rounded-lg border border-danger/40 bg-surface p-6">
      <h1 className="text-xl font-bold">Cấu hình chế độ live chưa đúng</h1>
      <p className="mt-2 text-sm text-ink-soft">Ứng dụng không chuyển sang dữ liệu mẫu khi cấu hình sai. Sửa <code>desktop/.env.local</code> rồi khởi động lại.</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
    </div>
  );
}

export function App() {
  if (ENV.mode === "invalid") return <ConfigError problems={ENV.problems} />;
  return <AppInner />;
}

function AppInner() {
  const path = usePath();
  const booting = useAppStore((s) => s.liveBooting);
  const bootstrapLive = useAppStore((s) => s.bootstrapLive);
  useEffect(() => {
    void bootstrapLive();
  }, [bootstrapLive]);
  const authed = useAppStore((s) => s.authed);
  const mode = useAppStore((s) => s.account.mode);
  const setMode = useAppStore((s) => s.setMode);
  const reduce = useAppStore((s) => s.settings.reduceMotion);

  let route: Route | undefined;
  let params: Record<string, string> = {};
  for (const r of ROUTES) {
    const m = matchPath(r.pattern, path);
    if (m) {
      route = r;
      params = m;
      break;
    }
  }

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(reduce);
  }, [reduce]);

  // Đường dẫn quyết định chế độ (vào /host/... thì ở chế độ Cho thuê). Không đụng tới quyền host.
  useEffect(() => {
    if (route?.mode && route.mode !== mode) setMode(route.mode);
  }, [route, mode, setMode]);

  useEffect(() => {
    // Live: chưa khôi phục xong phiên đã lưu thì CHƯA quyết định điều hướng (nếu không, người đã đăng nhập bị đẩy về /welcome mỗi lần tải lại).
    if (booting) return;
    if (!route) navigate(authed ? (mode === "rent" ? "/rent/discover" : "/host") : "/welcome", { replace: true });
    else if (!route.public && !authed) navigate("/welcome", { replace: true });
  }, [route, authed, mode, booting]);

  if (isLive() && booting) return <p className="p-6 text-sm text-ink-soft" role="status">Đang khôi phục phiên đăng nhập…</p>;
  if (!route || (!route.public && !authed)) return null;
  const render = (isLive() && LIVE_OVERRIDES[route.pattern]) || route.render;
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "user"}>
      {route.public || route.pattern === "/choose-mode" ? (
        <Suspense fallback={<Loading />}>{render(params)}</Suspense>
      ) : (
        // Suspense nằm TRONG AppShell: tải chunk không gỡ thanh trên/sidebar/skip link nên focus của bộ chuyển chế độ được giữ.
        <AppShell>
          <Suspense fallback={<Loading />}>{render(params)}</Suspense>
        </AppShell>
      )}
    </MotionConfig>
  );
}

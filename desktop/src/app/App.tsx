import { MotionConfig } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { AccountScreen, Notifications, SettingsScreen, Support, WalletScreen } from "@/features/common/Common";
import { ChooseMode, Login, Recover, Register, Welcome } from "@/features/auth/Auth";
import { HostConfigure, HostDashboard, HostEarnings, HostIncidents, HostRuntime, HostSessions } from "@/features/host/HostScreens";
import { Onboarding } from "@/features/host/Onboarding";
import { Checkout } from "@/features/renter/Checkout";
import { Discover } from "@/features/renter/Discover";
import { Compare, MachineDetail } from "@/features/renter/MachineViews";
import { SessionScreen } from "@/features/renter/Session";
import { HistoryDetail, HistoryList, Workspaces } from "@/features/renter/WorkspacesHistory";
import { AppShell } from "@/layout/AppShell";
import { useAppStore } from "@/state/store";
import { matchPath, navigate, usePath } from "./router";

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
];

export function App() {
  const path = usePath();
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
    if (!route) navigate(authed ? (mode === "rent" ? "/rent/discover" : "/host") : "/welcome", { replace: true });
    else if (!route.public && !authed) navigate("/welcome", { replace: true });
  }, [route, authed, mode]);

  if (!route || (!route.public && !authed)) return null;
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "user"}>
      {route.public || route.pattern === "/choose-mode" ? route.render(params) : <AppShell>{route.render(params)}</AppShell>}
    </MotionConfig>
  );
}

// @vitest-environment node
/**
 * Smoke test: render từng màn hình bằng react-dom/server để bắt lỗi import/render lần đầu.
 * KHÔNG thay thế kiểm tra bằng trình duyệt (focus, layout, tràn ngang, tương tác).
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChooseMode, Login, Recover, Register, Welcome } from "@/features/auth/Auth";
import { AccountScreen, Notifications, SettingsScreen, Support, WalletScreen } from "@/features/common/Common";
import { HostConfigure, HostDashboard, HostEarnings, HostIncidents, HostRuntime, HostSessions } from "@/features/host/HostScreens";
import { Onboarding, STEPS } from "@/features/host/Onboarding";
import { Checkout } from "@/features/renter/Checkout";
import { Discover } from "@/features/renter/Discover";
import { Compare, MachineDetail } from "@/features/renter/MachineViews";
import { SessionScreen } from "@/features/renter/Session";
import { HistoryDetail, HistoryList, Workspaces } from "@/features/renter/WorkspacesHistory";
import { newSession, sessionReducer, type SessionEvent, type SessionPhase } from "@/domain/session";
import { useAppStore } from "@/state/store";

// zustand dùng getInitialState() làm snapshot khi render phía server: ghi state vào cả hai nơi.
type State = ReturnType<typeof useAppStore.getState>;
type Patch = Partial<State> | ((s: State) => Partial<State>);
const setState = (p: Patch) => {
  useAppStore.setState(p);
  const cur = useAppStore.getState();
  Object.assign(useAppStore.getInitialState(), typeof p === "function" ? p(cur) : p);
};
const html = (el: React.ReactElement) => renderToString(el);

describe("smoke: render từng màn hình", () => {
  it("auth", () => {
    for (const C of [Welcome, Login, Register, Recover, ChooseMode]) expect(html(<C />).length).toBeGreaterThan(200);
  });

  it("common + renter + host (trạng thái đang tải ban đầu)", () => {
    setState({ authed: true });
    const screens: React.ReactElement[] = [
      <WalletScreen />, <Notifications />, <Support />, <SettingsScreen />, <AccountScreen />,
      <Discover />, <Compare />, <MachineDetail id="falcon-4070" />, <Checkout id="falcon-4070" />,
      <Workspaces />, <HistoryList />, <HistoryDetail id="h1" />, <SessionScreen />,
      <HostDashboard />, <HostConfigure />, <HostSessions />, <HostEarnings />, <HostIncidents />, <HostRuntime />,
    ];
    for (const s of screens) expect(html(s).length).toBeGreaterThan(100);
  });

  it("onboarding 7 bước", () => {
    for (const s of STEPS) expect(html(<Onboarding step={s.id} />)).toContain("Thiết lập cho thuê máy");
  });

  it("host đã duyệt: dashboard và các màn", () => {
    setState((s) => ({ account: { ...s.account, hostApproval: "approved" }, hostAgentRunning: true }));
    for (const el of [<HostDashboard />, <HostSessions />, <HostEarnings />, <HostIncidents />, <HostRuntime />, <HostConfigure />]) expect(html(el).length).toBeGreaterThan(200);
  });

  it("màn phiên ở mọi phase", () => {
    const base = newSession({ id: "s", machineId: "m", machineName: "Máy thử", hostAlias: "h", pricePer15: 20, durationMin: 60, workspaceMode: "save" });
    const run = (...e: SessionEvent[]) => e.reduce(sessionReducer, base);
    const step = { type: "PREPARE_STEP" } as const;
    const active = run(step, step, step, step, { type: "ENTER" });
    const cases: Record<SessionPhase, ReturnType<typeof run>> = {
      preparing: base,
      ready: run(step, step, step, step),
      active,
      reconnecting: sessionReducer(active, { type: "DISCONNECT" }),
      ending: sessionReducer(active, { type: "END" }),
      cleaning: [{ type: "END" }, { type: "SAVE_OK" }].reduce((s, e) => sessionReducer(s, e as SessionEvent), active),
      completed: [{ type: "END" }, { type: "SAVE_OK" }, { type: "CLEANUP_OK" }].reduce((s, e) => sessionReducer(s, e as SessionEvent), active),
      prepare_failed: run({ type: "PREPARE_FAIL", reason: "x" }),
      cleanup_failed: [{ type: "END" }, { type: "SAVE_OK" }, { type: "CLEANUP_FAIL" }].reduce((s, e) => sessionReducer(s, e as SessionEvent), active),
    };
    for (const [phase, s] of Object.entries(cases)) {
      expect(s.phase).toBe(phase);
      setState({ session: s });
      const out = html(<SessionScreen />);
      expect(out).not.toContain("Bạn chưa có phiên nào");
      if (phase === "cleanup_failed") expect(out).toContain("máy đang bị khóa");
      if (phase === "prepare_failed") expect(out).toContain("Không chuẩn bị được phiên");
      if (phase === "active") expect(out).toContain("chưa có stream thật");
    }
    // lưu workspace lỗi
    setState({ session: [{ type: "END" }, { type: "SAVE_FAIL" }].reduce((s, e) => sessionReducer(s, e as SessionEvent), active) });
    expect(html(<SessionScreen />)).toContain("Lưu workspace thất bại");
  });
});

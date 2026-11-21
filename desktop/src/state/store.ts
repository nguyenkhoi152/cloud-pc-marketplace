import { create } from "zustand";
import { receiveGate, switchMode } from "../domain/access";
import type { Verdict } from "../domain/compat";
import { DEMO_DATE, DEMO_MINUTES } from "../domain/clock";
import { checkDuration, DURATION_REASON_TEXT, quote } from "../domain/pricing";
import { isInsideOfferWindow } from "../domain/schedule";
import {
  isLive,
  isTerminal,
  newSession,
  sessionReducer,
  settle,
  type SessionEvent,
  type SessionState,
} from "../domain/session";
import type { Account, HostApproval, HostConfig, Machine, Mode, Wallet } from "../domain/types";
import { addTransaction, releaseHeld } from "../domain/wallet";
import { ACCOUNT, DEFAULT_HOST_CONFIG, INSTALL_COMPONENTS, WALLET } from "../mock/fixtures";
import { ServiceError, type ScenarioId } from "../mock/scenarios";
import { activateWalletForAccount, getLiveApi, service, walletAccountId } from "../api";
import { IS_WEB, isLive as isLiveMode } from "../api/env";
import { navigate } from "../app/router";
import { readSavedMode, safeLocalStorage, saveMode, startupRoute } from "../domain/startup";
import type { LiveAccount } from "../api/live";
import { setServiceScenario } from "../mock/service";

export interface Toast {
  id: number;
  tone: "info" | "ok" | "warn" | "error";
  text: string;
}

export interface HostSetup {
  consented: boolean;
  profileId: string;
  verdict: Verdict | null;
  componentConsent: Record<string, boolean>;
  installedSteps: number; // số thành phần đã cài (mô phỏng)
  installed: boolean;
  config: HostConfig;
}

export interface HostSessionRecord {
  id: string;
  guest: string;
  minutes: number;
  earned: number;
  status: "settled" | "held";
  at: string;
}

export interface Settings {
  reduceMotion: boolean;
  hostBackground: boolean;
  notifyEmail: boolean;
  notifyDesktop: boolean;
}

type Slot = "session" | "hostSession";

interface AppState {
  authed: boolean;
  account: Account;
  scenario: ScenarioId;
  online: boolean;
  dataVersion: number;
  settings: Settings;
  toasts: Toast[];
  wallet: Wallet;
  compare: string[];

  session: SessionState | null;
  hostSession: SessionState | null;

  hostSetup: HostSetup;
  hostAgentRunning: boolean;
  hostAccepting: boolean;
  hostBlocked: boolean;
  hostStopAfterSession: boolean;
  hostWindowState: "open" | "hidden" | "quit";
  hostRecords: HostSessionRecord[];
  pendingFromScenario: boolean;

  // thao tác
  signIn: (name?: string, email?: string) => void;
  /** Live: áp tài khoản thật (đã đăng nhập Supabase) vào store. */
  applyLiveAccount: (a: LiveAccount) => void;
  /** Live: khôi phục phiên đã lưu khi mở app. */
  bootstrapLive: () => Promise<void>;
  /** Live: đọc lại tên/trạng thái duyệt host từ máy chủ. */
  refreshAccount: () => Promise<void>;
  liveBooting: boolean;
  signOut: () => void;
  setMode: (m: Mode) => void;
  setScenario: (s: ScenarioId) => void;
  resetDemo: () => void;
  updateSettings: (p: Partial<Settings>) => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
  toggleCompare: (id: string) => boolean;
  clearCompare: () => void;
  claimFaucet: () => void;
  refreshData: () => void;

  startSession: (m: Machine, minutes: number, workspace: "none" | "save") => { ok: true } | { ok: false; reason: string };
  enterSession: () => void;
  endSession: () => void;
  simulateDisconnect: () => void;
  retryReconnect: () => void;
  saveRetry: () => void;
  saveSkip: () => void;
  cleanupRetry: () => void;
  skipTime: (minutes: number) => void;
  dismissSession: () => void;

  patchHostSetup: (p: Partial<HostSetup>) => void;
  patchHostConfig: (p: Partial<HostConfig>) => void;
  submitListing: () => Promise<void>;
  decideApproval: (a: Extract<HostApproval, "approved" | "rejected">) => void;
  returnToDraft: () => void;
  setAccepting: (v: boolean) => void;
  startProviding: () => void;
  stopProviding: (drain: boolean) => void;
  closeWindow: () => void;
  reopenWindow: () => void;
  simulateGuest: () => { ok: true } | { ok: false; reasons: string[] };
  hostEndSession: () => void;
  hostSkipTime: (m: number) => void;
  retryHostCleanup: () => void;
}

const initialHostSetup = (): HostSetup => ({
  consented: false,
  profileId: "ok",
  verdict: null,
  componentConsent: {},
  installedSteps: 0,
  installed: false,
  config: structuredClone(DEFAULT_HOST_CONFIG),
});

const BLANK_ACCOUNT: Account = { name: "", email: "", mode: "rent", hostApproval: "none" };
const initial = () => ({
  authed: IS_WEB, // bản web không có tài khoản: khách xem luôn "đã vào" để thấy khung app; các màn cần tài khoản bị chặn ở App.tsx

  account: isLiveMode() ? { ...BLANK_ACCOUNT } : { ...ACCOUNT },
  scenario: "normal" as ScenarioId,
  online: true,
  settings: { reduceMotion: false, hostBackground: true, notifyEmail: true, notifyDesktop: true },
  wallet: structuredClone(WALLET),
  compare: [] as string[],
  session: null as SessionState | null,
  hostSession: null as SessionState | null,
  hostSetup: initialHostSetup(),
  hostAgentRunning: false,
  hostAccepting: true,
  hostBlocked: false,
  hostStopAfterSession: false,
  hostWindowState: "open" as const,
  hostRecords: [] as HostSessionRecord[],
  pendingFromScenario: false,
});

let uid = 1;
const nextId = (p: string) => `${p}-${uid++}`;
const NOW_LABEL = "09/11 20:10";
const err = (e: unknown) => (e instanceof ServiceError ? e.message : "Lỗi không xác định (mô phỏng).");

export const useAppStore = create<AppState>((set, get) => {
  const toast = (text: string, tone: Toast["tone"] = "info") => {
    const id = uid++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, tone, text }] }));
    setTimeout(() => get().dismissToast(id), tone === "error" ? 8000 : 5000);
  };
  const bump = () => set((s) => ({ dataVersion: s.dataVersion + 1 }));
  const notify = (title: string, body: string, tone: "info" | "warn" | "error" | "ok", scope: "rent" | "host" | "all") => {
    service.addNotification({ id: nextId("n"), at: NOW_LABEL, scope, tone, read: false, title, body });
    bump();
  };

  /** Áp sự kiện vào phiên (renter hoặc host) rồi chạy tác dụng phụ khi đổi phase. */
  function dispatch(slot: Slot, ev: SessionEvent) {
    const prev = get()[slot];
    if (!prev) return;
    const next = sessionReducer(prev, ev);
    if (next === prev) return;
    set({ [slot]: next } as Partial<AppState>);
    const phaseChanged = prev.phase !== next.phase;
    if (ev.type === "SAVE_RETRY" || (phaseChanged && next.phase === "ending" && next.saveStatus === "saving")) void runSave(slot, next.id);
    if (phaseChanged && next.phase === "cleaning") void runCleanup(slot, next.id);
    if (phaseChanged && isTerminal(next.phase)) finalize(slot, next);
  }

  const same = (slot: Slot, id: string) => get()[slot]?.id === id;

  async function runSave(slot: Slot, id: string) {
    try {
      await service.saveWorkspace();
      if (same(slot, id)) dispatch(slot, { type: "SAVE_OK" });
    } catch (e) {
      if (same(slot, id)) {
        dispatch(slot, { type: "SAVE_FAIL" });
        toast(`Lưu workspace thất bại: ${err(e)}`, "error");
      }
    }
  }
  async function runCleanup(slot: Slot, id: string) {
    try {
      await service.cleanup();
      if (same(slot, id)) dispatch(slot, { type: "CLEANUP_OK" });
    } catch {
      if (same(slot, id)) dispatch(slot, { type: "CLEANUP_FAIL" });
    }
  }
  async function runPrepare(id: string) {
    for (let i = 0; i < 4; i++) {
      try {
        await service.prepareStep(i);
      } catch (e) {
        if (same("session", id)) dispatch("session", { type: "PREPARE_FAIL", reason: err(e) });
        return;
      }
      if (!same("session", id)) return;
      dispatch("session", { type: "PREPARE_STEP" });
    }
  }
  async function runReconnect(id: string) {
    try {
      await service.reconnect();
      if (same("session", id)) dispatch("session", { type: "RECONNECT_OK" });
    } catch {
      if (same("session", id)) dispatch("session", { type: "RECONNECT_FAIL" });
    }
  }

  function finalize(slot: Slot, s: SessionState) {
    const st = settle(s);
    if (slot === "session") {
      let wallet = get().wallet;
      // khoản tạm giữ thành tính phí (cả gói) hoặc hoàn đủ nếu chuẩn bị thất bại
      wallet = {
        ...wallet,
        transactions: wallet.transactions.map((t) =>
          t.sessionId === s.id && t.kind === "hold"
            ? { ...t, kind: st.charged === 0 ? ("hold" as const) : ("charge" as const), label: st.charged === 0 ? `Tạm giữ cho ${s.machineName} (đã hoàn)` : `Thuê ${s.machineName} (${s.quote.minutes} phút) — giá đã đặt` }
            : t,
        ),
      };
      if (st.refunded > 0)
        wallet = addTransaction(wallet, {
          id: nextId("tx"), at: NOW_LABEL, kind: "refund", ledger: "usable", amount: st.refunded, status: "done",
          label: s.phase === "prepare_failed" ? `Hoàn đủ — chuẩn bị phiên ${s.machineName} thất bại` : `Hoàn — ${s.machineName}`, sessionId: s.id,
        });
            set({ wallet });
      service.addHistory({
        id: nextId("h"), machineName: s.machineName, hostAlias: s.hostAlias, startedAt: NOW_LABEL,
        minutes: s.phase === "prepare_failed" ? 0 : Math.round((s.durationMin * 60 - s.remainingSec) / 60),
        charged: st.charged, refunded: st.refunded,
        workspace: s.saveStatus === "saved" ? "saved" : s.saveStatus === "failed" ? "failed" : s.saveStatus === "skipped" ? "skipped" : "none",
        outcome: s.phase === "completed" ? "completed" : s.phase === "cleanup_failed" ? "cleanup_failed" : "prepare_failed",
      });
      if (s.saveStatus === "saved")
        service.addWorkspace({ id: nextId("w"), name: `workspace-${s.machineId}`, machineName: s.machineName, sizeMb: 24, checkpoints: 1, savedAt: NOW_LABEL, status: "saved" });
      service.setMachineState(s.machineId, s.phase === "cleanup_failed" ? "blocked" : "available");
      if (s.phase === "completed") notify("Phiên đã hoàn tất", `${s.machineName}: dọn dẹp xong. Tính phí ${st.charged} PCP thử.`, "ok", "rent");
      if (s.phase === "cleanup_failed") notify("Dọn dẹp chưa thành công", `${s.machineName} bị khóa để xử lý. Phiên của bạn đã kết thúc và không bị tính thêm.`, "warn", "rent");
      if (s.phase === "prepare_failed") notify("Chuẩn bị phiên thất bại", `${s.machineName}: đã hoàn đủ ${st.refunded} PCP thử.`, "error", "rent");
      bump();
      return;
    }
    // phiên host (khách mô phỏng)
    if (get().hostStopAfterSession) set({ hostAgentRunning: false, hostStopAfterSession: false });
    const earned = st.hostNet;
    const held = st.hostStatus === "held";
    const wallet = addTransaction(get().wallet, {
      id: nextId("tx"), at: NOW_LABEL, kind: "host_earning", ledger: "host", amount: earned,
      status: held ? "held" : "done", label: held ? "Thu nhập phiên — chờ xác nhận dọn dẹp" : "Thu nhập phiên (đã ghi nhận)", sessionId: s.id,
    });
    set({ wallet, hostRecords: [{ id: s.id, guest: s.hostAlias, minutes: Math.round((s.durationMin * 60 - s.remainingSec) / 60), earned, status: held ? "held" : "settled", at: NOW_LABEL }, ...get().hostRecords] });
    if (s.phase === "cleanup_failed") {
      set({ hostBlocked: true });
      service.addIncident({ id: nextId("i"), at: NOW_LABEL, kind: "cleanup", status: "open", title: "Dọn dẹp sau phiên thất bại", detail: "Môi trường chưa được xác minh sạch. Máy không nhận khách mới cho tới khi dọn dẹp thành công." });
      notify("Máy bị khóa: dọn dẹp thất bại", "Mở mục Sự cố để thử dọn lại. Thu nhập phiên được giữ cho tới khi xác nhận.", "error", "host");
    } else {
      notify("Phiên host đã hoàn tất", `Thu nhập ${earned} PCP thử đã ghi nhận.`, "ok", "host");
    }
    bump();
  }

  const tick = setInterval(() => {
    const s = get();
    if (s.session && isLive(s.session.phase)) dispatch("session", { type: "TICK", sec: 1 });
    if (s.hostSession && s.hostSession.phase === "active") dispatch("hostSession", { type: "TICK", sec: 1 });
  }, 1000);
  if (typeof import.meta !== "undefined" && (import.meta as unknown as { hot?: { dispose: (f: () => void) => void } }).hot)
    (import.meta as unknown as { hot: { dispose: (f: () => void) => void } }).hot.dispose(() => clearInterval(tick));

  const hostInputs = () => {
    const s = get();
    return {
      approval: s.account.hostApproval,
      agentRunning: s.hostAgentRunning,
      accepting: s.hostAccepting,
      insideWindow: isInsideOfferWindow(s.hostSetup.config.weekly, s.hostSetup.config.exceptions, DEMO_DATE, DEMO_MINUTES),
      blocked: s.hostBlocked,
      online: s.online,
    };
  };

  return {
    ...initial(),
    dataVersion: 0,
    toasts: [],

    signIn: (name, email) => set((s) => ({ authed: true, account: { ...s.account, name: name?.trim() || s.account.name, email: email?.trim() || s.account.email } })),
    applyLiveAccount: (a) => {
      // Ví thử là của TỪNG tài khoản trên PC này. Nơi gọi đã chờ gắn ví trước khi vào đây; nếu sót thì bù ở đây (không chặn giao diện).
      if (walletAccountId() !== a.userId) void activateWalletForAccount(a.userId);
      set((s) => ({ authed: true, account: { ...s.account, name: a.name, email: a.email, hostApproval: a.hostApproval, isAdmin: a.isAdmin } }));
    },
    liveBooting: isLiveMode(),
    bootstrapLive: async () => {
      if (!isLiveMode()) return;
      try {
        const a = await getLiveApi().auth.restore();
        if (a) {
          await activateWalletForAccount(a.userId); // ví của tài khoản này sẵn sàng trước khi màn nào dùng tới
          get().applyLiveAccount(a);
          // Mở app từ Start Menu: URL không hash ⇒ router coi là /welcome. Người đã đăng nhập phải vào thẳng trang chủ của chế độ lần trước
          // (liên kết sâu/tải lại giữa chừng được giữ nguyên).
          const mode = readSavedMode(safeLocalStorage());
          const to = startupRoute(window.location.hash, mode);
          if (to) {
            get().setMode(mode);
            navigate(to, { replace: true });
          }
        }
      } catch (e) {
        toast(err(e), "error");
      } finally {
        set({ liveBooting: false });
      }
    },
    refreshAccount: async () => {
      if (!isLiveMode()) return;
      try {
        get().applyLiveAccount(await getLiveApi().account());
      } catch (e) {
        toast(err(e), "error");
      }
    },
    signOut: () => {
      if (isLiveMode()) {
        // Đăng xuất thật: xoá phiên ở máy trước, UI chỉ về trạng thái chưa đăng nhập khi thành công.
        void getLiveApi().auth.signOut().then(
          () => {
            void activateWalletForAccount(null); // gỡ ví của tài khoản vừa thoát: tài khoản kế tiếp trên PC này không dùng ké
            set({ authed: false, account: { ...BLANK_ACCOUNT } });
          },
          (e) => toast(err(e), "error"),
        );
        return;
      }
      set({ authed: false });
    },
    setMode: (m) => {
      set((s) => ({ account: switchMode(s.account, m) }));
      saveMode(safeLocalStorage(), m);
    },
    setScenario: (id) => {
      const prev = get().scenario;
      setServiceScenario(id);
      const online = id !== "offline";
      set({ scenario: id, online });
      // host-pending: ép trạng thái chờ duyệt (và hoàn tác khi rời kịch bản nếu do kịch bản tạo ra)
      const s = get();
      if (id === "host-pending" && s.account.hostApproval === "none") {
        set({ account: { ...s.account, hostApproval: "pending" }, pendingFromScenario: true, hostSetup: { ...s.hostSetup, consented: true, verdict: "eligible", installed: true, installedSteps: INSTALL_COMPONENTS.length } });
      } else if (prev === "host-pending" && id !== "host-pending" && s.pendingFromScenario) {
        set({ account: { ...s.account, hostApproval: "none" }, pendingFromScenario: false, hostSetup: initialHostSetup() });
      }
      const sess = get().session;
      if (!online && sess?.phase === "active") dispatch("session", { type: "DISCONNECT" });
      if (online && sess?.phase === "reconnecting") void runReconnect(sess.id);
      bump();
      toast(`Kịch bản demo: ${id}`, "info");
    },
    resetDemo: () => {
      setServiceScenario("normal");
      set({ ...initial(), toasts: [], dataVersion: get().dataVersion + 1 });
      toast("Đã đặt lại dữ liệu demo.", "ok");
    },
    updateSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
    toast,
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    toggleCompare: (id) => {
      const c = get().compare;
      if (c.includes(id)) {
        set({ compare: c.filter((x) => x !== id) });
        return true;
      }
      if (c.length >= 3) return false;
      set({ compare: [...c, id] });
      return true;
    },
    clearCompare: () => set({ compare: [] }),
    refreshData: bump,
    claimFaucet: () => {
      const w = get().wallet;
      if (w.faucetClaimed) return;
      set({ wallet: addTransaction({ ...w, faucetClaimed: true }, { id: nextId("tx"), at: NOW_LABEL, kind: "faucet", ledger: "usable", amount: 1000, status: "done", label: "Nhận PCP thử (một lần, mô phỏng)" }) });
    },

    startSession: (m, minutes, workspace) => {
      const s = get();
      if (!s.online) return { ok: false, reason: "Đang mất mạng. Cần kết nối để thuê máy." };
      if (s.session && !isTerminal(s.session.phase)) return { ok: false, reason: "Bạn đang có một phiên chưa kết thúc." };
      if (s.session && s.session.phase === "cleanup_failed") return { ok: false, reason: "Phiên trước còn lỗi dọn dẹp." };
      const c = checkDuration(m, minutes);
      if (!c.ok) return { ok: false, reason: DURATION_REASON_TEXT[c.reason] };
      const q = quote(m.pricePer15, minutes);
      if (q.gross > s.wallet.usable) return { ok: false, reason: "Số dư PCP thử không đủ." };
      if (workspace === "save" && !m.workspace) return { ok: false, reason: "Máy này không hỗ trợ lưu workspace." };
      const sess = newSession({ id: nextId("s"), machineId: m.id, machineName: m.name, hostAlias: m.hostAlias, pricePer15: m.pricePer15, durationMin: minutes, workspaceMode: workspace });
      set({
        session: sess,
        wallet: addTransaction(s.wallet, { id: nextId("tx"), at: NOW_LABEL, kind: "hold", ledger: "usable", amount: -q.gross, status: "done", label: `Tạm giữ cho phiên ${m.name} (${q.minutes} phút)`, sessionId: sess.id }),
      });
      service.setMachineState(m.id, "busy");
      bump();
      void runPrepare(sess.id);
      return { ok: true };
    },
    enterSession: () => dispatch("session", { type: "ENTER" }),
    endSession: () => dispatch("session", { type: "END" }),
    simulateDisconnect: () => {
      dispatch("session", { type: "DISCONNECT" });
      const s = get().session;
      if (s?.phase === "reconnecting") void runReconnect(s.id);
    },
    retryReconnect: () => {
      const s = get().session;
      if (!s) return;
      dispatch("session", { type: "RECONNECT_RETRY" });
      void runReconnect(s.id);
    },
    saveRetry: () => dispatch("session", { type: "SAVE_RETRY" }),
    saveSkip: () => dispatch("session", { type: "SAVE_SKIP" }),
    cleanupRetry: () => dispatch("session", { type: "CLEANUP_RETRY" }),
    skipTime: (minutes) => dispatch("session", { type: "TICK", sec: minutes * 60 }),
    dismissSession: () => {
      const s = get().session;
      if (s && isTerminal(s.phase)) set({ session: null });
    },

    patchHostSetup: (p) => set((s) => ({ hostSetup: { ...s.hostSetup, ...p } })),
    patchHostConfig: (p) => set((s) => ({ hostSetup: { ...s.hostSetup, config: { ...s.hostSetup.config, ...p } } })),
    submitListing: async () => {
      try {
        await service.submitListing();
        set((s) => ({ account: { ...s.account, hostApproval: "pending" } }));
        notify("Đã gửi đăng máy để duyệt", "Máy chưa nhận khách cho tới khi được duyệt (mô phỏng).", "info", "host");
      } catch (e) {
        toast(err(e), "error");
        throw e;
      }
    },
    decideApproval: (a) => {
      set((s) => ({ account: { ...s.account, hostApproval: a }, hostAccepting: true, hostAgentRunning: a === "approved" }));
      if (a === "approved") notify("Máy đã được duyệt", "Bạn có thể bật nhận phiên. Lịch không tự bật máy: dịch vụ cung cấp phải đang chạy.", "ok", "host");
      else notify("Bài đăng bị từ chối", "Lý do (mô phỏng): thông tin tài nguyên chưa khớp kiểm tra. Sửa và gửi lại.", "error", "host");
    },
    returnToDraft: () => set((s) => ({ account: { ...s.account, hostApproval: "none" }, pendingFromScenario: false })),
    setAccepting: (v) => set({ hostAccepting: v }),
    startProviding: () => {
      if (get().account.hostApproval !== "approved") return toast("Máy chưa được duyệt nên không thể bắt đầu cung cấp.", "warn");
      set({ hostAgentRunning: true, hostStopAfterSession: false, hostWindowState: "open" });
      toast("Dịch vụ cung cấp máy đang chạy (mô phỏng).", "ok");
    },
    stopProviding: (drain) => {
      const hs = get().hostSession;
      if (drain && hs && !isTerminal(hs.phase)) {
        set({ hostAccepting: false, hostStopAfterSession: true });
        toast("Đã ngừng nhận phiên mới. Dịch vụ sẽ dừng sau khi phiên hiện tại kết thúc.", "info");
      } else {
        set({ hostAgentRunning: false, hostStopAfterSession: false });
        toast("Đã dừng cung cấp máy (mô phỏng).", "ok");
      }
    },
    closeWindow: () => {
      const bg = get().settings.hostBackground;
      if (bg) set({ hostWindowState: "hidden" });
      else set({ hostWindowState: "quit", hostAgentRunning: false });
    },
    reopenWindow: () => set({ hostWindowState: "open" }),

    simulateGuest: () => {
      const gate = receiveGate(hostInputs());
      if (!gate.ok) return { ok: false, reasons: gate.reasons };
      if (get().hostSession && !isTerminal(get().hostSession!.phase)) return { ok: false, reasons: ["Đã có phiên đang chạy (một máy, một phiên)."] };
      let sess = newSession({ id: nextId("hs"), machineId: "mine", machineName: "Máy của tôi", hostAlias: "Khách K-7F2 (ẩn danh)", pricePer15: get().hostSetup.config.pricePer15, durationMin: 60, workspaceMode: "none" });
      for (const e of [{ type: "PREPARE_STEP" }, { type: "PREPARE_STEP" }, { type: "PREPARE_STEP" }, { type: "PREPARE_STEP" }, { type: "ENTER" }] as SessionEvent[]) sess = sessionReducer(sess, e);
      set({ hostSession: sess });
      notify("Có khách thuê máy (mô phỏng)", "Phiên 60 phút đang chạy. Bạn có thể tiếp tục dùng Windows nhưng hiệu năng có thể bị ảnh hưởng.", "info", "host");
      return { ok: true };
    },
    hostEndSession: () => dispatch("hostSession", { type: "END" }),
    hostSkipTime: (m) => dispatch("hostSession", { type: "TICK", sec: m * 60 }),
    retryHostCleanup: () => {
      const s = get().hostSession;
      if (!s) return;
      if (s.phase === "cleanup_failed") {
        // chỉ coi là xong khi cleanup thật sự thành công
        const id = s.id;
        dispatch("hostSession", { type: "CLEANUP_RETRY" });
        const check = setInterval(() => {
          const cur = get().hostSession;
          if (!cur || cur.id !== id) return clearInterval(check);
          if (cur.phase === "completed") {
            clearInterval(check);
            const wallet = releaseHeld(get().wallet, id);
            set({ wallet, hostBlocked: false, hostRecords: get().hostRecords.map((r) => (r.id === id ? { ...r, status: "settled" } : r)) });
            service.listIncidents().then((l) => l.filter((i) => i.status === "open" && i.kind === "cleanup").forEach((i) => service.resolveIncident(i.id))).catch(() => undefined).finally(bump);
            toast("Dọn dẹp thành công. Máy được mở khóa; thu nhập đã ghi nhận.", "ok");
          } else if (cur.phase === "cleanup_failed") {
            clearInterval(check);
            toast("Dọn dẹp vẫn thất bại. Máy tiếp tục bị khóa.", "error");
          }
        }, 300);
      }
    },
  };
});

export const selectHostInputs = (s: AppState) => ({
  approval: s.account.hostApproval,
  agentRunning: s.hostAgentRunning,
  accepting: s.hostAccepting,
  insideWindow: isInsideOfferWindow(s.hostSetup.config.weekly, s.hostSetup.config.exceptions),
  blocked: s.hostBlocked,
  online: s.online,
});

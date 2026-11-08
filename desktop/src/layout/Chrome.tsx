import { FlaskConical, LogOut, RotateCcw, User, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Popover } from "radix-ui";
import { Server, MonitorSmartphone } from "lucide-react";
import { Link, navigate } from "@/app/router";
import { formatClock } from "@/domain/clock";
import { isTerminal } from "@/domain/session";
import { cn } from "@/lib/utils";
import { SCENARIOS } from "@/mock/scenarios";
import { useAppStore } from "@/state/store";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { RadioGroup } from "@/ui/radio";
import { Money } from "@/ui/page";
import { COMMON_NAV, HOST_NAV, RENT_NAV, isActive, type NavItem } from "./nav";

/* ---------- Dải thông báo demo ---------- */
export function DemoBanner() {
  const scenario = useAppStore((s) => s.scenario);
  const label = SCENARIOS.find((s) => s.id === scenario)?.label;
  return (
    <div className="flex h-7 shrink-0 items-center justify-center gap-2 border-b border-warn-line bg-warn-bg px-4 text-xs font-semibold text-warn">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden />
      BẢN XEM TRƯỚC GIAO DIỆN — dữ liệu, đăng nhập, thanh toán, cài đặt và kết nối đều là mô phỏng.
      <span className="hidden font-medium md:inline">Kịch bản: {label}</span>
    </div>
  );
}

/* ---------- Chuyển chế độ ---------- */
export function ModeSwitch() {
  const mode = useAppStore((s) => s.account.mode);
  const approval = useAppStore((s) => s.account.hostApproval);
  const setMode = useAppStore((s) => s.setMode);
  const go = (m: "rent" | "host") => {
    setMode(m);
    navigate(m === "rent" ? "/rent/discover" : "/host");
  };
  const items = [
    { v: "rent" as const, label: "Thuê máy", icon: MonitorSmartphone },
    { v: "host" as const, label: "Cho thuê máy", icon: Server },
  ];
  return (
    <div className="flex items-center gap-2">
      <RadioGroup label="Chế độ sử dụng" keepFocus className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
        {items.map((i) => (
          <button
            key={i.v}
            type="button"
            role="radio"
            aria-checked={mode === i.v}
            tabIndex={mode === i.v ? 0 : -1}
            onClick={() => go(i.v)}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors duration-150", mode === i.v ? "bg-navy text-white" : "text-ink-soft hover:bg-sky/60")}
          >
            <i.icon className="h-4 w-4" aria-hidden />
            {i.label}
          </button>
        ))}
      </RadioGroup>
      {mode === "host" && approval !== "approved" && <Badge tone="warn" icon={false}>Chưa được duyệt</Badge>}
    </div>
  );
}

/* ---------- Bộ chọn kịch bản demo ---------- */
export function DemoPanel() {
  const scenario = useAppStore((s) => s.scenario);
  const setScenario = useAppStore((s) => s.setScenario);
  const reset = useAppStore((s) => s.resetDemo);
  const current = SCENARIOS.find((s) => s.id === scenario)!;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="secondary" size="sm" aria-label={`Kịch bản demo: ${current.label}. Mở bộ chọn`}>
          <FlaskConical className="h-4 w-4 text-warn" aria-hidden />
          <span className="hidden lg:inline">Demo:</span> {current.label}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-80 rounded-lg border border-line bg-surface p-3 shadow-pop animate-pop-in">
          <p className="mb-1 text-sm font-bold">Kịch bản demo</p>
          <p className="mb-2 text-xs text-ink-faint">Chỉ dành cho duyệt giao diện. Chọn để xem các trạng thái.</p>
          <RadioGroup label="Kịch bản demo" className="flex flex-col gap-0.5">
            {SCENARIOS.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={scenario === s.id} tabIndex={scenario === s.id ? 0 : -1} onClick={() => setScenario(s.id)} className={cn("rounded-md px-2.5 py-1.5 text-left", scenario === s.id ? "bg-teal-tint" : "hover:bg-subtle")}>
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className={cn("h-3 w-3 rounded-full border-2", scenario === s.id ? "border-teal bg-teal" : "border-line-strong")} aria-hidden />
                  {s.label}
                </span>
                <span className="ml-5 block text-xs text-ink-faint">{s.hint}</span>
              </button>
            ))}
          </RadioGroup>
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Đặt lại toàn bộ demo
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ---------- Thanh trên ---------- */
export function TopBar() {
  const mode = useAppStore((s) => s.account.mode);
  const wallet = useAppStore((s) => s.wallet);
  const name = useAppStore((s) => s.account.name);
  const signOut = useAppStore((s) => s.signOut);
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-5">
      <ModeSwitch />
      <div className="flex items-center gap-3">
        <Link to="/wallet" className="hidden rounded-md px-2 py-1 text-right text-xs leading-tight hover:bg-subtle sm:block" aria-label="Xem số dư và giao dịch">
          <span className="block text-ink-faint">{mode === "rent" ? "Số dư để thuê" : "Thu nhập host đã ghi nhận"}</span>
          <Money value={mode === "rent" ? wallet.usable : wallet.hostSettled} className="text-sm" />
        </Link>
        <DemoPanel />
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Tài khoản của ${name}`}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky text-sm font-bold text-navy">{name.trim().split(" ").slice(-1)[0]?.[0] ?? "?"}</span>
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={6} className="z-50 w-56 rounded-lg border border-line bg-surface p-1.5 shadow-pop animate-pop-in">
              <p className="px-2.5 py-1.5 text-xs text-ink-faint">Tài khoản mô phỏng</p>
              <Popover.Close asChild>
                <Link to="/account" className="flex h-9 items-center gap-2 rounded-md px-2.5 text-sm font-semibold hover:bg-subtle"><User className="h-4 w-4" aria-hidden /> Tài khoản</Link>
              </Popover.Close>
              <Popover.Close asChild>
                <button type="button" onClick={() => { signOut(); navigate("/welcome"); }} className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm font-semibold text-danger hover:bg-danger-bg"><LogOut className="h-4 w-4" aria-hidden /> Đăng xuất</button>
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

/* ---------- Sidebar ---------- */
function NavLink({ item, path, badge }: { item: NavItem; path: string; badge?: string }) {
  const active = isActive(item, path);
  return (
    <Link to={item.to} aria-current={active ? "page" : undefined} className={cn("flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-semibold transition-colors duration-150", active ? "bg-teal-tint text-teal-dark" : "text-ink-soft hover:bg-sky/60 hover:text-ink")}>
      <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
      {badge && <span className="num ml-auto rounded-full bg-navy px-1.5 text-[11px] font-bold leading-5 text-white">{badge}</span>}
    </Link>
  );
}

export function Sidebar({ path }: { path: string }) {
  const mode = useAppStore((s) => s.account.mode);
  const approval = useAppStore((s) => s.account.hostApproval);
  const session = useAppStore((s) => s.session);
  const hostSession = useAppStore((s) => s.hostSession);
  const blocked = useAppStore((s) => s.hostBlocked);

  const rent = RENT_NAV.filter((i) => i.to !== "/rent/session" || (session && !(session.phase === "completed" && false)));
  const host = HOST_NAV.filter((i) => (i.to === "/host/onboarding/intro" ? approval !== "approved" : true));

  const badgeFor = (to: string) => {
    if (to === "/rent/session" && session) return isTerminal(session.phase) ? "!" : formatClock(session.remainingSec);
    if (to === "/host/sessions" && hostSession && !isTerminal(hostSession.phase)) return "1";
    if (to === "/host/incidents" && blocked) return "1";
    return undefined;
  };

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-surface lg:w-[232px]" aria-label="Điều hướng chính">
      <Link to={mode === "rent" ? "/rent/discover" : "/host"} className="flex h-14 items-center gap-2.5 border-b border-line px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal text-white">
          <MonitorSmartphone className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="text-sm font-bold leading-tight">Cloud PC<br /><span className="font-medium text-ink-faint">Companion</span></span>
      </Link>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-auto p-2.5" aria-label={mode === "rent" ? "Thuê máy" : "Cho thuê máy"}>
        <p className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-ink-faint">{mode === "rent" ? "Thuê máy" : "Cho thuê máy"}</p>
        {(mode === "rent" ? rent : host).map((i) => (
          <NavLink key={i.to} item={i} path={path} badge={badgeFor(i.to)} />
        ))}
        <p className="mt-4 px-2.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-ink-faint">Chung</p>
        {COMMON_NAV.map((i) => (
          <NavLink key={i.to} item={i} path={path} />
        ))}
      </nav>
      <p className="border-t border-line p-3 text-[11px] leading-snug text-ink-faint">Phiên bản xem trước · không kết nối dịch vụ thật</p>
    </aside>
  );
}

/* ---------- Toast ---------- */
export function ToastRegion() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  const style = { info: "border-info/40", ok: "border-ok/40", warn: "border-warn-line", error: "border-danger/40" } as const;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.18 }} className={cn("pointer-events-auto flex items-start gap-2 rounded-lg border bg-surface p-3 text-sm shadow-pop", style[t.tone])} role={t.tone === "error" ? "alert" : "status"}>
            <p className="min-w-0 flex-1">{t.text}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Đóng thông báo" className="rounded p-0.5 text-ink-faint hover:bg-subtle hover:text-ink"><X className="h-4 w-4" /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

import { FlaskConical, Info, LogOut, Lock, Menu, RotateCcw, User, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Popover } from "radix-ui";
import { Server, MonitorSmartphone } from "lucide-react";
import { Link, navigate } from "@/app/router";
import { formatClock } from "@/domain/clock";
import { isTerminal } from "@/domain/session";
import { cn } from "@/lib/utils";
import { IS_WEB, isLive } from "@/api/env";
import { DOWNLOAD_URL, isOpenOnWeb } from "@/app/webAccess";
import { DownloadButton } from "@/features/web/WebScreens";
import { networkLabel, PREVIEW_BANNER } from "@/domain/envLabels";
import { envFacts } from "@/api/envFacts";
import { SCENARIOS } from "@/mock/scenarios";
import { useSignOut } from "@/features/common/useSignOut";
import { useAppStore } from "@/state/store";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { RadioGroup } from "@/ui/radio";
import { ThemeToggle } from "@/ui/theme-toggle";
import { Money } from "@/ui/page";
import { ADMIN_NAV, COMMON_NAV, hostNav, isActive, isComingSoon, rentNav, type NavItem } from "./nav";

/* ---------- Dải thông báo (chỉ ở bản xem trước: dữ liệu mẫu phải được ghi rõ) ---------- */
export function DemoBanner() {
  const scenario = useAppStore((s) => s.scenario);
  const label = SCENARIOS.find((s) => s.id === scenario)?.label;
  if (IS_WEB) {
    // Bản web: nói rõ đây là bản chỉ để xem, danh sách máy là dữ liệu mẫu, và việc thật nằm trong app.
    return (
      <div className="flex min-h-7 shrink-0 flex-wrap items-center justify-center gap-x-2 border-b border-info/30 bg-info-bg px-4 py-1 text-xs font-semibold text-info-ink" data-testid="web-banner">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Bản web chỉ để xem: danh sách máy là dữ liệu mẫu. Thuê và cho thuê máy cần cài app.</span>
        <a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">Tải app</a>
      </div>
    );
  }
  if (isLive()) return null; // bản thật không có dải này: nhãn mạng nằm ở chip trên thanh trên và chân thanh bên
  return (
    <div className="flex h-7 shrink-0 items-center justify-center gap-2 border-b border-warn-line bg-warn-bg px-4 text-xs font-semibold text-warn">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden />
      {PREVIEW_BANNER}
      <span className="hidden font-medium md:inline">· Kịch bản: {label}</span>
    </div>
  );
}

/** Chip mạng ở thanh trên (live). Không hiện nếu app không có ví để biết mạng nào. */
function NetworkChip() {
  const net = isLive() ? networkLabel(envFacts()) : null;
  if (!net) return null;
  return (
    <Link to="/about" title={net.note} aria-label={net.note} className="hidden items-center rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-semibold text-ink-soft hover:bg-subtle sm:inline-flex">
      {net.chip}
    </Link>
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
            aria-label={i.label}
            tabIndex={mode === i.v ? 0 : -1}
            onClick={() => go(i.v)}
            className={cn("relative inline-flex h-8 items-center rounded-md px-2.5 text-sm font-semibold transition-colors duration-150 sm:px-3", mode === i.v ? "text-white" : "text-ink-soft hover:bg-sky/60")}
          >
            {/* Nền đậm trượt từ nút này sang nút kia (motion tự tắt khi bật "Giảm chuyển động"). */}
            {mode === i.v && <motion.span layoutId="mode-pill" className="absolute inset-0 rounded-md bg-navy" transition={{ type: "spring", stiffness: 520, damping: 38 }} aria-hidden />}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <i.icon className="h-4 w-4" aria-hidden />
              {/* Màn rất hẹp: chỉ còn biểu tượng (tên đọc ra nhờ aria-label). */}
              <span className="hidden sm:inline">{i.label}</span>
            </span>
          </button>
        ))}
      </RadioGroup>
      {mode === "host" && approval !== "approved" && !isLive() && !IS_WEB && <Badge tone="warn" icon={false}>Chưa được duyệt</Badge>}
      {mode === "host" && approval === "rejected" && isLive() && <Badge tone="danger" icon={false}>Tài khoản host bị tạm khóa</Badge>}
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
export function TopBar({ onMenu }: { onMenu?: () => void } = {}) {
  const mode = useAppStore((s) => s.account.mode);
  const wallet = useAppStore((s) => s.wallet);
  const name = useAppStore((s) => s.account.name);
  const email = useAppStore((s) => s.account.email);
  const { requestSignOut, dialog: signOutDialog } = useSignOut();
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-3 sm:gap-3 sm:px-5">
      {signOutDialog}
      <div className="flex min-w-0 items-center gap-1.5">
        {/* Màn hẹp: thanh bên thu thành ngăn kéo, mở bằng nút này. */}
        {onMenu && <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Mở menu điều hướng" onClick={onMenu}><Menu className="h-5 w-5" aria-hidden /></Button>}
        <ModeSwitch />
      </div>
      <div className="flex items-center gap-1.5 sm:gap-3">
        {!isLive() && !IS_WEB && <Link to="/wallet" className="hidden rounded-md px-2 py-1 text-right text-xs leading-tight hover:bg-subtle sm:block" aria-label="Xem số dư và giao dịch">
          <span className="block text-ink-faint">{mode === "rent" ? "Số dư để thuê" : "Thu nhập host đã ghi nhận"}</span>
          <Money value={mode === "rent" ? wallet.usable : wallet.hostSettled} className="text-sm" />
        </Link>}
        {!isLive() && !IS_WEB && <DemoPanel />}
        <NetworkChip />
        <ThemeToggle />
        {/* Bản web không có tài khoản: thay menu tài khoản/đăng xuất bằng nút tải app (khách xem luôn ở trạng thái "đã vào"). */}
        {IS_WEB ? <DownloadButton size="sm">Tải app</DownloadButton> : <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Tài khoản của ${name}`}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky text-sm font-bold text-ink">{name.trim().split(" ").slice(-1)[0]?.[0] ?? "?"}</span>
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={6} className="z-50 w-56 rounded-lg border border-line bg-surface p-1.5 shadow-pop animate-pop-in">
              <p className="truncate px-2.5 py-1.5 text-xs text-ink-faint" title={email || undefined}>{isLive() ? email || name : "Tài khoản mẫu"}</p>
              <Popover.Close asChild>
                <Link to="/account" className="flex h-9 items-center gap-2 rounded-md px-2.5 text-sm font-semibold hover:bg-subtle"><User className="h-4 w-4" aria-hidden /> Tài khoản</Link>
              </Popover.Close>
              <Popover.Close asChild>
                <button type="button" onClick={requestSignOut} className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm font-semibold text-danger hover:bg-danger-bg"><LogOut className="h-4 w-4" aria-hidden /> Đăng xuất</button>
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>}
      </div>
    </div>
  );
}

/* ---------- Sidebar ---------- */
function NavLink({ item, path, badge, soon }: { item: NavItem; path: string; badge?: string; soon?: boolean }) {
  const active = isActive(item, path);
  return (
    <Link to={item.to} aria-current={active ? "page" : undefined} className={cn("relative flex h-9 items-center rounded-md px-2.5 text-sm font-semibold transition-colors duration-150", active ? "text-teal-ink" : "text-ink-soft hover:bg-sky/60 hover:text-ink")}>
      {/* Nền của mục đang xem trượt giữa các mục khi đổi màn. */}
      {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-md bg-teal-tint" transition={{ type: "spring", stiffness: 520, damping: 40 }} aria-hidden />}
      <span className="relative z-10 flex min-w-0 flex-1 items-center gap-2.5">
        <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
        <span className="truncate">{isLive() ? (item.liveLabel ?? item.label) : item.label}</span>
        {badge && <span className="num ml-auto rounded-full bg-navy px-1.5 text-[11px] font-bold leading-5 text-white">{badge}</span>}
        {/* App (live): mục chưa nối chức năng thật vẫn hiện cho giống bản web, gắn nhãn để không ai tưởng đã dùng được. */}
        {soon && <span className="ml-auto shrink-0 rounded-full border border-line-strong px-1.5 text-[10px] font-semibold leading-4 text-ink-faint" data-testid="nav-soon">Sắp có</span>}
        {/* Bản web: mục cần app có biểu tượng khóa (bấm vào vẫn ra màn giải thích + nút tải app). */}
        {IS_WEB && !isOpenOnWeb(item.to) && (
          <span className="ml-auto text-ink-faint">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only"> (cần app)</span>
          </span>
        )}
      </span>
    </Link>
  );
}

export function Sidebar({ path }: { path: string }) {
  const mode = useAppStore((s) => s.account.mode);
  const approval = useAppStore((s) => s.account.hostApproval);
  const session = useAppStore((s) => s.session);
  const hostSession = useAppStore((s) => s.hostSession);
  const blocked = useAppStore((s) => s.hostBlocked);
  const isAdmin = useAppStore((s) => !!s.account.isAdmin);

  const live = isLive();
  const rent = rentNav({ live, hasSession: !!session });
  const host = hostNav({ live, approved: approval === "approved" });

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
          <NavLink key={i.to} item={i} path={path} badge={badgeFor(i.to)} soon={isComingSoon(i.to, live)} />
        ))}
        {live && isAdmin && (
          <>
            <p className="mt-4 px-2.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-ink-faint">Quản trị</p>
            <NavLink item={ADMIN_NAV} path={path} />
          </>
        )}
        <p className="mt-4 px-2.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-ink-faint">Chung</p>
        {COMMON_NAV.map((i) => (
          <NavLink key={i.to} item={i} path={path} soon={isComingSoon(i.to, live)} />
        ))}
      </nav>
      <p className="border-t border-line p-3 text-[11px] leading-snug text-ink-faint">{IS_WEB ? "Bản web · chỉ để xem" : isLive() ? (networkLabel(envFacts())?.footer ?? "") : "Bản xem trước · dữ liệu mẫu"}</p>
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

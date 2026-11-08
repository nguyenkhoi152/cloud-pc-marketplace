import { AlertTriangle, CheckCircle2, Info, Inbox, RefreshCw, WifiOff, XCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ServiceError } from "@/mock/scenarios";
import type { AsyncState } from "@/state/useAsync";
import { Button } from "./button";

type BannerTone = "info" | "ok" | "warn" | "danger";
const bannerStyle: Record<BannerTone, string> = {
  info: "border-info/30 bg-info-bg text-[#1e3a8a]",
  ok: "border-ok/30 bg-ok-bg text-[#14532d]",
  warn: "border-warn-line bg-warn-bg text-warn",
  danger: "border-danger/30 bg-danger-bg text-[#7f1d1d]",
};
const bannerIcon: Record<BannerTone, LucideIcon> = { info: Info, ok: CheckCircle2, warn: AlertTriangle, danger: XCircle };

export function Banner({ tone = "info", title, children, action, className }: { tone?: BannerTone; title?: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = bannerIcon[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-md border px-3.5 py-3 text-sm", bannerStyle[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "leading-snug")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-[pulse-soft_1.4s_ease-in-out_infinite] rounded-md bg-line/70", className)} />;
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Đang tải" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
      <span className="sr-only">Đang tải dữ liệu…</span>
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center">
      <Icon className="mb-3 h-8 w-8 text-ink-faint" aria-hidden />
      <p className="text-base font-bold">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const offline = error instanceof ServiceError && error.code === "offline";
  return (
    <div role="alert" className="flex flex-col items-center rounded-lg border border-danger/30 bg-danger-bg/60 px-6 py-10 text-center">
      {offline ? <WifiOff className="mb-3 h-8 w-8 text-danger" aria-hidden /> : <XCircle className="mb-3 h-8 w-8 text-danger" aria-hidden />}
      <p className="text-base font-bold text-[#7f1d1d]">{offline ? "Mất kết nối mạng" : "Không tải được dữ liệu"}</p>
      <p className="mt-1 max-w-md text-sm text-[#7f1d1d]">{error.message} Dữ liệu đang hiển thị là mô phỏng; đây là trạng thái lỗi để bạn duyệt.</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Thử lại
        </Button>
      )}
    </div>
  );
}

/** Hiển thị đủ 3 trạng thái tải/lỗi/trống/có dữ liệu cho mọi danh sách đọc từ dịch vụ. */
export function Async<T>({ state, children, isEmpty, empty, skeleton }: { state: AsyncState<T> & { retry: () => void }; children: (data: T) => ReactNode; isEmpty?: (d: T) => boolean; empty?: ReactNode; skeleton?: ReactNode }) {
  if (state.status === "loading") return <>{skeleton ?? <SkeletonRows />}</>;
  if (state.status === "error") return <ErrorState error={state.error} onRetry={state.retry} />;
  if (isEmpty?.(state.data)) return <>{empty}</>;
  return <>{children(state.data)}</>;
}

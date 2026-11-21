import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, usePath } from "@/app/router";
import { iconForPath } from "@/layout/nav";
import { cn } from "@/lib/utils";

/** Đầu trang. Huy hiệu biểu tượng lấy theo mục điều hướng của màn đang xem (hoặc truyền `icon`); không khớp thì không hiện. */
export function PageHeader({ title, subtitle, actions, crumbs, icon }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[]; icon?: LucideIcon }) {
  const path = usePath();
  const Icon = icon ?? iconForPath(path);
  return (
    <header className="mb-5">
      {crumbs && (
        <nav aria-label="Đường dẫn" className="mb-1 flex items-center gap-1 text-xs text-ink-faint">
          {crumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
              {c.to ? <Link to={c.to} className="rounded font-semibold hover:text-teal-ink hover:underline">{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3.5">
          {Icon && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-tint text-teal-ink" aria-hidden data-testid="page-icon"><Icon className="h-6 w-6" /></span>}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Khối nội dung có tiêu đề; mặc định không viền để tránh "thẻ giống hệt nhau". */
export function Section({ title, aside, children, bordered, className }: { title?: string; aside?: ReactNode; children: ReactNode; bordered?: boolean; className?: string }) {
  return (
    <section className={cn(bordered && "rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]", className)}>
      {(title || aside) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** Ô số liệu: biểu tượng + nhãn + giá trị lớn (+ ghi chú). `index` là thứ tự xếp tầng khi hiện (xem `.enter` trong index.css). */
export function StatTile({ label, value, hint, icon: Icon, tone = "default", index = 0, className }: { label: string; value: ReactNode; hint?: ReactNode; icon: LucideIcon; tone?: "default" | "ok" | "warn"; index?: number; className?: string }) {
  const badge = tone === "ok" ? "bg-ok-bg text-ok" : tone === "warn" ? "bg-warn-bg text-warn" : "bg-teal-tint text-teal-ink";
  return (
    <div className={cn("enter rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgb(15_23_42/0.05)]", className)} style={{ "--i": index } as React.CSSProperties} data-testid="stat-tile">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", badge)} aria-hidden><Icon className="h-[18px] w-[18px]" /></span>
        <p className="text-sm font-semibold text-ink-soft">{label}</p>
      </div>
      <p className="num mt-3 break-words text-2xl font-bold leading-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

export function KeyValue({ items, className }: { items: { k: string; v: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm", className)}>
      {items.map((i) => (
        <div key={i.k} className="contents">
          <dt className="text-ink-faint">{i.k}</dt>
          <dd className="font-semibold">{i.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Money({ value, signed, className }: { value: number; signed?: boolean; className?: string }) {
  const s = `${signed && value > 0 ? "+" : ""}${value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}`;
  return (
    <span className={cn("num whitespace-nowrap font-semibold", className)}>
      {s} <span className="text-[0.85em] font-medium text-ink-faint">PCP thử</span>
    </span>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} className="h-2 w-full overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full bg-teal transition-[width] duration-200" style={{ width: `${value}%` }} />
    </div>
  );
}

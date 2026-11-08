import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/app/router";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, actions, crumbs }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[] }) {
  return (
    <header className="mb-5">
      {crumbs && (
        <nav aria-label="Đường dẫn" className="mb-1 flex items-center gap-1 text-xs text-ink-faint">
          {crumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
              {c.to ? <Link to={c.to} className="rounded font-semibold hover:text-teal-dark hover:underline">{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Khối nội dung có tiêu đề; mặc định không viền để tránh "thẻ giống hệt nhau". */
export function Section({ title, aside, children, bordered, className }: { title?: string; aside?: ReactNode; children: ReactNode; bordered?: boolean; className?: string }) {
  return (
    <section className={cn(bordered && "rounded-lg border border-line bg-surface p-5", className)}>
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

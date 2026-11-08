import { AlertTriangle, CheckCircle2, Clock, Info, Minus, XCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "teal";

const tones: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
  neutral: "bg-sky/70 text-ink-soft",
  teal: "bg-teal-tint text-teal-dark",
};
const icons: Record<Tone, LucideIcon> = { ok: CheckCircle2, warn: AlertTriangle, danger: XCircle, info: Info, neutral: Minus, teal: Clock };

/** Nhãn trạng thái: luôn có icon + chữ (không chỉ dựa vào màu). */
export function Badge({ tone = "neutral", icon = true, children, className }: { tone?: Tone; icon?: boolean | LucideIcon; children: ReactNode; className?: string }) {
  const Icon = typeof icon === "boolean" ? icons[tone] : icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold leading-5", tones[tone], className)}>
      {icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {children}
    </span>
  );
}

export function DemoTag({ children = "Dữ liệu mô phỏng" }: { children?: ReactNode }) {
  return <span className="rounded border border-warn-line bg-warn-bg px-1.5 py-px text-[11px] font-semibold text-warn">{children}</span>;
}

import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { WizardItem } from "@/domain/hostWizard";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";

/** Thanh bước bên trái: bước đã xong có dấu ✓, bước hiện tại tô nền, bước chưa mở được thì mờ và không bấm được. */
export function WizardNav({ items, selected, onSelect }: { items: WizardItem[]; selected: string; onSelect: (id: WizardItem["id"]) => void }) {
  return (
    <nav aria-label="Các bước thiết lập" data-testid="wizard-nav">
      <ol className="space-y-0.5">
        {items.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={!s.reachable}
              aria-current={s.id === selected ? "step" : undefined}
              data-step={s.id}
              data-state={s.state}
              onClick={() => onSelect(s.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:text-ink-faint/70",
                s.id === selected ? "bg-teal-tint text-teal-ink" : "text-ink-soft hover:bg-sky/60 enabled:hover:text-ink",
              )}
            >
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px]", s.state === "done" ? "border-ok-solid bg-ok-solid text-white" : s.id === selected ? "border-teal text-teal-ink" : "border-line-strong")} aria-hidden>
                {s.state === "done" ? "✓" : i + 1}
              </span>
              {s.label}
              <span className="sr-only"> — {s.state === "done" ? "đã xong" : s.state === "current" ? "việc tiếp theo" : s.reachable ? "chưa xong" : "chưa mở được"}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Chân trang của một bước: Quay lại bên trái, Tiếp tục bên phải (kèm lý do nếu chưa bấm được). */
export function WizardFooter({ onBack, onNext, nextLabel = "Tiếp tục", nextDisabled, why }: { onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean; why?: string }) {
  return (
    <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
      {onBack ? <Button variant="secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden />Quay lại</Button> : <span />}
      <div className="flex items-center gap-3">
        {onNext && nextDisabled && why && <span className="text-xs text-ink-faint">{why}</span>}
        {onNext && <Button variant="primary" onClick={onNext} disabled={nextDisabled}>{nextLabel}<ArrowRight className="h-4 w-4" aria-hidden /></Button>}
      </div>
    </div>
  );
}

/** pass = Đạt; warn = Lưu ý; fail = Chưa đạt (bước này đang hỏng/thiếu); wait = chờ bước trước xong; pending = đang đọc từ máy. */
export type CheckStatus = "pass" | "warn" | "fail" | "wait" | "pending";
const CHECK_ICON: Record<CheckStatus, typeof CheckCircle2> = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle, wait: Circle, pending: Loader2 };
const CHECK_COLOR: Record<CheckStatus, string> = { pass: "text-ok", warn: "text-warn", fail: "text-danger", wait: "text-ink-faint", pending: "text-ink-faint" };
const CHECK_TEXT: Record<CheckStatus, string> = { pass: "Đạt", warn: "Lưu ý", fail: "Chưa đạt", wait: "Chờ bước trước", pending: "Đang kiểm tra" };

export interface CheckRowData {
  label: string;
  value: ReactNode;
  status: CheckStatus;
}

/** Bảng kết quả kiểm tra máy: tên mục, giá trị app đọc được, và kết quả Đạt / Lưu ý / Chưa đạt ở bên phải. */
export function CheckTable({ rows }: { rows: CheckRowData[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface" data-testid="check-table">
      {rows.map((r) => {
        const Icon = CHECK_ICON[r.status];
        return (
          <li key={r.label} data-status={r.status} className="grid grid-cols-1 gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[170px_minmax(0,1fr)_auto] sm:items-center">
            <p className="font-bold">{r.label}</p>
            <p className="min-w-0 text-sm text-ink-soft">{r.value}</p>
            <p className={cn("flex items-center gap-1.5 text-sm font-semibold sm:justify-end", CHECK_COLOR[r.status])}>
              <Icon className={cn("h-4 w-4", r.status === "pending" && "animate-[spin_1s_linear_infinite]")} aria-hidden />
              {CHECK_TEXT[r.status]}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export type ChecklistState = "done" | "doing" | "todo" | "warn" | "fail";
export interface ChecklistItem {
  id: string;
  label: string;
  state: ChecklistState;
  note?: ReactNode;
}

/** Danh sách thành phần cần cài: vòng tích xanh khi xong, vòng xoay khi đang làm, vòng trống khi chưa tới. */
export function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="space-y-3" data-testid="install-checklist">
      {items.map((i) => (
        <li key={i.id} data-item={i.id} data-state={i.state} className="flex items-start gap-3">
          {i.state === "done" && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />}
          {i.state === "doing" && <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-[spin_1s_linear_infinite] text-teal" aria-hidden />}
          {i.state === "todo" && <Circle className="mt-0.5 h-5 w-5 shrink-0 text-line-strong" aria-hidden />}
          {i.state === "warn" && <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />}
          {i.state === "fail" && <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />}
          <div className="min-w-0">
            <p className={cn("font-semibold", i.state === "todo" && "text-ink-faint")}>
              {i.label}
              <span className="sr-only"> — {i.state === "done" ? "đã xong" : i.state === "doing" ? "đang làm" : i.state === "warn" ? "cần bạn làm" : i.state === "fail" ? "gặp sự cố" : "chưa tới"}</span>
            </p>
            {i.note && <p className="text-sm text-ink-soft">{i.note}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Thanh tiến trình không có phần trăm: app không đo được tiến độ cài thật, nên chỉ cho thấy "đang chạy" (không bịa số). */
export function IndeterminateBar({ label }: { label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-busy="true" className="h-2 w-full overflow-hidden rounded-full bg-line" data-testid="indeterminate-bar">
      <div className="h-full w-1/3 animate-[pulse-soft_1.4s_ease-in-out_infinite] rounded-full bg-teal" />
    </div>
  );
}

import { CheckCircle2, Circle, CircleSlash, Loader2, XCircle } from "lucide-react";
import type { StepView } from "@/domain/sessionSteps";
import { cn } from "@/lib/utils";

const SR: Record<StepView["state"], string> = { done: "đã xong", current: "đang diễn ra", failed: "gặp sự cố", todo: "chưa tới", skipped: "không diễn ra" };

/**
 * Tiến trình một phiên dạng danh sách dọc (tích xanh cho bước đã xong, vòng xoay cho bước đang diễn ra), giống màn Phiên trong
 * bản xem trước. Chỉ phản ánh trạng thái do máy chủ/chuỗi xác nhận (xem domain/sessionSteps).
 */
export function StepList({ steps, label = "Tiến trình phiên" }: { steps: StepView[]; label?: string }) {
  return (
    <ol className="space-y-3" aria-label={label} data-testid="session-steps">
      {steps.map((s) => (
        <li key={s.key} data-step={s.key} data-state={s.state} className="flex items-start gap-3" aria-current={s.state === "current" ? "step" : undefined}>
          {s.state === "done" && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />}
          {s.state === "current" && <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-[spin_1s_linear_infinite] text-teal" aria-hidden />}
          {s.state === "todo" && <Circle className="mt-0.5 h-5 w-5 shrink-0 text-line-strong" aria-hidden />}
          {s.state === "failed" && <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />}
          {s.state === "skipped" && <CircleSlash className="mt-0.5 h-5 w-5 shrink-0 text-ink-faint" aria-hidden />}
          <p className={cn("font-semibold", s.state === "todo" && "text-ink-faint", s.state === "skipped" && "text-ink-faint line-through", s.state === "failed" && "text-danger")}>
            {s.label}
            <span className="sr-only"> — {SR[s.state]}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}

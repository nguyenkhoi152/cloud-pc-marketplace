import type { ReactNode } from "react";
import { PREVIEW_LABEL } from "@cpm/shared";

export function PreviewBanner() {
  return (
    <div role="note" className="bg-amber-100 text-amber-900 text-sm px-4 py-2 text-center border-b border-amber-300">
      <strong>PREVIEW:</strong> {PREVIEW_LABEL}. Chưa đăng nhập thật, chưa có ví/receipt, chưa có máy online,
      chưa có remote desktop hay lưu cloud. PCP là token thử, không có giá trị tiền thật.
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold">{children}</h1>
      {sub ? <p className="mt-1 text-sm opacity-70">{sub}</p> : null}
    </header>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-slate-300/60 bg-white/70 dark:bg-slate-900/60 p-4">{children}</div>;
}

/** Hành động chưa có backend thật: disable và giải thích, không giả kết quả. */
export function DisabledAction({ label, reason }: { label: string; reason: string }) {
  return (
    <div>
      <button
        type="button"
        disabled
        className="rounded bg-slate-300 px-4 py-2 text-sm text-slate-600 cursor-not-allowed"
      >
        {label}
      </button>
      <p className="mt-1 text-xs opacity-70">Chưa khả dụng: {reason}</p>
    </div>
  );
}

export function StatusPill({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded-full bg-slate-200 text-slate-800 px-2 py-0.5 text-xs">{children}</span>;
}

import { Check } from "lucide-react";
import { Slider as S, Switch as SW, Tabs as T } from "radix-ui";
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { RadioGroup } from "./radio";

/* ---------- Field ---------- */
export function Field({ label, hint, error, children, htmlFor, className }: { label: string; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-ink-faint">{hint}</p>}
      {error && <p role="alert" className="text-xs font-semibold text-danger">{error}</p>}
    </div>
  );
}

const inputBase = "h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint hover:border-ink-faint disabled:bg-subtle disabled:text-ink-faint aria-[invalid=true]:border-danger";
export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...p} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputBase, "pr-8", className)} {...p}>
      {children}
    </select>
  );
}

/* ---------- Checkbox (native, có nhãn) ---------- */
export function Checkbox({ checked, onChange, label, hint, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; className?: string }) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <span className="relative mt-0.5 inline-flex h-[18px] w-[18px] shrink-0">
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
        <span className="pointer-events-none flex h-full w-full items-center justify-center rounded border-2 border-line-strong bg-surface text-white peer-checked:border-teal peer-checked:bg-teal peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-info peer-disabled:opacity-50">
          {checked && <Check className="h-3 w-3" strokeWidth={3.5} aria-hidden />}
        </span>
      </span>
      <label htmlFor={id} className="cursor-pointer text-sm leading-[18px] text-ink">
        {label}
        {hint && <span className="mt-1 block text-xs leading-4 text-ink-faint">{hint}</span>}
      </label>
    </div>
  );
}

/* ---------- Switch ---------- */
export function Switch({ checked, onCheckedChange, label, id, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; id?: string; disabled?: boolean }) {
  return (
    <SW.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-6 w-11 shrink-0 cursor-pointer rounded-full border border-line-strong bg-line-strong transition-colors duration-150 data-[state=checked]:border-teal data-[state=checked]:bg-teal disabled:cursor-not-allowed disabled:opacity-50"
    >
      <SW.Thumb className="block h-[18px] w-[18px] translate-x-[2px] rounded-full bg-white shadow transition-transform duration-150 data-[state=checked]:translate-x-[22px]" />
    </SW.Root>
  );
}

/* ---------- Slider ---------- */
export function Slider({ value, onChange, min, max, step = 1, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label: string }) {
  return (
    <S.Root value={[value]} onValueChange={(v) => onChange(v[0] ?? min)} min={min} max={max} step={step} className="relative flex h-6 w-full touch-none select-none items-center">
      <S.Track className="relative h-1.5 grow rounded-full bg-line">
        <S.Range className="absolute h-full rounded-full bg-teal" />
      </S.Track>
      <S.Thumb aria-label={label} className="block h-5 w-5 rounded-full border-2 border-teal bg-white shadow hover:bg-teal-tint" />
    </S.Root>
  );
}

/* ---------- Tabs ---------- */
export function Tabs<V extends string>({ value, onValueChange, items, children, className }: { value: V; onValueChange: (v: V) => void; items: { value: V; label: ReactNode }[]; children?: ReactNode; className?: string }) {
  return (
    <T.Root value={value} onValueChange={(v) => onValueChange(v as V)} className={className}>
      <T.List className="flex gap-1 border-b border-line" aria-label="Chuyển mục">
        {items.map((i) => (
          <T.Trigger key={i.value} value={i.value} className="-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 border-transparent px-3.5 text-sm font-semibold text-ink-soft transition-colors hover:text-ink data-[state=active]:border-teal data-[state=active]:text-teal-ink">
            {i.label}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}
export const TabPanel = T.Content;

/* ---------- Segmented (chọn một, nhỏ gọn) ---------- */
export function Segmented<V extends string>({ value, onChange, items, label }: { value: V; onChange: (v: V) => void; items: { value: V; label: ReactNode }[]; label: string }) {
  return (
    <RadioGroup label={label} className="inline-flex rounded-md border border-line-strong bg-surface p-0.5">
      {items.map((i) => (
        <button key={i.value} type="button" role="radio" aria-checked={value === i.value} tabIndex={value === i.value ? 0 : -1} onClick={() => onChange(i.value)} className={cn("h-8 rounded px-3 text-sm font-semibold transition-colors", value === i.value ? "bg-navy text-white" : "text-ink-soft hover:bg-sky/60")}>
          {i.label}
        </button>
      ))}
    </RadioGroup>
  );
}

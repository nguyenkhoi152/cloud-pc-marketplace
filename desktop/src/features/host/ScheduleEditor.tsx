import { CalendarOff, CalendarPlus, Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { addDays, DAY_LABELS, DEMO_DATE, formatDateVi, parseHM, TIMEZONE_LABEL } from "@/domain/clock";
import { effectiveRanges, totalWeeklyMinutes, upcomingWindows, validateException, validateRanges, validateWeekly } from "@/domain/schedule";
import type { ScheduleException, TimeRange, WeeklySchedule } from "@/domain/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Field, Input, Segmented } from "@/ui/controls";
import { Banner } from "@/ui/feedback";

/** Thanh 24 giờ minh họa các khung hợp lệ của một ngày. */
function DayBar({ ranges }: { ranges: TimeRange[] }) {
  return (
    <div className="relative h-4 w-full rounded bg-line/70" aria-hidden>
      {ranges.map((r, i) => {
        const s = parseHM(r.start);
        const e = parseHM(r.end);
        if (s === null || e === null || e <= s) return null;
        return <span key={i} className="absolute top-0 h-full rounded bg-teal" style={{ left: `${(s / 1440) * 100}%`, width: `${((e - s) / 1440) * 100}%` }} />;
      })}
    </div>
  );
}

export function RangeEditor({ ranges, onChange, label }: { ranges: TimeRange[]; onChange: (r: TimeRange[]) => void; label: string }) {
  const issues = validateRanges(ranges);
  const upd = (i: number, p: Partial<TimeRange>) => onChange(ranges.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <div className="space-y-1.5">
      {ranges.length === 0 && <p className="text-sm text-ink-faint">Không cung cấp máy</p>}
      {ranges.map((r, i) => {
        const bad = issues.filter((x) => x.index === i);
        return (
          <div key={i}>
            <div className="flex items-center gap-2">
              <Input type="time" step={900} aria-label={`${label}: giờ bắt đầu khung ${i + 1}`} value={r.start} onChange={(e) => upd(i, { start: e.target.value })} className="w-[132px]" aria-invalid={bad.length > 0} />
              <span aria-hidden>–</span>
              <Input type="time" step={900} aria-label={`${label}: giờ kết thúc khung ${i + 1}`} value={r.end} onChange={(e) => upd(i, { end: e.target.value })} className="w-[132px]" aria-invalid={bad.length > 0} />
              <Button size="sm" variant="ghost" aria-label={`Xóa khung ${i + 1} của ${label}`} onClick={() => onChange(ranges.filter((_, k) => k !== i))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
            </div>
            {bad.map((b) => <p key={b.code} role="alert" className="mt-1 max-w-md text-xs font-semibold text-danger">{b.message}</p>)}
          </div>
        );
      })}
      <Button size="sm" variant="secondary" onClick={() => onChange([...ranges, { start: "19:00", end: "22:00" }])}><Plus className="h-3.5 w-3.5" aria-hidden />Thêm khung giờ</Button>
    </div>
  );
}

export function WeeklyEditor({ weekly, onChange }: { weekly: WeeklySchedule; onChange: (w: WeeklySchedule) => void }) {
  const all = validateWeekly(weekly);
  const set = (d: number, r: TimeRange[]) => onChange(weekly.map((x, i) => (i === d ? r : x)));
  const hours = Math.round((totalWeeklyMinutes(weekly) / 60) * 10) / 10;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">Múi giờ: <b>{TIMEZONE_LABEL}</b> (cố định, không đổi theo máy). Tổng <b className="num">{hours}</b> giờ/tuần.</p>
        <Button size="sm" variant="secondary" onClick={() => onChange(weekly.map((_, i) => (i < 5 ? structuredClone(weekly[0] ?? []) : weekly[i]!)))}><Copy className="h-3.5 w-3.5" aria-hidden />Chép giờ Thứ Hai sang T3–T6</Button>
      </div>
      <div className="mb-1 grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 px-4 text-[11px] text-ink-faint" aria-hidden>
        <span /><span className="flex justify-between"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></span>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {DAY_LABELS.map((d, i) => (
          <li key={d} className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-4 gap-y-2 px-4 py-3">
            <p className={cn("text-sm font-bold leading-4", all[i]!.length && "text-danger")}>{d}</p>
            <div className="min-w-[200px]"><DayBar ranges={weekly[i]!.filter((_, k) => !all[i]!.some((x) => x.index === k))} /></div>
            <div className="col-start-2"><RangeEditor ranges={weekly[i]!} onChange={(r) => set(i, r)} label={d} /></div>
          </li>
        ))}
      </ul>
      <Banner tone="info" className="mt-3">Lịch chỉ là giờ bạn <b>sẵn sàng</b> cho thuê. Lịch không tự bật máy: dịch vụ cung cấp phải đang chạy và máy phải online. Khách không thể đặt thuê định kỳ.</Banner>
    </div>
  );
}

export function ExceptionsEditor({ exceptions, onChange }: { exceptions: ScheduleException[]; onChange: (e: ScheduleException[]) => void }) {
  const [date, setDate] = useState(addDays(DEMO_DATE, 3));
  const [kind, setKind] = useState<"skip" | "custom">("skip");
  const [ranges, setRanges] = useState<TimeRange[]>([{ start: "20:00", end: "22:00" }]);
  const [err, setErr] = useState("");
  const sorted = [...exceptions].sort((a, b) => a.date.localeCompare(b.date));

  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr("Chọn ngày hợp lệ.");
    if (date < DEMO_DATE) return setErr("Không thể đặt ngoại lệ cho ngày đã qua.");
    if (exceptions.some((e) => e.date === date)) return setErr("Ngày này đã có ngoại lệ. Xóa ngoại lệ cũ trước.");
    if (kind === "custom") {
      if (ranges.length === 0) return setErr("Thêm ít nhất một khung giờ, hoặc chọn “Tạm bỏ cả ngày”.");
      if (validateRanges(ranges).length) return setErr("Sửa các lỗi giờ bên dưới trước khi thêm.");
    }
    setErr("");
    const id = `ex-${date}`;
    onChange([...exceptions, kind === "skip" ? { id, date, kind } : { id, date, kind, ranges }]);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-8">
      <div>
        <h3 className="mb-2 text-sm font-bold">Ngoại lệ đã đặt</h3>
        {sorted.length === 0 ? <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-faint">Chưa có ngoại lệ. Lịch tuần áp dụng cho mọi ngày.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {sorted.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex items-center gap-3">
                  {e.kind === "skip" ? <CalendarOff className="h-4 w-4 text-warn" aria-hidden /> : <CalendarPlus className="h-4 w-4 text-teal" aria-hidden />}
                  <div>
                    <p className="font-semibold">{formatDateVi(e.date)}</p>
                    <p className="text-xs text-ink-soft">{e.kind === "skip" ? "Tạm bỏ cả ngày — không nhận khách" : `Giờ riêng: ${e.ranges.map((r) => `${r.start}–${r.end}`).join(", ")}`}</p>
                    {validateException(e).length > 0 && <Badge tone="danger">Giờ không hợp lệ</Badge>}
                  </div>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Xóa ngoại lệ ${formatDateVi(e.date)}`} onClick={() => onChange(exceptions.filter((x) => x.id !== e.id))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="h-fit rounded-lg border border-line bg-surface p-4">
        <h3 className="mb-3 text-sm font-bold">Thêm ngoại lệ cho một ngày</h3>
        <div className="space-y-3">
          <Field label="Ngày" htmlFor="ex-date"><Input id="ex-date" type="date" min={DEMO_DATE} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Segmented label="Loại ngoại lệ" value={kind} onChange={setKind} items={[{ value: "skip", label: "Tạm bỏ cả ngày" }, { value: "custom", label: "Giờ riêng" }]} />
          {kind === "custom" && <RangeEditor ranges={ranges} onChange={setRanges} label="Ngoại lệ" />}
          {err && <p role="alert" className="text-xs font-semibold text-danger">{err}</p>}
          <Button variant="primary" className="w-full" onClick={add}>Thêm ngoại lệ</Button>
        </div>
      </div>
    </div>
  );
}

/** Xem trước 7 ngày tới theo lịch + ngoại lệ (giờ demo cố định). */
export function UpcomingPreview({ weekly, exceptions, days = 7 }: { weekly: WeeklySchedule; exceptions: ScheduleException[]; days?: number }) {
  const list = Array.from({ length: days }, (_, d) => {
    const date = addDays(DEMO_DATE, d);
    return { date, ...effectiveRanges(date, weekly, exceptions) };
  });
  const upcoming = upcomingWindows(weekly, exceptions, days);
  return (
    <div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
        {list.map((d) => {
          const bad = validateRanges(d.ranges).length > 0;
          const visible = upcoming.filter((u) => u.date === d.date);
          return (
            <li key={d.date} className="flex items-start justify-between gap-3 px-3.5 py-2">
              <span className="font-semibold">{d.date === DEMO_DATE ? "Hôm nay" : formatDateVi(d.date)}</span>
              <span className="text-right">
                {bad ? <Badge tone="danger">Lịch lỗi — bỏ qua</Badge> : visible.length === 0 ? <span className="text-ink-faint">{d.source === "skip" ? "Tạm bỏ" : "Không cung cấp"}</span> : visible.map((v) => <span key={v.start} className="num block">{v.start}–{v.end}{v.source === "custom" && " (riêng)"}</span>)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-xs text-ink-faint">Giờ {TIMEZONE_LABEL}. Khung đã trôi qua trong hôm nay không hiển thị.</p>
    </div>
  );
}

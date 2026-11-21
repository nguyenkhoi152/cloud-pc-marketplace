import { Save, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { getLiveApi } from "@/api";
import type { ScheduleRule } from "@/api/live";
import { addDays, formatDateVi } from "@/domain/clock";
import { diffRules, hasScheduleChanges, rulesToWeekly } from "@/domain/liveSchedule";
import { hasIssues } from "@/domain/schedule";
import { useAppStore } from "@/state/store";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Banner } from "@/ui/feedback";
import { WeeklyEditor } from "@/features/host/ScheduleEditor";

const TZ = "Asia/Ho_Chi_Minh";
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit" });
export interface ScheduleWindow {
  day: string;
  startsAt: string;
  endsAt: string;
}

/** 7 ngày tới theo lịch ĐÃ LƯU (do máy chủ tính), mỗi ngày một dòng: khung giờ hoặc "Không cung cấp". */
export function UpcomingWindows({ windows, today }: { windows: ScheduleWindow[]; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  return (
    <div data-testid="upcoming-windows">
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
        {days.map((d) => {
          const ws = windows.filter((w) => w.day === d);
          return (
            <li key={d} className="flex items-start justify-between gap-3 px-3.5 py-2">
              <span className="font-semibold">{d === today ? "Hôm nay" : formatDateVi(d)}</span>
              <span className="text-right">
                {ws.length === 0 ? <span className="text-ink-faint">Không cung cấp</span> : ws.map((w) => <span key={w.startsAt} className="num block">{timeOf(w.startsAt)}–{timeOf(w.endsAt)}</span>)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-xs text-ink-faint">Theo lịch đã lưu, giờ Asia/Ho_Chi_Minh (GMT+7).</p>
    </div>
  );
}

/**
 * Lịch nhận thuê hằng tuần của một máy: cùng bảng 7 ngày có thanh 24 giờ như bản xem trước, nối vào lịch thật.
 * Sửa tự do trên bản nháp rồi bấm "Lưu lịch": chỉ xóa/thêm đúng các khung thay đổi. Cần `key` đổi khi lịch trên máy chủ đổi
 * (để bản nháp nạp lại từ lịch đã lưu).
 */
export function WeeklySchedulePanel({ machineId, rules, windows, today, onSaved }: { machineId: string; rules: ScheduleRule[]; windows: ScheduleWindow[]; today: string; onSaved: () => void }) {
  const toast = useAppStore((s) => s.toast);
  const [weekly, setWeekly] = useState(() => rulesToWeekly(rules));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const dirty = useMemo(() => hasScheduleChanges(rules, weekly), [rules, weekly]);
  const invalid = useMemo(() => hasIssues(weekly, []), [weekly]);

  const save = async () => {
    setSaving(true);
    setErr("");
    const { remove, add } = diffRules(rules, weekly);
    const api = getLiveApi().host;
    try {
      // Xóa trước rồi mới thêm: các khung mới không bao giờ chồng lên khung cũ sắp bị bỏ.
      for (const id of remove) await api.removeRule(id);
      for (const a of add) await api.addRule(machineId, a.weekday, a.startMinute, a.endMinute);
      toast(`Đã lưu lịch nhận thuê (bỏ ${remove.length} khung, thêm ${add.length} khung).`, "ok");
      onSaved();
    } catch (e) {
      // Có thể đã ghi được một phần: tải lại lịch thật để màn hình không nói sai.
      setErr(`${(e as Error).message} Lịch trên máy chủ có thể đã thay đổi một phần; màn hình đang nạp lại lịch thật.`);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div>
        <WeeklyEditor weekly={weekly} onChange={setWeekly} />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty || invalid || saving}>
            <Save className="h-4 w-4" aria-hidden />Lưu lịch
          </Button>
          <Button variant="secondary" onClick={() => setWeekly(rulesToWeekly(rules))} disabled={!dirty || saving}>
            <Undo2 className="h-4 w-4" aria-hidden />Hoàn tác
          </Button>
          {dirty && !invalid && <Badge tone="warn" icon={false}>Có thay đổi chưa lưu</Badge>}
          {invalid && <span role="alert" className="text-sm font-semibold text-danger">Sửa các lỗi màu đỏ trước khi lưu.</span>}
        </div>
        {err && <Banner tone="danger" className="mt-3" title="Chưa lưu được lịch">{err}</Banner>}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-bold">Khung nhận thuê 7 ngày tới</h3>
        <UpcomingWindows windows={windows} today={today} />
      </div>
    </div>
  );
}

/**
 * Mục "Chia sẻ cho khách" của màn Thiết lập & chạy máy: chủ máy chọn cho khách dùng TỐI ĐA bao nhiêu RAM và CPU của bản Linux.
 * Luôn hiện (cả trước khi bắt đầu lẫn khi đang chạy), vì trước đây khối này nằm trong bước "Bắt đầu nhận thuê" và biến mất khi dịch vụ đã chạy.
 * Mức chọn áp dụng ở lần bắt đầu tới; khi đang chạy, dòng "Đang áp dụng" đọc từ cấu hình thật của dịch vụ để chủ máy thấy đúng thứ khách đang được dùng.
 */
import type { GuestProbe } from "@/domain/hostEnv";
import { cpuChoices, limitWarning, ramChoicesGb, type Limits } from "@/domain/hostLimits";
import { Field, Select } from "@/ui/controls";
import { Banner } from "@/ui/feedback";
import { Section } from "@/ui/page";

const gb = (n: number) => (Number.isInteger(n) ? `${n} GB` : `${n.toFixed(1)} GB`);

/** "RAM 8 GB · CPU 4", hoặc "không giới hạn" cho phần chưa chọn. */
export function limitsSummary(l: Limits): string {
  return `RAM ${l.ramGb ? gb(l.ramGb) : "không giới hạn"} · CPU ${l.cpus ? l.cpus : "không giới hạn"}`;
}

/** Mức đang áp dụng cho container khách khi dịch vụ chạy; null nếu dịch vụ chưa chạy. Thiếu khoá cấu hình nghĩa là không giới hạn. */
export function appliedLimits(probe: GuestProbe | null, agentRunning: boolean): Limits | null {
  if (!agentRunning || !probe) return null;
  return { ramGb: probe.appliedMemoryMb ? probe.appliedMemoryMb / 1024 : null, cpus: probe.appliedCpus };
}

/** Mức chọn khác mức đang áp dụng? (chỉ có nghĩa khi dịch vụ đang chạy) */
export function limitsDiffer(chosen: Limits, applied: Limits | null): boolean {
  if (!applied) return false;
  return (chosen.ramGb ?? null) !== (applied.ramGb ?? null) || (chosen.cpus ?? null) !== (applied.cpus ?? null);
}

export function ShareLimits({ probe, limits, onChange, agentRunning }: { probe: GuestProbe | null; limits: Limits; onChange: (l: Limits) => void; agentRunning: boolean }) {
  const applied = appliedLimits(probe, agentRunning);
  return (
    <Section title="Chia sẻ cho khách" bordered className="mt-4">
      <div className="space-y-3" data-testid="limits">
        <p className="text-sm text-ink-soft">Chọn bạn cho khách dùng tối đa bao nhiêu RAM và CPU của bản Linux. Con số này hiện trên thẻ máy để người thuê biết họ được dùng bao nhiêu.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="RAM tối đa" htmlFor="hs-ram" hint={probe?.memTotalMb ? `Bản Linux có ${(probe.memTotalMb / 1024).toFixed(1)} GB` : "Chưa đọc được RAM"}>
            <Select id="hs-ram" value={limits.ramGb ?? ""} onChange={(e) => onChange({ ...limits, ramGb: e.target.value ? Number(e.target.value) : null })} className="w-40">
              <option value="">Không giới hạn</option>
              {ramChoicesGb(probe?.memTotalMb ?? null).map((g) => <option key={g} value={g}>{g} GB</option>)}
            </Select>
          </Field>
          <Field label="CPU tối đa" htmlFor="hs-cpu" hint={probe?.cpuCount ? `Bản Linux có ${probe.cpuCount} CPU` : "Chưa đọc được số CPU"}>
            <Select id="hs-cpu" value={limits.cpus ?? ""} onChange={(e) => onChange({ ...limits, cpus: e.target.value ? Number(e.target.value) : null })} className="w-40">
              <option value="">Không giới hạn</option>
              {cpuChoices(probe?.cpuCount ?? null).map((c) => <option key={c} value={c}>{c} CPU</option>)}
            </Select>
          </Field>
        </div>
        {limitWarning(limits) && <p className="text-xs text-warn">{limitWarning(limits)}</p>}
        {applied ? (
          <p className="text-sm" data-testid="limits-applied">Đang áp dụng cho khách: <b>{limitsSummary(applied)}</b></p>
        ) : (
          <p className="text-sm text-ink-soft" data-testid="limits-applied">Chưa nhận thuê. Mức bạn chọn ({limitsSummary(limits)}) sẽ áp dụng ở lần bắt đầu nhận thuê tới.</p>
        )}
        {limitsDiffer(limits, applied) && (
          <Banner tone="warn" title="Mức bạn chọn khác mức đang áp dụng">Dịch vụ đang chạy với mức ở dòng trên. Bấm Dừng nhận thuê rồi Bắt đầu nhận thuê lại để áp dụng mức mới.</Banner>
        )}
        <p className="text-xs text-ink-faint">RAM tính cả bộ nhớ đệm swap. Chưa giới hạn được dung lượng đĩa.</p>
      </div>
    </Section>
  );
}

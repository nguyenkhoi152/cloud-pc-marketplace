import { Coins, Cpu, Server } from "lucide-react";
import { useState } from "react";
import { getLiveApi } from "@/api";
import { formatUnits, type HostMachine } from "@/api/live";
import { Link, navigate } from "@/app/router";
import { specsSummary } from "@/domain/machineSpecs";
import { useAsync } from "@/state/useAsync";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Field, Select } from "@/ui/controls";
import { Async, EmptyState } from "@/ui/feedback";
import { PageHeader, Section, StatTile } from "@/ui/page";
import { WeeklySchedulePanel } from "./WeeklySchedulePanel";

const TZ = "Asia/Ho_Chi_Minh";
const STATUS: Record<HostMachine["status"], { text: string; tone: "neutral" | "warn" | "ok" }> = {
  draft: { text: "Nháp", tone: "neutral" },
  review: { text: "Đang chờ", tone: "warn" },
  approved: { text: "Đã đăng", tone: "ok" },
  suspended: { text: "Bị tạm khóa", tone: "warn" },
};

/** Lịch tuần và 7 ngày tới của một máy (dữ liệu thật). */
function MachineSchedule({ machine }: { machine: HostMachine }) {
  const sched = useAsync(async () => {
    const api = getLiveApi().host;
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
    const end = new Date(Date.now() + 6 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: TZ });
    const [rules, windows] = await Promise.all([api.listRules(machine.id), api.windows(machine.id, today, end)]);
    return { rules, windows, today };
  }, [machine.id]);
  return (
    <Async state={sched} skeleton={<p className="text-sm text-ink-faint">Đang tải lịch…</p>}>
      {(d) => (
        <WeeklySchedulePanel key={d.rules.map((r) => `${r.id}:${r.weekday}:${r.startMinute}:${r.endMinute}`).join(",")} machineId={machine.id} rules={d.rules} windows={d.windows} today={d.today} onSaved={sched.retry} />
      )}
    </Async>
  );
}

function ConfigureBody({ list, selected, onSelect }: { list: HostMachine[]; selected: string; onSelect: (id: string) => void }) {
  const m = list.find((x) => x.id === selected) ?? list[0]!;
  const st = STATUS[m.status];
  const specs = specsSummary(m.specs);
  return (
    <div className="space-y-6">
      {list.length > 1 && (
        <Field label="Máy" htmlFor="cfg-machine" className="max-w-sm">
          <Select id="cfg-machine" value={m.id} onChange={(e) => onSelect(e.target.value)}>
            {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <StatTile index={0} icon={Server} label="Máy" value={m.name} hint={<Badge tone={st.tone} icon={false}>{st.text}</Badge>} />
        <StatTile index={1} icon={Coins} label="Giá mỗi gói 15 phút" value={<>{formatUnits(m.priceUnits)} <span className="text-base font-medium text-ink-faint">PCP</span></>} hint="Đã gồm phí nền tảng. Giá được đặt khi tạo máy." />
        <StatTile index={2} icon={Cpu} label="Cấu hình chia sẻ" value={<span className="text-sm font-semibold leading-snug">{specs ?? "Chưa đọc từ máy"}</span>} hint={<>Số nhân và RAM chia sẻ đổi ở <Link to="/host/setup" className="rounded font-semibold text-teal-ink hover:underline">Thiết lập & chạy máy</Link>.</>} />
      </div>
      <Section title="Lịch nhận thuê hằng tuần">
        <MachineSchedule key={m.id} machine={m} />
      </Section>
    </div>
  );
}

/** Màn "Tài nguyên, giá & lịch" ở chế độ thật: chọn máy, xem giá và cấu hình, đặt lịch tuần. */
export function LiveConfigure() {
  const machines = useAsync(() => getLiveApi().host.listMachines(), []);
  const [sel, setSel] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Tài nguyên, giá & lịch" subtitle="Cấu hình người thuê sẽ thấy, giá mỗi gói và những giờ bạn sẵn sàng nhận thuê." />
      <Async
        state={machines}
        isEmpty={(l) => l.length === 0}
        empty={<EmptyState icon={Server} title="Bạn chưa có máy nào" action={<Button variant="primary" onClick={() => navigate("/host")}>Thêm máy</Button>}>Thêm máy ở mục Máy của tôi, rồi quay lại đây để đặt lịch nhận thuê.</EmptyState>}
      >
        {(list) => <ConfigureBody list={list} selected={sel ?? list[0]!.id} onSelect={setSel} />}
      </Async>
    </>
  );
}

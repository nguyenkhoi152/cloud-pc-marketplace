import { ArrowUpDown, Cpu, FolderCheck, GitCompareArrows, Gamepad2, Palette, Search, Terminal, X } from "lucide-react";
import { useMemo } from "react";
import { Link, navigate } from "@/app/router";
import { filterMachines } from "@/domain/filters";
import type { Category, Machine } from "@/domain/types";
import { LOCATIONS } from "@/mock/fixtures";
import { service } from "@/api";
import { isLive } from "@/api/env";
import { useFilters } from "@/state/filtersStore";
import { useAppStore } from "@/state/store";
import { useAsync } from "@/state/useAsync";
import { Button } from "@/ui/button";
import { Checkbox, Input, Select, Tabs } from "@/ui/controls";
import { Async, EmptyState, SkeletonRows } from "@/ui/feedback";
import { PageHeader } from "@/ui/page";
import { MachineStateBadge } from "@/ui/status";
import { Badge, DemoTag } from "@/ui/badge";
import { CATEGORY_LABEL, rentability } from "./machineFormat";

const TAB_ICON: Record<Category, typeof Gamepad2> = { game: Gamepad2, graphics: Palette, dev: Terminal };

export function Discover() {
  const { filters, set, reset } = useFilters();
  const compare = useAppStore((s) => s.compare);
  const toggle = useAppStore((s) => s.toggleCompare);
  const toast = useAppStore((s) => s.toast);
  const state = useAsync(() => service.listMachines());
  const live = isLive();
  // Live: vị trí lấy từ dữ liệu thật (không dùng danh sách mẫu).
  const locations = useMemo(() => (live && state.status === "ready" ? [...new Set(state.data.map((m) => m.location))].sort() : LOCATIONS), [live, state]);

  const list = useMemo(() => (state.status === "ready" ? filterMachines(state.data, filters) : []), [state, filters]);
  const dirty = filters.query || filters.maxPrice !== null || filters.minRam || filters.minVram || filters.location !== "all" || filters.workspaceOnly || filters.rentableNow;

  return (
    <div className={compare.length ? "pb-16" : ""}>
      <PageHeader
        title="Khám phá máy"
        subtitle={<>Chọn theo nhu cầu rồi lọc theo cấu hình, giá và khung giờ. Mọi máy, giá, trạng thái online và ứng dụng đều là <DemoTag /> .</>}
      />
      <Tabs
        value={filters.category}
        onValueChange={(v) => set({ category: v as typeof filters.category })}
        items={[
          ...(live ? [{ value: "all", label: <>Tất cả</> }] : []),
          ...(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => {
            const Icon = TAB_ICON[c];
            return { value: c, label: <><Icon className="h-4 w-4" aria-hidden />{CATEGORY_LABEL[c]}</> };
          }),
        ]}
      />

      <form role="search" aria-label="Lọc danh sách máy" onSubmit={(e) => e.preventDefault()} className="mt-4 grid grid-cols-[minmax(180px,1.6fr)_repeat(4,minmax(96px,1fr))] items-end gap-3">
        <label className="relative col-span-1">
          <span className="sr-only">Tìm theo tên, GPU, ứng dụng</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-faint" aria-hidden />
          <Input placeholder="Tìm tên máy, GPU, game…" value={filters.query} onChange={(e) => set({ query: e.target.value })} className="pl-8" />
        </label>
        <label className="text-xs font-semibold text-ink-soft">Giá tối đa / 15′
          <Select value={filters.maxPrice ?? ""} onChange={(e) => set({ maxPrice: e.target.value === "" ? null : Number(e.target.value) })} className="mt-1 font-normal">
            <option value="">Không giới hạn</option>
            {[8, 12, 20, 30, 45].map((p) => <option key={p} value={p}>≤ {p} PCP</option>)}
          </Select>
        </label>
        <label className="text-xs font-semibold text-ink-soft">RAM tối thiểu
          <Select value={filters.minRam} onChange={(e) => set({ minRam: Number(e.target.value) })} className="mt-1 font-normal">
            {[0, 16, 32, 64].map((v) => <option key={v} value={v}>{v ? `≥ ${v} GB` : "Bất kỳ"}</option>)}
          </Select>
        </label>
        <label className="text-xs font-semibold text-ink-soft">VRAM tối thiểu
          <Select value={filters.minVram} onChange={(e) => set({ minVram: Number(e.target.value) })} className="mt-1 font-normal">
            {[0, 6, 12, 16, 24].map((v) => <option key={v} value={v}>{v ? `≥ ${v} GB` : "Bất kỳ"}</option>)}
          </Select>
        </label>
        <label className="text-xs font-semibold text-ink-soft">Vị trí host
          <Select value={filters.location} onChange={(e) => set({ location: e.target.value })} className="mt-1 font-normal">
            <option value="all">Mọi nơi</option>
            {locations.map((l) => <option key={l}>{l}</option>)}
          </Select>
        </label>
      </form>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-5">
          <Checkbox checked={filters.workspaceOnly} onChange={(v) => set({ workspaceOnly: v })} label="Hỗ trợ lưu workspace" />
          {!live && <Checkbox checked={filters.rentableNow} onChange={(v) => set({ rentableNow: v })} label="Thuê được ngay bây giờ" />}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden /> Sắp xếp
            <Select value={filters.sort} onChange={(e) => set({ sort: e.target.value as typeof filters.sort })} className="h-8 w-44 text-xs font-normal">
              <option value="price">Giá thấp → cao</option>
              <option value="ram">RAM cao → thấp</option>
              <option value="vram">VRAM cao → thấp</option>
              {!live && <option value="window">Thời gian thuê được dài nhất</option>}
            </Select>
          </label>
          {dirty ? <Button variant="ghost" size="sm" onClick={() => reset()}><X className="h-3.5 w-3.5" aria-hidden /> Xóa lọc</Button> : null}
        </div>
      </div>

      <p className="mt-3 text-sm text-ink-soft" aria-live="polite">
        {state.status === "ready" ? <>Hiển thị <b className="num text-ink">{list.length}</b> / {state.data.length} máy trong danh mục <b>{filters.category === "all" ? "Tất cả" : CATEGORY_LABEL[filters.category as Category]}</b>. Tích ô “So sánh” ở 2–3 máy để xem cạnh nhau.</> : " "}
      </p>

      <div className="mt-2">
        <Async
          state={state}
          skeleton={<SkeletonRows rows={5} />}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState icon={Cpu} title="Chưa có máy nào được đăng">{live ? "Chưa có máy nào được admin duyệt." : "Trong kịch bản này, danh sách máy đang trống."} Khi có host được duyệt, máy sẽ hiện ở đây.</EmptyState>}
        >
          {() =>
            list.length === 0 ? (
              <EmptyState icon={Search} title="Không có máy phù hợp bộ lọc" action={<Button onClick={() => reset()}>Xóa bộ lọc</Button>}>
                Thử nới giá, VRAM hoặc đổi sang danh mục khác.
              </EmptyState>
            ) : (
              <MachineTable machines={list} compare={compare} onToggle={(id) => { if (!toggle(id)) toast("Chỉ so sánh tối đa 3 máy cùng lúc.", "warn"); }} />
            )
          }
        </Async>
      </div>

      {compare.length > 0 && (
        <div className="fixed bottom-0 left-[216px] right-0 z-30 flex items-center justify-between gap-3 border-t border-line bg-surface px-6 py-3 lg:left-[232px]">
          <p className="text-sm"><b className="num">{compare.length}</b> máy đã chọn để so sánh{compare.length < 2 && " — chọn thêm ít nhất 1 máy"}.</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => useAppStore.getState().clearCompare()}>Bỏ chọn</Button>
            <Button variant="primary" disabled={compare.length < 2} onClick={() => navigate("/rent/compare")}><GitCompareArrows className="h-4 w-4" aria-hidden /> So sánh {compare.length} máy</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MachineTable({ machines, compare, onToggle }: { machines: Machine[]; compare: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <caption className="sr-only">Danh sách máy cho thuê (dữ liệu mô phỏng)</caption>
        <thead className="border-b border-line bg-subtle text-xs text-ink-faint">
          <tr>
            <th scope="col" className="w-[84px] px-3 py-2 font-semibold">So sánh</th>
            <th scope="col" className="px-3 py-2 font-semibold">Máy</th>
            <th scope="col" className="w-[24%] px-3 py-2 font-semibold">Cấu hình</th>
            <th scope="col" className="w-[104px] px-3 py-2 text-right font-semibold">Giá / 15′</th>
            <th scope="col" className="w-[21%] px-3 py-2 font-semibold">Khung giờ thuê</th>
            <th scope="col" className="w-[116px] px-3 py-2 font-semibold">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => {
            const r = rentability(m);
            return (
              <tr key={m.id} className="border-b border-line last:border-0 hover:bg-subtle/70">
                <td className="px-3 py-3 align-top">
                  <Checkbox checked={compare.includes(m.id)} onChange={() => onToggle(m.id)} label={<span className="sr-only">So sánh {m.name}</span>} />
                </td>
                <td className="px-3 py-3 align-top">
                  <Link to={`/rent/machine/${m.id}`} className="rounded font-bold text-ink hover:text-teal-dark hover:underline">{m.name}</Link>
                  <p className="text-xs text-ink-faint">{m.hostAlias} · {m.location}</p>
                  <p className="mt-1">{m.workspace ? <Badge tone="teal" icon={FolderCheck}>Lưu workspace</Badge> : <span className="text-xs text-ink-faint">Không lưu workspace</span>}</p>
                </td>
                <td className="px-3 py-3 align-top text-xs leading-5">
                  <p className="num">{m.cores} nhân · {m.ramGb} GB RAM</p>
                  <p className="num">{m.gpu ? `${m.gpu.replace("NVIDIA ", "").replace("AMD ", "")} · ${m.vramGb} GB` : "Không GPU"}</p>
                </td>
                <td className="px-3 py-3 text-right align-top"><span className="num text-base font-bold">{m.pricePer15}</span><span className="block text-[11px] text-ink-faint">PCP thử</span></td>
                <td className="px-3 py-3 align-top text-xs leading-5"><p className="font-semibold">{r.text}</p>{r.sub && <p className="text-ink-faint">{r.sub}</p>}</td>
                <td className="px-3 py-3 align-top"><MachineStateBadge state={m.state} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


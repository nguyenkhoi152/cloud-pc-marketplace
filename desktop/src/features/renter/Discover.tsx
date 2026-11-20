import { ArrowUpDown, Cpu, GitCompareArrows, Gamepad2, Palette, Search, Terminal, X } from "lucide-react";
import { useMemo } from "react";
import { navigate } from "@/app/router";
import { filterMachines } from "@/domain/filters";
import type { Category, Machine } from "@/domain/types";
import { LOCATIONS } from "@/mock/fixtures";
import { service } from "@/api";
import { isLive } from "@/api/env";
import { useFilters } from "@/state/filtersStore";
import { useAppStore } from "@/state/store";
import { useAsync } from "@/state/useAsync";
import { usePolling } from "@/state/usePolling";
import { Button } from "@/ui/button";
import { Checkbox, Input, Select, Tabs } from "@/ui/controls";
import { Async, EmptyState } from "@/ui/feedback";
import { PageHeader } from "@/ui/page";
import { MachineCard } from "./MachineCard";
import { DemoTag } from "@/ui/badge";
import { CATEGORY_LABEL } from "./machineFormat";

const LIST_REFRESH_MS = 10_000;
const TAB_ICON: Record<Category, typeof Gamepad2> = { game: Gamepad2, graphics: Palette, dev: Terminal };

export function Discover() {
  const { filters, set, reset } = useFilters();
  const compare = useAppStore((s) => s.compare);
  const toggle = useAppStore((s) => s.toggleCompare);
  const toast = useAppStore((s) => s.toast);
  const live = isLive();
  // Live: làm mới danh sách nền mỗi 10 giây để máy chủ máy vừa dừng/đăng xuất chuyển offline kịp thời (dữ liệu cũ được giữ nên thẻ không nháy).
  const tick = usePolling(LIST_REFRESH_MS, live);
  const state = useAsync(() => service.listMachines(), [tick], { keepDataOnError: true });
  // Live: vị trí lấy từ dữ liệu thật (không dùng danh sách mẫu).
  const locations = useMemo(() => (live && state.status === "ready" ? [...new Set(state.data.map((m) => m.location))].sort() : LOCATIONS), [live, state]);

  const list = useMemo(() => (state.status === "ready" ? filterMachines(state.data, filters) : []), [state, filters]);
  const dirty = filters.query || filters.maxPrice !== null || filters.minRam || filters.minVram || filters.location !== "all" || filters.workspaceOnly || filters.rentableNow || (live && !filters.hideOffline);
  // Máy khớp mọi bộ lọc khác nhưng đang bị ẩn vì offline (để nói rõ cho người thuê, không để họ tưởng danh mục trống).
  const hiddenOffline = useMemo(
    () => (state.status === "ready" && filters.hideOffline ? filterMachines(state.data, { ...filters, hideOffline: false }).length - list.length : 0),
    [state, filters, list],
  );

  return (
    <div className={compare.length ? "pb-16" : ""}>
      <PageHeader
        title="Khám phá máy"
        subtitle={live ? <>Chọn theo nhu cầu rồi lọc theo cấu hình và giá. Thông số do chủ máy cung cấp; trạng thái online được cập nhật liên tục.</> :<>Chọn theo nhu cầu rồi lọc theo cấu hình, giá và khung giờ. Mọi máy, giá, trạng thái online và ứng dụng đều là <DemoTag /> .</>}
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
          {live && <Checkbox checked={!filters.hideOffline} onChange={(v) => set({ hideOffline: !v })} label="Hiện cả máy đang offline" />}
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
        {state.status === "ready" ? <>Hiển thị <b className="num text-ink">{list.length}</b> / {state.data.length} máy trong danh mục <b>{filters.category === "all" ? "Tất cả" : CATEGORY_LABEL[filters.category as Category]}</b>.{hiddenOffline > 0 && <> Đang ẩn <b className="num text-ink">{hiddenOffline}</b> máy offline.</>} Tích ô “So sánh” ở 2–3 máy để xem cạnh nhau.</> : " "}
      </p>

      <div className="mt-2">
        <Async
          state={state}
          skeleton={<SkeletonCards />}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState icon={Cpu} title="Chưa có máy nào được đăng">{live ? "Chưa có máy nào được đăng." : "Trong kịch bản này, danh sách máy đang trống."} Khi có host đăng máy, máy sẽ hiện ở đây.</EmptyState>}
        >
          {() =>
            list.length === 0 && hiddenOffline > 0 ? (
              <EmptyState icon={Cpu} title="Hiện chưa có máy nào online" action={<Button onClick={() => set({ hideOffline: false })}>Hiện cả máy đang offline</Button>}>
                Có {hiddenOffline} máy khớp bộ lọc nhưng đang offline (chủ máy chưa bật nhận thuê). Máy tự hiện lại ngay khi chủ máy online.
              </EmptyState>
            ) : list.length === 0 ? (
              <EmptyState icon={Search} title="Không có máy phù hợp bộ lọc" action={<Button onClick={() => reset()}>Xóa bộ lọc</Button>}>
                Thử nới giá, VRAM hoặc đổi sang danh mục khác.
              </EmptyState>
            ) : (
              <MachineGrid machines={list} compare={compare} onToggle={(id) => { if (!toggle(id)) toast("Chỉ so sánh tối đa 3 máy cùng lúc.", "warn"); }} />
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

/** Lưới thẻ máy: tự chia cột theo bề rộng (≥ 300px mỗi thẻ). */
function MachineGrid({ machines, compare, onToggle }: { machines: Machine[]; compare: string[]; onToggle: (id: string) => void }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4" aria-label={isLive() ? "Danh sách máy cho thuê" : "Danh sách máy cho thuê (dữ liệu mô phỏng)"}>
      {machines.map((m, i) => (
        <li key={m.id} className="min-w-0">
          <MachineCard m={m} index={i} compared={compare.includes(m.id)} onToggle={onToggle} />
        </li>
      ))}
    </ul>
  );
}

/** Khung chờ dạng thẻ (cùng bố cục lưới) trong lúc tải danh sách. */
function SkeletonCards() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4" aria-hidden>
      {[0, 1, 2].map((i) => <div key={i} className="pulse-dot h-80 rounded-xl bg-sky/60" />)}
    </div>
  );
}

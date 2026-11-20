/**
 * Thẻ máy trong danh sách "Khám phá máy": tiêu đề + trạng thái, các dòng cấu hình (GPU, VRAM, CPU, RAM, ổ đĩa, mạng),
 * chân thẻ có giá và nút Chi tiết. Bố cục theo mẫu chợ thuê GPU nhưng dùng bảng màu sáng của app (nền trắng, dải đầu/chân xanh nhạt, nút teal).
 * Chỉ hiển thị dữ liệu có thật: không có "điểm tin cậy" hay tốc độ mạng bịa; dòng nào thiếu số liệu thì ẩn.
 */
import { Activity, CircleHelp, Info, TriangleAlert, Wifi, WifiOff, type LucideIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Link, navigate } from "@/app/router";
import { isLive } from "@/api/env";
import { cn, stagger } from "@/lib/utils";
import type { Machine, MachineState } from "@/domain/types";
import { Checkbox } from "@/ui/controls";
import { CATEGORY_LABEL, rentability } from "./machineFormat";

interface Indicator {
  icon: LucideIcon;
  text: string;
  cls: string;
  pulse?: boolean;
}
/** Trạng thái ở góc phải thẻ (thay cho "điểm" trong mẫu): biểu tượng + chữ, không chỉ dựa vào màu. */
export function indicatorOf(state: MachineState): Indicator {
  switch (state) {
    case "online":
      return { icon: Wifi, text: "Online", cls: "text-ok", pulse: true };
    case "available":
      return { icon: Wifi, text: "Sẵn sàng", cls: "text-ok" };
    case "busy":
      return { icon: Activity, text: "Đang có phiên", cls: "text-info" };
    case "offline":
      return { icon: WifiOff, text: "Offline", cls: "text-ink-faint" };
    case "blocked":
      return { icon: TriangleAlert, text: "Đang xử lý sự cố", cls: "text-warn" };
    default:
      return { icon: CircleHelp, text: "Chưa xác minh", cls: "text-ink-faint" };
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-ink">{children}</dd>
    </>
  );
}
const Muted = ({ children }: { children: ReactNode }) => <span className="ml-1.5 font-normal text-ink-faint">{children}</span>;

/**
 * Bấm vào NỀN thẻ thì mở chi tiết; bấm vào liên kết, nút, ô So sánh (tự xử lý) hoặc đang bôi đen chữ để sao chép thì không.
 * Tách riêng để kiểm thử được.
 */
export function isCardBackgroundClick(target: { closest(selector: string): unknown } | null, selection: string): boolean {
  if (!target) return false;
  if (target.closest("a,button,input,label,select,textarea")) return false;
  return selection.trim() === "";
}

export function MachineCard({ m, index, compared, onToggle }: { m: Machine; index: number; compared: boolean; onToggle: (id: string) => void }) {
  const live = isLive();
  const r = rentability(m);
  const ind = indicatorOf(m.state);
  const gpu = m.gpu ? m.gpu.replace("NVIDIA ", "").replace("AMD ", "") : null;
  const detail = `/rent/machine/${m.id}`;
  // Cả thẻ là một vùng bấm: người dùng chuột bấm đâu cũng mở được; người dùng bàn phím vẫn có liên kết tên máy và nút Chi tiết.
  const open = (e: MouseEvent<HTMLElement>) => {
    if (isCardBackgroundClick(e.target as Element, window.getSelection()?.toString() ?? "")) navigate(detail);
  };
  return (
    <article onClick={open} className="group enter lift flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-[0_1px_2px_rgb(11_31_58/0.05)] hover:border-teal" style={stagger(index)} data-testid="machine-card" aria-label={m.name}>
      <header className="flex items-start justify-between gap-3 border-b border-line bg-subtle px-5 py-4 transition-colors group-hover:bg-teal-tint/60">
        <div className="min-w-0">
          <h3 className="line-clamp-2 break-words text-lg font-bold leading-tight">
            <Link to={detail} className="rounded transition-colors group-hover:text-teal-dark">{m.name}</Link>
          </h3>
          <p className="mt-0.5 truncate text-xs text-ink-faint">{m.hostAlias} · {m.location}</p>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold", ind.cls)} data-testid="machine-state">
          <ind.icon className={cn("h-4 w-4", ind.pulse && "pulse-dot")} aria-hidden />
          {ind.text}
        </span>
      </header>

      <div className="flex-1 px-5 py-4">
        <p className="mb-3 line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-ink-soft" data-testid="machine-summary">{m.summary}</p>
        <dl className="grid grid-cols-[48px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[15px]" data-testid="machine-specs-list">
          <Row label="GPU">{gpu ?? <span className="font-normal text-ink-faint">Không có GPU rời</span>}</Row>
          {gpu && <Row label="VRAM">{m.vramGb ? `${m.vramGb} GB` : <span className="font-normal text-ink-faint">Chưa rõ</span>}</Row>}
          <Row label="CPU">{m.cpu ? <>{m.cpu}<Muted>{m.cores} nhân</Muted></> : `${m.cores} nhân`}</Row>
          <Row label="RAM">{m.ramGb} GB</Row>
          {m.storageGb > 0 && <Row label="Disk">{m.storageGb} GB<Muted>trống</Muted></Row>}
          {m.networkMbps > 0 && <Row label="Net">{m.networkMbps} Mbps{!live && <Muted>mô phỏng</Muted>}</Row>}
        </dl>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.categories.map((c) => <span key={c} className="rounded-full bg-sky/70 px-2.5 py-0.5 text-xs font-semibold text-ink-soft">{CATEGORY_LABEL[c]}</span>)}
          {m.workspace && <span className="rounded-full bg-teal-tint px-2.5 py-0.5 text-xs font-semibold text-teal-dark">Lưu workspace</span>}
        </div>
        <p className="mt-3 text-xs text-ink-faint"><b className="font-semibold text-ink">{r.text}</b>{r.sub ? ` · ${r.sub}` : ""}</p>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-line bg-subtle px-5 py-4 transition-colors group-hover:bg-teal-tint/60">
        <p className="min-w-0">
          <span className="num text-2xl font-bold text-teal-dark" data-testid="machine-price">{m.pricePer15}</span>
          <span className="ml-1.5 text-sm text-ink-faint">{live ? "PCP" : "PCP thử"} / 15 phút</span>
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <Checkbox
            checked={compared}
            onChange={() => onToggle(m.id)}
            label={<><span className="sr-only">So sánh {m.name}</span><span aria-hidden className="text-xs text-ink-soft">So sánh</span></>}
          />
          <Link to={detail} aria-label={`Chi tiết ${m.name}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-teal px-3.5 text-sm font-semibold text-white transition-colors group-hover:bg-teal-dark">
            Chi tiết <Info className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </footer>
    </article>
  );
}

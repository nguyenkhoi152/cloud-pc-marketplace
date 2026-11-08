import { Check, Clock, GitCompareArrows, Info, MapPin, ShieldQuestion } from "lucide-react";
import { navigate } from "@/app/router";
import { addDays, DEMO_DATE, formatDateVi, formatDuration, TIMEZONE_LABEL } from "@/domain/clock";
import { currentWindow, maxBookableMinutes } from "@/domain/pricing";
import type { Machine } from "@/domain/types";
import { service } from "@/mock/service";
import { useAppStore } from "@/state/store";
import { useAsync } from "@/state/useAsync";
import { Badge, DemoTag } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Async, Banner, EmptyState } from "@/ui/feedback";
import { KeyValue, PageHeader, Section } from "@/ui/page";
import { MachineStateBadge, SupportBadge } from "@/ui/status";
import { CATEGORY_LABEL, rentability } from "./machineFormat";

/* ===================== So sánh ===================== */
export function Compare() {
  const ids = useAppStore((s) => s.compare);
  const toggle = useAppStore((s) => s.toggleCompare);
  const state = useAsync(() => service.listMachines());
  return (
    <>
      <PageHeader title="So sánh máy" crumbs={[{ label: "Khám phá máy", to: "/rent/discover" }, { label: "So sánh" }]} subtitle="Giá trị tốt nhất ở mỗi hàng được đánh dấu bằng ✓. Dữ liệu mô phỏng." />
      <Async state={state} isEmpty={() => ids.length < 2} empty={<EmptyState icon={GitCompareArrows} title="Chưa chọn đủ máy để so sánh" action={<Button variant="primary" onClick={() => navigate("/rent/discover")}>Về danh sách máy</Button>}>Chọn ít nhất 2 máy ở trang Khám phá.</EmptyState>}>
        {(all) => {
          const ms = ids.map((id) => all.find((m) => m.id === id)).filter((m): m is Machine => !!m);
          const best = (f: (m: Machine) => number, dir: "min" | "max") => {
            const vals = ms.map(f);
            return dir === "min" ? Math.min(...vals) : Math.max(...vals);
          };
          const rows: { label: string; render: (m: Machine) => React.ReactNode; best?: (m: Machine) => boolean }[] = [
            { label: "Giá / 15 phút", render: (m) => <b className="num">{m.pricePer15} PCP thử</b>, best: (m) => m.pricePer15 === best((x) => x.pricePer15, "min") },
            { label: "CPU", render: (m) => <span className="num">{m.cpu} · {m.cores} nhân</span>, best: (m) => m.cores === best((x) => x.cores, "max") },
            { label: "RAM", render: (m) => <span className="num">{m.ramGb} GB</span>, best: (m) => m.ramGb === best((x) => x.ramGb, "max") },
            { label: "GPU", render: (m) => m.gpu ?? "Không có GPU" },
            { label: "VRAM", render: (m) => <span className="num">{m.vramGb ? `${m.vramGb} GB` : "—"}</span>, best: (m) => m.vramGb > 0 && m.vramGb === best((x) => x.vramGb, "max") },
            { label: "Mạng host (mô phỏng)", render: (m) => <span className="num">{m.networkMbps} Mbps</span> },
            { label: "Vị trí", render: (m) => m.location },
            { label: "Lưu workspace", render: (m) => (m.workspace ? "Có" : "Không") },
            { label: "Thuê được ngay", render: (m) => { const r = rentability(m); return <><span className="font-semibold">{r.text}</span>{r.sub && <span className="block text-xs text-ink-faint">{r.sub}</span>}</>; } },
            { label: "Ứng dụng đã kiểm tra", render: (m) => <span className="num">{m.apps.filter((a) => a.level === "verified").length}/{m.apps.length}</span>, best: (m) => m.apps.filter((a) => a.level === "verified").length === best((x) => x.apps.filter((a) => a.level === "verified").length, "max") },
          ];
          return (
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <table className="w-full table-fixed border-collapse text-left text-sm">
                <thead className="border-b border-line bg-subtle">
                  <tr>
                    <th scope="col" className="w-[170px] px-4 py-3 text-xs font-semibold text-ink-faint">Tiêu chí</th>
                    {ms.map((m) => (
                      <th key={m.id} scope="col" className="px-4 py-3 align-top">
                        <button type="button" onClick={() => navigate(`/rent/machine/${m.id}`)} className="rounded text-left font-bold hover:text-teal-dark hover:underline">{m.name}</button>
                        <p className="text-xs font-normal text-ink-faint">{m.hostAlias}</p>
                        <div className="mt-1.5 flex items-center gap-2"><MachineStateBadge state={m.state} /><button type="button" className="rounded text-xs font-semibold text-ink-faint hover:text-danger hover:underline" onClick={() => toggle(m.id)}>Bỏ</button></div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} className="border-b border-line last:border-0">
                      <th scope="row" className="px-4 py-2.5 text-xs font-semibold text-ink-faint">{r.label}</th>
                      {ms.map((m) => (
                        <td key={m.id} className="px-4 py-2.5 align-top">
                          <span className="inline-flex items-start gap-1.5">
                            {r.best?.(m) && <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-label="Tốt nhất ở hàng này" />}
                            <span>{r.render(m)}</span>
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td className="px-4 py-3" />
                    {ms.map((m) => (
                      <td key={m.id} className="px-4 py-3"><Button variant="primary" size="sm" onClick={() => navigate(`/rent/machine/${m.id}`)}>Xem chi tiết</Button></td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          );
        }}
      </Async>
    </>
  );
}

/* ===================== Chi tiết máy ===================== */
export function MachineDetail({ id }: { id: string }) {
  const state = useAsync(() => service.getMachine(id), [id]);
  const compare = useAppStore((s) => s.compare);
  const toggle = useAppStore((s) => s.toggleCompare);
  const session = useAppStore((s) => s.session);
  const online = useAppStore((s) => s.online);
  return (
    <Async state={state} isEmpty={(m) => m === null} empty={<EmptyState title="Không tìm thấy máy" action={<Button onClick={() => navigate("/rent/discover")}>Về danh sách</Button>} />}>
      {(m) => {
        if (!m) return null;
        const r = rentability(m);
        const max = maxBookableMinutes(m);
        const w = currentWindow(m);
        const busyWithOwn = session && !["completed", "prepare_failed"].includes(session.phase);
        return (
          <>
            <PageHeader
              title={m.name}
              crumbs={[{ label: "Khám phá máy", to: "/rent/discover" }, { label: m.name }]}
              subtitle={<><MapPin className="mr-1 inline h-3.5 w-3.5" aria-hidden />{m.hostAlias} · {m.location} · {m.categories.map((c) => CATEGORY_LABEL[c]).join(", ")}</>}
              actions={<><MachineStateBadge state={m.state} /><DemoTag /></>}
            />
            <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-8">
              <div className="space-y-8">
                <p className="text-sm text-ink-soft">{m.summary}</p>

                <Section title="Cấu hình">
                  <KeyValue items={[
                    { k: "CPU", v: `${m.cpu} · ${m.cores} nhân` },
                    { k: "RAM", v: `${m.ramGb} GB` },
                    { k: "GPU", v: m.gpu ? `${m.gpu} · ${m.vramGb} GB VRAM` : "Không có GPU rời" },
                    { k: "Ổ lưu trữ cho phiên", v: `${m.storageGb} GB` },
                    { k: "Mạng host (mô phỏng)", v: `${m.networkMbps} Mbps` },
                    { k: "Lưu workspace", v: m.workspace ? "Có (tùy chọn khi thuê)" : "Không hỗ trợ" },
                  ]} />
                </Section>

                <Section title="Môi trường sử dụng">
                  <p className="text-sm">Mỗi phiên là một <b>desktop Linux riêng</b>, hiển thị trong app. Máy chủ là Windows của host, chia sẻ tài nguyên qua WSL/Docker và truyền hình ảnh bằng Selkies.</p>
                  <Banner tone="warn" className="mt-3" title="Hướng này đang được kiểm chứng">
                    WSL/Docker/Selkies chưa được tích hợp thật trong bản xem trước. Chủ máy có quyền quản trị Windows, nên đừng nhập mật khẩu hay dữ liệu nhạy cảm; bản xem trước không hứa dữ liệu được bảo vệ tuyệt đối khỏi chủ máy.
                  </Banner>
                </Section>

                <Section title="Ứng dụng và game tương thích" aside={<span className="text-xs text-ink-faint">{m.apps.length} mục</span>}>
                  <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                    {m.apps.map((a) => (
                      <li key={a.name} className="flex items-start justify-between gap-4 px-4 py-2.5">
                        <div><p className="font-semibold">{a.name} <span className="text-xs font-normal text-ink-faint">· {a.kind === "game" ? "Game" : "Ứng dụng"}</span></p><p className="text-xs text-ink-soft">{a.note}</p></div>
                        <SupportBadge level={a.level} />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-faint"><ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Mức hỗ trợ được ghi cho từng mục. Không phải game Windows nào cũng chạy trên Linux, nhất là game có anti-cheat.</p>
                </Section>

                <Section title="Khoảng thời gian có thể thuê" aside={<span className="text-xs text-ink-faint">Giờ {TIMEZONE_LABEL}</span>}>
                  <ul className="space-y-1.5">
                    {m.windows.map((x) => {
                      const now = w && w.date === x.date && w.start === x.start;
                      return (
                        <li key={x.date + x.start} className="flex items-center justify-between rounded-md border border-line bg-surface px-4 py-2.5">
                          <span className="flex items-center gap-2 font-semibold"><Clock className="h-4 w-4 text-ink-faint" aria-hidden />{x.date === DEMO_DATE ? "Hôm nay" : x.date === addDays(DEMO_DATE, 1) ? "Ngày mai" : formatDateVi(x.date)} · <span className="num">{x.start}–{x.end}</span></span>
                          {now ? <Badge tone="ok">Đang mở · còn {formatDuration(max)} thuê được</Badge> : <Badge tone="neutral" icon={false}>Sắp tới</Badge>}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-xs text-ink-faint">Thời lượng thuê không vượt quá khung giờ host. Lịch của host không tự bật máy: máy phải đang online mới nhận phiên.</p>
                </Section>
              </div>

              <aside className="sticky top-0 h-fit space-y-4 rounded-lg border border-line bg-surface p-5" aria-label="Thuê máy này">
                <div>
                  <p className="text-xs text-ink-faint">Giá</p>
                  <p><span className="num text-2xl font-bold">{m.pricePer15}</span> <span className="text-sm text-ink-soft">PCP thử / 15 phút</span></p>
                  <p className="text-xs text-ink-faint">Đã gồm phí nền tảng 10%. PCP thử không phải tiền thật.</p>
                </div>
                <div className="border-t border-line pt-3 text-sm">
                  <p className="font-semibold">{r.text}</p>
                  {r.sub && <p className="text-xs text-ink-faint">{r.sub}</p>}
                </div>
                {busyWithOwn && <Banner tone="info">Bạn đang có một phiên chưa kết thúc.</Banner>}
                {!online && <Banner tone="danger">Đang mất mạng nên chưa thể thuê.</Banner>}
                <Button variant="primary" size="lg" className="w-full" disabled={!r.canRent || !online || !!busyWithOwn} onClick={() => navigate(`/rent/checkout/${m.id}`)}>Thuê máy này</Button>
                {!r.canRent && <p className="flex items-start gap-1.5 text-xs text-ink-faint"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Chưa thuê được ngay: {r.text.toLowerCase()}.</p>}
                <Button variant="secondary" className="w-full" onClick={() => toggle(m.id)}>{compare.includes(m.id) ? "Bỏ khỏi so sánh" : "Thêm vào so sánh"}</Button>
              </aside>
            </div>
          </>
        );
      }}
    </Async>
  );
}

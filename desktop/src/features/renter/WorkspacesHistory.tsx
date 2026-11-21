import { FolderOpen, History, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, navigate } from "@/app/router";
import { formatDuration } from "@/domain/clock";
import type { HistoryItem, Workspace } from "@/domain/types";
import { service } from "@/api";
import { useAppStore } from "@/state/store";
import { useAsync } from "@/state/useAsync";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm";
import { Segmented } from "@/ui/controls";
import { Async, Banner, EmptyState } from "@/ui/feedback";
import { KeyValue, Money, PageHeader } from "@/ui/page";

/* ===================== Workspace ===================== */
export function Workspaces() {
  const state = useAsync(() => service.listWorkspaces());
  const refresh = useAppStore((s) => s.refreshData);
  const toast = useAppStore((s) => s.toast);
  const [del, setDel] = useState<Workspace | null>(null);
  return (
    <>
      <PageHeader title="Workspace" subtitle="Workspace là thư mục dự án bạn chọn lưu khi kết thúc phiên. Chỉ được tính là “đã lưu” sau khi checkpoint được xác nhận." />
      <Banner tone="info" className="mb-4">Bản xem trước mô phỏng giới hạn 100 MiB và 3 checkpoint. Không lưu workspace thì dữ liệu phiên bị xóa khi kết thúc.</Banner>
      <Async state={state} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={FolderOpen} title="Chưa có workspace" action={<Button variant="primary" onClick={() => navigate("/rent/discover")}>Tìm máy hỗ trợ workspace</Button>}>Chọn “Lưu workspace” khi thuê máy để giữ lại dự án giữa các phiên.</EmptyState>}>
        {(list) => (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full table-fixed text-left text-sm">
              <caption className="sr-only">Danh sách workspace</caption>
              <thead className="border-b border-line bg-subtle text-xs text-ink-faint"><tr>
                <th scope="col" className="px-4 py-2 font-semibold">Tên</th>
                <th scope="col" className="w-[24%] px-4 py-2 font-semibold">Lưu từ máy</th>
                <th scope="col" className="w-[15%] px-4 py-2 font-semibold">Dung lượng</th>
                <th scope="col" className="w-[19%] px-4 py-2 font-semibold">Trạng thái</th>
                <th scope="col" className="w-[210px] px-4 py-2 text-right font-semibold">Thao tác</th>
              </tr></thead>
              <tbody>
                {list.map((w) => (
                  <tr key={w.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3"><p className="truncate font-bold">{w.name}</p><p className="text-xs text-ink-faint">{w.savedAt}</p></td>
                    <td className="px-4 py-3 text-ink-soft">{w.machineName}</td>
                    <td className="num px-4 py-3">{w.status === "saved" ? `${w.sizeMb} MiB · ${w.checkpoints} checkpoint` : "—"}</td>
                    <td className="px-4 py-3">{w.status === "saved" ? <Badge tone="ok">Đã lưu</Badge> : <Badge tone="danger">Lưu chưa thành công</Badge>}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" disabled={w.status !== "saved"} onClick={() => { toast("Mở workspace cần thuê một máy hỗ trợ. Hãy chọn máy rồi bật “Lưu workspace” (mô phỏng).", "info"); navigate("/rent/discover"); }}>Dùng lại</Button>
                        <Button size="sm" variant="danger-outline" aria-label={`Xóa ${w.name}`} onClick={() => setDel(w)}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Xóa workspace?" danger confirmLabel="Xóa workspace" onConfirm={() => { if (del) { service.deleteWorkspace(del.id); refresh(); toast("Đã xóa workspace (mô phỏng).", "ok"); } }}>
        Workspace <b>{del?.name}</b> và các checkpoint sẽ bị xóa. Không hoàn tác được.
      </ConfirmDialog>
    </>
  );
}

/* ===================== Lịch sử ===================== */
const OUTCOME: Record<HistoryItem["outcome"], { tone: "ok" | "danger" | "warn"; label: string }> = {
  completed: { tone: "ok", label: "Hoàn tất" },
  cleanup_failed: { tone: "warn", label: "Dọn dẹp lỗi" },
  prepare_failed: { tone: "danger", label: "Chuẩn bị thất bại" },
};
const WS_LABEL: Record<HistoryItem["workspace"], string> = { none: "Không lưu", saved: "Đã lưu", failed: "Lưu thất bại", skipped: "Bỏ qua lưu" };

export function HistoryList() {
  const state = useAsync(() => service.listHistory());
  const [f, setF] = useState<"all" | "ok" | "issue">("all");
  return (
    <>
      <PageHeader title="Lịch sử thuê" subtitle="Các phiên của bạn (mô phỏng). Chọn một dòng để xem chi tiết." actions={<Segmented label="Lọc lịch sử" value={f} onChange={setF} items={[{ value: "all", label: "Tất cả" }, { value: "ok", label: "Hoàn tất" }, { value: "issue", label: "Có lỗi" }]} />} />
      <Async state={state} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={History} title="Chưa có phiên nào" action={<Button variant="primary" onClick={() => navigate("/rent/discover")}>Tìm máy</Button>}>Các phiên thuê của bạn sẽ hiện ở đây.</EmptyState>}>
        {(all) => {
          const list = all.filter((h) => (f === "all" ? true : f === "ok" ? h.outcome === "completed" : h.outcome !== "completed"));
          return list.length === 0 ? <EmptyState title="Không có phiên phù hợp bộ lọc" /> : (
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <table className="w-full table-fixed text-left text-sm">
                <caption className="sr-only">Lịch sử phiên thuê</caption>
                <thead className="border-b border-line bg-subtle text-xs text-ink-faint"><tr>
                  <th scope="col" className="px-4 py-2 font-semibold">Máy</th>
                  <th scope="col" className="w-[15%] px-4 py-2 font-semibold">Bắt đầu</th>
                  <th scope="col" className="w-[13%] px-4 py-2 font-semibold">Đã dùng</th>
                  <th scope="col" className="w-[15%] px-4 py-2 text-right font-semibold">Tính phí</th>
                  <th scope="col" className="w-[13%] px-4 py-2 font-semibold">Workspace</th>
                  <th scope="col" className="w-[15%] px-4 py-2 font-semibold">Kết quả</th>
                </tr></thead>
                <tbody>
                  {list.map((h) => (
                    <tr key={h.id} className="border-b border-line last:border-0 hover:bg-subtle/70">
                      <td className="px-4 py-3"><Link to={`/rent/history/${h.id}`} className="rounded font-bold hover:text-teal-ink hover:underline">{h.machineName}</Link><p className="text-xs text-ink-faint">{h.hostAlias}</p></td>
                      <td className="num px-4 py-3 text-ink-soft">{h.startedAt}</td>
                      <td className="num px-4 py-3">{h.minutes ? formatDuration(h.minutes) : "—"}</td>
                      <td className="px-4 py-3 text-right"><Money value={h.charged} /></td>
                      <td className="px-4 py-3 text-ink-soft">{WS_LABEL[h.workspace]}</td>
                      <td className="px-4 py-3"><Badge tone={OUTCOME[h.outcome].tone}>{OUTCOME[h.outcome].label}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Async>
    </>
  );
}

export function HistoryDetail({ id }: { id: string }) {
  const state = useAsync(() => service.getHistoryItem(id), [id]);
  return (
    <Async state={state} isEmpty={(d) => d === null} empty={<EmptyState title="Không tìm thấy phiên" action={<Button onClick={() => navigate("/rent/history")}>Về lịch sử</Button>} />}>
      {(h) => {
        if (!h) return null;
        const o = OUTCOME[h.outcome];
        const steps = [
          { l: "Chuẩn bị phiên", ok: h.outcome !== "prepare_failed", note: h.outcome === "prepare_failed" ? "Thất bại — đã hoàn đủ." : "Hoàn tất" },
          { l: "Sử dụng", ok: h.outcome !== "prepare_failed", note: h.minutes ? `Đã dùng ${formatDuration(h.minutes)}` : "Không có" },
          { l: "Lưu workspace", ok: h.workspace === "saved" || h.workspace === "none", note: WS_LABEL[h.workspace] },
          { l: "Dọn dẹp", ok: h.outcome === "completed", note: h.outcome === "cleanup_failed" ? "Thất bại — máy bị khóa để xử lý" : h.outcome === "prepare_failed" ? "Không áp dụng" : "Hoàn tất" },
        ];
        return (
          <>
            <PageHeader title={h.machineName} crumbs={[{ label: "Lịch sử thuê", to: "/rent/history" }, { label: "Chi tiết phiên" }]} subtitle={`${h.hostAlias} · bắt đầu ${h.startedAt}`} actions={<Badge tone={o.tone}>{o.label}</Badge>} />
            <div className="grid grid-cols-[1fr_320px] gap-8">
              <section>
                <h2 className="mb-3 text-base font-bold">Diễn biến phiên</h2>
                <ol className="space-y-3 border-l-2 border-line pl-5">
                  {steps.map((s) => (
                    <li key={s.l} className="relative">
                      <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-surface ${s.ok ? "bg-ok" : "bg-warn"}`} aria-hidden />
                      <p className="font-semibold">{s.l}</p>
                      <p className="text-sm text-ink-soft">{s.note}</p>
                    </li>
                  ))}
                </ol>
                {h.workspace === "failed" && <Banner tone="warn" className="mt-4">Workspace của phiên này không được lưu. Không có dữ liệu để khôi phục.</Banner>}
              </section>
              <aside className="h-fit rounded-lg border border-line bg-surface p-5">
                <h2 className="mb-3 text-base font-bold">Chi phí (mô phỏng)</h2>
                <KeyValue items={[{ k: "Tính phí", v: <Money value={h.charged} /> }, { k: "Hoàn lại", v: <Money value={h.refunded} /> }, { k: "Thời lượng dùng", v: h.minutes ? formatDuration(h.minutes) : "—" }]} />
                <Link to="/wallet" className="mt-4 block rounded text-sm font-semibold text-teal-ink hover:underline">Xem giao dịch liên quan</Link>
              </aside>
            </div>
          </>
        );
      }}
    </Async>
  );
}

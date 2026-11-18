import { FolderCheck, FolderX } from "lucide-react";
import { useState } from "react";
import { navigate } from "@/app/router";
import { DEMO_MINUTES, formatDuration, formatHM, parseHM } from "@/domain/clock";
import { currentWindow, DURATION_OPTIONS, DURATION_REASON_TEXT, checkDuration, maxBookableMinutes, quote } from "@/domain/pricing";
import { service } from "@/api";
import { useAppStore } from "@/state/store";
import { useAsync } from "@/state/useAsync";
import { Banner, Async, EmptyState } from "@/ui/feedback";
import { Button } from "@/ui/button";
import { RadioGroup } from "@/ui/radio";
import { Money, PageHeader } from "@/ui/page";
import { cn } from "@/lib/utils";

export function Checkout({ id }: { id: string }) {
  const state = useAsync(() => service.getMachine(id), [id]);
  const wallet = useAppStore((s) => s.wallet);
  const startSession = useAppStore((s) => s.startSession);
  const online = useAppStore((s) => s.online);
  const [rawMinutes, setMinutes] = useState<number>(60);
  const [ws, setWs] = useState<"none" | "save">("none");
  const [error, setError] = useState("");

  return (
    <Async state={state} isEmpty={(m) => m === null} empty={<EmptyState title="Không tìm thấy máy" action={<Button onClick={() => navigate("/rent/discover")}>Về danh sách</Button>} />}>
      {(m) => {
        if (!m) return null;
        const max = maxBookableMinutes(m);
        // nếu lựa chọn trước vượt khung giờ, tự hạ xuống mức lớn nhất cho phép (luôn có một radio được chọn)
        const fit = DURATION_OPTIONS.filter((d) => d <= max).pop() ?? max;
        const minutes = rawMinutes > max && max > 0 ? fit : rawMinutes;
        const w = currentWindow(m);
        const check = checkDuration(m, minutes);
        const q = quote(m.pricePer15, minutes);
        const afterBalance = Math.round((wallet.usable - q.gross) * 100) / 100;
        const enough = afterBalance >= 0;
        const startAt = formatHM(DEMO_MINUTES);
        const endAt = formatHM(DEMO_MINUTES + minutes);
        const hostEnd = w ? (parseHM(w.end) ?? 0) : 0;
        const canConfirm = check.ok && enough && online && max > 0;
        const options = [...new Set([...DURATION_OPTIONS.filter((d) => d <= max + 120), ...(max > 0 && !DURATION_OPTIONS.some((d) => d === max) ? [max] : [])])].sort((a, b) => a - b).filter((d) => d <= 180);

        return (
          <>
            <PageHeader title="Xác nhận thuê" crumbs={[{ label: "Khám phá máy", to: "/rent/discover" }, { label: m.name, to: `/rent/machine/${m.id}` }, { label: "Xác nhận" }]} subtitle={`${m.name} · ${m.hostAlias}. Đây là mô phỏng: không có thanh toán thật.`} />
            {max === 0 ? (
              <Banner tone="danger" title="Máy này hiện không thuê được">Ngoài khung giờ hoặc không sẵn sàng. <button type="button" className="font-bold underline" onClick={() => navigate(`/rent/machine/${m.id}`)}>Xem khung giờ</button></Banner>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-8">
                <div className="space-y-7">
                  <fieldset>
                    <legend className="text-base font-bold">1. Thời lượng</legend>
                    <p className="mb-3 text-sm text-ink-soft">Host mở máy tới <b className="num">{w?.end}</b> (giờ GMT+7). Bạn thuê được tối đa <b>{formatDuration(max)}</b> kể từ bây giờ ({startAt}).</p>
                    <RadioGroup label="Thời lượng thuê" className="flex flex-wrap gap-2">
                      {options.map((d) => {
                        const bad = d > max;
                        return (
                          <button key={d} type="button" role="radio" aria-checked={minutes === d} tabIndex={minutes === d ? 0 : -1} disabled={bad} onClick={() => { setMinutes(d); setError(""); }} className={cn("h-10 min-w-[92px] rounded-md border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45", minutes === d ? "border-teal bg-teal-tint text-teal-dark" : "border-line-strong bg-surface hover:bg-subtle")}>
                            {formatDuration(d)}
                            {bad && <span className="block text-[10px] font-medium leading-3">vượt khung giờ</span>}
                          </button>
                        );
                      })}
                    </RadioGroup>
                    {!check.ok && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{DURATION_REASON_TEXT[check.reason]}</p>}
                    {check.ok && minutes + DEMO_MINUTES >= hostEnd - 15 && <p className="mt-2 text-xs text-ink-faint">Phiên sẽ kết thúc lúc <b className="num">{endAt}</b>, sát giờ host đóng máy.</p>}
                  </fieldset>

                  <fieldset>
                    <legend className="text-base font-bold">2. Dữ liệu sau phiên</legend>
                    <RadioGroup label="Lưu workspace" className="mt-2 grid grid-cols-2 gap-3">
                      <button type="button" role="radio" aria-checked={ws === "none"} tabIndex={ws === "none" ? 0 : -1} onClick={() => setWs("none")} className={cn("rounded-lg border p-4 text-left transition-colors", ws === "none" ? "border-teal bg-teal-tint/60" : "border-line-strong bg-surface hover:bg-subtle")}>
                        <span className="flex items-center gap-2 font-bold"><FolderX className="h-4 w-4" aria-hidden />Không lưu</span>
                        <span className="mt-1 block text-sm text-ink-soft">Không tải dữ liệu lên. Mọi thứ trong phiên bị xóa khi kết thúc.</span>
                      </button>
                      <button type="button" role="radio" aria-checked={ws === "save"} tabIndex={ws === "save" ? 0 : -1} disabled={!m.workspace} onClick={() => setWs("save")} className={cn("rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50", ws === "save" ? "border-teal bg-teal-tint/60" : "border-line-strong bg-surface hover:bg-subtle")}>
                        <span className="flex items-center gap-2 font-bold"><FolderCheck className="h-4 w-4" aria-hidden />Lưu workspace</span>
                        <span className="mt-1 block text-sm text-ink-soft">{m.workspace ? "Lưu thư mục dự án khi kết thúc (mô phỏng: tối đa 100 MiB). Chỉ tính là đã lưu khi xác nhận xong." : "Máy này không hỗ trợ lưu workspace."}</span>
                      </button>
                    </RadioGroup>
                    {ws === "save" && <p className="mt-2 text-xs text-ink-faint">Nếu lưu thất bại, bạn sẽ được báo và chọn thử lại hoặc bỏ qua trước khi máy được dọn dẹp.</p>}
                  </fieldset>
                </div>

                <aside className="h-fit rounded-lg border border-line bg-surface p-5" aria-label="Chi phí">
                  <h2 className="text-base font-bold">Chi phí</h2>
                  <dl className="mt-3 space-y-2 text-sm">
                    <Row k={`Giá thuê (${q.slots} × ${m.pricePer15})`} v={<Money value={q.gross} />} />
                    <Row k="Trong đó phí nền tảng 10%" v={<Money value={q.fee} />} sub />
                    <Row k="Host nhận" v={<Money value={q.hostNet} />} sub />
                    <div className="border-t border-line pt-2"><Row k="Tạm giữ ngay" v={<Money value={q.gross} className="text-base" />} bold /></div>
                    <Row k="Số dư hiện tại" v={<Money value={wallet.usable} />} />
                    <Row k="Số dư sau khi giữ" v={<Money value={afterBalance} className={enough ? "" : "text-danger"} />} />
                  </dl>
                  {!enough && <p role="alert" className="mt-2 text-sm font-semibold text-danger">Số dư PCP thử không đủ cho thời lượng này.</p>}
                  <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-ink-soft">
                    <li><b>Kết thúc sớm vẫn trả cả gói</b> đã chọn; chưa tính tiền theo phút và không hoàn phần chưa dùng.</li>
                    <li>Chuẩn bị phiên thất bại trước khi bạn vào phiên: hoàn đủ.</li>
                    <li>Nếu máy không dùng được, hệ thống thật sẽ có đường khiếu nại (chưa mô phỏng).</li>
                    <li>PCP thử không phải tiền thật.</li>
                  </ul>
                  {error && <Banner tone="danger" className="mt-3">{error}</Banner>}
                  <Button variant="primary" size="lg" className="mt-4 w-full" disabled={!canConfirm} onClick={() => {
                    const r = startSession(m, minutes, ws);
                    if (!r.ok) return setError(r.reason);
                    navigate("/rent/session");
                  }}>Xác nhận thuê (mô phỏng)</Button>
                  {!online && <p className="mt-2 text-xs font-semibold text-danger">Đang mất mạng — chưa thể xác nhận.</p>}
                </aside>
              </div>
            )}
          </>
        );
      }}
    </Async>
  );
}

function Row({ k, v, sub, bold }: { k: string; v: React.ReactNode; sub?: boolean; bold?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", sub && "pl-3 text-xs text-ink-faint", bold && "font-bold")}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

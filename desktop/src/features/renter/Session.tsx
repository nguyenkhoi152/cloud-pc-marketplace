import { useState } from "react";
import { CheckCircle2, Circle, Loader2, MonitorPlay, XCircle } from "lucide-react";
import { navigate } from "@/app/router";
import { formatDuration } from "@/domain/clock";
import { PREPARE_STEPS, settle, type SessionState } from "@/domain/session";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/state/store";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm";
import { Banner, EmptyState } from "@/ui/feedback";
import { KeyValue, Money, PageHeader, Progress } from "@/ui/page";
import { PhaseBadge } from "@/ui/status";
import { SessionViewer } from "./Viewer";

type StepState = "done" | "doing" | "todo" | "failed";
function Steps({ items }: { items: { label: string; state: StepState; note?: string }[] }) {
  return (
    <ol className="space-y-3">
      {items.map((i) => (
        <li key={i.label} className="flex items-start gap-3">
          {i.state === "done" && <CheckCircle2 className="mt-0.5 h-5 w-5 text-ok" aria-label="Xong" />}
          {i.state === "doing" && <Loader2 className="mt-0.5 h-5 w-5 animate-[spin_1s_linear_infinite] text-teal" aria-label="Đang làm" />}
          {i.state === "todo" && <Circle className="mt-0.5 h-5 w-5 text-line-strong" aria-label="Chưa tới" />}
          {i.state === "failed" && <XCircle className="mt-0.5 h-5 w-5 text-danger" aria-label="Thất bại" />}
          <div>
            <p className={cn("font-semibold", i.state === "todo" && "text-ink-faint")}>{i.label}</p>
            {i.note && <p className="text-sm text-ink-soft">{i.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function SessionScreen() {
  const s = useAppStore((a) => a.session);
  const enter = useAppStore((a) => a.enterSession);
  const end = useAppStore((a) => a.endSession);
  const dismiss = useAppStore((a) => a.dismissSession);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (!s)
    return (
      <>
        <PageHeader title="Phiên hiện tại" />
        <EmptyState icon={MonitorPlay} title="Bạn chưa có phiên nào" action={<Button variant="primary" onClick={() => navigate("/rent/discover")}>Tìm máy để thuê</Button>}>
          Khi bạn thuê một máy, tiến trình chuẩn bị và màn hình phiên sẽ hiện ở đây.
        </EmptyState>
      </>
    );

  const head = (
    <PageHeader title={s.machineName} subtitle={<>{s.hostAlias} · {formatDuration(s.durationMin)} · {s.workspaceMode === "save" ? "Lưu workspace" : "Không lưu workspace"}</>} actions={<PhaseBadge phase={s.phase} />} crumbs={[{ label: "Phiên hiện tại" }]} />
  );

  switch (s.phase) {
    case "preparing":
      return (
        <>
          {head}
          <div className="max-w-xl">
            <Progress value={(s.prepareStep / PREPARE_STEPS.length) * 100} label="Tiến độ chuẩn bị" />
            <p className="mb-5 mt-2 text-sm text-ink-soft">Đang chuẩn bị (mô phỏng). Bạn có thể xem trang khác; phiên vẫn chạy nền trong app.</p>
            <Steps items={PREPARE_STEPS.map((l, i) => ({ label: l, state: i < s.prepareStep ? "done" : i === s.prepareStep ? "doing" : "todo" }))} />
          </div>
        </>
      );
    case "prepare_failed": {
      const st = settle(s);
      return (
        <>
          {head}
          <div className="max-w-xl space-y-4">
            <Banner tone="danger" title="Không chuẩn bị được phiên">{s.failureReason}</Banner>
            <p className="text-sm">Bạn chưa bị tính phí: đã hoàn đủ <Money value={st.refunded} />. Máy này không bị ảnh hưởng bởi lỗi từ phía bạn.</p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => { const id = s.machineId; dismiss(); navigate(`/rent/checkout/${id}`); }}>Thử thuê lại</Button>
              <Button variant="secondary" onClick={() => { dismiss(); navigate("/rent/discover"); }}>Chọn máy khác</Button>
            </div>
          </div>
        </>
      );
    }
    case "ready":
      return (
        <>
          {head}
          <div className="max-w-xl space-y-4">
            <Banner tone="ok" title="Máy đã sẵn sàng">Môi trường Linux của phiên đã được tạo (mô phỏng). Thời gian thuê bắt đầu trôi khi bạn vào phiên.</Banner>
            <KeyValue items={[{ k: "Thời lượng", v: formatDuration(s.durationMin) }, { k: "Còn lại", v: formatDuration(Math.floor(s.remainingSec / 60)) }, { k: "Đã tạm giữ", v: <Money value={s.quote.gross} /> }]} />
            <div className="flex gap-2">
              <Button variant="primary" size="lg" onClick={enter}><MonitorPlay className="h-4 w-4" aria-hidden />Vào phiên</Button>
              <Button variant="secondary" size="lg" onClick={() => setCancelOpen(true)}>Kết thúc không dùng</Button>
            </div>
            <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Kết thúc mà chưa dùng?" danger confirmLabel="Kết thúc phiên" onConfirm={end}>
              Máy đã được giữ và gói đã tính, nên kết thúc bây giờ <b>vẫn trả cả gói</b> ({s.quote.gross} PCP thử). Chỉ hoàn đủ khi chuẩn bị thất bại trước khi máy sẵn sàng.
            </ConfirmDialog>
          </div>
        </>
      );
    case "active":
    case "reconnecting":
      return (
        <>
          {head}
          <SessionViewer s={s} />
        </>
      );
    default:
      return <EndFlow s={s} head={head} />;
  }
}

function EndFlow({ s, head }: { s: SessionState; head: React.ReactNode }) {
  const retrySave = useAppStore((a) => a.saveRetry);
  const skipSave = useAppStore((a) => a.saveSkip);
  const retryClean = useAppStore((a) => a.cleanupRetry);
  const dismiss = useAppStore((a) => a.dismissSession);
  const st = settle(s);
  const wantsSave = s.workspaceMode === "save";

  const saveState: StepState = !wantsSave ? "done" : s.saveStatus === "saving" ? "doing" : s.saveStatus === "failed" ? "failed" : "done";
  const saveNote = !wantsSave ? "Bạn chọn không lưu workspace." : s.saveStatus === "saved" ? "Đã lưu và xác nhận checkpoint." : s.saveStatus === "skipped" ? "Đã bỏ qua theo xác nhận của bạn — dữ liệu phiên không được giữ." : s.saveStatus === "failed" ? "Chưa lưu được." : "Đang tải checkpoint lên (mô phỏng)…";
  const cleanState: StepState = s.phase === "ending" ? "todo" : s.phase === "cleaning" ? "doing" : s.phase === "cleanup_failed" ? "failed" : "done";
  const doneState: StepState = s.phase === "completed" ? "done" : s.phase === "cleanup_failed" ? "failed" : "todo";

  return (
    <>
      {head}
      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-8">
        <div className="space-y-5">
          <Steps items={[
            { label: "Đã kết thúc phiên", state: "done", note: `Đã dùng ${formatDuration(Math.round((s.durationMin * 60 - s.remainingSec) / 60))}.` },
            { label: "Lưu workspace", state: saveState, note: saveNote },
            { label: "Dọn dẹp môi trường", state: cleanState, note: s.phase === "cleanup_failed" ? "Không xác minh được môi trường đã sạch." : s.phase === "cleaning" ? "Đang xóa dữ liệu phiên và đặt lại môi trường (mô phỏng)…" : s.phase === "ending" ? "Chờ bước lưu." : "Đã xóa sạch dữ liệu phiên." },
            { label: "Hoàn tất", state: doneState, note: s.phase === "completed" ? "Máy được trả về cho host." : s.phase === "cleanup_failed" ? "Chưa hoàn tất." : undefined },
          ]} />

          {s.phase === "ending" && s.saveStatus === "failed" && (
            <Banner tone="danger" title="Lưu workspace thất bại" action={<div className="flex gap-2"><Button variant="primary" size="sm" onClick={retrySave}>Thử lại</Button></div>}>
              Dữ liệu vẫn nằm trong máy thuê cho tới khi dọn dẹp. Nếu bỏ qua, dọn dẹp sẽ xóa và <b>không thể khôi phục</b>.
              <div className="mt-2"><Button variant="danger-outline" size="sm" onClick={skipSave}>Bỏ qua và xóa dữ liệu phiên</Button></div>
            </Banner>
          )}
          {s.phase === "cleanup_failed" && (
            <Banner tone="warn" title="Dọn dẹp chưa thành công — máy đang bị khóa" action={<Button variant="primary" size="sm" onClick={retryClean}>Thử dọn lại</Button>}>
              Máy <b>không</b> được trả về trạng thái sẵn sàng và không nhận khách khác cho tới khi dọn dẹp được xác minh. Phiên của bạn đã kết thúc; bạn không bị tính thêm. Host đã nhận thông báo sự cố (mô phỏng).
            </Banner>
          )}
          {s.phase === "completed" && <Banner tone="ok" title="Phiên đã hoàn tất">Môi trường đã được dọn sạch. Cảm ơn bạn đã dùng bản xem trước.</Banner>}

          {(s.phase === "completed" || s.phase === "cleanup_failed") && (
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => { dismiss(); navigate("/rent/history"); }}>Xem lịch sử thuê</Button>
              <Button variant="secondary" onClick={() => { dismiss(); navigate("/rent/discover"); }}>Tìm máy khác</Button>
            </div>
          )}
        </div>
        <aside className="h-fit rounded-lg border border-line bg-surface p-5" aria-label="Quyết toán">
          <h2 className="text-base font-bold">Quyết toán (mô phỏng)</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt>Đã tạm giữ</dt><dd><Money value={s.quote.gross} /></dd></div>
            <div className="flex justify-between"><dt>Tính phí (cả gói, {st.billedSlots} × 15′)</dt><dd><Money value={st.charged} /></dd></div>
            <div className="flex justify-between"><dt>Hoàn lại</dt><dd><Money value={st.refunded} /></dd></div>
          </dl>
          <p className="mt-3 text-xs text-ink-faint">Kết thúc sớm vẫn trả cả gói; chưa tính tiền theo phút. PCP thử không phải tiền thật.</p>
        </aside>
      </div>
    </>
  );
}

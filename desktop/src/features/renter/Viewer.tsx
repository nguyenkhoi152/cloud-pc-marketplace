import { Clock, Maximize2, Minimize2, PlugZap, RefreshCw, Square, WifiOff, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/domain/clock";
import type { SessionState } from "@/domain/session";
import { useAppStore } from "@/state/store";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm";
import { Banner } from "@/ui/feedback";
import { cn } from "@/lib/utils";

/** Khung desktop minh họa vẽ bằng CSS. KHÔNG phải stream thật; không có FPS/ping. */
function FakeDesktop() {
  return (
    <div className="fake-wallpaper relative h-full w-full select-none overflow-hidden text-[12px] text-white" aria-label="Desktop Linux minh họa (không phải stream thật)" role="img">
      <div className="absolute left-5 top-5 flex flex-col gap-4">
        {["Dự án", "Tải xuống", "Thùng rác"].map((n) => (
          <div key={n} className="flex w-16 flex-col items-center gap-1 text-center">
            <span className="h-9 w-11 rounded-md bg-sky/85" />
            <span className="text-[11px]">{n}</span>
          </div>
        ))}
      </div>
      <div className="absolute left-[24%] top-[12%] w-[52%] overflow-hidden rounded-lg border border-white/20 bg-[#0e1a2b] shadow-2xl">
        <div className="flex h-7 items-center gap-1.5 bg-[#22344d] px-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff7b72]" /><span className="h-2.5 w-2.5 rounded-full bg-[#f2cc60]" /><span className="h-2.5 w-2.5 rounded-full bg-[#56d364]" />
          <span className="ml-3 text-[11px] text-panel-ink">Terminal — minh họa</span>
        </div>
        <pre className="m-0 h-44 overflow-hidden p-3 font-mono leading-5 text-[#9fe7d8]">{`user@phiên-thuê:~$ echo "Đây là khung minh họa"
Đây là khung minh họa
user@phiên-thuê:~$ ls dự-án
README.md  src  assets
user@phiên-thuê:~$ # Chưa có stream thật ở bản xem trước
user@phiên-thuê:~$ █`}</pre>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-9 items-center justify-between bg-[#0b1626]/95 px-3">
        <div className="flex gap-2">{[0, 1, 2, 3].map((i) => <span key={i} className="h-5 w-5 rounded bg-sky/60" />)}</div>
        <span className="num text-[11px] text-panel-ink">20:10</span>
      </div>
    </div>
  );
}

export function SessionViewer({ s }: { s: SessionState }) {
  const frame = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const end = useAppStore((a) => a.endSession);
  const dc = useAppStore((a) => a.simulateDisconnect);
  const retry = useAppStore((a) => a.retryReconnect);
  const skip = useAppStore((a) => a.skipTime);
  const online = useAppStore((a) => a.online);
  const reconnecting = s.phase === "reconnecting";
  const low = s.remainingSec <= 300;

  useEffect(() => {
    const h = () => setFull(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frame.current?.requestFullscreen();
    } catch {
      /* trình duyệt có thể từ chối; không ảnh hưởng demo */
    }
  };

  return (
    <div>
      <div ref={frame} className="flex flex-col overflow-hidden rounded-lg border border-line-strong bg-panel">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 bg-panel px-3 text-white" role="toolbar" aria-label="Thanh công cụ phiên">
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", reconnecting ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok")}>
              {reconnecting ? <WifiOff className="h-3.5 w-3.5" aria-hidden /> : <Wifi className="h-3.5 w-3.5" aria-hidden />}
              {reconnecting ? "Mất kết nối" : "Đã kết nối (mô phỏng)"}
            </span>
            <span className="truncate text-sm font-semibold">{s.machineName}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn("num mr-2 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-bold", low ? "bg-warn-bg text-warn" : "bg-white/10")} aria-label={`Còn lại ${formatClock(s.remainingSec)}`}>
              <Clock className="h-4 w-4" aria-hidden />Còn {formatClock(s.remainingSec)}
            </span>
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/15 hover:text-white" onClick={toggleFull} aria-pressed={full}>
              {full ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}{full ? "Thoát toàn màn hình" : "Toàn màn hình"}
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirm(true)}><Square className="h-3.5 w-3.5" aria-hidden />Kết thúc</Button>
          </div>
        </div>
        <div className="relative aspect-[16/9] max-h-[calc(100vh-330px)] min-h-[300px] w-full bg-black">
          <FakeDesktop />
          {reconnecting && (
            <div className="absolute inset-0 flex items-center justify-center bg-panel/75 p-6" role="alert">
              <div className="max-w-sm rounded-lg bg-surface p-5 text-center text-ink shadow-pop">
                {s.reconnectFailed ? <WifiOff className="mx-auto mb-2 h-7 w-7 text-danger" aria-hidden /> : <RefreshCw className="mx-auto mb-2 h-7 w-7 animate-[spin_1.2s_linear_infinite] text-teal" aria-hidden />}
                <p className="font-bold">{s.reconnectFailed ? "Chưa kết nối lại được" : "Đang kết nối lại…"}</p>
                <p className="mt-1 text-sm text-ink-soft">{s.reconnectFailed ? (online ? "Có thể host đang gặp sự cố." : "Thiết bị của bạn đang offline.") : "Giữ nguyên app. Phiên vẫn được giữ và thời gian vẫn trôi."} Thời gian thuê vẫn tính cho tới khi bạn kết thúc.</p>
                {s.reconnectFailed && (
                  <div className="mt-3 flex justify-center gap-2">
                    <Button variant="primary" onClick={retry}><PlugZap className="h-4 w-4" aria-hidden />Thử lại</Button>
                    <Button variant="secondary" onClick={() => setConfirm(true)}>Kết thúc phiên</Button>
                  </div>
                )}
              </div>
            </div>
          )}
          <span className="absolute left-3 top-3 rounded bg-warn-bg px-2 py-0.5 text-[11px] font-bold text-warn">Khung minh họa — chưa có stream thật</span>
        </div>
      </div>

      {low && <Banner tone="warn" className="mt-3" title="Sắp hết thời lượng">Còn dưới 5 phút. Bản xem trước không có gia hạn; hãy lưu việc đang làm. Hết giờ phiên sẽ tự kết thúc.</Banner>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-warn-line bg-warn-bg/50 px-4 py-2.5">
        <p className="text-xs font-semibold text-warn">Điều khiển demo (không có trong app thật):</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => skip(5)}>Tua nhanh 5 phút</Button>
          <Button size="sm" variant="secondary" onClick={() => skip(Math.max(1, Math.ceil(s.remainingSec / 60) - 1))}>Tua tới còn ~1 phút</Button>
          <Button size="sm" variant="secondary" onClick={dc} disabled={reconnecting}>Mô phỏng mất kết nối</Button>
        </div>
      </div>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Kết thúc phiên?" confirmLabel="Kết thúc phiên" danger cancelLabel="Tiếp tục dùng" onConfirm={end}>
        <p>Sau khi kết thúc: {s.workspaceMode === "save" ? "workspace sẽ được lưu, rồi " : ""}môi trường của phiên sẽ bị <b>xóa sạch</b> (dọn dẹp). </p>
        <p className="mt-2"><b>Kết thúc sớm vẫn trả cả gói</b> ({s.quote.gross} PCP thử); phần thời gian chưa dùng không được hoàn.</p>
        <p className="mt-2">Hành động này không hoàn tác được.</p>
      </ConfirmDialog>
    </div>
  );
}

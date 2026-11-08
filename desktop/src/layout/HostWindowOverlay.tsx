import { MonitorSmartphone, Power } from "lucide-react";
import { navigate } from "@/app/router";
import { isTerminal } from "@/domain/session";
import { useAppStore } from "@/state/store";
import { Button } from "@/ui/button";

/**
 * Mô phỏng việc đóng cửa sổ app: ẩn xuống khay (chạy nền) hoặc thoát hẳn (dừng cung cấp).
 * Chỉ là minh họa trong preview; không đụng tới tiến trình hệ thống thật.
 */
export function HostWindowOverlay() {
  const state = useAppStore((s) => s.hostWindowState);
  const reopen = useAppStore((s) => s.reopenWindow);
  const start = useAppStore((s) => s.startProviding);
  const hostSession = useAppStore((s) => s.hostSession);
  if (state === "open") return null;
  const hidden = state === "hidden";
  const live = hostSession && !isTerminal(hostSession.phase);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="ov-title" className="fixed inset-0 z-[55] flex flex-col items-center justify-center gap-6 bg-[#1b3a5c] p-8 text-white">
      <p className="absolute left-4 top-3 text-xs font-semibold text-sky">Mô phỏng: cửa sổ app đã đóng — đây là màn hình Windows minh họa</p>
      <div className="max-w-md text-center">
        {hidden ? <MonitorSmartphone className="mx-auto mb-3 h-10 w-10 text-teal-tint" aria-hidden /> : <Power className="mx-auto mb-3 h-10 w-10 text-warn-bg" aria-hidden />}
        <h2 id="ov-title" className="text-xl font-bold">{hidden ? "Cửa sổ đã đóng — app đang chạy nền" : "App đã thoát — máy ngừng được cung cấp"}</h2>
        <p className="mt-2 text-sm text-sky">
          {hidden
            ? `Biểu tượng vẫn ở khay hệ thống. Dịch vụ cung cấp máy ${live ? "và phiên đang chạy vẫn tiếp tục" : "vẫn hoạt động theo lịch"}. Đóng cửa sổ không phải là dừng cung cấp.`
            : "Vì chạy nền đang tắt, đóng cửa sổ đã dừng dịch vụ. Máy không nhận phiên mới; lịch không tự bật lại máy."}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" size="lg" onClick={() => { reopen(); if (!hidden) start(); navigate("/host/runtime"); }}>
          {hidden ? "Mở lại cửa sổ từ khay" : "Mở app và bắt đầu cung cấp lại"}
        </Button>
        {!hidden && <Button variant="secondary" size="lg" onClick={() => { reopen(); navigate("/host/runtime"); }}>Mở app (không cung cấp)</Button>}
      </div>
    </div>
  );
}

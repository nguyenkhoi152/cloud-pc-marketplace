import { useState, type ReactNode } from "react";
import { navigate } from "@/app/router";
import { isLive } from "@/api/env";
import { hostNative, hostNativeAvailable } from "@/api/hostNative";
import { hostingStatus, SIGN_OUT_WARNINGS, stopForSignOut, type SignOutDeps } from "@/domain/signOutGuard";
import { useAppStore } from "@/state/store";
import { ConfirmDialog } from "@/ui/confirm";

const nativeDeps = (): SignOutDeps => ({
  available: hostNativeAvailable,
  overview: hostNative.overview,
  probe: () => hostNative.probe(),
  agentStop: hostNative.agentStop,
  tunnelStop: hostNative.tunnelStop,
});

/**
 * Đăng xuất. Trong app Windows (chế độ thật), nếu máy này đang nhận thuê thì hỏi lại, dừng nhận thuê (máy chuyển offline,
 * phiên xem bị ngắt) rồi mới đăng xuất, để máy không còn hiện online khi chủ máy đã thoát. Các trường hợp khác: đăng xuất ngay.
 * `dialog` phải được render ở nơi KHÔNG bị gỡ khi menu đóng (nút gọi nằm trong popover).
 */
export function useSignOut(): { requestSignOut: () => void; busy: boolean; dialog: ReactNode } {
  const signOut = useAppStore((s) => s.signOut);
  const toast = useAppStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const finish = () => { signOut(); navigate("/welcome"); };

  const requestSignOut = () => {
    if (busy) return;
    if (!isLive() || !hostNativeAvailable()) { finish(); return; }
    setBusy(true);
    toast("Đang kiểm tra máy có đang nhận thuê không…");
    void hostingStatus(nativeDeps()).then((st) => {
      setBusy(false);
      if (st === "running") { setOpen(true); return; }
      if (st === "unknown") toast(SIGN_OUT_WARNINGS.unknown, "warn");
      finish();
    });
  };

  const stopAndSignOut = async () => {
    setBusy(true);
    toast("Đang dừng nhận thuê: ngắt phiên xem và dọn môi trường của khách…");
    const r = await stopForSignOut(nativeDeps());
    setBusy(false);
    if (!r.ok) toast(SIGN_OUT_WARNINGS.stopFailed(r.error), "error");
    finish();
  };

  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Máy của bạn đang nhận thuê"
      confirmLabel="Dừng nhận thuê và đăng xuất"
      cancelLabel="Ở lại"
      danger
      onConfirm={() => void stopAndSignOut()}
    >
      <p>Đăng xuất sẽ dừng nhận thuê: máy chuyển sang <strong>offline</strong> ngay và người thuê không đặt được nữa.</p>
      <p className="mt-2">Nếu đang có người thuê dùng máy, phiên của họ sẽ <strong>bị ngắt</strong> và môi trường của khách được dọn sạch.</p>
      <p className="mt-2">Muốn tiếp tục nhận thuê, đăng nhập lại rồi bấm "Bắt đầu nhận thuê" ở Thiết lập &amp; chạy máy.</p>
    </ConfirmDialog>
  );

  return { requestSignOut, busy, dialog };
}

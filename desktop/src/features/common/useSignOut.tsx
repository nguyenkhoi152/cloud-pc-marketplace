import { useState, type ReactNode } from "react";
import { navigate } from "@/app/router";
import { getLiveApi, getServerApi, serverApiConfigured } from "@/api";
import { isLive } from "@/api/env";
import { hostNative, hostNativeAvailable } from "@/api/hostNative";
import { inspectForSignOut, releaseEnrollment, SIGN_OUT_WARNINGS, stopForSignOut, type SignOutDeps } from "@/domain/signOutGuard";
import { useAppStore } from "@/state/store";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm";

const nativeDeps = (): SignOutDeps => ({
  available: hostNativeAvailable,
  overview: hostNative.overview,
  probe: () => hostNative.probe(),
  ownMachineIds: async () => (await getLiveApi().host.listMachines()).map((m) => m.id),
  agentStop: hostNative.agentStop,
  tunnelStop: hostNative.tunnelStop,
  unenroll: hostNative.unenroll,
  // Thu hồi thiết bị cần máy chủ API; chưa kết nối máy chủ thì chỉ xoá credential cục bộ.
  revokeDevice: serverApiConfigured() ? async (machineId) => { await getServerApi().revokeMyDevice(machineId); } : undefined,
});

/**
 * Đăng xuất. Trong app Windows (chế độ thật):
 *  - Máy đang nhận thuê ⇒ hỏi lại, dừng nhận thuê (máy offline, ngắt phiên, dọn môi trường khách), RỒI gỡ ghi danh máy khỏi bản Linux
 *    (xoá credential cục bộ + thu hồi thiết bị phía máy chủ) rồi mới đăng xuất.
 *  - Không nhận thuê nhưng bản Linux còn ghi danh cho máy của tài khoản này ⇒ gỡ ghi danh rồi đăng xuất.
 *    Nhờ vậy tài khoản khác đăng nhập trên cùng PC bắt đầu từ đầu, không dính máy của tài khoản trước.
 *  - Không kiểm tra được (WSL bận, hết giờ) ⇒ KHÔNG lặng lẽ đăng xuất: hỏi chủ máy thử dừng hay đăng xuất ngay.
 *  - Các trường hợp khác: đăng xuất ngay.
 * Việc gỡ ghi danh không bao giờ chặn đăng xuất: lỗi chỉ được báo. Không bao giờ gỡ ghi danh của máy không thuộc tài khoản này.
 * `dialog` phải được render ở nơi KHÔNG bị gỡ khi menu đóng (nút gọi nằm trong popover).
 */
export function useSignOut(): { requestSignOut: () => void; busy: boolean; dialog: ReactNode } {
  const signOut = useAppStore((s) => s.signOut);
  const toast = useAppStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [unknownOpen, setUnknownOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const finish = () => { signOut(); navigate("/welcome"); };

  /** Gỡ ghi danh máy khỏi bản Linux này và báo kết quả bằng một thông báo. */
  const release = async (machineId: string) => {
    toast("Đang gỡ ghi danh máy khỏi bản Linux này…");
    const r = await releaseEnrollment(nativeDeps(), machineId);
    if (r.errors.length > 0) toast(SIGN_OUT_WARNINGS.releaseFailed(r.errors.join("; ")), "warn");
    else toast(SIGN_OUT_WARNINGS.released, "ok");
  };

  const requestSignOut = () => {
    if (busy) return;
    if (!isLive() || !hostNativeAvailable()) { finish(); return; }
    setBusy(true);
    toast("Đang kiểm tra máy có đang nhận thuê không…");
    void inspectForSignOut(nativeDeps()).then(async (st) => {
      if (st.hosting === "running") { setBusy(false); setOpen(true); return; }
      if (st.hosting === "unknown") { setBusy(false); setUnknownOpen(true); return; }
      if (st.ownMachineId) await release(st.ownMachineId);
      setBusy(false);
      finish();
    });
  };

  const stopAndSignOut = async () => {
    setBusy(true);
    toast("Đang dừng nhận thuê: ngắt phiên xem và dọn môi trường của khách…");
    const r = await stopForSignOut(nativeDeps());
    if (!r.ok) {
      toast(SIGN_OUT_WARNINGS.stopFailed(r.error), "error");
    } else {
      // Agent đã dừng: giờ mới biết chắc máy nào của tài khoản này đang ghi danh trong bản Linux để gỡ.
      const after = await inspectForSignOut(nativeDeps());
      if (after.ownMachineId) await release(after.ownMachineId);
    }
    setBusy(false);
    finish();
  };

  const dialog = (
    <>
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
        <p className="mt-2">Đăng xuất cũng gỡ ghi danh máy khỏi bản Linux này: tài khoản khác đăng nhập trên máy này sẽ bắt đầu từ đầu.</p>
        <p className="mt-2">Muốn nhận thuê lại, đăng nhập rồi vào Thiết lập &amp; chạy máy, ghi danh máy của bạn và bấm "Bắt đầu nhận thuê".</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={unknownOpen}
        onOpenChange={setUnknownOpen}
        title="Chưa kiểm tra được máy có đang nhận thuê không"
        confirmLabel="Thử dừng nhận thuê rồi đăng xuất"
        cancelLabel="Ở lại"
        danger
        onConfirm={() => void stopAndSignOut()}
      >
        <p>App chưa đọc được trạng thái bản Linux (có thể WSL đang bận hoặc chưa sẵn sàng). Nếu máy của bạn đang nhận thuê, nó có thể <strong>vẫn hiện online</strong> sau khi bạn đăng xuất.</p>
        <p className="mt-2">Bạn có thể thử dừng nhận thuê rồi đăng xuất, hoặc đăng xuất ngay và dừng sau trong Thiết lập &amp; chạy máy.</p>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => { setUnknownOpen(false); toast(SIGN_OUT_WARNINGS.unknown, "warn"); finish(); }}>Vẫn đăng xuất ngay</Button>
        </div>
      </ConfirmDialog>
    </>
  );

  return { requestSignOut, busy, dialog };
}

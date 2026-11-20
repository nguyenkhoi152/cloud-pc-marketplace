import { useEffect, useState } from "react";
import { apiBase, setApiOverride } from "@/api";
import { connectTarget, onConnectLink, takePendingConnect, type ConnectTarget } from "@/api/connectLink";
import { apiHost } from "@/api/endpoint";
import { fetchChainInfo } from "@/api/server";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm";
import { Dialog } from "@/ui/dialog";

/**
 * Hộp xác nhận khi người dùng bấm liên kết kết nối (cloudpc://connect?server=…) từ người tổ chức. Hiện ở mọi màn (kể cả khi chưa đăng nhập).
 * LUÔN hỏi trước khi đổi máy chủ; chỉ lưu sau khi máy chủ mới trả lời /chain-info đúng dạng (cùng quy tắc với ô dán mã ở Cài đặt).
 */
export function ConnectLinkPrompt({ reload = () => window.location.reload() }: { reload?: () => void } = {}) {
  const [target, setTarget] = useState<ConnectTarget | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let alive = true;
    // Một nguồn duy nhất: mọi lần (mở app bằng liên kết, hoặc sự kiện khi app đang mở) đều lấy giá trị đang chờ từ lớp native.
    const pull = async () => {
      const raw = await takePendingConnect();
      if (!alive || !raw) return;
      const t = connectTarget(raw);
      if (t.ok && t.base === apiBase()) return; // đã dùng đúng máy chủ này
      setProblem("");
      setTarget(t);
    };
    void pull();
    const off = onConnectLink(() => void pull());
    return () => {
      alive = false;
      off();
    };
  }, []);

  const connect = async (base: string) => {
    const info = await fetchChainInfo(base);
    if (!info) return setProblem(`Không kết nối được tới ${apiHost(base)}. Hãy hỏi người gửi xem máy chủ còn hoạt động không, rồi xin liên kết mới.`);
    if (!(await setApiOverride(base))) return setProblem("Không lưu được cài đặt. Hãy thử lại.");
    reload();
  };

  if (problem) {
    return (
      <Dialog open onOpenChange={() => setProblem("")} title="Chưa kết nối được" footer={<Button variant="primary" onClick={() => setProblem("")}>Đóng</Button>}>
        <p className="text-sm text-ink-soft" data-testid="connect-problem">{problem}</p>
      </Dialog>
    );
  }
  if (!target) return null;
  if (!target.ok) {
    return (
      <Dialog open onOpenChange={() => setTarget(null)} title="Liên kết không dùng được" footer={<Button variant="primary" onClick={() => setTarget(null)}>Đóng</Button>}>
        <p className="text-sm text-ink-soft" data-testid="connect-rejected">{target.reason}</p>
      </Dialog>
    );
  }
  return (
    <ConfirmDialog open onOpenChange={(o) => !o && setTarget(null)} title="Kết nối máy chủ mới?" confirmLabel="Kết nối" cancelLabel="Không" onConfirm={() => void connect(target.base)}>
      <p>
        Liên kết yêu cầu app kết nối tới <span className="num font-semibold" data-testid="connect-host">{apiHost(target.base)}</span>.
      </p>
      <p className="mt-2">App gửi phiên đăng nhập của bạn tới máy chủ này. Chỉ đồng ý nếu liên kết đến từ người bạn tin.</p>
    </ConfirmDialog>
  );
}

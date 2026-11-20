import { useState } from "react";
import { apiBase, setApiOverride, walletProblem } from "@/api";
import { apiHost, isAllowedOverride, normalizeApiBase, OVERRIDE_HOST_SUFFIXES } from "@/api/endpoint";
import { fetchChainInfo } from "@/api/server";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/controls";
import { Banner } from "@/ui/feedback";
import { Section } from "@/ui/page";

/**
 * Cài đặt → Kết nối máy chủ (chỉ ở chế độ live). Người thử dán "mã kết nối" (địa chỉ https do người tổ chức gửi) để app gọi máy chủ API
 * của người đó thay vì địa chỉ lúc build. Chỉ lưu sau khi máy chủ trả lời /chain-info đúng định dạng — không lưu địa chỉ chưa kiểm chứng.
 */
export function ServerConnection() {
  const current = apiBase();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const connect = async () => {
    setErr("");
    setOk("");
    const n = normalizeApiBase(code);
    if (!n) return setErr("Địa chỉ không hợp lệ. Hãy dán địa chỉ bắt đầu bằng https://.");
    if (!isAllowedOverride(n)) return setErr(`${apiHost(n)} không nằm trong danh sách máy chủ được hỗ trợ (https://….${OVERRIDE_HOST_SUFFIXES[0]}) nên đã bị chặn để bảo vệ tài khoản của bạn.`);
    setBusy(true);
    try {
      const info = await fetchChainInfo(n);
      if (!info) return setErr(`Không kết nối được tới ${apiHost(n)}. Kiểm tra lại địa chỉ hoặc hỏi người gửi xem máy chủ còn hoạt động không.`);
      if (!(await setApiOverride(n))) return setErr("Không lưu được cài đặt. Hãy thử lại.");
      setOk(`Đã kết nối ${apiHost(n)}. Đang tải lại ứng dụng…`);
      setTimeout(() => window.location.reload(), 600);
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    await setApiOverride(null);
    window.location.reload();
  };

  return (
    <Section title="Kết nối máy chủ" className="py-4">
      <p className="mb-2 text-sm text-ink-soft">
        Đang dùng: <span className="num font-semibold" data-testid="api-current">{current ? apiHost(current) : "chưa kết nối"}</span>
      </p>
      <Banner tone="warn" className="mb-3" title="Chỉ nhập mã từ người bạn tin">
        Ứng dụng gửi phiên đăng nhập của bạn tới máy chủ này, nên chỉ nhập địa chỉ từ người bạn tin. Địa chỉ có thể thay đổi mỗi khi máy chủ khởi động lại.
      </Banner>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
        <Field label="Mã kết nối" htmlFor="api-code" hint="Dán địa chỉ bạn nhận được.">
          <Input id="api-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://…" autoComplete="off" spellCheck={false} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy || !code.trim()}>{busy ? "Đang kiểm tra…" : "Kiểm tra và kết nối"}</Button>
          <Button variant="secondary" onClick={() => void reset()} disabled={busy}>Dùng máy chủ mặc định</Button>
        </div>
      </form>
      {walletProblem() && <Banner tone="warn" className="mt-3" title="Ví chưa sẵn sàng">{walletProblem()}</Banner>}
      {err && <Banner tone="danger" className="mt-3" title="Chưa kết nối được">{err}</Banner>}
      {ok && <Banner tone="ok" className="mt-3" title="Đã kết nối">{ok}</Banner>}
    </Section>
  );
}

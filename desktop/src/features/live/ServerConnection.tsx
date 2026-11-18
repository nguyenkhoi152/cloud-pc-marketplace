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
    if (!n) return setErr("Mã kết nối phải là địa chỉ https:// (ví dụ https://ten-ngau-nhien.trycloudflare.com). Không dùng http:// trừ khi chạy trên chính máy này.");
    if (!isAllowedOverride(n)) return setErr(`Bản app này chỉ cho phép mã kết nối dạng https://….${OVERRIDE_HOST_SUFFIXES[0]} (hoặc chạy trên chính máy này). ${apiHost(n)} bị chặn để bảo vệ phiên đăng nhập của bạn.`);
    setBusy(true);
    try {
      const info = await fetchChainInfo(n);
      if (!info) return setErr(`Không đọc được ${apiHost(n)}: máy chủ không trả lời hoặc không phải máy chủ Cloud PC Companion. Kiểm tra mã và hỏi người tổ chức xem máy chủ còn chạy không.`);
      if (!(await setApiOverride(n))) return setErr("Không lưu được cài đặt (trình duyệt chặn lưu trữ).");
      setOk(`Đã kết nối ${apiHost(n)} (chuỗi ${info.chainId}${info.faucet ? ", có vòi PCP thử" : ""}). Đang tải lại app…`);
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
        Đang dùng: <span className="num font-semibold" data-testid="api-current">{current ? apiHost(current) : "chưa cấu hình"}</span>
      </p>
      <Banner tone="warn" className="mb-3" title="Chỉ nhập mã từ người bạn tin">
        App gửi phiên đăng nhập của bạn tới máy chủ này. Máy chủ lạ có thể dùng phiên đó để hành động nhân danh bạn trong bản thử. Mã thường có dạng https://….trycloudflare.com và đổi mỗi lần người tổ chức khởi động lại.
      </Banner>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
        <Field label="Mã kết nối" htmlFor="api-code" hint="Dán địa chỉ người tổ chức gửi.">
          <Input id="api-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://…trycloudflare.com" autoComplete="off" spellCheck={false} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy || !code.trim()}>{busy ? "Đang kiểm tra…" : "Kiểm tra và kết nối"}</Button>
          <Button variant="secondary" onClick={() => void reset()} disabled={busy}>Về mặc định của bản cài</Button>
        </div>
      </form>
      {walletProblem() && <Banner tone="warn" className="mt-3" title="Chưa có ví thử">{walletProblem()}</Banner>}
      {err && <Banner tone="danger" className="mt-3" title="Chưa kết nối được">{err}</Banner>}
      {ok && <Banner tone="ok" className="mt-3" title="Đã kết nối">{ok}</Banner>}
    </Section>
  );
}

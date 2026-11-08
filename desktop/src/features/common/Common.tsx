import { Bell, Coins, Mail, MessageSquareText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { navigate } from "@/app/router";
import type { Transaction, TxKind } from "@/domain/types";
import { service } from "@/mock/service";
import { useAppStore } from "@/state/store";
import { useAsync } from "@/state/useAsync";
import { Badge, DemoTag } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox, Field, Input, Select, Segmented, Switch } from "@/ui/controls";
import { Async, Banner, EmptyState } from "@/ui/feedback";
import { KeyValue, Money, PageHeader, Section } from "@/ui/page";
import { ApprovalBadge } from "@/ui/status";
import { cn } from "@/lib/utils";

/* ===================== Số dư & giao dịch ===================== */
const TX_LABEL: Record<TxKind, string> = { faucet: "Nhận PCP thử", hold: "Tạm giữ", charge: "Thuê máy", refund: "Hoàn", host_earning: "Thu nhập host" };

export function WalletScreen() {
  const w = useAppStore((s) => s.wallet);
  const claim = useAppStore((s) => s.claimFaucet);
  const approval = useAppStore((s) => s.account.hostApproval);
  const [view, setView] = useState<"all" | "usable" | "host">("all");
  const rows: Transaction[] = w.transactions.filter((t) => view === "all" || t.ledger === view);
  return (
    <>
      <PageHeader title="Số dư và giao dịch" subtitle="PCP là điểm thử nghiệm, không phải tiền thật. Số dư để thuê máy và thu nhập host là hai sổ riêng." actions={<DemoTag />} />
      <div className="grid grid-cols-2 gap-10 border-b border-line pb-6">
        <section aria-labelledby="usable-h">
          <h2 id="usable-h" className="text-sm font-bold text-ink-soft">Số dư để thuê máy</h2>
          <p className="mt-1"><Money value={w.usable} className="text-3xl" /></p>
          <p className="mt-1 text-xs text-ink-faint">Dùng để trả phí thuê. Không lẫn với thu nhập host.</p>
          <Button className="mt-3" size="sm" variant="secondary" disabled={w.faucetClaimed} onClick={claim}>{w.faucetClaimed ? "Đã nhận PCP thử (mỗi tài khoản một lần)" : "Nhận 1.000 PCP thử"}</Button>
        </section>
        <section aria-labelledby="host-h">
          <h2 id="host-h" className="flex items-center gap-2 text-sm font-bold text-ink-soft">Thu nhập host <ApprovalBadge approval={approval} /></h2>
          <p className="mt-1"><Money value={w.hostSettled} className="text-3xl" /></p>
          <p className="mt-1 text-xs text-ink-faint">Đang giữ chờ xác nhận dọn dẹp: <Money value={w.hostHeld} />. Không dùng trực tiếp để thuê máy và không đổi ra tiền.</p>
        </section>
      </div>
      <Section title="Lịch sử giao dịch" className="mt-6" aside={<Segmented label="Lọc sổ" value={view} onChange={setView} items={[{ value: "all", label: "Tất cả" }, { value: "usable", label: "Để thuê" }, { value: "host", label: "Thu nhập host" }]} />}>
        {rows.length === 0 ? <EmptyState icon={Coins} title="Chưa có giao dịch ở sổ này" /> : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full table-fixed text-left text-sm">
              <caption className="sr-only">Lịch sử giao dịch PCP thử</caption>
              <thead className="border-b border-line bg-subtle text-xs text-ink-faint"><tr><th scope="col" className="w-[17%] px-4 py-2 font-semibold">Thời gian</th><th scope="col" className="w-[15%] px-4 py-2 font-semibold">Loại</th><th scope="col" className="px-4 py-2 font-semibold">Nội dung</th><th scope="col" className="w-[15%] px-4 py-2 font-semibold">Sổ</th><th scope="col" className="w-[17%] px-4 py-2 text-right font-semibold">Số tiền</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="num px-4 py-2.5 text-ink-soft">{t.at}</td>
                    <td className="px-4 py-2.5">{TX_LABEL[t.kind]}</td>
                    <td className="px-4 py-2.5">{t.label}{t.status === "held" && <Badge tone="warn" className="ml-2">Đang giữ</Badge>}</td>
                    <td className="px-4 py-2.5 text-ink-soft">{t.ledger === "usable" ? "Để thuê" : "Thu nhập host"}</td>
                    <td className={cn("px-4 py-2.5 text-right", t.amount < 0 ? "text-ink" : "text-ok")}><Money value={t.amount} signed /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

/* ===================== Thông báo ===================== */
export function Notifications() {
  const state = useAsync(() => service.listNotifications());
  const mode = useAppStore((s) => s.account.mode);
  const refresh = useAppStore((s) => s.refreshData);
  const [scope, setScope] = useState<"mode" | "all">("mode");
  const tone = { info: "info", ok: "ok", warn: "warn", error: "danger" } as const;
  return (
    <>
      <PageHeader title="Thông báo" actions={<><Segmented label="Phạm vi thông báo" value={scope} onChange={setScope} items={[{ value: "mode", label: mode === "rent" ? "Thuê máy" : "Cho thuê máy" }, { value: "all", label: "Tất cả" }]} /><Button variant="secondary" onClick={() => { service.markAllNotifications(); refresh(); }}>Đánh dấu đã đọc hết</Button></>} />
      <Async state={state} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={Bell} title="Chưa có thông báo">Cập nhật về phiên, duyệt máy và sự cố sẽ hiện ở đây.</EmptyState>}>
        {(all) => {
          const list = all.filter((n) => scope === "all" || n.scope === "all" || n.scope === mode);
          return list.length === 0 ? <EmptyState icon={Bell} title="Không có thông báo trong chế độ này" /> : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {list.map((n) => (
                <li key={n.id} className={cn("flex items-start gap-3 px-4 py-3", !n.read && "bg-teal-tint/40")}>
                  <Badge tone={tone[n.tone]} className="mt-0.5 shrink-0">{n.tone === "ok" ? "Tốt" : n.tone === "info" ? "Thông tin" : n.tone === "warn" ? "Lưu ý" : "Lỗi"}</Badge>
                  <div className="min-w-0 flex-1"><p className="font-semibold">{n.title}{!n.read && <span className="ml-2 text-xs font-bold text-teal-dark">· Mới</span>}</p><p className="text-sm text-ink-soft">{n.body}</p><p className="num mt-0.5 text-xs text-ink-faint">{n.at} · {n.scope === "rent" ? "Thuê máy" : n.scope === "host" ? "Cho thuê máy" : "Chung"}</p></div>
                  <Button size="sm" variant="ghost" onClick={() => { service.markNotification(n.id, !n.read); refresh(); }}>{n.read ? "Đánh dấu chưa đọc" : "Đã đọc"}</Button>
                </li>
              ))}
            </ul>
          );
        }}
      </Async>
    </>
  );
}

/* ===================== Hỗ trợ ===================== */
const FAQ = [
  { q: "Chọn chế độ Cho thuê máy có tự cho tôi nhận khách không?", a: "Không. Chế độ chỉ đổi giao diện. Bạn phải kiểm tra máy, đồng ý thành phần, gửi đăng và được duyệt, rồi bật dịch vụ cung cấp." },
  { q: "Game Windows nào cũng chạy được chứ?", a: "Không. Phiên là desktop Linux. Mỗi máy ghi mức hỗ trợ cho từng ứng dụng/game: đã kiểm tra, có hạn chế, hoặc chưa kiểm tra. Game có anti-cheat thường không chạy." },
  { q: "Dữ liệu của tôi có an toàn tuyệt đối không?", a: "Không thể hứa như vậy: chủ máy có quyền quản trị máy vật lý. Đừng nhập mật khẩu hay dữ liệu nhạy cảm. Không lưu workspace thì dữ liệu bị xóa khi kết thúc." },
  { q: "Lịch của host có tự bật máy không?", a: "Không. Lịch chỉ là giờ sẵn sàng. Dịch vụ cung cấp phải đang chạy và máy phải online." },
  { q: "Nếu dọn dẹp sau phiên thất bại thì sao?", a: "Máy bị khóa, không nhận khách tiếp cho tới khi dọn dẹp được xác minh. Thu nhập của host cho phiên đó được giữ chờ xác nhận." },
  { q: "PCP là gì?", a: "Điểm thử nghiệm của bản xem trước. Không phải tiền thật, không rút hay quy đổi." },
];
export function Support() {
  const toast = useAppStore((s) => s.toast);
  const [open, setOpen] = useState<number | null>(0);
  const [f, setF] = useState({ topic: "session", msg: "" });
  const [err, setErr] = useState("");
  return (
    <>
      <PageHeader title="Hỗ trợ" subtitle="Câu hỏi thường gặp và gửi yêu cầu (mô phỏng — chưa có đội hỗ trợ thật)." />
      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-10">
        <Section title="Câu hỏi thường gặp">
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {FAQ.map((x, i) => (
              <li key={x.q}>
                <h3><button type="button" aria-expanded={open === i} aria-controls={`faq-${i}`} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-semibold hover:bg-subtle">{x.q}<span aria-hidden className="text-ink-faint">{open === i ? "−" : "+"}</span></button></h3>
                {open === i && <p id={`faq-${i}`} className="px-4 pb-3 text-sm text-ink-soft">{x.a}</p>}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Gửi yêu cầu hỗ trợ">
          <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); if (f.msg.trim().length < 10) return setErr("Mô tả ít nhất 10 ký tự."); setErr(""); setF({ ...f, msg: "" }); toast("Đã ghi nhận yêu cầu (mô phỏng). Không có email nào được gửi.", "ok"); }}>
            <Field label="Chủ đề" htmlFor="topic"><Select id="topic" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}><option value="session">Phiên thuê</option><option value="host">Cho thuê máy</option><option value="balance">Số dư PCP thử</option><option value="other">Khác</option></Select></Field>
            <Field label="Mô tả" htmlFor="msg" error={err}><textarea id="msg" rows={5} value={f.msg} onChange={(e) => setF({ ...f, msg: e.target.value })} aria-invalid={!!err} className="w-full rounded-md border border-line-strong bg-surface p-3 text-sm aria-[invalid=true]:border-danger" /></Field>
            <Button type="submit" variant="primary" className="w-full"><MessageSquareText className="h-4 w-4" aria-hidden />Gửi yêu cầu</Button>
          </form>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-faint"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Đừng gửi mật khẩu hay khóa riêng.</p>
        </Section>
      </div>
    </>
  );
}

/* ===================== Cài đặt ===================== */
export function SettingsScreen() {
  const s = useAppStore((a) => a.settings);
  const up = useAppStore((a) => a.updateSettings);
  const reset = useAppStore((a) => a.resetDemo);
  const Row = ({ id, title, desc, value, onChange }: { id: string; title: string; desc: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between gap-6 py-3">
      <div><label htmlFor={id} className="font-semibold">{title}</label><p className="text-sm text-ink-soft">{desc}</p></div>
      <Switch id={id} label={title} checked={value} onCheckedChange={onChange} />
    </div>
  );
  return (
    <>
      <PageHeader title="Cài đặt" subtitle="Các lựa chọn chỉ có tác dụng trong bản xem trước." />
      <div className="max-w-2xl divide-y divide-line">
        <Section title="Giao diện" className="pb-4"><Row id="rm" title="Giảm chuyển động" desc="Tắt hiệu ứng chuyển cảnh. App cũng tự theo cài đặt hệ thống “giảm chuyển động”." value={s.reduceMotion} onChange={(v) => up({ reduceMotion: v })} /></Section>
        <Section title="Thông báo" className="py-4">
          <Row id="nd" title="Thông báo trên máy" desc="Hiện thông báo khi phiên bắt đầu/kết thúc, máy được duyệt hoặc có sự cố (mô phỏng)." value={s.notifyDesktop} onChange={(v) => up({ notifyDesktop: v })} />
          <Row id="ne" title="Thông báo qua email" desc="Không có email thật nào được gửi trong bản xem trước." value={s.notifyEmail} onChange={(v) => up({ notifyEmail: v })} />
        </Section>
        <Section title="Cho thuê máy" className="py-4"><Row id="bg" title="Chạy nền khi đóng cửa sổ" desc="Giữ dịch vụ cung cấp máy chạy ở khay hệ thống. Đóng cửa sổ không phải là dừng cung cấp." value={s.hostBackground} onChange={(v) => up({ hostBackground: v })} /></Section>
        <Section title="Dữ liệu demo" className="pt-4">
          <p className="mb-3 text-sm text-ink-soft">Đặt lại toàn bộ dữ liệu mô phỏng và kịch bản về mặc định.</p>
          <Button variant="danger-outline" onClick={reset}>Đặt lại dữ liệu demo</Button>
        </Section>
      </div>
    </>
  );
}

/* ===================== Tài khoản ===================== */
export function AccountScreen() {
  const a = useAppStore((s) => s.account);
  const signOut = useAppStore((s) => s.signOut);
  const toast = useAppStore((s) => s.toast);
  const [name, setName] = useState(a.name);
  const [agree, setAgree] = useState(false);
  return (
    <>
      <PageHeader title="Tài khoản" subtitle="Một tài khoản cho cả thuê máy và cho thuê máy." />
      <div className="grid max-w-3xl grid-cols-2 gap-10">
        <Section title="Hồ sơ">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); toast("Đã lưu hồ sơ (mô phỏng).", "ok"); }}>
            <Field label="Tên hiển thị" htmlFor="an"><Input id="an" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Email" htmlFor="ae"><Input id="ae" value={a.email} readOnly /></Field>
            <Button type="submit" variant="primary" disabled={!name.trim()}>Lưu</Button>
          </form>
        </Section>
        <Section title="Trạng thái">
          <KeyValue items={[
            { k: "Chế độ hiện tại", v: a.mode === "rent" ? "Thuê máy" : "Cho thuê máy" },
            { k: "Quyền host", v: <ApprovalBadge approval={a.hostApproval} /> },
          ]} />
          <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-faint"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Quyền host chỉ có khi máy được duyệt; đổi chế độ không thay đổi quyền.</p>
          <div className="mt-4 border-t border-line pt-4">
            <Checkbox checked={agree} onChange={setAgree} label="Tôi muốn đăng xuất khỏi bản xem trước" />
            <Button className="mt-2" variant="secondary" disabled={!agree} onClick={() => { signOut(); navigate("/welcome"); }}>Đăng xuất</Button>
          </div>
        </Section>
      </div>
      <Banner tone="info" className="mt-6 max-w-3xl">Ví thật chưa được kết nối. PCP thử là điểm giả lập trong bản xem trước.</Banner>
    </>
  );
}

import { CalendarClock, CircleSlash, Power, Rocket, ShieldAlert, Users, X } from "lucide-react";
import { useState } from "react";
import { navigate, Link } from "@/app/router";
import { formatClock, formatDuration } from "@/domain/clock";
import { hostMachineState, receiveGate } from "@/domain/access";
import { isTerminal } from "@/domain/session";
import { isInsideOfferWindow, upcomingWindows } from "@/domain/schedule";
import { HOST_PROFILES } from "@/mock/fixtures";
import { service } from "@/api";
import { useAppStore } from "@/state/store";
import { useAsync } from "@/state/useAsync";
import { Badge, DemoTag } from "@/ui/badge";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm";
import { Dialog } from "@/ui/dialog";
import { Field, Switch } from "@/ui/controls";
import { Async, Banner, EmptyState } from "@/ui/feedback";
import { KeyValue, Money, PageHeader, Section } from "@/ui/page";
import { ApprovalBadge, HostStateBadge, PhaseBadge } from "@/ui/status";
import { ConfigureForm } from "./ConfigureForm";
import { UpcomingPreview } from "./ScheduleEditor";

function useHostView() {
  const s = useAppStore();
  const inputs = {
    approval: s.account.hostApproval,
    agentRunning: s.hostAgentRunning,
    accepting: s.hostAccepting,
    insideWindow: isInsideOfferWindow(s.hostSetup.config.weekly, s.hostSetup.config.exceptions),
    blocked: s.hostBlocked,
    online: s.online,
  };
  const live = !!s.hostSession && !isTerminal(s.hostSession.phase);
  return { s, inputs, gate: receiveGate(inputs), state: hostMachineState({ ...inputs, hasActiveSession: live }), live };
}

function NotReady() {
  const approval = useAppStore((s) => s.account.hostApproval);
  return (
    <>
      <PageHeader title="Cho thuê máy" subtitle="Bạn đang ở chế độ Cho thuê máy, nhưng chế độ này không tự cấp quyền host." actions={<ApprovalBadge approval={approval} />} />
      {approval === "pending" ? (
        <EmptyState icon={CalendarClock} title="Máy đang chờ duyệt" action={<Button variant="primary" onClick={() => navigate("/host/onboarding/status")}>Xem trạng thái duyệt</Button>}>Máy chưa hiện cho người thuê và chưa nhận khách cho tới khi được duyệt.</EmptyState>
      ) : (
        <EmptyState icon={Rocket} title={approval === "rejected" ? "Bài đăng bị từ chối" : "Máy chưa được thiết lập"} action={<Button variant="primary" onClick={() => navigate("/host/onboarding/intro")}>{approval === "rejected" ? "Sửa và gửi lại" : "Bắt đầu thiết lập"}</Button>}>
          Hoàn tất kiểm tra máy, đồng ý thành phần, cấu hình giá và lịch, rồi chờ duyệt. Chỉ khi được duyệt, máy mới nhận khách.
        </EmptyState>
      )}
    </>
  );
}

/* ===================== Tổng quan ===================== */
export function HostDashboard() {
  const { s, gate, state, live } = useHostView();
  const [endOpen, setEndOpen] = useState(false);
  if (s.account.hostApproval !== "approved") return <NotReady />;
  const cfg = s.hostSetup.config;
  const profile = HOST_PROFILES.find((p) => p.id === s.hostSetup.profileId)!;
  const hs = s.hostSession;
  const up = upcomingWindows(cfg.weekly, cfg.exceptions, 7).slice(0, 5);

  const sim = () => {
    const r = s.simulateGuest();
    if (!r.ok) s.toast(r.reasons.join(" "), "warn");
  };

  return (
    <>
      <PageHeader title={cfg.name} subtitle="Tổng quan máy của bạn. Trạng thái và số liệu là mô phỏng." actions={<><HostStateBadge state={state} /><DemoTag /></>} />

      <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-surface px-5 py-4" aria-label="Nhận phiên mới">
        <div className="max-w-xl">
          <p className="font-bold">Nhận phiên mới</p>
          <p className="text-sm text-ink-soft">Tắt để tạm nghỉ: phiên đang chạy vẫn tiếp tục, chỉ không nhận thêm khách mới.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold" id="acc-label">{s.hostAccepting ? "Đang bật" : "Tạm nghỉ"}</span>
          <Switch label="Nhận phiên mới" checked={s.hostAccepting} onCheckedChange={s.setAccepting} />
        </div>
      </section>

      {!gate.ok && (
        <Banner tone={s.hostBlocked ? "danger" : "warn"} className="mb-6" title="Hiện máy chưa nhận khách mới">
          <ul className="list-disc pl-4">{gate.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <div className="mt-2 flex gap-2">
            {!s.hostAgentRunning && <Button size="sm" variant="primary" onClick={s.startProviding}>Bắt đầu cung cấp</Button>}
            {s.hostBlocked && <Button size="sm" variant="secondary" onClick={() => navigate("/host/incidents")}>Xem sự cố</Button>}
          </div>
        </Banner>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-8">
        <div className="space-y-7">
          <Section title="Phiên đang chạy">
            {live && hs ? (
              <div className="rounded-lg border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-bold">{hs.hostAlias}</p><p className="text-sm text-ink-soft">Thuê {formatDuration(hs.durationMin)} · phiên là desktop Linux riêng, bạn không xem được nội dung.</p></div>
                  <PhaseBadge phase={hs.phase} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="num text-xl font-bold" aria-label={`Còn lại ${formatClock(hs.remainingSec)}`}>Còn {formatClock(hs.remainingSec)}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => s.hostSkipTime(10)}>Demo: tua 10 phút</Button>
                    <Button size="sm" variant="danger-outline" disabled={hs.phase !== "active"} onClick={() => setEndOpen(true)}>Kết thúc phiên</Button>
                  </div>
                </div>
              </div>
            ) : hs && !isTerminal(hs.phase) ? null : (
              <div className="rounded-lg border border-dashed border-line-strong px-5 py-6 text-center">
                <Users className="mx-auto mb-2 h-6 w-6 text-ink-faint" aria-hidden />
                <p className="font-semibold">Chưa có phiên nào đang chạy</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">Khi có khách thuê, phiên sẽ hiện ở đây.</p>
                <Button className="mt-3" variant="secondary" onClick={sim}>Demo: mô phỏng có khách thuê</Button>
                {!gate.ok && <p className="mt-2 text-xs text-ink-faint">Nút demo bị chặn khi máy chưa đủ điều kiện nhận khách (xem cảnh báo phía trên).</p>}
              </div>
            )}
            {hs && (hs.phase === "ending" || hs.phase === "cleaning") && <p className="mt-2 text-sm text-ink-soft">Phiên đã kết thúc, đang {hs.phase === "ending" ? "kết thúc" : "dọn dẹp"}. Máy chưa nhận khách mới cho tới khi dọn dẹp xong.</p>}
            {hs?.phase === "cleanup_failed" && <Banner tone="danger" className="mt-2" title="Dọn dẹp thất bại — máy bị khóa" action={<Button size="sm" variant="primary" onClick={() => navigate("/host/incidents")}>Xử lý</Button>}>Máy sẽ không nhận khách cho tới khi dọn dẹp được xác minh.</Banner>}
          </Section>

          <Section title="Lịch 7 ngày tới" aside={<Button size="sm" variant="secondary" onClick={() => navigate("/host/configure")}>Sửa lịch</Button>}>
            <UpcomingPreview weekly={cfg.weekly} exceptions={cfg.exceptions} />
            <p className="mt-2 text-xs text-ink-faint">{up.length ? "Lịch chỉ là giờ sẵn sàng; không tự bật máy." : "Chưa có khung giờ sắp tới."}</p>
          </Section>
        </div>

        <aside className="space-y-6">
          <Section title="Tài nguyên chia sẻ">
            <KeyValue items={[
              { k: "CPU", v: `${cfg.cores}/${profile.cores} nhân` },
              { k: "RAM", v: `${cfg.ramGb}/${profile.ramGb} GB` },
              { k: "GPU", v: cfg.shareGpu && profile.gpu ? profile.gpu.replace("NVIDIA ", "") : "Không chia sẻ" },
              { k: "Ổ phiên", v: `${cfg.storageGb} GB` },
              { k: "Giá", v: `${cfg.pricePer15} PCP / 15′` },
            ]} />
            <p className="mt-2 text-xs text-ink-faint">Mức dùng thực tế chưa có: cần host-agent thật, chưa tích hợp.</p>
          </Section>
          <Section title="Dịch vụ cung cấp máy">
            <p className="text-sm">{s.hostAgentRunning ? <Badge tone="ok">Đang chạy</Badge> : <Badge tone="neutral">Đã dừng</Badge>}</p>
            <p className="mt-2 text-xs text-ink-soft">Đóng cửa sổ app, chạy nền và dừng cung cấp là ba việc khác nhau.</p>
            <Link to="/host/runtime" className="mt-1 inline-block rounded text-sm font-semibold text-teal-dark hover:underline">Xem chi tiết</Link>
          </Section>
        </aside>
      </div>

      <ConfirmDialog open={endOpen} onOpenChange={setEndOpen} title="Kết thúc phiên của khách?" danger confirmLabel="Kết thúc phiên" onConfirm={s.hostEndSession}>
        Khách sẽ bị ngắt khỏi phiên và môi trường sẽ được dọn dẹp. Chỉ làm khi thật sự cần (ví dụ sự cố). Việc hoàn tiền cho khách bị ngắt phiên sẽ đi qua khiếu nại/trọng tài trong hệ thống thật (chưa mô phỏng).
      </ConfirmDialog>
    </>
  );
}

/* ===================== Cấu hình sau duyệt ===================== */
export function HostConfigure() {
  const approval = useAppStore((s) => s.account.hostApproval);
  return (
    <>
      <PageHeader title="Tài nguyên, giá và lịch" subtitle="Chỉnh phần chia sẻ, giá và giờ cung cấp. Thay đổi lưu tự động vào bản nháp (mô phỏng)." actions={<ApprovalBadge approval={approval} />} />
      {approval !== "approved" && <Banner tone="info" className="mb-4">Máy chưa được duyệt nên các thay đổi này chưa ảnh hưởng tới người thuê. <button type="button" className="font-bold underline" onClick={() => navigate("/host/onboarding/intro")}>Mở thiết lập</button></Banner>}
      {approval === "approved" && <Banner tone="info" className="mb-4">Đây là bản xem trước: thay đổi chỉ áp dụng cho phiên mới. Phiên đang chạy không bị đổi giờ hay giá.</Banner>}
      <ConfigureForm />
    </>
  );
}

/* ===================== Phiên ===================== */
export function HostSessions() {
  const { s, live } = useHostView();
  if (s.account.hostApproval !== "approved") return <NotReady />;
  const hs = s.hostSession;
  return (
    <>
      <PageHeader title="Phiên" subtitle="Phiên đang chạy và lịch sử phiên của máy bạn (mô phỏng)." />
      <Section title="Đang chạy">
        {live && hs ? (
          <div className="flex items-center justify-between rounded-lg border border-line bg-surface p-4">
            <div><p className="font-bold">{hs.hostAlias}</p><p className="num text-sm text-ink-soft">Còn {formatClock(hs.remainingSec)} / {formatDuration(hs.durationMin)}</p></div>
            <PhaseBadge phase={hs.phase} />
          </div>
        ) : <p className="text-sm text-ink-soft">Không có phiên đang chạy. <Link to="/host" className="font-semibold text-teal-dark hover:underline">Về tổng quan</Link> để mô phỏng có khách.</p>}
      </Section>
      <Section title="Lịch sử" className="mt-8">
        {s.hostRecords.length === 0 ? <EmptyState title="Chưa có phiên nào hoàn tất">Các phiên đã kết thúc sẽ hiện ở đây cùng thu nhập tương ứng.</EmptyState> : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Lịch sử phiên của host</caption>
              <thead className="border-b border-line bg-subtle text-xs text-ink-faint"><tr><th scope="col" className="px-4 py-2 font-semibold">Khách</th><th scope="col" className="px-4 py-2 font-semibold">Lúc</th><th scope="col" className="px-4 py-2 font-semibold">Đã dùng</th><th scope="col" className="px-4 py-2 text-right font-semibold">Thu nhập</th><th scope="col" className="px-4 py-2 font-semibold">Trạng thái</th></tr></thead>
              <tbody>{s.hostRecords.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0"><td className="px-4 py-2.5 font-semibold">{r.guest}</td><td className="num px-4 py-2.5 text-ink-soft">{r.at}</td><td className="num px-4 py-2.5">{r.minutes} phút</td><td className="px-4 py-2.5 text-right"><Money value={r.earned} /></td><td className="px-4 py-2.5">{r.status === "settled" ? <Badge tone="ok">Đã ghi nhận</Badge> : <Badge tone="warn">Chờ xác nhận dọn dẹp</Badge>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

/* ===================== Thu nhập ===================== */
export function HostEarnings() {
  const w = useAppStore((s) => s.wallet);
  const approval = useAppStore((s) => s.account.hostApproval);
  if (approval !== "approved") return <NotReady />;
  const rows = w.transactions.filter((t) => t.ledger === "host");
  return (
    <>
      <PageHeader title="Thu nhập host" subtitle="Thu nhập thử nghiệm, tách riêng khỏi số dư dùng để thuê máy." actions={<DemoTag />} />
      <div className="mb-6 grid max-w-2xl grid-cols-2 gap-8 border-b border-line pb-5">
        <div><p className="text-sm text-ink-faint">Đã ghi nhận</p><p className="text-2xl"><Money value={w.hostSettled} className="text-2xl" /></p><p className="text-xs text-ink-faint">Ghi nhận sau khi dọn dẹp phiên được xác nhận.</p></div>
        <div><p className="text-sm text-ink-faint">Đang giữ</p><p className="text-2xl"><Money value={w.hostHeld} className="text-2xl" /></p><p className="text-xs text-ink-faint">Chờ dọn dẹp thành công.</p></div>
      </div>
      <Banner tone="info" className="mb-5">PCP thử không phải tiền thật và không đổi được thành tiền. Số dư để thuê máy của bạn ({w.usable.toLocaleString("vi-VN")} PCP thử) là một sổ khác, xem ở mục Số dư.</Banner>
      {rows.length === 0 ? <EmptyState title="Chưa có thu nhập">Thu nhập xuất hiện sau khi một phiên của khách kết thúc.</EmptyState> : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">{rows.map((t) => <li key={t.id} className="flex items-center justify-between px-4 py-3"><div><p className="font-semibold">{t.label}</p><p className="text-xs text-ink-faint">{t.at}</p></div><div className="text-right"><Money value={t.amount} signed />{t.status === "held" && <p className="text-xs font-semibold text-warn">Đang giữ</p>}</div></li>)}</ul>
      )}
    </>
  );
}

/* ===================== Sự cố ===================== */
export function HostIncidents() {
  const state = useAsync(() => service.listIncidents());
  const s = useAppStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (s.account.hostApproval !== "approved") return <NotReady />;
  const submit = () => {
    if (!text.trim()) return;
    service.addIncident({ id: `i-${Date.now()}`, at: "09/11 20:10", kind: "other", status: "open", title: "Báo cáo của host", detail: text.trim() });
    s.refreshData();
    setOpen(false);
    setText("");
    s.toast("Đã ghi nhận báo cáo (mô phỏng).", "ok");
  };
  return (
    <>
      <PageHeader title="Sự cố" subtitle="Những việc cần bạn xử lý để máy tiếp tục nhận khách." actions={<Button variant="secondary" onClick={() => setOpen(true)}><ShieldAlert className="h-4 w-4" aria-hidden />Báo sự cố</Button>} />
      <Async state={state} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={ShieldAlert} title="Không có sự cố">Mọi thứ bình thường. Khi dọn dẹp thất bại hoặc có lỗi khác, sự cố sẽ hiện ở đây.</EmptyState>}>
        {(list) => (
          <ul className="space-y-3">
            {list.map((i) => (
              <li key={i.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-bold">{i.title}</p><p className="text-xs text-ink-faint">{i.at}</p></div>
                  {i.status === "open" ? <Badge tone="danger">Đang mở</Badge> : <Badge tone="ok">Đã xử lý</Badge>}
                </div>
                <p className="mt-2 text-sm text-ink-soft">{i.detail}</p>
                {i.status === "open" && i.kind === "cleanup" && (
                  <div className="mt-3 flex items-center gap-2">
                    <Button variant="primary" size="sm" disabled={s.hostSession?.phase !== "cleanup_failed"} onClick={s.retryHostCleanup}>Thử dọn lại</Button>
                    <Button variant="secondary" size="sm" onClick={() => navigate("/support")}>Liên hệ hỗ trợ</Button>
                    <span className="text-xs text-ink-faint">Máy chỉ mở khóa khi dọn dẹp được xác minh thành công.</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Async>
      <Dialog open={open} onOpenChange={setOpen} title="Báo sự cố" description="Mô tả ngắn điều đã xảy ra. Không gửi mật khẩu hay dữ liệu cá nhân." footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Hủy</Button><Button variant="primary" disabled={!text.trim()} onClick={submit}>Gửi báo cáo</Button></>}>
        <Field label="Mô tả" htmlFor="inc"><textarea id="inc" rows={4} value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-md border border-line-strong bg-surface p-3 text-sm" /></Field>
      </Dialog>
    </>
  );
}

/* ===================== Chạy nền & dừng ===================== */
export function HostRuntime() {
  const { s, live } = useHostView();
  const [stopOpen, setStopOpen] = useState(false);
  const [closeWarn, setCloseWarn] = useState(false);
  if (s.account.hostApproval !== "approved") return <NotReady />;
  const bg = s.settings.hostBackground;
  const doClose = () => s.closeWindow();
  return (
    <>
      <PageHeader title="Chạy nền và dừng cung cấp" subtitle="Ba hành động khác nhau. Hãy chọn đúng điều bạn muốn." />
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <table className="w-full table-fixed text-left text-sm">
          <caption className="sr-only">So sánh đóng cửa sổ, chạy nền và dừng cung cấp máy</caption>
          <thead className="border-b border-line bg-subtle text-xs text-ink-faint"><tr><th scope="col" className="w-[24%] px-4 py-2 font-semibold">Hành động</th><th scope="col" className="px-4 py-2 font-semibold">Điều gì xảy ra</th><th scope="col" className="w-[24%] px-4 py-2 font-semibold">Máy có nhận khách?</th></tr></thead>
          <tbody>
            <tr className="border-b border-line align-top"><th scope="row" className="px-4 py-3 font-bold">Đóng cửa sổ</th><td className="px-4 py-3 text-ink-soft">Chỉ đóng giao diện. Nếu “chạy nền” đang bật, dịch vụ vẫn chạy ở khay hệ thống; nếu tắt, app thoát và dịch vụ dừng.</td><td className="px-4 py-3">{bg ? "Có — vẫn nhận theo lịch" : "Không — dịch vụ dừng cùng app"}</td></tr>
            <tr className="border-b border-line align-top"><th scope="row" className="px-4 py-3 font-bold">Chạy nền</th><td className="px-4 py-3 text-ink-soft">Cho phép dịch vụ tiếp tục sau khi đóng cửa sổ. Bạn mở lại app từ khay.</td><td className="px-4 py-3">Phụ thuộc dịch vụ cung cấp</td></tr>
            <tr className="align-top"><th scope="row" className="px-4 py-3 font-bold">Dừng cung cấp máy</th><td className="px-4 py-3 text-ink-soft">Dừng dịch vụ cung cấp. Có thể chờ phiên hiện tại kết thúc rồi mới dừng. Lịch không tự bật lại máy.</td><td className="px-4 py-3">Không</td></tr>
          </tbody>
        </table>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-8">
        <Section title="Chạy nền">
          <div className="flex items-center gap-3"><Switch label="Chạy nền khi đóng cửa sổ" checked={bg} onCheckedChange={(v) => s.updateSettings({ hostBackground: v })} /><span className="text-sm font-semibold">{bg ? "Bật" : "Tắt"}</span></div>
          <p className="mt-2 text-xs text-ink-faint">Mô phỏng: không tạo tiến trình hay mục khởi động nào trên máy bạn.</p>
        </Section>
        <Section title="Đóng cửa sổ">
          <Button variant="secondary" onClick={() => (!bg && live ? setCloseWarn(true) : doClose())}><X className="h-4 w-4" aria-hidden />Đóng cửa sổ (mô phỏng)</Button>
          <p className="mt-2 text-xs text-ink-faint">Sẽ hiện màn hình Windows minh họa.</p>
        </Section>
        <Section title="Dịch vụ cung cấp máy">
          <p className="mb-2 text-sm">{s.hostAgentRunning ? <Badge tone="ok">Đang chạy</Badge> : <Badge tone="neutral">Đã dừng</Badge>}{s.hostStopAfterSession && <span className="ml-2 text-xs font-semibold text-warn">Sẽ dừng sau phiên hiện tại</span>}</p>
          {s.hostAgentRunning ? <Button variant="danger-outline" onClick={() => setStopOpen(true)}><CircleSlash className="h-4 w-4" aria-hidden />Dừng cung cấp máy</Button> : <Button variant="primary" onClick={s.startProviding}><Power className="h-4 w-4" aria-hidden />Bắt đầu cung cấp</Button>}
        </Section>
      </div>

      <Dialog open={stopOpen} onOpenChange={setStopOpen} title="Dừng cung cấp máy?" description={live ? "Đang có một phiên của khách." : "Không có phiên đang chạy."} footer={<><Button variant="secondary" onClick={() => setStopOpen(false)}>Quay lại</Button>{live && <Button variant="secondary" onClick={() => { setStopOpen(false); s.stopProviding(true); }}>Chờ phiên kết thúc rồi dừng</Button>}<Button variant="danger" onClick={() => { setStopOpen(false); s.stopProviding(false); }}>{live ? "Dừng ngay (ngắt khách)" : "Dừng cung cấp"}</Button></>}>
        <p className="text-sm text-ink-soft">Máy sẽ không nhận phiên mới. Lịch không tự bật lại: bạn phải bấm “Bắt đầu cung cấp”. {live && "Dừng ngay sẽ ngắt phiên của khách; nên chọn chờ phiên kết thúc."}</p>
      </Dialog>
      <ConfirmDialog open={closeWarn} onOpenChange={setCloseWarn} title="Đóng cửa sổ sẽ dừng máy" danger confirmLabel="Đóng và dừng" onConfirm={doClose}>
        Chạy nền đang tắt và có phiên của khách đang chạy. Đóng cửa sổ sẽ thoát app và dừng dịch vụ. Bật “Chạy nền” hoặc chờ phiên kết thúc nếu không muốn ngắt khách.
      </ConfirmDialog>
    </>
  );
}

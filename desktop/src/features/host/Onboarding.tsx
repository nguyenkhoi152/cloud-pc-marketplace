import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Circle, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { navigate } from "@/app/router";
import type { CheckStatus } from "@/domain/compat";
import { TIMEZONE_LABEL } from "@/domain/clock";
import { quote } from "@/domain/pricing";
import { totalWeeklyMinutes, upcomingWindows } from "@/domain/schedule";
import { cn } from "@/lib/utils";
import { HOST_PROFILES, INSTALL_COMPONENTS } from "@/mock/fixtures";
import { service } from "@/api";
import { useAppStore } from "@/state/store";
import type { Verdict } from "@/domain/compat";
import type { CheckItem } from "@/domain/compat";
import { Badge, DemoTag } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox, Field, Input, Select } from "@/ui/controls";
import { Banner } from "@/ui/feedback";
import { KeyValue, Money, PageHeader, Progress } from "@/ui/page";
import { ApprovalBadge } from "@/ui/status";
import { CATEGORY_LABEL } from "../renter/machineFormat";
import { ConfigureForm, useScheduleValid } from "./ConfigureForm";

export const STEPS = [
  { id: "intro", label: "Quyền và trách nhiệm" },
  { id: "compat", label: "Kiểm tra máy" },
  { id: "components", label: "Thành phần và quyền" },
  { id: "install", label: "Cài đặt" },
  { id: "configure", label: "Tài nguyên, giá, lịch" },
  { id: "preview", label: "Xem trước và gửi" },
  { id: "status", label: "Trạng thái duyệt" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

function useMaxStep(): number {
  const s = useAppStore((a) => a.hostSetup);
  const approval = useAppStore((a) => a.account.hostApproval);
  if (approval !== "none") return 6;
  if (!s.consented) return 0;
  if (!s.verdict || s.verdict === "ineligible") return 1;
  const required = INSTALL_COMPONENTS.filter((c) => c.required).every((c) => s.componentConsent[c.id]);
  if (!required) return 2;
  if (!s.installed) return 3;
  return 5;
}

export function Onboarding({ step }: { step: string }) {
  const idx = Math.max(0, STEPS.findIndex((s) => s.id === step));
  const max = useMaxStep();
  const approval = useAppStore((a) => a.account.hostApproval);
  useEffect(() => {
    if (idx > max) navigate(`/host/onboarding/${STEPS[max]!.id}`, { replace: true });
  }, [idx, max]);
  const cur = STEPS[Math.min(idx, max)]!.id as StepId;
  const go = (i: number) => navigate(`/host/onboarding/${STEPS[i]!.id}`);

  return (
    <>
      <PageHeader title="Thiết lập cho thuê máy" subtitle="Bảy bước từ giới thiệu quyền tới chờ duyệt. Bản xem trước không cài gì lên máy bạn." actions={<ApprovalBadge approval={approval} />} />
      <div className="grid grid-cols-[210px_minmax(0,1fr)] gap-10">
        <nav aria-label="Các bước thiết lập">
          <ol className="space-y-0.5">
            {STEPS.map((s, i) => {
              const reachable = i <= max;
              const done = i < max || (approval !== "none" && i < 6);
              return (
                <li key={s.id}>
                  <button type="button" disabled={!reachable} aria-current={i === idx ? "step" : undefined} onClick={() => go(i)} className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:text-ink-faint/70", i === idx ? "bg-teal-tint text-teal-ink" : "text-ink-soft hover:bg-sky/60 enabled:hover:text-ink")}>
                    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px]", done ? "border-ok-solid bg-ok-solid text-white" : i === idx ? "border-teal text-teal-ink" : "border-line-strong")}>{done ? "✓" : i + 1}</span>
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="min-w-0">
          {cur === "intro" && <IntroStep onNext={() => go(1)} />}
          {cur === "compat" && <CompatStep onBack={() => go(0)} onNext={() => go(2)} />}
          {cur === "components" && <ComponentsStep onBack={() => go(1)} onNext={() => go(3)} />}
          {cur === "install" && <InstallStep onBack={() => go(2)} onNext={() => go(4)} />}
          {cur === "configure" && <ConfigureStep onBack={() => go(3)} onNext={() => go(5)} />}
          {cur === "preview" && <PreviewStep onBack={() => go(4)} onSent={() => go(6)} />}
          {cur === "status" && <StatusStep />}
        </div>
      </div>
    </>
  );
}

function Nav({ onBack, onNext, nextLabel = "Tiếp tục", nextDisabled, why, loading }: { onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean; why?: string; loading?: boolean }) {
  return (
    <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
      {onBack ? <Button variant="secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" aria-hidden />Quay lại</Button> : <span />}
      <div className="flex items-center gap-3">
        {nextDisabled && why && <span className="text-xs text-ink-faint">{why}</span>}
        {onNext && <Button variant="primary" onClick={onNext} disabled={nextDisabled} loading={loading}>{nextLabel}<ArrowRight className="h-4 w-4" aria-hidden /></Button>}
      </div>
    </div>
  );
}

/* ---------- 1. Quyền và trách nhiệm ---------- */
function IntroStep({ onNext }: { onNext: () => void }) {
  const consented = useAppStore((s) => s.hostSetup.consented);
  const patch = useAppStore((s) => s.patchHostSetup);
  return (
    <div className="max-w-3xl">
      <h2 className="mb-3 text-lg font-bold">Trước khi bắt đầu: quyền và trách nhiệm của host</h2>
      <div className="grid grid-cols-2 gap-8">
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 font-bold text-teal-ink"><ShieldCheck className="h-4 w-4" aria-hidden />Bạn có quyền</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Chọn phần tài nguyên chia sẻ, giá và giờ cung cấp máy.</li>
            <li>Tạm nghỉ nhận phiên mới hoặc dừng cung cấp máy bất cứ lúc nào.</li>
            <li>Tiếp tục dùng Windows khi chưa có khách.</li>
            <li>Xem thu nhập, lịch sử và sự cố của máy mình.</li>
          </ul>
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 font-bold text-warn"><AlertTriangle className="h-4 w-4" aria-hidden />Bạn chịu trách nhiệm</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Giữ máy bật và online trong các khung giờ đã đăng; lịch không tự bật máy.</li>
            <li>Không xem, ghi lại hay cản trở phiên của khách.</li>
            <li>Hiệu năng Windows của bạn có thể bị ảnh hưởng khi có phiên; không phải GPU nào cũng được hỗ trợ.</li>
            <li>Chấp nhận máy có thể bị khóa khi dọn dẹp phiên thất bại, cho tới khi xử lý xong.</li>
          </ul>
        </section>
      </div>
      <Banner tone="warn" className="mt-6" title="Giới hạn cần biết">
        Môi trường khách (WSL/Docker, Selkies) là hướng đang kiểm chứng. Bạn có quyền quản trị máy của mình, nên nền tảng không thể hứa dữ liệu của khách được bảo vệ tuyệt đối khỏi chủ máy — vì vậy hãy tuân thủ cam kết không truy cập phiên của khách.
      </Banner>
      <div className="mt-5"><Checkbox checked={consented} onChange={(v) => patch({ consented: v })} label="Tôi đã đọc và hiểu quyền, trách nhiệm và giới hạn ở trên." hint="Bước này chưa cài gì và chưa cấp quyền host. Quyền host chỉ có sau khi máy được duyệt." /></div>
      <Nav onNext={onNext} nextDisabled={!consented} why="Cần xác nhận đã đọc" />
    </div>
  );
}

/* ---------- 2. Kiểm tra máy ---------- */
const STATUS_ICON: Record<CheckStatus, typeof CheckCircle2> = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle };
const STATUS_COLOR: Record<CheckStatus, string> = { pass: "text-ok", warn: "text-warn", fail: "text-danger" };
const STATUS_TEXT: Record<CheckStatus, string> = { pass: "Đạt", warn: "Lưu ý", fail: "Không đạt" };

function CompatStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const setup = useAppStore((s) => s.hostSetup);
  const patch = useAppStore((s) => s.patchHostSetup);
  const patchCfg = useAppStore((s) => s.patchHostConfig);
  const [state, setState] = useState<{ status: "idle" | "running" | "done" | "error"; items?: CheckItem[]; verdict?: Verdict; error?: string }>({ status: setup.verdict ? "done" : "idle" });
  const [profileUsed, setProfileUsed] = useState(setup.profileId);

  const run = async () => {
    setState({ status: "running" });
    patch({ verdict: null });
    try {
      const r = await service.runCompatCheck(setup.profileId);
      setState({ status: "done", items: r.items, verdict: r.verdict });
      setProfileUsed(setup.profileId);
      patch({ verdict: r.verdict });
      if (r.verdict === "limited") patchCfg({ categories: ["dev"], shareGpu: false });
      if (r.verdict === "eligible") patchCfg({ categories: ["game", "graphics"], shareGpu: true });
    } catch (e) {
      setState({ status: "error", error: (e as Error).message });
    }
  };
  const verdict = setup.verdict;
  const stale = state.status === "done" && profileUsed !== setup.profileId;

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-bold">Kiểm tra tương thích máy</h2>
      <p className="mt-1 text-sm text-ink-soft">Kiểm tra CPU, RAM, GPU, hệ điều hành, ảo hóa, WSL và mạng. <DemoTag>Giả lập — không đọc phần cứng thật</DemoTag></p>
      <div className="mt-4 flex items-end gap-3">
        <Field label="Hồ sơ máy mô phỏng" htmlFor="profile" hint="Chọn để xem kết quả đạt, hạn chế hoặc không đạt." className="w-80">
          <Select id="profile" value={setup.profileId} onChange={(e) => patch({ profileId: e.target.value, verdict: null })}>
            {HOST_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
        <Button variant="primary" onClick={run} loading={state.status === "running"}>{state.status === "done" ? "Kiểm tra lại" : "Chạy kiểm tra"}</Button>
      </div>

      <div className="mt-5" aria-live="polite">
        {state.status === "running" && <p className="flex items-center gap-2 text-sm text-ink-soft"><Loader2 className="h-4 w-4 animate-[spin_1s_linear_infinite]" aria-hidden />Đang kiểm tra (mô phỏng)…</p>}
        {state.status === "error" && <Banner tone="danger" title="Không kiểm tra được">{state.error}</Banner>}
        {state.status === "done" && state.items && !stale && (
          <>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {state.items.map((i) => {
                const Icon = STATUS_ICON[i.status];
                return (
                  <li key={i.id} className="grid grid-cols-[130px_1fr_90px] items-start gap-3 px-4 py-2.5">
                    <span className="font-semibold">{i.label}</span>
                    <span><span className="num">{i.detail}</span>{i.status !== "pass" && i.fix && <span className="mt-0.5 block text-xs text-ink-soft">{i.fix}</span>}</span>
                    <span className={cn("flex items-center justify-end gap-1 text-xs font-bold", STATUS_COLOR[i.status])}><Icon className="h-4 w-4" aria-hidden />{STATUS_TEXT[i.status]}</span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4">
              {state.verdict === "eligible" && <Banner tone="ok" title="Máy đủ điều kiện">Bạn có thể tiếp tục thiết lập.</Banner>}
              {state.verdict === "limited" && <Banner tone="warn" title="Đủ điều kiện có giới hạn">Không có GPU được hỗ trợ: bài đăng chỉ ở danh mục Lập trình. Bạn vẫn có thể tiếp tục.</Banner>}
              {state.verdict === "ineligible" && <Banner tone="danger" title="Máy chưa đạt yêu cầu">Sửa các mục “Không đạt” rồi kiểm tra lại. Bạn chưa thể sang bước cài đặt. Không có gì được cài hay thay đổi trên máy.</Banner>}
            </div>
          </>
        )}
        {stale && <Banner tone="info">Đã đổi hồ sơ máy. Bấm “Chạy kiểm tra” để xem kết quả mới.</Banner>}
      </div>
      <Nav onBack={onBack} onNext={onNext} nextDisabled={!verdict || verdict === "ineligible" || stale} why={verdict === "ineligible" ? "Máy chưa đạt yêu cầu" : "Cần chạy kiểm tra"} />
    </div>
  );
}

/* ---------- 3. Thành phần và quyền ---------- */
function ComponentsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const s = useAppStore((a) => a.hostSetup);
  const patch = useAppStore((a) => a.patchHostSetup);
  const canGpu = s.verdict === "eligible";
  const ok = INSTALL_COMPONENTS.filter((c) => c.required).every((c) => s.componentConsent[c.id]);
  const set = (id: string, v: boolean) => patch({ componentConsent: { ...s.componentConsent, [id]: v } });
  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-bold">Thành phần dự kiến cài và quyền cần cấp</h2>
      <p className="mt-1 text-sm text-ink-soft">Danh sách này là thứ <b>sẽ</b> được cài khi tính năng thật hoàn thiện. Bây giờ chỉ mô phỏng — không có gì được cài lên máy bạn.</p>
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
        {INSTALL_COMPONENTS.map((c) => {
          const disabled = c.id === "gpu" && !canGpu;
          return (
            <li key={c.id} className="px-4 py-3">
              <Checkbox checked={!!s.componentConsent[c.id] && !disabled} disabled={disabled} onChange={(v) => set(c.id, v)} label={<><b>{c.name}</b> {c.required ? <Badge tone="neutral" icon={false}>Bắt buộc</Badge> : <Badge tone="neutral" icon={false}>Tùy chọn</Badge>}</>} hint={<><span className="block">{c.why}</span><span className="mt-0.5 block"><b>Quyền:</b> {c.perm}</span>{disabled && <span className="block font-semibold text-warn">Không khả dụng với máy này.</span>}</>} />
            </li>
          );
        })}
      </ul>
      <Banner tone="info" className="mt-4">Khi cài thật, Windows sẽ hỏi quyền quản trị và có thể cần khởi động lại. Bạn gỡ được các thành phần và dừng cung cấp bất cứ lúc nào. App không tự đổi BIOS, tường lửa hay router.</Banner>
      <Nav onBack={onBack} onNext={onNext} nextLabel="Đồng ý và bắt đầu cài (mô phỏng)" nextDisabled={!ok} why="Đồng ý các thành phần bắt buộc" />
    </div>
  );
}

/* ---------- 4. Cài đặt mô phỏng ---------- */
function InstallStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const s = useAppStore((a) => a.hostSetup);
  const patch = useAppStore((a) => a.patchHostSetup);
  const comps = INSTALL_COMPONENTS.filter((c) => c.required || s.componentConsent[c.id]);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const started = useRef(false);

  const run = async (from: number) => {
    setRunning(true);
    setErr(null);
    for (let i = from; i < comps.length; i++) {
      try {
        await service.installStep(i);
        patch({ installedSteps: i + 1 });
      } catch (e) {
        setErr((e as Error).message);
        setRunning(false);
        return;
      }
    }
    patch({ installed: true });
    setRunning(false);
  };
  useEffect(() => {
    if (started.current || s.installed) return;
    started.current = true;
    void run(s.installedSteps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = s.installedSteps;
  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-bold">Cài đặt (mô phỏng)</h2>
      <p className="mt-1 text-sm text-ink-soft">Đang diễn tập các bước cài. <b>Không có WSL, Docker hay dịch vụ thật nào được cài.</b></p>
      <div className="mt-4"><Progress value={s.installed ? 100 : (done / comps.length) * 100} label="Tiến độ cài đặt" /></div>
      <ul className="mt-5 space-y-3">
        {comps.map((c, i) => {
          const st = i < done ? "done" : i === done && running ? "doing" : i === done && err ? "failed" : "todo";
          return (
            <li key={c.id} className="flex items-center gap-3">
              {st === "done" && <CheckCircle2 className="h-5 w-5 text-ok" aria-label="Xong" />}
              {st === "doing" && <Loader2 className="h-5 w-5 animate-[spin_1s_linear_infinite] text-teal" aria-label="Đang cài" />}
              {st === "failed" && <XCircle className="h-5 w-5 text-danger" aria-label="Thất bại" />}
              {st === "todo" && <Circle className="h-5 w-5 text-line-strong" aria-label="Chờ" />}
              <span className={cn("font-semibold", st === "todo" && "text-ink-faint")}>{c.name}</span>
            </li>
          );
        })}
      </ul>
      {err && <Banner tone="danger" className="mt-4" title="Cài đặt dừng lại" action={<Button variant="primary" size="sm" onClick={() => run(done)}>Thử lại từ bước lỗi</Button>}>{err}</Banner>}
      {s.installed && <Banner tone="ok" className="mt-4" title="Đã hoàn tất mô phỏng">Tiếp theo: chọn tài nguyên chia sẻ, giá và lịch.</Banner>}
      <Nav onBack={onBack} onNext={onNext} nextDisabled={!s.installed} why="Chờ cài xong" />
    </div>
  );
}

/* ---------- 5. Cấu hình ---------- */
function ConfigureStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const valid = useScheduleValid();
  return (
    <div>
      <h2 className="mb-1 text-lg font-bold">Tài nguyên, giá và lịch</h2>
      <p className="mb-4 text-sm text-ink-soft">Chọn phần chia sẻ, mức giá và giờ cung cấp. Thay đổi được lưu tự động vào bản nháp.</p>
      <ConfigureForm />
      <Nav onBack={onBack} onNext={onNext} nextDisabled={!valid} why="Sửa lỗi lịch ở tab Lịch tuần/Ngoại lệ" />
    </div>
  );
}

/* ---------- 6. Xem trước và gửi ---------- */
function PreviewStep({ onBack, onSent }: { onBack: () => void; onSent: () => void }) {
  const setup = useAppStore((s) => s.hostSetup);
  const patchCfg = useAppStore((s) => s.patchHostConfig);
  const submit = useAppStore((s) => s.submitListing);
  const valid = useScheduleValid();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const c = setup.config;
  const profile = HOST_PROFILES.find((p) => p.id === setup.profileId)!;
  const q = quote(c.pricePer15, 60);
  const up = upcomingWindows(c.weekly, c.exceptions, 7).slice(0, 4);
  const send = async () => {
    setBusy(true);
    setErr("");
    try {
      await submit();
      onSent();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-bold">Xem trước bài đăng</h2>
      <p className="mt-1 text-sm text-ink-soft">Đây là thông tin người thuê sẽ thấy. Bài đăng cần được duyệt trước khi hiện.</p>
      <div className="mt-4 grid grid-cols-[1fr_260px] gap-8">
        <div className="space-y-5">
          <Field label="Tên máy hiển thị" htmlFor="lname"><Input id="lname" maxLength={40} value={c.name} onChange={(e) => patchCfg({ name: e.target.value })} aria-invalid={!c.name.trim()} /></Field>
          {!c.name.trim() && <p role="alert" className="-mt-3 text-xs font-semibold text-danger">Nhập tên máy.</p>}
          <KeyValue items={[
            { k: "Danh mục", v: c.categories.length ? c.categories.map((x) => CATEGORY_LABEL[x]).join(", ") : "Chưa chọn" },
            { k: "CPU / RAM chia sẻ", v: `${c.cores} nhân · ${c.ramGb} GB` },
            { k: "GPU", v: c.shareGpu && profile.gpu ? `${profile.gpu} · ${profile.vramGb} GB` : "Không chia sẻ" },
            { k: "Ổ cho phiên", v: `${c.storageGb} GB` },
            { k: "Giá", v: <>{c.pricePer15} PCP thử / 15′</> },
            { k: "Giờ mở", v: `${Math.round((totalWeeklyMinutes(c.weekly) / 60) * 10) / 10} giờ/tuần · ${TIMEZONE_LABEL}` },
          ]} />
          <div>
            <p className="mb-1 text-sm font-bold">Các khung sắp tới</p>
            <ul className="space-y-0.5 text-sm">{up.map((u) => <li key={u.date + u.start} className="num">{u.date.slice(8)}/{u.date.slice(5, 7)} · {u.start}–{u.end}</li>)}{up.length === 0 && <li className="text-ink-faint">Chưa có khung nào</li>}</ul>
          </div>
        </div>
        <aside className="h-fit rounded-lg border border-line bg-surface p-4 text-sm">
          <p className="font-bold">Khách trả 1 giờ</p>
          <p className="mt-1"><Money value={q.gross} /></p>
          <p className="text-xs text-ink-faint">Bạn nhận <Money value={q.hostNet} /> sau phí 10%, ghi nhận khi dọn dẹp xong.</p>
          <p className="mt-3 text-xs text-ink-faint">Bài đăng ghi rõ: dữ liệu mô phỏng; chưa hứa mọi game chạy trên Linux.</p>
        </aside>
      </div>
      {err && <Banner tone="danger" className="mt-4" title="Chưa gửi được">{err}</Banner>}
      {!valid && <Banner tone="danger" className="mt-4" title="Lịch còn lỗi">Quay lại bước Tài nguyên, giá, lịch để sửa trước khi gửi.</Banner>}
      <Nav onBack={onBack} onNext={send} nextLabel="Gửi duyệt" loading={busy} nextDisabled={!valid || !c.name.trim() || c.categories.length === 0} why={c.categories.length === 0 ? "Chọn ít nhất một danh mục" : undefined} />
    </div>
  );
}

/* ---------- 7. Trạng thái duyệt ---------- */
function StatusStep() {
  const approval = useAppStore((s) => s.account.hostApproval);
  const decide = useAppStore((s) => s.decideApproval);
  const toDraft = useAppStore((s) => s.returnToDraft);
  const start = useAppStore((s) => s.startProviding);
  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-bold">Trạng thái duyệt</h2>
      {approval === "pending" && (
        <>
          <Banner tone="warn" className="mt-4" title="Đang chờ duyệt">Bài đăng đã gửi. Máy <b>chưa</b> hiện cho người thuê và <b>chưa</b> nhận khách cho tới khi được duyệt. Chọn chế độ Cho thuê máy không thay đổi điều này.</Banner>
          <div className="mt-5 rounded-lg border border-dashed border-warn-line bg-warn-bg/50 p-4">
            <p className="text-sm font-bold text-warn">Điều khiển demo — mô phỏng quyết định của người duyệt</p>
            <div className="mt-2 flex gap-2"><Button variant="primary" onClick={() => decide("approved")}>Mô phỏng: được duyệt</Button><Button variant="danger-outline" onClick={() => decide("rejected")}>Mô phỏng: bị từ chối</Button></div>
          </div>
        </>
      )}
      {approval === "rejected" && (
        <>
          <Banner tone="danger" className="mt-4" title="Bài đăng bị từ chối">Lý do (mô phỏng): thông tin tài nguyên chưa khớp kiểm tra. Bạn có thể chỉnh và gửi lại; máy chưa nhận khách.</Banner>
          <Button className="mt-4" variant="primary" onClick={() => { toDraft(); navigate("/host/onboarding/configure"); }}>Sửa bài đăng và gửi lại</Button>
        </>
      )}
      {approval === "approved" && (
        <>
          <Banner tone="ok" className="mt-4" title="Máy đã được duyệt">Bạn có thể nhận khách. Hãy bật dịch vụ cung cấp — lịch không tự bật máy.</Banner>
          <div className="mt-4 flex gap-2"><Button variant="primary" onClick={() => { start(); navigate("/host"); }}>Bắt đầu cung cấp và mở tổng quan</Button><Button variant="secondary" onClick={() => navigate("/host")}>Chỉ mở tổng quan</Button></div>
        </>
      )}
      {approval === "none" && <Banner tone="info" className="mt-4">Chưa gửi duyệt. Quay lại bước Xem trước và gửi.</Banner>}
    </div>
  );
}

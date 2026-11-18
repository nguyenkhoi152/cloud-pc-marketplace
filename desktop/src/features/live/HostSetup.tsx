/**
 * Chế độ Cho thuê trên Windows: kiểm tra WSL2 và guest Linux, cài thành phần trong guest, ghi danh thiết bị, bắt đầu/dừng nhận thuê.
 * Mọi thao tác đi qua lớp native với tập lệnh cố định (api/hostNative.ts). App KHÔNG tự cài WSL, không xin quyền admin,
 * không khởi động lại máy: các bước đó hiện dưới dạng hướng dẫn kèm lệnh để người dùng tự chạy.
 */
import { AlertTriangle, CheckCircle2, CircleDashed, ClipboardCopy, Info, Lock, Play, RefreshCw, Square, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiBase, getDevWallet, getLiveApi } from "@/api";
import { hostNative, hostNativeAvailable, viewerOrigins } from "@/api/hostNative";
import { formatUnits, splitFeeUnits, type HostMachine, type LiveBooking } from "@/api/live";
import { buildSteps, gpuNote, guestError, interpretWsl, interpretWslInstall, nextStep, parseProbe, RECOMMENDED_DISTRO, type GuestProbe, type Overview, type SetupStep, type StepStatus } from "@/domain/hostEnv";
import { startHosting, stopHosting, type TunnelInfo } from "@/domain/hostStart";
import { cpuChoices, limitWarning, loadLimits, ramChoicesGb, saveLimits, toLimitInput, type Limits } from "@/domain/hostLimits";
import { hostSessionLabel } from "@/domain/sessionSteps";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox, Field, Input, Select } from "@/ui/controls";
import { Banner } from "@/ui/feedback";
import { KeyValue, PageHeader, Section } from "@/ui/page";

const SHARE_KEY = "cpm.hostShare.v1";
const TZ = "Asia/Ho_Chi_Minh";
const fmt = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: TZ, hour12: false });

const STATUS_UI: Record<StepStatus, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: "text-ok", label: "Xong" },
  action: { icon: Wrench, cls: "text-teal-dark", label: "Cần làm trong app" },
  manual: { icon: AlertTriangle, cls: "text-warn", label: "Bạn cần tự làm" },
  blocked: { icon: Lock, cls: "text-ink-faint", label: "Chưa tới" },
  info: { icon: Info, cls: "text-info", label: "Thông tin" },
};

function CopyBlock({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = lines.filter((l) => !l.startsWith("#")).join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mt-2 rounded-md border border-line bg-subtle p-2.5">
      <pre className="num overflow-x-auto whitespace-pre-wrap break-all text-xs leading-5">{lines.join("\n")}</pre>
      <Button size="sm" variant="ghost" className="mt-1" onClick={() => void copy()}><ClipboardCopy className="h-3.5 w-3.5" aria-hidden />{copied ? "Đã chép" : "Chép lệnh"}</Button>
    </div>
  );
}

function StepRow({ step, current, children }: { step: SetupStep; current: boolean; children?: React.ReactNode }) {
  const ui = STATUS_UI[step.status];
  const Icon = step.status === "blocked" && !current ? CircleDashed : ui.icon;
  return (
    <li data-step={step.id} data-status={step.status} className={cn("rounded-lg border p-3", current ? "border-teal bg-teal-tint/40" : "border-line bg-surface")}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", ui.cls)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
            {step.title}
            <span className={cn("text-xs font-semibold", ui.cls)}>{ui.label}</span>
          </p>
          <p className="mt-0.5 text-sm text-ink-soft">{step.detail}</p>
          {step.manual && (step.status === "manual" || step.status === "info") && (
            <div className="mt-2">
              <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                Chạy trong: {step.manual.where}
                {step.manual.needsAdmin && <Badge tone="warn">Cần quyền quản trị</Badge>}
                {step.manual.needsRestart && <Badge tone="warn">Cần khởi động lại máy</Badge>}
              </p>
              <p className="mt-1 text-xs text-ink-faint">{step.manual.why}</p>
              <CopyBlock lines={step.manual.commands} />
            </div>
          )}
          {children}
        </div>
      </div>
    </li>
  );
}

function LogTail({ title, text }: { title: string; text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  if (!text.trim()) return null;
  return (
    <details className="mt-2 rounded-md border border-line bg-subtle p-2" open>
      <summary className="cursor-pointer text-xs font-semibold text-ink-soft">{title}</summary>
      <pre ref={ref} className="num mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-4">{text.split("\n").slice(-60).join("\n")}</pre>
    </details>
  );
}

/** Phiên trên máy của host (đọc qua RLS: host chỉ thấy booking của máy mình). */
export function HostSessions({ machineId, pollMs = 5000 }: { machineId?: string | null; pollMs?: number }) {
  const [rows, setRows] = useState<LiveBooking[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      getLiveApi().host.listBookings().then(
        (r) => { if (alive) { setRows(r); setErr(""); } },
        (e: Error) => { if (alive) setErr(e.message); },
      );
    void load();
    const t = setInterval(() => void load(), pollMs);
    return () => { alive = false; clearInterval(t); };
  }, [pollMs]);
  const list = (rows ?? []).filter((b) => !machineId || b.machineId === machineId).slice(0, 6);
  return (
    <Section title="Phiên trên máy của tôi" bordered className="mt-4">
      {err && <Banner tone="danger" title="Không tải được danh sách phiên">{err}</Banner>}
      {rows === null && !err && <p className="text-sm text-ink-faint">Đang tải…</p>}
      {rows !== null && list.length === 0 && <p className="text-sm text-ink-soft">Chưa có phiên nào. Khi có người giữ máy, phiên sẽ hiện ở đây và tự cập nhật.</p>}
      <ul className="space-y-2" data-testid="host-sessions">
        {list.map((b) => {
          const l = hostSessionLabel(b);
          const { host } = splitFeeUnits(b.priceUnits, b.feeBps);
          return (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2.5 text-sm">
              <div>
                <p className="font-semibold">{l.text}</p>
                <p className="text-xs text-ink-faint">Phiên {b.id.slice(0, 8)} · giữ lúc {fmt(b.createdAt)} · bạn nhận {formatUnits(host)} PCP thử nếu hoàn tất · <span className="num">{b.state} / {b.accessState}</span></p>
              </div>
              <Badge tone={l.tone}>{l.live ? "Đang diễn ra" : "Đã xong"}</Badge>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-ink-faint">PCP là điểm thử trên chuỗi mô phỏng cục bộ, không có giá trị tiền. Màn Thu nhập chưa có.</p>
    </Section>
  );
}

export function HostSetup() {
  const native = hostNativeAvailable();
  const [ov, setOv] = useState<Overview | null>(null);
  const [probe, setProbe] = useState<GuestProbe | null>(null);
  const [machines, setMachines] = useState<HostMachine[]>([]);
  const [health, setHealth] = useState<string | null>(null);
  // true cho tới khi lần kiểm tra guest đầu tiên xong (kể cả thất bại): tránh hiện "Chưa tới" như thể đã biết kết quả.
  const [probing, setProbing] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [token, setToken] = useState("");
  const [distro, setDistro] = useState("");
  const [dedicated, setDedicated] = useState(false);
  const [consent, setConsent] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  // Cho phép người ở mạng khác thuê máy này (tunnel Cloudflare). Mặc định TẮT; lựa chọn được nhớ trên máy này.
  const [share, setShareState] = useState(() => { try { return localStorage.getItem(SHARE_KEY) === "1"; } catch { return false; } });
  const setShare = (v: boolean) => { setShareState(v); try { localStorage.setItem(SHARE_KEY, v ? "1" : "0"); } catch { /* không lưu được: chỉ áp dụng phiên này */ } };
  const [tunnel, setTunnel] = useState<TunnelInfo | null>(null);
  const [limits, setLimitsState] = useState<Limits>(() => { try { return loadLimits(localStorage); } catch { return { ramGb: null, cpus: null }; } });
  const setLimits = (l: Limits) => { setLimitsState(l); try { saveLimits(localStorage, l); } catch { /* không lưu được */ } };

  const loadOverview = useCallback(async () => {
    const o = await hostNative.overview();
    setOv(o);
    return o;
  }, []);
  /** silent: làm mới nền (không hiện "đang kiểm tra"), để thông tin về guest không cũ đi trong lúc agent chạy. */
  const loadProbe = useCallback(async (o: Overview, silent = false) => {
    if (!o.backend) { setProbe(null); setProbing(false); return null; }
    if (!silent) setProbing(true);
    try {
      const p = parseProbe(await hostNative.probe(apiBase() ?? undefined));
      setProbe(p);
      return p;
    } finally {
      if (!silent) setProbing(false);
    }
  }, []);
  const refresh = useCallback(async () => {
    setErr("");
    try {
      await loadProbe(await loadOverview());
    } catch (e) {
      setErr((e as Error).message);
      setProbing(false);
    }
  }, [loadOverview, loadProbe]);

  // Lần đầu: kiểm tra máy (chỉ đọc). Sau đó xem trạng thái tiến trình mỗi 3 giây (nhẹ, không gọi guest).
  useEffect(() => {
    if (!native) return;
    void refresh();
    void getLiveApi().host.listMachines().then(setMachines, () => undefined);
    const t = setInterval(() => {
      void loadOverview().catch(() => undefined);
      void hostNative.tunnelState().then(setTunnel, () => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [native, refresh, loadOverview]);

  const provisioning = ov?.provision.state === "running";
  const agentRunning = ov?.agent.state === "running";
  // Cài xong (tiến trình cài thoát) ⇒ kiểm tra lại guest một lần.
  const wasProvisioning = useRef(false);
  useEffect(() => {
    if (wasProvisioning.current && !provisioning && ov) void loadProbe(ov).catch(() => undefined);
    wasProvisioning.current = !!provisioning;
  }, [provisioning, ov, loadProbe]);

  // Khi agent chạy: làm mới trạng thái guest (container, agent) mỗi 15 giây. Không làm vậy thì panel "Nhận thuê" hiện kết quả kiểm tra
  // CŨ (ví dụ "container missing" chụp trước khi bấm Bắt đầu) trong lúc máy đang nhận thuê.
  const ovRef = useRef<Overview | null>(null);
  ovRef.current = ov;
  const refreshWhileRunning = !!agentRunning;
  useEffect(() => {
    if (!refreshWhileRunning) return;
    let alive = true;
    const tick = () => { const o = ovRef.current; if (alive && o) void loadProbe(o, true).catch(() => undefined); };
    const first = setTimeout(tick, 4000);
    const t = setInterval(tick, 15000);
    return () => { alive = false; clearTimeout(first); clearInterval(t); };
  }, [refreshWhileRunning, loadProbe]);

  // Heartbeat do MÁY CHỦ ghi nhận (không phải lời agent tự báo).
  const machineId = probe?.machineId ?? null;
  useEffect(() => {
    if (!machineId) { setHealth(null); return; }
    let alive = true;
    const load = () => getLiveApi().host.health(machineId).then((h) => alive && setHealth(h), () => alive && setHealth(null));
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => { alive = false; clearInterval(t); };
  }, [machineId]);

  const act = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setErr("");
    setNote("");
    try {
      const msg = await fn();
      if (msg) setNote(msg);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  /** Lệnh guest trả mã lỗi ⇒ ném lỗi tiếng Việt; không bao giờ coi là thành công khi mã thoát khác 0. */
  const must = (c: { code: number; stdout: string; stderr: string }) => {
    const e = guestError(c);
    if (e) throw new Error(e);
  };

  if (!native)
    return (
      <div>
        <PageHeader title="Thiết lập & chạy máy cho thuê" subtitle="Biến máy Windows này thành máy cho thuê bằng một guest Linux (WSL2) chạy desktop Selkies." />
        <Banner tone="info" title="Chỉ có trong app Windows đã cài">
          Kiểm tra WSL2, cài thành phần trong guest và chạy agent cần lớp native của app. Bạn đang mở giao diện trong trình duyệt nên phần này không hoạt động (và không hiện kết quả giả). Hãy mở app Cloud PC Companion đã cài.
        </Banner>
      </div>
    );

  const wsl = ov ? interpretWsl(ov) : null;
  const steps = ov && wsl ? buildSteps({ wsl, backend: ov.backend, probe, appAgentSha256: ov.agentSha256, agentRunning: !!agentRunning, health }) : [];
  const next = nextStep(steps);
  const myMachine = machineId ? machines.find((m) => m.id === machineId) : undefined;
  const gpu = gpuNote(probe);
  const api = apiBase();
  const frameAncestors = viewerOrigins(window.location.origin, getDevWallet()?.kind === "dev");

  const doInstall = () =>
    act("install", async () => {
      if (!api) throw new Error("App chưa có địa chỉ máy chủ API (VITE_API_BASE_URL) nên chưa cấu hình được agent.");
      must(await hostNative.installAgent());
      must(await hostNative.configure({ apiBase: api, frameAncestors }));
      await refresh();
      return "Đã cài agent vào guest và ghi cấu hình.";
    });
  const doProvision = () =>
    act("provision", async () => {
      if (!probe?.user) throw new Error("Chưa biết user trong guest; bấm Kiểm tra lại.");
      await hostNative.provisionStart(probe.user);
      await loadOverview();
    });
  const doEnroll = () =>
    act("enroll", async () => {
      must(await hostNative.enroll(token));
      setToken("");
      await refresh();
      return "Đã ghi danh. Credential của thiết bị chỉ nằm trong guest; app không giữ và không hiển thị.";
    });
  const doStart = () =>
    act("start", async () => {
      if (!api) throw new Error("App chưa có địa chỉ máy chủ API: vào Cài đặt → Kết nối máy chủ để nhập mã kết nối.");
      // Ghi lại cấu hình MỖI lần bắt đầu: địa chỉ API và địa chỉ tunnel có thể đã đổi từ lần chạy trước.
      const r = await startHosting({ ...hostNative, sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)) }, { apiBase: api, frameAncestors, share, ...toLimitInput(limits, probe?.memTotalMb ?? null, probe?.cpuCount ?? null) });
      await loadOverview();
      void hostNative.tunnelState().then(setTunnel, () => undefined);
      return `Đang khởi động agent: tạo môi trường khách sạch rồi bắt đầu gửi heartbeat. Có thể mất một hai phút.${r.publicUrl ? ` Địa chỉ công khai của máy (đổi mỗi lần bắt đầu): ${r.publicUrl}` : " Chỉ người dùng ngay trên máy này vào được (chưa bật chia sẻ ra Internet)."}`;
    });
  const doStop = () =>
    act("stop", async () => {
      setConfirmStop(false);
      const c = await stopHosting(hostNative); // dừng agent rồi LUÔN đóng tunnel
      void hostNative.tunnelState().then(setTunnel, () => undefined);
      await refresh();
      must(c);
      return "Đã dừng nhận thuê: mọi phiên xem bị cắt, container khách đã bị xoá (guest sạch).";
    });
  const doCleanup = () =>
    act("cleanup", async () => {
      must(await hostNative.cleanup());
      await refresh();
      return "Đã dọn guest: container khách bị xoá.";
    });
  const doInstallWsl = () =>
    act("wslfeat", async () => {
      const r = interpretWslInstall(await hostNative.wslInstallFeatures());
      await refresh();
      if (!r.ok) throw new Error(r.message);
      return r.message;
    });
  const doInstallDistro = () =>
    act("wsldistro", async () => {
      await hostNative.wslInstallDistro();
      return "Đã mở cửa sổ cài Ubuntu-24.04. Đặt tên người dùng và mật khẩu Linux trong cửa sổ đó, gõ exit khi xong, rồi bấm Kiểm tra lại.";
    });
  const chooseDistro = () =>
    act("distro", async () => {
      await hostNative.setWslDistro(distro);
      await refresh();
    });

  const distros = wsl?.kind === "ready" ? wsl.distros.filter((d) => d.version !== 1) : [];
  const healthText = health === "ok" ? "Máy chủ đang nhận heartbeat (ổn)" : health === "suspect" ? "Heartbeat chậm (quá 30 giây)" : health === "incident" ? "Mất heartbeat (quá 90 giây)" : "Máy chủ chưa nhận heartbeat nào";

  return (
    <div>
      <PageHeader
        title="Thiết lập & chạy máy cho thuê"
        subtitle="Máy Windows của bạn chạy một guest Linux (WSL2). Trong guest, mỗi khách dùng một desktop Selkies riêng trong container; khách không vào Windows của bạn."
        actions={<Button onClick={() => void act("refresh", refresh)} loading={busy === "refresh"}><RefreshCw className="h-4 w-4" aria-hidden />Kiểm tra lại</Button>}
      />
      {err && <Banner tone="danger" className="mb-3" title="Chưa thực hiện được">{err}</Banner>}
      {note && <Banner tone="ok" className="mb-3" title="Đã xong">{note}</Banner>}
      {ov?.backendError && <Banner tone="danger" className="mb-3" title="Cấu hình guest của app bị lỗi">{ov.backendError}</Banner>}
      {ov?.backend?.kind === "ssh-dev" && (
        <Banner tone="warn" className="mb-3" title="Đang dùng GUEST THỬ: máy ảo Linux qua SSH — không phải WSL2">
          Bản thử dùng một máy ảo Linux không GPU ({ov.backend.target}) để kiểm cùng một luồng khi máy chưa có WSL2. Không đại diện cho hiệu năng; với máy cho thuê thật, guest là WSL2 trên chính máy này.
        </Banner>
      )}

      {!ov ? (
        <p className="text-sm text-ink-faint" role="status">Đang kiểm tra máy…</p>
      ) : (
        <>
          <Section title="Các bước" aside={probing ? <Badge tone="info">Đang kiểm tra guest…</Badge> : next ? <Badge tone="info">Việc tiếp theo: {next.title}</Badge> : <Badge tone="ok">Mọi bước đã xong</Badge>}>
            {probing && ov.backend && <p className="mb-2 text-sm text-ink-soft" role="status">Đang kiểm tra guest (chỉ đọc, có thể mất vài giây). Các bước sau sẽ hiện trạng thái thật khi có kết quả.</p>}
            <ol className="space-y-2" data-testid="host-steps" data-probing={probing ? "1" : "0"}>
              {steps.map((s) => {
                const current = next?.id === s.id;
                return (
                  <StepRow key={s.id} step={s} current={current}>
                    {current && s.assist === "install_wsl" && (
                      <div className="mt-3 space-y-2" data-testid="assist-wsl">
                        <Banner tone="info" title="App sẽ làm gì">
                          Chạy đúng lệnh <span className="num">wsl --install --no-distribution</span> với quyền quản trị: Windows hiện hộp thoại xác nhận (UAC), bạn bấm Có để đồng ý; bấm Không thì không có gì được cài. Có thể cần khởi động lại máy, app không tự khởi động lại. Tính năng này chưa được kiểm trên máy thật.
                        </Banner>
                        <Button variant="primary" loading={busy === "wslfeat"} onClick={doInstallWsl}>Cài WSL giúp tôi</Button>
                      </div>
                    )}
                    {current && s.assist === "install_distro" && (
                      <div className="mt-3 space-y-2" data-testid="assist-distro">
                        <Banner tone="info" title="App sẽ làm gì">
                          Mở một cửa sổ riêng chạy <span className="num">wsl --install -d {RECOMMENDED_DISTRO}</span>. Lần đầu bản Linux hỏi tên người dùng và mật khẩu: bạn tự nhập trong cửa sổ đó, app không điền thay. Tính năng này chưa được kiểm trên máy thật.
                        </Banner>
                        <Button variant="primary" loading={busy === "wsldistro"} onClick={doInstallDistro}>Mở cửa sổ cài {RECOMMENDED_DISTRO}</Button>
                      </div>
                    )}
                    {current && s.action === "choose_distro" && (
                      <div className="mt-3 space-y-2">
                        <Field label="Bản Linux (WSL 2) dùng làm guest" htmlFor="hs-distro" hint={`Khuyến nghị một bản riêng tên ${RECOMMENDED_DISTRO}: wsl --install -d ${RECOMMENDED_DISTRO}`}>
                          <Select id="hs-distro" value={distro} onChange={(e) => setDistro(e.target.value)} className="max-w-xs">
                            <option value="">— chọn —</option>
                            {distros.map((d) => <option key={d.name} value={d.name}>{d.name}{d.isDefault ? " (mặc định)" : ""}</option>)}
                          </Select>
                        </Field>
                        <Checkbox checked={dedicated} onChange={setDedicated} label="Bản Linux này chỉ dùng cho việc cho thuê; tôi không để dữ liệu cá nhân trong đó." />
                        <Button variant="primary" disabled={!distro || !dedicated} loading={busy === "distro"} onClick={chooseDistro}>Dùng bản này</Button>
                      </div>
                    )}
                    {current && s.action === "provision" && (
                      <div className="mt-3 space-y-2">
                        <Banner tone="info" title="App sẽ làm gì trong guest">
                          Chạy bằng quyền root <b>của guest Linux</b> (không phải quyền quản trị Windows): cài gói <span className="num">docker.io</span> và <span className="num">nodejs</span> nếu thiếu, bật dịch vụ Docker, thêm user <span className="num">{probe?.user || "?"}</span> vào nhóm docker, và tải image desktop Selkies (khoảng 8 GB, một lần) nếu chưa có. Không cài gì lên Windows.
                        </Banner>
                        <Checkbox checked={consent} onChange={setConsent} label="Tôi đồng ý cài các thành phần trên vào guest và dùng dung lượng/mạng tương ứng." />
                        <Button variant="primary" disabled={!consent || provisioning} loading={busy === "provision" || provisioning} onClick={doProvision}>{provisioning ? "Đang cài trong guest…" : "Cài thành phần trong guest"}</Button>
                      </div>
                    )}
                    {current && s.action === "install" && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button variant="primary" loading={busy === "install"} disabled={!api} onClick={doInstall}>Cài/cập nhật agent trong guest</Button>
                        {!api && <span className="text-xs text-ink-faint">App chưa có địa chỉ máy chủ API.</span>}
                      </div>
                    )}
                    {current && s.action === "enroll" && (
                      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); doEnroll(); }}>
                        <Field label="Mã ghi danh (admin cấp, dùng một lần)" htmlFor="hs-token" hint="Mã đi thẳng vào guest để đổi lấy credential; app không lưu mã.">
                          <Input id="hs-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value.trim())} className="w-80" />
                        </Field>
                        <Button type="submit" variant="primary" disabled={token.length < 20} loading={busy === "enroll"}>Ghi danh</Button>
                      </form>
                    )}
                    {current && s.action === "start" && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <div className="w-full space-y-2" data-testid="limits">
                          <p className="text-sm font-semibold">Giới hạn tài nguyên cho khách</p>
                          <div className="flex flex-wrap items-end gap-3">
                            <Field label="RAM tối đa" htmlFor="hs-ram" hint={probe?.memTotalMb ? `Máy guest có ${(probe.memTotalMb / 1024).toFixed(1)} GB` : "Chưa đọc được RAM của guest"}>
                              <Select id="hs-ram" value={limits.ramGb ?? ""} onChange={(e) => setLimits({ ...limits, ramGb: e.target.value ? Number(e.target.value) : null })} className="w-40">
                                <option value="">Không giới hạn</option>
                                {ramChoicesGb(probe?.memTotalMb ?? null).map((g) => <option key={g} value={g}>{g} GB</option>)}
                              </Select>
                            </Field>
                            <Field label="CPU tối đa" htmlFor="hs-cpu" hint={probe?.cpuCount ? `Máy guest có ${probe.cpuCount} CPU` : "Chưa đọc được số CPU của guest"}>
                              <Select id="hs-cpu" value={limits.cpus ?? ""} onChange={(e) => setLimits({ ...limits, cpus: e.target.value ? Number(e.target.value) : null })} className="w-40">
                                <option value="">Không giới hạn</option>
                                {cpuChoices(probe?.cpuCount ?? null).map((c) => <option key={c} value={c}>{c} CPU</option>)}
                              </Select>
                            </Field>
                          </div>
                          {limitWarning(limits) && <p className="text-xs text-warn">{limitWarning(limits)}</p>}
                          <p className="text-xs text-ink-faint">Áp dụng cho container khách ở lần bắt đầu tiếp theo (RAM tính cả swap). Chưa có giới hạn dung lượng đĩa. Chưa đo tác động tới hiệu năng.</p>
                        </div>
                        <div className="w-full space-y-2" data-testid="share-online">
                          <Checkbox checked={share} onChange={setShare} label="Cho phép người ở mạng khác thuê máy này (mở kênh ra Internet qua Cloudflare)" />
                          {share && (
                            <Banner tone="warn" title="Điều này làm gì">
                              App chạy <span className="num">cloudflared</span> (Cloudflare quick tunnel): chỉ kết nối <b>ra</b> Cloudflare và nhận một địa chỉ https ngẫu nhiên (…trycloudflare.com) trỏ về cổng xem của máy này. Không mở cổng trên router/tường lửa. Địa chỉ đổi mỗi lần bắt đầu. Cổng xem chỉ trả hình khi có quyền xem theo phiên do máy chủ cấp (không có token thì bị từ chối). Hình ảnh và thao tác của khách đi qua Cloudflare, bên trung gian có thể thấy lưu lượng. Dịch vụ tunnel nhanh không có cam kết hoạt động và chưa đo độ trễ qua tunnel. Tunnel đóng khi bạn dừng nhận thuê hoặc đóng app.
                            </Banner>
                          )}
                        </div>
                        <Button variant="primary" size="lg" loading={busy === "start"} onClick={doStart}><Play className="h-4 w-4" aria-hidden />Bắt đầu nhận thuê</Button>
                        {probe?.container && probe.container !== "missing" && <Button variant="ghost" loading={busy === "cleanup"} onClick={doCleanup}>Dọn guest (xoá container khách còn sót)</Button>}
                      </div>
                    )}
                    {s.id === "packages" && (provisioning || ov.provision.state === "exited") && (
                      <>
                        {ov.provision.state === "exited" && ov.provision.exitCode !== 0 && <Banner tone="danger" className="mt-2" title="Cài trong guest chưa xong">{guestError({ code: ov.provision.exitCode ?? 1, stdout: ov.provision.logTail, stderr: "" })}</Banner>}
                        <LogTail title="Nhật ký cài đặt trong guest" text={ov.provision.logTail} />
                      </>
                    )}
                  </StepRow>
                );
              })}
            </ol>
          </Section>

          {(agentRunning || ov.agent.state === "exited") && (
            <Section title="Nhận thuê" bordered className="mt-4">
              <div data-testid="host-run">
                {agentRunning ? (
                  <Banner tone={health === "ok" ? "ok" : "info"} title={health === "ok" ? "Máy đang nhận thuê" : "Agent đang chạy, chờ máy chủ xác nhận"}>
                    {healthText}. Đóng app hoặc bấm Dừng thì máy ngừng nhận thuê, phiên đang chạy bị cắt và guest được dọn.
                  </Banner>
                ) : (
                  <Banner tone={ov.agent.exitCode === 0 ? "info" : "danger"} title={ov.agent.exitCode === 0 ? "Agent đã dừng" : "Agent dừng bất thường"}>
                    {ov.agent.exitCode === 0 ? "Máy không còn nhận thuê." : `Tiến trình agent thoát với mã ${ov.agent.exitCode}. Xem nhật ký bên dưới.`}
                  </Banner>
                )}
                <KeyValue className="mt-3" items={[
                  { k: "Máy", v: myMachine ? `${myMachine.name} (${myMachine.status === "approved" ? "đã duyệt" : myMachine.status})` : machineId ? `Máy ${machineId.slice(0, 8)}… (không thuộc tài khoản đang đăng nhập)` : "Chưa ghi danh" },
                  { k: "Heartbeat (máy chủ ghi nhận)", v: <span data-testid="host-health" data-health={health ?? "unknown"}>{healthText}</span> },
                  { k: "Cổng xem của khách", v: tunnel?.state === "running" && tunnel.url ? <span data-testid="host-public-url">{tunnel.url} (qua Cloudflare tunnel; chỉ vào được bằng quyền xem theo phiên)</span> : `http://127.0.0.1:${ov.gatewayPort} trên máy này (chỉ vào được bằng quyền xem theo phiên)` },
                  { k: "Môi trường khách", v: probe ? `container ${probe.container}${probe.containerHealth ? ` / ${probe.containerHealth}` : ""}` : "?" },
                ]} />
                {agentRunning && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!confirmStop ? (
                      <Button variant="danger-outline" onClick={() => setConfirmStop(true)} disabled={busy !== ""}><Square className="h-4 w-4" aria-hidden />Dừng nhận thuê</Button>
                    ) : (
                      <>
                        <span className="text-sm font-semibold text-danger">Dừng ngay? Phiên đang chạy (nếu có) sẽ bị cắt và dữ liệu trong container khách bị xoá.</span>
                        <Button variant="danger" loading={busy === "stop"} onClick={doStop}>Dừng và dọn guest</Button>
                        <Button variant="ghost" onClick={() => setConfirmStop(false)}>Không</Button>
                      </>
                    )}
                    <Button variant="ghost" onClick={() => void act("refresh", refresh)}>Cập nhật trạng thái guest</Button>
                  </div>
                )}
                <LogTail title="Nhật ký agent (không chứa credential)" text={ov.agent.logTail} />
              </div>
            </Section>
          )}

          {machineId && <HostSessions machineId={machineId} />}

          <Section title="Thông tin máy" bordered className="mt-4">
            <KeyValue items={[
              { k: "WSL trên Windows", v: wsl?.kind === "ready" ? `Đã cài${wsl.version ? ` (${wsl.version})` : ""}; ${wsl.distros.length} bản Linux` : wsl?.kind === "no_distro" ? "Đã cài, chưa có bản Linux" : wsl?.kind === "not_installed" ? "Chưa cài" : "Không áp dụng" },
              { k: "Guest đang dùng", v: ov.backend ? (ov.backend.kind === "wsl" ? `WSL2: ${ov.backend.distro}` : `Máy ảo thử qua SSH (${ov.backend.target})`) : "Chưa chọn" },
              { k: "CPU / RAM / đĩa trống trong guest", v: probe ? `${probe.cpuCount ?? "?"} CPU · ${probe.memTotalMb ? (probe.memTotalMb / 1024).toFixed(1) : "?"} GB RAM · ${probe.diskFreeGb ?? "?"} GB trống (máy tự đọc, không phải đo hiệu năng)` : "Chưa đọc được" },
              { k: "GPU trong guest", v: gpu.text },
              { k: "Agent đi kèm app", v: <span className="num">{ov.agentSha256.slice(0, 16)}…</span> },
            ]} />
          </Section>

          <Banner tone="warn" className="mt-4" title="Giới hạn của bản thử — đọc trước khi cho thuê">
            <ul className="list-disc space-y-1 pl-4">
              <li>Chưa kiểm chứng mã hoá hình ảnh bằng GPU trong WSL2; bản này chạy desktop bằng CPU và chưa đo độ trễ/FPS.</li>
              <li>App phải mở trong lúc cho thuê; chưa có chạy nền. Đóng app là dừng nhận thuê.</li>
              <li>Khách ở máy khác chỉ vào được khi bạn bật “Cho phép người ở mạng khác thuê máy này” (tunnel Cloudflare, chưa đo độ trễ). Nếu tắt, chỉ người dùng ngay trên máy này vào được. App không đổi tường lửa/router.</li>
              <li>WSL2/Docker không phải chứng nhận cô lập. Bạn là quản trị máy nên nền tảng không thể bảo vệ dữ liệu của khách khỏi chủ máy; chỉ cho thuê cho người thử tin cậy.</li>
            </ul>
          </Banner>
        </>
      )}
    </div>
  );
}

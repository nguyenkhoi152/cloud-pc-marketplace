/**
 * Chế độ Cho thuê trên Windows: kiểm tra WSL2 và guest Linux, cài thành phần trong guest, ghi danh thiết bị, bắt đầu/dừng nhận thuê.
 * Mọi thao tác đi qua lớp native với tập lệnh cố định (api/hostNative.ts). App KHÔNG tự cài WSL, không xin quyền admin,
 * không khởi động lại máy: các bước đó hiện dưới dạng hướng dẫn kèm lệnh để người dùng tự chạy.
 */
import { AlertTriangle, CheckCircle2, CircleDashed, ClipboardCopy, Info, Lock, Play, RefreshCw, Square, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiBase, getDevWallet, getLiveApi, getServerApi } from "@/api";
import { hostNative, hostNativeAvailable, viewerOrigins } from "@/api/hostNative";
import { splitFeeUnits, type HostMachine, type LiveBooking } from "@/api/live";
import { BOOKING_STATE_LABEL } from "@/domain/adminData";
import { buildSteps, gpuNote, guestError, interpretWsl, interpretWslInstall, nextStep, parseProbe, RECOMMENDED_DISTRO, type GuestProbe, type Overview, type SetupStep, type StepStatus } from "@/domain/hostEnv";
import { startHosting, stopHosting, type TunnelInfo } from "@/domain/hostStart";
import { loadLimits, saveLimits, toLimitInput, type Limits } from "@/domain/hostLimits";
import { hostSessionLabel } from "@/domain/sessionSteps";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox, Field, Input, Select } from "@/ui/controls";
import { Banner } from "@/ui/feedback";
import { KeyValue, PageHeader, Section } from "@/ui/page";
import { Amount } from "./Amount";
import { defaultScanDeps, syncOwnMachineSpecs } from "./machineScan";
import { ShareLimits, limitsSummary } from "./ShareLimits";

const SHARE_KEY = "cpm.hostShare.v1";
const TZ = "Asia/Ho_Chi_Minh";
const fmt = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: TZ, hour12: false, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const STATUS_UI: Record<StepStatus, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: "text-ok", label: "Xong" },
  action: { icon: Wrench, cls: "text-teal-dark", label: "Làm ngay trong ứng dụng" },
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
                <p className="text-xs text-ink-faint">Phiên {b.id.slice(0, 8)} · giữ lúc {fmt(b.createdAt)} · bạn nhận <Amount units={host} suffix="PCP" inline /> khi hoàn tất · {BOOKING_STATE_LABEL[b.state] ?? b.state}</p>
              </div>
              <Badge tone={l.tone}>{l.live ? "Đang diễn ra" : "Đã xong"}</Badge>
            </li>
          );
        })}
      </ul>
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
  // Ghi danh tự động: máy (đã đăng) được chọn, và có thay thiết bị cũ của máy đó không (thiết bị cũ sẽ ngừng hoạt động).
  const [enrollMachine, setEnrollMachine] = useState("");
  const [replaceOld, setReplaceOld] = useState(false);
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
        <PageHeader title="Thiết lập & chạy máy cho thuê" subtitle="Biến máy Windows này thành máy cho thuê: cài môi trường Linux, ghi danh máy và bắt đầu nhận thuê." />
        <Banner tone="info" title="Chỉ có trong app Windows đã cài">
          Phần này cần ứng dụng Cloud PC Companion trên Windows. Bạn đang mở bằng trình duyệt nên chưa dùng được. Hãy mở ứng dụng đã cài trên máy.
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
      if (!api) throw new Error("Ứng dụng chưa kết nối máy chủ. Vào Cài đặt → Kết nối máy chủ trước.");
      must(await hostNative.installAgent());
      must(await hostNative.configure({ apiBase: api, frameAncestors }));
      await refresh();
      return "Đã cài dịch vụ cho thuê và ghi cấu hình.";
    });
  const doProvision = () =>
    act("provision", async () => {
      if (!probe?.user) throw new Error("Chưa xác định được người dùng Linux; bấm Kiểm tra lại.");
      await hostNative.provisionStart(probe.user);
      await loadOverview();
    });
  const doEnroll = () =>
    act("enroll", async () => {
      must(await hostNative.enroll(token));
      setToken("");
      await refresh();
      return "Đã ghi danh máy. Bạn có thể bắt đầu nhận thuê.";
    });
  /** Không còn admin cấp mã: app xin mã một lần cho máy ĐÃ ĐĂNG của chính bạn rồi đưa thẳng vào guest (không hiển thị, không lưu, không log). */
  const publishedMachines = machines.filter((m) => m.status === "approved");
  const chosenMachine = publishedMachines.some((m) => m.id === enrollMachine) ? enrollMachine : (publishedMachines[0]?.id ?? "");
  const doEnrollAuto = () =>
    act("enroll", async () => {
      if (!chosenMachine) throw new Error("Chưa có máy nào đã đăng. Vào Máy của tôi, tạo máy rồi bấm Quét & đăng máy.");
      const server = getServerApi();
      if (replaceOld) await server.revokeMyDevice(chosenMachine);
      let t: string | null = await server.createMyEnrollment(chosenMachine);
      try {
        must(await hostNative.enroll(t));
      } finally {
        t = null; // không giữ mã sau khi dùng
      }
      await refresh();
      setReplaceOld(false);
      return "Đã ghi danh máy. Bạn có thể bắt đầu nhận thuê.";
    });
  const doStart = () =>
    act("start", async () => {
      if (!api) throw new Error("Ứng dụng chưa kết nối máy chủ. Vào Cài đặt → Kết nối máy chủ để nhập địa chỉ.");
      // Ghi lại cấu hình MỖI lần bắt đầu: địa chỉ API và địa chỉ tunnel có thể đã đổi từ lần chạy trước.
      const r = await startHosting({ ...hostNative, sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)) }, { apiBase: api, frameAncestors, share, ...toLimitInput(limits, probe?.memTotalMb ?? null, probe?.cpuCount ?? null) });
      await loadOverview();
      void hostNative.tunnelState().then(setTunnel, () => undefined);
      // Mức RAM/CPU vừa chọn có hiệu lực từ lần bắt đầu này: cập nhật thẻ máy để người thuê thấy đúng phần họ được dùng (chạy nền, không chặn).
      void syncOwnMachineSpecs(getLiveApi().host, machines, { ...defaultScanDeps(), share: () => limits });
      return `Đang khởi động: chuẩn bị môi trường sạch cho khách và kết nối với máy chủ. Có thể mất một hai phút.${r.publicUrl ? ` Địa chỉ truy cập của máy (đổi mỗi lần bắt đầu): ${r.publicUrl}` : " Hiện chỉ người dùng ngay trên máy này truy cập được (bạn chưa bật chia sẻ ra Internet)."}`;
    });
  const doStop = () =>
    act("stop", async () => {
      setConfirmStop(false);
      const c = await stopHosting(hostNative); // dừng agent rồi LUÔN đóng tunnel
      void hostNative.tunnelState().then(setTunnel, () => undefined);
      await refresh();
      must(c);
      return "Đã dừng nhận thuê: các phiên xem đã ngắt và môi trường của khách đã được dọn sạch.";
    });
  const doCleanup = () =>
    act("cleanup", async () => {
      must(await hostNative.cleanup());
      await refresh();
      return "Đã dọn môi trường của khách.";
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
  const healthText = health === "ok" ? "Đang kết nối với máy chủ" : health === "suspect" ? "Kết nối chậm" : health === "incident" ? "Mất kết nối với máy chủ" : "Chưa kết nối với máy chủ (máy đang hiện offline)";

  return (
    <div>
      <PageHeader
        title="Thiết lập & chạy máy cho thuê"
        subtitle="Máy Windows của bạn chạy một bản Linux (WSL2). Mỗi khách dùng một desktop riêng trong bản Linux đó và không vào được Windows của bạn."
        actions={<Button onClick={() => void act("refresh", refresh)} loading={busy === "refresh"}><RefreshCw className="h-4 w-4" aria-hidden />Kiểm tra lại</Button>}
      />
      {err && <Banner tone="danger" className="mb-3" title="Chưa thực hiện được">{err}</Banner>}
      {note && <Banner tone="ok" className="mb-3" title="Đã xong">{note}</Banner>}
      {ov?.backendError && <Banner tone="danger" className="mb-3" title="Cấu hình môi trường Linux bị lỗi">{ov.backendError}</Banner>}
      {ov?.backend?.kind === "ssh-dev" && (
        <Banner tone="warn" className="mb-3" title="Đang dùng máy ảo Linux qua SSH thay cho WSL2">
          Máy ảo Linux ({ov.backend.target}) được dùng khi máy này chưa có WSL2. Hiệu năng có thể khác so với WSL2 chạy ngay trên máy.
        </Banner>
      )}

      {!ov ? (
        <p className="text-sm text-ink-faint" role="status">Đang kiểm tra máy…</p>
      ) : (
        <>
          <Section title="Các bước" aside={probing ? <Badge tone="info">Đang kiểm tra…</Badge> : next ? <Badge tone="info">Việc tiếp theo: {next.title}</Badge> : <Badge tone="ok">Mọi bước đã xong</Badge>}>
            {probing && ov.backend && <p className="mb-2 text-sm text-ink-soft" role="status">Đang kiểm tra máy (có thể mất vài giây). Trạng thái từng bước sẽ hiện khi có kết quả.</p>}
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
                          Mở một cửa sổ riêng chạy <span className="num">wsl --install -d {RECOMMENDED_DISTRO}</span>. Lần đầu bản Linux hỏi tên người dùng và mật khẩu: bạn tự nhập trong cửa sổ đó.
                        </Banner>
                        <Button variant="primary" loading={busy === "wsldistro"} onClick={doInstallDistro}>Mở cửa sổ cài {RECOMMENDED_DISTRO}</Button>
                      </div>
                    )}
                    {current && s.action === "choose_distro" && (
                      <div className="mt-3 space-y-2">
                        <Field label="Bản Linux (WSL 2) dùng để cho thuê" htmlFor="hs-distro" hint={`Khuyến nghị một bản riêng tên ${RECOMMENDED_DISTRO}: wsl --install -d ${RECOMMENDED_DISTRO}`}>
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
                        <Banner tone="info" title="Ứng dụng sẽ cài những gì">
                          Cài <span className="num">Docker</span> và <span className="num">Node.js</span> nếu còn thiếu, bật Docker, cấp quyền dùng Docker cho người dùng <span className="num">{probe?.user || "?"}</span>, và tải môi trường desktop cho khách (khoảng 8 GB, chỉ một lần). Mọi thứ được cài trong bản Linux, không cài gì lên Windows.
                        </Banner>
                        <Checkbox checked={consent} onChange={setConsent} label="Tôi đồng ý cài các thành phần trên và dùng dung lượng/mạng tương ứng." />
                        <Button variant="primary" disabled={!consent || provisioning} loading={busy === "provision" || provisioning} onClick={doProvision}>{provisioning ? "Đang cài đặt…" : "Cài đặt các thành phần"}</Button>
                      </div>
                    )}
                    {current && s.action === "install" && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button variant="primary" loading={busy === "install"} disabled={!api} onClick={doInstall}>Cài hoặc cập nhật dịch vụ cho thuê</Button>
                        {!api && <span className="text-xs text-ink-faint">Ứng dụng chưa kết nối máy chủ.</span>}
                      </div>
                    )}
                    {current && s.action === "enroll" && (
                      <div className="mt-3 space-y-3">
                        {publishedMachines.length === 0 ? (
                          <Banner tone="info" title="Chưa có máy nào đã đăng">Vào <b>Máy của tôi</b>, tạo máy rồi bấm <b>Quét & đăng máy</b>. Xong quay lại đây để ghi danh.</Banner>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-end gap-2">
                              <Field label="Máy của bạn đã đăng" htmlFor="hs-machine" hint="Ứng dụng tự lấy mã ghi danh cho máy này; bạn không phải nhập hay dán gì.">
                                <Select id="hs-machine" value={chosenMachine} onChange={(e) => setEnrollMachine(e.target.value)} className="w-80">
                                  {publishedMachines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </Select>
                              </Field>
                              <Button variant="primary" disabled={!chosenMachine} loading={busy === "enroll"} onClick={doEnrollAuto}>Ghi danh máy này</Button>
                            </div>
                            <Checkbox checked={replaceOld} onChange={setReplaceOld} label="Máy này đã từng ghi danh trên một bản Linux khác (ví dụ tôi cài lại): thay thiết bị cũ. Thiết bị cũ sẽ ngừng hoạt động ngay." />
                          </>
                        )}
                        <details className="text-sm">
                          <summary className="cursor-pointer text-ink-soft">Có mã ghi danh? Dán thủ công</summary>
                          <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); doEnroll(); }}>
                            <Field label="Mã ghi danh (dùng một lần)" htmlFor="hs-token" hint="Mã được dùng ngay để ghi danh và không được lưu lại.">
                              <Input id="hs-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value.trim())} className="w-80" />
                            </Field>
                            <Button type="submit" variant="secondary" disabled={token.length < 20} loading={busy === "enroll"}>Ghi danh bằng mã</Button>
                          </form>
                        </details>
                      </div>
                    )}
                    {current && s.action === "start" && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <p className="w-full text-sm text-ink-soft" data-testid="limits-summary">Mức chia sẻ cho khách: <b>{limitsSummary(limits)}</b>. Đổi ở mục <b>Chia sẻ cho khách</b> bên dưới.</p>
                        <div className="w-full space-y-2" data-testid="share-online">
                          <Checkbox checked={share} onChange={setShare} label="Cho phép người ở mạng khác thuê máy này (chia sẻ ra Internet)" />
                          {share && (
                            <Banner tone="warn" title="Khi bật chia sẻ">
                              Máy sẽ nhận một địa chỉ https ngẫu nhiên để người ở mạng khác truy cập; địa chỉ đổi mỗi lần bạn bắt đầu nhận thuê. Ứng dụng chỉ kết nối ra ngoài và không mở cổng trên router hay tường lửa của bạn. Chỉ người có quyền xem của phiên thuê mới xem được màn hình. Hình ảnh và thao tác của khách đi qua dịch vụ trung gian (Cloudflare). Kết nối đóng khi bạn dừng nhận thuê hoặc đóng ứng dụng.
                            </Banner>
                          )}
                        </div>
                        <Button variant="primary" size="lg" loading={busy === "start"} onClick={doStart}><Play className="h-4 w-4" aria-hidden />Bắt đầu nhận thuê</Button>
                        {probe?.container && probe.container !== "missing" && <Button variant="ghost" loading={busy === "cleanup"} onClick={doCleanup}>Dọn môi trường của khách còn sót</Button>}
                      </div>
                    )}
                    {s.id === "packages" && (provisioning || ov.provision.state === "exited") && (
                      <>
                        {ov.provision.state === "exited" && ov.provision.exitCode !== 0 && <Banner tone="danger" className="mt-2" title="Cài đặt chưa xong">{guestError({ code: ov.provision.exitCode ?? 1, stdout: ov.provision.logTail, stderr: "" })}</Banner>}
                        <LogTail title="Nhật ký cài đặt" text={ov.provision.logTail} />
                      </>
                    )}
                  </StepRow>
                );
              })}
            </ol>
          </Section>

          {ov.backend && probe?.ok && <ShareLimits probe={probe} limits={limits} onChange={setLimits} agentRunning={!!agentRunning} />}

          {(agentRunning || ov.agent.state === "exited") && (
            <Section title="Nhận thuê" bordered className="mt-4">
              <div data-testid="host-run">
                {agentRunning ? (
                  <Banner tone={health === "ok" ? "ok" : "info"} title={health === "ok" ? "Máy đang nhận thuê" : "Đang khởi động, chờ kết nối với máy chủ"}>
                    {healthText}. Đóng ứng dụng hoặc bấm Dừng thì máy ngừng nhận thuê, phiên đang chạy bị ngắt và môi trường của khách được dọn sạch.
                  </Banner>
                ) : (
                  <Banner tone={ov.agent.exitCode === 0 ? "info" : "danger"} title={ov.agent.exitCode === 0 ? "Đã dừng nhận thuê" : "Dừng nhận thuê bất thường"}>
                    {ov.agent.exitCode === 0 ? "Máy không còn nhận thuê." : `Dịch vụ cho thuê dừng với mã ${ov.agent.exitCode}. Xem nhật ký bên dưới.`}
                  </Banner>
                )}
                <KeyValue className="mt-3" items={[
                  { k: "Máy", v: myMachine ? `${myMachine.name} (${myMachine.status === "approved" ? "đã đăng" : myMachine.status})` : machineId ? `Máy ${machineId.slice(0, 8)}… (không thuộc tài khoản đang đăng nhập)` : "Chưa ghi danh" },
                  { k: "Kết nối với máy chủ", v: <span data-testid="host-health" data-health={health ?? "unknown"}>{healthText}</span> },
                  { k: "Địa chỉ truy cập của khách", v: tunnel?.state === "running" && tunnel.url ? <span data-testid="host-public-url">{tunnel.url} (chỉ truy cập được bằng quyền xem của phiên thuê)</span> : `http://127.0.0.1:${ov.gatewayPort} (chỉ trên máy này, cần quyền xem của phiên thuê)` },
                  { k: "Môi trường của khách", v: probe ? (probe.container === "running" ? "Đang chạy" : probe.container === "missing" ? "Chưa tạo" : "Chưa rõ") : "?" },
                ]} />
                {agentRunning && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!confirmStop ? (
                      <Button variant="danger-outline" onClick={() => setConfirmStop(true)} disabled={busy !== ""}><Square className="h-4 w-4" aria-hidden />Dừng nhận thuê</Button>
                    ) : (
                      <>
                        <span className="text-sm font-semibold text-danger">Dừng ngay? Phiên đang chạy (nếu có) sẽ bị ngắt và dữ liệu trong môi trường của khách bị xóa.</span>
                        <Button variant="danger" loading={busy === "stop"} onClick={doStop}>Dừng và dọn dẹp</Button>
                        <Button variant="ghost" onClick={() => setConfirmStop(false)}>Không</Button>
                      </>
                    )}
                    <Button variant="ghost" onClick={() => void act("refresh", refresh)}>Làm mới trạng thái</Button>
                  </div>
                )}
                <LogTail title="Nhật ký dịch vụ cho thuê" text={ov.agent.logTail} />
              </div>
            </Section>
          )}

          {machineId && <HostSessions machineId={machineId} />}

          <Section title="Thông tin máy" bordered className="mt-4">
            <KeyValue items={[
              { k: "WSL trên Windows", v: wsl?.kind === "ready" ? `Đã cài${wsl.version ? ` (${wsl.version})` : ""}; ${wsl.distros.length} bản Linux` : wsl?.kind === "no_distro" ? "Đã cài, chưa có bản Linux" : wsl?.kind === "not_installed" ? "Chưa cài" : "Không áp dụng" },
              { k: "Bản Linux đang dùng", v: ov.backend ? (ov.backend.kind === "wsl" ? `WSL2: ${ov.backend.distro}` : `Máy ảo qua SSH (${ov.backend.target})`) : "Chưa chọn" },
              { k: "CPU / RAM / đĩa trống", v: probe ? `${probe.cpuCount ?? "?"} CPU · ${probe.memTotalMb ? (probe.memTotalMb / 1024).toFixed(1) : "?"} GB RAM · ${probe.diskFreeGb ?? "?"} GB trống` : "Chưa đọc được" },
              { k: "GPU", v: gpu.text },
              { k: "Phiên bản dịch vụ cho thuê", v: <span className="num">{ov.agentSha256.slice(0, 16)}…</span> },
            ]} />
          </Section>

          <Banner tone="warn" className="mt-4" title="Lưu ý trước khi cho thuê">
            <ul className="list-disc space-y-1 pl-4">
              <li>Hình ảnh được xử lý bằng CPU nên chất lượng phụ thuộc cấu hình máy của bạn.</li>
              <li>Hãy giữ ứng dụng chạy trong lúc cho thuê. Đóng hẳn ứng dụng là dừng nhận thuê.</li>
              <li>Khách ở mạng khác chỉ truy cập được khi bạn bật “Cho phép người ở mạng khác thuê máy này”. Nếu tắt, chỉ người dùng ngay trên máy này truy cập được. Ứng dụng không thay đổi tường lửa hay router.</li>
              <li>Bạn là người quản trị máy nên không thể bảo vệ dữ liệu của khách khỏi chính bạn: chỉ cho thuê với người bạn tin.</li>
            </ul>
          </Banner>
        </>
      )}
    </div>
  );
}

/**
 * Diễn giải kết quả kiểm tra máy host (do lớp native trả về ở dạng THÔ) thành danh sách bước dễ hiểu.
 * Không có I/O ở đây: mọi quyết định "bước nào xong, bước nào người dùng phải tự làm" nằm trong các hàm thuần để test được.
 * Nguyên tắc: app KHÔNG tự cài WSL, không bật tính năng Windows, không xin quyền admin, không khởi động lại máy. Những bước đó
 * được trả về dạng `manual` kèm lệnh chính xác để người dùng tự chạy.
 */
export interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}
export interface ProcState {
  state: "never" | "running" | "exited";
  exitCode: number | null;
  startedMs: string | null;
  logTail: string;
}
export interface BackendInfo {
  kind: "wsl" | "ssh-dev";
  distro: string | null;
  label: string | null;
  target: string | null;
  agentApiBase: string | null;
  gatewayBind: string;
}
export interface Overview {
  os: string;
  wslStatus: Captured;
  wslVersion: Captured;
  wslListVerbose: Captured;
  wslListQuiet: Captured;
  backend: BackendInfo | null;
  backendError: string | null;
  agentSha256: string;
  gatewayPort: number;
  agent: ProcState;
  provision: ProcState;
}

export interface WslDistro {
  name: string;
  version: 1 | 2 | null;
  running: boolean | null;
  isDefault: boolean;
}
export type WslState =
  | { kind: "not_windows" }
  | { kind: "not_installed"; message: string }
  | { kind: "no_distro"; version: string | null }
  | { kind: "ready"; version: string | null; distros: WslDistro[] };

const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const firstLine = (c: Captured) => lines(c.stdout)[0] ?? lines(c.stderr)[0] ?? "";

/** Distro do Docker Desktop tự tạo: không dùng làm guest cho thuê. */
const INTERNAL_DISTRO = /^docker-desktop(-data)?$/i;

export function interpretWsl(o: Pick<Overview, "os" | "wslStatus" | "wslVersion" | "wslListVerbose" | "wslListQuiet">): WslState {
  if (o.os !== "windows") return { kind: "not_windows" };
  // Bản WSL cũ không có `--version`; chỉ coi là chưa cài khi CẢ ba lệnh đều thất bại.
  const installed = o.wslVersion.code === 0 || o.wslStatus.code === 0 || o.wslListQuiet.code === 0;
  if (!installed) return { kind: "not_installed", message: firstLine(o.wslStatus) || firstLine(o.wslVersion) || "wsl.exe không chạy được" };
  const version = o.wslVersion.code === 0 ? (/(\d+\.\d+\.\d+(?:\.\d+)?)/.exec(lines(o.wslVersion.stdout)[0] ?? "")?.[1] ?? null) : null;
  const names = o.wslListQuiet.code === 0 ? lines(o.wslListQuiet.stdout).filter((n) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(n) && !INTERNAL_DISTRO.test(n)) : [];
  if (names.length === 0) return { kind: "no_distro", version };
  const verbose = o.wslListVerbose.code === 0 ? o.wslListVerbose.stdout.split(/\r?\n/) : [];
  const distros = names.map((name): WslDistro => {
    // Dòng dạng: "* Ubuntu-24.04    Running    2" (dấu * = mặc định). Chỉ tin cột cuối (số phiên bản) và tên đã biết.
    const row = verbose.map((l) => /^\s*(\*)?\s*(\S+)\s+(.*?)\s+([12])\s*$/.exec(l)).find((m) => m?.[2] === name);
    const st = row?.[3]?.trim().toLowerCase();
    return { name, version: row ? (Number(row[4]) as 1 | 2) : null, running: st === "running" ? true : st === "stopped" ? false : null, isDefault: !!row?.[1] };
  });
  return { kind: "ready", version, distros };
}

/** `tên=giá trị` mỗi dòng; dòng khác bị bỏ qua. */
export function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of text.split(/\r?\n/)) {
    const m = /^([a-z][a-z0-9_]{0,40})=(.*)$/.exec(l.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

const GUEST_ERRORS: Record<string, string> = {
  need_root: "Bước cài cần quyền quản trị trong bản Linux.",
  bad_user: "Tên người dùng trong bản Linux không hợp lệ.",
  no_such_user: "Người dùng này không tồn tại trong bản Linux.",
  unsupported_distro: "Chỉ hỗ trợ bản Linux Debian hoặc Ubuntu.",
  node_too_old: "Node.js trong bản Linux quá cũ (cần bản 18 trở lên; hãy dùng Ubuntu 24.04).",
  docker_start_failed: "Không khởi động được Docker trong bản Linux.",
  image_missing_after_pull: "Tải môi trường desktop chưa xong hoặc thất bại.",
  agent_checksum_mismatch: "Tệp cài đặt bị lỗi (sai checksum); hãy thử cài lại.",
  config_bad_format: "Cấu hình dịch vụ cho thuê sai định dạng.",
  config_key_not_allowed: "Cấu hình dịch vụ cho thuê có mục không được phép.",
  no_node: "Bản Linux chưa có Node.js.",
  agent_not_installed: "Bản Linux chưa có dịch vụ cho thuê.",
  not_configured: "Dịch vụ cho thuê chưa được cấu hình.",
  agent_running: "Dịch vụ cho thuê đang chạy; hãy dừng trước.",
  enroll_failed: "Ghi danh thất bại: mã không hợp lệ, đã dùng, đã hết hạn, hoặc máy chưa kết nối được tới máy chủ.",
  docker_unavailable: "Docker chưa chạy hoặc người dùng chưa có quyền dùng Docker.",
  image_missing: "Bản Linux chưa có môi trường desktop.",
  container_still_present: "Chưa dọn được môi trường của khách.",
  bad_arg: "Tham số không hợp lệ.",
  unsupported_action: "Hành động không được hỗ trợ.",
};

/** Lỗi của một lệnh guest → một câu tiếng Việt (không lộ chi tiết nhạy cảm; token không bao giờ nằm trong đầu ra). */
export function guestError(c: Captured): string | null {
  if (c.code === 0) return null;
  const code = parseKv(c.stdout).error;
  if (code && GUEST_ERRORS[code]) return GUEST_ERRORS[code]!;
  const all = `${c.stdout}\n${c.stderr}`;
  if (c.code === -2) return "Bản Linux không trả lời kịp (hết giờ chờ).";
  if (c.code === -1) return "Không chạy được công cụ kết nối tới bản Linux trên máy này.";
  if (/no distribution with the supplied name|WSL_E_DISTRO_NOT_FOUND/i.test(all)) return "Không tìm thấy bản Linux đã chọn trong WSL.";
  if (/not installed/i.test(all) && /Windows Subsystem for Linux/i.test(all)) return "Windows chưa cài WSL.";
  if (/Connection (refused|timed out|reset)|Could not resolve|Permission denied \(publickey/i.test(all)) return "Không kết nối được tới máy ảo qua SSH (máy ảo chưa bật hoặc khoá không đúng).";
  if (/a password is required|sudo:/i.test(all)) return "Bản Linux đòi mật khẩu quản trị; bước này cần quyền quản trị không cần mật khẩu.";
  const tail = lines(c.stderr).pop() ?? lines(c.stdout).pop() ?? "";
  return `Lệnh trong bản Linux thất bại (mã ${c.code})${tail ? `: ${tail.slice(0, 160)}` : ""}.`;
}

export interface GuestProbe {
  ok: boolean;
  error: string | null;
  isWsl: boolean;
  os: string;
  systemd: boolean;
  user: string;
  cpuCount: number | null;
  /** Tên CPU (rỗng nếu bản quét cũ hoặc guest không cho đọc). */
  cpuModel: string;
  memTotalMb: number | null;
  diskFreeGb: number | null;
  dockerCli: string;
  dockerSock: boolean;
  dockerAccess: boolean;
  inDockerGroup: boolean;
  node: string;
  nodeOk: boolean;
  imagePresent: boolean;
  agentInstalled: boolean;
  agentSha256: string;
  configured: boolean;
  enrolled: boolean;
  machineId: string | null;
  agentRunning: boolean;
  container: string;
  containerHealth: string;
  gpuDxg: boolean;
  gpuRenderNode: boolean;
  gpuNvidia: string;
  /** VRAM (MiB) của GPU đã đọc được tên; null nếu không có GPU hoặc bản quét cũ. */
  gpuVramMb: number | null;
  dockerNvidiaRuntime: boolean;
  apiReachable: boolean | null;
}

const int = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);

export function parseProbe(c: Captured): GuestProbe {
  const kv = parseKv(c.stdout);
  const done = c.code === 0 && kv.probe_done === "1";
  const major = Number(/^(\d+)\./.exec(kv.node ?? "")?.[1] ?? 0);
  return {
    ok: done,
    error: done ? null : (guestError(c) ?? "Kết quả kiểm tra không đầy đủ."),
    isWsl: kv.is_wsl === "1",
    os: [kv.os_id, kv.os_version].filter(Boolean).join(" "),
    systemd: kv.systemd === "1",
    user: kv.user ?? "",
    cpuCount: int(kv.cpu_count),
    cpuModel: (kv.cpu_model ?? "").trim(),
    memTotalMb: int(kv.mem_total_mb),
    diskFreeGb: int(kv.disk_free_gb),
    dockerCli: kv.docker_cli ?? "",
    dockerSock: kv.docker_sock === "1",
    dockerAccess: kv.docker_daemon === "1",
    inDockerGroup: kv.in_docker_group === "1",
    node: kv.node ?? "",
    nodeOk: major >= 18,
    imagePresent: kv.image_present === "1",
    agentInstalled: kv.agent_installed === "1",
    agentSha256: kv.agent_sha256 ?? "",
    configured: kv.configured === "1",
    enrolled: kv.enrolled === "1",
    machineId: /^[0-9a-f-]{36}$/.test(kv.machine_id ?? "") ? kv.machine_id! : null,
    agentRunning: kv.agent_running === "1",
    container: kv.container ?? "unknown",
    containerHealth: kv.container_health ?? "",
    gpuDxg: kv.gpu_dxg === "1",
    gpuRenderNode: kv.gpu_render_node === "1",
    gpuNvidia: kv.gpu_nvidia ?? "",
    gpuVramMb: int(kv.gpu_vram_mb),
    dockerNvidiaRuntime: kv.docker_nvidia_runtime === "1",
    apiReachable: kv.api_reachable === "1" ? true : kv.api_reachable === "0" ? false : null,
  };
}

/**
 * "Máy đủ điều kiện để đăng": kết quả quét guest đọc được và guest đã đủ thành phần để chạy một phiên thuê
 * (Docker dùng được, Node ≥ 18, image Selkies, agent đã cài). Không còn admin duyệt, nên đây là cổng DUY NHẤT trước khi máy hiện công khai.
 * Chỉ chạy ở app (máy chủ không kiểm chứng được kết quả quét): xem docs/SECURITY.md. Trả về danh sách còn thiếu bằng tiếng Việt.
 */
export function machineEligibility(p: GuestProbe | null): { ok: boolean; missing: string[] } {
  if (!p) return { ok: false, missing: ["chưa quét được máy"] };
  if (!p.ok) return { ok: false, missing: [p.error ?? "không đọc được trạng thái máy"] };
  const missing = [
    !p.dockerAccess && "Docker dùng được",
    !p.nodeOk && "Node từ bản 18 trở lên",
    !p.imagePresent && "môi trường desktop cho khách",
    !p.agentInstalled && "dịch vụ cho thuê của Cloud PC",
  ].filter((m): m is string => !!m);
  return { ok: missing.length === 0, missing };
}

export type StepStatus = "ok" | "action" | "manual" | "blocked" | "info";
export type StepAction = "choose_distro" | "provision" | "install" | "enroll" | "start";
export interface ManualStep {
  /** Vì sao app không tự làm. */
  why: string;
  commands: string[];
  needsAdmin: boolean;
  needsRestart: boolean;
  where: "PowerShell (Run as administrator)" | "PowerShell" | "Trong guest Linux";
}
export interface SetupStep {
  id: "wsl" | "distro" | "connect" | "systemd" | "packages" | "image" | "agent" | "network" | "enroll" | "run";
  title: string;
  status: StepStatus;
  detail: string;
  action?: StepAction;
  manual?: ManualStep;
  /** App có thể làm giúp bằng một lệnh cố định (hộp thoại quyền của Windows do người dùng đồng ý). */
  assist?: "install_wsl" | "install_distro";
}

/**
 * Kết quả bước "Cài WSL giúp tôi" (PowerShell chạy wsl.exe với quyền quản trị qua UAC).
 * 0 = xong; 3010 = xong nhưng cần khởi động lại; từ chối UAC ⇒ PowerShell báo lỗi "canceled": KHÔNG có gì được cài.
 */
export function interpretWslInstall(c: Captured): { ok: boolean; needsRestart: boolean; message: string } {
  const text = `${c.stdout}\n${c.stderr}`;
  if (c.code === 0 || c.code === 3010)
    return { ok: true, needsRestart: true, message: "Đã gửi lệnh cài WSL. Nếu Windows yêu cầu, hãy khởi động lại máy; sau đó mở lại app và bấm Kiểm tra lại. App không tự khởi động lại máy." };
  if (/cancel/i.test(text) || c.code === 1223)
    return { ok: false, needsRestart: false, message: "Bạn đã từ chối hộp thoại quyền quản trị của Windows nên chưa có gì được cài." };
  if (c.code === -1) return { ok: false, needsRestart: false, message: "Quá thời gian chờ cài WSL. Mở PowerShell (Run as administrator) và chạy: wsl --install --no-distribution" };
  const hint = text.replace(/\s+/g, " ").trim().slice(0, 160);
  return { ok: false, needsRestart: false, message: `Cài WSL chưa thành công (mã ${c.code}).${hint ? ` Windows báo: ${hint}` : ""} Có thể tự chạy lệnh trong khung hướng dẫn.` };
}

export const RECOMMENDED_DISTRO = "Ubuntu-24.04";
/** Dung lượng tối thiểu còn trống để tải image Selkies (~8 GB nén, cần chỗ giải nén). */
export const MIN_FREE_GB = 20;

export interface StepInput {
  wsl: WslState;
  backend: BackendInfo | null;
  probe: GuestProbe | null;
  /** SHA-256 của tệp agent nhúng trong app. */
  appAgentSha256: string;
  agentRunning: boolean;
  /** Sức khoẻ heartbeat do máy chủ ghi nhận ("ok" | "suspect" | "incident" | "unknown"); null nếu chưa biết máy nào. */
  health: string | null;
}

/**
 * Danh sách bước theo thứ tự. Bước đầu tiên chưa `ok` là việc cần làm tiếp; các bước sau nó ở trạng thái `blocked`
 * (trừ bước chỉ mang thông tin). Backend `ssh-dev` (VM thử) bỏ qua hai bước WSL nhưng vẫn báo trạng thái WSL của máy.
 */
export function buildSteps(i: StepInput): SetupStep[] {
  const steps: SetupStep[] = [];
  const viaWsl = i.backend?.kind !== "ssh-dev";
  const p = i.probe;
  const distroName = i.backend?.distro ?? RECOMMENDED_DISTRO;

  // 1. WSL trên Windows
  if (i.wsl.kind === "not_windows") steps.push({ id: "wsl", title: "Windows có WSL2", status: viaWsl ? "blocked" : "info", detail: "Máy này không chạy Windows; luồng host WSL2 không áp dụng." });
  else if (i.wsl.kind === "not_installed")
    steps.push({
      id: "wsl", title: "Windows có WSL2", status: viaWsl ? "manual" : "info",
      detail: `Windows báo: "${i.wsl.message.slice(0, 160)}". Cần cài WSL một lần.`,
      manual: {
        why: "Cài WSL bật tính năng ảo hoá của Windows, cần quyền quản trị và khởi động lại máy.",
        where: "PowerShell (Run as administrator)",
        commands: ["wsl --install --no-distribution", "# Khởi động lại Windows khi được yêu cầu, rồi mở lại app và bấm Kiểm tra lại."],
        needsAdmin: true, needsRestart: true,
      },
      assist: "install_wsl",
    });
  else steps.push({ id: "wsl", title: "Windows có WSL2", status: viaWsl ? "ok" : "info", detail: `WSL đã cài${i.wsl.version ? ` (bản ${i.wsl.version})` : ""}.` });

  // 2. Distro riêng làm guest
  if (viaWsl) {
    if (i.wsl.kind === "no_distro")
      steps.push({
        id: "distro", title: "Bản Linux dành riêng cho việc cho thuê", status: "manual", detail: "WSL chưa có bản Linux nào.",
        manual: {
          why: "Bản Linux đầu tiên hỏi bạn đặt tên người dùng và mật khẩu Linux trong cửa sổ riêng; app không điền thay bạn.",
          where: "PowerShell",
          commands: [`wsl --install -d ${RECOMMENDED_DISTRO}`, "# Đặt user/mật khẩu Linux khi được hỏi, gõ exit để thoát, rồi bấm Kiểm tra lại."],
          needsAdmin: false, needsRestart: false,
        },
        assist: "install_distro",
      });
    else if (i.wsl.kind === "ready") {
      const chosen = i.backend?.distro ? i.wsl.distros.find((d) => d.name === i.backend!.distro) : undefined;
      if (!i.backend) steps.push({ id: "distro", title: "Bản Linux dành riêng cho việc cho thuê", status: "action", action: "choose_distro", detail: `Chọn bản Linux dùng RIÊNG cho việc cho thuê (không dùng bản bạn làm việc cá nhân). Có: ${i.wsl.distros.map((d) => d.name).join(", ")}.` });
      else if (!chosen) steps.push({ id: "distro", title: "Bản Linux dành riêng cho việc cho thuê", status: "action", action: "choose_distro", detail: `Không còn thấy bản "${i.backend.distro}" trong WSL. Chọn lại.` });
      else if (chosen.version === 1)
        steps.push({
          id: "distro", title: "Bản Linux dành riêng cho việc cho thuê", status: "manual", detail: `"${chosen.name}" đang là WSL 1; cần WSL 2 để chạy Docker.`,
          manual: { why: "Chuyển phiên bản WSL thay đổi cách bản Linux đó chạy; bạn tự quyết định.", where: "PowerShell", commands: [`wsl --set-version ${chosen.name} 2`], needsAdmin: false, needsRestart: false },
        });
      else steps.push({ id: "distro", title: "Bản Linux dành riêng cho việc cho thuê", status: "ok", detail: `Dùng "${chosen.name}" (WSL 2).` });
    } else steps.push({ id: "distro", title: "Bản Linux dành riêng cho việc cho thuê", status: "blocked", detail: "Cần WSL trước." });
  }

  const upstreamReady = steps.every((s) => s.status === "ok" || s.status === "info") && !!i.backend;
  const pending = (id: SetupStep["id"], title: string): SetupStep => ({ id, title, status: "blocked", detail: "Chờ các bước trên." });

  // 3. Kết nối guest
  if (!upstreamReady || !p) {
    steps.push(pending("connect", "Kết nối với bản Linux"));
  } else if (!p.ok) {
    steps.push({ id: "connect", title: "Kết nối với bản Linux", status: "blocked", detail: p.error ?? "Không đọc được trạng thái của bản Linux." });
  } else {
    const res = [p.cpuCount !== null && `${p.cpuCount} CPU`, p.memTotalMb !== null && `${(p.memTotalMb / 1024).toFixed(1)} GB RAM`, p.diskFreeGb !== null && `còn ${p.diskFreeGb} GB đĩa`].filter(Boolean).join(", ");
    steps.push({ id: "connect", title: "Kết nối với bản Linux", status: "ok", detail: `${p.os || "Linux"}, người dùng ${p.user || "?"}${res ? ` · ${res}` : ""}${viaWsl && !p.isWsl ? " · (không phải nhân WSL)" : ""}.` });
  }
  const connected = !!p?.ok && upstreamReady;

  // 4. systemd (để Docker tự chạy khi guest khởi động) — chỉ là điều kiện khi Docker chưa chạy
  if (viaWsl) {
    if (!connected) steps.push(pending("systemd", "Dịch vụ nền Linux (systemd)"));
    else if (p!.systemd) steps.push({ id: "systemd", title: "Dịch vụ nền Linux (systemd)", status: "ok", detail: "Đã bật: Docker tự chạy khi bản Linux khởi động." });
    else
      steps.push({
        id: "systemd", title: "Dịch vụ nền Linux (systemd)", status: "manual", detail: "Chưa bật. Nếu không bật, Docker sẽ không tự chạy mỗi khi bản Linux khởi động.",
        manual: {
          why: "Sửa /etc/wsl.conf và tắt mọi bản WSL đang chạy là thay đổi cấu hình WSL của bạn.",
          where: "PowerShell",
          commands: [`wsl -d ${distroName} -u root -- sh -c "printf '[boot]\\nsystemd=true\\n' >> /etc/wsl.conf"`, "wsl --shutdown", "# Lệnh thứ hai tắt MỌI bản WSL đang chạy. Sau đó bấm Kiểm tra lại."],
          needsAdmin: false, needsRestart: false,
        },
      });
  }
  const baseOk = connected && steps.every((s) => s.status === "ok" || s.status === "info");

  // 5. Docker + Node
  if (!baseOk) steps.push(pending("packages", "Docker và Node.js"));
  else if (p!.dockerAccess && p!.nodeOk) steps.push({ id: "packages", title: "Docker và Node.js", status: "ok", detail: `Docker ${p!.dockerCli}, Node ${p!.node}.` });
  else {
    const miss = [!p!.dockerCli && "Docker", p!.dockerCli && !p!.dockerSock && "bật dịch vụ Docker", p!.dockerSock && !p!.dockerAccess && "quyền dùng Docker cho user", !p!.node && "Node", p!.node && !p!.nodeOk && `Node ≥ 18 (đang ${p!.node})`].filter(Boolean).join(", ");
    steps.push({ id: "packages", title: "Docker và Node.js", status: "action", action: "provision", detail: `Còn thiếu: ${miss}. Ứng dụng cài bằng quyền quản trị của bản Linux (không phải quyền quản trị Windows).` });
  }

  // 6. Image Selkies
  if (!baseOk) steps.push(pending("image", "Môi trường desktop cho khách"));
  else if (p!.imagePresent) steps.push({ id: "image", title: "Môi trường desktop cho khách", status: "ok", detail: "Đã tải xong." });
  else if (p!.diskFreeGb !== null && p!.diskFreeGb < MIN_FREE_GB) steps.push({ id: "image", title: "Môi trường desktop cho khách", status: "blocked", detail: `Bản Linux chỉ còn ${p!.diskFreeGb} GB trống; cần khoảng ${MIN_FREE_GB} GB để tải và giải nén môi trường desktop (khoảng 8 GB).` });
  else steps.push({ id: "image", title: "Môi trường desktop cho khách", status: "action", action: "provision", detail: "Chưa có. Tải một lần, khoảng 8 GB qua mạng của bạn." });

  const provisioned = baseOk && steps.every((s) => s.status === "ok" || s.status === "info");

  // 7. Agent
  if (!provisioned) steps.push(pending("agent", "Dịch vụ cho thuê của Cloud PC"));
  else if (p!.agentInstalled && p!.configured && p!.agentSha256 === i.appAgentSha256) steps.push({ id: "agent", title: "Dịch vụ cho thuê của Cloud PC", status: "ok", detail: `Đã cài đúng phiên bản.` });
  else steps.push({ id: "agent", title: "Dịch vụ cho thuê của Cloud PC", status: "action", action: "install", detail: !p!.agentInstalled ? "Chưa cài. Dịch vụ chỉ ghi vào một thư mục riêng trong bản Linux." : p!.agentSha256 !== i.appAgentSha256 ? "Phiên bản đang cài khác phiên bản của ứng dụng; cần cập nhật." : "Chưa có cấu hình." });
  const agentOk = provisioned && steps[steps.length - 1]!.status === "ok";

  // 8. Mạng tới máy chủ API (control plane)
  if (!agentOk) steps.push(pending("network", "Kết nối tới máy chủ"));
  else if (p!.apiReachable === true) steps.push({ id: "network", title: "Kết nối tới máy chủ", status: "ok", detail: "Dịch vụ chỉ kết nối ra ngoài tới máy chủ, không mở cổng vào từ Internet." });
  else if (p!.apiReachable === null) steps.push({ id: "network", title: "Kết nối tới máy chủ", status: "info", detail: "Chưa kiểm tra được (ứng dụng chưa có địa chỉ máy chủ)." });
  else
    steps.push({
      id: "network", title: "Kết nối tới máy chủ", status: viaWsl ? "manual" : "blocked",
      detail: viaWsl ? "Máy chưa kết nối được tới máy chủ. Nếu máy chủ chạy ngay trên máy Windows này, WSL ở chế độ mạng mặc định (NAT) không thấy được 127.0.0.1 của Windows." : "Máy chưa kết nối được tới máy chủ (máy chủ chưa chạy?).",
      manual: viaWsl
        ? {
            why: "Đổi chế độ mạng của WSL là thay đổi cấu hình WSL của bạn (tệp .wslconfig, cần Windows 11 22H2 trở lên).",
            where: "PowerShell",
            commands: ["# Chỉ cần khi máy chủ chạy ngay trên máy này:", `Add-Content "$env:USERPROFILE\\.wslconfig" "[wsl2]\`nnetworkingMode=mirrored"`, "wsl --shutdown", "# Nếu máy chủ ở nơi khác: kiểm tra máy chủ đang chạy và mạng của máy này."],
            needsAdmin: false, needsRestart: false,
          }
        : undefined,
    });
  const netOk = agentOk && (steps[steps.length - 1]!.status === "ok" || steps[steps.length - 1]!.status === "info");

  // 9. Ghi danh thiết bị
  if (!netOk) steps.push(pending("enroll", "Ghi danh thiết bị"));
  else if (p!.enrolled) steps.push({ id: "enroll", title: "Ghi danh thiết bị", status: "ok", detail: `Đã ghi danh cho máy ${p!.machineId?.slice(0, 8) ?? "?"}….` });
  else steps.push({ id: "enroll", title: "Ghi danh thiết bị", status: "action", action: "enroll", detail: "Chọn máy bạn đã đăng rồi bấm ghi danh. (Cần đăng máy ở mục Máy của tôi trước.)" });
  const enrolled = netOk && steps[steps.length - 1]!.status === "ok";

  // 10. Nhận thuê
  if (!enrolled) steps.push(pending("run", "Nhận thuê"));
  else if (i.agentRunning || p!.agentRunning) {
    const h = i.health;
    steps.push({ id: "run", title: "Nhận thuê", status: "ok", detail: h === "ok" ? "Đang nhận thuê; máy đang kết nối với máy chủ." : h === "suspect" || h === "incident" ? "Đang chạy nhưng máy chưa kết nối được với máy chủ trong ít phút gần đây." : "Đang khởi động; chờ kết nối đầu tiên với máy chủ." });
  } else steps.push({ id: "run", title: "Nhận thuê", status: "action", action: "start", detail: "Sẵn sàng. Bấm Bắt đầu nhận thuê và giữ ứng dụng mở trong lúc cho thuê." });
  return steps;
}

/** Bước cần làm tiếp (bước đầu tiên chưa xong và không chỉ mang thông tin). */
export const nextStep = (steps: SetupStep[]) => steps.find((s) => s.status !== "ok" && s.status !== "info") ?? null;

export interface GpuNote {
  detected: boolean;
  text: string;
}
/** GPU chỉ là THÔNG TIN: phát hiện được không có nghĩa Selkies đã mã hoá bằng GPU. */
export function gpuNote(p: GuestProbe | null): GpuNote {
  if (!p?.ok) return { detected: false, text: "Chưa kiểm tra." };
  const bits = [p.gpuNvidia && `NVIDIA: ${p.gpuNvidia}`, p.gpuDxg && "có /dev/dxg (GPU ảo hoá của WSL)", p.gpuRenderNode && "có /dev/dri/renderD128", p.dockerNvidiaRuntime && "Docker có runtime nvidia"].filter(Boolean);
  if (bits.length === 0) return { detected: false, text: "Không phát hiện GPU. Hình ảnh sẽ được xử lý bằng CPU." };
  return { detected: true, text: `Phát hiện: ${bits.join("; ")}. Hiện tại hình ảnh vẫn được xử lý bằng CPU; tăng tốc bằng GPU chưa được hỗ trợ.` };
}

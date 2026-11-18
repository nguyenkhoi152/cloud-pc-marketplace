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
  need_root: "Bước cài cần quyền root trong guest.",
  bad_user: "Tên user trong guest không hợp lệ.",
  no_such_user: "User không tồn tại trong guest.",
  unsupported_distro: "Chỉ hỗ trợ guest Debian/Ubuntu (cần apt).",
  node_too_old: "Node trong guest quá cũ (cần 18 trở lên; dùng Ubuntu 24.04).",
  docker_start_failed: "Không khởi động được dịch vụ Docker trong guest.",
  image_missing_after_pull: "Tải image Selkies chưa xong hoặc thất bại.",
  agent_checksum_mismatch: "Tệp agent chép vào guest bị sai checksum; thử cài lại.",
  config_bad_format: "Cấu hình agent sai định dạng.",
  config_key_not_allowed: "Cấu hình agent có mục không được phép.",
  no_node: "Guest chưa có Node.",
  agent_not_installed: "Guest chưa có agent.",
  not_configured: "Agent trong guest chưa được cấu hình.",
  agent_running: "Agent đang chạy; hãy dừng trước.",
  enroll_failed: "Ghi danh thất bại: mã không hợp lệ, đã dùng, hết hạn, hoặc guest không gọi được máy chủ API.",
  docker_unavailable: "Docker trong guest chưa chạy hoặc user chưa thuộc nhóm docker.",
  image_missing: "Guest chưa có image Selkies.",
  container_still_present: "Chưa xoá được container khách.",
  bad_arg: "Tham số không hợp lệ.",
  unsupported_action: "Hành động không được hỗ trợ.",
};

/** Lỗi của một lệnh guest → một câu tiếng Việt (không lộ chi tiết nhạy cảm; token không bao giờ nằm trong đầu ra). */
export function guestError(c: Captured): string | null {
  if (c.code === 0) return null;
  const code = parseKv(c.stdout).error;
  if (code && GUEST_ERRORS[code]) return GUEST_ERRORS[code]!;
  const all = `${c.stdout}\n${c.stderr}`;
  if (c.code === -2) return "Guest không trả lời kịp (hết giờ chờ).";
  if (c.code === -1) return "Không chạy được công cụ kết nối guest trên máy này (wsl.exe/ssh.exe).";
  if (/no distribution with the supplied name|WSL_E_DISTRO_NOT_FOUND/i.test(all)) return "Không tìm thấy distro WSL đã chọn.";
  if (/not installed/i.test(all) && /Windows Subsystem for Linux/i.test(all)) return "Windows chưa cài WSL.";
  if (/Connection (refused|timed out|reset)|Could not resolve|Permission denied \(publickey/i.test(all)) return "Không kết nối được guest qua SSH (máy ảo chưa bật hoặc khoá không đúng).";
  if (/a password is required|sudo:/i.test(all)) return "Guest đòi mật khẩu sudo; bước này cần root không mật khẩu trong guest.";
  const tail = lines(c.stderr).pop() ?? lines(c.stdout).pop() ?? "";
  return `Lệnh trong guest thất bại (mã ${c.code})${tail ? `: ${tail.slice(0, 160)}` : ""}.`;
}

export interface GuestProbe {
  ok: boolean;
  error: string | null;
  isWsl: boolean;
  os: string;
  systemd: boolean;
  user: string;
  cpuCount: number | null;
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
    error: done ? null : (guestError(c) ?? "Kết quả kiểm tra guest không đầy đủ."),
    isWsl: kv.is_wsl === "1",
    os: [kv.os_id, kv.os_version].filter(Boolean).join(" "),
    systemd: kv.systemd === "1",
    user: kv.user ?? "",
    cpuCount: int(kv.cpu_count),
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
    dockerNvidiaRuntime: kv.docker_nvidia_runtime === "1",
    apiReachable: kv.api_reachable === "1" ? true : kv.api_reachable === "0" ? false : null,
  };
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
        why: "Cài WSL bật tính năng ảo hoá của Windows, cần quyền quản trị và khởi động lại máy. App không tự làm việc này.",
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
        id: "distro", title: "Guest Linux riêng cho việc cho thuê", status: "manual", detail: "WSL chưa có bản Linux nào.",
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
      if (!i.backend) steps.push({ id: "distro", title: "Guest Linux riêng cho việc cho thuê", status: "action", action: "choose_distro", detail: `Chọn bản Linux dùng RIÊNG cho việc cho thuê (không dùng bản bạn làm việc cá nhân). Có: ${i.wsl.distros.map((d) => d.name).join(", ")}.` });
      else if (!chosen) steps.push({ id: "distro", title: "Guest Linux riêng cho việc cho thuê", status: "action", action: "choose_distro", detail: `Không còn thấy bản "${i.backend.distro}" trong WSL. Chọn lại.` });
      else if (chosen.version === 1)
        steps.push({
          id: "distro", title: "Guest Linux riêng cho việc cho thuê", status: "manual", detail: `"${chosen.name}" đang là WSL 1; cần WSL 2 để chạy Docker.`,
          manual: { why: "Chuyển phiên bản WSL thay đổi cách bản Linux đó chạy; bạn tự quyết định.", where: "PowerShell", commands: [`wsl --set-version ${chosen.name} 2`], needsAdmin: false, needsRestart: false },
        });
      else steps.push({ id: "distro", title: "Guest Linux riêng cho việc cho thuê", status: "ok", detail: `Dùng "${chosen.name}" (WSL 2).` });
    } else steps.push({ id: "distro", title: "Guest Linux riêng cho việc cho thuê", status: "blocked", detail: "Cần WSL trước." });
  }

  const upstreamReady = steps.every((s) => s.status === "ok" || s.status === "info") && !!i.backend;
  const pending = (id: SetupStep["id"], title: string): SetupStep => ({ id, title, status: "blocked", detail: "Chờ các bước trên." });

  // 3. Kết nối guest
  if (!upstreamReady || !p) {
    steps.push(pending("connect", "Kết nối được guest"));
  } else if (!p.ok) {
    steps.push({ id: "connect", title: "Kết nối được guest", status: "blocked", detail: p.error ?? "Không đọc được trạng thái guest." });
  } else {
    const res = [p.cpuCount !== null && `${p.cpuCount} CPU`, p.memTotalMb !== null && `${(p.memTotalMb / 1024).toFixed(1)} GB RAM`, p.diskFreeGb !== null && `còn ${p.diskFreeGb} GB đĩa`].filter(Boolean).join(", ");
    steps.push({ id: "connect", title: "Kết nối được guest", status: "ok", detail: `${p.os || "Linux"}, user ${p.user || "?"}${res ? ` · ${res}` : ""}${viaWsl && !p.isWsl ? " · (không phải nhân WSL)" : ""}.` });
  }
  const connected = !!p?.ok && upstreamReady;

  // 4. systemd (để Docker tự chạy khi guest khởi động) — chỉ là điều kiện khi Docker chưa chạy
  if (viaWsl) {
    if (!connected) steps.push(pending("systemd", "systemd trong guest"));
    else if (p!.systemd) steps.push({ id: "systemd", title: "systemd trong guest", status: "ok", detail: "Đang bật: dịch vụ Docker tự chạy khi guest khởi động." });
    else
      steps.push({
        id: "systemd", title: "systemd trong guest", status: "manual", detail: "Chưa bật. Không có systemd thì Docker không tự chạy mỗi lần guest khởi động.",
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
  if (!baseOk) steps.push(pending("packages", "Docker và Node trong guest"));
  else if (p!.dockerAccess && p!.nodeOk) steps.push({ id: "packages", title: "Docker và Node trong guest", status: "ok", detail: `Docker ${p!.dockerCli}, Node ${p!.node}.` });
  else {
    const miss = [!p!.dockerCli && "Docker", p!.dockerCli && !p!.dockerSock && "bật dịch vụ Docker", p!.dockerSock && !p!.dockerAccess && "quyền dùng Docker cho user", !p!.node && "Node", p!.node && !p!.nodeOk && `Node ≥ 18 (đang ${p!.node})`].filter(Boolean).join(", ");
    steps.push({ id: "packages", title: "Docker và Node trong guest", status: "action", action: "provision", detail: `Còn thiếu: ${miss}. App cài bằng quyền root CỦA GUEST (không phải quyền admin Windows).` });
  }

  // 6. Image Selkies
  if (!baseOk) steps.push(pending("image", "Image desktop Selkies"));
  else if (p!.imagePresent) steps.push({ id: "image", title: "Image desktop Selkies", status: "ok", detail: "Đã có đúng bản đã ghim (2.2.1, theo digest)." });
  else if (p!.diskFreeGb !== null && p!.diskFreeGb < MIN_FREE_GB) steps.push({ id: "image", title: "Image desktop Selkies", status: "blocked", detail: `Guest chỉ còn ${p!.diskFreeGb} GB trống; cần khoảng ${MIN_FREE_GB} GB để tải và giải nén image (~8 GB).` });
  else steps.push({ id: "image", title: "Image desktop Selkies", status: "action", action: "provision", detail: "Chưa có. Tải một lần, khoảng 8 GB qua mạng của bạn." });

  const provisioned = baseOk && steps.every((s) => s.status === "ok" || s.status === "info");

  // 7. Agent
  if (!provisioned) steps.push(pending("agent", "Agent của Cloud PC trong guest"));
  else if (p!.agentInstalled && p!.configured && p!.agentSha256 === i.appAgentSha256) steps.push({ id: "agent", title: "Agent của Cloud PC trong guest", status: "ok", detail: `Đúng bản đi kèm app (${i.appAgentSha256.slice(0, 12)}…).` });
  else steps.push({ id: "agent", title: "Agent của Cloud PC trong guest", status: "action", action: "install", detail: !p!.agentInstalled ? "Chưa cài. Agent chỉ ghi vào thư mục riêng ~/.cpm-host trong guest." : p!.agentSha256 !== i.appAgentSha256 ? "Bản trong guest khác bản đi kèm app; cần cập nhật." : "Chưa có cấu hình." });
  const agentOk = provisioned && steps[steps.length - 1]!.status === "ok";

  // 8. Mạng tới máy chủ API (control plane)
  if (!agentOk) steps.push(pending("network", "Guest gọi được máy chủ API"));
  else if (p!.apiReachable === true) steps.push({ id: "network", title: "Guest gọi được máy chủ API", status: "ok", detail: "Agent chỉ kết nối RA NGOÀI tới máy chủ; không mở cổng vào từ Internet." });
  else if (p!.apiReachable === null) steps.push({ id: "network", title: "Guest gọi được máy chủ API", status: "info", detail: "Chưa kiểm tra được (app chưa có địa chỉ máy chủ API)." });
  else
    steps.push({
      id: "network", title: "Guest gọi được máy chủ API", status: viaWsl ? "manual" : "blocked",
      detail: viaWsl ? "Guest không gọi được máy chủ API. Nếu máy chủ API chạy ngay trên máy Windows này (demo cục bộ), WSL ở chế độ mạng mặc định (NAT) không thấy 127.0.0.1 của Windows." : "Guest không gọi được máy chủ API (máy chủ chưa chạy?).",
      manual: viaWsl
        ? {
            why: "Đổi chế độ mạng của WSL là thay đổi cấu hình WSL của bạn (tệp .wslconfig, cần Windows 11 22H2 trở lên).",
            where: "PowerShell",
            commands: ["# Chỉ cần cho demo cục bộ khi máy chủ API chạy trên chính máy này:", `Add-Content "$env:USERPROFILE\\.wslconfig" "[wsl2]\`nnetworkingMode=mirrored"`, "wsl --shutdown", "# Nếu máy chủ API ở nơi khác: kiểm tra máy chủ đang chạy và mạng của máy này."],
            needsAdmin: false, needsRestart: false,
          }
        : undefined,
    });
  const netOk = agentOk && (steps[steps.length - 1]!.status === "ok" || steps[steps.length - 1]!.status === "info");

  // 9. Ghi danh thiết bị
  if (!netOk) steps.push(pending("enroll", "Ghi danh thiết bị"));
  else if (p!.enrolled) steps.push({ id: "enroll", title: "Ghi danh thiết bị", status: "ok", detail: `Guest đã có credential riêng cho máy ${p!.machineId?.slice(0, 8) ?? "?"}… (chỉ lưu trong guest).` });
  else steps.push({ id: "enroll", title: "Ghi danh thiết bị", status: "action", action: "enroll", detail: "Dán mã ghi danh một lần do admin cấp sau khi máy được duyệt." });
  const enrolled = netOk && steps[steps.length - 1]!.status === "ok";

  // 10. Nhận thuê
  if (!enrolled) steps.push(pending("run", "Nhận thuê"));
  else if (i.agentRunning || p!.agentRunning) {
    const h = i.health;
    steps.push({ id: "run", title: "Nhận thuê", status: "ok", detail: h === "ok" ? "Agent đang chạy; máy chủ nhận được heartbeat." : h === "suspect" || h === "incident" ? "Agent đang chạy nhưng máy chủ chưa nhận heartbeat gần đây." : "Agent đang chạy; đang chờ heartbeat đầu tiên." });
  } else steps.push({ id: "run", title: "Nhận thuê", status: "action", action: "start", detail: "Sẵn sàng. Bấm Bắt đầu nhận thuê để chạy agent; app phải mở trong lúc cho thuê." });
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
  if (bits.length === 0) return { detected: false, text: "Guest không thấy GPU. Selkies sẽ dựng hình và mã hoá bằng CPU." };
  return { detected: true, text: `Guest thấy: ${bits.join("; ")}. Bản thử này vẫn chạy Selkies bằng CPU: mã hoá bằng GPU trong WSL2 CHƯA được kiểm chứng.` };
}

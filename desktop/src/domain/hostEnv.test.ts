import { describe, expect, it } from "vitest";
import { buildSteps, enrolledForOtherAccount, gpuNote, guestError, interpretWsl, interpretWslInstall, machineEligibility, nextStep, parseKv, parseProbe, type BackendInfo, type Captured, type GuestProbe, type WslState } from "./hostEnv";

const cap = (code: number, stdout = "", stderr = ""): Captured => ({ code, stdout, stderr });
const SHA = "88bfd111192d15883e4c271bdf7ea268e7eeeafa2cd7e04394fa86815f700025";

// Đầu ra THẬT của wsl.exe trên máy dev chưa cài WSL (10/11/2026): cả ba lệnh đều thất bại với cùng thông báo.
const NOT_INSTALLED = "The Windows Subsystem for Linux is not installed. You can install by running 'wsl.exe --install'.\nFor more information please visit https://aka.ms/wslinstall\n";
const notInstalled = { os: "windows", wslStatus: cap(50, NOT_INSTALLED), wslVersion: cap(1, NOT_INSTALLED), wslListVerbose: cap(1, NOT_INSTALLED), wslListQuiet: cap(1, NOT_INSTALLED) };

// Đầu ra theo định dạng tài liệu Microsoft mô tả (CHƯA quan sát trên máy này vì máy chưa cài WSL).
const VERBOSE = "  NAME                   STATE           VERSION\n* Ubuntu                 Stopped         2\n  Ubuntu-24.04           Running         2\n  legacy                 Stopped         1\n  docker-desktop         Running         2\n";
const QUIET = "Ubuntu\nUbuntu-24.04\nlegacy\ndocker-desktop\n";
const installed = { os: "windows", wslStatus: cap(0, "Default Distribution: Ubuntu\nDefault Version: 2\n"), wslVersion: cap(0, "WSL version: 2.6.1.0\nKernel version: 6.6.87.2-1\n"), wslListVerbose: cap(0, VERBOSE), wslListQuiet: cap(0, QUIET) };

describe("interpretWsl", () => {
  it("máy chưa cài WSL (đầu ra thật): not_installed kèm thông báo của Windows", () => {
    const s = interpretWsl(notInstalled);
    expect(s.kind).toBe("not_installed");
    expect(s.kind === "not_installed" && s.message).toContain("not installed");
  });
  it("không phải Windows", () => {
    expect(interpretWsl({ ...installed, os: "linux" })).toEqual({ kind: "not_windows" });
  });
  it("đã cài, chưa có distro nào", () => {
    const none = "Windows Subsystem for Linux has no installed distributions.\n";
    expect(interpretWsl({ ...installed, wslListVerbose: cap(1, none), wslListQuiet: cap(1, none) })).toEqual({ kind: "no_distro", version: "2.6.1.0" });
  });
  it("liệt kê distro: tên, phiên bản WSL, mặc định; bỏ distro nội bộ của Docker Desktop", () => {
    const s = interpretWsl(installed);
    expect(s).toEqual({
      kind: "ready", version: "2.6.1.0",
      distros: [
        { name: "Ubuntu", version: 2, running: false, isDefault: true },
        { name: "Ubuntu-24.04", version: 2, running: true, isDefault: false },
        { name: "legacy", version: 1, running: false, isDefault: false },
      ],
    });
  });
  it("WSL cũ không có --version nhưng liệt kê được ⇒ vẫn là đã cài; trạng thái bằng ngôn ngữ khác ⇒ running=null", () => {
    const s = interpretWsl({ ...installed, wslVersion: cap(1, "Invalid command line option: --version"), wslListVerbose: cap(0, "  NAME      STATE           VERSION\n* Ubuntu    Wird ausgeführt 2\n"), wslListQuiet: cap(0, "Ubuntu\n") });
    expect(s).toEqual({ kind: "ready", version: null, distros: [{ name: "Ubuntu", version: 2, running: null, isDefault: true }] });
  });
  it("tên lạ trong danh sách (không đúng dạng) bị bỏ, không đi tiếp vào lệnh", () => {
    const s = interpretWsl({ ...installed, wslListQuiet: cap(0, "ok-1\nbad name; rm\n$(id)\n") });
    expect(s.kind === "ready" && s.distros.map((d) => d.name)).toEqual(["ok-1"]);
  });
});

// Đầu ra THẬT của `cpm-guest.sh probe` trong VM Ubuntu 24.04 thử (10/11/2026), sau khi cài thành phần và agent.
const PROBE_VM = `probe_version=1
os_id=ubuntu
os_version=24.04
kernel=6.8.0-149-generic
is_wsl=0
systemd=1
user=cpm
in_docker_group=1
cpu_count=1
mem_total_mb=7942
disk_free_gb=44
docker_cli=29.1.3
docker_sock=1
docker_daemon=1
image_present=1
docker_nvidia_runtime=0
container=running
container_health=healthy
node=18.19.1
agent_installed=1
agent_sha256=${SHA}
configured=1
enrolled=0
machine_id=
agent_running=0
agent_pid=
gpu_dxg=0
gpu_render_node=1
gpu_nvidia=
api_reachable=0
probe_done=1
`;

describe("parseProbe / guestError", () => {
  it("đọc đúng kết quả thật từ VM thử", () => {
    const p = parseProbe(cap(0, PROBE_VM));
    expect(p).toMatchObject({ ok: true, error: null, os: "ubuntu 24.04", systemd: true, user: "cpm", cpuCount: 1, memTotalMb: 7942, diskFreeGb: 44, dockerCli: "29.1.3", dockerAccess: true, node: "18.19.1", nodeOk: true, imagePresent: true, agentInstalled: true, agentSha256: SHA, configured: true, enrolled: false, machineId: null, agentRunning: false, container: "running", containerHealth: "healthy", gpuDxg: false, gpuRenderNode: true, apiReachable: false, isWsl: false });
  });
  it("thiếu probe_done hoặc mã thoát khác 0 ⇒ không ok, kèm lý do; KHÔNG suy ra trạng thái tốt", () => {
    expect(parseProbe(cap(0, "docker_daemon=1\n"))).toMatchObject({ ok: false });
    const p = parseProbe(cap(1, "", "There is no distribution with the supplied name.\nError code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND"));
    expect(p.ok).toBe(false);
    expect(p.error).toBe("Không tìm thấy bản Linux đã chọn trong WSL.");
    expect(parseProbe(cap(-2, "", "hết giờ chờ")).error).toContain("hết giờ");
  });
  it("Node cũ hơn 18 bị coi là chưa đạt; machine_id sai dạng bị bỏ", () => {
    const p = parseProbe(cap(0, PROBE_VM.replace("node=18.19.1", "node=12.22.9").replace("machine_id=", "machine_id=abc; rm")));
    expect(p.nodeOk).toBe(false);
    expect(p.machineId).toBeNull();
  });
  it("mã lỗi của script guest → câu tiếng Việt; lỗi lạ không nuốt mất mã thoát", () => {
    expect(guestError(cap(1, "error=agent_checksum_mismatch\n"))).toContain("checksum");
    expect(guestError(cap(1, "error=enroll_failed\n"))).toContain("Ghi danh thất bại");
    expect(guestError(cap(255, "", "ssh: connect to host 127.0.0.1 port 2222: Connection refused"))).toContain("SSH");
    expect(guestError(cap(7, "", "lỗi gì đó"))).toContain("mã 7");
    expect(guestError(cap(0, "error=bad_arg"))).toBeNull();
  });
  it("parseKv chỉ nhận dòng tên=giá trị", () => {
    expect(parseKv("a=1\n[cpm] cài gói: docker.io\nb_c=x=y\nBAD=1\n")).toEqual({ a: "1", b_c: "x=y" });
  });
});

const wslReady: WslState = { kind: "ready", version: "2.6.1.0", distros: [{ name: "Ubuntu-24.04", version: 2, running: true, isDefault: true }, { name: "legacy", version: 1, running: false, isDefault: false }] };
const wslBackend: BackendInfo = { kind: "wsl", distro: "Ubuntu-24.04", label: null, target: null, agentApiBase: null, gatewayBind: "127.0.0.1" };
const vmBackend: BackendInfo = { kind: "ssh-dev", distro: null, label: "VM thử", target: "cpm@127.0.0.1", agentApiBase: "http://10.0.2.2:3000/api", gatewayBind: "0.0.0.0" };
const probe = (over: Partial<GuestProbe> = {}): GuestProbe => ({ ...parseProbe(cap(0, PROBE_VM)), isWsl: true, apiReachable: true, ...over });
const status = (steps: ReturnType<typeof buildSteps>) => Object.fromEntries(steps.map((s) => [s.id, s.status]));

describe("machineEligibility (cổng duy nhất trước khi đăng máy, không còn admin)", () => {
  it("guest đủ thành phần ⇒ đạt, không thiếu gì", () => {
    expect(machineEligibility(probe())).toEqual({ ok: true, missing: [] });
  });
  it("chưa quét hoặc quét lỗi ⇒ KHÔNG đạt (không suy ra tốt), kèm lý do", () => {
    expect(machineEligibility(null).ok).toBe(false);
    const bad = machineEligibility(parseProbe(cap(1, "", "There is no distribution with the supplied name.")));
    expect(bad.ok).toBe(false);
    expect(bad.missing).toEqual(["Không tìm thấy bản Linux đã chọn trong WSL."]);
  });
  it("thiếu từng thành phần ⇒ liệt kê đúng thứ thiếu", () => {
    expect(machineEligibility(probe({ dockerAccess: false })).missing).toEqual(["Docker dùng được"]);
    expect(machineEligibility(probe({ nodeOk: false })).missing).toEqual(["Node từ bản 18 trở lên"]);
    expect(machineEligibility(probe({ imagePresent: false })).missing).toEqual(["môi trường desktop cho khách"]);
    expect(machineEligibility(probe({ agentInstalled: false })).missing).toEqual(["dịch vụ cho thuê của Cloud PC"]);
    expect(machineEligibility(probe({ dockerAccess: false, imagePresent: false, agentInstalled: false })).missing).toHaveLength(3);
  });
});
const base = { appAgentSha256: SHA, agentRunning: false, health: null };

describe("interpretWslInstall (kết quả bước cài WSL giúp người dùng)", () => {
  const c = (code: number, stderr = "", stdout = ""): Captured => ({ code, stdout, stderr });
  it("0 hoặc 3010 là đã gửi lệnh; luôn nhắc khởi động lại và nói app không tự khởi động lại", () => {
    for (const code of [0, 3010]) {
      const r = interpretWslInstall(c(code));
      expect(r).toMatchObject({ ok: true, needsRestart: true });
      expect(r.message).toContain("không tự khởi động lại");
    }
  });
  it("từ chối UAC ⇒ thất bại, nói rõ chưa cài gì", () => {
    const r = interpretWslInstall(c(1, "This command cannot be run due to the error: The operation was canceled by the user."));
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain("chưa có gì được cài");
  });
  it("lỗi khác/quá hạn ⇒ không bao giờ báo thành công, có hướng dẫn tự làm", () => {
    const r = interpretWslInstall(c(5, "Access is denied"));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("mã 5");
    expect(r.message).toContain("Access is denied");
    expect(interpretWslInstall(c(-1)).message).toContain("wsl --install --no-distribution");
  });
});

describe("buildSteps", () => {
  it("máy chưa cài WSL: dừng đúng ở bước cài WSL với lệnh cho PowerShell quản trị + khởi động lại; mọi bước sau bị chặn", () => {
    const steps = buildSteps({ ...base, wsl: interpretWsl(notInstalled), backend: null, probe: null });
    const n = nextStep(steps)!;
    expect(n.id).toBe("wsl");
    expect(n.status).toBe("manual");
    expect(n.manual).toMatchObject({ needsAdmin: true, needsRestart: true, where: "PowerShell (Run as administrator)" });
    expect(n.manual!.commands[0]).toBe("wsl --install --no-distribution");
    expect(steps.slice(1).every((s) => s.status === "blocked")).toBe(true);
    expect(steps.some((s) => s.action)).toBe(false); // không có nút nào để app "tự cài WSL"
  });
  it("đã có WSL nhưng chưa có distro: hướng dẫn tạo Ubuntu 24.04 (không cần admin)", () => {
    const n = nextStep(buildSteps({ ...base, wsl: { kind: "no_distro", version: "2.6.1.0" }, backend: null, probe: null }))!;
    expect(n).toMatchObject({ id: "distro", status: "manual" });
    expect(n.manual).toMatchObject({ needsAdmin: false, needsRestart: false });
    expect(n.manual!.commands[0]).toBe("wsl --install -d Ubuntu-24.04");
  });
  it("có distro nhưng chưa chọn / chọn bản đã mất / bản WSL 1", () => {
    expect(nextStep(buildSteps({ ...base, wsl: wslReady, backend: null, probe: null }))).toMatchObject({ id: "distro", action: "choose_distro" });
    expect(nextStep(buildSteps({ ...base, wsl: wslReady, backend: { ...wslBackend, distro: "da-xoa" }, probe: null }))).toMatchObject({ id: "distro", action: "choose_distro" });
    const v1 = nextStep(buildSteps({ ...base, wsl: wslReady, backend: { ...wslBackend, distro: "legacy" }, probe: null }))!;
    expect(v1.manual!.commands).toEqual(["wsl --set-version legacy 2"]);
  });
  it("không kết nối được guest ⇒ nêu lý do, không đoán các bước sau", () => {
    const steps = buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: parseProbe(cap(1, "", "There is no distribution with the supplied name.")) });
    expect(nextStep(steps)).toMatchObject({ id: "connect", status: "blocked", detail: "Không tìm thấy bản Linux đã chọn trong WSL." });
  });
  it("WSL chưa bật systemd ⇒ hướng dẫn sửa wsl.conf (người dùng tự làm)", () => {
    const n = nextStep(buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: probe({ systemd: false }) }))!;
    expect(n).toMatchObject({ id: "systemd", status: "manual" });
    expect(n.manual!.commands.join("\n")).toContain("systemd=true");
    expect(n.manual!.commands).toContain("wsl --shutdown");
  });
  it("thiếu Docker/Node ⇒ nút cài bằng root của guest; thiếu image ⇒ nêu 8 GB; đĩa không đủ ⇒ chặn", () => {
    const a = buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: probe({ dockerCli: "", dockerSock: false, dockerAccess: false, node: "", nodeOk: false, imagePresent: false }) });
    expect(nextStep(a)).toMatchObject({ id: "packages", action: "provision" });
    expect(a.find((s) => s.id === "packages")!.detail).toContain("Docker, Node");
    const b = buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: probe({ imagePresent: false }) });
    expect(nextStep(b)).toMatchObject({ id: "image", action: "provision" });
    expect(nextStep(b)!.detail).toContain("8 GB");
    const c = buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: probe({ imagePresent: false, diskFreeGb: 9 }) });
    expect(nextStep(c)).toMatchObject({ id: "image", status: "blocked" });
  });
  it("user chưa thuộc nhóm docker (dịch vụ đang chạy) ⇒ vẫn là bước cài, nêu đúng thứ thiếu", () => {
    const s = buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: probe({ dockerAccess: false, inDockerGroup: false }) });
    expect(nextStep(s)).toMatchObject({ id: "packages", action: "provision" });
    expect(nextStep(s)!.detail).toContain("quyền dùng Docker");
  });
  it("agent khác bản đi kèm app ⇒ cài lại; chưa cấu hình ⇒ cài", () => {
    expect(nextStep(buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: probe({ agentSha256: "0".repeat(64) }) }))).toMatchObject({ id: "agent", action: "install" });
    expect(nextStep(buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: probe({ configured: false }) }))).toMatchObject({ id: "agent", action: "install" });
  });
  it("guest không gọi được API: WSL ⇒ hướng dẫn mạng mirrored (tự làm); VM thử ⇒ chặn", () => {
    const w = nextStep(buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: probe({ apiReachable: false }) }))!;
    expect(w).toMatchObject({ id: "network", status: "manual" });
    expect(w.manual!.commands.join("\n")).toContain("networkingMode=mirrored");
    const v = nextStep(buildSteps({ ...base, wsl: interpretWsl(notInstalled), backend: vmBackend, probe: probe({ isWsl: false, apiReachable: false }) }))!;
    expect(v).toMatchObject({ id: "network", status: "blocked" });
    expect(v.manual).toBeUndefined();
  });
  it("chưa ghi danh ⇒ cần mã; đã ghi danh ⇒ sẵn sàng bắt đầu; đang chạy ⇒ xong, nói rõ heartbeat", () => {
    expect(nextStep(buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: probe() }))).toMatchObject({ id: "enroll", action: "enroll" });
    const enrolled = probe({ enrolled: true, machineId: "11111111-2222-3333-4444-555555555555" });
    expect(nextStep(buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: enrolled }))).toMatchObject({ id: "run", action: "start" });
    const running = buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: enrolled, agentRunning: true, health: "ok" });
    expect(nextStep(running)).toBeNull();
    expect(running.find((s) => s.id === "run")!.detail).toContain("kết nối với máy chủ");
    const waiting = buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: enrolled, agentRunning: true, health: "unknown" });
    expect(waiting.find((s) => s.id === "run")!.detail).toContain("chờ kết nối đầu tiên");
  });
  it("bản Linux đã ghi danh cho máy của TÀI KHOẢN KHÁC (chủ máy đăng xuất, người khác đăng nhập) ⇒ phải ghi danh lại, KHÔNG được bắt đầu: nếu không máy của chủ cũ lại hiện online", () => {
    const MINE = "99999999-8888-7777-6666-555555555555";
    const THEIRS = "11111111-2222-3333-4444-555555555555";
    const enrolled = probe({ enrolled: true, machineId: THEIRS });
    // Máy đã ghi danh KHÔNG nằm trong các máy của tài khoản này.
    const other = buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: enrolled, ownMachineIds: [MINE] });
    expect(nextStep(other)).toMatchObject({ id: "enroll", status: "action", action: "enroll" });
    expect(other.find((s) => s.id === "enroll")!.detail).toContain("KHÔNG thuộc tài khoản");
    expect(other.find((s) => s.id === "run")).toMatchObject({ status: "blocked" }); // nút Bắt đầu nhận thuê không hiện
    expect(enrolledForOtherAccount(enrolled, [MINE])).toBe(true);
    expect(enrolledForOtherAccount(enrolled, [])).toBe(true); // tài khoản chưa có máy nào cũng không dùng được chứng chỉ của người khác
    // Dịch vụ đang chạy cho máy đó: nói rõ phải dừng trước (ghi danh lại bị từ chối khi dịch vụ đang chạy).
    const running = buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: enrolled, agentRunning: true, ownMachineIds: [MINE] });
    expect(running.find((s) => s.id === "enroll")!.detail).toContain("hãy dừng trước");
    // Máy của chính tài khoản này, hoặc chưa biết danh sách máy (đang tải/lỗi): KHÔNG chặn (chưa biết ≠ của người khác).
    expect(nextStep(buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: enrolled, ownMachineIds: [MINE, THEIRS] }))).toMatchObject({ id: "run", action: "start" });
    expect(nextStep(buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: enrolled, ownMachineIds: null }))).toMatchObject({ id: "run", action: "start" });
    expect(nextStep(buildSteps({ ...base, wsl: wslReady, backend: wslBackend, probe: enrolled }))).toMatchObject({ id: "run", action: "start" });
    expect(enrolledForOtherAccount(enrolled, null)).toBe(false);
    expect(enrolledForOtherAccount(probe(), [MINE])).toBe(false); // chưa ghi danh: bước ghi danh bình thường lo
    expect(enrolledForOtherAccount(null, [MINE])).toBe(false);
  });
  it("backend VM thử: không đòi WSL, nhưng vẫn BÁO trạng thái WSL của máy (không che việc máy chưa cài WSL)", () => {
    const steps = buildSteps({ ...base, wsl: interpretWsl(notInstalled), backend: vmBackend, probe: probe({ isWsl: false, enrolled: true, machineId: "11111111-2222-3333-4444-555555555555" }) });
    expect(status(steps)).toEqual({ wsl: "info", connect: "ok", packages: "ok", image: "ok", agent: "ok", network: "ok", enroll: "ok", run: "action" });
    expect(steps[0]!.detail).toContain("not installed");
    expect(steps[0]!.manual!.commands[0]).toBe("wsl --install --no-distribution");
  });
});

describe("gpuNote", () => {
  it("không bao giờ nói Selkies đang dùng GPU", () => {
    expect(gpuNote(null).detected).toBe(false);
    expect(gpuNote(probe({ gpuRenderNode: false })).text).toContain("CPU");
    const g = gpuNote(probe({ gpuDxg: true, gpuNvidia: "NVIDIA GeForce RTX 5070 Laptop GPU", dockerNvidiaRuntime: true }));
    expect(g.detected).toBe(true);
    expect(g.text).toContain("chưa được hỗ trợ");
    expect(g.text).toContain("RTX 5070");
  });
});

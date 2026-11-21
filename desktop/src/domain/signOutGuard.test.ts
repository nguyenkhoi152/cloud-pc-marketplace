import { describe, expect, it, vi } from "vitest";
import type { Captured } from "./hostEnv";
import { hostingStatus, inspectForSignOut, releaseEnrollment, SIGN_OUT_WARNINGS, stopForSignOut, type SignOutDeps } from "./signOutGuard";

const cap = (code: number, stdout = "", stderr = ""): Captured => ({ code, stdout, stderr });
const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const probeOut = (agentRunning: boolean, machineId: string = MINE) => cap(0, `docker_daemon=1\nmachine_id=${machineId}\nagent_running=${agentRunning ? 1 : 0}\nprobe_done=1\n`);
const BACKEND = { kind: "wsl", distro: "Ubuntu-24.04", label: null, target: null, agentApiBase: null, gatewayBind: "127.0.0.1" } as const;
const proc = (state: "never" | "running" | "exited") => ({ state, exitCode: null, startedMs: null, logTail: "" });

function deps(over: Partial<SignOutDeps> = {}): SignOutDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    available: () => true,
    overview: async () => ({ backend: BACKEND, agent: proc("never") }),
    probe: async () => { calls.push("probe"); return probeOut(false); },
    ownMachineIds: async () => [MINE],
    agentStop: async () => { calls.push("agentStop"); return cap(0, "stop_done=1\n"); },
    tunnelStop: async () => { calls.push("tunnelStop"); },
    ...over,
  };
}

describe("hostingStatus: máy này có đang nhận thuê không?", () => {
  it("không có lớp native (trình duyệt) ⇒ none, không gọi gì", async () => {
    const d = deps({ available: () => false, overview: vi.fn() as never });
    expect(await hostingStatus(d)).toBe("none");
    expect(d.overview).not.toHaveBeenCalled();
  });
  it("agent do app quản lý đang chạy ⇒ running (không cần chạm vào bản Linux)", async () => {
    const d = deps({ overview: async () => ({ backend: BACKEND, agent: proc("running") }) });
    expect(await hostingStatus(d)).toBe("running");
    expect(d.calls).not.toContain("probe");
  });
  it("agent chạy nền độc lập trong bản Linux (do script khởi động, app không quản lý) ⇒ vẫn là running: đây chính là trường hợp bị lọt trước đây", async () => {
    const d = deps({ probe: async () => probeOut(true) });
    expect(await hostingStatus(d)).toBe("running");
  });
  it("agent chạy nền là của NGƯỜI KHÁC (người thuê hoặc host khác đăng xuất trên PC của chủ máy) ⇒ none: không dừng nhầm máy của chủ máy", async () => {
    expect(await hostingStatus(deps({ probe: async () => probeOut(true, OTHER) }))).toBe("none");
    expect(await hostingStatus(deps({ probe: async () => probeOut(true, OTHER), ownMachineIds: async () => [] }))).toBe("none"); // tài khoản chưa có máy nào
  });
  it("không tra cứu được máy của tài khoản ⇒ coi là của mình (hỏi lại cho chắc, không bỏ sót); agent chạy mà không rõ máy nào ⇒ cũng hỏi", async () => {
    const d = deps({ probe: async () => probeOut(true, OTHER), ownMachineIds: async () => { throw new Error("mạng"); } });
    expect(await hostingStatus(d)).toBe("running");
    const noId = deps({ probe: async () => cap(0, "docker_daemon=1\nagent_running=1\nprobe_done=1\n") });
    expect(await hostingStatus(noId)).toBe("running");
  });
  it("không chạy ⇒ none; chưa chọn bản Linux ⇒ none mà không probe", async () => {
    expect(await hostingStatus(deps())).toBe("none");
    const d = deps({ overview: async () => ({ backend: null, agent: proc("never") }) });
    expect(await hostingStatus(d)).toBe("none");
    expect(d.calls).not.toContain("probe");
  });
  it("không kiểm tra được (probe lỗi, overview ném lỗi, hết giờ) ⇒ unknown, KHÔNG nói none", async () => {
    expect(await hostingStatus(deps({ probe: async () => cap(1, "", "There is no distribution with the supplied name.") }))).toBe("unknown");
    expect(await hostingStatus(deps({ overview: async () => { throw new Error("native lỗi"); } }))).toBe("unknown");
    expect(await hostingStatus(deps({ probe: () => new Promise(() => undefined) }), 30)).toBe("unknown");
  });
});

describe("stopForSignOut: dừng nhận thuê trước khi đăng xuất", () => {
  it("dừng agent rồi đóng tunnel, báo ok", async () => {
    const d = deps();
    expect(await stopForSignOut(d)).toEqual({ ok: true });
    expect(d.calls).toEqual(["agentStop", "tunnelStop"]);
  });
  it("guest báo lỗi ⇒ ok=false kèm câu tiếng Việt, tunnel vẫn đóng", async () => {
    const d = deps({ agentStop: async () => { d.calls.push("agentStop"); return cap(2, "error=docker_unavailable\n"); } });
    const r = await stopForSignOut(d);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toContain("Docker");
    expect(d.calls).toEqual(["agentStop", "tunnelStop"]);
  });
  it("lớp native ném lỗi ⇒ không ném tiếp (không chặn đăng xuất), tunnel vẫn đóng", async () => {
    const d = deps({ agentStop: async () => { d.calls.push("agentStop"); throw new Error("không chạy được wsl.exe"); } });
    const r = await stopForSignOut(d);
    expect(r).toEqual({ ok: false, error: "không chạy được wsl.exe" });
    expect(d.calls).toEqual(["agentStop", "tunnelStop"]);
  });
  it("câu cảnh báo nói rõ hậu quả và cách xử lý", () => {
    expect(SIGN_OUT_WARNINGS.unknown).toContain("Thiết lập & chạy máy");
    expect(SIGN_OUT_WARNINGS.stopFailed("hết giờ")).toContain("90 giây");
  });
});

const enrolledProbe = (machineId: string, agentRunning = false) => cap(0, `docker_daemon=1\nenrolled=1\nmachine_id=${machineId}\nagent_running=${agentRunning ? 1 : 0}\nprobe_done=1\n`);

describe("inspectForSignOut: có đang nhận thuê không, và bản Linux đang ghi danh cho máy nào của tài khoản này?", () => {
  it("không nhận thuê nhưng bản Linux còn ghi danh cho máy CỦA tài khoản này ⇒ none kèm máy cần gỡ ghi danh", async () => {
    expect(await inspectForSignOut(deps({ probe: async () => enrolledProbe(MINE) }))).toEqual({ hosting: "none", ownMachineId: MINE });
  });
  it("còn ghi danh cho máy của NGƯỜI KHÁC ⇒ không có máy cần gỡ (không đụng tới ghi danh của máy khác)", async () => {
    expect(await inspectForSignOut(deps({ probe: async () => enrolledProbe(OTHER) }))).toEqual({ hosting: "none", ownMachineId: null });
  });
  it("đang nhận thuê (agent nền của mình) ⇒ running kèm máy; sau khi dừng thì kiểm tra lại sẽ ra máy cần gỡ", async () => {
    expect(await inspectForSignOut(deps({ probe: async () => enrolledProbe(MINE, true) }))).toEqual({ hosting: "running", ownMachineId: MINE });
  });
  it("agent do app quản lý đang chạy ⇒ running, không probe (chưa biết máy, sẽ kiểm tra lại sau khi dừng)", async () => {
    const d = deps({ overview: async () => ({ backend: BACKEND, agent: proc("running") }) });
    expect(await inspectForSignOut(d)).toEqual({ hosting: "running", ownMachineId: null });
    expect(d.calls).not.toContain("probe");
  });
  it("chưa ghi danh, không có bản Linux, hoặc không có lớp native ⇒ không có gì để gỡ", async () => {
    expect((await inspectForSignOut(deps({ probe: async () => cap(0, "docker_daemon=1\nenrolled=0\nmachine_id=\nagent_running=0\nprobe_done=1\n") }))).ownMachineId).toBeNull();
    expect(await inspectForSignOut(deps({ overview: async () => ({ backend: null, agent: proc("never") }) }))).toEqual({ hosting: "none", ownMachineId: null });
    expect(await inspectForSignOut(deps({ available: () => false }))).toEqual({ hosting: "none", ownMachineId: null });
  });
  it("không tra cứu được danh sách máy ⇒ KHÔNG gỡ ghi danh (không chắc là của mình); agent đang chạy vẫn hỏi dừng", async () => {
    const down = deps({ probe: async () => enrolledProbe(MINE), ownMachineIds: async () => { throw new Error("mạng"); } });
    expect(await inspectForSignOut(down)).toEqual({ hosting: "none", ownMachineId: null });
    const runningDown = deps({ probe: async () => enrolledProbe(MINE, true), ownMachineIds: async () => { throw new Error("mạng"); } });
    expect(await inspectForSignOut(runningDown)).toEqual({ hosting: "running", ownMachineId: null });
  });
  it("không kiểm tra được ⇒ unknown, không có máy để gỡ", async () => {
    expect(await inspectForSignOut(deps({ probe: async () => cap(1, "", "There is no distribution with the supplied name.") }))).toEqual({ hosting: "unknown", ownMachineId: null });
    expect(await inspectForSignOut(deps({ probe: () => new Promise(() => undefined) }), 30)).toEqual({ hosting: "unknown", ownMachineId: null });
  });
});

describe("releaseEnrollment: gỡ ghi danh khi đăng xuất", () => {
  it("xoá credential cục bộ VÀ thu hồi thiết bị phía máy chủ", async () => {
    const calls: string[] = [];
    const r = await releaseEnrollment({ unenroll: async () => { calls.push("unenroll"); return cap(0, "unenroll_done=1\n"); }, revokeDevice: async (id) => { calls.push(`revoke:${id}`); } }, MINE);
    expect(r).toEqual({ localCleared: true, serverRevoked: true, errors: [] });
    expect(calls).toEqual(["unenroll", `revoke:${MINE}`]);
  });
  it("hai việc độc lập: bản Linux báo lỗi (vd. còn agent chạy) thì vẫn thu hồi phía máy chủ", async () => {
    const r = await releaseEnrollment({ unenroll: async () => cap(1, "error=agent_running\n"), revokeDevice: async () => undefined }, MINE);
    expect(r.localCleared).toBe(false);
    expect(r.serverRevoked).toBe(true);
    expect(r.errors).toEqual(["Dịch vụ cho thuê đang chạy; hãy dừng trước."]);
  });
  it("máy chủ không với tới được thì vẫn xoá credential cục bộ; lỗi được trả lại bằng chữ, không ném", async () => {
    const r = await releaseEnrollment({ unenroll: async () => cap(0, "unenroll_done=1\n"), revokeDevice: async () => { throw new Error("mạng"); } }, MINE);
    expect(r.localCleared).toBe(true);
    expect(r.serverRevoked).toBe(false);
    expect(r.errors[0]).toContain("Chưa thu hồi được thiết bị trên máy chủ");
  });
  it("lớp native ném lỗi (guest cũ không có hành động này, WSL hỏng) ⇒ không ném tiếp, đăng xuất không bị chặn", async () => {
    const r = await releaseEnrollment({ unenroll: async () => { throw new Error("không chạy được wsl.exe"); }, revokeDevice: async () => undefined }, MINE);
    expect(r).toEqual({ localCleared: false, serverRevoked: true, errors: ["không chạy được wsl.exe"] });
  });
  it("không có phương tiện nào được cung cấp ⇒ không làm gì và không báo lỗi", async () => {
    expect(await releaseEnrollment({}, MINE)).toEqual({ localCleared: false, serverRevoked: false, errors: [] });
  });
  it("câu thông báo nói rõ kết quả", () => {
    expect(SIGN_OUT_WARNINGS.released).toContain("bắt đầu từ đầu");
    expect(SIGN_OUT_WARNINGS.releaseFailed("lý do")).toContain("lý do");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Captured } from "./hostEnv";
import { hostingStatus, SIGN_OUT_WARNINGS, stopForSignOut, type SignOutDeps } from "./signOutGuard";

const cap = (code: number, stdout = "", stderr = ""): Captured => ({ code, stdout, stderr });
const probeOut = (agentRunning: boolean) => cap(0, `docker_daemon=1\nagent_running=${agentRunning ? 1 : 0}\nprobe_done=1\n`);
const BACKEND = { kind: "wsl", distro: "Ubuntu-24.04", label: null, target: null, agentApiBase: null, gatewayBind: "127.0.0.1" } as const;
const proc = (state: "never" | "running" | "exited") => ({ state, exitCode: null, startedMs: null, logTail: "" });

function deps(over: Partial<SignOutDeps> = {}): SignOutDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    available: () => true,
    overview: async () => ({ backend: BACKEND, agent: proc("never") }),
    probe: async () => { calls.push("probe"); return probeOut(false); },
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

import { describe, expect, it } from "vitest";
import { isTunnelUrl, startHosting, stopHosting, waitForTunnelUrl, type HostStartDeps, type TunnelInfo } from "./hostStart";

const URL1 = "https://able-seat-9-fox.trycloudflare.com";
function fake(o: { states?: TunnelInfo[]; configureCode?: number; agentFails?: boolean; tunnelStartFails?: boolean } = {}) {
  const log: string[] = [];
  const states = [...(o.states ?? [{ state: "running", url: URL1, exitCode: null, logTail: "" } as TunnelInfo])];
  const d: HostStartDeps = {
    tunnelStart: async () => { log.push("tunnelStart"); if (o.tunnelStartFails) throw new Error("Bản cài này không kèm thành phần tunnel"); },
    tunnelState: async () => { log.push("tunnelState"); return states.length > 1 ? states.shift()! : states[0]!; },
    tunnelStop: async () => { log.push("tunnelStop"); },
    configure: async (c) => { log.push(`configure:${c.apiBase}:${c.publicUrl ?? "-"}`); return { code: o.configureCode ?? 0, stdout: "", stderr: "" }; },
    agentStart: async () => { log.push("agentStart"); if (o.agentFails) throw new Error("agent không chạy"); },
    agentStop: async () => { log.push("agentStop"); return { code: 0, stdout: "stop_done=1", stderr: "" }; },
    sleep: async () => { log.push("sleep"); },
  };
  return { d, log };
}
const base = { apiBase: "https://abc.trycloudflare.com/api", frameAncestors: ["http://tauri.localhost"] };

describe("isTunnelUrl", () => {
  it("chỉ nhận https://<nhãn>.trycloudflare.com, không nhận api.* hay dạng khác", () => {
    expect(isTunnelUrl(URL1)).toBe(true);
    for (const bad of [null, undefined, "", "https://api.trycloudflare.com", "http://a.trycloudflare.com", "https://a.trycloudflare.com/", "https://a.trycloudflare.com.evil.example", "https://A.trycloudflare.com"])
      expect(isTunnelUrl(bad), String(bad)).toBe(false);
  });
});

describe("startHosting", () => {
  it("không chia sẻ ra Internet: KHÔNG mở tunnel, vẫn ghi lại cấu hình (địa chỉ API hiện tại) rồi mới chạy agent", async () => {
    const { d, log } = fake();
    expect(await startHosting(d, { ...base, share: false })).toEqual({ publicUrl: null });
    expect(log).toEqual([`configure:${base.apiBase}:-`, "agentStart"]);
  });
  it("chia sẻ: mở tunnel → chờ địa chỉ → ghi cấu hình với địa chỉ ĐÓ → chạy agent (đúng thứ tự)", async () => {
    const { d, log } = fake({ states: [{ state: "running", url: null, exitCode: null, logTail: "" }, { state: "running", url: URL1, exitCode: null, logTail: "" }] });
    expect(await startHosting(d, { ...base, share: true })).toEqual({ publicUrl: URL1 });
    expect(log.filter((x) => x !== "sleep" && x !== "tunnelState")).toEqual(["tunnelStart", `configure:${base.apiBase}:${URL1}`, "agentStart"]);
    expect(log.indexOf("tunnelStart")).toBeLessThan(log.indexOf(`configure:${base.apiBase}:${URL1}`));
    expect(log.indexOf(`configure:${base.apiBase}:${URL1}`)).toBeLessThan(log.indexOf("agentStart"));
  });
  it("giới hạn RAM/CPU được chuyển vào cấu hình agent mỗi lần bắt đầu; không đặt thì không có trường nào", async () => {
    const seen: unknown[] = [];
    const { d } = fake();
    d.configure = async (c) => { seen.push(c); return { code: 0, stdout: "", stderr: "" }; };
    await startHosting(d, { ...base, share: false, memoryMb: 4096, cpus: 2 });
    await startHosting(d, { ...base, share: false });
    expect(seen[0]).toEqual({ apiBase: base.apiBase, frameAncestors: base.frameAncestors, memoryMb: 4096, cpus: 2 });
    expect(seen[1]).toEqual({ apiBase: base.apiBase, frameAncestors: base.frameAncestors });
  });
  it("tunnel thoát trước khi có địa chỉ ⇒ lỗi rõ, tunnel được dừng, agent KHÔNG chạy, KHÔNG ghi cấu hình", async () => {
    const { d, log } = fake({ states: [{ state: "exited", url: null, exitCode: 1, logTail: "ERR failed to connect to the edge" }] });
    await expect(startHosting(d, { ...base, share: true })).rejects.toThrow(/Tunnel thoát \(mã 1\).*failed to connect/);
    expect(log).toContain("tunnelStop");
    expect(log.some((x) => x.startsWith("configure") || x === "agentStart")).toBe(false);
  });
  it("quá hạn chờ địa chỉ ⇒ lỗi + đóng tunnel", async () => {
    const { d, log } = fake({ states: [{ state: "running", url: null, exitCode: null, logTail: "" }] });
    await expect(startHosting(d, { ...base, share: true, timeoutMs: 3000 })).rejects.toThrow(/chưa có địa chỉ sau 3 giây/);
    expect(log.filter((x) => x === "tunnelStop")).toHaveLength(1);
    expect(log).not.toContain("agentStart");
  });
  it("ghi cấu hình thất bại (mã thoát ≠ 0) ⇒ không chạy agent, đóng tunnel vừa mở", async () => {
    const { d, log } = fake({ configureCode: 3 });
    await expect(startHosting(d, { ...base, share: true })).rejects.toThrow();
    expect(log).toContain("tunnelStop");
    expect(log).not.toContain("agentStart");
  });
  it("agent không chạy được ⇒ đóng tunnel (không để lối vào Internet mở khi không có agent)", async () => {
    const { d, log } = fake({ agentFails: true });
    await expect(startHosting(d, { ...base, share: true })).rejects.toThrow(/agent không chạy/);
    expect(log.at(-1)).toBe("tunnelStop");
  });
  it("thiếu cloudflared trong bản cài ⇒ lỗi gốc đến người dùng; agent không chạy", async () => {
    const { d, log } = fake({ tunnelStartFails: true });
    await expect(startHosting(d, { ...base, share: true })).rejects.toThrow(/không kèm thành phần tunnel/);
    expect(log).not.toContain("agentStart");
  });
  it("địa chỉ tunnel không đúng dạng (nhật ký bị đầu độc) không bao giờ được dùng", async () => {
    const { d, log } = fake({ states: [{ state: "running", url: "https://evil.example.com", exitCode: null, logTail: "" }] });
    await expect(waitForTunnelUrl(d, 2000)).rejects.toThrow(/chưa có địa chỉ/);
    expect(log.some((x) => x.startsWith("configure"))).toBe(false);
  });
});

describe("stopHosting", () => {
  it("dừng agent rồi đóng tunnel; agent báo lỗi vẫn đóng tunnel", async () => {
    const a = fake();
    await stopHosting(a.d);
    expect(a.log).toEqual(["agentStop", "tunnelStop"]);
    const b = fake();
    b.d.agentStop = async () => { b.log.push("agentStop"); throw new Error("wsl lỗi"); };
    await expect(stopHosting(b.d)).rejects.toThrow("wsl lỗi");
    expect(b.log).toEqual(["agentStop", "tunnelStop"]);
  });
});

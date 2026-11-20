// Điểm vào CLI của host-agent với API GIẢ (fetch giả có nhãn) và guest GIẢ. Không có docker/WSL thật ở đây.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type { GuestController } from "./agent";
import { buildGuest, cliMain, ConfigError, credentialPath, parseEnvFile, run, status, type CliIo } from "./main";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), "cpm-main-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const CRED = "K".repeat(43);
const MACHINE = "11111111-2222-3333-4444-555555555555";
const writeCred = (dir: string) => writeFileSync(path.join(dir, "credential.json"), JSON.stringify({ credential: CRED, machineId: MACHINE }));
const apiOk = (async (url: string) => (String(url).endsWith("/agent/commands") ? new Response(JSON.stringify({ commands: [] })) : new Response("{}"))) as unknown as typeof fetch;
const base = (dir: string) => ({ AGENT_API_BASE: "http://api.test/api", GATEWAY_UPSTREAM: "http://127.0.0.1:9", GATEWAY_PUBLIC_URL: "http://127.0.0.1:9000", AGENT_DATA_DIR: dir, AGENT_INTERVAL_MS: "20" });

function io(env: Record<string, string | undefined>, stdinText?: string) {
  const stdin = new PassThrough();
  if (stdinText !== undefined) stdin.end(stdinText);
  const lines: string[] = [];
  const stops: (() => void)[] = [];
  const o: CliIo = { env, stdin, out: (m) => lines.push(m), onStop: (s) => stops.push(s) };
  return { o, lines, stops, stdin };
}

describe("parseEnvFile", () => {
  it("lấy giá trị nguyên văn, không mở rộng kiểu shell; bỏ dòng trống và chú thích", () => {
    const e = parseEnvFile("# chú thích\n\nAGENT_API_BASE=http://10.0.2.2:3000/api\r\nX_Y=a=b $HOME `id` \"q\"\n");
    expect(e).toEqual({ AGENT_API_BASE: "http://10.0.2.2:3000/api", X_Y: 'a=b $HOME `id` "q"' });
  });
  it("dòng sai định dạng hoặc tên biến lạ ⇒ lỗi nêu số dòng, không nêu nội dung", () => {
    expect(() => parseEnvFile("OK=1\nexport A=1")).toThrow(/dòng 2/);
    expect(() => parseEnvFile("lower=1")).toThrow(ConfigError);
    try { parseEnvFile("secret token here"); } catch (e) { expect((e as Error).message).not.toContain("secret"); }
  });
});

describe("status", () => {
  it("chưa có/ hỏng credential ⇒ enrolled=false; có ⇒ trả machineId, KHÔNG trả credential", async () => {
    const dir = tmp();
    expect(await status({ AGENT_DATA_DIR: dir })).toEqual({ enrolled: false, machineId: null });
    writeFileSync(path.join(dir, "credential.json"), "{hỏng");
    expect(await status({ AGENT_DATA_DIR: dir })).toEqual({ enrolled: false, machineId: null });
    writeCred(dir);
    const s = await status({ AGENT_DATA_DIR: dir });
    expect(s).toEqual({ enrolled: true, machineId: MACHINE });
    expect(JSON.stringify(s)).not.toContain(CRED);
  });
  it("lệnh status in đúng hai dòng và không lộ credential", async () => {
    const dir = tmp();
    writeCred(dir);
    const t = io({ AGENT_DATA_DIR: dir });
    await cliMain(["status"], t.o);
    expect(t.lines).toEqual(["enrolled=1", `machine_id=${MACHINE}`]);
  });
});

describe("cliMain", () => {
  it("--env-file ghi đè biến môi trường; file không đọc được/sai ⇒ ConfigError", async () => {
    const dir = tmp(), other = tmp();
    writeCred(other);
    const f = path.join(dir, "agent.env");
    writeFileSync(f, `AGENT_DATA_DIR=${other}\n`);
    const t = io({ AGENT_DATA_DIR: dir });
    await cliMain(["--env-file", f, "status"], t.o);
    expect(t.lines[0]).toBe("enrolled=1");
    await expect(cliMain(["--env-file", path.join(dir, "khong-co"), "status"], io({}).o)).rejects.toBeInstanceOf(ConfigError);
    await expect(cliMain(["--env-file"], io({}).o)).rejects.toBeInstanceOf(ConfigError);
  });
  it("enroll --token-stdin: token đọc từ stdin; token sai dạng bị từ chối trước khi gọi mạng", async () => {
    const dir = tmp();
    // Token sai dạng ⇒ lỗi cấu hình (không tới bước gọi mạng nên không cần API).
    await expect(cliMain(["enroll", "--token-stdin"], io({ AGENT_API_BASE: "http://127.0.0.1:9/api", AGENT_DATA_DIR: dir }, "ngắn\n").o)).rejects.toThrow(/AGENT_ENROLL_TOKEN/);
    await expect(cliMain(["enroll", "--token-stdin"], io({ AGENT_API_BASE: "http://127.0.0.1:9/api", AGENT_DATA_DIR: dir }, "x".repeat(5000)).o)).rejects.toThrow(/quá dài/);
    expect(existsSync(credentialPath({ AGENT_DATA_DIR: dir }))).toBe(false);
  });
  it("lệnh lạ ⇒ hướng dẫn cách dùng", async () => {
    await expect(cliMain(["shell"], io({}).o)).rejects.toThrow(/Dùng:/);
  });
});

function fakeGuest() {
  const calls: string[] = [];
  const g: GuestController = {
    prepare: async () => ({ ok: true, evidence: "p" }), stopSession: async () => ({ ok: true, evidence: "s" }),
    reset: async () => ({ ok: true, evidence: "r" }), verifyReset: async () => ({ ok: true, evidence: "v" }),
    ensureReady: async () => { calls.push("ensureReady"); return { ok: true, evidence: "sạch" }; },
    cleanup: async () => { calls.push("cleanup"); return { ok: true, evidence: "đã xoá" }; },
  };
  return { g, calls };
}

describe("run: vòng đời guest", () => {
  it("khởi tạo guest khi bắt đầu; ghi pid file; dừng thì đóng gateway, dọn guest (khi bật cờ) và xoá pid file", async () => {
    const dir = tmp();
    writeCred(dir);
    const pid = path.join(dir, "agent.pid");
    const { g, calls } = fakeGuest();
    const ac = new AbortController();
    const logs: string[] = [];
    let port = 0;
    const done = run({ ...base(dir), AGENT_PID_FILE: pid, GUEST_CLEANUP_ON_EXIT: "1" }, ac.signal, (m) => logs.push(m), { guest: g, fetchImpl: apiOk, onReady: (i) => { port = i.gatewayPort; } });
    await expect.poll(() => port, { timeout: 5000 }).toBeGreaterThan(0);
    expect(calls).toEqual(["ensureReady"]);
    expect(readFileSync(pid, "utf8")).toBe(String(process.pid));
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(401); // gateway đang chạy và từ chối khi không có grant
    ac.abort();
    await done;
    expect(calls).toEqual(["ensureReady", "cleanup"]);
    expect(existsSync(pid)).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(); // gateway đã đóng
    expect(logs.join("\n")).not.toContain(CRED);
  });
  it("dừng: báo máy chủ offline NGAY (sau khi hết heartbeat, trước khi cắt phiên và dọn guest) để máy không còn hiện online", async () => {
    const dir = tmp();
    writeCred(dir);
    const events: string[] = [];
    const f = (async (url: string) => {
      const u = String(url);
      if (u.endsWith("/agent/heartbeat")) events.push("heartbeat");
      if (u.endsWith("/agent/offline")) events.push("offline");
      return u.endsWith("/agent/commands") ? new Response(JSON.stringify({ commands: [] })) : new Response("{}");
    }) as unknown as typeof fetch;
    const { g } = fakeGuest();
    g.cleanup = async () => { events.push("cleanup"); return { ok: true, evidence: "đã xoá" }; };
    const ac = new AbortController();
    let ready = false;
    const done = run({ ...base(dir), GUEST_CLEANUP_ON_EXIT: "1" }, ac.signal, () => undefined, { guest: g, fetchImpl: f, onReady: () => { ready = true; } });
    await expect.poll(() => ready, { timeout: 5000 }).toBe(true);
    await expect.poll(() => events.includes("heartbeat"), { timeout: 5000 }).toBe(true);
    ac.abort();
    await done;
    expect(events.filter((e) => e === "offline")).toHaveLength(1);
    expect(events.indexOf("offline")).toBeLessThan(events.indexOf("cleanup")); // báo trước khi dọn (việc dọn mất vài giây)
    expect(events.slice(events.indexOf("offline") + 1)).not.toContain("heartbeat"); // sau lời báo không còn nhịp tim nào kéo máy online lại
    expect(events.at(-1)).toBe("cleanup");
  });
  it("máy chủ không nhận lời báo offline (lỗi mạng) ⇒ vẫn dừng, vẫn dọn guest", async () => {
    const dir = tmp();
    writeCred(dir);
    const f = (async (url: string) => {
      const u = String(url);
      if (u.endsWith("/agent/offline")) throw new Error("ECONNREFUSED");
      return u.endsWith("/agent/commands") ? new Response(JSON.stringify({ commands: [] })) : new Response("{}");
    }) as unknown as typeof fetch;
    const { g, calls } = fakeGuest();
    const ac = new AbortController();
    let ready = false;
    const done = run({ ...base(dir), GUEST_CLEANUP_ON_EXIT: "1" }, ac.signal, () => undefined, { guest: g, fetchImpl: f, onReady: () => { ready = true; } });
    await expect.poll(() => ready, { timeout: 5000 }).toBe(true);
    ac.abort();
    await done;
    expect(calls).toEqual(["ensureReady", "cleanup"]);
  });
  it("lỗi cấu hình trước khi agent chạy (chưa có credential) ⇒ không gọi báo offline", async () => {
    const dir = tmp(); // không ghi credential
    const urls: string[] = [];
    const f = (async (url: string) => { urls.push(String(url)); return new Response("{}"); }) as unknown as typeof fetch;
    await expect(run(base(dir), new AbortController().signal, () => undefined, { guest: fakeGuest().g, fetchImpl: f })).rejects.toBeInstanceOf(ConfigError);
    expect(urls.some((u) => u.endsWith("/agent/offline"))).toBe(false);
  });
  it("không bật GUEST_CLEANUP_ON_EXIT ⇒ không dọn guest khi dừng", async () => {
    const dir = tmp();
    writeCred(dir);
    const { g, calls } = fakeGuest();
    const ac = new AbortController();
    let ready = false;
    const done = run(base(dir), ac.signal, () => undefined, { guest: g, fetchImpl: apiOk, onReady: () => { ready = true; } });
    await expect.poll(() => ready, { timeout: 5000 }).toBe(true);
    ac.abort();
    await done;
    expect(calls).toEqual(["ensureReady"]);
  });
  it("khởi tạo guest thất bại ⇒ agent vẫn chạy (heartbeat) và ghi rõ lý do, không giả sẵn sàng", async () => {
    const dir = tmp();
    writeCred(dir);
    const { g } = fakeGuest();
    g.ensureReady = async () => ({ ok: false, unknown: true, evidence: "docker chưa chạy" });
    const ac = new AbortController();
    const logs: string[] = [];
    let ready = false;
    const done = run(base(dir), ac.signal, (m) => logs.push(m), { guest: g, fetchImpl: apiOk, onReady: () => { ready = true; } });
    await expect.poll(() => ready, { timeout: 5000 }).toBe(true);
    ac.abort();
    await done;
    expect(logs.some((l) => l.includes("CHƯA sẵn sàng") && l.includes("docker chưa chạy"))).toBe(true);
  });
  it("AGENT_EXIT_ON_STDIN_CLOSE: stdin đóng (app của host thoát) ⇒ agent tự dừng", async () => {
    const dir = tmp();
    writeCred(dir);
    const t = io({ ...base(dir), AGENT_EXIT_ON_STDIN_CLOSE: "1", GATEWAY_PORT: "0" });
    // Không có API thật: heartbeat lỗi mạng không làm agent chết; chỉ kiểm việc dừng theo stdin.
    const done = cliMain(["run"], t.o);
    await expect.poll(() => t.lines.some((l) => l.includes("agent đang chạy")), { timeout: 5000 }).toBe(true);
    t.stdin.end();
    await done;
    expect(t.lines.some((l) => l.includes("agent dừng theo yêu cầu"))).toBe(true);
  });
});

describe("buildGuest", () => {
  it("mặc định là guest chưa cài; docker cần image + upstream; GPU/publish sai dạng bị từ chối", () => {
    const log = () => undefined;
    expect(buildGuest({}, log).ensureReady).toBeUndefined();
    expect(() => buildGuest({ GUEST_MODE: "vm" }, log)).toThrow(/GUEST_MODE/);
    expect(() => buildGuest({ GUEST_MODE: "docker" }, log)).toThrow(/GUEST_DOCKER_IMAGE.*GATEWAY_UPSTREAM/);
    const ok = { GUEST_MODE: "docker", GUEST_DOCKER_IMAGE: "ghcr.io/x/y@sha256:" + "a".repeat(64), GATEWAY_UPSTREAM: "http://127.0.0.1:8080" };
    expect(buildGuest(ok, log).ensureReady).toBeTypeOf("function");
    expect(() => buildGuest({ ...ok, GUEST_DOCKER_GPU: "0,1" }, log)).toThrow(/GUEST_DOCKER_GPU/);
    expect(() => buildGuest({ ...ok, GUEST_DOCKER_PUBLISH_ADDR: "0.0.0.0; id" }, log)).toThrow(/guest docker sai/);
    expect(buildGuest({ ...ok, GUEST_DOCKER_PUBLISH_ADDR: "127.0.0.1", GUEST_DOCKER_GPU: "all" }, log).cleanup).toBeTypeOf("function");
  });
});

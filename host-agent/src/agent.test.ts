// Kiểm runtime agent với API GIẢ (fetch giả có nhãn) + gateway THẬT. Luồng với API thật nằm ở server/src/e2e.test.ts.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Agent, FileCounter, MemoryCounter, unavailableGuest, type GuestController } from "./agent";
import { ConfigError, credentialPath, enroll, run } from "./main";
import { Gateway } from "./gateway";

const gateways: Gateway[] = [];
afterEach(async () => { await Promise.all(gateways.splice(0).map((g) => g.close())); });
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), "cpm-agent-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const okGuest: GuestController = {
  prepare: async () => ({ ok: true, evidence: "p" }), stopSession: async () => ({ ok: true, evidence: "s" }),
  reset: async () => ({ ok: true, evidence: "r" }), verifyReset: async () => ({ ok: true, evidence: "v" }),
};

function fakeApi(commands: object[], o: { heartbeatStatus?: number } = {}) {
  const reports: { id: string; body: Record<string, unknown> }[] = [];
  const beats: number[] = [];
  const headersSeen: (string | null)[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    headersSeen.push((init.headers as Record<string, string> | undefined)?.authorization ?? null);
    if (url.endsWith("/agent/heartbeat")) { beats.push(JSON.parse(String(init.body)).counter); return new Response("{}", { status: o.heartbeatStatus ?? 200 }); }
    if (url.endsWith("/agent/commands")) return new Response(JSON.stringify({ commands }));
    const m = /\/agent\/commands\/(\d+)\/result$/.exec(url);
    if (m) { reports.push({ id: m[1]!, body: JSON.parse(String(init.body)) }); return new Response("{}"); }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, reports, beats, headersSeen };
}
async function gw() {
  const g = new Gateway({ upstream: "http://127.0.0.1:9" });
  gateways.push(g);
  await g.listen();
  return g;
}
const mk = async (api: ReturnType<typeof fakeApi>, guest: GuestController = okGuest) =>
  new Agent({ apiBase: "http://api.test/api", credential: "c".repeat(43), gateway: await gw(), gatewayPublicUrl: "http://host.test:9000", guest, counter: new MemoryCounter(), fetchImpl: api.f });
const cmd = (id: string, command: string, payload: object = {}, bookingId = "b-1") => ({ id, bookingId, actionId: `${command}:${bookingId}#1`, command, payload });

describe("Agent.tick", () => {
  it("heartbeat với counter tăng, kèm credential Device; thực thi đúng tập lệnh và báo kết quả", async () => {
    const api = fakeApi([cmd("1", "prepare"), cmd("2", "reset"), cmd("3", "verify_reset"), cmd("4", "revoke")]);
    const a = await mk(api);
    expect(await a.tick()).toEqual({ heartbeat: "ok", executed: 4 });
    await a.tick();
    expect(api.beats).toEqual([1, 2]);
    expect(api.headersSeen[0]).toBe("Device " + "c".repeat(43));
    expect(api.reports.slice(0, 4).map((r) => [r.id, r.body.ok])).toEqual([["1", true], ["2", true], ["3", true], ["4", true]]);
  });

  it("grant: gateway cấp token đổi một lần, báo URL công khai + token; payload sai/không hỗ trợ bị từ chối", async () => {
    const api = fakeApi([
      cmd("1", "grant", { renterId: "u1", endAtMs: Date.now() + 600_000, redeemTtlSeconds: 600 }),
      cmd("2", "grant", { renterId: 5, endAtMs: "x" }, "b-2"),
      cmd("3", "định-nghĩa-lạ"),
      cmd("4", "grant", { renterId: "u1", endAtMs: Date.now() - 1, redeemTtlSeconds: 60 }, "b-4"),
    ]);
    await (await mk(api)).tick();
    const r = Object.fromEntries(api.reports.map((x) => [x.id, x.body]));
    expect(r["1"]).toMatchObject({ ok: true, gatewayUrl: "http://host.test:9000" });
    expect(String(r["1"]!.redeemToken)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r["2"]).toMatchObject({ ok: false });
    expect(r["3"]).toMatchObject({ ok: false });
    expect(r["4"]).toMatchObject({ ok: false }); // endAt đã qua: gateway từ chối
  });

  it("lệnh grant giao lại (crash trước khi báo): cấp token MỚI; grant lần hai sau khi đổi token bị từ chối", async () => {
    const payload = { renterId: "u1", endAtMs: Date.now() + 600_000, redeemTtlSeconds: 600 };
    const api = fakeApi([cmd("1", "grant", payload)]);
    const a = await mk(api);
    await a.tick();
    await a.tick();
    expect(api.reports.length).toBe(2);
    expect(api.reports[0]!.body.redeemToken).not.toBe(api.reports[1]!.body.redeemToken);
  });

  it("guest chưa cài ⇒ prepare/reset báo Unknown (không thành công); lỗi của guest ⇒ Unknown", async () => {
    const api = fakeApi([cmd("1", "prepare"), cmd("2", "reset")]);
    await (await mk(api, unavailableGuest)).tick();
    expect(api.reports.map((r) => [r.body.ok, r.body.unknown])).toEqual([[false, true], [false, true]]);
    const boom = fakeApi([cmd("1", "prepare")]);
    await (await mk(boom, { ...okGuest, prepare: async () => { throw new Error("WSL sập"); } })).tick();
    expect(boom.reports[0]!.body).toMatchObject({ ok: false, unknown: true });
  });

  it("revoke thật sự thu hồi grant trong gateway (idempotent, chạy lại không lỗi)", async () => {
    const g = await gw();
    const api = fakeApi([cmd("1", "revoke", {}, "b-9"), cmd("2", "revoke", {}, "b-9")]);
    const a = new Agent({ apiBase: "http://api.test/api", credential: "c".repeat(43), gateway: g, gatewayPublicUrl: "http://h", guest: okGuest, counter: new MemoryCounter(), fetchImpl: api.f });
    g.grant({ bookingId: "b-9", renterId: "u", endAtMs: Date.now() + 60_000, redeemTtlMs: 30_000 });
    await a.tick();
    expect(g.inspect("b-9").state).toBe("revoked");
    expect(api.reports.every((r) => r.body.ok === true)).toBe(true);
  });

  it("heartbeat bị từ chối (credential thu hồi) ⇒ dừng, không kéo lệnh; lỗi mạng không làm agent chết", async () => {
    const rej = fakeApi([cmd("1", "prepare")], { heartbeatStatus: 401 });
    expect(await (await mk(rej)).tick()).toEqual({ heartbeat: "rejected", executed: 0 });
    expect(rej.reports.length).toBe(0);
    const down = new Agent({ apiBase: "http://api.test/api", credential: "c".repeat(43), gateway: await gw(), gatewayPublicUrl: "http://h", guest: okGuest, counter: new MemoryCounter(), fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    expect(await down.tick()).toEqual({ heartbeat: "error", executed: 0 });
  });
});

describe("FileCounter / enroll / run (fail-closed)", () => {
  it("counter bền qua restart và không lùi", async () => {
    const f = path.join(tmp(), "c.json");
    expect([await new FileCounter(f).next(), await new FileCounter(f).next(), await new FileCounter(f).next()]).toEqual([1, 2, 3]);
  });

  it("enroll lưu credential vào file (không in ra); token sai/thiếu cấu hình bị từ chối", async () => {
    const dir = tmp();
    const env = { AGENT_API_BASE: "http://api.test/api/", AGENT_ENROLL_TOKEN: "t".repeat(40), AGENT_DATA_DIR: dir };
    const f = (async (url: string) => (String(url).endsWith("/agent/enroll") ? new Response(JSON.stringify({ credential: "K".repeat(43), machineId: "m-1" }), { status: 201 }) : new Response("{}", { status: 404 }))) as unknown as typeof fetch;
    await enroll(env, f);
    expect(JSON.parse(readFileSync(credentialPath(env), "utf8"))).toEqual({ credential: "K".repeat(43), machineId: "m-1" });
    if (process.platform !== "win32") expect(statSync(credentialPath(env)).mode & 0o077).toBe(0);
    await expect(enroll(env, (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch)).rejects.toThrow(/từ chối/);
    await expect(enroll({}, f)).rejects.toThrow(/AGENT_API_BASE/);
  });

  it("run: thiếu cấu hình/credential hoặc gateway công khai không khai origin ⇒ từ chối, nêu TÊN biến", async () => {
    const ac = new AbortController();
    await expect(run({}, ac.signal)).rejects.toThrow(/AGENT_API_BASE.*GATEWAY_UPSTREAM.*GATEWAY_PUBLIC_URL/);
    const base = { AGENT_API_BASE: "http://api.test/api", GATEWAY_UPSTREAM: "http://127.0.0.1:8080", GATEWAY_PUBLIC_URL: "http://127.0.0.1:9000", AGENT_DATA_DIR: tmp() };
    await expect(run(base, ac.signal)).rejects.toThrow(/credential/);
    const dir = tmp();
    await enroll({ ...base, AGENT_DATA_DIR: dir, AGENT_ENROLL_TOKEN: "t".repeat(40) }, (async () => new Response(JSON.stringify({ credential: "K".repeat(43), machineId: "m" }), { status: 201 })) as unknown as typeof fetch);
    await expect(run({ ...base, AGENT_DATA_DIR: dir, GATEWAY_PUBLIC_URL: "https://host.example.com" }, ac.signal)).rejects.toThrow(/GATEWAY_ALLOWED_ORIGINS/);
    await expect(run({ ...base, AGENT_DATA_DIR: dir, GATEWAY_PUBLIC_URL: "https://host.example.com" }, ac.signal)).rejects.toBeInstanceOf(ConfigError);
  });
});

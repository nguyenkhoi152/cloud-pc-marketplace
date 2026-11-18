// Upstream giả (HTTP + WebSocket echo) đứng thay Selkies: đây KHÔNG phải bằng chứng với Selkies thật.
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { CLOSE_EXPIRED, CLOSE_REVOKED, COOKIE, Gateway } from "./gateway";

interface Seen { url: string; cookie?: string; authorization?: string; host?: string }
let upstream: http.Server;
let upWss: WebSocketServer;
let upPort = 0;
let seen: Seen[] = [];
let gw: Gateway;
let gwPort = 0;
const base = () => `http://127.0.0.1:${gwPort}`;

async function startGateway(opts: Partial<ConstructorParameters<typeof Gateway>[0]> = {}) {
  gw = new Gateway({ upstream: `http://127.0.0.1:${upPort}`, ...opts });
  gwPort = await gw.listen();
}

beforeEach(async () => {
  seen = [];
  upstream = http.createServer((req, res) => {
    seen.push({ url: req.url ?? "", cookie: req.headers.cookie, authorization: req.headers.authorization, host: req.headers.host });
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("desktop");
  });
  upWss = new WebSocketServer({ server: upstream });
  upWss.on("connection", (s, req) => {
    seen.push({ url: req.url ?? "", cookie: req.headers.cookie });
    s.on("message", (d, bin) => s.send(d, { binary: bin }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
  upPort = (upstream.address() as { port: number }).port;
});
afterEach(async () => {
  await gw?.close();
  upWss.close();
  upstream.closeAllConnections();
  await new Promise<void>((r) => upstream.close(() => r()));
});

const farFuture = () => Date.now() + 60 * 60_000;

async function redeem(token: string) {
  const r = await fetch(`${base()}/__gw/redeem?t=${encodeURIComponent(token)}`, { redirect: "manual" });
  const cookie = r.headers.get("set-cookie")?.split(";")[0];
  return { status: r.status, cookie };
}
function openWs(cookie?: string, path = "/websocket", headers: Record<string, string> = {}) {
  return new Promise<{ ws: WebSocket; closed: Promise<number> } | { status: number }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${gwPort}${path}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } });
    const closed = new Promise<number>((r) => ws.on("close", (c) => r(c)));
    ws.on("open", () => resolve({ ws, closed }));
    ws.on("unexpected-response", (_q, res) => resolve({ status: res.statusCode ?? 0 }));
    ws.on("error", () => undefined);
  });
}
const echo = (ws: WebSocket, msg: string) =>
  new Promise<string>((resolve) => {
    ws.once("message", (d) => resolve(d.toString()));
    ws.send(msg);
  });

describe("xác thực và proxy", () => {
  it("không có phiên → 401 cho HTTP và WebSocket, upstream không thấy gì", async () => {
    await startGateway();
    expect((await fetch(`${base()}/`)).status).toBe(401);
    const w = await openWs();
    expect("status" in w && w.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("đổi token một lần → proxy HTTP + WebSocket; cookie của gateway không tới upstream", async () => {
    await startGateway();
    const g = gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 30_000 });
    if (!g.ok) throw new Error("grant");
    const r = await redeem(g.token);
    expect(r.status).toBe(302);
    expect(r.cookie).toMatch(new RegExp(`^${COOKIE}=`));

    const ok = await fetch(`${base()}/index.html?x=1`, { headers: { cookie: `${r.cookie}; app=1`, authorization: "Bearer should-not-leak" } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("desktop");
    expect(seen[0]!.url).toBe("/index.html?x=1");
    expect(seen[0]!.cookie).toBe("app=1");
    expect(seen[0]!.authorization).toBeUndefined();

    const w = await openWs(r.cookie);
    if (!("ws" in w)) throw new Error("ws");
    expect(await echo(w.ws, "hello")).toBe("hello");
    expect(seen.at(-1)!.cookie ?? "").not.toContain(COOKIE);
    expect(gw.inspect("b1")).toEqual({ state: "active", openConnections: 1 });
    w.ws.close();
  });

  it("token chỉ dùng một lần, sai token bị từ chối, hết hạn đổi token bị từ chối", async () => {
    await startGateway();
    const g = gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 30_000 });
    if (!g.ok) throw new Error("grant");
    expect((await redeem("sai-token")).status).toBe(401);
    expect((await redeem(g.token)).status).toBe(302);
    expect((await redeem(g.token)).status).toBe(401);

    const g2 = gw.grant({ bookingId: "b2", renterId: "u2", endAtMs: farFuture(), redeemTtlMs: 40 });
    if (!g2.ok) throw new Error("grant");
    await new Promise((r) => setTimeout(r, 80));
    expect((await redeem(g2.token)).status).toBe(401);
  });

  it("đường dẫn //host và ký tự điều khiển bị chặn; không chọn được đích upstream", async () => {
    await startGateway();
    const g = gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 30_000 });
    if (!g.ok) throw new Error("grant");
    const { cookie } = await redeem(g.token);
    const raw = (path: string) =>
      new Promise<number>((resolve) => {
        const q = http.request({ host: "127.0.0.1", port: gwPort, path, headers: { cookie: cookie! } }, (res) => resolve(res.statusCode ?? 0));
        q.on("error", () => resolve(0));
        q.end();
      });
    expect(await raw("//evil.example/x")).toBe(400);
    expect(seen).toHaveLength(0);
    const w = await openWs(cookie, "//evil.example/ws");
    expect("status" in w && w.status).toBe(400);
  });

  it("WebSocket từ origin không được phép bị 403 dù có phiên hợp lệ", async () => {
    await startGateway({ allowedOrigins: ["http://tauri.localhost"] });
    const g = gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 30_000 });
    if (!g.ok) throw new Error("grant");
    const { cookie } = await redeem(g.token);
    const bad = await openWs(cookie, "/websocket", { origin: "http://evil.example" });
    expect("status" in bad && bad.status).toBe(403);
    const good = await openWs(cookie, "/websocket", { origin: "http://tauri.localhost" });
    expect("ws" in good).toBe(true);
    if ("ws" in good) good.ws.close();
  });
});

describe("thu hồi", () => {
  it("revoke đóng kết nối đang mở, chặn reconnect bằng phiên cũ và token chưa dùng", async () => {
    await startGateway();
    const g = gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 30_000 });
    const unused = gw.grant({ bookingId: "b2", renterId: "u2", endAtMs: farFuture(), redeemTtlMs: 30_000 });
    if (!g.ok || !unused.ok) throw new Error("grant");
    const { cookie } = await redeem(g.token);
    const w = await openWs(cookie);
    if (!("ws" in w)) throw new Error("ws");
    expect(await echo(w.ws, "ping")).toBe("ping");

    const t0 = Date.now();
    expect(gw.revoke("b1")).toBe(true);
    expect(await w.closed).toBe(CLOSE_REVOKED);
    expect(Date.now() - t0).toBeLessThan(1000);

    expect((await fetch(`${base()}/`, { headers: { cookie: cookie! } })).status).toBe(401);
    const again = await openWs(cookie);
    expect("status" in again && again.status).toBe(401);
    expect(gw.inspect("b1").state).toBe("revoked");
    expect(gw.revoke("b1")).toBe(false); // idempotent

    gw.revoke("b2");
    expect((await redeem(unused.token)).status).toBe(401); // link chưa dùng cũng chết
  });

  it("booking đã thu hồi không được cấp lại; endAt đã qua bị từ chối", async () => {
    await startGateway();
    expect(gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 1000 }).ok).toBe(true);
    gw.revoke("b1");
    expect(gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 1000 })).toEqual({ ok: false, reason: "exists" });
    expect(gw.grant({ bookingId: "b9", renterId: "u1", endAtMs: Date.now() - 1, redeemTtlMs: 1000 })).toEqual({ ok: false, reason: "expired" });
    expect(gw.grant({ bookingId: "b8", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 99 * 60_000 })).toEqual({ ok: false, reason: "bad_input" });
  });

  it("watchdog endAt tự ngắt kết nối đang mở và chặn kết nối mới, không cần lệnh nào", async () => {
    await startGateway();
    const g = gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: Date.now() + 400, redeemTtlMs: 300 });
    if (!g.ok) throw new Error("grant");
    const { cookie } = await redeem(g.token);
    const w = await openWs(cookie);
    if (!("ws" in w)) throw new Error("ws");
    expect(await echo(w.ws, "x")).toBe("x");
    expect(await w.closed).toBe(CLOSE_EXPIRED);
    const after = await openWs(cookie);
    expect("status" in after && after.status).toBe(401);
    expect(gw.inspect("b1").state).toBe("expired");
  });

  it("đồng hồ tường bị chỉnh không kéo dài phiên: hạn tính trên đồng hồ đơn điệu", async () => {
    let wall = 1_000_000;
    let mono = 5_000;
    await startGateway({ clock: { wallNow: () => wall, monoNow: () => mono } });
    const g = gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: wall + 10_000, redeemTtlMs: 5_000 });
    if (!g.ok) throw new Error("grant");
    wall -= 3_600_000; // chỉnh lùi giờ tường 1 giờ
    mono += 10_000; // thời gian thật trôi 10 giây
    expect(gw.inspect("b1").state).toBe("expired");
    expect((await redeem(g.token)).status).toBe(401);
  });

  it("grant giao lại khi token chưa đổi → cấp token mới, token cũ vô hiệu; đã đổi/khác renter/đã revoke → từ chối", async () => {
    await startGateway();
    const first = gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 30_000 });
    const again = gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 30_000 });
    if (!first.ok || !again.ok) throw new Error("grant");
    expect(again.token).not.toBe(first.token);
    expect((await redeem(first.token)).status).toBe(401);
    expect(gw.grant({ bookingId: "b1", renterId: "u-khac", endAtMs: farFuture(), redeemTtlMs: 30_000 })).toEqual({ ok: false, reason: "exists" });
    expect((await redeem(again.token)).status).toBe(302);
    expect(gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 30_000 })).toEqual({ ok: false, reason: "exists" });
    gw.revoke("b1");
    expect(gw.grant({ bookingId: "b1", renterId: "u1", endAtMs: farFuture(), redeemTtlMs: 30_000 })).toEqual({ ok: false, reason: "exists" });
  });
});

describe("nhúng trong iframe của app (frame-ancestors)", () => {
  // Selkies thật trả `Content-Security-Policy: frame-ancestors 'self'` (đã quan sát 09/11/2026) nên trình duyệt chặn iframe của app.
  const EMBED = "http://tauri.localhost";
  const withFraming = async (headers: Record<string, string | string[]>) => {
    upstream.removeAllListeners("request");
    upstream.on("request", (_req, res) => { res.writeHead(200, { "content-type": "text/html", ...headers }); res.end("<html>desktop</html>"); });
  };
  const get = async (opts: Partial<ConstructorParameters<typeof Gateway>[0]>) => {
    await startGateway(opts);
    const g = gw.grant({ bookingId: "fa", renterId: "r", endAtMs: farFuture(), redeemTtlMs: 60_000 });
    if (!g.ok) throw new Error("grant");
    const { cookie } = await redeem(g.token);
    return fetch(`${base()}/`, { headers: { cookie: cookie! } });
  };

  it("thay frame-ancestors của upstream bằng origin của app, giữ nguyên các directive khác, bỏ X-Frame-Options", async () => {
    await withFraming({ "content-security-policy": "default-src 'self'; frame-ancestors 'self'; img-src data:", "x-frame-options": "SAMEORIGIN" });
    const r = await get({ frameAncestors: [EMBED] });
    const csp = r.headers.get("content-security-policy")!;
    expect(csp).toContain("frame-ancestors 'self' http://tauri.localhost");
    expect(csp).not.toContain("frame-ancestors 'self';");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src data:");
    expect(csp.match(/frame-ancestors/g)).toHaveLength(1);
    expect(r.headers.get("x-frame-options")).toBeNull();
  });

  it("upstream không có CSP → thêm frame-ancestors; nhiều header CSP → mỗi policy chỉ còn đúng một frame-ancestors đã chuẩn hoá", async () => {
    await withFraming({});
    expect((await get({ frameAncestors: [EMBED] })).headers.get("content-security-policy")).toBe("frame-ancestors 'self' http://tauri.localhost");
    await gw.close();
    await withFraming({ "content-security-policy": ["frame-ancestors *", "script-src 'self'; frame-ancestors http://evil.example"] });
    const r = await get({ frameAncestors: [EMBED] });
    const all = r.headers.get("content-security-policy")!;
    expect(all).not.toContain("evil.example");
    expect(all).not.toContain("frame-ancestors *");
    expect(all).toContain("script-src 'self'");
  });

  it("không cấu hình frameAncestors → header của upstream giữ nguyên", async () => {
    await withFraming({ "content-security-policy": "frame-ancestors 'self'", "x-frame-options": "SAMEORIGIN" });
    const r = await get({});
    expect(r.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("origin không hợp lệ (wildcard, ký tự điều khiển directive, có đường dẫn) bị từ chối khi tạo gateway", () => {
    for (const bad of ["*", "http://a.example http://b.example", "http://a.example;script-src *", "http://a.example/path", "'none'", ""]) {
      expect(() => new Gateway({ upstream: "http://127.0.0.1:1", frameAncestors: [bad] }), bad).toThrow(/frameAncestors/);
    }
    expect(() => new Gateway({ upstream: "http://127.0.0.1:1", frameAncestors: ["http://tauri.localhost", "tauri://localhost", "https://app.example.com:8443"] })).not.toThrow();
  });
});

// Proxy hẹp trước API khi mở tunnel: chỉ /api/*, chặn /api/admin, giới hạn thân/tần suất. Upstream là server GIẢ có nhãn (không đụng API thật).
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error — module .mjs thuần JS không có kiểu
import { createProxy, decide } from "../../scripts/public/api-proxy.mjs";

let upstream: http.Server, proxy: http.Server, base = "";
const seen: { url: string; method: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
let now = 1_000_000;

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", method: req.method ?? "", headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (req.url === "/api/slow") return; // không bao giờ trả lời
      res.writeHead(200, { "content-type": "application/json", "x-upstream": "1", connection: "close" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const up = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  proxy = createProxy({ target: up, maxBodyBytes: 1024, upstreamTimeoutMs: 300, perMinute: 5, now: () => now }) as http.Server;
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});
afterAll(async () => { proxy.closeAllConnections?.(); upstream.closeAllConnections?.(); await new Promise((r) => proxy.close(r)); await new Promise((r) => upstream.close(r)); });
const get = (p: string, init: RequestInit = {}) => fetch(base + p, init);

describe("decide (đường dẫn nào được ra Internet)", () => {
  it("cho /api/*, từ chối mọi thứ khác và mọi cách lách bằng chuẩn hoá đường dẫn", () => {
    for (const ok of ["/api/chain-info", "/api/bookings/abc/quote", "/api/faucet?x=1"]) expect(decide(ok), ok).toBe("allow");
    for (const bad of ["/", "/sessions", "/_next/static/x.js", "/__nextjs_original-stack-frame", "/api", "/apix", "/api/../sessions", "/api/%2e%2e/sessions", "/api/%2E%2E/x", "/api//x", "/api\\admin", "/api/admin", "/api/admin/enrollments", "/api/admin/", "/api/%61dmin/enrollments", "http://evil.example/api/x", "//evil.example/api/x", "/api/%zz", "/api/%00"])
      expect(decide(bad), bad).toBe("deny");
  });
});

describe("proxy", () => {
  it("chuyển /api/* tới upstream, giữ method/đường dẫn/thân/Authorization; trả đúng phản hồi", async () => {
    seen.length = 0;
    const r = await get("/api/chain-info?a=1", { method: "POST", headers: { authorization: "Bearer abc", "content-type": "application/json", "cf-connecting-ip": "1.1.1.1" }, body: JSON.stringify({ x: 1 }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("x-upstream")).toBe("1");
    expect(await r.json()).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: "/api/chain-info?a=1", method: "POST", body: '{"x":1}' });
    expect(seen[0]!.headers.authorization).toBe("Bearer abc");
    expect(seen[0]!.headers.host).toMatch(/^127\.0\.0\.1:\d+$/);
  });
  it("đường dẫn không được phép bị chặn NGAY, upstream không nhận được yêu cầu nào", async () => {
    seen.length = 0;
    for (const p of ["/", "/sessions", "/api/admin/enrollments", "/api/%2e%2e/sessions"]) expect((await get(p, { headers: { "cf-connecting-ip": "2.2.2.2" } })).status, p).toBe(404);
    expect(seen).toHaveLength(0);
  });
  it("thân quá lớn ⇒ 413 và không chuyển tiếp", async () => {
    seen.length = 0;
    const r = await get("/api/x", { method: "POST", headers: { "cf-connecting-ip": "3.3.3.3" }, body: "a".repeat(4096) });
    expect(r.status).toBe(413);
    expect(seen.filter((s) => s.body.length > 1024)).toHaveLength(0);
  });
  it("upstream không trả lời ⇒ 502 có hạn chót; upstream tắt ⇒ 502 (không treo)", async () => {
    const t0 = Date.now();
    expect((await get("/api/slow", { headers: { "cf-connecting-ip": "4.4.4.4" } })).status).toBe(502);
    expect(Date.now() - t0).toBeLessThan(3000);
    const dead = createProxy({ target: "http://127.0.0.1:9" }) as http.Server;
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
    expect((await fetch(`http://127.0.0.1:${(dead.address() as AddressInfo).port}/api/x`)).status).toBe(502);
    await new Promise((r) => dead.close(r));
  });
  it("giới hạn 5 yêu cầu/phút theo khách (cf-connecting-ip), khách khác không bị ảnh hưởng, qua phút mới thì mở lại", async () => {
    const h = (ip: string) => ({ headers: { "cf-connecting-ip": ip } });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await get("/api/chain-info", h("9.9.9.9"))).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect((await get("/api/chain-info", h("8.8.8.8"))).status).toBe(200);
    now += 61_000;
    expect((await get("/api/chain-info", h("9.9.9.9"))).status).toBe(200);
  });
});

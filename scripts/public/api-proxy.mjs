#!/usr/bin/env node
/**
 * Proxy HẸP đứng trước API khi mở ra Internet qua tunnel. Tunnel trỏ vào proxy này, KHÔNG trỏ thẳng vào server Next.
 *  - Chỉ chuyển tiếp đường dẫn /api/... tới API cục bộ; mọi thứ khác (trang Next, /_next, công cụ dev) trả 404 ngay, không chạm server.
 *  - Chặn /api/admin/... từ Internet (quản trị chạy trên chính máy này qua http://127.0.0.1:3000).
 *  - Giới hạn thân yêu cầu (1 MiB), thời gian chờ upstream, số yêu cầu/phút theo địa chỉ khách (cf-connecting-ip do tunnel gắn).
 * Không ghi log nội dung, không ghi header (token Bearer đi qua đây). Chỉ lắng nghe 127.0.0.1.
 * Chạy: node scripts/public/api-proxy.mjs [--listen 3100] [--target http://127.0.0.1:3000]
 */
import http from "node:http";
import { fileURLToPath } from "node:url";

const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"]);

/** Quyết định cho một đường dẫn: "allow" | "deny" (404). Chuẩn hoá trước để không lách bằng /api/../, %2e%2e hay //. */
export function decide(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl, "http://x");
  } catch {
    return "deny";
  }
  if (u.origin !== "http://x") return "deny"; // dạng tuyệt đối (http://evil/...) trong dòng yêu cầu
  let p;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    return "deny";
  }
  if (/[\\\0]/.test(p) || p.includes("//") || p.split("/").some((s) => s === "." || s === "..")) return "deny";
  if (!p.startsWith("/api/")) return "deny";
  if (p === "/api/admin" || p.startsWith("/api/admin/")) return "deny";
  return "allow";
}

export function createProxy({ target, maxBodyBytes = 1 << 20, upstreamTimeoutMs = 60_000, perMinute = 300, now = () => Date.now() } = {}) {
  const t = new URL(target);
  const hits = new Map(); // khách → { start, n }
  const limited = (who) => {
    const ts = now();
    const h = hits.get(who);
    if (!h || ts - h.start >= 60_000) {
      hits.set(who, { start: ts, n: 1 });
      if (hits.size > 10_000) for (const [k, v] of hits) if (ts - v.start >= 60_000) hits.delete(k);
      return false;
    }
    h.n++;
    return h.n > perMinute;
  };
  return http.createServer((req, res) => {
    const fail = (code, msg) => { if (!res.headersSent) res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify({ error: msg })); };
    if (decide(req.url ?? "/") !== "allow") return fail(404, "not_found");
    const who = String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "?");
    if (limited(who)) return fail(429, "rate_limited");
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > maxBodyBytes) return fail(413, "too_large");
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
    headers.host = t.host;
    const up = http.request({ host: t.hostname, port: t.port || 80, method: req.method, path: req.url, headers, timeout: upstreamTimeoutMs }, (r) => {
      const out = {};
      for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) out[k] = v;
      res.writeHead(r.statusCode ?? 502, out);
      r.pipe(res);
    });
    up.on("timeout", () => up.destroy(new Error("timeout")));
    up.on("error", () => fail(502, "upstream_unavailable"));
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBodyBytes) { up.destroy(); req.destroy(); fail(413, "too_large"); }
    });
    req.on("error", () => up.destroy());
    req.pipe(up);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const port = Number(arg("listen", "3100"));
  const target = arg("target", "http://127.0.0.1:3000");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(target)) { console.error("target phải là http loopback"); process.exit(1); }
  createProxy({ target }).listen(port, "127.0.0.1", () => console.log(`api-proxy 127.0.0.1:${port} -> ${target} (chỉ /api/*, chặn /api/admin)`));
}

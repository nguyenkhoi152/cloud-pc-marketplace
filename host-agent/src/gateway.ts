/**
 * Session gateway của host-agent (REMOTE_ACCESS 1.1 §3).
 *
 * Đứng trước upstream cố định (Selkies, chỉ lắng nghe nội bộ). Bất biến:
 *  - không grant hợp lệ → không vào được; token chỉ lưu băm, đổi lấy phiên đúng một lần;
 *  - upstream cố định theo cấu hình, client không chọn được đích;
 *  - revoke đóng mọi kết nối đang mở và chặn reconnect (kể cả link chưa dùng);
 *  - watchdog endAt chạy cục bộ bằng đồng hồ đơn điệu, không cần control plane;
 *  - không chuyển tiếp credential của gateway sang upstream.
 *
 * Kiểm tra bằng upstream giả — chưa phải bằng chứng với Selkies thật.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

export const COOKIE = "cpc_gw";
/** Mã đóng WebSocket khi bị thu hồi/hết hạn (dải riêng ứng dụng 4000–4999). */
export const CLOSE_REVOKED = 4401;
export const CLOSE_EXPIRED = 4408;

export interface Clock {
  /** Giờ tường (ms epoch) — chỉ dùng để quy đổi endAt từ chain một lần lúc grant. */
  wallNow(): number;
  /** Giờ đơn điệu (ms) — dùng cho mọi quyết định hết hạn sau đó. */
  monoNow(): number;
}
const systemClock: Clock = { wallNow: () => Date.now(), monoNow: () => performance.now() };

export interface GatewayOptions {
  /** Origin upstream cố định, ví dụ http://127.0.0.1:8080. */
  upstream: string;
  /** Origin được phép mở WebSocket (chống CSWSH). Rỗng = không kiểm tra (chỉ cho test). */
  allowedOrigins?: string[];
  /** Cookie SameSite; "None" chỉ hợp lệ khi chạy sau TLS (thêm Secure). */
  sameSite?: "Lax" | "None";
  secureCookie?: boolean;
  clock?: Clock;
  /** TTL tối đa của token đổi phiên (ms). */
  maxGrantTtlMs?: number;
  /**
   * Origin của app được phép NHÚNG viewer trong iframe (ví dụ "http://tauri.localhost"). Khi có giá trị, gateway thay mọi
   * directive `frame-ancestors` trong CSP của upstream bằng `frame-ancestors 'self' <các origin này>` và bỏ X-Frame-Options
   * (Selkies mặc định trả `frame-ancestors 'self'` nên iframe của app bị trình duyệt chặn). Không cho wildcard/đường dẫn.
   * Khi nhúng khác site, cookie phiên cần sameSite "None" (kèm Secure; chạy sau TLS ngoài loopback).
   */
  frameAncestors?: string[];
}

const FRAME_ORIGIN_RE = /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;

export interface GrantInput {
  bookingId: string;
  renterId: string;
  /** Thời điểm kết thúc (ms epoch) lấy từ chain. */
  endAtMs: number;
  /** Hạn đổi token (ms). */
  redeemTtlMs: number;
}
export type GrantResult = { ok: true; token: string } | { ok: false; reason: "expired" | "exists" | "bad_input" };

export type GrantState = "none" | "pending" | "active" | "revoked" | "expired";
export interface Inspect {
  state: GrantState;
  openConnections: number;
}

interface Grant {
  bookingId: string;
  renterId: string;
  tokenHash: Buffer;
  redeemDeadline: number; // mono
  deadline: number; // mono (endAt)
  redeemed: boolean;
  sessionHashes: Set<string>;
  conns: Set<() => void>; // hàm đóng từng kết nối
  state: "pending" | "active" | "revoked" | "expired";
  timer: NodeJS.Timeout;
}

const sha = (s: string) => createHash("sha256").update(s).digest();
const shaHex = (s: string) => sha(s).toString("hex");

export class Gateway {
  readonly server: http.Server;
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly grants = new Map<string, Grant>();
  private readonly bySession = new Map<string, Grant>();
  private readonly upstream: URL;
  private readonly clock: Clock;
  private readonly opts: GatewayOptions;

  constructor(opts: GatewayOptions) {
    this.opts = opts;
    for (const o of opts.frameAncestors ?? []) if (!FRAME_ORIGIN_RE.test(o)) throw new Error(`frameAncestors không hợp lệ: cần dạng scheme://host[:port], không wildcard/đường dẫn/khoảng trắng`);
    this.upstream = new URL(opts.upstream);
    this.clock = opts.clock ?? systemClock;
    this.server = http.createServer((req, res) => this.onHttp(req, res));
    this.server.on("upgrade", (req, socket, head) => this.onUpgrade(req, socket, head));
  }

  listen(port = 0, host = "127.0.0.1"): Promise<number> {
    return new Promise((resolve) => this.server.listen(port, host, () => resolve((this.server.address() as { port: number }).port)));
  }

  async close(): Promise<void> {
    for (const g of this.grants.values()) clearTimeout(g.timer);
    this.revokeAll("revoked");
    this.wss.close();
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  // ---- API điều khiển (gọi từ lớp lệnh đã xác thực của agent, không qua HTTP của gateway) ----

  grant(i: GrantInput): GrantResult {
    if (!i.bookingId || !i.renterId || !Number.isFinite(i.endAtMs) || !(i.redeemTtlMs > 0)) return { ok: false, reason: "bad_input" };
    const cap = this.opts.maxGrantTtlMs ?? 10 * 60_000;
    if (i.redeemTtlMs > cap) return { ok: false, reason: "bad_input" };
    const remaining = i.endAtMs - this.clock.wallNow();
    if (remaining <= 0) return { ok: false, reason: "expired" };
    const prev = this.grants.get(i.bookingId);
    const now = this.clock.monoNow();
    const token = randomBytes(32).toString("base64url");
    // Lệnh grant bị giao lại sau crash khi token chưa được đổi: cấp token MỚI (token cũ vô hiệu), hạn kết thúc giữ nguyên.
    // Đã đổi token, đã revoke hoặc hết hạn: không cấp lại (một client/booking; booking đã thu hồi không sống lại).
    if (prev) {
      if (prev.state !== "pending" || prev.redeemed || prev.renterId !== i.renterId) return { ok: false, reason: "exists" };
      prev.tokenHash = sha(token);
      prev.redeemDeadline = now + Math.min(i.redeemTtlMs, prev.deadline - now);
      return { ok: true, token };
    }
    const g: Grant = {
      bookingId: i.bookingId,
      renterId: i.renterId,
      tokenHash: sha(token),
      redeemDeadline: now + Math.min(i.redeemTtlMs, remaining),
      deadline: now + remaining,
      redeemed: false,
      sessionHashes: new Set(),
      conns: new Set(),
      state: "pending",
      timer: setTimeout(() => this.revoke(i.bookingId, "expired"), remaining),
    };
    g.timer.unref();
    this.grants.set(i.bookingId, g);
    return { ok: true, token };
  }

  /** Idempotent. Trả true nếu có grant bị đổi trạng thái. */
  revoke(bookingId: string, reason: "revoked" | "expired" = "revoked"): boolean {
    const g = this.grants.get(bookingId);
    if (!g || g.state === "revoked" || g.state === "expired") return false;
    clearTimeout(g.timer);
    g.state = reason;
    for (const h of g.sessionHashes) this.bySession.delete(h);
    g.sessionHashes.clear();
    for (const close of [...g.conns]) close();
    g.conns.clear();
    return true;
  }

  inspect(bookingId: string): Inspect {
    const g = this.grants.get(bookingId);
    if (!g) return { state: "none", openConnections: 0 };
    this.expireIfDue(g);
    return { state: g.state === "pending" || g.state === "active" ? (g.redeemed ? "active" : "pending") : g.state, openConnections: g.conns.size };
  }

  private revokeAll(reason: "revoked" | "expired") {
    for (const id of this.grants.keys()) this.revoke(id, reason);
  }

  private expireIfDue(g: Grant) {
    if ((g.state === "pending" || g.state === "active") && this.clock.monoNow() >= g.deadline) this.revoke(g.bookingId, "expired");
  }

  // ---- Xác thực ----

  private sessionFrom(req: http.IncomingMessage): Grant | null {
    const raw = req.headers.cookie ?? "";
    let sid: string | null = null;
    for (const part of raw.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === COOKIE) sid = v.join("=");
    }
    const auth = req.headers.authorization;
    if (!sid && auth?.startsWith("Bearer ")) sid = auth.slice(7);
    if (!sid) return null;
    const g = this.bySession.get(shaHex(sid));
    if (!g) return null;
    this.expireIfDue(g);
    return g.state === "active" ? g : null;
  }

  private redeem(token: string): { sid: string; g: Grant } | null {
    const h = sha(token);
    for (const g of this.grants.values()) {
      if (h.length !== g.tokenHash.length || !timingSafeEqual(h, g.tokenHash)) continue;
      this.expireIfDue(g);
      if (g.state !== "pending" || g.redeemed || this.clock.monoNow() >= g.redeemDeadline) return null;
      g.redeemed = true; // một lần: đặt cờ trước mọi thao tác khác
      g.state = "active";
      const sid = randomBytes(32).toString("base64url");
      const sh = shaHex(sid);
      g.sessionHashes.add(sh);
      this.bySession.set(sh, g);
      return { sid, g };
    }
    return null;
  }

  // ---- HTTP ----

  private onHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url ?? "/";
    if (url.startsWith("/__gw/redeem")) return this.onRedeem(req, res, url);
    const g = this.sessionFrom(req);
    if (!g) return deny(res, 401);
    const path = safePath(url);
    if (!path) return deny(res, 400);

    const headers = { ...req.headers, host: this.upstream.host };
    delete headers.authorization;
    headers.cookie = stripOurCookie(req.headers.cookie);
    if (!headers.cookie) delete headers.cookie;
    const up = http.request({ host: this.upstream.hostname, port: this.upstream.port, method: req.method, path, headers }, (ur) => {
      res.writeHead(ur.statusCode ?? 502, this.framingHeaders(ur.headers));
      ur.pipe(res);
    });
    const close = () => {
      up.destroy();
      res.destroy();
    };
    g.conns.add(close);
    res.on("close", () => g.conns.delete(close));
    up.on("error", () => deny(res, 502));
    req.pipe(up);
  }

  /** Chỉ chạm vào CSP/X-Frame-Options khi đã cấu hình frameAncestors; còn lại giữ nguyên header của upstream. */
  private framingHeaders(h: http.IncomingHttpHeaders): http.IncomingHttpHeaders {
    const allowed = this.opts.frameAncestors;
    if (!allowed?.length) return h;
    const directive = `frame-ancestors 'self' ${allowed.join(" ")}`;
    const out: http.IncomingHttpHeaders = { ...h };
    delete out["x-frame-options"];
    const raw = h["content-security-policy"];
    // Node gộp header trùng tên bằng ", " và trong CSP dấu phẩy ngăn cách các policy: tách policy trước, rồi tách directive theo ";".
    const policies = (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).flatMap((p) => p.split(",")).map((p) => p.trim()).filter(Boolean);
    // Mỗi policy: bỏ mọi frame-ancestors cũ, giữ các directive khác. Directive mới là một policy riêng nên là frame-ancestors duy nhất còn lại.
    const kept = policies.map((p) => p.split(";").map((d) => d.trim()).filter((d) => d && !/^frame-ancestors(\s|$)/i.test(d)).join("; ")).filter(Boolean);
    out["content-security-policy"] = [...kept, directive].join(", ");
    return out;
  }

  private onRedeem(req: http.IncomingMessage, res: http.ServerResponse, url: string) {
    if (req.method !== "GET") return deny(res, 405);
    const t = new URL(url, "http://gateway.invalid").searchParams.get("t");
    const r = t ? this.redeem(t) : null;
    if (!r) return deny(res, 401);
    const attrs = [`${COOKIE}=${r.sid}`, "Path=/", "HttpOnly", `SameSite=${this.opts.sameSite ?? "Lax"}`];
    if (this.opts.secureCookie || this.opts.sameSite === "None") attrs.push("Secure");
    res.writeHead(302, { "set-cookie": attrs.join("; "), location: "/", "cache-control": "no-store" });
    res.end();
  }

  // ---- WebSocket ----

  private onUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
    const origins = this.opts.allowedOrigins;
    if (origins && origins.length > 0 && !origins.includes(String(req.headers.origin ?? ""))) return rejectUpgrade(socket, 403);
    const g = this.sessionFrom(req);
    if (!g) return rejectUpgrade(socket, 401);
    const path = safePath(req.url ?? "/");
    if (!path) return rejectUpgrade(socket, 400);

    this.wss.handleUpgrade(req, socket, head, (client) => {
      const proto = req.headers["sec-websocket-protocol"];
      const protocols = typeof proto === "string" ? proto.split(",").map((s) => s.trim()) : undefined;
      const ws = new WebSocket(`ws://${this.upstream.host}${path}`, protocols, { headers: { cookie: stripOurCookie(req.headers.cookie) ?? "" } });
      const queue: { data: Buffer | ArrayBuffer | Buffer[]; bin: boolean }[] = [];
      client.on("message", (data, bin) => (ws.readyState === WebSocket.OPEN ? ws.send(data, { binary: bin }) : queue.push({ data, bin })));
      ws.on("open", () => queue.splice(0).forEach((m) => ws.send(m.data, { binary: m.bin })));
      ws.on("message", (data, bin) => client.readyState === WebSocket.OPEN && client.send(data, { binary: bin }));
      const kill = (code: number) => {
        try { client.close(code); } catch { /* đã đóng */ }
        ws.terminate();
        // client không đóng bắt tay thì ép cắt
        setTimeout(() => client.terminate(), 500).unref();
      };
      const closer = () => kill(g.state === "expired" ? CLOSE_EXPIRED : CLOSE_REVOKED);
      g.conns.add(closer);
      const done = () => g.conns.delete(closer);
      client.on("close", () => { done(); ws.terminate(); });
      ws.on("close", () => { done(); try { client.close(); } catch { /* */ } });
      ws.on("error", () => kill(1011));
      client.on("error", () => ws.terminate());
      // Có thể đã bị thu hồi giữa lúc bắt tay
      if (g.state !== "active") closer();
    });
  }
}

function deny(res: http.ServerResponse, code: number) {
  if (res.headersSent) return res.destroy();
  res.writeHead(code, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(code === 401 ? "unauthorized" : code === 400 ? "bad request" : "error");
}
function rejectUpgrade(socket: Duplex, code: number) {
  socket.write(`HTTP/1.1 ${code} ${code === 401 ? "Unauthorized" : code === 403 ? "Forbidden" : "Bad Request"}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
/** Chỉ nhận đường dẫn tuyệt đối một dấu '/'; chặn //host, absolute-URI, ký tự điều khiển. */
function safePath(raw: string): string | null {
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\u0000- \u007f\\]/.test(raw)) return null;
  return raw;
}
function stripOurCookie(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const kept = c.split(";").map((s) => s.trim()).filter((s) => s && !s.startsWith(`${COOKIE}=`));
  return kept.length ? kept.join("; ") : undefined;
}

/**
 * Runtime của host-agent: heartbeat có counter tăng (lưu bền), kéo lệnh từ control plane (chỉ kết nối RA NGOÀI),
 * thực thi TẬP LỆNH CỐ ĐỊNH rồi báo kết quả. Không có shell, đường dẫn, URL hay port do renter/lệnh quyết định.
 *
 * Guest (môi trường Linux/Selkies) là giao diện `GuestController`. Bản mặc định `unavailableGuest` KHÔNG giả thành công:
 * mọi bước cần guest trả Unknown cho tới khi có cài đặt thật trên máy host được chỉ định.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Gateway } from "./gateway";

export interface GuestResult {
  ok: boolean;
  /** true nếu không biết kết quả (không được coi là thành công). */
  unknown?: boolean;
  evidence: string;
}
export interface GuestController {
  prepare(i: { bookingId: string }): Promise<GuestResult>;
  stopSession(i: { bookingId: string }): Promise<GuestResult>;
  reset(i: { bookingId: string }): Promise<GuestResult>;
  verifyReset(i: { bookingId: string }): Promise<GuestResult>;
  /** Tuỳ chọn: chuẩn bị guest khi agent khởi động (tạo môi trường sạch nếu chưa có). Lỗi ⇒ agent vẫn chạy, `prepare` sẽ báo. */
  ensureReady?(): Promise<GuestResult>;
  /** Tuỳ chọn: dọn guest khi host dừng cung cấp (xoá môi trường khách). */
  cleanup?(): Promise<GuestResult>;
}

const NOT_INSTALLED: GuestResult = { ok: false, unknown: true, evidence: "guest chưa được cài (WSL/Docker/Selkies chưa có trên máy này)" };
export const unavailableGuest: GuestController = {
  prepare: async () => NOT_INSTALLED,
  stopSession: async () => NOT_INSTALLED,
  reset: async () => NOT_INSTALLED,
  verifyReset: async () => NOT_INSTALLED,
};

export interface CounterStore {
  /** Trả số tiếp theo (tăng nghiêm ngặt, bền qua restart). */
  next(): Promise<number>;
}
export class MemoryCounter implements CounterStore {
  private n = 0;
  async next() {
    return ++this.n;
  }
}
/** Lưu counter ra file (ghi tạm + rename). Restart không làm counter lùi → heartbeat không bị coi là replay. */
export class FileCounter implements CounterStore {
  constructor(private file: string) {}
  async next() {
    let n = 0;
    try {
      n = Number(JSON.parse(await readFile(this.file, "utf8")).counter) || 0;
    } catch { /* chưa có file */ }
    n += 1;
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ counter: n }));
    await rename(tmp, this.file);
    return n;
  }
}

export interface AgentOptions {
  /** Gốc API control plane, ví dụ https://app.example/api (không có dấu / cuối). */
  apiBase: string;
  /** Credential riêng của thiết bị (nhận khi enroll); không in ra log. */
  credential: string;
  gateway: Gateway;
  /** URL mà renter truy cập gateway (do host cấu hình/relay); agent không tự mở cổng. */
  gatewayPublicUrl: string;
  guest: GuestController;
  counter: CounterStore;
  fetchImpl?: typeof fetch;
  log?: (m: string) => void;
}

interface Cmd {
  id: string;
  bookingId: string;
  actionId: string;
  command: string;
  payload: Record<string, unknown>;
}
interface Report {
  ok: boolean;
  unknown?: boolean;
  evidence: string;
  gatewayUrl?: string;
  redeemToken?: string;
}

export interface TickResult {
  heartbeat: "ok" | "rejected" | "error";
  executed: number;
}

export class Agent {
  private f: typeof fetch;
  constructor(private o: AgentOptions) {
    this.f = o.fetchImpl ?? fetch;
  }
  private headers() {
    return { authorization: `Device ${this.o.credential}`, "content-type": "application/json" };
  }

  async tick(): Promise<TickResult> {
    const out: TickResult = { heartbeat: "error", executed: 0 };
    try {
      const hb = await this.f(`${this.o.apiBase}/agent/heartbeat`, { method: "POST", headers: this.headers(), body: JSON.stringify({ counter: await this.o.counter.next() }) });
      out.heartbeat = hb.ok ? "ok" : hb.status === 401 ? "rejected" : "error";
      if (hb.status === 401) {
        this.o.log?.("heartbeat bị từ chối (credential sai/đã thu hồi): dừng nhận lệnh");
        return out; // credential đã thu hồi → không nhận lệnh nữa
      }
    } catch (e) {
      this.o.log?.(`heartbeat lỗi mạng: ${(e as Error).message}`);
    }
    let cmds: Cmd[] = [];
    try {
      const r = await this.f(`${this.o.apiBase}/agent/commands`, { headers: this.headers() });
      if (!r.ok) return out;
      cmds = ((await r.json()) as { commands: Cmd[] }).commands;
    } catch (e) {
      this.o.log?.(`poll lỗi mạng: ${(e as Error).message}`);
      return out;
    }
    for (const c of cmds) {
      const rep = await this.execute(c).catch((e: Error) => ({ ok: false, unknown: true, evidence: `lỗi agent: ${e.message.slice(0, 150)}` }) as Report);
      try {
        await this.f(`${this.o.apiBase}/agent/commands/${c.id}/result`, { method: "POST", headers: this.headers(), body: JSON.stringify(rep) });
        out.executed++;
      } catch (e) {
        this.o.log?.(`báo kết quả lỗi mạng (lệnh ${c.id}): ${(e as Error).message}`); // lệnh sẽ được giao lại sau lease
      }
    }
    return out;
  }

  /** Thực thi một lệnh thuộc tập cố định; payload được kiểm kiểu nghiêm ngặt. */
  private async execute(c: Cmd): Promise<Report> {
    const id = c.bookingId;
    const g = (r: GuestResult): Report => ({ ok: r.ok, unknown: r.unknown, evidence: r.evidence });
    switch (c.command) {
      case "prepare":
        return g(await this.o.guest.prepare({ bookingId: id }));
      case "grant": {
        const { renterId, endAtMs, redeemTtlSeconds } = c.payload as { renterId?: unknown; endAtMs?: unknown; redeemTtlSeconds?: unknown };
        if (typeof renterId !== "string" || typeof endAtMs !== "number" || typeof redeemTtlSeconds !== "number") return { ok: false, evidence: "payload grant không hợp lệ" };
        const r = this.o.gateway.grant({ bookingId: id, renterId, endAtMs, redeemTtlMs: Math.min(redeemTtlSeconds, 900) * 1000 });
        if (!r.ok) return { ok: false, evidence: `gateway từ chối cấp: ${r.reason}` };
        return { ok: true, evidence: "đã cấp token xem", gatewayUrl: this.o.gatewayPublicUrl, redeemToken: r.token };
      }
      case "revoke": {
        this.o.gateway.revoke(id); // đóng mọi kết nối, chặn reconnect (idempotent)
        return g(await this.o.guest.stopSession({ bookingId: id }));
      }
      case "reset":
        return g(await this.o.guest.reset({ bookingId: id }));
      case "verify_reset":
        return g(await this.o.guest.verifyReset({ bookingId: id }));
      default:
        return { ok: false, evidence: `lệnh không hỗ trợ: ${String(c.command).slice(0, 30)}` };
    }
  }

  /** Vòng lặp thường trực; một tick lỗi không làm chết agent. */
  async run(signal: AbortSignal, intervalMs: number): Promise<void> {
    while (!signal.aborted) {
      await this.tick().catch((e: Error) => this.o.log?.(`tick lỗi: ${e.message}`));
      await new Promise<void>((r) => {
        // Gỡ listener khi hết giờ chờ: nếu không, mỗi vòng để lại một listener trên signal (rò rỉ khi agent chạy nhiều giờ).
        const onAbort = () => { clearTimeout(t); r(); };
        const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); r(); }, intervalMs);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
}

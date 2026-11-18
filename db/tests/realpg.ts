/**
 * Postgres THẬT chạy cục bộ để kiểm đồng thời nhiều connection (PGlite chỉ có một connection).
 * Binary lấy từ package npm devDependency `embedded-postgres` (không cài hệ thống), chạy dưới user hiện tại,
 * chỉ lắng nghe 127.0.0.1 với port ngẫu nhiên, dữ liệu ở thư mục tạm bị xoá khi dừng.
 *
 * Đây là PostgreSQL thật nhưng KHÔNG phải Supabase: auth.uid()/roles vẫn là shim (xem harness.ts); PostgREST, GoTrue,
 * JWT, cấu hình pooler chưa được kiểm. Nếu không có binary cho nền tảng hiện tại, startRealPg() trả null và test bị skip.
 */
import type { PGlite } from "@electric-sql/pglite";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SHIM } from "./harness";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "../../supabase/migrations");

function nativeDir(): string | null {
  const pkg = `@embedded-postgres/${os.platform() === "win32" ? "windows" : os.platform()}-${os.arch()}`;
  try {
    const dir = path.join(path.dirname(path.dirname(createRequire(import.meta.url).resolve(pkg))), "native");
    return existsSync(path.join(dir, "bin")) ? dir : null;
  } catch {
    return null;
  }
}

/** initdb trên Windows hỏng khi đường dẫn binary có ký tự không phải ASCII → sao chép sang thư mục tạm ASCII (cache). */
function asciiBinDir(src: string): string {
  if (/^[\x20-\x7e]*$/.test(src)) return src;
  const dst = path.join(os.tmpdir(), "cpm-pgbin-18");
  if (!existsSync(path.join(dst, "bin"))) cpSync(src, dst, { recursive: true });
  return dst;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });

export interface RealPg {
  port: number;
  /** Connection mới (superuser `postgres`). Gọi end() khi xong. */
  connect(): Promise<pg.Client>;
  stop(): Promise<void>;
}

export async function startRealPg(o: { exclude?: string[] } = {}): Promise<RealPg | null> {
  const src = nativeDir();
  if (!src) return null;
  const bin = path.join(asciiBinDir(src), "bin");
  const exe = (n: string) => path.join(bin, os.platform() === "win32" ? `${n}.exe` : n);
  const data = mkdtempSync(path.join(os.tmpdir(), "cpm-pgdata-"));
  const init = spawnSync(exe("initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-sync"], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`initdb thất bại: ${init.stderr || init.stdout}`);
  const port = await freePort();
  const proc: ChildProcess = spawn(exe("postgres"), ["-D", data, "-p", String(port), "-c", "listen_addresses=127.0.0.1", "-c", "fsync=off"], {
    stdio: "ignore",
  });
  const connect = async () => {
    const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database: "postgres" });
    await c.connect();
    return c;
  };
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try {
      (await connect()).end();
      ready = true;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const stop = async () => {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    try { rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows có thể còn giữ file */ }
  };
  if (!ready) { await stop(); throw new Error("Postgres không khởi động được"); }
  const admin = await connect();
  await admin.query(SHIM);
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith(".sql") && !(o.exclude ?? []).includes(x)).sort()) await admin.query(readFileSync(path.join(migrationsDir, f), "utf8"));
  await admin.end();
  return { port, connect, stop };
}

/** Bọc pg.Client thành dạng đủ dùng cho các helper harness (query/exec) vốn viết cho PGlite. */
export function asPglite(c: pg.Client): PGlite {
  return { query: (sql: string, params?: unknown[]) => c.query(sql, params as unknown[]), exec: (sql: string) => c.query(sql) } as unknown as PGlite;
}

/** Đợi tới khi `waiter` đang bị chặn bởi `blocker` (đọc pg_blocking_pids) — barrier thật, không dùng sleep cố định. */
export async function waitBlocked(observer: pg.Client, waiterPid: number, blockerPid: number, timeoutMs = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await observer.query<{ b: number[] }>("select pg_blocking_pids($1) as b", [waiterPid]);
    if (r.rows[0]!.b.includes(blockerPid)) return true;
    await new Promise((r2) => setTimeout(r2, 25));
  }
  return false;
}
export async function backendPid(c: pg.Client): Promise<number> {
  return (await c.query<{ p: number }>("select pg_backend_pid() as p")).rows[0]!.p;
}

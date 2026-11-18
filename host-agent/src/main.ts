/**
 * Điểm vào của host-agent.
 *   enroll : đổi token enrollment một lần lấy credential, lưu vào file (không in ra màn hình/log). Token lấy từ AGENT_ENROLL_TOKEN
 *            hoặc từ stdin (`--token-stdin`, để token không nằm trong dòng lệnh/biến môi trường của tiến trình).
 *   run    : heartbeat + nhận lệnh + gateway trước Selkies. Guest mặc định là "chưa cài": mọi bước cần guest trả Unknown.
 *   status : in `enrolled=0|1` và `machine_id=<uuid>` (không bao giờ in credential).
 * Fail-closed: thiếu/sai cấu hình thì thoát, nêu TÊN biến (không bao giờ in giá trị). Chỉ kết nối RA NGOÀI tới control plane;
 * gateway chỉ lắng nghe địa chỉ được cấu hình (mặc định loopback) và chỉ nói chuyện với một upstream cố định.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Agent, FileCounter, unavailableGuest, type GuestController } from "./agent";
import { DockerSelkiesGuest, localDockerRunner, sshDockerRunner } from "./dockerGuest";
import { Gateway } from "./gateway";

export interface Env {
  [k: string]: string | undefined;
}

export class ConfigError extends Error {}

function need(env: Env, names: string[]): string[] {
  return names.filter((n) => !env[n]?.trim());
}
const clean = (u: string) => u.trim().replace(/\/+$/, "");
const dataDir = (env: Env) => env.AGENT_DATA_DIR?.trim() || ".agent";
export const credentialPath = (env: Env) => path.join(dataDir(env), "credential.json");

/**
 * Đọc file cấu hình dạng `TÊN=GIÁ_TRỊ` mỗi dòng (dòng trống và dòng bắt đầu bằng # bị bỏ qua). KHÔNG qua shell: không mở rộng
 * biến, không nháy, không lệnh con — giá trị được lấy nguyên văn. Tên biến chỉ gồm chữ hoa, số và gạch dưới.
 */
export function parseEnvFile(text: string): Env {
  const out: Env = {};
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Z][A-Z0-9_]{0,63})=(.*)$/.exec(line);
    if (!m) throw new ConfigError(`File cấu hình sai định dạng ở dòng ${i + 1} (cần TÊN=GIÁ_TRỊ)`);
    out[m[1]!] = m[2]!;
  }
  return out;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

export async function enroll(env: Env, fetchImpl: typeof fetch = fetch): Promise<void> {
  const miss = need(env, ["AGENT_API_BASE", "AGENT_ENROLL_TOKEN"]);
  if (miss.length) throw new ConfigError(`Cấu hình enroll chưa đủ: ${miss.join(", ")} (thiếu)`);
  const token = env.AGENT_ENROLL_TOKEN!.trim();
  if (!TOKEN_RE.test(token)) throw new ConfigError("AGENT_ENROLL_TOKEN (sai định dạng)");
  let r: Response;
  try {
    r = await fetchImpl(`${clean(env.AGENT_API_BASE!)}/agent/enroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  } catch (e) {
    throw new ConfigError(`Không kết nối được control plane để enroll (${String((e as Error).message).slice(0, 80)}).`);
  }
  if (!r.ok) throw new ConfigError(`Enroll bị từ chối (HTTP ${r.status}): token không hợp lệ, đã dùng hoặc hết hạn.`);
  const { credential, machineId } = (await r.json()) as { credential?: string; machineId?: string };
  if (!credential || !machineId) throw new ConfigError("Phản hồi enroll không hợp lệ.");
  const file = credentialPath(env);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ credential, machineId }), { mode: 0o600 });
  // Thiết bị mới ⇒ bộ đếm heartbeat bắt đầu lại (máy chủ đặt last_counter = 0 cho enrollment mới).
  await rm(path.join(dataDir(env), "counter.json"), { force: true });
}

/** Trạng thái ghi danh để UI hiển thị. Không bao giờ trả credential. */
export async function status(env: Env): Promise<{ enrolled: boolean; machineId: string | null }> {
  try {
    const j = JSON.parse(await readFile(credentialPath(env), "utf8")) as { credential?: unknown; machineId?: unknown };
    const ok = typeof j.credential === "string" && j.credential.length >= 20 && typeof j.machineId === "string" && /^[0-9a-f-]{36}$/.test(j.machineId);
    return { enrolled: ok, machineId: ok ? (j.machineId as string) : null };
  } catch {
    return { enrolled: false, machineId: null };
  }
}

/**
 * GUEST_MODE=docker: container Selkies là máy cho thuê (cần GUEST_DOCKER_IMAGE đã có sẵn trên host; không tải lại).
 * Mặc định (không đặt GUEST_MODE) là guest chưa cài: mọi bước cần guest trả Unknown. Không có chế độ "giả thành công".
 * GUEST_DOCKER_SSH_TARGET (+ _KEY, _KNOWN_HOSTS, _PORT): CHỈ cho demo khi docker nằm trong VM và host-agent chạy ở máy khác.
 * GUEST_DOCKER_PUBLISH_ADDR: IPv4 để publish cổng Selkies (khuyến nghị 127.0.0.1 khi agent chạy cùng máy với docker).
 * GUEST_DOCKER_MEMORY_MB / GUEST_DOCKER_CPUS: giới hạn RAM (MiB) và số CPU của container khách (`--memory`, `--memory-swap`, `--cpus`).
 * GUEST_DOCKER_GPU=all: thêm `--gpus all` (CHƯA kiểm với Selkies trên GPU thật/WSL2; mặc định tắt ⇒ mã hoá bằng CPU).
 */
export function buildGuest(env: Env, log: (m: string) => void): GuestController {
  const mode = env.GUEST_MODE?.trim();
  if (!mode) return unavailableGuest;
  if (mode !== "docker") throw new ConfigError("GUEST_MODE (sai): chỉ hỗ trợ docker");
  const miss = need(env, ["GUEST_DOCKER_IMAGE", "GATEWAY_UPSTREAM"]);
  if (miss.length) throw new ConfigError(`Cấu hình guest docker chưa đủ: ${miss.join(", ")} (thiếu)`);
  const gpu = env.GUEST_DOCKER_GPU?.trim();
  if (gpu && gpu !== "all") throw new ConfigError("GUEST_DOCKER_GPU (sai): chỉ hỗ trợ all");
  const intEnv = (name: string): number | undefined => {
    const v = env[name]?.trim();
    if (!v) return undefined;
    if (!/^\d{1,7}$/.test(v)) throw new ConfigError(`${name} (sai): cần số nguyên`);
    return Number(v);
  };
  const memoryMb = intEnv("GUEST_DOCKER_MEMORY_MB");
  const cpus = intEnv("GUEST_DOCKER_CPUS");
  let runner = localDockerRunner();
  if (env.GUEST_DOCKER_SSH_TARGET?.trim()) {
    const sm = need(env, ["GUEST_DOCKER_SSH_KEY", "GUEST_DOCKER_SSH_KNOWN_HOSTS"]);
    if (sm.length) throw new ConfigError(`Cấu hình SSH cho guest chưa đủ: ${sm.join(", ")} (thiếu)`);
    log("CẢNH BÁO: guest docker chạy qua SSH — chỉ dùng cho demo/thử, host thật chạy host-agent ngay trên máy host");
    try {
      runner = sshDockerRunner({ target: env.GUEST_DOCKER_SSH_TARGET.trim(), port: env.GUEST_DOCKER_SSH_PORT ? Number(env.GUEST_DOCKER_SSH_PORT) : undefined, keyFile: env.GUEST_DOCKER_SSH_KEY!.trim(), knownHostsFile: env.GUEST_DOCKER_SSH_KNOWN_HOSTS!.trim() });
    } catch (e) {
      throw new ConfigError(`GUEST_DOCKER_SSH_TARGET (sai): ${(e as Error).message}`);
    }
  }
  if (gpu) log("CẢNH BÁO: GUEST_DOCKER_GPU=all — chưa kiểm với Selkies trên GPU thật; nếu container không khởi động được, bỏ biến này");
  try {
    return new DockerSelkiesGuest({
      runner, stateDir: dataDir(env), container: env.GUEST_DOCKER_CONTAINER?.trim() || undefined, image: env.GUEST_DOCKER_IMAGE!.trim(),
      hostPort: env.GUEST_DOCKER_HOST_PORT ? Number(env.GUEST_DOCKER_HOST_PORT) : undefined, publishAddr: env.GUEST_DOCKER_PUBLISH_ADDR?.trim() || undefined,
      gpus: gpu ? "all" : undefined, memoryMb, cpus, upstreamUrl: env.GATEWAY_UPSTREAM!.trim(), log,
    });
  } catch (e) {
    throw new ConfigError(`Cấu hình guest docker sai: ${(e as Error).message}`);
  }
}

const flag = (env: Env, name: string) => /^(1|true|yes)$/i.test(env[name]?.trim() ?? "");

export interface RunHooks {
  /** Gọi sau khi gateway đã lắng nghe và guest đã được khởi tạo (để test/UI biết agent đã sẵn sàng nhận lệnh). */
  onReady?: (info: { gatewayPort: number }) => void;
  /** Tiêm guest (test). Mặc định dựng từ env. */
  guest?: GuestController;
  fetchImpl?: typeof fetch;
}

export async function run(env: Env, signal: AbortSignal, log: (m: string) => void = console.log, hooks: RunHooks = {}): Promise<void> {
  const miss = need(env, ["AGENT_API_BASE", "GATEWAY_UPSTREAM", "GATEWAY_PUBLIC_URL"]);
  if (miss.length) throw new ConfigError(`Cấu hình agent chưa đủ: ${miss.join(", ")} (thiếu)`);
  let credential: string;
  try {
    credential = (JSON.parse(await readFile(credentialPath(env), "utf8")) as { credential: string }).credential;
  } catch {
    throw new ConfigError("Chưa có credential: chạy `enroll` với token do admin cấp.");
  }
  const origins = (env.GATEWAY_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // Public deployment phải khai báo origin được phép (chống CSWSH). Bỏ trống chỉ chấp nhận khi chạy loopback.
  if (!origins.length && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(env.GATEWAY_PUBLIC_URL!)) throw new ConfigError("GATEWAY_ALLOWED_ORIGINS (thiếu) — bắt buộc khi gateway không ở loopback");
  // Viewer nhúng iframe trong app: khai origin của app (Tauri Windows: http://tauri.localhost). Khác site nên cookie phiên cần SameSite=None (kèm Secure).
  const frameAncestors = (env.GATEWAY_FRAME_ANCESTORS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const sameSite = env.GATEWAY_SAMESITE?.trim() === "Lax" ? "Lax" : env.GATEWAY_SAMESITE?.trim() === "None" || frameAncestors.length ? "None" : "Lax";
  const publicUrl = env.GATEWAY_PUBLIC_URL!.trim();
  if (sameSite === "None" && !/^https:\/\//.test(publicUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(publicUrl)) throw new ConfigError("GATEWAY_PUBLIC_URL phải là https:// (hoặc loopback) khi cookie SameSite=None/nhúng iframe");
  const guest = hooks.guest ?? buildGuest(env, log);
  let gateway: Gateway;
  try {
    gateway = new Gateway({ upstream: env.GATEWAY_UPSTREAM!.trim(), allowedOrigins: origins, sameSite, frameAncestors });
  } catch (e) {
    throw new ConfigError(`GATEWAY_FRAME_ANCESTORS (sai): ${(e as Error).message}`);
  }
  const pidFile = env.AGENT_PID_FILE?.trim();
  const port = await gateway.listen(Number(env.GATEWAY_PORT ?? 0), env.GATEWAY_BIND?.trim() || "127.0.0.1");
  log(`gateway lắng nghe cổng ${port}`);
  try {
    if (pidFile) {
      await mkdir(path.dirname(pidFile), { recursive: true });
      await writeFile(pidFile, String(process.pid), { mode: 0o600 });
    }
    if (guest.ensureReady) {
      const r = await guest.ensureReady();
      log(r.ok ? `guest sẵn sàng khởi tạo: ${r.evidence}` : `guest CHƯA sẵn sàng (${r.unknown ? "chưa rõ" : "lỗi"}): ${r.evidence} — agent vẫn chạy, bước chuẩn bị phiên sẽ báo lại`);
    }
    const agent = new Agent({
      apiBase: clean(env.AGENT_API_BASE!), credential, gateway, gatewayPublicUrl: clean(env.GATEWAY_PUBLIC_URL!),
      guest, counter: new FileCounter(path.join(dataDir(env), "counter.json")), log, fetchImpl: hooks.fetchImpl,
    });
    hooks.onReady?.({ gatewayPort: port });
    log("agent đang chạy: heartbeat và nhận lệnh");
    await agent.run(signal, Number(env.AGENT_INTERVAL_MS ?? 5000));
    log("agent dừng theo yêu cầu");
  } finally {
    await gateway.close(); // cắt mọi phiên xem đang mở trước khi dọn guest
    if (flag(env, "GUEST_CLEANUP_ON_EXIT") && guest.cleanup) {
      const r = await guest.cleanup().catch((e: Error) => ({ ok: false, evidence: e.message }));
      log(r.ok ? `đã dọn guest: ${r.evidence}` : `CHƯA dọn được guest: ${r.evidence}`);
    }
    if (pidFile) await rm(pidFile, { force: true }).catch(() => undefined);
  }
}

async function readAll(stream: NodeJS.ReadableStream, max = 4096): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of stream) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
    n += b.length;
    if (n > max) throw new ConfigError("Dữ liệu stdin quá dài.");
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface CliIo {
  env: Env;
  stdin: NodeJS.ReadableStream;
  out: (m: string) => void;
  /** Đăng ký dừng (SIGINT/SIGTERM/stdin đóng). */
  onStop: (stop: () => void) => void;
}

/**
 * Dòng lệnh: `[--env-file <đường dẫn>] enroll [--token-stdin] | run | status`.
 * Giá trị trong --env-file GHI ĐÈ biến môi trường của tiến trình (file là cấu hình do app của host ghi, đã kiểm dạng).
 */
export async function cliMain(argv: string[], io: CliIo): Promise<void> {
  const args = [...argv];
  let env: Env = { ...io.env };
  if (args[0] === "--env-file") {
    const file = args[1];
    if (!file) throw new ConfigError("Thiếu đường dẫn sau --env-file");
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      throw new ConfigError("Không đọc được file cấu hình (--env-file).");
    }
    env = { ...env, ...parseEnvFile(text) };
    args.splice(0, 2);
  }
  const [cmd, ...rest] = args;
  if (cmd === "enroll") {
    if (rest.includes("--token-stdin")) env.AGENT_ENROLL_TOKEN = (await readAll(io.stdin)).trim();
    await enroll(env);
    io.out("Đã lưu credential (không in ra).");
    return;
  }
  if (cmd === "status") {
    const s = await status(env);
    io.out(`enrolled=${s.enrolled ? 1 : 0}`);
    io.out(`machine_id=${s.machineId ?? ""}`);
    return;
  }
  if (cmd === "run") {
    const ac = new AbortController();
    io.onStop(() => ac.abort());
    // App của host giữ stdin mở suốt thời gian cho thuê; app thoát/treo ⇒ stdin đóng ⇒ agent tự dừng (cắt phiên, dọn guest nếu bật).
    if (flag(env, "AGENT_EXIT_ON_STDIN_CLOSE")) {
      io.stdin.on("end", () => ac.abort());
      io.stdin.on("close", () => ac.abort());
      io.stdin.resume();
    }
    await run(env, ac.signal, io.out);
    return;
  }
  throw new ConfigError("Dùng: [--env-file <file>] enroll [--token-stdin] | run | status");
}

export function runCliFromProcess(): void {
  cliMain(process.argv.slice(2), {
    env: process.env,
    stdin: process.stdin,
    out: (m) => console.log(m),
    onStop: (stop) => {
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      process.on("SIGHUP", stop);
    },
  }).then(
    () => process.exit(0),
    (e: Error) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}

if (process.argv[1] && /main\.(ts|js)$/.test(process.argv[1])) runCliFromProcess();

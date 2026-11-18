/**
 * Guest thật cho host Linux: một container Selkies (Docker) là "máy cho thuê". Thực thi qua `GuestRunner` (tiêm vào):
 *  - `localDockerRunner`: docker chạy ngay trên host (cách chạy thật: host-agent chạy trên chính máy host).
 *  - `sshDockerRunner`: CHỈ để demo/thử khi docker nằm trong VM còn host-agent chạy trên Windows. Đây là lệch topo so với thiết kế
 *    (host-agent thật chạy trên máy host), phải gắn nhãn khi dùng.
 * Quy tắc an toàn: không có shell nào nhận chuỗi từ lệnh/renter; tên container và image được kiểm dạng; lỗi/hết giờ ⇒ Unknown,
 * KHÔNG BAO GIỜ thành công; reset = xoá container rồi tạo lại từ image đã có (`--pull=never`, không tải lại 8 GB) và chỉ được coi là
 * đã reset khi verifyReset thấy container MỚI (id khác id trước reset), healthy và upstream trả 200.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GuestController, GuestResult } from "./agent";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Chạy `docker <args>`. args là mảng, không phải chuỗi shell. Hết giờ phải reject (không trả code 0). */
export interface GuestRunner {
  docker(args: string[], timeoutMs: number): Promise<RunResult>;
}

const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
const IMAGE_RE = /^[a-z0-9][a-z0-9._/:@-]{0,300}$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function localDockerRunner(bin = "docker"): GuestRunner {
  return {
    docker: (args, timeoutMs) =>
      new Promise((resolve, reject) => {
        execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;
          if (e && (e.killed || typeof e.code === "string")) return reject(new Error(e.killed ? "hết giờ" : `không chạy được docker (${String(e.code)})`));
          resolve({ code: e ? Number(e.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
        });
      }),
  };
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** CHỈ cho demo/thử (xem đầu tệp). Khoá SSH + known_hosts do người vận hành cấp; luôn StrictHostKeyChecking=yes. */
export function sshDockerRunner(o: { target: string; port?: number; keyFile: string; knownHostsFile: string; sudo?: boolean; ssh?: string }): GuestRunner {
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(o.target)) throw new Error("GUEST_DOCKER_SSH_TARGET phải dạng user@host");
  const run = localDockerRunner(o.ssh ?? "ssh");
  return {
    docker: (args, timeoutMs) => {
      const remote = `${o.sudo === false ? "" : "sudo "}docker ${args.map(shq).join(" ")}`;
      const sshArgs = ["-i", o.keyFile, "-p", String(o.port ?? 22), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${o.knownHostsFile}`, "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=10", o.target, remote];
      return run.docker(sshArgs, timeoutMs);
    },
  };
}

/** Cận của giới hạn RAM/CPU: dưới mức này desktop Selkies không chạy nổi; trên mức này là lỗi nhập. */
export const MIN_MEMORY_MB = 1024;
export const MAX_MEMORY_MB = 262_144;
export const MAX_CPUS = 128;

export interface DockerGuestOptions {
  runner: GuestRunner;
  /** Thư mục lưu trạng thái bền (id container trước/sau reset). */
  stateDir: string;
  container?: string;
  /** Image đã có sẵn trên host (nên ghim digest). Không bao giờ tải lại. */
  image: string;
  /** Cổng publish ở host cho cổng 8080 của Selkies. */
  hostPort?: number;
  /**
   * Địa chỉ IPv4 ở host để publish cổng (ví dụ "127.0.0.1": chỉ gateway cùng máy tới được Selkies). Bỏ trống = mọi giao diện
   * (hành vi cũ, chỉ hợp lý khi host đã đứng sau NAT/tường lửa như VM thử).
   */
  publishAddr?: string;
  /** "all" ⇒ thêm `--gpus all` (cần NVIDIA Container Toolkit trên host). CHƯA kiểm với Selkies trên GPU thật/WSL2: mặc định tắt. */
  gpus?: "all";
  /** Giới hạn RAM của container khách (MiB). Đặt cả `--memory-swap` bằng đúng giá trị để khách không tràn sang swap của host. */
  memoryMb?: number;
  /** Giới hạn số CPU (nguyên) của container khách (`--cpus`). */
  cpus?: number;
  /** URL upstream (như GATEWAY_UPSTREAM) để thăm dò HTTP 200 trước khi cấp quyền. */
  upstreamUrl: string;
  fetchImpl?: typeof fetch;
  commandTimeoutMs?: number;
  probeTimeoutMs?: number;
  log?: (m: string) => void;
}

interface State {
  containerId?: string;
  resetFrom?: string;
}

const unknown = (evidence: string): GuestResult => ({ ok: false, unknown: true, evidence });
const no = (evidence: string): GuestResult => ({ ok: false, evidence });

export class DockerSelkiesGuest implements GuestController {
  private readonly name: string;
  private readonly timeout: number;
  private readonly f: typeof fetch;
  private readonly stateFile: string;
  constructor(private readonly o: DockerGuestOptions) {
    this.name = o.container ?? "selkies";
    if (!NAME_RE.test(this.name)) throw new Error("tên container không hợp lệ");
    if (!IMAGE_RE.test(o.image)) throw new Error("image không hợp lệ");
    if (o.hostPort !== undefined && !(Number.isInteger(o.hostPort) && o.hostPort > 0 && o.hostPort < 65536)) throw new Error("cổng host không hợp lệ");
    if (o.publishAddr !== undefined && !IPV4_RE.test(o.publishAddr)) throw new Error("địa chỉ publish không hợp lệ (cần IPv4)");
    if (o.gpus !== undefined && o.gpus !== "all") throw new Error("gpus chỉ hỗ trợ \"all\"");
    if (o.memoryMb !== undefined && !(Number.isInteger(o.memoryMb) && o.memoryMb >= MIN_MEMORY_MB && o.memoryMb <= MAX_MEMORY_MB)) throw new Error(`memoryMb phải là số nguyên ${MIN_MEMORY_MB}–${MAX_MEMORY_MB}`);
    if (o.cpus !== undefined && !(Number.isInteger(o.cpus) && o.cpus >= 1 && o.cpus <= MAX_CPUS)) throw new Error(`cpus phải là số nguyên 1–${MAX_CPUS}`);
    this.timeout = o.commandTimeoutMs ?? 120_000;
    this.f = o.fetchImpl ?? fetch;
    this.stateFile = path.join(o.stateDir, "guest-state.json");
  }

  private async load(): Promise<State> {
    try {
      return JSON.parse(await readFile(this.stateFile, "utf8")) as State;
    } catch {
      return {};
    }
  }
  private async save(s: State) {
    await mkdir(path.dirname(this.stateFile), { recursive: true });
    const tmp = `${this.stateFile}.tmp`;
    await writeFile(tmp, JSON.stringify(s));
    await rename(tmp, this.stateFile);
  }

  /** null = không tồn tại. Ném lỗi nếu không hỏi được docker (⇒ Unknown ở nơi gọi). */
  private async inspect(): Promise<{ id: string; running: boolean; health: string } | null> {
    const r = await this.o.runner.docker(["inspect", "--format", "{{.Id}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", this.name], this.timeout);
    if (r.code !== 0) {
      if (/no such (object|container)/i.test(r.stderr)) return null;
      throw new Error(`docker inspect lỗi (mã ${r.code})`);
    }
    const [id, running, health] = r.stdout.trim().split("|");
    if (!id || !/^[0-9a-f]{12,64}$/.test(id)) throw new Error("phản hồi docker inspect không hiểu được");
    return { id, running: running === "true", health: health ?? "none" };
  }

  private async upstreamOk(): Promise<boolean> {
    try {
      const r = await this.f(this.o.upstreamUrl, { signal: AbortSignal.timeout(this.o.probeTimeoutMs ?? 10_000), redirect: "manual" });
      return r.status === 200;
    } catch {
      return false;
    }
  }

  async prepare(): Promise<GuestResult> {
    try {
      const c = await this.inspect();
      if (!c) return no("container Selkies chưa tồn tại (cần reset/khởi tạo)");
      if (!c.running) return no("container Selkies không chạy");
      if (c.health !== "healthy") return unknown(`container chưa healthy (${c.health}); sẽ thử lại`);
      if (!(await this.upstreamOk())) return unknown("upstream Selkies chưa trả HTTP 200");
      return { ok: true, evidence: `Selkies healthy (${c.id.slice(0, 12)}), upstream 200` };
    } catch (e) {
      return unknown(`không xác minh được guest: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  /** Phiên đã bị gateway cắt trước lệnh này; việc dọn dẹp thật nằm ở reset (container mới, không giữ trạng thái người thuê). */
  async stopSession(): Promise<GuestResult> {
    return { ok: true, evidence: "phiên đã dừng ở gateway; dọn dẹp ở bước reset" };
  }

  /** Tham số `docker run` cố định; không giá trị nào đến từ lệnh/renter. */
  private runArgs(): string[] {
    const port = `${this.o.publishAddr ? `${this.o.publishAddr}:` : ""}${this.o.hostPort ?? 8080}:8080`;
    return ["run", "-d", "--pull=never", "--name", this.name, "--shm-size=2g", "--restart", "unless-stopped", ...(this.o.gpus ? ["--gpus", this.o.gpus] : []), ...(this.o.memoryMb ? [`--memory=${this.o.memoryMb}m`, `--memory-swap=${this.o.memoryMb}m`] : []), ...(this.o.cpus ? [`--cpus=${this.o.cpus}`] : []), "-p", port, "-e", "SELKIES_ENABLE_HTTPS=false", "-e", "SELKIES_ENABLE_BASIC_AUTH=false", this.o.image];
  }

  /** Xoá container (nếu có) rồi tạo lại từ image; lưu id mới + id bị thay. Ném lỗi/ trả Unknown khi không chắc. */
  private async recreate(previousId: string | undefined): Promise<GuestResult & { id?: string }> {
    const rm = await this.o.runner.docker(["rm", "-f", this.name], this.timeout);
    if (rm.code !== 0 && !/no such (object|container)/i.test(rm.stderr)) return unknown(`docker rm lỗi (mã ${rm.code})`);
    const run = await this.o.runner.docker(this.runArgs(), this.timeout);
    if (run.code !== 0) return unknown(`docker run lỗi (mã ${run.code})`);
    const now = await this.inspect();
    if (!now) return unknown("không thấy container sau khi tạo lại");
    await this.save({ containerId: now.id, resetFrom: previousId });
    return { ok: true, evidence: `đã tạo lại container (${now.id.slice(0, 12)})`, id: now.id };
  }

  async reset(): Promise<GuestResult> {
    try {
      const before = await this.inspect();
      const r = await this.recreate(before?.id);
      if (!r.ok) return r;
      this.o.log?.(`guest reset: ${before?.id.slice(0, 12) ?? "không có"} → ${r.id!.slice(0, 12)}`);
      return { ok: true, evidence: `${r.evidence}; chờ verify_reset` };
    } catch (e) {
      return unknown(`reset chưa xác định: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  /**
   * Gọi khi agent khởi động (host bấm "Bắt đầu nhận thuê"). Giữ container hiện có CHỈ khi nó đúng là container do chính agent này
   * tạo ở lần reset/khởi động gần nhất và đang chạy (nếu còn dở một phiên thì worker vẫn sẽ reset trước khi nhận khách mới).
   * Mọi trường hợp khác (chưa có, đã dừng, container lạ không rõ nguồn gốc) ⇒ tạo MỚI từ image, không dùng lại trạng thái cũ.
   */
  async ensureReady(): Promise<GuestResult> {
    try {
      const [c, st] = [await this.inspect(), await this.load()];
      if (c && c.running && st.containerId === c.id) return { ok: true, evidence: `giữ container hiện có (${c.id.slice(0, 12)})` };
      const r = await this.recreate(c?.id ?? st.containerId);
      if (!r.ok) return r;
      this.o.log?.(`guest khởi tạo: ${c ? `thay ${c.id.slice(0, 12)}` : "chưa có container"} → ${r.id!.slice(0, 12)}`);
      return { ok: true, evidence: r.evidence };
    } catch (e) {
      return unknown(`chưa khởi tạo được guest: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  /** Dọn guest khi host dừng cung cấp: xoá container (kèm mọi dữ liệu trong đó). Không tồn tại sẵn cũng là đã dọn. */
  async cleanup(): Promise<GuestResult> {
    try {
      const rm = await this.o.runner.docker(["rm", "-f", this.name], this.timeout);
      if (rm.code !== 0 && !/no such (object|container)/i.test(rm.stderr)) return unknown(`docker rm lỗi (mã ${rm.code})`);
      if (await this.inspect()) return no("container vẫn còn sau khi xoá");
      this.o.log?.("guest đã dọn: container bị xoá");
      return { ok: true, evidence: "đã xoá container guest" };
    } catch (e) {
      return unknown(`chưa dọn được guest: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  async verifyReset(): Promise<GuestResult> {
    try {
      const st = await this.load();
      const c = await this.inspect();
      if (!c) return no("container không tồn tại sau reset");
      if (!st.containerId || c.id !== st.containerId) return no("container hiện tại không phải container do reset tạo (có thể bị thay đổi)");
      if (st.resetFrom && c.id === st.resetFrom) return no("container vẫn là bản trước reset");
      if (!c.running) return no("container mới không chạy");
      if (c.health !== "healthy") return unknown(`container mới chưa healthy (${c.health}); sẽ thử lại`);
      if (!(await this.upstreamOk())) return unknown("upstream chưa trả HTTP 200 sau reset");
      return { ok: true, evidence: `reset đã xác minh: container mới ${c.id.slice(0, 12)} (≠ ${st.resetFrom?.slice(0, 12) ?? "không có bản trước"}), healthy, upstream 200` };
    } catch (e) {
      return unknown(`không xác minh được reset: ${(e as Error).message.slice(0, 120)}`);
    }
  }
}

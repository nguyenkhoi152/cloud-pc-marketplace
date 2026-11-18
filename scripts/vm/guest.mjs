#!/usr/bin/env node
/**
 * Điều khiển agent TRONG guest Linux thử (VM VirtualBox qua SSH) từ dòng lệnh — cùng tập lệnh cố định mà app Companion
 * dùng (host-agent/guest/cpm-guest.sh), để kiểm luồng host khi không mở app. KHÔNG dành cho WSL (WSL do app điều khiển).
 * Đọc cấu hình backend từ tệp app dùng (%APPDATA%\dev.cloudpc.companion\host-backend.json, kind "ssh-dev") — do
 * start-demo.ps1 ghi. Không in token/credential.
 *
 * Dùng:  node scripts/vm/guest.mjs <probe|provision|install|configure|enroll <tệp token>|run|stop|cleanup> [apiBaseCủaApp]
 *   run chạy ở tiền cảnh và giữ stdin của agent mở; Ctrl+C (hoặc tiến trình này bị dừng) ⇒ agent tự dừng và dọn guest.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [action, arg1] = process.argv.slice(2);
const backendFile = process.env.CPM_HOST_BACKEND ?? path.join(process.env.APPDATA ?? os.homedir(), "dev.cloudpc.companion", "host-backend.json");
const b = JSON.parse(readFileSync(backendFile, "utf8").replace(/^\uFEFF/, ""));
if (b.kind !== "ssh-dev") throw new Error(`Tệp backend không phải ssh-dev (${b.kind}); script này chỉ dùng cho VM thử.`);
if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(b.target)) throw new Error("target không hợp lệ");

const SCRIPT = readFileSync(path.join(root, "host-agent/guest/cpm-guest.sh"));
const BUNDLE = () => readFileSync(path.join(root, "host-agent/dist/cpm-host-agent.cjs"));
const SHA = () => readFileSync(path.join(root, "host-agent/dist/cpm-host-agent.cjs.sha256"), "utf8").trim();
const SYNC = "umask 077; mkdir -p .cpm-host && cat > .cpm-host/cpm-guest.sh.new && mv -f .cpm-host/cpm-guest.sh.new .cpm-host/cpm-guest.sh";
const safe = (s) => { if (!/^[A-Za-z0-9._:/@-]{1,300}$/.test(s)) throw new Error(`tham số không hợp lệ: ${s.slice(0, 20)}…`); return s; };
const ssh = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "OpenSSH", "ssh.exe");
const sshArgs = (remote, long = false) => ["-i", b.keyFile, "-p", String(b.port ?? 22), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${b.knownHostsFile}`, "-o", "ConnectTimeout=20", ...(long ? ["-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4"] : []), b.target, remote];

/** Chạy một lệnh trong guest; stdin = dữ liệu (hoặc script). Trả mã thoát; in stdout/stderr của guest. */
function run(remote, input, { quiet = false } = {}) {
  return new Promise((resolve) => {
    const c = spawn(ssh, sshArgs(remote), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    c.stdout.on("data", (d) => { out += d; if (!quiet) process.stdout.write(d); });
    c.stderr.on("data", (d) => { if (!quiet) process.stderr.write(d); });
    c.on("close", (code) => resolve({ code: code ?? -1, out }));
    c.stdin.on("error", () => undefined);
    c.stdin.end(input ?? "");
  });
}
const piped = (act, args = [], root_ = false) => run(`${root_ ? "sudo -n " : ""}bash -s -- ${[act, ...args.map(safe)].join(" ")}`, SCRIPT);
const installed = (act, args, input) => run(`bash .cpm-host/cpm-guest.sh ${[act, ...args.map(safe)].join(" ")}`, input);
const must = (r, what) => { if (r.code !== 0) { console.error(`\n${what} thất bại (mã ${r.code})`); process.exit(1); } return r; };

const appApi = (arg1 && action !== "enroll" ? arg1 : process.env.CPM_APP_API_BASE) ?? "http://127.0.0.1:3000/api";
const agentApi = safe(b.agentApiBase ?? appApi);

switch (action) {
  case "probe":
    must(await piped("probe", [agentApi]), "probe");
    break;
  case "provision": {
    const user = b.target.split("@")[0];
    must(await piped("provision", [user], true), "provision");
    break;
  }
  case "install":
    must(await run(SYNC, SCRIPT), "chép script");
    must(await installed("install-agent", [SHA()], BUNDLE()), "cài agent");
    break;
  case "configure": {
    const port = 18095;
    const env = [
      `AGENT_API_BASE=${agentApi}`, "AGENT_INTERVAL_MS=3000", `GATEWAY_PUBLIC_URL=http://127.0.0.1:${port}`, `GATEWAY_PORT=${port}`, `GATEWAY_BIND=${b.gatewayBind ?? "127.0.0.1"}`,
      `GATEWAY_ALLOWED_ORIGINS=http://127.0.0.1:${port}`, "GATEWAY_FRAME_ANCESTORS=http://tauri.localhost,http://127.0.0.1:5174,http://localhost:5174",
    ].join("\n") + "\n";
    must(await run(SYNC, SCRIPT), "chép script");
    must(await installed("configure", [], env), "cấu hình agent");
    break;
  }
  case "enroll": {
    if (!arg1) throw new Error("Dùng: enroll <tệp chứa token ghi danh>");
    const token = readFileSync(arg1, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) throw new Error("token trong tệp sai định dạng");
    must(await installed("enroll", [], token + "\n"), "ghi danh");
    break;
  }
  case "run": {
    const c = spawn(ssh, sshArgs("bash .cpm-host/cpm-guest.sh run", true), { stdio: ["pipe", "inherit", "inherit"], windowsHide: true });
    const stop = () => { try { c.stdin.end(); } catch { /* đã đóng */ } };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    process.on("SIGBREAK", stop);
    c.on("close", (code) => process.exit(code ?? 0));
    break;
  }
  case "stop":
    must(await piped("stop"), "dừng agent");
    break;
  case "cleanup":
    must(await piped("cleanup"), "dọn guest");
    break;
  default:
    console.error("Dùng: guest.mjs <probe|provision|install|configure|enroll <tệp token>|run|stop|cleanup>");
    process.exit(2);
}

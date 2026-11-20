#!/usr/bin/env node
/**
 * Giu agent cua host trong WSL2 chay NEN, doc lap voi bat ky phien nao (giong cach app Companion lam).
 *   node scripts/public/hold-agent.mjs [distro Ubuntu-24.04] [tep nhat ky C:\cpm-demo\logs\agent-wsl.log]
 * stdin cua tien trinh wsl.exe luon mo. Dong stdin (hoac tien trinh nay chet) la TIN HIEU de agent tu dung, cat phien xem va don guest.
 * Dung bang scripts\vm\stop-demo.ps1 (no dung tien trinh nay; guest tu don khi stdin dong). Khong in/doc bi mat nao.
 */
import { spawn } from "node:child_process";
import { openSync } from "node:fs";

const [distro = "Ubuntu-24.04", logFile = "C:\\cpm-demo\\logs\\agent-wsl.log"] = process.argv.slice(2);
if (!/^[A-Za-z0-9._-]{1,64}$/.test(distro)) throw new Error("Ten distro khong hop le");

const log = openSync(logFile, "w");
const child = spawn("wsl.exe", ["-d", distro, "--cd", "~", "--exec", "bash", ".cpm-host/cpm-guest.sh", "run"], {
  stdio: ["pipe", log, log],
  windowsHide: true,
  env: { ...process.env, WSL_UTF8: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (e) => { console.error(`khong chay duoc wsl.exe: ${e.message}`); process.exit(1); });

const stop = () => { child.stdin.end(); setTimeout(() => process.exit(0), 20_000); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

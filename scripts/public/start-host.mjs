#!/usr/bin/env node
/**
 * Bat PHAN HOST tren may nay (sau khi start-demo.ps1 -Tunnel da mo tunnel API va cap ma ghi danh moi):
 *   1) mo tunnel Cloudflare cho gateway (127.0.0.1:18095)   2) ghi cau hinh agent trong WSL2 (giong host_configure cua app)
 *   3) ghi danh bang ma trong C:\cpm-demo\enroll-token.txt (qua stdin, KHONG in ra; xoa tep sau khi dung)
 *   4) chay agent nen (hold-agent.mjs)   5) kiem tra gateway tra 401 khi khong co token, ca cuc bo lan qua tunnel
 *   node scripts/public/start-host.mjs [distro Ubuntu-24.04] [RAM MiB 4096] [CPU 2]
 * Can truoc: guest da co agent + image Selkies (lam mot lan trong app: Cho thue may > Thiet lap & chay may, hoac guest.mjs/provision).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEMO = "C:\\cpm-demo";
const ENROLL_ONLY = process.argv.includes("--enroll-only"); // chi cau hinh toi thieu + ghi danh; KHONG bat tunnel gateway/agent (app Companion lam phan do)
const [distro = "Ubuntu-24.04", memArg = "4096", cpuArg = "2"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const here = path.dirname(fileURLToPath(import.meta.url));
const step = (m) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error(`LOI: ${m}`); process.exit(1); };

if (!/^[A-Za-z0-9._-]{1,64}$/.test(distro)) fail("ten distro khong hop le");
const memoryMb = Number(memArg), cpus = Number(cpuArg);
if (!Number.isInteger(memoryMb) || memoryMb < 1024 || memoryMb > 262144 || !Number.isInteger(cpus) || cpus < 1 || cpus > 128) fail("RAM/CPU ngoai khoang cho phep (RAM 1024-262144 MiB, CPU 1-128)");

const TUNNEL = /^https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com$/;
const apiTunnel = existsSync(`${DEMO}\\public-api-url.txt`) ? readFileSync(`${DEMO}\\public-api-url.txt`, "utf8").trim() : "";
if (!TUNNEL.test(apiTunnel)) fail("chua co tunnel API (public-api-url.txt): chay start-demo.ps1 -Chain fuji -Guest wsl -Agent app -Tunnel -NewEnrollment truoc");
const cf = `${DEMO}\\bin\\cloudflared.exe`;
if (!existsSync(cf)) fail("thieu cloudflared (scripts\\public\\get-cloudflared.ps1)");

/** Chay mot hanh dong co dinh cua cpm-guest.sh trong guest, dua `input` vao stdin dung nguyen byte. */
function guest(action, input = "", args = []) {
  const r = spawnSync("wsl.exe", ["-d", distro, "--cd", "~", "--exec", "bash", ".cpm-host/cpm-guest.sh", action, ...args], { input, encoding: "utf8", env: { ...process.env, WSL_UTF8: "1" }, timeout: 120_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/\0/g, "");
  return { code: r.status, out };
}

step("Kiem tra guest (chi doc)");
const probe = guest("probe").out;
if (!/^agent_installed=1/m.test(probe) || !/^docker_daemon=1/m.test(probe) || !/^image_present=1/m.test(probe)) fail("guest chua du agent/Docker/image Selkies: lam buoc 'Thiet lap & chay may' trong app mot lan");

/**
 * start-all KHONG tu cai agent: neu guest dang giu ban cu (chua biet bao offline khi dung nen may van hien online sau khi chu may thoat),
 * no se chay mai. Cap nhat khi khac ban vua dong goi (npm run bundle). Loi o buoc nay chi canh bao, khong chan viec bat he thong.
 */
function updateAgentIfStale() {
  const bundle = path.join(here, "..", "..", "host-agent", "dist", "cpm-host-agent.cjs");
  if (!existsSync(bundle) || !existsSync(`${bundle}.sha256`)) return step("CANH BAO: chua co host-agent/dist (npm run bundle -w @cpm/host-agent): giu agent dang co trong guest");
  const want = readFileSync(`${bundle}.sha256`, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(want)) return step("CANH BAO: tep .sha256 cua agent sai dinh dang: giu agent dang co trong guest");
  const have = /^agent_sha256=([0-9a-f]{64})$/m.exec(probe)?.[1];
  if (have === want) return step("Agent trong guest da la ban moi nhat");
  step(`Cap nhat agent trong guest (${have ? have.slice(0, 8) : "chua ro"} -> ${want.slice(0, 8)})`);
  const r = guest("install-agent", readFileSync(bundle), [want]);
  step(/install_done=1/.test(r.out) ? "Da cap nhat agent trong guest" : "CANH BAO: cap nhat agent that bai, giu ban cu (may se khong tu bao offline khi dung)");
}
updateAgentIfStale();

/** Ghi danh thiet bi bang ma trong enroll-token.txt (qua stdin, khong in ra, xoa tep sau khi dung); khong co ma thi dung ghi danh san co. */
function enrollGuest() {
  const tokenFile = `${DEMO}\\enroll-token.txt`;
  if (existsSync(tokenFile)) {
    step("Ghi danh thiet bi (ma khong duoc in ra)");
    const token = readFileSync(tokenFile, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) fail("ma ghi danh sai dinh dang");
    const e = guest("enroll", `${token}\n`);
    if (!/enroll_done=1/.test(e.out)) fail("ghi danh that bai (ma het han sau 15 phut hoac da dung? chay lai start-all.ps1 de cap ma moi)");
    unlinkSync(tokenFile);
  } else {
    step("Khong co ma ghi danh moi: dung ghi danh san co cua guest");
    if (!/^enrolled=1/m.test(probe)) fail("guest chua ghi danh va khong co ma: chay lai start-all.ps1");
  }
}

if (ENROLL_ONLY) {
  step("Che do --enroll-only: cau hinh toi thieu + ghi danh; KHONG bat agent hay tunnel gateway (app se lam khi bam Bat dau nhan thue)");
  const minimal = [`AGENT_API_BASE=${apiTunnel}/api`, "AGENT_INTERVAL_MS=3000", "GATEWAY_PUBLIC_URL=http://127.0.0.1:18095", "GATEWAY_PORT=18095", "GATEWAY_BIND=127.0.0.1", "GATEWAY_ALLOWED_ORIGINS=http://127.0.0.1:18095", "GATEWAY_FRAME_ANCESTORS=http://tauri.localhost", `GUEST_DOCKER_MEMORY_MB=${memoryMb}`, `GUEST_DOCKER_CPUS=${cpus}`].join("\n") + "\n";
  if (!/configure_done=1/.test(guest("configure", minimal).out)) fail("configure that bai");
  enrollGuest();
  step("Guest da cau hinh va ghi danh. Trong app chi con: Cho thue may > Bat dau nhan thue.");
  process.exit(0);
}

step("Mo tunnel cho gateway (chi ket noi RA)");
const tlog = `${DEMO}\\logs\\gw-tunnel.log`;
const tfd = openSync(tlog, "w");
// --protocol http2 (TCP): nhieu mang chan UDP/QUIC ra ngoai; mac dinh cua cloudflared (quic) khi do khong bao gio nhan duoc dia chi.
spawn(cf, ["tunnel", "--url", "http://127.0.0.1:18095", "--no-autoupdate", "--protocol", "http2"], { detached: true, stdio: ["ignore", tfd, tfd], windowsHide: true }).unref();
let gw = "";
for (let i = 0; i < 40 && !gw; i++) {
  await sleep(2000);
  const m = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(readFileSync(tlog, "utf8"));
  if (m && TUNNEL.test(m[0])) gw = m[0];
}
if (!gw) fail(`khong lay duoc dia chi tunnel gateway (xem ${tlog})`);
step(`Tunnel gateway: ${gw}`);

step("Ghi cau hinh agent trong guest");
const config = [
  `AGENT_API_BASE=${apiTunnel}/api`, "AGENT_INTERVAL_MS=3000",
  `GATEWAY_PUBLIC_URL=${gw}`, "GATEWAY_PORT=18095", "GATEWAY_BIND=127.0.0.1", `GATEWAY_ALLOWED_ORIGINS=${gw}`, "GATEWAY_FRAME_ANCESTORS=http://tauri.localhost",
  `GUEST_DOCKER_MEMORY_MB=${memoryMb}`, `GUEST_DOCKER_CPUS=${cpus}`,
].join("\n") + "\n";
if (!/configure_done=1/.test(guest("configure", config).out)) fail("configure that bai");

enrollGuest();

step("Chay agent nen");
spawn(process.execPath, [path.join(here, "hold-agent.mjs"), distro, `${DEMO}\\logs\\agent-wsl.log`], { detached: true, stdio: "ignore", windowsHide: true }).unref();

const code = async (u) => { try { return (await fetch(u, { signal: AbortSignal.timeout(15_000) })).status; } catch { return 0; } };
let local = 0, pub = 0;
for (let i = 0; i < 45 && !(local === 401 && pub === 401); i++) { await sleep(2000); local = await code("http://127.0.0.1:18095/"); pub = await code(`${gw}/`); }
if (local !== 401) fail(`gateway cuc bo khong tra 401 (nhan ${local}); xem ${DEMO}\\logs\\agent-wsl.log`);
if (pub !== 401) fail(`gateway qua tunnel khong tra 401 (nhan ${pub}); tunnel co the chua san sang, thu lai sau it phut`);
step("Host san sang: gateway cuc bo va qua tunnel deu tu choi khi khong co token (401)");
console.log(`\nLIEN KET KET NOI (gui cho nguoi dung; bam trong trinh duyet de mo app): ${apiTunnel}/api/connect`);
console.log(`MA KET NOI (neu lien ket khong mo duoc app: Cai dat > Ket noi may chu): ${apiTunnel}`);
console.log("Giu may bat (khong de ngu). Dung tat ca: powershell -File scripts\\vm\\stop-demo.ps1 -KeepVm");

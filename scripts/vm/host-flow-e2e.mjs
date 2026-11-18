#!/usr/bin/env node
/**
 * E2E QUA GIAO DIỆN của luồng HOST trong app Tauri ĐÃ CÀI (hồ sơ WebView2 riêng), guest = VM Linux thử (backend ssh-dev, KHÔNG PHẢI WSL):
 *   chuẩn bị (guest sạch + mã ghi danh mới) → đăng nhập host → Thiết lập & chạy máy → cài agent → ghi danh → Bắt đầu nhận thuê → heartbeat ok
 *   → [cửa sổ người thuê (hồ sơ riêng) chạy app-session-e2e.mjs trong khi cửa sổ host vẫn mở; host thấy phiên diễn ra]
 *   → Dừng nhận thuê (cắt phiên, xoá container) → bắt đầu lại → TẮT CỨNG app (taskkill /F, không /T) → agent trong guest tự dừng và dọn.
 * Cần đang chạy: scripts\vm\start-demo.ps1 (chuỗi, API, worker, VM) — KHÔNG cần -Agent script (script này tự dừng agent trong guest trước).
 * Ghi vào Supabase dev: thu hồi + cấp enrollment mới (device_enrollments, audit), heartbeat, các booking/giao dịch của phiên người thuê.
 * Không in token/mật khẩu/khoá. Mã ghi danh đi từ tệp ra ô nhập của app rồi vào guest qua stdin.
 * Chạy:  node scripts/vm/host-flow-e2e.mjs <exe app> <state.json> <thư mục ảnh> [--no-renter]
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const [exe, stateFile, OUT, ...flags] = process.argv.slice(2);
if (!exe || !stateFile || !OUT) throw new Error("Dùng: <exe app> <state.json> <thư mục ảnh> [--no-renter]");
const NO_RENTER = flags.includes("--no-renter");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const parse = (f) => existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")])) : {};
const smoke = parse(path.join(root, "desktop/.env.smoke.local"));
const backendFile = path.join(process.env.APPDATA, "dev.cloudpc.companion", "host-backend.json");
const backend = JSON.parse(readFileSync(backendFile, "utf8").replace(/^\uFEFF/, ""));
if (backend.kind !== "ssh-dev") throw new Error("Script này dùng guest VM thử (ssh-dev); chạy start-demo.ps1 -Guest vm trước.");
const TOKEN_FILE = "C:/cpm-demo/enroll-token.txt";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const info = (m) => console.log(`INFO  ${m}`);
const T0 = Date.now(); const el = () => `${Math.round((Date.now() - T0) / 1000)}s`;

/* ---------------- guest (ssh tới VM thử) ---------------- */
const SSH = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "OpenSSH", "ssh.exe");
const sshArgs = (remote) => ["-i", backend.keyFile, "-p", String(backend.port ?? 22), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${backend.knownHostsFile}`, "-o", "ConnectTimeout=20", backend.target, remote];
const inGuest = (remote, input) => spawnSync(SSH, sshArgs(remote), { input: input ?? "", encoding: "utf8", windowsHide: true, timeout: 120_000 });
const SCRIPT = readFileSync(path.join(root, "host-agent/guest/cpm-guest.sh"));
const probe = () => {
  const r = spawnSync(SSH, sshArgs("bash -s -- probe http://10.0.2.2:3000/api"), { input: SCRIPT, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  return Object.fromEntries(r.stdout.split(/\r?\n/).map((l) => /^([a-z_0-9]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
};
const guestScript = (args) => spawnSync(SSH, sshArgs(`bash -s -- ${args}`), { input: SCRIPT, encoding: "utf8", windowsHide: true, timeout: 200_000 });

/* ---------------- cửa sổ app qua CDP ---------------- */
class AppWin {
  constructor(role, port, profile) { this.role = role; this.port = port; this.profile = profile; this.pending = new Map(); this.id = 0; this.errors = []; }
  async launch() {
    mkdirSync(this.profile, { recursive: true });
    this.proc = spawn(exe, [], { env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: this.profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${this.port}` }, stdio: "ignore" });
    let wsUrl;
    for (let i = 0; i < 80 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${this.port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* chưa sẵn sàng */ } if (!wsUrl) await sleep(400); }
    if (!wsUrl) throw new Error(`${this.role}: không có trang WebView2`);
    this.ws = new WebSocket(wsUrl); await new Promise((r) => this.ws.on("open", r));
    this.ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
      else if (m.method === "Runtime.exceptionThrown") this.errors.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200));
    });
    await this.send("Page.enable"); await this.send("Runtime.enable");
  }
  send(method, params = {}) { return new Promise((res, rej) => { const i = ++this.id; this.pending.set(i, { res, rej }); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async ev(expr) { const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("evaluate: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)); return r.result.value; }
  text() { return this.ev("document.body.innerText"); }
  async shot(n) { const r = await this.send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(OUT, `${n}.png`), Buffer.from(r.data, "base64")); }
  async waitFor(pred, what, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await this.ev(pred)) return true; } catch { /* đang chuyển trang */ } await sleep(300); } throw new Error(`${this.role}: hết thời gian chờ ${what}`); }
  waitText(t, ms) { return this.waitFor(`document.body.innerText.includes(${JSON.stringify(t)})`, `chữ "${t}"`, ms); }
  clickText(t, sel = "button, a, [role=button]") { return this.ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.innerText.trim().includes(${JSON.stringify(t)}) && !e.disabled); if (!el) return false; el.click(); return true; })()`); }
  fill(id, value) { return this.ev(`(() => { const el = document.getElementById(${JSON.stringify(id)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`); }
  async go(hash) { await this.ev(`location.hash = ${JSON.stringify(hash)}`); await sleep(400); await this.waitFor('!document.body.innerText.includes("Đang tải màn hình")', "tải mã màn hình", 25000); }
  /** tree=true: kết thúc cả cây tiến trình (/F /T). tree=false: chỉ app (/F). graceful=true: gửi WM_CLOSE (không /F) để app tự thoát. */
  kill(tree = true, graceful = false) {
    try { this.ws?.close(); } catch { /* đã đóng */ }
    const args = graceful ? ["/PID", String(this.proc.pid)] : tree ? ["/F", "/T", "/PID", String(this.proc.pid)] : ["/F", "/PID", String(this.proc.pid)];
    spawn("taskkill", args, { stdio: "ignore" });
  }
}
const steps = (w) => w.ev(`JSON.stringify([...document.querySelectorAll('[data-testid="host-steps"] [data-step]')].map((e) => ({ id: e.dataset.step, status: e.dataset.status })))`).then((j) => JSON.parse(j));

const host = new AppWin("host", 9800 + Math.floor(Math.random() * 100), path.join(os.tmpdir(), "cpm-e2e-webview-host"));
let renterProc = null;
try {
  /* ---- 0. Chuẩn bị: guest sạch + mã ghi danh mới ---- */
  rmSync(host.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  // Hồ sơ người thuê cũng làm mới để lượt này đi đường ĐĂNG NHẬP MỚI (đường khôi phục phiên đã được kiểm ở vòng mở lại app của cửa sổ host).
  try { rmSync(path.join(os.tmpdir(), "cpm-e2e-webview-renter"), { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch { info("không xoá được hồ sơ người thuê cũ (WebView2 còn giữ); dùng lại hồ sơ đó"); }
  info("dừng agent cũ trong guest (nếu có) và xoá dấu vết ghi danh/cấu hình để đi đủ các bước thiết lập từ đầu");
  guestScript("stop");
  const wipe = inGuest("bash .cpm-host/cpm-guest.sh cleanup; rm -f .cpm-host/data/credential.json .cpm-host/data/counter.json .cpm-host/agent.env .cpm-host/cpm-host-agent.cjs");
  const p0 = probe();
  check("guest sạch trước khi thử: chưa cài agent, chưa ghi danh, không còn container", p0.agent_installed === "0" && p0.enrolled === "0" && p0.container === "missing", `agent_installed=${p0.agent_installed} enrolled=${p0.enrolled} container=${p0.container}`);
  // Kết nối tới Supabase từ máy dev đứt thoáng qua (đã ghi nhận nhiều lần): thử lại tối đa 3 lần, báo cả số lần thử.
  let iss, tries = 0;
  do { tries++; iss = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/vm/issue-enrollment.mts", stateFile, TOKEN_FILE], { cwd: root, encoding: "utf8", timeout: 180_000, windowsHide: true }); if (iss.status !== 0 && tries < 3) await sleep(5000 * tries); } while (iss.status !== 0 && tries < 3);
  check("admin cấp mã ghi danh mới (thu hồi thiết bị cũ)", iss.status === 0 && existsSync(TOKEN_FILE), iss.status === 0 ? `thử ${tries} lần` : String(iss.stderr || iss.stdout).trim().split(/\r?\n/).slice(-3).join(" | ").slice(-260));
  const token = readFileSync(TOKEN_FILE, "utf8").trim();

  /* ---- 1. Mở app (hồ sơ riêng), đăng nhập host ---- */
  await host.launch();
  const ebweb = existsSync(host.profile) && readdirSync(host.profile).some((n) => /EBWebView/i.test(n));
  check("cửa sổ host dùng hồ sơ WebView2 RIÊNG (thư mục do script chỉ định có dữ liệu WebView2)", ebweb, host.profile);
  await host.ev(`location.hash = "#/welcome"`); await host.waitText("Chào mừng", 30000);
  await host.go("#/login");
  await host.waitFor('!!document.getElementById("email")', "form đăng nhập");
  await host.fill("email", smoke.SMOKE_HOST_EMAIL); await host.fill("pw", smoke.SMOKE_HOST_PASSWORD);
  await host.clickText("Đăng nhập", "button[type=submit]");
  await host.waitFor('location.hash.includes("choose-mode")', "chọn chế độ", 40000);
  await host.waitText("Bạn muốn làm gì trước", 30000);
  await host.clickText("Cho thuê máy", "button");
  await host.waitFor('location.hash.includes("/host")', "vào chế độ Cho thuê", 30000);
  check("đăng nhập host (Supabase thật) trong app đã cài", true, `[${el()}]`);
  const banner = await host.ev('document.querySelector("[data-testid=env-banner]")?.innerText ?? ""');
  check("banner đầu trang nói rõ bản demo / ví giả lập / chuỗi cục bộ / không phải Fuji", /VÍ GIẢ LẬP/.test(banner) && /không phải Fuji/.test(banner), banner.slice(0, 140));

  /* ---- 2. Thiết lập & chạy máy ---- */
  await host.go("#/host/setup");
  await host.waitFor('!!document.querySelector("[data-testid=host-steps]")', "danh sách bước", 60000);
  await host.waitFor('[...document.querySelectorAll("[data-testid=host-steps] [data-step]")].length >= 8', "đủ các bước", 60000);
  const sawProbing = await host.ev('document.querySelector("[data-testid=host-steps]")?.dataset.probing === "1"');
  await host.waitFor('document.querySelector("[data-testid=host-steps]")?.dataset.probing === "0"', "kiểm tra guest xong", 180000);
  info(sawProbing ? "đã thấy chỉ báo 'Đang kiểm tra guest' trong lúc chờ" : "kiểm tra guest xong trước khi script kịp đọc chỉ báo (không phải lỗi)");
  const s0 = await steps(host);
  await host.shot("host-1-thiet-lap-dau");
  const st = Object.fromEntries(s0.map((s) => [s.id, s.status]));
  info("các bước ban đầu: " + s0.map((s) => `${s.id}:${s.status}`).join(" "));
  check("máy này CHƯA cài WSL ⇒ bước WSL chỉ là thông tin (backend VM thử) và app BÁO đúng; không có nút tự cài WSL", st.wsl === "info" && !(await host.ev('[...document.querySelectorAll("button")].some((b) => /cài wsl/i.test(b.innerText))')), `wsl=${st.wsl}`);
  const wslText = await host.ev('document.querySelector("[data-step=wsl]").innerText');
  check("bước WSL nêu lệnh cài cần quyền quản trị + khởi động lại (hướng dẫn, không tự làm)", /wsl --install --no-distribution/.test(wslText) && /quản trị/.test(wslText) && /khởi động lại/.test(wslText), "");
  check("kết nối được guest và nhận ra thành phần (Docker, Node, image) đã có", st.connect === "ok" && st.packages === "ok" && st.image === "ok", `connect=${st.connect} packages=${st.packages} image=${st.image}`);
  check("agent chưa cài ⇒ bước 'Agent' cần làm trong app; các bước sau bị chặn", st.agent === "action" && st.network === "blocked" && st.enroll === "blocked" && st.run === "blocked", `agent=${st.agent} network=${st.network} enroll=${st.enroll} run=${st.run}`);
  const gpuText = await host.ev('document.body.innerText');
  check("giới hạn được nói thẳng: chưa kiểm GPU trong WSL2, chưa đo FPS, app phải mở", /GPU trong WSL2 CHƯA được kiểm chứng|mã hoá hình ảnh bằng GPU trong WSL2/.test(gpuText) && /chưa có chạy nền/.test(gpuText));

  // 2a. Cài agent
  check("bấm 'Cài/cập nhật agent trong guest'", await host.clickText("Cài/cập nhật agent trong guest"));
  await host.waitText("Đã cài agent vào guest và ghi cấu hình", 120000);
  const p1 = probe();
  check("agent + cấu hình nằm trong guest, đúng bản đi kèm app (checksum)", p1.agent_installed === "1" && p1.configured === "1" && /^[0-9a-f]{64}$/.test(p1.agent_sha256), `sha=${(p1.agent_sha256 ?? "").slice(0, 12)}`);
  // 2b. Ghi danh
  await host.waitFor('!!document.getElementById("hs-token")', "ô nhập mã ghi danh", 60000);
  check("ô mã ghi danh là kiểu mật khẩu (không hiện mã)", (await host.ev('document.getElementById("hs-token").type')) === "password");
  await host.fill("hs-token", token);
  await host.clickText("Ghi danh", "button[type=submit]");
  await host.waitText("Đã ghi danh", 120000);
  const p2 = probe();
  check("ghi danh: credential nằm TRONG guest; app không hiển thị mã/credential", p2.enrolled === "1" && /^[0-9a-f-]{36}$/.test(p2.machine_id ?? "") && !(await host.text()).includes(token), `machine=${(p2.machine_id ?? "").slice(0, 8)}…`);
  await host.shot("host-2-da-ghi-danh");

  /* ---- 3. Bắt đầu nhận thuê ---- */
  await host.waitFor('[...document.querySelectorAll("button")].some((b) => b.innerText.includes("Bắt đầu nhận thuê") && !b.disabled)', "nút Bắt đầu nhận thuê", 60000);
  await host.clickText("Bắt đầu nhận thuê");
  await host.waitText("Đang khởi động agent", 30000);
  await host.waitFor('document.querySelector("[data-testid=host-health]")?.dataset.health === "ok"', "heartbeat ok do MÁY CHỦ ghi nhận", 300000);
  const p3 = probe();
  check("bắt đầu nhận thuê: agent chạy trong guest, container khách mới tạo & healthy, máy chủ nhận heartbeat (ok)", p3.agent_running === "1" && p3.container === "running", `agent_running=${p3.agent_running} container=${p3.container}/${p3.container_health} [${el()}]`);
  const gw = await fetch("http://127.0.0.1:18095/").then((r) => r.status, () => 0);
  check("gateway của host trả 401 khi không có quyền xem (qua cổng chuyển tiếp của Windows)", gw === 401, `HTTP ${gw}`);
  await host.shot("host-3-dang-nhan-thue");
  const logText = await host.ev('document.querySelector("[data-testid=host-run]")?.innerText ?? ""');
  check("nhật ký agent hiện trong app và không chứa mã/credential", /gateway lắng nghe/.test(logText) && !logText.includes(token));
  // Panel "Nhận thuê" không được hiện thông tin guest CŨ: sau khi bắt đầu, "Môi trường khách" phải tự chuyển sang container đang chạy.
  const guestLine = () => host.ev('(() => { const r = document.querySelector("[data-testid=host-run]"); if (!r) return ""; const dt = [...r.querySelectorAll("dt")].find((e) => e.innerText.includes("Môi trường khách")); return dt ? dt.nextElementSibling.innerText : ""; })()');
  let gl = "";
  for (let i = 0; i < 20; i++) { gl = await guestLine(); if (/container running/.test(gl)) break; await sleep(5000); }
  check("panel Nhận thuê tự làm mới: 'Môi trường khách' hiện container đang chạy (không kẹt ở kết quả kiểm tra cũ)", /container running/.test(gl), gl);

  /* ---- 4. Người thuê (cửa sổ riêng) dùng máy trong khi host vẫn mở ---- */
  if (!NO_RENTER) {
    const renterShots = path.join(OUT, "renter");
    renterProc = spawn(process.execPath, ["scripts/vm/app-session-e2e.mjs", stateFile, renterShots], { cwd: root, env: { ...process.env, CHECK_TAURI_EXE: exe, WEBVIEW2_USER_DATA_FOLDER: path.join(os.tmpdir(), "cpm-e2e-webview-renter") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let renterOut = ""; renterProc.stdout.on("data", (d) => { renterOut += d; }); renterProc.stderr.on("data", (d) => { renterOut += d; });
    const renterDone = new Promise((r) => renterProc.on("close", (c) => r(c)));
    const seen = new Set(); let usedShot = false;
    let code = null; renterDone.then((c) => { code = c; });
    while (code === null) {
      const labels = await host.ev('JSON.stringify([...document.querySelectorAll("[data-testid=host-sessions] li p.font-semibold")].map((e) => e.innerText))').then((j) => JSON.parse(j)).catch(() => []);
      for (const l of labels.slice(0, 1)) { if (!seen.has(l)) { seen.add(l); info(`[${el()}] cửa sổ host thấy: ${l}`); } if (l === "Khách đang dùng máy" && !usedShot) { usedShot = true; await host.shot("host-4-khach-dang-dung"); } }
      await sleep(2500);
    }
    const lines = renterOut.split(/\r?\n/).filter((l) => /^(PASS|FAIL|\d+\/\d+ đạt)/.test(l));
    info("cửa sổ người thuê:\n      " + lines.join("\n      "));
    check("phiên thuê trọn vẹn của người thuê (app đã cài, hồ sơ riêng) đạt toàn bộ", code === 0, lines.find((l) => /đạt/.test(l)) ?? `mã ${code}`);
    check("cửa sổ host thấy khách đang dùng máy và sau đó phiên hoàn tất + máy dọn sạch", seen.has("Khách đang dùng máy") && [...seen].some((l) => l.startsWith("Hoàn tất")), [...seen].join(" → ").slice(0, 400));
    await sleep(3000);
    await host.shot("host-5-sau-phien");
  }

  /* ---- 5. Dừng nhận thuê trong app ---- */
  await host.clickText("Dừng nhận thuê");
  await host.waitText("Dừng ngay?", 15000);
  await host.clickText("Dừng và dọn guest");
  await host.waitText("Đã dừng nhận thuê", 200000);
  const p4 = probe();
  check("dừng nhận thuê: agent đã thoát, container khách bị xoá", p4.agent_running === "0" && p4.container === "missing", `agent_running=${p4.agent_running} container=${p4.container}`);
  await host.shot("host-6-da-dung");

  /* ---- 6. Tắt cứng app (không /T): agent trong guest phải tự dừng ---- */
  await host.waitFor('[...document.querySelectorAll("button")].some((b) => b.innerText.includes("Bắt đầu nhận thuê") && !b.disabled)', "nút Bắt đầu nhận thuê (lần hai)", 60000);
  await host.clickText("Bắt đầu nhận thuê");
  // Heartbeat "ok" ngay sau khi bấm có thể là của agent CŨ (máy chủ còn nhớ heartbeat trong 30 giây). Chờ bằng chứng từ guest: agent mới chạy VÀ container mới tồn tại.
  let p5 = {};
  for (let i = 0; i < 60; i++) { await sleep(5000); p5 = probe(); if (p5.agent_running === "1" && p5.container === "running") break; }
  await host.waitFor('document.querySelector("[data-testid=host-health]")?.dataset.health === "ok"', "heartbeat ok lần hai", 300000);
  check("bắt đầu lại sau khi dừng: agent chạy, container MỚI được tạo, máy chủ nhận heartbeat", p5.agent_running === "1" && p5.container === "running", `agent_running=${p5.agent_running} container=${p5.container}/${p5.container_health} [${el()}]`);
  host.kill(false); // chỉ app, không /T: RunEvent::Exit không chạy; chỉ cơ chế "stdin đóng ⇒ agent dừng" còn lại
  info("đã tắt cứng app (taskkill /F, không /T); chờ agent trong guest tự dừng…");
  let p6 = {};
  // Thứ tự đọc của probe là container rồi mới tới agent: bắt đúng lúc agent đang xoá container sẽ thấy "removing". Chờ tới khi CẢ HAI ổn định.
  for (let i = 0; i < 24; i++) { await sleep(5000); p6 = probe(); if (p6.agent_running === "0" && p6.container === "missing") break; }
  check("tắt cứng app ⇒ agent trong guest tự dừng và dọn guest (đúng lời hứa 'đóng app là dừng nhận thuê')", p6.agent_running === "0" && p6.container === "missing", `agent_running=${p6.agent_running} container=${p6.container} [${el()}]`);
  check("không có lỗi JavaScript trong cửa sổ host", host.errors.length === 0, host.errors.slice(0, 2).join(" | "));

  /* ---- 7. Đóng app ÊM (WM_CLOSE → RunEvent::Exit): app dừng agent tường minh, không chỉ dựa vào EOF của stdin ---- */
  await sleep(6000); // để WebView2 của lần chạy trước nhả hồ sơ
  const host2 = new AppWin("host2", 9900 + Math.floor(Math.random() * 90), host.profile); // cùng hồ sơ: phiên đăng nhập được khôi phục
  await host2.launch();
  await host2.waitFor('!document.body.innerText.includes("Đang khôi phục phiên đăng nhập")', "khôi phục phiên", 60000).catch(() => undefined);
  // Mở lại app (URL không hash, như mở từ Start Menu) với phiên đã lưu: phải vào thẳng trang chủ chế độ Cho thuê, không kẹt ở Welcome như chưa đăng nhập.
  const landed = await host2.waitFor('location.hash.startsWith("#/host")', "tới trang chủ chế độ Cho thuê", 60000).then(() => true, () => false);
  check("mở lại app (không hash) với phiên đã lưu ⇒ vào thẳng trang chủ chế độ Cho thuê, không kẹt ở Welcome", landed, "hash=" + (await host2.ev("location.hash")));
  await host2.go("#/host/setup");
  await host2.waitFor('document.querySelector("[data-testid=host-steps]")?.dataset.probing === "0"', "kiểm tra guest xong (lần ba)", 180000);
  await host2.waitFor('[...document.querySelectorAll("button")].some((b) => b.innerText.includes("Bắt đầu nhận thuê") && !b.disabled)', "nút Bắt đầu nhận thuê (lần ba)", 90000);
  await host2.clickText("Bắt đầu nhận thuê");
  let p7 = {};
  for (let i = 0; i < 60; i++) { await sleep(5000); p7 = probe(); if (p7.agent_running === "1" && p7.container === "running") break; }
  check("lần ba: agent chạy lại với phiên đăng nhập khôi phục từ hồ sơ", p7.agent_running === "1" && p7.container === "running", `agent_running=${p7.agent_running} container=${p7.container}`);
  host2.kill(false, true); // đóng êm: taskkill không /F
  const tClose = Date.now();
  let p8 = {};
  for (let i = 0; i < 30; i++) { await sleep(5000); p8 = probe(); if (p8.agent_running === "0" && p8.container === "missing") break; }
  check("đóng app êm ⇒ agent dừng và guest được dọn", p8.agent_running === "0" && p8.container === "missing", `agent_running=${p8.agent_running} container=${p8.container}; sau ${Math.round((Date.now() - tClose) / 1000)}s`);
  const stillRunning = spawnSync("tasklist", ["/FI", "IMAGENAME eq cloud-pc-companion.exe", "/NH"], { encoding: "utf8" }).stdout.includes("cloud-pc-companion.exe");
  check("tiến trình app đã thoát sau khi đóng êm (không treo)", !stillRunning);
  if (stillRunning) spawnSync("taskkill", ["/F", "/IM", "cloud-pc-companion.exe"]);
} catch (e) {
  check("kịch bản chạy hết không ngoại lệ", false, String(e.message).slice(0, 300));
  try { await host.shot("host-99-loi"); console.log("Trang lúc lỗi:", (await host.text()).slice(0, 600).replace(/\s+/g, " ")); } catch { /* bỏ qua */ }
} finally {
  try { renterProc?.kill(); } catch { /* bỏ qua */ }
  try { host.kill(true); } catch { /* bỏ qua */ }
  rmSync(TOKEN_FILE, { force: true });
  await sleep(500);
}
console.log(`\n${results.filter(Boolean).length}/${results.length} đạt, tổng ${el()}. Ảnh: ${OUT}`);
process.exit(results.every(Boolean) ? 0 : 1);

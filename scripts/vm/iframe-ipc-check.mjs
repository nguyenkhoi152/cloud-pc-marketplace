#!/usr/bin/env node
/**
 * Nội dung trong iframe viewer do GATEWAY CỦA HOST phục vụ (host là bên không tin cậy đối với người thuê). Kiểm: trang khác site
 * nhúng trong iframe của app Tauri ĐÃ CÀI có gọi được các lệnh native `host_*` không? KỲ VỌNG: KHÔNG.
 *   - Đối chứng dương: trang chính của app (tauri.localhost) gọi được `host_overview` (nếu không thì phép thử vô nghĩa).
 *   - Phép thử: một trang cục bộ khác origin (127.0.0.1:<cổng>) nhúng bằng ĐÚNG thuộc tính sandbox/allow của viewer, thử
 *     `__TAURI_INTERNALS__.invoke("host_overview"|"host_probe")` và `__TAURI__.core.invoke(...)`, báo kết quả lên trang cha qua postMessage.
 * Không chạm Supabase/chuỗi/guest: `host_overview` chỉ chạy `wsl.exe --status` v.v. (chỉ đọc); `host_probe` bị chặn trước khi chạy vì chưa chọn backend
 * hoặc chỉ đọc. Không in token/khoá.
 * Chạy:  node scripts/vm/iframe-ipc-check.mjs <exe app>
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const [exe] = process.argv.slice(2);
if (!exe) throw new Error("Dùng: <exe app>");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, name, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

const PROBE_HTML = `<!doctype html><meta charset="utf-8"><body><script>
(async () => {
  const out = { origin: location.origin, internals: typeof window.__TAURI_INTERNALS__, global: typeof window.__TAURI__, tries: {} };
  const attempt = async (name, fn) => { try { const v = await fn(); out.tries[name] = { ok: true, type: typeof v }; } catch (e) { out.tries[name] = { ok: false, err: String((e && e.message) || e).slice(0, 120) }; } };
  if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === "function") {
    for (const c of ["host_overview", "host_probe", "host_agent_stop"]) await attempt("internals:" + c, () => window.__TAURI_INTERNALS__.invoke(c));
  }
  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) await attempt("global:host_overview", () => window.__TAURI__.core.invoke("host_overview"));
  // Đường IPC thô của Tauri 2 trên Windows: http://ipc.localhost/<lệnh>
  await attempt("raw:ipc.localhost", async () => { const r = await fetch("http://ipc.localhost/host_overview", { method: "POST", headers: { "content-type": "application/json", "Tauri-Callback": "0", "Tauri-Error": "0", "Tauri-Invoke-Key": "x" }, body: "{}" }); if (!r.ok) throw new Error("HTTP " + r.status); return r.status; });
  parent.postMessage({ cpmIpcProbe: out }, "*");
})();
<\/script>`;
const server = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(PROBE_HTML); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

const profile = mkdtempSync(path.join(os.tmpdir(), "cpm-ipc-"));
mkdirSync(profile, { recursive: true });
const CDP = 9500 + Math.floor(Math.random() * 300);
const app = spawn(exe, [], { env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}` }, stdio: "ignore" });
let ws;
try {
  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* chưa sẵn sàng */ } if (!wsUrl) await sleep(500); }
  if (!wsUrl) throw new Error("không có trang WebView2");
  ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.on("open", r));
  let id = 0; const pending = new Map();
  ws.on("message", (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
  await send("Runtime.enable");
  await sleep(2500);
  check((await ev("location.origin")) === "http://tauri.localhost", "đang ở origin của app Tauri");

  // Đối chứng dương: trang chính gọi được lệnh native.
  const own = JSON.parse(await ev(`(async()=>{try{const o=await window.__TAURI__.core.invoke("host_overview");return JSON.stringify({ok:true,keys:Object.keys(o).sort()})}catch(e){return JSON.stringify({ok:false,err:String(e&&e.message||e).slice(0,120)})}})()`));
  check(own.ok && own.keys.includes("wslStatus") && own.keys.includes("agentSha256"), "đối chứng: trang chính của app gọi được host_overview (lớp native có mặt)", own.ok ? `trả ${own.keys.length} trường` : own.err);

  // Phép thử: iframe khác site, cùng thuộc tính như viewer.
  await ev(`window.__cpmProbe = null; window.addEventListener("message", (e) => { if (e.data && e.data.cpmIpcProbe) window.__cpmProbe = e.data.cpmIpcProbe; });
    (() => { const f = document.createElement("iframe"); f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-pointer-lock"); f.allow = "fullscreen; clipboard-read; clipboard-write; keyboard-map; autoplay"; f.src = "http://127.0.0.1:${PORT}/"; f.style.cssText = "position:fixed;right:0;bottom:0;width:300px;height:200px;z-index:99999"; document.body.appendChild(f); })()`);
  let probe = null;
  for (let i = 0; i < 40 && !probe; i++) { await sleep(500); probe = await ev("window.__cpmProbe"); }
  check(!!probe, "trang trong iframe khác site đã chạy và báo kết quả", probe ? `origin ${probe.origin}` : "không nhận được kết quả");
  if (probe) {
    console.log("INFO  " + JSON.stringify({ internals: probe.internals, global: probe.global, tries: probe.tries }));
    const anyOk = Object.values(probe.tries).some((t) => t.ok);
    check(!anyOk, "iframe khác site KHÔNG gọi được bất kỳ lệnh native nào (host_overview/host_probe/host_agent_stop, __TAURI__, ipc.localhost)", anyOk ? "MỘT LỆNH ĐÃ CHẠY — lỗ hổng" : `internals=${probe.internals}, global=${probe.global}`);
  }
} catch (e) {
  check(false, "kịch bản chạy hết không ngoại lệ", String(e.message).slice(0, 300));
} finally {
  try { ws?.close(); } catch { /* bỏ qua */ }
  app.kill();
  spawn("taskkill", ["/F", "/T", "/PID", String(app.pid)], { stdio: "ignore" });
  server.close();
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch { /* Windows còn giữ file */ }
}
console.log(`\n${results.filter(Boolean).length}/${results.length} đạt`);
process.exit(results.every(Boolean) ? 0 : 1);

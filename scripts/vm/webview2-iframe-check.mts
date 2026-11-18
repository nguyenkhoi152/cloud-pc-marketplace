/**
 * Kiểm viewer nhúng (iframe) trong WebView2 của app Tauri ĐÃ CÀI, gateway đứng trước Selkies thật (VM thử).
 * Mục đích: xác nhận cookie phiên của gateway có hoạt động trong iframe khác site (origin app = http://tauri.localhost).
 * Không dùng Supabase/chuỗi khối. Không in token.
 * Chạy:  npx tsx scripts/vm/webview2-iframe-check.mts <exe app> <ảnh-ra-dir> [Lax|None] [http://127.0.0.1:18080] [noframe]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { Gateway } from "../../host-agent/src/gateway";

const [exe, out, sameSiteArg = "Lax", upstream = "http://127.0.0.1:18080"] = process.argv.slice(2);
if (!exe || !out) throw new Error("Dùng: <exe> <thư mục ảnh> [Lax|None] [upstream]");
const sameSite = sameSiteArg === "None" ? "None" : "Lax";
mkdirSync(out, { recursive: true });
// Cổng gateway ngẫu nhiên mỗi lần: hồ sơ WebView2 của app lưu cache giữa các lần chạy và iframe khác site không bị lệnh tắt cache của trang chính chi phối.
const GW_PORT = 18100 + Math.floor(Math.random() * 800), GW = `http://127.0.0.1:${GW_PORT}`, CDP = 9333;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: boolean[] = [];
const check = (ok: boolean, name: string, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

// Tham số thứ 5 "noframe" tái hiện lỗi ban đầu (Selkies trả frame-ancestors 'self' nên iframe bị chặn).
const frameAncestors = process.argv[6] === "noframe" ? [] : ["http://tauri.localhost"];
console.log(`INFO  frameAncestors=${JSON.stringify(frameAncestors)} sameSite=${sameSite}`);
const gateway = new Gateway({ upstream, allowedOrigins: [GW], sameSite, frameAncestors });
await gateway.listen(GW_PORT);
const g = gateway.grant({ bookingId: "wv2", renterId: "r", endAtMs: Date.now() + 10 * 60_000, redeemTtlMs: 60_000 });
if (!g.ok) throw new Error("grant: " + g.reason);

const app = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}` }, stdio: "ignore" });
let ws: WebSocket | undefined;
try {
  let wsUrl: string | undefined;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    try { wsUrl = ((await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* chưa sẵn sàng */ }
    if (!wsUrl) await sleep(500);
  }
  if (!wsUrl) throw new Error("không có trang WebView2");
  ws = new WebSocket(wsUrl);
  await new Promise((r) => ws!.on("open", r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.on("message", (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result); pending.delete(m.id); } });
  const send = (method: string, params: object = {}) => new Promise<any>((res) => { const i = ++id; pending.set(i, res); ws!.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (e: string) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  // Hồ sơ WebView2 của app lưu cache giữa các lần chạy (cùng cổng gateway): tắt cache để không dùng lại trang/CSP cũ làm sai kết quả.
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await sleep(2500);
  check((await evalJs("location.origin")) === "http://tauri.localhost", "đang ở origin của app Tauri", String(await evalJs("location.origin")));

  // Nhúng viewer đúng như app (desktop/src/features/live/LiveScreens.tsx): cùng thuộc tính sandbox + allow, trỏ vào URL đổi token của gateway (khác site với tauri.localhost).
  await evalJs(`(()=>{const f=document.createElement('iframe');f.id='cpm-viewer';f.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-pointer-lock');f.allow='fullscreen; clipboard-read; clipboard-write; keyboard-map; autoplay';f.src=${JSON.stringify(`${GW}/__gw/redeem?t=${g.token}`)};f.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:99999;background:#000';document.body.appendChild(f)})()`);
  await sleep(25_000);
  // Page.getFrameTree không liệt kê iframe khác site (out-of-process) trong WebView2; kiểm phần tử và kích thước thật.
  const box = JSON.parse(String(await evalJs("(()=>{const f=document.getElementById('cpm-viewer');if(!f)return JSON.stringify(null);const r=f.getBoundingClientRect();return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),src:new URL(f.src).origin})})()"))) as { w: number; h: number; src: string } | null;
  check(!!box && box.w > 600 && box.h > 300, "iframe viewer hiển thị với kích thước đầy đủ (CSP frame-src của app cho phép)", box ? `${box.w}x${box.h} → ${box.src}` : "không có phần tử iframe");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(out, `webview2-${sameSite}.png`), Buffer.from(shot.data, "base64"));
  const insp = gateway.inspect("wv2");
  check(insp.state === "active", "token đã được đổi trong iframe", insp.state);
  check(insp.openConnections >= 1, "WebSocket Selkies mở qua gateway từ trong iframe WebView2", `openConnections=${insp.openConnections}`);
  console.log(`INFO  cookie SameSite=${sameSite}. Mở ảnh webview2-${sameSite}.png để xác nhận có desktop.`);
  gateway.revoke("wv2");
  await sleep(800);
  check(gateway.inspect("wv2").openConnections === 0, "revoke đóng WebSocket của iframe", `openConnections=${gateway.inspect("wv2").openConnections}`);
} catch (e) {
  check(false, "kịch bản chạy hết không ngoại lệ", String((e as Error).message).slice(0, 300));
} finally {
  try { ws?.close(); } catch { /* bỏ qua */ }
  app.kill();
  spawn("taskkill", ["/F", "/T", "/PID", String(app.pid)], { stdio: "ignore" });
  await gateway.close();
  await sleep(500);
}
console.log(`\n${results.filter(Boolean).length}/${results.length} đạt`);
process.exit(results.every(Boolean) ? 0 : 1);

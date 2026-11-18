/**
 * Kiểm gateway của host-agent đứng trước Selkies THẬT (container trong VM thử, xem scripts/vm/new-test-host-vm.ps1).
 * Không dùng Supabase, không dùng chuỗi khối: chỉ gateway + Selkies + Edge headless (CDP).
 * Chạy:  npx tsx scripts/vm/gateway-selkies-check.mts [http://127.0.0.1:18080] [thư-mục-ảnh]
 * Không in token. Ảnh chụp lưu ở thư mục chỉ định (mặc định: thư mục tạm).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { Gateway } from "../../host-agent/src/gateway";

const UPSTREAM = process.argv[2] ?? "http://127.0.0.1:18080";
const OUT = process.argv[3] ?? path.join(os.tmpdir(), "cpm-gateway-selkies");
mkdirSync(OUT, { recursive: true });
const GW_PORT = 18090;
const GW = `http://127.0.0.1:${GW_PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: boolean[] = [];
const check = (ok: boolean, name: string, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!EDGE) throw new Error("Không thấy Microsoft Edge");

const gateway = new Gateway({ upstream: UPSTREAM, allowedOrigins: [GW] });
await gateway.listen(GW_PORT, "127.0.0.1");

const profile = mkdtempSync(path.join(os.tmpdir(), "cpm-gw-"));
const port = 9600 + Math.floor(Math.random() * 300);
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions", "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
let ws: WebSocket | undefined;
try {
  // 1. Chưa có token: không vào được, không lộ gì từ upstream.
  const noTok = await fetch(`${GW}/`, { redirect: "manual" });
  check(noTok.status === 401 || noTok.status === 403, "chưa có token → gateway từ chối", `HTTP ${noTok.status}`);
  const noTokBody = await noTok.text();
  check(!/selkies/i.test(noTokBody), "phản hồi từ chối không chứa nội dung của Selkies");
  const badTok = await fetch(`${GW}/__gw/redeem?t=khong-phai-token-that`, { redirect: "manual" });
  check(badTok.status === 401, "token sai → 401", `HTTP ${badTok.status}`);

  // 2. Cấp quyền như control plane sẽ làm sau khi chuỗi xác nhận Active.
  const g = gateway.grant({ bookingId: "test-booking", renterId: "test-renter", endAtMs: Date.now() + 10 * 60_000, redeemTtlMs: 60_000 });
  if (!g.ok) throw new Error("grant thất bại: " + g.reason);

  let wsUrl: string | undefined;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try { wsUrl = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* chưa sẵn sàng */ }
    if (!wsUrl) await sleep(200);
  }
  ws = new WebSocket(wsUrl!);
  await new Promise((r) => ws!.on("open", r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const errors: string[] = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result); pending.delete(m.id); }
    else if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 160));
  });
  const send = (method: string, params: object = {}) => new Promise<any>((res) => { const i = ++id; pending.set(i, res); ws!.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (e: string) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async (name: string) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64")); };
  await send("Page.enable"); await send("Runtime.enable");

  // 3. Đổi token → cookie → xem màn hình qua gateway.
  await send("Page.navigate", { url: `${GW}/__gw/redeem?t=${g.token}` });
  await sleep(25_000);
  const page = JSON.parse((await evalJs("JSON.stringify({url:location.origin+location.pathname,title:document.title,canvas:[...document.querySelectorAll('canvas')].map(c=>c.width+'x'+c.height)})")) as string);
  await shot("1-qua-gateway.png");
  check(page.url === `${GW}/` && page.title === "Selkies", "đổi token xong, trang Selkies tải qua gateway", `title=${page.title}`);
  check(page.canvas.some((c: string) => { const [w, h] = c.split("x").map(Number); return w > 600 && h > 300; }), "có canvas video kích thước màn hình", page.canvas.join(","));
  const insp1 = gateway.inspect("test-booking");
  check(insp1.state === "active", "gateway ghi nhận phiên active", insp1.state);
  check(insp1.openConnections >= 1, "có ≥1 WebSocket đang mở qua gateway", `openConnections=${insp1.openConnections}`);

  // 4. Token chỉ đổi một lần.
  const again = await fetch(`${GW}/__gw/redeem?t=${g.token}`, { redirect: "manual" });
  check(again.status === 401, "dùng lại token đã đổi → 401", `HTTP ${again.status}`);
  // Không có cookie thì không vào được dù đúng cổng.
  const nocookie = await fetch(`${GW}/`, { redirect: "manual" });
  check(nocookie.status === 401 || nocookie.status === 403, "không có cookie phiên → từ chối", `HTTP ${nocookie.status}`);

  // 5. Thu hồi: đóng kết nối đang mở, chặn kết nối lại.
  const t0 = performance.now();
  gateway.revoke("test-booking", "revoked");
  let closedMs = -1;
  for (let i = 0; i < 40; i++) { if (gateway.inspect("test-booking").openConnections === 0) { closedMs = Math.round(performance.now() - t0); break; } await sleep(50); }
  check(closedMs >= 0 && closedMs < 1000, "sau revoke mọi WebSocket đóng < 1 giây", `${closedMs} ms`);
  await send("Page.navigate", { url: `${GW}/` });
  await sleep(4000);
  const afterTitle = String(await evalJs("document.title"));
  const afterText = String(await evalJs("document.body ? document.body.innerText.slice(0,80) : ''"));
  await shot("2-sau-revoke.png");
  check(!/^selkies$/i.test(afterTitle), "tải lại sau revoke không còn thấy Selkies", `title="${afterTitle}" text="${afterText.replace(/\s+/g, " ").slice(0, 40)}"`);
  const insp2 = gateway.inspect("test-booking");
  check(insp2.state === "revoked", "gateway ghi nhận revoked", insp2.state);
  const regrant = gateway.grant({ bookingId: "test-booking", renterId: "test-renter", endAtMs: Date.now() + 60_000, redeemTtlMs: 60_000 });
  check(!regrant.ok, "booking đã thu hồi không cấp lại được", regrant.ok ? "ĐÃ CẤP LẠI" : regrant.reason);
  check(errors.length === 0, "không có lỗi JS trong phiên", errors.slice(0, 2).join(" | "));
} catch (e) {
  check(false, "kịch bản chạy hết không ngoại lệ", String((e as Error).message).slice(0, 300));
} finally {
  try { ws?.close(); } catch { /* bỏ qua */ }
  edge.kill();
  await gateway.close();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* Windows còn giữ file */ }
}
console.log(`\n${results.filter(Boolean).length}/${results.length} đạt. Ảnh: ${OUT}`);
process.exit(results.every(Boolean) ? 0 : 1);

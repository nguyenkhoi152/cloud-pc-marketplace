#!/usr/bin/env node
/**
 * E2E QUA GIAO DIỆN APP của một phiên thuê với VÍ GIẢ LẬP (chuỗi Hardhat cục bộ — mô phỏng, không phải Fuji).
 * Cần đang chạy: Supabase dev, API (cổng 3000), worker (WORKER_PROVIDER=agent), host-agent + gateway, Selkies (VM), node Hardhat đã deploy,
 * và app (Vite dev hoặc app Tauri) được build với VITE_API_BASE_URL + VITE_DEV_WALLET_RPC=http://127.0.0.1:8545.
 * Dùng tài khoản người thuê demo (desktop/.env.smoke.local: DEMO_RENTER_*). Không in email/mật khẩu/khoá.
 * Chạy:  node scripts/vm/app-session-e2e.mjs <stateFile> <thư-mục-ảnh> [url-app mặc định http://127.0.0.1:5174]
 *        (hoặc CHECK_TAURI_EXE=<exe> để chạy trong cửa sổ WebView2 của app Tauri đã cài).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const [stateFile, OUT, urlArg] = process.argv.slice(2);
if (!stateFile || !OUT) throw new Error("Dùng: <stateFile> <thư mục ảnh> [url app]");
const TAURI_EXE = process.env.CHECK_TAURI_EXE;
const BASE = urlArg ?? (TAURI_EXE ? "http://tauri.localhost" : "http://127.0.0.1:5174");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const parse = (f) => existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")])) : {};
const smoke = parse(path.join(root, "desktop/.env.smoke.local"));
const state = JSON.parse(readFileSync(stateFile, "utf8"));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const info = (m) => console.log(`INFO  ${m}`);
const T0 = Date.now(); const el = () => `${Math.round((Date.now() - T0) / 1000)}s`;

const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const profile = mkdtempSync(path.join(os.tmpdir(), "cpm-app-"));
const port = 9400 + Math.floor(Math.random() * 400);
const proc = TAURI_EXE
  ? spawn(TAURI_EXE, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: "ignore" })
  : spawn(EDGE, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });

let ws;
const pending = new Map(); let id = 0;
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("evaluate: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)); return r.result.value; };
const text = () => ev("document.body.innerText");
const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(OUT, n + ".png"), Buffer.from(r.data, "base64")); };
const waitFor = async (pred, what, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(pred)) return true; } catch { /* trang đang chuyển */ } await sleep(250); } throw new Error("Hết thời gian chờ: " + what); };
const waitText = (t, ms) => waitFor(`document.body.innerText.includes(${JSON.stringify(t)})`, `chữ "${t}"`, ms);
const clickText = (t, sel = "button, a, [role=button]") => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.innerText.trim().includes(${JSON.stringify(t)}) && !e.disabled); if (!el) return false; el.click(); return true; })()`);
const fill = (idAttr, value) => ev(`(() => { const el = document.getElementById(${JSON.stringify(idAttr)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const go = async (hash) => { await ev(`location.hash = ${JSON.stringify(hash)}`); await sleep(400); await waitFor('!document.body.innerText.includes("Đang tải màn hình")', "tải mã màn hình", 20000); };

try {
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* chưa sẵn sàng */ } if (!wsUrl) await sleep(300); }
  ws = new WebSocket(wsUrl); await new Promise((r) => ws.on("open", r));
  const errors = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === "Runtime.exceptionThrown") errors.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200));
  });
  await send("Page.enable"); await send("Runtime.enable");
  if (!TAURI_EXE) await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: BASE + "/#/welcome" });
  // Hồ sơ mới: thấy Welcome. Hồ sơ đã có phiên đăng nhập (dùng lại giữa các lượt): app khôi phục phiên và vào thẳng trang chủ — đó là hành vi ĐÚNG.
  await waitFor('document.body.innerText.includes("Chào mừng") || location.hash.includes("rent/discover") || location.hash.includes("/host") || location.hash.includes("choose-mode")', "màn Welcome hoặc trang chủ (phiên khôi phục)", 45000);
  const restored = !(await text()).includes("Chào mừng");

  // 1. Đăng nhập người thuê demo qua giao diện
  if (!restored) {
    await go("#/login");
    await waitFor('!!document.getElementById("email")', "form đăng nhập");
    await fill("email", smoke.DEMO_RENTER_EMAIL); await fill("pw", smoke.DEMO_RENTER_PASSWORD);
    await clickText("Đăng nhập", "button[type=submit]");
    await waitFor('location.hash.includes("choose-mode")', "chọn chế độ", 30000);
    check("đăng nhập người thuê demo qua giao diện (Supabase thật)", true);
    await waitText("Bạn muốn làm gì trước", 30000);
    await clickText("Thuê máy", "button");
    await waitFor('location.hash.includes("rent/discover")', "vào Khám phá", 30000);
  } else {
    check("hồ sơ đã có phiên người thuê demo: app khôi phục phiên và vào thẳng trang chủ (không đòi đăng nhập lại)", true, "hash=" + (await ev("location.hash")));
    await go("#/rent/discover");
  }

  // 2. Ví giả lập: nhãn rõ + liên kết bằng chữ ký
  await go("#/wallet");
  await waitText("Ví đã liên kết", 20000);
  await waitFor('!document.body.innerText.includes("Đang tải")', "tải ví", 20000);
  let t = await text();
  check("màn Ví hiện nhãn VÍ GIẢ LẬP và địa chỉ ví thử", t.includes("VÍ GIẢ LẬP") && /0x[0-9a-fA-F]{40}/.test(t));
  await shot("app-1-vi");
  const walletBefore = (t.match(/0x[0-9a-fA-F]{40}/g) ?? [])[0];
  if (!(await clickText("Liên kết ví"))) throw new Error("không có nút Liên kết ví khả dụng (thiếu VITE_API_BASE_URL/VITE_DEV_WALLET_RPC?)");
  await waitText("Đã xác minh và liên kết ví", 40000);
  check("liên kết ví giả lập: ví ký challenge, server xác minh", true);
  await shot("app-2-vi-da-lien-ket");

  // 3. Giữ máy qua giao diện
  await go(`#/rent/checkout/${state.machineId}`);
  await waitText("Xác nhận giữ máy", 20000);
  let reserved = false;
  for (let i = 0; i < 40 && !reserved; i++) {
    await clickText("Giữ máy", "button");
    try { await waitFor('document.body.innerText.includes("Đã giữ máy") || document.body.innerText.includes("Không giữ được máy") || location.hash.includes("history")', "kết quả giữ máy", 20000); } catch { /* thử lại */ }
    t = await text();
    reserved = !t.includes("Không giữ được máy");
    if (!reserved) { if (i === 0) info("máy chưa giữ được (còn booking cũ?); thử lại mỗi 15 giây"); await sleep(15000); await go(`#/rent/checkout/${state.machineId}`); await waitText("Xác nhận giữ máy", 20000); }
  }
  check("giữ máy qua giao diện", reserved, `[${el()}]`);
  await go("#/rent/history");
  await waitText("Đặt chỗ của tôi", 20000);
  await waitFor('document.body.innerText.includes("reserved / not_granted")', "booking reserved", 30000);
  t = await text();
  check("Đặt chỗ: có nút 'Trả tiền PCP thử (ví giả lập)' và nhãn ví giả lập", t.includes("Trả tiền PCP thử (ví giả lập)") && t.includes("VÍ GIẢ LẬP"));
  await shot("app-3-dat-cho");

  // 4. Trả tiền bằng ví giả lập → worker/host-agent chạy phiên
  await clickText("Trả tiền PCP thử (ví giả lập)");
  await waitText("đã được đối soát", 90000);
  check("trả tiền bằng ví giả lập: approve + fund được escrow chấp nhận và đối soát", true, `[${el()}]`);
  let last = "";
  const trans = [];
  const tEnd = Date.now() + 8 * 60_000; let granted = false;
  while (Date.now() < tEnd) {
    const m = /(reserved|funded|active|settled|expired|cancelled) \/ ([a-z_]+)/.exec(await text());
    const s = m ? `${m[1]} / ${m[2]}` : "?";
    if (s !== last) { trans.push(`${el()} ${s}`); info(`[${el()}] trạng thái trong app: ${s}`); last = s; }
    if (s === "active / granted") { granted = true; break; }
    await sleep(3000);
  }
  check("app tự cập nhật trạng thái tới active / granted (worker kích hoạt trên chuỗi + host-agent cấp quyền)", granted, trans.join(" → "));
  if (!granted) throw new Error("phiên không lên active/granted");
  await shot("app-4-active");

  // 5. Mở màn hình trong khung nhúng của app
  await clickText("Mở màn hình");
  // Lệnh connect đi qua API tới DB Supabase qua Internet: đã đo 1,3–20,5 giây tuỳ lúc (log API), nên chờ rộng rãi.
  await waitFor('!!document.querySelector("iframe[title=\\"Màn hình máy thuê\\"]")', "khung viewer", 90000);
  await sleep(45000);
  const fr = await ev(`(() => { const f = document.querySelector("iframe[title=\\"Màn hình máy thuê\\"]"); if (!f) return null; const r = f.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), origin: new URL(f.src).origin }; })()`);
  await shot("app-5-man-hinh");
  // Kích thước khung KHÔNG chứng minh có hình, và dung lượng ảnh cũng không (logo nền > 8 KB). Desktop Selkies trong container này có hình nền
  // là logo hải cẩu trên nền đen và thanh tác vụ LXQt (Firefox/Chrome/terminal/file manager) ở ĐÁY khung; nên đo dải đáy khung: có biểu tượng
  // (điểm sáng) thì luồng desktop đang chạy; đen thuần/chưa kết nối thì không. Chụp cả viewport rồi đo đúng vùng đáy của khung (toạ độ viewport × DPR).
  const scanViewer = async () => {
    await ev('document.querySelector("iframe[title=\\"Màn hình máy thuê\\"]")?.scrollIntoView({ block: "center" })');
    await sleep(800);
    const r = await ev('(() => { const f = document.querySelector("iframe[title=\\"Màn hình máy thuê\\"]"); if (!f) return null; const b = f.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, dpr: window.devicePixelRatio }; })()');
    if (!r || r.w < 100) return { data: null, taskbar: 0 };
    const s = await send("Page.captureScreenshot", { format: "png" });
    const stripH = Math.round(40 * r.dpr), x0 = Math.max(0, Math.round(r.x * r.dpr)), w = Math.round(r.w * r.dpr), y0 = Math.max(0, Math.round((r.y + r.h) * r.dpr) - stripH);
    const taskbar = await ev('new Promise((res) => { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); const w = Math.min(' + w + ', i.width - ' + x0 + '), h = Math.min(' + stripH + ', i.height - ' + y0 + '); if (w <= 0 || h <= 0) return res(-1); const px = g.getImageData(' + x0 + ', ' + y0 + ', w, h).data; let lit = 0; for (let p = 0; p < px.length; p += 4) { if (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2] > 40) lit++; } res(lit / (px.length / 4)); }; i.onerror = () => res(-1); i.src = "data:image/png;base64,' + s.data + '"; })');
    return { data: s.data, taskbar };
  };
  let vb = await scanViewer(); const tView = Date.now();
  for (let i = 0; i < 30 && vb.taskbar < 0.02; i++) { await sleep(10000); vb = await scanViewer(); }
  if (vb.data) writeFileSync(path.join(OUT, "app-5b-viewer.png"), Buffer.from(vb.data, "base64"));
  check("viewer hiển thị DESKTOP đang stream (dải đáy khung có thanh tác vụ LXQt: ≥ 2% điểm sáng)", vb.taskbar >= 0.02, "điểm sáng ở dải đáy " + (vb.taskbar * 100).toFixed(1) + "%, chờ " + Math.round((Date.now() - tView) / 1000) + "s sau khi mở [" + el() + "]" + (vb.taskbar < 0.02 ? " — chưa thấy thanh tác vụ (khung đen/chưa kết nối)" : ""));
  check("viewer nhúng trong app hiển thị khung màn hình qua gateway", !!fr && fr.w > 400 && fr.h > 300, fr ? `${fr.w}x${fr.h} → ${fr.origin}` : "không có iframe");

  // 6. Kết thúc qua giao diện → thanh toán, thu hồi, reset, nhả máy
  await clickText("Kết thúc sớm (vẫn trả cả gói)");
  await waitText("Kết thúc: giao dịch", 90000);
  check("kết thúc qua giao diện: accept được chấp nhận và đối soát (Settled)", true, `[${el()}]`);
  const end2 = Date.now() + 10 * 60_000; let done = false; last = "";
  while (Date.now() < end2) {
    const m = /(settled|expired|cancelled|active|funded) \/ ([a-z_]+)/.exec(await text());
    const s = m ? `${m[1]} / ${m[2]}` : "?";
    if (s !== last) { info(`[${el()}] trạng thái trong app: ${s}`); last = s; }
    if (s === "settled / reset_verified") { done = true; break; }
    await sleep(3000);
  }
  check("app hiển thị settled / reset_verified (đã thu hồi, reset guest, nhả máy)", done, `[${el()}]`);
  await shot("app-6-ket-thuc");
  check("không có lỗi JavaScript trong cả phiên", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  check("kịch bản chạy hết không ngoại lệ", false, String(e.message).slice(0, 300));
  try { await shot("app-99-loi"); console.log("Trang lúc lỗi:", (await text()).slice(0, 500).replace(/\s+/g, " ")); } catch { /* bỏ qua */ }
} finally {
  try { ws?.close(); } catch { /* bỏ qua */ }
  proc.kill();
  if (TAURI_EXE) spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* Windows còn giữ file */ }
}
console.log(`\n${results.filter(Boolean).length}/${results.length} đạt, tổng ${el()}. Ảnh: ${OUT}`);
process.exit(results.every(Boolean) ? 0 : 1);

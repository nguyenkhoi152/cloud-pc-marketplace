#!/usr/bin/env node
/**
 * Kiểm đường WSL của app Tauri ĐÃ CÀI trên máy KHÔNG có WSL (đúng tình trạng máy dev này): sau `start-demo.ps1 -Guest wsl` (xoá tệp backend VM thử còn sót),
 * màn "Thiết lập & chạy máy" phải ở chế độ WSL, KHÔNG hiện banner VM thử, bước "Windows có WSL2" là `manual` (không phải `info`) với huy hiệu
 * "Cần quyền quản trị" + "Cần khởi động lại máy" và lệnh `wsl --install --no-distribution`; các bước sau bị chặn; không có nút tự cài WSL.
 * Chỉ ĐỌC: không cài gì, không ghi vào Supabase ngoài việc đăng nhập (tài khoản host smoke; thông tin đăng nhập đọc trong tiến trình, không in).
 * Chạy:  node scripts/vm/wsl-mode-check.mjs <exe app> <thư mục ảnh>
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const [exe, OUT] = process.argv.slice(2);
if (!exe || !OUT) throw new Error("Dùng: <exe app> <thư mục ảnh>");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const parse = (f) => existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")])) : {};
const smoke = parse(path.join(root, "desktop/.env.smoke.local"));
const backendFile = path.join(process.env.APPDATA, "dev.cloudpc.companion", "host-backend.json");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

check("không còn tệp backend VM thử (start-demo -Guest wsl đã xoá) ⇒ app dùng đường WSL", !existsSync(backendFile) || !/"ssh-dev"/.test(readFileSync(backendFile, "utf8")), existsSync(backendFile) ? "có tệp backend" : "không có tệp backend");

const profile = path.join(os.tmpdir(), "cpm-e2e-webview-wsl");
rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
mkdirSync(profile, { recursive: true });
const port = 9700 + Math.floor(Math.random() * 90);
const proc = spawn(exe, [], { env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: "ignore" });
let ws; let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("evaluate: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)); return r.result.value; };
const waitFor = async (pred, what, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(pred)) return true; } catch { /* đang chuyển trang */ } await sleep(300); } throw new Error("hết thời gian chờ " + what); };
const fill = (i, v) => ev(`(() => { const el = document.getElementById(${JSON.stringify(i)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const click = (t, sel = "button, a, [role=button]") => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.innerText.trim().includes(${JSON.stringify(t)}) && !e.disabled); if (!el) return false; el.click(); return true; })()`);
try {
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* chưa sẵn sàng */ } if (!wsUrl) await sleep(400); }
  ws = new WebSocket(wsUrl); await new Promise((r) => ws.on("open", r));
  ws.on("message", (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
  await send("Page.enable"); await send("Runtime.enable");
  // Hồ sơ mới: chờ app tải xong màn Welcome rồi mới chuyển sang đăng nhập (đặt hash quá sớm sẽ bị trang đang tải ghi đè).
  await waitFor('document.body && document.body.innerText.includes("Chào mừng")', "màn Welcome", 60000);
  await ev(`location.hash = "#/login"`);
  await waitFor('!!document.getElementById("email")', "form đăng nhập", 60000);
  await fill("email", smoke.SMOKE_HOST_EMAIL); await fill("pw", smoke.SMOKE_HOST_PASSWORD);
  await click("Đăng nhập", "button[type=submit]");
  await waitFor('location.hash.includes("choose-mode")', "chọn chế độ", 40000);
  await waitFor('document.body.innerText.includes("Bạn muốn làm gì trước")', "màn chọn chế độ");
  await click("Cho thuê máy", "button");
  await waitFor('location.hash.includes("/host")', "vào chế độ Cho thuê");
  await ev(`location.hash = "#/host/setup"`);
  await waitFor('document.querySelector("[data-testid=host-steps]")?.dataset.probing === "0"', "màn thiết lập sẵn sàng", 120000);
  const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(OUT, n + ".png"), Buffer.from(r.data, "base64")); };
  const steps = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-testid="host-steps"] [data-step]')].map((e) => ({ id: e.dataset.step, status: e.dataset.status })))`));
  const st = Object.fromEntries(steps.map((s) => [s.id, s.status]));
  console.log("INFO  các bước: " + steps.map((s) => `${s.id}:${s.status}`).join(" "));
  const text = await ev("document.body.innerText");
  const wslText = await ev('document.querySelector("[data-step=wsl]")?.innerText ?? ""');
  check("KHÔNG có banner 'GUEST THỬ: máy ảo Linux qua SSH' (đang ở đường WSL)", !/GUEST THỬ/.test(text));
  check("bước 'Windows có WSL2' là `manual` (bạn cần tự làm), không phải `info`", st.wsl === "manual", `wsl=${st.wsl}`);
  check("có huy hiệu 'Cần quyền quản trị' và 'Cần khởi động lại máy' + lệnh `wsl --install --no-distribution`", /Cần quyền quản trị/.test(wslText) && /Cần khởi động lại máy/.test(wslText) && /wsl --install --no-distribution/.test(wslText) && /PowerShell \(Run as administrator\)/.test(wslText));
  check("Windows báo đúng thông điệp thật 'chưa cài' của wsl.exe", /not installed/i.test(wslText), wslText.split("\n").find((l) => /not installed/i.test(l))?.slice(0, 110) ?? "");
  check("mọi bước sau WSL bị chặn (chưa tới); không có bước nào cho phép bấm cài/ghi danh/bắt đầu", ["distro", "connect", "packages", "image", "agent", "network", "enroll", "run"].every((k) => st[k] === "blocked"), JSON.stringify(st));
  check("không có nút nào tự cài WSL hoặc bật tính năng Windows", !(await ev('[...document.querySelectorAll("button")].some((b) => /(cài|bật).*(wsl|tính năng)/i.test(b.innerText))')));
  const next = await ev('document.querySelector("[data-testid=host-steps]")?.closest("section")?.innerText.includes("Việc tiếp theo: Windows có WSL2") ?? false');
  check("việc tiếp theo được nêu đúng: 'Windows có WSL2'", next);
  await shot("wsl-1-chua-cai");
  check("gateway/agent/guest KHÔNG được chạm (không có nút 'Bắt đầu nhận thuê')", !text.includes("Bắt đầu nhận thuê"));
} catch (e) {
  check("kịch bản chạy hết không ngoại lệ", false, String(e.message).slice(0, 300));
} finally {
  try { ws?.close(); } catch { /* bỏ qua */ }
  spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
  await sleep(800);
}
console.log(`\n${results.filter(Boolean).length}/${results.length} đạt. Ảnh: ${OUT}`);
process.exit(results.every(Boolean) ? 0 : 1);

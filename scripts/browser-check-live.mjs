#!/usr/bin/env node
/**
 * Kiểm app LIVE trong Edge headless qua CDP (không cần Playwright). Dùng tài khoản smoke đã có
 * (desktop/.env.smoke.local); KHÔNG tạo tài khoản/booking mới (đặt máy được thử trên máy đã bị giữ nên bị từ chối).
 * Không in email/mật khẩu/URL. Chạy: node scripts/browser-check-live.mjs [http://127.0.0.1:5176]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// CHECK_TAURI_EXE=<đường dẫn exe>: chạy bộ kiểm trong cửa sổ WebView2 của app Tauri (origin http://tauri.localhost) thay vì Edge headless.
const TAURI_EXE = process.env.CHECK_TAURI_EXE;
const BASE = process.argv[2] ?? (TAURI_EXE ? "http://tauri.localhost" : "http://127.0.0.1:5176");
const OUT = process.env.BROWSER_CHECK_OUT ?? path.join(os.tmpdir(), "cpm-browser-check");
mkdirSync(OUT, { recursive: true });
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!EDGE && !TAURI_EXE) throw new Error("Không thấy Microsoft Edge");

const creds = Object.fromEntries(
  readFileSync(path.join(root, "desktop/.env.smoke.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const cred = (r) => ({ email: creds[`SMOKE_${r}_EMAIL`], pw: creds[`SMOKE_${r}_PASSWORD`] });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const profile = mkdtempSync(path.join(os.tmpdir(), "cpm-edge-"));
const port = 9400 + Math.floor(Math.random() * 400);
const edge = TAURI_EXE
  ? spawn(TAURI_EXE, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: "ignore" })
  : spawn(EDGE, [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,800", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* chưa sẵn sàng */ }
    await sleep(150);
  }
  throw new Error("Edge không mở được cổng CDP");
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.on("open", r));
let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  } else if (m.method === "Runtime.exceptionThrown") consoleErrors.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200));
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
});
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable"); await send("Runtime.enable");

const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("evaluate: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result.value;
};
const text = () => ev("document.body.innerText");
const waitFor = async (pred, what, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await ev(pred)) return true; } catch { /* trang đang chuyển */ } await sleep(150); }
  throw new Error("Hết thời gian chờ: " + what);
};
const waitText = (t, ms) => waitFor(`document.body.innerText.includes(${JSON.stringify(t)})`, `chữ "${t}"`, ms);
const go = async (hash) => {
  await ev(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(400);
  // màn hình tải theo route (code-splitting): chờ chữ chờ của Suspense biến mất
  await waitFor('!document.body.innerText.includes("Đang tải màn hình")', "tải xong mã màn hình", 20000);
};
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.data, "base64")); };
const setViewport = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const clickText = (t, sel = "button, a, [role=button]") =>
  ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.innerText.trim().includes(${JSON.stringify(t)}) && !e.disabled); if (!el) return false; el.click(); return true; })()`);
const fill = (idAttr, value) =>
  ev(`(() => { const el = document.getElementById(${JSON.stringify(idAttr)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const overflow = () => ev("document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1");

async function login(role) {
  const c = cred(role);
  await go("#/login");
  await waitFor('!!document.getElementById("email")', "form đăng nhập");
  await fill("email", c.email); await fill("pw", c.pw);
  await clickText("Đăng nhập", "button[type=submit]");
  await waitFor('location.hash.includes("choose-mode")', "chuyển sang chọn chế độ");
}
async function logoutIfNeeded() {
  await ev(`localStorage.clear(); sessionStorage.clear(); location.hash = "#/welcome"; location.reload()`);
  await sleep(1200);
}

try {
  await setViewport(1280, 800);
  await send("Page.navigate", { url: BASE + "/#/welcome" });
  await waitText("Chào mừng");

  // 1. Màn chào + banner live
  let t = await text();
  check("Banner môi trường dev hiển thị, không có 'BẢN XEM TRƯỚC'", t.includes("MÔI TRƯỜNG DEV") && !t.includes("BẢN XEM TRƯỚC"));
  check("Không có nút 'Vào nhanh với tài khoản demo' ở live", !t.includes("Vào nhanh"));
  await shot("01-welcome");

  // 2. Đăng nhập sai mật khẩu → thông báo lỗi rõ
  await go("#/login");
  await waitFor('!!document.getElementById("email")', "form đăng nhập");
  await fill("email", cred("RENTER").email); await fill("pw", "mat-khau-sai-cho-kiem-tra");
  await clickText("Đăng nhập", "button[type=submit]");
  await waitText("Không đăng nhập được");
  t = await text();
  check("Sai mật khẩu → báo 'Email hoặc mật khẩu không đúng', vẫn ở màn đăng nhập", t.includes("Email hoặc mật khẩu không đúng") && location_is(await ev("location.hash"), "login"));
  await shot("02-login-wrong");

  // 3. Đăng nhập đúng (renter)
  await login("RENTER");
  await waitText("Bạn muốn làm gì trước", 20000);
  check("Đăng nhập renter thật thành công → màn chọn chế độ", (await text()).includes("Thuê máy"));
  await shot("03-choose-mode");
  await clickText("Thuê máy", "button");
  await waitFor('location.hash.includes("rent/discover")', "vào Khám phá");
  await waitFor('!document.body.innerText.includes("Đang tải")', "tải xong danh mục", 20000);
  await sleep(600);
  t = await text();
  check("Khám phá: có ≥1 máy thật (smoke-*) và nhãn 'Chưa xác minh online'", /smoke-\d+/.test(t) && t.includes("Chưa xác minh online"));
  check("Khám phá: không có ví mẫu/kịch bản demo/nhãn 'Dữ liệu mô phỏng'", !t.includes("Số dư để thuê") && !t.includes("Demo:") && !t.includes("Dữ liệu mô phỏng"));
  await shot("04-discover");

  // 4. Chi tiết máy → Giữ máy (máy đã bị giữ từ smoke → phải bị từ chối, không tạo booking mới)
  const machineLink = await ev(`(() => { const a = [...document.querySelectorAll("a")].find((x) => /smoke-\\d+/.test(x.innerText) && x.getAttribute("href")?.includes("/rent/machine/")); return a ? a.getAttribute("href") : null; })()`);
  check("Có liên kết chi tiết máy smoke", !!machineLink);
  await ev(`location.hash = ${JSON.stringify(machineLink?.replace(/^#?/, "#"))}`);
  await waitText("Thuê máy này");
  await shot("05-machine-detail");
  const id = machineLink.split("/").pop();
  await go(`#/rent/checkout/${id}`);
  await waitText("Xác nhận giữ máy");
  t = await text();
  check("Checkout live: giá, phí, quy tắc tiền, không có 'chọn thời lượng' của mock", t.includes("Gói duy nhất") && t.includes("kết thúc sớm sau kích hoạt vẫn trả cả gói") && !t.includes("Số dư sau khi"));
  await shot("06-checkout");
  await clickText("Giữ máy", "button");
  await waitText("Không giữ được máy", 20000);
  t = await text();
  check("Giữ máy trên máy đã bị giữ → báo lỗi rõ 'không thể giữ', không báo thành công", t.includes("không thể giữ") && !t.includes("Đã giữ máy"));
  await shot("07-reserve-denied");

  // 5. Đặt chỗ của tôi
  await go("#/rent/history");
  await waitText("Đặt chỗ của tôi");
  await waitFor('!document.body.innerText.includes("Đang tải")', "tải đặt chỗ", 20000);
  t = await text();
  check("'Đặt chỗ của tôi' liệt kê booking thật ở trạng thái reserved/not_granted", /reserved \/ not_granted/.test(t));
  check("Đặt chỗ: nêu giai đoạn + chính sách tiền áp dụng (hủy trước kích hoạt ≠ kết thúc sau kích hoạt), nút ký bị khoá có lý do", t.includes("Đang giữ máy, chờ thanh toán") && t.includes("Nếu dừng ở bước này") && t.includes("Chưa dùng được"));
  await shot("08-bookings");

  // 6. Mục chưa nối hiện đúng thông báo, không có số mẫu
  for (const [hash, label] of [["#/rent/session", "Phiên thuê"], ["#/notifications", "Thông báo"]]) {
    await go(hash); await sleep(500);
    t = await text();
    check(`${label}: hiện 'Chưa nối dữ liệu thật', không dữ liệu mẫu`, t.includes("Chưa nối dữ liệu thật") && !/644|Minh Anh/.test(t));
  }
  await shot("09-not-wired");
  await go("#/wallet");
  await waitText("Ví đã liên kết");
  t = await text();
  check("Ví (live): có mục liên kết ví, không số dư/tên mẫu, nói rõ chưa đọc số dư từ chuỗi", t.includes("Liên kết ví") && t.includes("Chưa đọc từ chuỗi") && !/644|Minh Anh/.test(t));
  await shot("09b-wallet");

  // 7. Kích thước và tràn ngang
  for (const [w, h] of [[1024, 768], [1280, 800], [1440, 900]]) {
    await setViewport(w, h);
    for (const hash of ["#/rent/discover", "#/rent/history", "#/wallet"]) { await go(hash); await sleep(900); if (await overflow()) check(`Không tràn ngang ${w}×${h} ${hash}`, false); }
    check(`Không tràn ngang ${w}×${h} (discover, đặt chỗ, chưa nối)`, !(await overflow()));
    await shot(`10-discover-${w}`);
  }
  await setViewport(1280, 800);

  // 8. Đăng xuất thật
  await ev(`(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") || "").startsWith("Tài khoản của")); b && b.click(); return !!b; })()`);
  await sleep(300);
  await clickText("Đăng xuất", "button");
  await waitFor('location.hash.includes("welcome")', "về màn chào sau đăng xuất");
  check("Đăng xuất thật → về màn chào", true);
  await go("#/rent/discover"); await sleep(500);
  check("Sau đăng xuất, vào lại /rent/discover bị chặn về màn chào", (await ev("location.hash")).includes("welcome"));

  // 9. Host
  await login("HOST");
  await clickText("Cho thuê máy", "button");
  await waitFor('location.hash === "#/host" || location.hash.startsWith("#/host")', "vào chế độ host");
  await waitText("Host đã được duyệt", 20000);
  await waitFor('document.body.innerText.includes("Cam kết")', "tải panel máy", 20000);
  await sleep(1500);
  t = await text();
  check("Host: trạng thái đã duyệt + máy smoke với trạng thái 'Đã duyệt'", t.includes("Host đã được duyệt") && /smoke-\d+/.test(t) && t.includes("Đã duyệt"));
  check("Host: cam kết, lịch Thứ Hai 19:00–23:00, sức khỏe 'chưa có thiết bị'", t.includes("Cam kết") && t.includes("Thứ Hai 19:00–23:00") && t.includes("Chưa có thiết bị"));
  check("Host: mục chưa nối bị ẩn khỏi sidebar (Thu nhập, Sự cố…)", !(await ev(`!![...document.querySelectorAll("nav a")].find((a) => a.innerText.includes("Thu nhập"))`)));
  await shot("11-host");
  await setViewport(1024, 768);
  await sleep(500);
  check("Host không tràn ngang ở 1024×768", !(await overflow()));
  await shot("12-host-1024");
  await go("#/host/onboarding/intro"); await sleep(400);
  check("Host: onboarding mẫu bị chặn bằng 'Chưa nối dữ liệu thật'", (await text()).includes("Chưa nối dữ liệu thật"));

  // 9b. Bàn phím trên bộ chuyển chế độ khi chunk của màn đích CHƯA được nạp (tải mới trang): chrome và focus không được mất
  await setViewport(1280, 800);
  await send("Page.navigate", { url: "about:blank" }); // tải lại HOÀN TOÀN (đổi hash không làm mất lazy đã nạp)
  await sleep(300);
  await send("Page.navigate", { url: BASE + "/#/rent/discover" });
  await waitFor('!!document.querySelector("[role=radio]")', "bộ chuyển chế độ sau khi tải mới");
  check("Tải lại hoàn toàn trang: phiên đăng nhập được khôi phục, KHÔNG bị đẩy về màn Chào mừng", (await ev("location.hash")).startsWith("#/rent"));
  await ev(`(() => { const r = [...document.querySelectorAll("[role=radio]")].find((x) => x.getAttribute("aria-checked") === "true"); r && r.focus(); return !!r; })()`);
  const key = (k) => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k }));
  await key("ArrowRight");
  await waitFor('location.hash.startsWith("#/host")', "đổi sang chế độ Cho thuê bằng ArrowRight");
  await waitText("Cho thuê máy", 20000);
  await sleep(500);
  const focusOk = await ev('(() => { const a = document.activeElement; return !!a && a.getAttribute("role") === "radio" && !!a.closest("[aria-label=\\"Chế độ sử dụng\\"], [data-keep-focus]"); })()');
  check("Bàn phím: ArrowRight đổi chế độ khi chunk chưa nạp, focus VẪN ở bộ chuyển chế độ (chrome không bị gỡ)", focusOk, focusOk ? "" : "activeElement=" + (await ev("document.activeElement && document.activeElement.tagName")));
  await key("ArrowLeft");
  await waitFor('location.hash.startsWith("#/rent")', "ArrowLeft quay lại chế độ Thuê");
  check("Bàn phím: ArrowLeft quay lại, vẫn giữ focus", await ev('document.activeElement && document.activeElement.getAttribute("role") === "radio"'));

  // 10. Lỗi console
  check("Không có lỗi JavaScript/console.error trong cả phiên kiểm", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} catch (e) {
  check("Kịch bản chạy hết không ngoại lệ", false, String(e.message).slice(0, 300));
  try { await shot("99-failure"); console.log("Trang lúc lỗi:", (await text()).slice(0, 400).replace(/\s+/g, " ")); } catch { /* bỏ qua */ }
} finally {
  ws.close();
  edge.kill();
  if (TAURI_EXE) spawn("taskkill", ["/F", "/T", "/PID", String(edge.pid)], { stdio: "ignore" });
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* Windows còn giữ file */ }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} đạt. Ảnh chụp: ${OUT}`);
process.exit(failed.length ? 1 : 0);

function location_is(hash, name) { return String(hash).includes(name); }

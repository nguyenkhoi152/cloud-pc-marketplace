/**
 * KIỂM luồng thuê trên Avalanche Fuji (testnet) qua máy chủ API CỤC BỘ đang chạy với server.env của Fuji.
 *   mặc định : phần chuỗi, không cần host: giữ máy → trả tiền → hủy → tiền hoàn được ghi có (credit) → rút về ví.
 *   --full   : phiên có host thật (cần agent đang chạy trong guest và đã ghi danh): worker kích hoạt → viewer → kết thúc sớm → chia tiền → máy sạch lại.
 * Dùng CHÍNH mã ví thử và client API của app (desktop/src/api), nên cũng kiểm app: liên kết ví → vòi (PCP + gas) → giữ máy → approve + fund
 * trên escrow Fuji thật → đối soát (server đọc log qua RPC công khai, quét theo trang) → hủy trước khi bắt đầu (hoàn tiền) → kiểm số dư.
 *
 *   npx tsx scripts/public/fuji-rental-check.mts [apiBase http://127.0.0.1:3000/api] [stateFile C:\cpm-demo\state.json]
 *
 * Tài khoản người thuê là TÀI KHOẢN TẠM tạo mới trên Supabase dev (email ngẫu nhiên, mật khẩu ngẫu nhiên giữ trong bộ nhớ, không ghi ra đâu);
 * khoá ví tạm cũng chỉ trong bộ nhớ. Không đọc desktop/.env.smoke.local; chỉ đọc URL + khoá công khai (anon) từ desktop/.env.local.
 * Để lại trên Supabase dev: 1 tài khoản + profile + liên kết ví + 1 booking đã hủy + audit. Trên Fuji: giao dịch công khai (in ra);
 * AVAX còn dư của ví tạm được chuyển lại cho ví issuer ở cuối. Không in token/khoá/mật khẩu.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPublicClient, createWalletClient, formatEther, http, type Address, type Hex } from "viem";
import { avalancheFuji } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createServerApi, fetchChainInfo } from "../../desktop/src/api/server";
import { createTestnetWallet } from "../../desktop/src/api/testnetWallet";
import { linkWallet } from "../../desktop/src/api/wallet";
import { requestHash } from "../../desktop/src/api/live";

const SHOT = process.argv.includes("--shot"); // --full --shot: mở đường dẫn xem bằng Edge thật (cần biến PW_CORE = đường dẫn tới playwright-core/index.mjs), đếm khung WebSocket, chụp ảnh vào C:\cpm-demo\shots-public
const FULL = process.argv.includes("--full"); // --full: phiên có host thật (cần agent đang chạy trong guest); mặc định chỉ kiểm phần chuỗi + hủy/hoàn tiền
const [apiBase = "http://127.0.0.1:3000/api", stateFile = "C:\\cpm-demo\\state.json"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const parse = (f: string): Record<string, string> => existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")])) : {}; // bỏ chú thích cùng dòng ("KHOA=abc # ghi chú") như các script khác
const desk = parse(path.join(root, "desktop/.env.local"));
const SU = (desk.VITE_SUPABASE_URL ?? "").replace(/\/+$/, ""), KEY = desk.VITE_SUPABASE_ANON_KEY ?? "";
if (!SU || !KEY) throw new Error("Thiếu VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY trong desktop/.env.local");
const manifest = JSON.parse(readFileSync(path.join(root, "contracts/deployments/fuji.json"), "utf8"));
const machineId = (JSON.parse(readFileSync(stateFile, "utf8")) as { machineId: string }).machineId;

const results: boolean[] = [];
const check = (ok: boolean, name: string, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const info = (m: string) => console.log(`INFO  ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now(); const el = () => `${Math.round((Date.now() - T0) / 1000)}s`;
const tx = (h: string) => `https://testnet.snowtrace.io/tx/${h}`;
const abort = (m: string): never => { check(false, m); console.log(`\n${results.filter(Boolean).length}/${results.length} đạt (dừng sớm)`); process.exit(1); };

const jf = async (url: string, init: RequestInit, tries = 4) => {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url, init); const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* không phải JSON */ } return { status: r.status, j }; }
    catch (e) { if (i >= tries) throw e; await sleep(3000 * i); }
  }
};

// 1. Tài khoản người thuê TẠM (không đụng tài khoản có sẵn)
const email = `fuji-check-${randomBytes(4).toString("hex")}@example.com`;
const password = randomBytes(18).toString("base64url");
const su = await jf(`${SU}/auth/v1/signup`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password, data: { display_name: "Kiểm Fuji (tạm)" } }) });
if (!su.j?.access_token) abort(`đăng ký tài khoản tạm thất bại (HTTP ${su.status}${su.j?.error_code ? " " + su.j.error_code : ""}; cần tắt xác nhận email ở Supabase dev)`);
const jwt: string = su.j.access_token; const userId: string = su.j.user.id;
check(true, "tạo tài khoản người thuê tạm (Supabase Auth thật)");
const rest = (p: string, init: RequestInit = {}) => jf(`${SU}/rest/v1${p}`, { ...init, headers: { apikey: KEY, authorization: `Bearer ${jwt}`, "content-type": "application/json", ...(init.headers ?? {}) } });
const prof = await rest("/profiles", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ user_id: userId, display_name: "Kiểm Fuji (tạm)" }) });
if (prof.status >= 300) abort(`tạo profile thất bại (HTTP ${prof.status})`);

// 2. Cấu hình chuỗi từ máy chủ phải khớp deployment
const server = createServerApi({ baseUrl: apiBase, getToken: async () => jwt });
const ci = await fetchChainInfo(apiBase);
if (!ci) abort("không đọc được /chain-info từ máy chủ API cục bộ (đã chạy start-demo -Chain fuji chưa?)");
check(ci!.chainId === 43113 && ci!.escrow.toLowerCase() === manifest.contracts.RentalEscrow.address.toLowerCase() && ci!.pcp?.toLowerCase() === manifest.contracts.PCP.address.toLowerCase(), "chain-info khớp fuji.json (chainId, escrow, PCP)");
check(!!ci!.rpcUrl && ci!.faucet === true, "chain-info có RPC công khai và vòi bật", ci!.rpcUrl ?? "");
const ESCROW = ci!.escrow as Address, PCP = ci!.pcp as Address;

// 3. Ví thử của app (khoá tạm, chỉ trong bộ nhớ)
const key = generatePrivateKey();
const wallet = createTestnetWallet({ rpcUrl: ci!.rpcUrl!, chainId: ci!.chainId, key });
info(`ví thử tạm: ${wallet.address} (${wallet.label})`);
check((await wallet.balance(PCP)) === "0" && (await wallet.gasBalance()) === "0", "ví mới có 0 PCP và 0 AVAX");
const lk = await linkWallet(wallet.provider, server, ci!.chainId).catch((e: Error) => abort(`liên kết ví thất bại: ${e.message}`));
check(lk.address.toLowerCase() === wallet.address.toLowerCase(), "liên kết ví bằng chữ ký (máy chủ khôi phục đúng địa chỉ)");

// 4. Giữ máy (đúng RPC reserve_machine như app)
const hash = await requestHash(machineId, "none");
const rv = await jf(`${SU}/rest/v1/rpc/reserve_machine`, { method: "POST", headers: { apikey: KEY, authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ p_machine_id: machineId, p_idempotency_key: `fuji-check-${randomBytes(6).toString("hex")}`, p_request_hash: hash, p_workspace_mode: "none" }) });
if (rv.status >= 300 || !rv.j?.id) {
  const busy = String(rv.j?.message ?? "").includes("unavailable");
  if (busy) info("máy đang bận hoặc không nhận khách: (1) booking trước chưa hết hạn: lần chạy hỏng giữa chừng giữ máy tới ~12 phút (hạn trả 10 phút + 2 phút đệm), hoặc booking cũ chưa dọn xong; (2) host chưa duyệt / chưa có cam kết giờ phủ đủ thời gian. Xem: npx tsx scripts/public/admin.mts machine <machineId> (active_booking_id phải trống), rồi chạy lại.");
  abort(`giữ máy thất bại (HTTP ${rv.status} ${rv.j?.message ?? ""})`);
}
const bookingId: string = rv.j.id;
const bk = async () => ((await rest(`/bookings?id=eq.${bookingId}&select=state,access_state,price_units::text,chain_booking_id`)).j as any[])?.[0];
const b0 = await bk();
check(b0?.state === "reserved", "giữ máy (reserve_machine): state=reserved", `booking ${bookingId.slice(0, 8)}…, giá ${formatEther(BigInt(String(b0.price_units).split(".")[0]!))} PCP thử`);
const chainId32 = `0x${String(b0.chain_booking_id).slice(2)}` as Hex;
const price = BigInt(String(b0.price_units).split(".")[0]!);

// 5. Trả tiền: ví của app tự xin PCP + gas từ vòi, approve, fund trên Fuji thật, báo máy chủ đối soát
const t1 = Date.now();
const paid = await wallet.pay(bookingId, server).catch((e: Error) => abort(`trả tiền thất bại: ${e.message}`));
info(`approve + fund xong sau ${Math.round((Date.now() - t1) / 1000)}s: ${tx(paid.txHash)} (trạng thái đối soát: ${paid.status})`);
check(BigInt(await wallet.balance(PCP)) === 1000n * 10n ** 18n - price, "ví đã nhận 1000 PCP thử từ vòi và đã trả đúng giá", `còn ${formatEther(BigInt(await wallet.balance(PCP)))} PCP`);
for (let i = 0; i < 24 && (await bk())?.state !== "funded"; i++) { await server.reconcile(bookingId, paid.txHash).catch(() => undefined); await sleep(5000); }
const b1 = await bk();
check(b1?.state === "funded", "máy chủ đối soát: booking chuyển sang funded (đọc log Fuji qua RPC công khai)", `state=${b1?.state} access=${b1?.access_state} (${el()})`);

// 6. Hủy trước khi bắt đầu ⇒ hoàn tiền (kiểu rút sau)
async function cancelAndWithdraw() {
const cancelled = await wallet.cancelBeforeStart({ bookingId, chainBookingId: chainId32, chain: { escrow: ESCROW, chainId: ci!.chainId } }, server).catch((e: Error) => abort(`hủy trước khi bắt đầu thất bại: ${e.message}`));
info(`cancelBeforeStart: ${tx(cancelled.txHash)} (trạng thái đối soát: ${cancelled.status})`);
for (let i = 0; i < 24 && !["cancelled", "refunded"].includes((await bk())?.state); i++) { await server.reconcile(bookingId, cancelled.txHash).catch(() => undefined); await sleep(5000); }
const b2 = await bk();
check(["cancelled", "refunded"].includes(b2?.state), "máy chủ đối soát: booking đã hủy/hoàn tiền", `state=${b2?.state} (${el()})`);
// Hợp đồng hoàn tiền kiểu "rút sau": cancelBeforeStart ghi CÓ vào credit của người thuê, chưa chuyển về ví.
check((await wallet.credit(ESCROW)) === price.toString(), "tiền hoàn được ghi có đủ giá vào ví giữ tiền (credit)", `${formatEther(price)} PCP chờ rút`);
check(BigInt(await wallet.balance(PCP)) === 1000n * 10n ** 18n - price, "ví chưa nhận lại tiền cho tới khi rút (đúng thiết kế rút sau)");
const wd = await wallet.withdraw(ESCROW).catch((e: Error) => abort(`rút tiền hoàn thất bại: ${e.message}`));
info(`withdrawPCP: ${tx(wd)}`);
for (let i = 0; i < 12 && BigInt(await wallet.balance(PCP)) !== 1000n * 10n ** 18n; i++) await sleep(3000); // RPC công khai có thể chậm vài giây
check(BigInt(await wallet.balance(PCP)) === 1000n * 10n ** 18n, "sau khi rút, PCP về đủ ví (1000 PCP thử)");
check((await wallet.credit(ESCROW)) === "0", "credit đã về 0");
}

/** Đổi token xem bằng trình duyệt thật (token chỉ dùng một lần), chờ luồng hình, đếm khung WebSocket, chụp ảnh. */
async function browserViewer(url: string) {
  const { chromium } = (await import(pathToFileURL(process.env.PW_CORE!).href)) as { chromium: any };
  const browser = await chromium.launch({ channel: "msedge" });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" })).newPage();
    const sockets: string[] = [];
    let frames = 0, bytes = 0;
    page.on("websocket", (w: any) => { sockets.push(new URL(w.url()).origin); w.on("framereceived", (f: any) => { frames++; bytes += f.payload?.length ?? 0; }); });
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch((e: Error) => { info(`mở viewer lỗi: ${e.message.slice(0, 120)}`); return null; });
    check(!!resp && resp.status() === 200, "trình duyệt: gateway đổi token lấy phiên và trả trang desktop (Selkies) qua tunnel công khai", `HTTP ${resp?.status()} ${new URL(page.url()).origin}`);
    await sleep(25_000); // cho luồng hình khởi động
    mkdirSync("C:\\cpm-demo\\shots-public", { recursive: true });
    const file = `C:\\cpm-demo\\shots-public\\viewer-${Date.now()}.png`;
    await page.screenshot({ path: file });
    const media = await page.evaluate(() => {
      const v = document.querySelector("video") as HTMLVideoElement | null;
      const cs = Array.from(document.querySelectorAll("canvas")).map((c) => ({ w: c.width, h: c.height })).filter((c) => c.w > 0 && c.h > 0);
      return { video: v ? { w: v.videoWidth, h: v.videoHeight } : null, canvases: cs };
    });
    const shown = (media.video && media.video.w > 0) || media.canvases.length > 0;
    check(sockets.length > 0 && frames > 0, "trình duyệt: WebSocket tới gateway qua tunnel mở được và nhận dữ liệu", `${sockets[0] ?? "không có WebSocket"}; ${frames} khung, ${Math.round(bytes / 1024)} KiB`);
    check(shown, "trình duyệt: luồng hình desktop hiển thị (video/canvas có kích thước)", JSON.stringify(media).slice(0, 120));
    info(`ảnh viewer: ${file} (${Math.round(statSync(file).size / 1024)} KiB)`);
  } finally { await browser.close(); }
}

// 6'. --full: phiên có host thật (worker + agent trong guest) → kích hoạt trên Fuji → mở viewer → kết thúc sớm → chia tiền → dọn máy
async function fullFlow() {
  const pubChain = createPublicClient({ chain: avalancheFuji, transport: http(ci!.rpcUrl!) });
  const escrowAbi = JSON.parse(readFileSync(path.join(root, "packages/shared/src/abi/RentalEscrow.json"), "utf8"));
  const rdE = (functionName: string, args: unknown[] = []) => pubChain.readContract({ address: ESCROW, abi: escrowAbi, functionName, args } as never) as Promise<bigint>;
  const locked1 = await rdE("lockedPrincipal"), credits1 = await rdE("totalCredits"), tre1 = await rdE("credit", [manifest.roles.treasury]);
  for (let i = 0; i < 72 && (await bk())?.state !== "active"; i++) await sleep(5000);
  const b3 = await bk();
  check(b3?.state === "active", "worker chuẩn bị máy ảo (agent trong guest) và kích hoạt trên escrow Fuji (operator)", `state=${b3?.state} access=${b3?.access_state} (${el()})`);
  if (b3?.state !== "active") { info("không kích hoạt được trong 6 phút: hoàn tiền bằng cách hủy trước khi bắt đầu"); await cancelAndWithdraw(); return; }

  // "ready" = guest sẵn sàng; worker còn phải GRANT (lệnh cho agent cấp token xem) rồi access mới thành "granted". Chỉ lúc đó mới xin được đường dẫn xem.
  for (let i = 0; i < 48 && (await bk())?.access_state !== "granted"; i++) await sleep(2500);
  info(`access_state trước khi xin đường dẫn xem: ${(await bk())?.access_state} (${el()})`);
  const cn: any = await server.connect(bookingId).catch((e: Error) => ({ error: e.message }));
  const viewerUrl: string | undefined = cn.viewerUrl;
  check(!!viewerUrl && /^https?:\/\//.test(viewerUrl), "máy chủ cấp đường dẫn xem theo phiên (token dùng một lần)", viewerUrl ? new URL(viewerUrl).origin : cn.error);
  if (viewerUrl) {
    if (SHOT && process.env.PW_CORE) await browserViewer(viewerUrl);
    else {
      if (SHOT) info("bỏ qua chụp viewer: đặt biến PW_CORE=<đường dẫn tới playwright-core\\index.mjs>");
      const r1 = await fetch(viewerUrl, { redirect: "manual" }).catch(() => null);
      const cookie = (r1?.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
      const loc = r1?.headers.get("location");
      const r2 = loc ? await fetch(new URL(loc, viewerUrl), { headers: { cookie } }).catch(() => null) : r1;
      check(!!r2 && r2.status === 200, "gateway của host đổi token lấy phiên xem và trả trang desktop (Selkies)", `HTTP ${r2?.status}`);
    }
    const noTok = await fetch(new URL("/", viewerUrl)).catch(() => null);
    check(noTok?.status === 401, "không có token/cookie thì gateway từ chối (401)", `HTTP ${noTok?.status}`);
  }

  const ended = await wallet.accept({ bookingId, chainBookingId: chainId32, chain: { escrow: ESCROW, chainId: ci!.chainId } }, server).catch((e: Error) => abort(`kết thúc sớm (accept) thất bại: ${e.message}`));
  info(`accept (kết thúc sớm): ${tx(ended.txHash)}`);
  for (let i = 0; i < 30 && (await bk())?.state !== "settled"; i++) { await server.reconcile(bookingId, ended.txHash).catch(() => undefined); await sleep(5000); }
  const b4 = await bk();
  check(b4?.state === "settled", "máy chủ đối soát: booking đã settled", `state=${b4?.state} (${el()})`);
  for (let i = 0; i < 72 && (await bk())?.access_state !== "reset_verified"; i++) await sleep(5000);
  const b5 = await bk();
  check(b5?.access_state === "reset_verified", "worker thu hồi quyền, xoá máy ảo và xác minh sạch (máy của host sạch lại)", `access=${b5?.access_state} (${el()})`);

  const locked2 = await rdE("lockedPrincipal"), credits2 = await rdE("totalCredits"), tre2 = await rdE("credit", [manifest.roles.treasury]), feeBps = await rdE("feeBps");
  check(locked1 - locked2 === price, "PCP hết bị khoá trong escrow sau khi chia", `${formatEther(price)} PCP`);
  check(credits2 - credits1 === price, "toàn bộ giá được ghi có (host + phí), không thừa không thiếu");
  check(tre2 - tre1 === (price * feeBps) / 10_000n, "phí nền tảng đúng tỉ lệ theo hợp đồng", `${formatEther(tre2 - tre1)} PCP (${Number(feeBps) / 100}%)`);
  check(BigInt(await wallet.balance(PCP)) === 1000n * 10n ** 18n - price, "kết thúc sớm vẫn trả đủ cả gói (đúng quy tắc app đã nói)");
}

if (FULL) await fullFlow(); else await cancelAndWithdraw();

// 7. Dọn: chuyển AVAX còn dư của ví tạm về issuer (ví vòi)
try {
  const pub = createPublicClient({ chain: avalancheFuji, transport: http(ci!.rpcUrl!) });
  const w = createWalletClient({ account: privateKeyToAccount(key), chain: avalancheFuji, transport: http(ci!.rpcUrl!) });
  const bal = await pub.getBalance({ address: wallet.address as Address });
  const gp = await pub.getGasPrice();
  const fee = 21_000n * gp * 2n;
  if (bal > fee) {
    const h = await w.sendTransaction({ to: manifest.roles.issuer as Address, value: bal - fee, gas: 21_000n, maxFeePerGas: gp * 2n, maxPriorityFeePerGas: 0n });
    await pub.waitForTransactionReceipt({ hash: h });
    info(`đã chuyển ${formatEther(bal - fee)} AVAX còn dư về issuer: ${tx(h)}`);
  }
} catch (e) { info(`không chuyển lại được AVAX dư (không ảnh hưởng kết quả): ${(e as Error).message.slice(0, 100)}`); }

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} đạt (${el()})`);
process.exit(ok === results.length ? 0 : 1);

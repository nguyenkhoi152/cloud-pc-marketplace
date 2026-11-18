/**
 * E2E KHÔNG GIAO DIỆN: người thuê (ví GIẢ LẬP bằng khoá viem cục bộ) đi trọn một phiên thuê trên:
 *   Supabase dev THẬT + API HTTP thật + worker thật (WORKER_PROVIDER=agent) + host-agent thật + gateway thật + Selkies thật (VM)
 *   + chuỗi Hardhat CỤC BỘ chainId 43113 (MÔ PHỎNG, không phải Fuji; khoá Hardhat công khai, vô giá trị).
 * Trình tự: đăng nhập → liên kết ví (chữ ký) → nạp ví giả lập → giữ máy → quote → approve+fund → reconcile → [worker: prepare → activate →
 * grant] → connect → mở màn hình → accept (kết thúc) → [worker: thu hồi → reset guest → verify → nhả máy].
 * Ghi vào Supabase dev: ví liên kết, booking, chain_events, outbox/agent_commands, audit — của tài khoản demo. Không in token/khoá/mật khẩu.
 * Chạy:  npx tsx scripts/vm/renter-session-e2e.mts <stateFile> <thư-mục-ảnh> <secretsDir> <knownHostsFile> <apiBase>
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import WebSocket from "ws";
import { sshDockerRunner } from "../../host-agent/src/dockerGuest";

const [stateFile, shots, secrets, knownHosts, apiBase = "http://127.0.0.1:3000/api"] = process.argv.slice(2);
if (!stateFile || !shots || !secrets || !knownHosts) throw new Error("Dùng: <stateFile> <shotsDir> <secretsDir> <knownHostsFile> [apiBase]");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const parse = (f: string): Record<string, string> => existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")])) : {};
const desk = parse(path.join(root, "desktop/.env.local")), smoke = parse(path.join(root, "desktop/.env.smoke.local"));
const SU = desk.VITE_SUPABASE_URL!.replace(/\/+$/, ""), KEY = desk.VITE_SUPABASE_ANON_KEY!;
const state = JSON.parse(readFileSync(stateFile, "utf8")) as { machineId: string; priceUnits: string };
const manifest = JSON.parse(readFileSync(path.join(root, "contracts/deployments/localhost.json"), "utf8")) as { contracts: { PCP: { address: Hex }; RentalEscrow: { address: Hex } } };
const PCP = manifest.contracts.PCP.address, ESCROW = manifest.contracts.RentalEscrow.address;
const abi = (n: string) => JSON.parse(readFileSync(path.join(root, `packages/shared/src/abi/${n}.json`), "utf8"));
const pcpAbi = abi("PCP"), escrowAbi = abi("RentalEscrow");
mkdirSync(shots, { recursive: true });

const results: boolean[] = [];
const check = (ok: boolean, name: string, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const info = (m: string) => console.log(`INFO  ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now(); const el = () => `${Math.round((Date.now() - T0) / 1000)}s`;
const abort = (m: string): never => { check(false, m); console.log(`\n${results.filter(Boolean).length}/${results.length} đạt (dừng sớm)`); process.exit(1); };

// ---- Supabase REST + API ----
// Lỗi mạng thoáng qua (hết giờ kết nối tới Supabase) được thử lại; lỗi HTTP vẫn trả nguyên cho nơi gọi.
const jf = async (url: string, init: RequestInit, tries = 4) => {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url, init); const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* không phải JSON */ } return { status: r.status, j, text: t }; }
    catch (e) { if (i >= tries) throw e; await sleep(3000 * i); }
  }
};
const login = await jf(`${SU}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: smoke.DEMO_RENTER_EMAIL, password: smoke.DEMO_RENTER_PASSWORD }) });
if (!login.j?.access_token) abort("đăng nhập người thuê demo thất bại");
const jwt: string = login.j.access_token; const userId: string = login.j.user.id;
check(true, "đăng nhập người thuê demo (Supabase Auth thật)");
const rest = (p: string, init: RequestInit = {}) => jf(`${SU}/rest/v1${p}`, { ...init, headers: { apikey: KEY, authorization: `Bearer ${jwt}`, "content-type": "application/json", ...(init.headers ?? {}) } });
const api = (m: string, p: string, body?: unknown) => jf(`${apiBase}${p}`, { method: m, headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

// ---- Chuỗi cục bộ + ví giả lập ----
const RPC = "http://127.0.0.1:8545";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(RPC)) abort("RPC không phải loopback — dừng (ví giả lập chỉ cho chuỗi cục bộ)");
const pub = createPublicClient({ transport: http(RPC) });
const renter = privateKeyToAccount(smoke.DEMO_RENTER_WALLET_KEY as Hex);
const issuer = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"); // Hardhat #4 (khoá công khai) = ISSUER của deploy cục bộ
const wallet = createWalletClient({ account: renter, transport: http(RPC) });
const issuerW = createWalletClient({ account: issuer, transport: http(RPC) });
const chainId = await pub.getChainId();
check(chainId === 43113, "chuỗi cục bộ đúng chainId 43113", `chainId=${chainId}`);
const write = async (w: typeof wallet, address: Hex, a: unknown, functionName: string, args: unknown[]) => {
  const hash = await w.writeContract({ address, abi: a as never, functionName, args, chain: null } as never);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") abort(`giao dịch ${functionName} thất bại`);
  return hash;
};

// 1. Liên kết ví bằng chữ ký
// Ví liên kết trong DB phải ĐÚNG là ví script này ký (quote ghi địa chỉ renter từ DB; escrow từ chối InvalidQuote nếu người gửi khác).
// Tài khoản demo cũng được dùng trong app (ví giả lập của app là một khoá khác), nên phải so địa chỉ chứ không chỉ kiểm "đã có ví".
const linkedAddr = async () => ((await rest(`/wallet_links?select=address&user_id=eq.${userId}`)).j as { address: string }[] | null)?.[0]?.address?.toLowerCase() ?? null;
if ((await linkedAddr()) === renter.address.toLowerCase()) check(true, "ví giả lập của script đã được liên kết từ trước");
else {
  let linked = false;
  // Máy chủ chặn đổi ví khi tài khoản còn booking đang sống. Chờ HẾT booking sống (worker nhả sau hạn thanh toán) rồi mới xin challenge,
  // vì mỗi challenge tính vào hạn mức 10 phút của máy chủ (429 rate_limited nếu xin lặp).
  const liveCount = async () => ((await rest(`/bookings?select=id,state,access_state&renter_id=eq.${userId}&state=in.(reserved,funded,active,disputed)`)).j as unknown[] | null)?.length ?? 0;
  let told = false;
  for (let i = 0; i < 60 && (await liveCount()) > 0; i++) {
    if (!told) { info("tài khoản đang liên kết ví khác (ví giả lập của app) và còn booking đang sống ⇒ máy chủ chặn đổi ví; chờ worker nhả booking (sau hạn thanh toán)…"); told = true; }
    await sleep(15_000);
  }
  for (let i = 0; i < 4 && !linked; i++) {
    const ch = await api("POST", "/wallet/challenge", { address: renter.address, chainId: 43113 });
    if (ch.status !== 200) abort(`tạo challenge ví thất bại (HTTP ${ch.status} ${ch.j?.error?.code ?? ""})`);
    const sig = await renter.signMessage({ message: ch.j.message });
    const vr = await api("POST", "/wallet/verify", { nonce: ch.j.nonce, signature: sig });
    if (vr.status === 200 && vr.j?.linked === true) { linked = true; break; }
    if (vr.j?.error?.code !== "wallet_change_blocked") abort(`liên kết ví thất bại (HTTP ${vr.status} ${vr.j?.error?.code ?? ""})`);
    await sleep(30_000); // booking còn sống ở thời điểm xác minh (tranh chấp thời gian): thử lại, tối đa 4 lần
  }
  check(linked && (await linkedAddr()) === renter.address.toLowerCase(), "liên kết ví giả lập của script bằng chữ ký (server xác minh; thay ví cũ)", `[${el()}]`);
  if (!linked) abort("không liên kết được ví của script");
}

// 2. Nạp ví giả lập: gas + PCP qua issuer (faucet 1 lần/ví theo hợp đồng) + approve
await pub.request({ method: "hardhat_setBalance", params: [renter.address, "0x56BC75E2D63100000"] } as never);
const claimed = (await pub.readContract({ address: PCP, abi: pcpAbi, functionName: "faucetClaimed", args: [renter.address] })) as boolean;
if (!claimed) await write(issuerW, PCP, pcpAbi, "faucetMint", [renter.address]);
const bal = (await pub.readContract({ address: PCP, abi: pcpAbi, functionName: "balanceOf", args: [renter.address] })) as bigint;
check(bal >= BigInt(state.priceUnits), "ví giả lập có đủ PCP (faucet bởi issuer)", `${bal / 10n ** 18n} PCP`);
await write(wallet, PCP, pcpAbi, "approve", [ESCROW, BigInt(state.priceUnits) * 2n]);

// 3. Giữ máy (chờ máy được nhả nếu còn booking cũ chờ hết hạn)
const idem = crypto.randomUUID();
const reqHash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ machine_id: state.machineId, workspace_mode: "none" })))).toString("hex");
let bookingId = "";
// Dùng lại booking đang giữ máy còn hạn của chính người thuê này (tránh phải chờ hết hạn khi chạy lại sau một lần dừng giữa chừng).
{
  const liveRes = await rest(`/bookings?select=id,fund_by&state=eq.reserved&machine_id=eq.${state.machineId}&fund_by=gt.${encodeURIComponent(new Date(Date.now() + 120_000).toISOString())}&order=created_at.desc&limit=1`);
  const live = (liveRes.j as { id: string; fund_by: string }[] | null)?.[0];
  if (live) { bookingId = live.id; info(`dùng lại booking đang giữ máy còn hạn ${live.id.slice(0, 8)}… (fund_by ${live.fund_by})`); }
}
for (let i = 0; i < 40 && !bookingId; i++) {
  const r = await rest("/rpc/reserve_machine", { method: "POST", body: JSON.stringify({ p_machine_id: state.machineId, p_idempotency_key: idem, p_request_hash: reqHash, p_workspace_mode: "none" }) });
  if (r.status < 300 && r.j?.id) { bookingId = r.j.id; break; }
  if (i === 0) info(`máy chưa giữ được (${String(r.text).slice(0, 80)}); chờ worker nhả booking cũ…`);
  await sleep(15_000);
}
if (!bookingId) abort("không giữ được máy sau 10 phút");
check(true, "giữ máy thật (reserve_machine trên Supabase)", `booking ${bookingId.slice(0, 8)}… [${el()}]`);
const bookingRow = async () => ((await rest(`/bookings?select=state,access_state,fund_by,end_at,started_at&id=eq.${bookingId}`)).j as { state: string; access_state: string; end_at: string | null }[])[0]!;
info(`trạng thái đầu: ${JSON.stringify(await bookingRow())}`);

// 4. Quote → approve → fund → reconcile
const qr = await api("POST", `/bookings/${bookingId}/quote`, {});
if (qr.status !== 200) abort(`xin quote thất bại (HTTP ${qr.status} ${qr.j?.error?.code ?? ""})`);
const q = Object.fromEntries(Object.entries(qr.j.quote as Record<string, string>).map(([k, v]) => [k, /^[0-9]+$/.test(v) && !["bookingId", "machineKey", "policyHash"].includes(k) ? BigInt(v) : v]));
const fundTx = await write(wallet, ESCROW, escrowAbi, "fund", [q, qr.j.signature]);
check(true, "fund bằng ví giả lập: escrow thật chấp nhận quote do server ký", `tx ${fundTx.slice(0, 12)}… [${el()}]`);
const rec = await api("POST", `/bookings/${bookingId}/reconcile`, { txHash: fundTx });
check(rec.status === 200, "đối soát sự kiện Funded từ receipt", `HTTP ${rec.status} ${JSON.stringify(rec.j).slice(0, 80)}`);

// 5. Chờ worker + host-agent: prepare → activate → grant
const waitFor = async (what: string, pred: (b: { state: string; access_state: string }) => boolean, ms: number) => {
  const end = Date.now() + ms; let last = ""; let b = await bookingRow();
  while (Date.now() < end) { b = await bookingRow(); const s = `${b.state}/${b.access_state}`; if (s !== last) { info(`[${el()}] ${what}: ${s}`); last = s; } if (pred(b)) return b; await sleep(4000); }
  return null;
};
const active = await waitFor("chờ kích hoạt+cấp quyền", (b) => b.state === "active" && b.access_state === "granted", 8 * 60_000);
check(!!active, "worker kích hoạt trên chuỗi (operator) và host-agent cấp quyền xem", active ? `state=${active.state}, access=${active.access_state} [${el()}]` : "hết giờ chờ");
if (!active) abort("phiên không lên Active/granted");
const onchain = (await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "stateOf", args: [q.bookingId] })) as number;
info(`trạng thái trên chuỗi (enum RentalEscrow.State) = ${onchain}`);

// 6. connect → mở màn hình
const guestRunner = sshDockerRunner({ target: "cpm@127.0.0.1", port: 2222, keyFile: path.join(secrets, "cpm-test-host.ed25519"), knownHostsFile: knownHosts });
const idBefore = (await guestRunner.docker(["inspect", "--format", "{{.Id}}", "selkies"], 60_000).catch(() => ({ stdout: "" }))).stdout.trim();
const cn = await api("POST", `/bookings/${bookingId}/connect`, {});
check(cn.status === 200 && /\/__gw\/redeem\?t=/.test(cn.j?.viewerUrl ?? ""), "connect trả đường dẫn xem một lần của gateway", `HTTP ${cn.status}`);
const cn2 = await api("POST", `/bookings/${bookingId}/connect`, {});
check(cn2.status === 409, "nhận token lần hai bị từ chối (chỉ nhận một lần)", `HTTP ${cn2.status} ${cn2.j?.error?.code ?? ""}`);
const viewerUrl: string = cn.j.viewerUrl;

const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync)!;
const profile = mkdtempSync(path.join(os.tmpdir(), "cpm-rs-")); const port = 9700 + Math.floor(Math.random() * 200);
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions", "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
let cdp: WebSocket | undefined;
try {
  let wsUrl: string | undefined;
  for (let i = 0; i < 60 && !wsUrl; i++) { try { wsUrl = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* chưa sẵn sàng */ } if (!wsUrl) await sleep(200); }
  cdp = new WebSocket(wsUrl!); await new Promise((r) => cdp!.on("open", r));
  let id = 0; const pend = new Map<number, (v: any) => void>();
  cdp.on("message", (raw) => { const m = JSON.parse(String(raw)); if (m.id && pend.has(m.id)) { pend.get(m.id)!(m.result); pend.delete(m.id); } });
  const send = (method: string, params: object = {}) => new Promise<any>((res) => { const i = ++id; pend.set(i, res); cdp!.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e: string) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async (n: string) => { const d = (await send("Page.captureScreenshot", { format: "png" })).data as string; writeFileSync(path.join(shots, n), Buffer.from(d, "base64")); return Math.round(d.length * 0.75); };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: viewerUrl });
  await sleep(45_000); // VM 1 vCPU mã hóa bằng CPU: cho thời gian
  const page = JSON.parse(String(await ev("JSON.stringify({title:document.title,canvas:[...document.querySelectorAll('canvas')].map(c=>c.width+'x'+c.height)})")));
  const bytes = await shot("session-1-xem-man-hinh.png");
  check(page.title === "Selkies" && page.canvas.some((c: string) => Number(c.split("x")[0]) > 600), "người thuê thấy màn hình Selkies của máy host qua gateway", `title=${page.title}, canvas=${page.canvas.join(",")}, ảnh ${bytes} byte`);

  // 7. Kết thúc: accept → Settled → worker thu hồi quyền → reset guest → xác minh → nhả máy
  const acceptTx = await write(wallet, ESCROW, escrowAbi, "accept", [q.bookingId]);
  check(true, "người thuê kết thúc: accept → thanh toán cho host (Settled trên chuỗi)", `tx ${acceptTx.slice(0, 12)}… [${el()}]`);
  const rec2 = await api("POST", `/bookings/${bookingId}/reconcile`, { txHash: acceptTx });
  check(rec2.status === 200, "đối soát sự kiện kết thúc", `HTTP ${rec2.status}`);
  const done = await waitFor("chờ thu hồi + reset + nhả máy", (b) => b.state === "settled" && b.access_state === "reset_verified", 10 * 60_000);
  check(!!done, "worker thu hồi quyền, host-agent reset guest và xác minh; booking về trạng thái cuối (máy được nhả)", done ? `state=${done.state}, access=${done.access_state} [${el()}]` : "hết giờ chờ");
  await send("Page.navigate", { url: `${new URL(viewerUrl).origin}/` });
  await sleep(4000);
  const after = String(await ev("document.body ? document.body.innerText.slice(0,60) : ''"));
  await shot("session-2-sau-khi-ket-thuc.png");
  check(/unauthorized/i.test(after), "sau khi kết thúc, gateway không cho vào lại bằng phiên cũ", `trang: "${after.replace(/\s+/g, " ").slice(0, 30)}"`);
} catch (e) {
  check(false, "kịch bản chạy hết không ngoại lệ", String((e as Error).message).slice(0, 300));
} finally {
  try { cdp?.close(); } catch { /* bỏ qua */ }
  edge.kill(); await sleep(500);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* Windows còn giữ file */ }
}
const idAfter = (await guestRunner.docker(["inspect", "--format", "{{.Id}}", "selkies"], 60_000).catch(() => ({ stdout: "" }))).stdout.trim();
check(!!idBefore && !!idAfter && idBefore !== idAfter, "guest Selkies đã được tạo lại sau phiên (container mới)", `${idBefore.slice(0, 12)} → ${idAfter.slice(0, 12)}`);
const fin = await bookingRow();
info(`trạng thái cuối trong DB: ${JSON.stringify(fin)}`);
console.log(`\n${results.filter(Boolean).length}/${results.length} đạt, tổng ${el()}. Ảnh: ${shots}`);
process.exit(results.every(Boolean) ? 0 : 1);

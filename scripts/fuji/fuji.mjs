#!/usr/bin/env node
/**
 * Công cụ Fuji (testnet) cho bản thử với người khác. KHÔNG bao giờ in khoá riêng.
 *
 *   node scripts/fuji/fuji.mjs gen    [--dir C:\cpm-demo\fuji] [--testers 10]   Sinh khoá vai trò (một lần), in ĐỊA CHỈ + số AVAX testnet cần nạp.
 *   node scripts/fuji/fuji.mjs status [--dir …] [--testers 10]                  Chỉ đọc: chainId, số dư từng địa chỉ, đủ để deploy/chạy chưa.
 *   node scripts/fuji/fuji.mjs fund   [--dir …] [--each 0.1] [--keep 0.5] [--testers N] [--dry]
 *                                                                               Chuyển từ ví ISSUER sang deployer và operator cho đủ mức --each; issuer giữ lại ≥ --keep (mặc định 0.5) cho vòi.
 *                                                                               Kiểm ngân sách theo gas hiện tại; --dry chỉ tính và in, không gửi giao dịch.
 *   node scripts/fuji/fuji.mjs deploy [--dir …]                                 Deploy PCP + RentalEscrow lên Fuji (tốn gas testnet), ghi server.env.
 *
 * Khoá nằm ở <dir>\keys.json — NGOÀI repo và NGOÀI thư mục đồng bộ OneDrive (script từ chối nếu <dir> nằm trong repo hoặc OneDrive).
 * `deploy` ghi thêm <dir>\server.env (khoá vận hành/ký quote/vòi) để start-demo nạp; file này cũng là bí mật.
 * Không đọc/ghi .env.local hay .env.smoke.local. Tất cả là TESTNET: AVAX/PCP không có giá trị tiền.
 */
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatEther, http, isAddress, parseEther } from "viem";
import { avalancheFuji } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RPC = process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
/** RPC của SERVER (đọc log theo khoảng khối lớn; api.avax-test.network chỉ cho 100 khối, publicnode cho 50.000 — đo ngày 12/11/2026). Ví trong app dùng RPC chính thức ở trên. */
const SERVER_RPC = process.env.CPM_SERVER_RPC || "https://avalanche-fuji-c-chain-rpc.publicnode.com";
const ROLES = ["deployer", "operator", "arbitrator", "quoteSigner", "issuer", "treasury"];
/** Vai trò phải có AVAX testnet để trả gas. quoteSigner/arbitrator/treasury không gửi giao dịch trong luồng demo. */
const NEEDS_GAS = ["deployer", "operator", "issuer"];

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
/**
 * Số AVAX dạng thập phân KHÔNG ÂM (≤ 18 chữ số thập phân) → wei. Từ chối âm, rỗng, ký hiệu khoa học và việc `opt` nuốt nhầm cờ kế tiếp
 * (ví dụ `--keep --dry` ⇒ "--dry" không khớp dạng số ⇒ lỗi). `parseEther("-1")` sẽ trả số âm nên phải chặn trước.
 */
function avaxOpt(name, dflt, { allowZero }) {
  const raw = opt(name, dflt);
  if (!/^\d{1,6}(\.\d{1,18})?$/.test(raw)) throw new Error(`--${name} phải là số AVAX không âm dạng 0.03 (nhận được "${String(raw).slice(0, 20)}").`);
  const v = parseEther(raw);
  if (!allowZero && v === 0n) throw new Error(`--${name} phải lớn hơn 0.`);
  return v;
}
const dir = path.resolve(opt("dir", "C:\\cpm-demo\\fuji"));
const testers = Math.max(1, Number.parseInt(opt("testers", "10"), 10) || 10);
const keysFile = path.join(dir, "keys.json");

const inside = (p, root) => { const r = path.relative(root, p); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };
function assertSafeDir() {
  if (inside(dir, repo)) throw new Error(`Thư mục khoá ${dir} nằm TRONG repo — chọn thư mục ngoài repo.`);
  const od = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean);
  if (/onedrive/i.test(dir) || od.some((o) => inside(dir, path.resolve(o))))
    throw new Error(`Thư mục khoá ${dir} nằm trong OneDrive (sẽ đồng bộ lên đám mây). Dùng ví dụ C:\\cpm-demo\\fuji.`);
}
const loadKeys = () => {
  if (!existsSync(keysFile)) throw new Error(`Chưa có ${keysFile}. Chạy: node scripts/fuji/fuji.mjs gen`);
  const k = JSON.parse(readFileSync(keysFile, "utf8"));
  for (const r of ROLES) if (!/^0x[0-9a-fA-F]{64}$/.test(k[r] ?? "")) throw new Error(`keys.json thiếu/hỏng khoá ${r}`);
  return k;
};
const addrOf = (k, r) => privateKeyToAccount(k[r]).address;
const client = () => createPublicClient({ transport: http(RPC, { timeout: 20_000, retryCount: 2 }) });

/** Ước lượng ngân sách từ giá gas hiện tại (không đoán số tròn). Gas deploy ước lượng thận trọng cho hai contract viaIR + cấu hình. */
async function budget(c) {
  const gp = (g => (g > 2_000_000_000n ? g : 2_000_000_000n))(await c.getGasPrice()); // sàn 2 gwei: giá hiện tại có thể rất thấp nhưng sẽ biến động
  const mk = (gas) => gas * gp * 3n / 2n; // dư 50% cho biến động giá gas
  const dripEach = parseEther(process.env.FAUCET_GAS_AVAX || "0.05");
  return {
    gasPriceGwei: Number(gp) / 1e9,
    transfer: mk(21_000n), // một giao dịch chuyển AVAX thường
    deployer: mk(6_000_000n),
    operator: mk(300_000n * BigInt(testers * 2)),
    issuer: BigInt(testers) * (dripEach + mk(120_000n)),
    note: `tính cho ${testers} người thử, mỗi người ~2 lượt thuê; vòi nhỏ giọt ${formatEther(dripEach)} AVAX/người`,
  };
}

async function gen() {
  assertSafeDir();
  mkdirSync(dir, { recursive: true });
  if (existsSync(keysFile)) {
    console.log(`Đã có ${keysFile} — KHÔNG ghi đè (khoá cũ vẫn dùng). In lại địa chỉ:\n`);
  } else {
    const k = Object.fromEntries(ROLES.map((r) => [r, generatePrivateKey()]));
    writeFileSync(keysFile, JSON.stringify({ network: "fuji", note: "KHOÁ TESTNET BÍ MẬT — không commit, không gửi cho ai", ...k }, null, 2), { flag: "wx" });
    try { // chỉ người dùng hiện tại đọc được (thư mục mới tạo của chính ta; không đụng hệ thống)
      execFileSync("icacls", [dir, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:(OI)(CI)F`], { stdio: "ignore" });
    } catch { /* tuỳ chọn */ }
    console.log(`Đã sinh khoá và lưu ở ${keysFile} (khoá riêng KHÔNG được in).\n`);
  }
  await printStatus(true);
}

async function printStatus(withBudget) {
  const k = loadKeys();
  const addrs = Object.fromEntries(ROLES.map((r) => [r, addrOf(k, r)]));
  writeFileSync(path.join(dir, "addresses.json"), JSON.stringify(addrs, null, 2));
  let c = null, chainId = null, bud = null, bal = {};
  try {
    c = client();
    chainId = await c.getChainId();
    if (chainId === 43113) {
      for (const r of ROLES) bal[r] = await c.getBalance({ address: addrs[r] });
      if (withBudget) bud = await budget(c);
    }
  } catch (e) { console.log(`(Không đọc được Fuji: ${String(e.shortMessage ?? e.message).slice(0, 100)})`); }
  if (chainId !== null) console.log(`RPC: ${chainId === 43113 ? "Avalanche Fuji (43113) — OK" : `chainId ${chainId} — KHÔNG phải Fuji, dừng`}\n`);
  let short = 0;
  for (const r of ROLES) {
    const need = NEEDS_GAS.includes(r);
    const want = bud?.[r];
    const have = bal[r];
    const tag = !need ? "không cần AVAX" : have === undefined ? "?" : want !== undefined ? (have >= want ? "ĐỦ" : "THIẾU") : have > 0n ? "có" : "THIẾU";
    if (need && tag === "THIẾU") short++;
    console.log(`${r.padEnd(12)} ${addrs[r]}   ${have === undefined ? "" : `${formatEther(have)} AVAX`.padEnd(22)} ${need ? `cần nạp: ${want !== undefined ? `≥ ${formatEther(want)} AVAX` : "AVAX testnet"}` : "(không cần AVAX)"}  [${tag}]`);
  }
  if (bud) console.log(`\nNgân sách ước lượng (giá gas ${bud.gasPriceGwei.toFixed(1)} gwei, ${bud.note}). Đây là ước lượng, không phải mức tối thiểu cứng.`);
  console.log(`\nNạp AVAX Fuji (testnet, miễn phí) vào địa chỉ đánh dấu THIẾU từ vòi công khai, ví dụ https://core.app/tools/testnet-faucet/ (chọn Avalanche C-Chain Fuji).`);
  console.log(`Nếu vòi yêu cầu điều kiện bạn không có (ví dụ số dư mainnet hoặc mã coupon), hãy báo lại — chưa nạp đủ thì chưa deploy được.`);
  return { short, addrs, bal, bud };
}

/**
 * Bạn nạp AVAX testnet vào ví issuer; lệnh này chia sang deployer và operator (mỗi ví đủ --each AVAX), issuer giữ lại ≥ --keep AVAX cho vòi
 * (mặc định 0.5). Kiểm ngân sách theo gas HIỆN TẠI: --each phải đủ trả gas deploy/vận hành và --keep phải đủ cho vòi của --testers người.
 * Idempotent: ví đã đủ thì bỏ qua. --dry: chỉ tính và in, không gửi giao dịch nào.
 */
async function fund() {
  // Kiểm đối số TRƯỚC khi chạm khoá hay mạng.
  const each = avaxOpt("each", "0.1", { allowZero: false });
  const keep = avaxOpt("keep", "0.5", { allowZero: true });
  const dry = args.includes("--dry");
  assertSafeDir();
  const k = loadKeys();
  const c = client();
  const chainId = await c.getChainId();
  if (chainId !== 43113) throw new Error(`RPC trả chainId ${chainId}, cần 43113 (Fuji). Dừng.`);
  const bud = await budget(c);
  const f = (v) => formatEther(v);
  console.log(`Ngân sách theo gas hiện tại (${bud.gasPriceGwei.toFixed(2)} gwei, sàn 2 gwei, dư 50%; ${bud.note}):`);
  const checks = [
    ["deployer cần ≥", bud.deployer, "--each", each],
    ["operator cần ≥", bud.operator, "--each", each],
    ["issuer phải giữ ≥", bud.issuer, "--keep", keep],
  ];
  let underfunded = false;
  for (const [what, need, flag, have] of checks) {
    const ok = have >= need;
    if (!ok) underfunded = true;
    console.log(`  ${what.padEnd(18)} ${f(need).padStart(10)} AVAX   (${flag} = ${f(have)})  ${ok ? "ĐỦ" : "THIẾU"}`);
  }
  if (underfunded) throw new Error("Cấu hình --each/--keep thấp hơn ngân sách gas hiện tại (xem THIẾU ở trên). Tăng giá trị hoặc giảm --testers.");
  const issuer = privateKeyToAccount(k.issuer);
  let bal = await c.getBalance({ address: issuer.address });
  const plan = [];
  for (const r of ["deployer", "operator"]) {
    const to = addrOf(k, r);
    const have = await c.getBalance({ address: to });
    if (have < each) plan.push({ r, to, value: each - have });
  }
  const need = plan.reduce((a, p) => a + p.value, 0n);
  const gasForTransfers = bud.transfer * BigInt(plan.length);
  const left = bal - need - gasForTransfers;
  console.log(`\nIssuer ${issuer.address}: đang có ${f(bal)} AVAX.`);
  for (const p of plan) console.log(`  chuyển ${f(p.value)} AVAX → ${p.r} ${p.to}`);
  console.log(`  tổng chuyển: ${f(need)} AVAX; gas chuyển (ước lượng): ${f(gasForTransfers)} AVAX`);
  console.log(`  issuer còn lại ≈ ${f(left > 0n ? left : 0n)} AVAX (phải giữ ≥ ${f(keep)})`);
  if (!plan.length) return console.log("Deployer và operator đã đủ. Không chuyển gì.");
  if (left < keep) throw new Error(`Issuer chưa đủ: cần ≥ ${f(need + keep + gasForTransfers)} AVAX (chuyển + giữ lại + gas), đang có ${f(bal)}. Nạp thêm AVAX testnet vào ${issuer.address} hoặc giảm --each/--keep.`);
  if (dry) return console.log("\n--dry: không gửi giao dịch nào.");
  const wallet = createWalletClient({ account: issuer, chain: avalancheFuji, transport: http(RPC, { timeout: 20_000 }) });
  for (const p of plan) {
    const hash = await wallet.sendTransaction({ to: p.to, value: p.value });
    const rc = await c.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`Giao dịch tới ${p.r} bị hoàn tác (${hash})`);
    console.log(`đã chuyển ${formatEther(p.value)} AVAX → ${p.r} (${hash})`);
  }
  bal = await c.getBalance({ address: issuer.address });
  console.log(`xong. Issuer còn ${formatEther(bal)} AVAX.`);
}

async function deploy() {
  assertSafeDir();
  const k = loadKeys();
  const c = client();
  const chainId = await c.getChainId();
  if (chainId !== 43113) throw new Error(`RPC trả chainId ${chainId}, cần 43113 (Fuji). Dừng.`);
  const addrs = Object.fromEntries(ROLES.map((r) => [r, addrOf(k, r)]));
  const bud = await budget(c);
  const dep = await c.getBalance({ address: addrs.deployer });
  if (dep < bud.deployer) throw new Error(`Deployer có ${formatEther(dep)} AVAX, cần ≥ ${formatEther(bud.deployer)}. Chạy "status" để xem và nạp thêm.`);
  const manifest = path.join(repo, "contracts", "deployments", "fuji.json");
  if (existsSync(manifest)) throw new Error(`Đã có ${manifest}: đã deploy rồi. Xoá/đổi tên thủ công nếu thật sự muốn deploy lại (sẽ ra địa chỉ mới).`);
  console.log("Deploy PCP + RentalEscrow lên Fuji (testnet)…");
  const env = {
    ...process.env, FUJI_RPC_URL: RPC, FUJI_DEPLOYER_PRIVATE_KEY: k.deployer,
    OPERATOR_ADDRESS: addrs.operator, ARBITRATOR_ADDRESS: addrs.arbitrator, QUOTE_SIGNER_ADDRESS: addrs.quoteSigner, ISSUER_ADDRESS: addrs.issuer, TREASURY_ADDRESS: addrs.treasury,
  };
  // shell:true để chạy npx.cmd trên Windows; khoá chỉ đi qua biến môi trường của tiến trình con, không nằm trong dòng lệnh.
  const r = spawnSync("npx hardhat run scripts/deploy.ts --network fuji", { cwd: path.join(repo, "contracts"), env, shell: true, stdio: "inherit" });
  if (r.status !== 0) throw new Error("Deploy thất bại (xem log ở trên). Không ghi server.env.");
  const m = JSON.parse(readFileSync(manifest, "utf8"));
  if (m.chainId !== 43113 || !isAddress(m.contracts?.PCP?.address) || !isAddress(m.contracts?.RentalEscrow?.address)) throw new Error("fuji.json không hợp lệ");
  const lines = {
    RPC_URL: SERVER_RPC, PUBLIC_RPC_URL: RPC, CHAIN_ID: "43113",
    ESCROW_ADDRESS: m.contracts.RentalEscrow.address, PCP_ADDRESS: m.contracts.PCP.address, TREASURY_ADDRESS: addrs.treasury,
    ESCROW_DEPLOY_BLOCK: String(m.deployBlock ?? ""),
    QUOTE_SIGNER_PRIVATE_KEY: k.quoteSigner, OPERATOR_PRIVATE_KEY: k.operator, FAUCET_PRIVATE_KEY: k.issuer, FAUCET_GAS_AVAX: process.env.FAUCET_GAS_AVAX || "0.05",
    MIN_CONFIRMATIONS: "2",
  };
  if (!lines.ESCROW_DEPLOY_BLOCK) throw new Error("fuji.json thiếu deployBlock (deploy.ts phải ghi) — không ghi server.env để worker không quét từ block 0.");
  writeFileSync(path.join(dir, "server.env"), Object.entries(lines).map(([a, b]) => `${a}=${b}`).join("\n") + "\n");
  console.log(`\nXong. Địa chỉ: PCP ${lines.PCP_ADDRESS}, escrow ${lines.ESCROW_ADDRESS}, khối deploy ${lines.ESCROW_DEPLOY_BLOCK}.`);
  console.log(`Đã ghi ${path.join(dir, "server.env")} (bí mật, ngoài repo). start-demo -Chain fuji sẽ nạp file này.`);
}

try {
  if (cmd === "gen") await gen();
  else if (cmd === "status") { const { short } = await printStatus(true); process.exit(short ? 2 : 0); }
  else if (cmd === "fund") await fund();
  else if (cmd === "deploy") await deploy();
  else { console.log("Dùng: node scripts/fuji/fuji.mjs gen|status|fund|deploy [--dir <thư mục ngoài repo/OneDrive>] [--testers N]"); process.exit(1); }
} catch (e) {
  console.error(`LỖI: ${e.message}`);
  process.exit(1);
}

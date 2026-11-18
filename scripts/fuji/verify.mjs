#!/usr/bin/env node
/**
 * Đối chiếu triển khai Fuji: contracts/deployments/fuji.json  ↔  trạng thái ON-CHAIN  ↔  C:\cpm-demo\fuji\server.env.
 * CHỈ ĐỌC. Không gửi giao dịch. Không in giá trị bí mật: server.env được đọc vào bộ nhớ, khoá riêng chỉ dùng để suy ra ĐỊA CHỈ rồi so với manifest;
 * đầu ra chỉ có địa chỉ công khai và OK/LỆCH.
 *   node scripts/fuji/verify.mjs [--dir C:\cpm-demo\fuji]
 * Mã thoát 0 = mọi kiểm tra đạt; 1 = có LỆCH.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, formatEther, http, isAddressEqual } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const dir = path.resolve(args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "C:\\cpm-demo\\fuji");
const abi = (n) => JSON.parse(readFileSync(path.join(repo, "packages/shared/src/abi", `${n}.json`), "utf8"));
const manifestFile = path.join(repo, "contracts/deployments/fuji.json");
const envFile = path.join(dir, "server.env");
if (!existsSync(manifestFile)) throw new Error(`Thiếu ${manifestFile}`);
if (!existsSync(envFile)) throw new Error(`Thiếu ${envFile}`);
const m = JSON.parse(readFileSync(manifestFile, "utf8"));
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));

let bad = 0;
const row = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? "OK   " : "LỆCH "} ${msg}`); };
const eq = (a, b) => { try { return isAddressEqual(a, b); } catch { return false; } };
const addrOfKey = (k) => (/^0x[0-9a-fA-F]{64}$/.test(k ?? "") ? privateKeyToAccount(k).address : null);

const RPC = env.RPC_URL || "https://avalanche-fuji-c-chain-rpc.publicnode.com";
const c = createPublicClient({ transport: http(RPC, { timeout: 20_000, retryCount: 2 }) });
const escrow = m.contracts.RentalEscrow.address, pcp = m.contracts.PCP.address;

console.log("— manifest —");
row(m.network === "fuji" && m.chainId === 43113, `fuji.json: network=${m.network} chainId=${m.chainId}`);
row(/^\d+$/.test(m.deployBlock ?? ""), `fuji.json có deployBlock=${m.deployBlock}`);

console.log("— on-chain —");
const chainId = await c.getChainId();
row(chainId === 43113, `RPC chainId = ${chainId}`);
for (const [n, a] of [["PCP", pcp], ["RentalEscrow", escrow]]) {
  const code = await c.getCode({ address: a });
  row(!!code && code !== "0x", `${n} ${a} có bytecode (${code ? (code.length - 2) / 2 : 0} byte)`);
}
const rc = await c.getTransactionReceipt({ hash: m.configureEscrowTx });
row(rc.status === "success", `configureEscrowTx receipt: ${rc.status} (khối ${rc.blockNumber})`);
row(rc.blockNumber >= BigInt(m.deployBlock) && rc.blockNumber - BigInt(m.deployBlock) < 200n, `deployBlock ${m.deployBlock} nằm ngay trước khối cấu hình ${rc.blockNumber} (worker quét từ đây)`);

const E = (functionName, a = []) => c.readContract({ address: escrow, abi: abi("RentalEscrow"), functionName, args: a });
const P = (functionName, a = []) => c.readContract({ address: pcp, abi: abi("PCP"), functionName, args: a });
row(eq(await E("acceptedToken"), pcp), "escrow.acceptedToken == PCP");
row(eq(await P("escrow"), escrow), "PCP.escrow == RentalEscrow (đã configureEscrowOnce)");
row(eq(await E("treasury"), m.roles.treasury), "escrow.treasury == roles.treasury");
for (const [k, fn] of [["feeBps", "feeBps"], ["durationSeconds", "durationSeconds"], ["graceSeconds", "graceSeconds"], ["arbitrationSeconds", "arbitrationSeconds"]]) {
  const v = await E(fn);
  row(String(v) === m.config[k], `escrow.${fn} = ${v} (manifest ${m.config[k]})`);
}
const cv = await E("configVersion");
const serverCv = String(env.CONFIG_VERSION ?? "1"); // server mặc định CONFIG_VERSION=1
row(String(cv) === serverCv, `escrow.configVersion = ${cv} (server dùng ${serverCv})`);
const roles = [
  ["admin (DEFAULT_ADMIN_ROLE)", "DEFAULT_ADMIN_ROLE", m.roles.admin], ["operator", "OPERATOR_ROLE", m.roles.operator],
  ["quoteSigner", "QUOTE_SIGNER_ROLE", m.roles.quoteSigner], ["arbitrator", "ARBITRATOR_ROLE", m.roles.arbitrator],
];
for (const [n, rn, who] of roles) row(await E("hasRole", [await E(rn), who]), `escrow: ${n} ${who} có vai trò`);
row(await P("hasRole", [await P("ISSUER_ROLE"), m.roles.issuer]), `PCP: issuer ${m.roles.issuer} có ISSUER_ROLE`);
row(await E("isSolvent"), "escrow.isSolvent()");
row(!(await E("fundingPaused")) && !(await E("activationPaused")), "escrow không bị tạm dừng nạp/kích hoạt");

console.log("— server.env (đối chiếu, không in giá trị) —");
row(env.CHAIN_ID === "43113", "CHAIN_ID = 43113");
row(eq(env.ESCROW_ADDRESS, escrow), "ESCROW_ADDRESS khớp manifest");
row(eq(env.PCP_ADDRESS, pcp), "PCP_ADDRESS khớp manifest");
row(eq(env.TREASURY_ADDRESS, m.roles.treasury), "TREASURY_ADDRESS khớp manifest");
row(env.ESCROW_DEPLOY_BLOCK === m.deployBlock, "ESCROW_DEPLOY_BLOCK khớp manifest");
row(/^https:\/\//.test(env.PUBLIC_RPC_URL ?? "") && /^https:\/\//.test(env.RPC_URL ?? ""), "RPC_URL và PUBLIC_RPC_URL là https");
for (const [n, who] of [["QUOTE_SIGNER_PRIVATE_KEY", m.roles.quoteSigner], ["OPERATOR_PRIVATE_KEY", m.roles.operator], ["FAUCET_PRIVATE_KEY", m.roles.issuer]]) {
  const a = addrOfKey(env[n]);
  row(!!a && eq(a, who), `${n} suy ra đúng địa chỉ vai trò (${who})`);
}

console.log("— số dư AVAX (thông tin) —");
for (const [n, a] of [["deployer/admin", m.roles.admin], ["operator", m.roles.operator], ["issuer (vòi)", m.roles.issuer]]) console.log(`      ${n.padEnd(15)} ${a}  ${formatEther(await c.getBalance({ address: a }))} AVAX`);

console.log(bad ? `\n${bad} mục LỆCH.` : "\nMọi mục đạt.");
process.exit(bad ? 1 : 0);

// Deploy PCP + RentalEscrow, cấu hình escrow một lần, ghi manifest công khai.
//   Local (in-process):  npx hardhat run scripts/deploy.ts
//   Fuji (cần quyền):    npx hardhat run scripts/deploy.ts --network fuji
// Fuji cần biến môi trường riêng (KHÔNG commit): FUJI_RPC_URL, FUJI_DEPLOYER_PRIVATE_KEY
// và địa chỉ công khai: OPERATOR_ADDRESS, ARBITRATOR_ADDRESS, QUOTE_SIGNER_ADDRESS, ISSUER_ADDRESS, TREASURY_ADDRESS.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { network, artifacts } from "hardhat";
import { isAddress, type Address } from "viem";

const { viem, networkName: rawName } = await network.connect();
const networkName = rawName === "default" ? "local" : rawName;
const publicClient = await viem.getPublicClient();
const [deployer, ...others] = await viem.getWalletClients();
if (!deployer) throw new Error("Không có tài khoản deployer");
const chainId = await publicClient.getChainId();

function role(envName: string, fallbackIndex: number): Address {
  const v = process.env[envName];
  if (v) {
    if (!isAddress(v)) throw new Error(`${envName} không phải địa chỉ hợp lệ`);
    return v;
  }
  if (networkName === "fuji") throw new Error(`Thiếu ${envName} (bắt buộc khi deploy Fuji)`);
  const w = others[fallbackIndex];
  if (!w) throw new Error(`Thiếu tài khoản local cho ${envName}`);
  return w.account.address; // chỉ cho mạng local mô phỏng
}

if (networkName === "fuji" && chainId !== 43113) throw new Error(`Sai chainId ${chainId}, cần 43113`);

const admin = deployer.account.address;
const operator = role("OPERATOR_ADDRESS", 0);
const arbitrator = role("ARBITRATOR_ADDRESS", 1);
const quoteSigner = role("QUOTE_SIGNER_ADDRESS", 2);
const issuer = role("ISSUER_ADDRESS", 3);
const treasury = role("TREASURY_ADDRESS", 4);
const config = { feeBps: 1000n, durationSeconds: 900n, graceSeconds: 600n, arbitrationSeconds: 86_400n };

const pcp = await viem.deployContract("PCP", [admin, issuer]);
const escrow = await viem.deployContract("RentalEscrow", [
  pcp.address, admin, operator, arbitrator, quoteSigner,
  config.feeBps, treasury, config.durationSeconds, config.graceSeconds, config.arbitrationSeconds,
]);
const cfgTx = await pcp.write.configureEscrowOnce([escrow.address]);
await publicClient.waitForTransactionReceipt({ hash: cfgTx });

const deployTx = async (addr: Address) => {
  // Với mạng thật, tx deploy lấy từ receipt tạo contract; local chỉ cần địa chỉ.
  const code = await publicClient.getCode({ address: addr });
  return code && code !== "0x" ? "deployed" : "missing";
};
if ((await deployTx(pcp.address)) !== "deployed" || (await deployTx(escrow.address)) !== "deployed") {
  throw new Error("Contract không có code sau deploy");
}

const build = JSON.parse(
  readFileSync(path.join(process.cwd(), "artifacts/contracts/RentalEscrow.sol/RentalEscrow.json"), "utf8"),
) as { sourceName: string };
const manifest = {
  network: networkName,
  chainId,
  note: networkName === "fuji" ? "Fuji testnet — token thử, không có giá trị tiền thật" : "Mạng local mô phỏng — KHÔNG phải deployment thật",
  deployedAt: new Date().toISOString(),
  contracts: {
    PCP: { address: pcp.address, source: "contracts/PCP.sol" },
    RentalEscrow: { address: escrow.address, source: build.sourceName, domain: { name: "CloudPCRentalEscrow", version: "1" } },
  },
  configureEscrowTx: cfgTx,
  roles: { admin, operator, arbitrator, quoteSigner, issuer, treasury },
  config: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, v.toString()])),
  compiler: { solc: "0.8.28", optimizer: { enabled: true, runs: 200 }, viaIR: true },
};
mkdirSync("deployments", { recursive: true });
const out = `deployments/${networkName}.json`;
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Đã ghi ${out}`);
console.log(JSON.stringify({ PCP: pcp.address, RentalEscrow: escrow.address, chainId }, null, 2));

// Xuất ABI cho web/worker.
const abiDir = path.join(process.cwd(), "../packages/shared/src/abi");
mkdirSync(abiDir, { recursive: true });
for (const name of ["PCP", "RentalEscrow"]) {
  const art = await artifacts.readArtifact(name);
  writeFileSync(path.join(abiDir, `${name}.json`), JSON.stringify(art.abi, null, 2) + "\n");
}
console.log("Đã xuất ABI vào packages/shared/src/abi");

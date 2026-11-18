#!/usr/bin/env node
/**
 * Kiểm tra TRƯỚC khi deploy Fuji. CHỈ ĐỌC: không gửi giao dịch, không ký, không ghi file.
 * Đọc biến môi trường của tiến trình (KHÔNG đọc/ghi file .env, KHÔNG in giá trị khoá/URL):
 *   FUJI_RPC_URL, FUJI_DEPLOYER_PRIVATE_KEY, OPERATOR_ADDRESS, ARBITRATOR_ADDRESS, QUOTE_SIGNER_ADDRESS, ISSUER_ADDRESS, TREASURY_ADDRESS
 * Kiểm: đủ biến; địa chỉ hợp lệ; khoá hợp lệ → in địa chỉ deployer (công khai); RPC trả chainId 43113; số dư AVAX của deployer
 * (chỉ để trả gas, token thử); địa chỉ vai trò chưa có code (là ví EOA); cảnh báo vai trò trùng nhau.
 * Chạy (PowerShell, đặt biến trong phiên hiện tại, không lưu vào Git):  node scripts/fuji-preflight.mjs
 * Mã thoát 0 = đủ điều kiện để chạy `npx hardhat run scripts/deploy.ts --network fuji` trong thư mục contracts (bước đó cần bạn đồng ý riêng).
 * CHƯA CHẠY với dữ liệu thật (chưa có ví/RPC) — xem docs/FUJI_RUNBOOK.md.
 */
import { createPublicClient, formatEther, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const REQUIRED = ["FUJI_RPC_URL", "FUJI_DEPLOYER_PRIVATE_KEY", "OPERATOR_ADDRESS", "ARBITRATOR_ADDRESS", "QUOTE_SIGNER_ADDRESS", "ISSUER_ADDRESS", "TREASURY_ADDRESS"];
const MIN_AVAX = 0.2; // đủ cho vài lần deploy + cấu hình trên testnet; chỉ là ngưỡng cảnh báo
let bad = 0;
const row = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? "OK   " : "THIẾU"}  ${msg}`); };

const missing = REQUIRED.filter((k) => !process.env[k]);
for (const k of REQUIRED) row(!!process.env[k], `${k}: ${process.env[k] ? "có" : "chưa đặt"}`);
if (missing.length) {
  console.log(`\nChưa đủ biến (${missing.join(", ")}). Không kết nối mạng. Xem docs/FUJI_RUNBOOK.md.`);
  process.exit(1);
}

let account = null;
const pk = process.env.FUJI_DEPLOYER_PRIVATE_KEY;
try {
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("dạng khoá");
  account = privateKeyToAccount(pk);
  row(true, `Khoá deployer hợp lệ → địa chỉ công khai ${account.address}`);
} catch {
  row(false, "FUJI_DEPLOYER_PRIVATE_KEY không đúng dạng 0x + 64 hex");
}

const roles = {};
for (const k of REQUIRED.slice(2)) {
  const v = process.env[k];
  const okAddr = isAddress(v);
  row(okAddr, `${k} là địa chỉ hợp lệ`);
  if (okAddr) roles[k] = v.toLowerCase();
}
const dup = Object.entries(roles).filter(([, a], i, arr) => arr.findIndex(([, b]) => b === a) !== i).map(([k]) => k);
if (dup.length) console.log(`CẢNH BÁO  Vai trò trùng địa chỉ với vai trò khác: ${dup.join(", ")} (cho phép ở demo nhưng giảm tách quyền; operator/quote signer nên khác treasury)`);
if (account && Object.values(roles).includes(account.address.toLowerCase())) console.log("CẢNH BÁO  Một vai trò trùng địa chỉ deployer (deployer là admin ban đầu).");

try {
  const client = createPublicClient({ transport: http(process.env.FUJI_RPC_URL, { timeout: 15_000, retryCount: 1 }) });
  const chainId = await client.getChainId();
  row(chainId === 43113, `RPC trả chainId ${chainId} ${chainId === 43113 ? "(Fuji)" : "— KHÔNG phải Fuji 43113, dừng"}`);
  if (account && chainId === 43113) {
    const bal = await client.getBalance({ address: account.address });
    row(Number(formatEther(bal)) >= MIN_AVAX, `Số dư AVAX Fuji của deployer: ${formatEther(bal)} (cần ≥ ${MIN_AVAX} để trả gas)`);
    for (const [k, a] of Object.entries(roles)) {
      const code = await client.getCode({ address: a });
      row(!code || code === "0x", `${k} là ví thường (chưa có code)`);
    }
  }
} catch {
  row(false, "Không kết nối được RPC (lỗi mạng/URL sai/hết thời gian) — không in URL");
}

console.log(bad ? `\nChưa đủ điều kiện: ${bad} mục. Không deploy.` : "\nĐủ điều kiện (chỉ đọc). Deploy cần lệnh riêng và sự đồng ý của chủ dự án; không broadcast từ script này.");
process.exit(bad ? 1 : 0);

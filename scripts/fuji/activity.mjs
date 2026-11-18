#!/usr/bin/env node
/**
 * Xem hoạt động trên Fuji của triển khai hiện có. CHỈ ĐỌC dữ liệu công khai trên chuỗi: không gửi giao dịch, không đọc khoá, không đọc .env.
 *   node scripts/fuji/activity.mjs
 * In: tổng PCP đã phát hành, PCP đang bị khoá trong escrow, credit chưa rút, số giao dịch đã gửi của ví vòi và operator, số dư AVAX ví vòi.
 * Dùng để biết đã có ai chạy luồng thuê trên Fuji chưa (sau deploy: PCP = 0, không khoá, issuer nonce = 3).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, formatEther, http } from "viem";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(path.join(repo, "contracts/deployments/fuji.json"), "utf8"));
const abi = (name) => JSON.parse(readFileSync(path.join(repo, "packages/shared/src/abi", `${name}.json`), "utf8"));
const client = createPublicClient({ transport: http("https://avalanche-fuji-c-chain-rpc.publicnode.com", { timeout: 20_000, retryCount: 2 }) });

const escrow = (functionName) => client.readContract({ address: manifest.contracts.RentalEscrow.address, abi: abi("RentalEscrow"), functionName });
const pcp = (functionName) => client.readContract({ address: manifest.contracts.PCP.address, abi: abi("PCP"), functionName });

console.log("PCP đã phát hành (totalSupply):", formatEther(await pcp("totalSupply")));
console.log("PCP đang bị khoá trong escrow :", formatEther(await escrow("lockedPrincipal")));
console.log("Credit chưa rút (totalCredits):", formatEther(await escrow("totalCredits")));
console.log("Ví vòi (issuer)  : nonce", await client.getTransactionCount({ address: manifest.roles.issuer }), "| AVAX", formatEther(await client.getBalance({ address: manifest.roles.issuer })));
console.log("Operator         : nonce", await client.getTransactionCount({ address: manifest.roles.operator }));
console.log("Khối hiện tại    :", String(await client.getBlockNumber()), "(khối deploy", manifest.deployBlock + ")");

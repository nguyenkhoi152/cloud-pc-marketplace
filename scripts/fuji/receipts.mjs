#!/usr/bin/env node
/**
 * Biên nhận (giao dịch) của chu trình thuê trên Fuji, đọc thẳng từ log của hợp đồng RentalEscrow. CHỈ ĐỌC dữ liệu công khai:
 * không gửi giao dịch, không đọc khoá, không đọc .env; chỉ dùng địa chỉ trong contracts/deployments/fuji.json và RPC công khai.
 *   node scripts/fuji/receipts.mjs          # tóm tắt dạng chữ
 *   node scripts/fuji/receipts.mjs --md     # thêm bảng Markdown để dán vào README
 * In số sự kiện theo loại, rồi các giao dịch thật của một chu trình đầy đủ (nạp tiền → kích hoạt → chia tiền), của một lần hoàn tiền
 * và một lần rút tiền gần nhất, kèm số học phí so với feeBps lấy từ chính log Funded. Ai cũng chạy lại được để đối chiếu với Snowtrace.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, decodeEventLog, formatEther, http } from "viem";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(path.join(repo, "contracts/deployments/fuji.json"), "utf8"));
const abi = JSON.parse(readFileSync(path.join(repo, "packages/shared/src/abi/RentalEscrow.json"), "utf8"));
const address = manifest.contracts.RentalEscrow.address;
const client = createPublicClient({ transport: http("https://avalanche-fuji-c-chain-rpc.publicnode.com", { timeout: 25_000, retryCount: 3 }) });
const md = process.argv.includes("--md");
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const tx = (h) => `https://testnet.snowtrace.io/tx/${h}`;

const head = await client.getBlockNumber();
const from = BigInt(manifest.deployBlock);
const logs = [];
let step = 5000n;
for (let a = from; a <= head; ) {
  const b = a + step - 1n > head ? head : a + step - 1n;
  try {
    logs.push(...(await client.getLogs({ address, fromBlock: a, toBlock: b })));
    a = b + 1n;
  } catch (e) {
    if (step <= 250n) throw e;
    step /= 2n; // RPC công khai giới hạn khoảng khối: thu nhỏ và thử lại
  }
}
const events = [];
for (const l of logs) {
  try {
    const d = decodeEventLog({ abi, data: l.data, topics: l.topics });
    events.push({ name: d.eventName, args: d.args ?? {}, block: l.blockNumber, hash: l.transactionHash });
  } catch {
    /* log không thuộc ABI này */
  }
}
const of = (n) => events.filter((e) => e.name === n);
const count = (n) => of(n).length;
console.log(`RentalEscrow ${address} | khối ${manifest.deployBlock} → ${head} | ${events.length} sự kiện`);
console.log(["Funded", "Activated", "Settled", "Refunded", "CreditWithdrawn", "DisputeOpened", "Resolved"].map((n) => `${n} ${count(n)}`).join(" · "));

const byBooking = (id) => events.filter((e) => e.args.bookingId === id);
const settledIds = of("Settled").map((e) => e.args.bookingId);
const cycleId = [...settledIds].reverse().find((id) => byBooking(id).some((e) => e.name === "Funded") && byBooking(id).some((e) => e.name === "Activated"));
const rows = [];
if (cycleId) {
  const f = byBooking(cycleId).find((e) => e.name === "Funded");
  const s = byBooking(cycleId).find((e) => e.name === "Settled");
  const fee = (s.args.hostGross * f.args.feeBps) / 10_000n;
  console.log(`\nChu trình đầy đủ gần nhất (bookingId ${short(cycleId)}): giá ${formatEther(f.args.priceUnits)} PCP, phí ${Number(f.args.feeBps) / 100}% = ${formatEther(fee)} PCP, host nhận ${formatEther(s.args.hostGross - fee)} PCP`);
  for (const n of ["Funded", "Activated", "Settled"]) {
    const e = byBooking(cycleId).find((x) => x.name === n);
    console.log(`  ${n.padEnd(10)} khối ${e.block}  ${tx(e.hash)}`);
    rows.push([n === "Funded" ? "Nạp PCP vào escrow (`fund`)" : n === "Activated" ? "Kích hoạt phiên (`activate`)" : "Kết thúc và chia tiền (`accept`)", e.hash]);
  }
} else console.log("\nChưa có chu trình nạp tiền → kích hoạt → chia tiền nào trong log.");
for (const [n, label] of [["Refunded", "Hoàn tiền cho người thuê (`cancel` hoặc `refund`)"], ["CreditWithdrawn", "Rút tiền về ví (`withdrawPCP`)"]]) {
  const e = of(n).at(-1);
  if (e) {
    console.log(`${n.padEnd(15)} gần nhất: khối ${e.block}  ${tx(e.hash)}  (${formatEther(e.args.amount)} PCP)`);
    rows.push([label, e.hash]);
  } else console.log(`${n}: chưa có trong log`);
}
if (md && rows.length) {
  console.log("\n| Bước | Giao dịch trên Snowtrace |\n| --- | --- |");
  for (const [label, h] of rows) console.log(`| ${label} | [\`${short(h)}\`](${tx(h)}) |`);
}

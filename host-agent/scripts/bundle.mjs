// Đóng gói host-agent thành MỘT tệp CommonJS chạy bằng Node >= 18 trong guest Linux của máy host (WSL2 hoặc máy Linux).
// Kết quả: host-agent/dist/cpm-host-agent.cjs (+ .sha256). App Companion nhúng tệp này làm tài nguyên rồi chép vào guest.
// Dùng: npm run bundle -w @cpm/host-agent
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "cpm-host-agent.cjs");
mkdirSync(path.dirname(out), { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "cli.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  legalComments: "none",
  // `ws` nạp tuỳ chọn hai module native tăng tốc; không có thì tự dùng bản JS thuần.
  external: ["bufferutil", "utf-8-validate"],
  logLevel: "warning",
});
const bytes = readFileSync(out);
const sha = createHash("sha256").update(bytes).digest("hex");
writeFileSync(`${out}.sha256`, `${sha}\n`);
console.log(`đã đóng gói ${path.relative(root, out)} (${bytes.length} byte, sha256 ${sha.slice(0, 16)}…)`);

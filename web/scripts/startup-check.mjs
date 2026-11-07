// Kiểm tra hành vi khởi động thật của ứng dụng (cần `npm run build` trước).
// Chạy `next start` với từng bộ env và xác nhận HTTP status: production sai/thiếu cấu hình -> 500.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const addr = "0x" + "1".repeat(40);
const goodProd = {
  APP_MODE: "production", SUPABASE_URL: "https://example.invalid", SUPABASE_ANON_KEY: "placeholder",
  NEXT_PUBLIC_PCP_ADDRESS: addr, NEXT_PUBLIC_ESCROW_ADDRESS: addr,
};
const cases = [
  ["preview mặc định", {}, 200],
  ["production đủ cấu hình", goodProd, 200],
  ["production thiếu hết", { APP_MODE: "production" }, 500],
  ["production sai địa chỉ PCP", { ...goodProd, NEXT_PUBLIC_PCP_ADDRESS: "oops" }, 500],
  ["production thiếu SUPABASE_URL", { ...goodProd, SUPABASE_URL: "" }, 500],
  ["APP_MODE gõ sai", { APP_MODE: "prod" }, 500],
];

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on("error", reject);
  });
}

async function status(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
      return r.status;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return null;
}

let failed = 0;
for (const [name, env, expected] of cases) {
  const port = await freePort();
  const base = { ...process.env };
  for (const k of ["APP_MODE", "SUPABASE_URL", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_PCP_ADDRESS", "NEXT_PUBLIC_ESCROW_ADDRESS"]) delete base[k];
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: webDir, env: { ...base, ...env }, stdio: "ignore",
  });
  const got = await status(port);
  child.kill();
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: mong ${expected}, nhận ${got}`);
}
process.exit(failed ? 1 : 0);

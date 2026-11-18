// Chạy worker với: web/.env.local (không in) + ghi đè biến từ một file env.sh (biến chuỗi cục bộ, WORKER_PROVIDER=agent). Dừng sau N giây.
// Dùng: node scripts/vm/run-worker.mjs <repoRoot> <file env.sh> <số giây>
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const [root, chainEnvSh, seconds] = process.argv.slice(2);
const parse = (t) => Object.fromEntries(t.split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")]));
const base = parse(readFileSync(`${root}/web/.env.local`, "utf8"));
// Có thể truyền nhiều file, cách nhau bằng dấu phẩy (Fuji: server.env bí mật ngoài repo + worker.env không bí mật); file sau ghi đè file trước.
const chain = Object.assign({}, ...chainEnvSh.split(",").map((f) => parse(readFileSync(f.trim(), "utf8").replace(/^export /gm, ""))));
const env = { ...process.env, ...base, ...chain, WORKER_INTERVAL_MS: "3000", WORKER_ID: "worker-local-verify" };
const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/src/workerMain.ts"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let lines = 0;
const emit = (b) => { for (const l of String(b).split(/\r?\n/).filter(Boolean)) { lines++; console.log(l.slice(0, 220)); } };
child.stdout.on("data", emit); child.stderr.on("data", emit);
setTimeout(() => child.kill("SIGINT"), Number(seconds) * 1000);
setTimeout(() => { spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" }); }, (Number(seconds) + 6) * 1000);
child.on("exit", (c) => { console.log(`worker thoát code=${c}, ${lines} dòng log`); process.exit(0); });

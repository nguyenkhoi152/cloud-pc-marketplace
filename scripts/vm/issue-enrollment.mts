/**
 * Vai trò ADMIN của demo: cấp MÃ GHI DANH một lần cho máy demo, để host dán vào app (Cho thuê máy → Thiết lập & chạy máy).
 *  1. Thu hồi thiết bị đang hiệu lực của máy (nếu có) — credential cũ lập tức bị máy chủ từ chối.
 *  2. Tạo enrollment mới (hạn mặc định 15 phút, dùng một lần) và GHI mã vào một tệp ngoài repo. Không in mã ra màn hình.
 * Dùng tài khoản admin smoke (desktop/.env.smoke.local). Ghi vào Supabase dev: device_enrollments (thu hồi + 1 dòng mới), audit_logs.
 * Chạy:  npx tsx scripts/vm/issue-enrollment.mts <stateFile> <tệp ghi mã> [apiBase http://127.0.0.1:3000/api] [ttl giây]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [stateFile, outFile, apiBase = "http://127.0.0.1:3000/api", ttlArg = "900"] = process.argv.slice(2);
if (!stateFile || !outFile) throw new Error("Dùng: <stateFile> <tệp ghi mã> [apiBase] [ttl giây]");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const parse = (f: string): Record<string, string> => existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")])) : {};
const desk = parse(path.join(root, "desktop/.env.local")), smoke = parse(path.join(root, "desktop/.env.smoke.local"));
const SU = desk.VITE_SUPABASE_URL!.replace(/\/+$/, ""), KEY = desk.VITE_SUPABASE_ANON_KEY!;
const { machineId } = JSON.parse(readFileSync(stateFile, "utf8")) as { machineId: string };

async function jf(url: string, init: RequestInit, tries = 4): Promise<{ status: number; j: any }> {
  for (let i = 1; ; i++) {
    try { const r = await fetch(url, init); return { status: r.status, j: await r.json().catch(() => null) }; }
    catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 3000 * i)); }
  }
}
const lg = await jf(`${SU}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: smoke.SMOKE_ADMIN_EMAIL, password: smoke.SMOKE_ADMIN_PASSWORD }) });
if (!lg.j?.access_token) throw new Error("Đăng nhập admin smoke thất bại");
const h = { authorization: `Bearer ${lg.j.access_token}`, "content-type": "application/json" };

const rv = await jf(`${apiBase}/admin/devices/revoke`, { method: "POST", headers: h, body: JSON.stringify({ machineId }) });
if (rv.status !== 200) throw new Error(`Thu hồi thiết bị cũ thất bại (HTTP ${rv.status} ${rv.j?.error?.code ?? ""})`);
console.log(`đã thu hồi thiết bị cũ của máy ${machineId.slice(0, 8)}… (nếu có)`);

const en = await jf(`${apiBase}/admin/enrollments`, { method: "POST", headers: h, body: JSON.stringify({ machineId, ttlSeconds: Number(ttlArg) }) });
if (en.status !== 201 || !en.j?.enrollmentToken) throw new Error(`Tạo enrollment thất bại (HTTP ${en.status} ${en.j?.error?.code ?? ""})`);
mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
writeFileSync(outFile, en.j.enrollmentToken + "\n", { mode: 0o600 });
console.log(`đã ghi mã ghi danh (dùng một lần, hết hạn sau ${Math.round(Number(ttlArg) / 60)} phút) vào ${outFile} — không in mã ra đây`);

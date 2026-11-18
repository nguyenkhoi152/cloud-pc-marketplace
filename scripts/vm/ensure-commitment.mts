/**
 * Bảo đảm máy demo có cam kết thời gian CÒN HẠN của host (reserve_machine từ chối `unavailable` nếu cam kết không phủ
 * thời hạn thanh toán + gói + dự phòng). Cam kết tạo hôm trước (6 giờ) đã hết hạn nên máy báo `unavailable`.
 * Dùng tài khoản host smoke đã được duyệt (RLS cho host tự ghi cam kết của máy mình). Không in mật khẩu/token.
 * Ghi vào Supabase dev: 1 dòng host_commitments (nếu chưa có cam kết phủ đủ thời gian).
 * Chạy:  npx tsx scripts/vm/ensure-commitment.mts <stateFile> [số giờ muốn phủ, mặc định 8]
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [stateFile, hoursArg = "8"] = process.argv.slice(2);
if (!stateFile) throw new Error("Dùng: <stateFile> [giờ]");
const hours = Number(hoursArg);
if (!(hours >= 4 && hours <= 72)) throw new Error("số giờ phải từ 4 đến 72 (cam kết tối thiểu 4 giờ)");
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
const lg = await jf(`${SU}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: smoke.SMOKE_HOST_EMAIL, password: smoke.SMOKE_HOST_PASSWORD }) });
if (!lg.j?.access_token) throw new Error("Đăng nhập host smoke thất bại");
const h = { apikey: KEY, authorization: `Bearer ${lg.j.access_token}`, "content-type": "application/json" };
const now = Date.now(), want = now + hours * 3_600_000;
const cur = await jf(`${SU}/rest/v1/host_commitments?select=starts_at,ends_at&machine_id=eq.${machineId}&order=ends_at.desc&limit=5`, { headers: h });
const covering = (cur.j as { starts_at: string; ends_at: string }[]).find((c) => Date.parse(c.starts_at) <= now && Date.parse(c.ends_at) >= now + 5 * 3_600_000);
if (covering) { console.log(`đã có cam kết phủ tới ${covering.ends_at} (còn ≥5 giờ), không thêm`); process.exit(0); }
const ins = await jf(`${SU}/rest/v1/host_commitments`, { method: "POST", headers: { ...h, prefer: "return=minimal" }, body: JSON.stringify({ machine_id: machineId, starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(want).toISOString() }) });
if (ins.status >= 300) throw new Error(`Tạo cam kết thất bại (HTTP ${ins.status} ${JSON.stringify(ins.j).slice(0, 120)})`);
console.log(`đã thêm cam kết ${hours} giờ cho máy ${machineId.slice(0, 8)}… (tới ${new Date(want).toISOString()})`);

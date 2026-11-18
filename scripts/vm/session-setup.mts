/**
 * Chuẩn bị demo phiên thuê trên Supabase dev + chuỗi cục bộ (MÔ PHỎNG, không phải Fuji):
 *  1. Tạo (nếu chưa có) tài khoản người thuê demo + khoá ví GIẢ LẬP (viem, sinh cục bộ). Lưu vào desktop/.env.smoke.local (Git bỏ qua).
 *  2. Chọn máy đã duyệt mới nhất làm "máy cho thuê" của demo.
 *  3. Admin smoke tạo enrollment cho máy đó; đổi lấy credential của host-agent (ghi vào <agentDir>/credential.json, mode 0600).
 * Không in token/khoá/mật khẩu. Ghi vào Supabase: 1 tài khoản (+profile) mới nếu chưa có; 1 device_enrollments + audit.
 * Chạy:  npx tsx scripts/vm/session-setup.mts <agentDir> <stateFile> [apiBase http://127.0.0.1:3000/api]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { enroll } from "../../host-agent/src/main";

const [agentDir, stateFile, apiBase = "http://127.0.0.1:3000/api"] = process.argv.slice(2);
if (!agentDir || !stateFile) throw new Error("Dùng: <agentDir> <stateFile> [apiBase]");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const parse = (f: string): Record<string, string> => existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")])) : {};
const SMOKE = path.join(root, "desktop/.env.smoke.local");
const desk = parse(path.join(root, "desktop/.env.local"));
const URL_ = desk.VITE_SUPABASE_URL!.replace(/\/+$/, ""), KEY = desk.VITE_SUPABASE_ANON_KEY!;
let smoke = parse(SMOKE);
const jf = async (url: string, init: RequestInit) => { const r = await fetch(url, init); const j = await r.json().catch(() => null); return { status: r.status, j }; };
const log = (m: string) => console.log(m);

// 1. Người thuê demo (+ ví giả lập)
if (!smoke.DEMO_RENTER_EMAIL || !smoke.DEMO_RENTER_PASSWORD) {
  const email = `demo-renter-${randomBytes(4).toString("hex")}@example.com`;
  const password = randomBytes(12).toString("base64url");
  const r = await jf(`${URL_}/auth/v1/signup`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password, data: { display_name: "Người thuê demo" } }) });
  if (r.status >= 300 || !r.j?.access_token) throw new Error(`Đăng ký tài khoản demo thất bại (HTTP ${r.status}; cần tắt xác nhận email ở Supabase dev)`);
  const p = await jf(`${URL_}/rest/v1/profiles`, { method: "POST", headers: { apikey: KEY, authorization: `Bearer ${r.j.access_token}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify({ user_id: r.j.user.id, display_name: "Người thuê demo" }) });
  if (p.status >= 300) throw new Error(`Tạo profile thất bại (HTTP ${p.status})`);
  appendFileSync(SMOKE, `\nDEMO_RENTER_EMAIL=${email}\nDEMO_RENTER_PASSWORD=${password}\nDEMO_RENTER_WALLET_KEY=${generatePrivateKey()}\n`);
  smoke = parse(SMOKE);
  log("đã tạo tài khoản người thuê demo + ví giả lập (thông tin lưu trong desktop/.env.smoke.local, không in)");
} else log("tài khoản người thuê demo đã có");
const wallet = privateKeyToAccount(smoke.DEMO_RENTER_WALLET_KEY as `0x${string}`);
log(`ví giả lập của người thuê: ${wallet.address}`);

// 2. Máy cho thuê của demo
const ms = await jf(`${URL_}/rest/v1/public_machines?select=id,name,price_units&order=created_at.desc&limit=1`, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } });
const machine = (ms.j as { id: string; name: string; price_units: string }[])[0];
if (!machine) throw new Error("Không có máy đã duyệt trong danh mục");
log(`máy demo: ${machine.name} (${machine.id.slice(0, 8)}…), giá ${machine.price_units} đơn vị nhỏ nhất`);

// 3. Admin cấp enrollment → host-agent đổi credential
const lg = await jf(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ email: smoke.SMOKE_ADMIN_EMAIL, password: smoke.SMOKE_ADMIN_PASSWORD }) });
if (!lg.j?.access_token) throw new Error("Đăng nhập admin smoke thất bại");
const en = await jf(`${apiBase}/admin/enrollments`, { method: "POST", headers: { authorization: `Bearer ${lg.j.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ machineId: machine.id, ttlSeconds: 600 }) });
if (en.status !== 201 || !en.j?.enrollmentToken) throw new Error(`Tạo enrollment thất bại (HTTP ${en.status} ${en.j?.error?.code ?? ""}) — máy đã có thiết bị đang hiệu lực?`);
mkdirSync(agentDir, { recursive: true });
await enroll({ AGENT_API_BASE: apiBase, AGENT_ENROLL_TOKEN: en.j.enrollmentToken, AGENT_DATA_DIR: agentDir });
log("host-agent đã đổi enrollment lấy credential (lưu trong thư mục agent, không in)");
writeFileSync(stateFile, JSON.stringify({ machineId: machine.id, machineName: machine.name, priceUnits: machine.price_units, renterWallet: wallet.address }));
log("xong");

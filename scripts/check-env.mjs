#!/usr/bin/env node
/**
 * Kiểm tra file môi trường Supabase TRÊN MÁY BẠN mà không in giá trị nào ra (chỉ tên biến + dạng giá trị + độ dài).
 * Không kết nối mạng. Chạy: npm run check:env
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  { rel: ".env.local", want: ["APP_MODE", "SUPABASE_URL", "SUPABASE_ANON_KEY"], note: "server/web" },
  { rel: "desktop/.env.local", want: ["VITE_APP_MODE", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"], note: "app" },
  { rel: "web/.env.local", want: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_DB_URL"], note: "API server (bí mật)", optional: true },
];

const parse = (text) =>
  Object.fromEntries(
    text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")];
    }),
  );
const jwtRole = (k) => {
  const p = k.split(".");
  if (p.length !== 3) return null;
  try { return JSON.parse(Buffer.from(p[1], "base64url").toString("utf8")).role ?? null; } catch { return null; }
};
function describeKey(v) {
  if (!v) return { kind: "trống", bad: false };
  if (v.startsWith("sb_secret_")) return { kind: "SECRET key (sb_secret_…)", bad: true };
  if (v.startsWith("sb_publishable_")) return { kind: `publishable (${v.length} ký tự)`, bad: false };
  const r = jwtRole(v);
  if (r === "service_role") return { kind: "JWT role=service_role", bad: true };
  if (r === "anon") return { kind: `JWT role=anon (${v.length} ký tự)`, bad: false };
  return { kind: `không nhận ra dạng (${v.length} ký tự)`, bad: true };
}
const URL_RE = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/;
const refOf = (u) => (URL_RE.test(u) ? u.replace(/^https:\/\//, "").split(".")[0] : null);

let problems = 0;
const refs = new Set();
console.log("Kiểm tra file môi trường (không in giá trị):\n");
for (const f of FILES) {
  const abs = path.join(root, f.rel);
  console.log(`• ${f.rel} (${f.note})`);
  if (!existsSync(abs)) {
    console.log(f.optional ? "    chưa có file (tuỳ chọn: chỉ cần để chạy API server / smoke:server với Supabase thật; xem web/.env.example)\n" : "    chưa có file — sao chép từ file .example rồi điền (xem docs/SUPABASE_DEV_SETUP.md)\n");
    if (!f.optional) problems++;
    continue;
  }
  const env = parse(readFileSync(abs, "utf8"));
  let ignored = false;
  try { execFileSync("git", ["check-ignore", "-q", abs], { cwd: root }); ignored = true; } catch { /* không bị bỏ qua */ }
  console.log(`    Git bỏ qua file này: ${ignored ? "có (đúng)" : "KHÔNG — đừng commit file này!"}`);
  if (!ignored) problems++;
  for (const k of f.want) {
    const v = env[k] ?? "";
    // Lỗi dán hay gặp: lặp tên biến trong giá trị, hoặc chú thích của .env.example dính vào giá trị. Chỉ báo dạng lỗi, không in giá trị.
    if (v.startsWith(`${k}=`)) { console.log(`    ⚠ ${k}: giá trị bắt đầu bằng chính tên biến ("${k}=…") — xoá phần lặp, dòng chỉ nên là ${k}=<giá trị>.`); problems++; }
    if (/[\s#()<>]/.test(v) && !k.endsWith("MODE")) { console.log(`    ⚠ ${k}: giá trị chứa khoảng trắng hoặc ký tự # ( ) < > — nghi dính chú thích từ file .example; để chú thích ở dòng riêng.`); problems++; }
    let shape;
    if (k.endsWith("MODE")) shape = v ? `"${v}"` : "trống (mặc định preview)";
    else if (k === "SUPABASE_DB_URL") {
      // Chuỗi kết nối Postgres chứa mật khẩu: chỉ báo dạng, không in giá trị.
      const m = /^postgres(?:ql)?:\/\/[^:@/]+:[^@]+@([^/:]+)(?::(\d+))?\/\w+/.exec(v);
      shape = !v ? "trống" : !m ? "KHÔNG đúng dạng postgresql://user:mật-khẩu@host:port/db" : /pooler\.supabase\.com$/.test(m[1]) ? `Postgres qua pooler (cổng ${m[2] ?? "5432"})` : /^db\.[a-z0-9]{20}\.supabase\.co$/.test(m[1]) ? "Postgres direct db.<ref>.supabase.co (cần IPv6)" : "Postgres host khác Supabase";
      if (!v || !m) problems++;
    } else if (k.endsWith("URL")) {
      shape = !v ? "trống" : URL_RE.test(v) ? `URL hợp lệ (ref ${v.replace(/^https:\/\//, "").slice(0, 4)}…)` : "KHÔNG đúng dạng https://<20 ký tự>.supabase.co";
      if (v && refOf(v)) refs.add(refOf(v));
      if (!v || !URL_RE.test(v)) problems++;
    } else {
      const d = describeKey(v);
      shape = d.kind;
      if (!v || d.bad) problems++;
      if (d.bad && v) console.log(`    ⚠ ${k}: dạng key không được phép ở đây — xoay key trong dashboard nếu nó là secret/service_role.`);
    }
    console.log(`    ${k}: ${shape}`);
  }
  const extra = Object.keys(env).filter((k) => /SERVICE_ROLE|SECRET|DB_URL|DATABASE_URL|PASSWORD/i.test(k) && !k.startsWith("SMOKE_"));
  if (extra.length && f.rel.startsWith("desktop")) {
    console.log(`    ⚠ ${extra.join(", ")}: biến nhạy cảm KHÔNG được để trong file của app (VITE_* bị nhúng vào bundle).`);
    problems++;
  }
  console.log("");
}
if (refs.size > 1) { console.log("⚠ Hai file trỏ tới hai project khác nhau.\n"); problems++; }
console.log(problems ? `Có ${problems} vấn đề cần sửa.` : "Cấu hình hợp lệ. Bước tiếp: npm run smoke:supabase -w @cpm/desktop");
process.exit(problems ? 1 : 0);

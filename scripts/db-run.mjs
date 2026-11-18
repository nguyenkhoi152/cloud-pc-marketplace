#!/usr/bin/env node
/**
 * Chạy SQL lên database Supabase DEV bằng thư viện `pg` của Node (không cần psql), với rào chắn chặt:
 *   node scripts/db-run.mjs list                       liệt kê file được phép áp dụng
 *   node scripts/db-run.mjs verify                     chạy supabase/verify/post_migration_checks.sql trong transaction READ ONLY, in bảng kết quả
 *   node scripts/db-run.mjs apply <file.sql> --yes     áp dụng ĐÚNG MỘT file trong danh sách cho phép, trong MỘT transaction
 *
 * Chuỗi kết nối: biến môi trường SUPABASE_DB_URL hoặc web/.env.local (đã bị Git bỏ qua). Không bao giờ in chuỗi kết nối, mật khẩu,
 * user hay host: mọi thông báo lỗi được lọc. TLS: mặc định xác minh; SUPABASE_DB_CA=<file PEM>; SUPABASE_DB_SSL=no-verify chỉ là phương án cuối.
 * Rào chắn của `apply`: chỉ file có tên trong ALLOW VÀ đúng SHA-256 đã duyệt; thiếu --yes thì không làm gì; không có `supabase db push`,
 * không reset, không DROP/TRUNCATE ngoài nội dung file đã duyệt; dừng và rollback ở lỗi đầu tiên.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** File được phép áp dụng: tên → SHA-256 của nội dung đã duyệt. Sửa file thì phải duyệt lại và cập nhật hash ở đây. */
export const ALLOW = {
  "20261108000006_revoke_sequence_grants.sql": "ccd9bf42c749a2f2c314ce5ed030b089d9b823cbfe84f2cfc7d3e47288dc857a",
};

const parseEnvFile = (f) =>
  existsSync(f)
    ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).split(/\s#/)[0].trim().replace(/^["']|["']$/g, "")]))
    : {};

export function loadConn(env = process.env, file = path.join(root, "web/.env.local")) {
  const f = parseEnvFile(file);
  const url = (env.SUPABASE_DB_URL ?? f.SUPABASE_DB_URL ?? "").trim();
  const get = (k) => (env[k] ?? f[k] ?? "").trim();
  return { url, ca: get("SUPABASE_DB_CA"), sslMode: get("SUPABASE_DB_SSL") };
}

export function sslFor(url, ca, sslMode) {
  if (/@(localhost|127\.0\.0\.1)(:|\/)/.test(url)) return undefined;
  if (ca) return { ca: readFileSync(ca, "utf8"), rejectUnauthorized: true };
  if (sslMode === "no-verify") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

/** Lọc mọi dấu vết của chuỗi kết nối khỏi chữ sắp in. */
export function scrubber(url) {
  const bits = [url];
  try {
    const u = new URL(url);
    bits.push(decodeURIComponent(u.password), u.password, decodeURIComponent(u.username), u.username, u.hostname);
  } catch { /* không phải URL hợp lệ: chỉ lọc nguyên chuỗi */ }
  const refs = /[a-z0-9]{20}/g;
  return (s) => bits.filter((b) => b && b.length >= 3).reduce((acc, b) => acc.split(b).join("<ẩn>"), String(s)).replace(refs, "<ref>");
}

const out = (m) => console.log(m);

async function connect(conn, scrub) {
  if (!conn.url) throw new Error("Thiếu SUPABASE_DB_URL (đặt trong web/.env.local hoặc biến môi trường). Xem web/.env.example.");
  if (!/^postgres(ql)?:\/\//.test(conn.url)) throw new Error("SUPABASE_DB_URL không đúng dạng postgresql://…");
  const c = new pg.Client({ connectionString: conn.url, ssl: sslFor(conn.url, conn.ca, conn.sslMode), connectionTimeoutMillis: 15000, statement_timeout: 60000 });
  try {
    await c.connect();
  } catch (e) {
    const m = scrub(e.message);
    const hint = /self-signed|unable to verify|certificate/i.test(m) ? " — thử đặt SUPABASE_DB_CA=<file PEM của CA Supabase> (ưu tiên hơn no-verify)." : "";
    throw new Error(`Không kết nối được database: ${m}${hint}`);
  }
  return c;
}

export async function verify(conn) {
  const scrub = scrubber(conn.url);
  const c = await connect(conn, scrub);
  try {
    const sql = readFileSync(path.join(root, "supabase/verify/post_migration_checks.sql"), "utf8");
    await c.query("begin read only");
    const r = await c.query(sql);
    await c.query("rollback");
    let bad = 0;
    for (const row of r.rows) {
      if (row.ok === null) { out(`info  #${row.o} ${row.name}: ${String(row.actual).slice(0, 120)}`); continue; }
      if (!row.ok) bad++;
      out(`${row.ok ? "OK  " : "FAIL"}  #${row.o} ${row.name}${row.ok ? "" : `\n        kỳ vọng: ${String(row.expected).slice(0, 160)}\n        thực tế: ${String(row.actual).slice(0, 160)}`}`);
    }
    out(`\n${r.rows.filter((x) => x.ok !== null).length - bad}/${r.rows.filter((x) => x.ok !== null).length} hàng kiểm đạt${bad ? ` — ${bad} FAIL` : ""}.`);
    return bad;
  } finally {
    await c.end();
  }
}

export async function apply(conn, file, yes) {
  const name = path.basename(file);
  const pin = ALLOW[name];
  if (!pin) throw new Error(`Từ chối: "${name}" không nằm trong danh sách được phép (xem: node scripts/db-run.mjs list).`);
  const p = path.join(root, "supabase/migrations", name);
  if (!existsSync(p)) throw new Error(`Không thấy file ${name}.`);
  const sql = readFileSync(p, "utf8");
  const sha = createHash("sha256").update(sql).digest("hex");
  if (sha !== pin) throw new Error(`Từ chối: nội dung ${name} khác bản đã duyệt (sha256 ${sha.slice(0, 12)}… ≠ ${pin.slice(0, 12)}…). Cần duyệt lại rồi cập nhật hash.`);
  if (!yes) throw new Error(`Chưa làm gì. Thêm --yes để áp dụng ${name} (một transaction, đúng một file).`);
  const scrub = scrubber(conn.url);
  const c = await connect(conn, scrub);
  try {
    const who = (await c.query("select current_user as u, current_setting('server_version') as v")).rows[0];
    out(`Đã kết nối (role ${who.u === "postgres" ? "postgres" : "khác"}, PostgreSQL ${who.v}). Áp dụng ${name} trong một transaction…`);
    await c.query("begin");
    try {
      await c.query(sql);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback").catch(() => undefined);
      throw new Error(`Lỗi khi áp dụng ${name} — ĐÃ ROLLBACK, không có gì thay đổi: ${scrub(e.message)}`);
    }
    out(`Đã áp dụng ${name}.`);
  } finally {
    await c.end();
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const yes = process.argv.includes("--yes");
  const conn = loadConn();
  if (cmd === "list") { for (const [k, v] of Object.entries(ALLOW)) out(`${k}  sha256:${v.slice(0, 16)}…`); return 0; }
  if (cmd === "verify") return (await verify(conn)) ? 1 : 0;
  if (cmd === "apply" && arg) { await apply(conn, arg, yes); return 0; }
  out("Dùng: node scripts/db-run.mjs list | verify | apply <file.sql> --yes");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1); });
}

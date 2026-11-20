import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "../../supabase/migrations");

/**
 * Shim tối thiểu mô phỏng Supabase: auth.users, auth.uid(), roles và default privileges.
 * Default privileges cố ý giống Supabase (cấp ALL cho anon/authenticated) để migration phải tự thu hồi.
 */
export const SHIM = `
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export type Ctx = "superuser" | "anon" | "service_role" | { user: string };

export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SHIM);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await db.exec(readFileSync(path.join(migrationsDir, f), "utf8"));
  return db;
}

/** DB mới đã áp các migration TRƯỚC `boundary` (tên file); `applyRest` áp phần còn lại. Dùng để thử backfill dữ liệu cũ. */
export async function createDbStagedAt(boundary: string): Promise<{ db: PGlite; applyRest: () => Promise<void> }> {
  const db = new PGlite();
  await db.exec(SHIM);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files.filter((x) => x < boundary)) await db.exec(readFileSync(path.join(migrationsDir, f), "utf8"));
  return {
    db,
    applyRest: async () => {
      for (const f of files.filter((x) => x >= boundary)) await db.exec(readFileSync(path.join(migrationsDir, f), "utf8"));
    },
  };
}

/** Chạy fn với role/JWT giả lập, luôn trả về superuser sau đó. */
export async function as<T>(db: PGlite, ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  const sub = typeof ctx === "object" ? ctx.user : "";
  const role = typeof ctx === "object" ? "authenticated" : ctx;
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
  if (role !== "superuser") await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

export async function newUser(db: PGlite, name = "u"): Promise<string> {
  const r = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [
    `${name}-${Math.random().toString(36).slice(2)}@example.invalid`,
  ]);
  const id = r.rows[0]!.id;
  await db.query("insert into public.profiles (user_id, display_name) values ($1, $2)", [id, name]);
  return id;
}

export async function makeAdmin(db: PGlite): Promise<string> {
  const id = await newUser(db, "admin");
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [id]);
  return id;
}

let addrCounter = 1;
export async function linkWallet(db: PGlite, user: string): Promise<string> {
  const address = "0x" + (addrCounter++).toString(16).padStart(40, "0");
  await db.query("insert into public.wallet_links (user_id, address, chain_id) values ($1, $2, 43113)", [user, address]);
  return address;
}

export async function makeApprovedHost(db: PGlite): Promise<string> {
  const id = await newUser(db, "host");
  await db.query("insert into public.host_profiles (user_id, status) values ($1, 'approved')", [id]);
  return id;
}

let keyCounter = 1;
/** Máy approved của host, kèm commitment phủ 24 giờ tới. price mặc định 20 PCP. */
export async function makeMachine(
  db: PGlite,
  host: string,
  opts: { price?: string; status?: string; commitHours?: number } = {},
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.machines (owner_id, machine_key, name, price_units, status)
     values ($1, $2, 'Máy thử', $3, $4) returning id`,
    [host, `machine-${keyCounter++}-${Math.random().toString(36).slice(2, 8)}`, opts.price ?? "20000000000000000000", opts.status ?? "approved"],
  );
  const id = r.rows[0]!.id;
  const hours = opts.commitHours ?? 24;
  await db.query(
    `insert into public.host_commitments (machine_id, starts_at, ends_at)
     values ($1, now() - interval '1 hour', now() + make_interval(hours => $2::int))`,
    [id, hours],
  );
  return id;
}

export async function reserve(db: PGlite, user: string, machine: string, key = "key-" + Math.random().toString(36).slice(2), hash = "h1") {
  return as(db, { user }, async () => {
    const r = await db.query<{ id: string }>("select * from public.reserve_machine($1, $2, $3)", [machine, key, hash]);
    return r.rows[0]!;
  });
}

export async function renterWithWallet(db: PGlite): Promise<string> {
  const u = await newUser(db, "renter");
  await linkWallet(db, u);
  return u;
}

import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./harness";

const sql = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/verify/post_migration_checks.sql"), "utf8");
let db: PGlite;
beforeAll(async () => { db = await createDb(); }, 60_000);
afterAll(async () => { await db.close(); });

describe("supabase/verify/post_migration_checks.sql (chạy trên PGlite đã áp dụng đủ migrations)", () => {
  it("là một câu SELECT chỉ đọc và mọi dòng kiểm tra đều ok", async () => {
    expect(sql.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''")).not.toMatch(/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i);
    const r = await db.query<{ o: number; name: string; expected: string; actual: string; ok: boolean | null }>(sql);
    const checks = r.rows.filter((x) => x.ok !== null);
    expect(checks.map((x) => x.o)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(checks.filter((x) => !x.ok), JSON.stringify(checks.filter((x) => !x.ok), null, 1)).toEqual([]);
    expect(r.rows.map((x) => x.o)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it("phát hiện lỗi cấu hình: hàm cho PUBLIC gọi và bảng thiếu RLS", async () => {
    await db.exec("create function public.leak() returns int language sql as 'select 1'");
    await db.exec("create table public.no_rls_probe (id int)");
    const r = await db.query<{ o: number; ok: boolean | null }>(sql);
    expect(r.rows.filter((x) => x.o === 1 || x.o === 2).map((x) => x.ok)).toEqual([false, false]);
    await db.exec("drop function public.leak(); drop table public.no_rls_probe");
  });
});

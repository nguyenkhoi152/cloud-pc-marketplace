// scripts/db-run.mjs chạy trên Postgres THẬT cục bộ đã có migration 1–5 (đúng tình huống project dev trước khi áp dụng 000006).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startRealPg, type RealPg } from "../../db/tests/realpg";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/db-run.mjs");
const FILE = "20261108000006_revoke_sequence_grants.sql";
let real: RealPg;
let url = "";
beforeAll(async () => {
  const r = await startRealPg({ exclude: [FILE] });
  if (!r) throw new Error("Không có binary Postgres cục bộ");
  real = r;
  url = `postgresql://postgres@127.0.0.1:${r.port}/postgres`;
}, 120_000);
afterAll(async () => { await real?.stop(); }, 60_000);

const run = (args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, SUPABASE_DB_URL: url, ...env } });
  return { code: r.status, text: `${r.stdout}${r.stderr}` };
};

describe("scripts/db-run.mjs", () => {
  it("verify (chỉ đọc) trước khi áp dụng: báo FAIL đúng hàng 14 với tên hai sequence, exit 1", () => {
    const r = run(["verify"]);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/FAIL\s+#14/);
    expect(r.text).toContain("chain_events_id_seq");
    expect(r.text).toContain("agent_commands_id_seq");
    expect(r.text).toMatch(/OK\s+#1 /);
  });

  it("apply: thiếu --yes thì không đổi gì; file ngoài danh sách bị từ chối; sau đó --yes áp dụng; verify sạch; áp dụng lần hai vẫn an toàn", () => {
    expect(run(["apply", FILE]).code).toBe(1);
    expect(run(["verify"]).code).toBe(1); // chưa đổi
    const bad = run(["apply", "20261108000005_agent_channel.sql", "--yes"]);
    expect(bad.code).toBe(1);
    expect(bad.text).toMatch(/không nằm trong danh sách/);
    const ok = run(["apply", FILE, "--yes"]);
    expect(ok.code).toBe(0);
    expect(ok.text).toMatch(/Đã áp dụng/);
    const after = run(["verify"]);
    expect(after.code).toBe(0);
    expect(after.text).toMatch(/14\/14 hàng kiểm đạt/);
    expect(run(["apply", FILE, "--yes"]).code).toBe(0); // idempotent
    expect(run(["verify"]).code).toBe(0);
  });

  it("không in mật khẩu/host/chuỗi kết nối kể cả khi kết nối thất bại (cổng đóng, sai TLS)", () => {
    const secret = "S3cr3t-PW-khong-duoc-lo";
    const r = run(["verify"], { SUPABASE_DB_URL: `postgresql://postgres:${secret}@127.0.0.1:9/postgres` });
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/Không kết nối được database/);
    expect(r.text).not.toContain(secret);
    expect(r.text).not.toContain("127.0.0.1");
    expect(run(["verify"], { SUPABASE_DB_URL: "" }).text).toMatch(/Thiếu SUPABASE_DB_URL/);
    expect(run(["verify"], { SUPABASE_DB_URL: "mysql://x" }).text).toMatch(/không đúng dạng/);
  });
});

import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Smoke test API server với Supabase dev THẬT. Chạy: npm run smoke:server -w @cpm/server.
 * Đọc web/.env.local (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_DB_URL — BÍ MẬT, không in ra) và
 * desktop/.env.smoke.local (tài khoản smoke đã có). Không tạo tài khoản mới.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(process.cwd(), "../web"), "");
  return {
    test: {
      environment: "node",
      include: ["smoke/**/*.smoke.test.ts"],
      testTimeout: 60_000,
      hookTimeout: 60_000,
      fileParallelism: false,
      env: Object.fromEntries(Object.entries(env).filter(([k]) => /^(SUPABASE_|SMOKE_)/.test(k))) as Record<string, string>,
    },
  };
});

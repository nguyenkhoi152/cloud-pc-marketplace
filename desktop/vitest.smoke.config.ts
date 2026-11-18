import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Smoke test với Supabase DEV THẬT. Chạy: npm run smoke:supabase -w @cpm/desktop (mode "smoke").
 * Đọc desktop/.env.local (URL + key công khai) và desktop/.env.smoke.local (tài khoản test do chính test tạo; đã bị Git bỏ qua).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    test: {
      environment: "node",
      include: ["smoke/**/*.smoke.test.ts"],
      testTimeout: 60_000,
      hookTimeout: 60_000,
      fileParallelism: false,
      env: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("VITE_") || k.startsWith("SMOKE_"))),
    },
  };
});

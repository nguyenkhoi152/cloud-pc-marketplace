import { defineConfig } from "vitest/config";

// Bộ test thường chỉ gồm src/**; smoke với Supabase thật (smoke/) chạy riêng bằng `npm run smoke:server`.
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 120_000 } });

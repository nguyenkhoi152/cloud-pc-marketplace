import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Test đơn vị phải cho cùng kết quả trên mọi máy: KHÔNG nạp desktop/.env.local (nếu nạp, máy có VITE_APP_MODE=live sẽ chạy
  // test ở chế độ live còn máy sạch chạy ở preview). Bộ smoke với Supabase thật dùng cấu hình riêng (vitest.smoke.config.ts).
  envDir: mode === "test" ? fileURLToPath(new URL("./src/__khong_nap_env_khi_test__", import.meta.url)) : undefined,
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
}));

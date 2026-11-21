import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/** Bản web (`--mode web`): đặt tiêu đề và mô tả riêng cho trang công khai (bản desktop giữ tiêu đề "bản xem trước giao diện"). */
const webMeta: Plugin = {
  name: "cpm-web-meta",
  transformIndexHtml: (html) =>
    html
      .replace(/<title>[^<]*<\/title>/, "<title>Cloud PC Companion — thuê và cho thuê máy tính từ xa</title>")
      .replace("</head>", '    <meta name="description" content="Xem danh sách máy cho thuê trên Cloud PC Companion. Thuê và cho thuê máy cần cài app cho Windows." />\n  </head>'),
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "web" ? [webMeta] : [])],
  base: "./",
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Test đơn vị phải cho cùng kết quả trên mọi máy: KHÔNG nạp desktop/.env.local (nếu nạp, máy có VITE_APP_MODE=live sẽ chạy
  // test ở chế độ live còn máy sạch chạy ở preview). Bộ smoke với Supabase thật dùng cấu hình riêng (vitest.smoke.config.ts).
  // Bản web (công khai) cũng KHÔNG nạp .env.local: Vite nhúng mọi VITE_* vào trang, nên URL/khóa Supabase và địa chỉ API không được lọt vào đó.
  envDir: mode === "test" || mode === "web" ? fileURLToPath(new URL("./src/__khong_nap_env_khi_test__", import.meta.url)) : undefined,
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
}));

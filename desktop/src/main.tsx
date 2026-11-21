import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bootLive } from "./api";
import { syncBackgroundToNative } from "./api/background";
import { ENV } from "./api/env";
import { App } from "./app/App";
import { initTheme } from "./lib/theme";
// Font đóng gói cục bộ (không gọi Google Fonts lúc chạy: app native chạy offline được và không rò IP; CSP không cho domain ngoài).
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "./styles/index.css";

// Áp theme đã lưu (mặc định tối) lên <html> trước khi dựng giao diện.
initTheme();

const render = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

// Live: nạp supabase-js (chunk riêng) trước khi render; lỗi nạp hiện thẳng, không rơi về dữ liệu mẫu.
if (ENV.mode === "live") {
  void syncBackgroundToNative(typeof localStorage === "undefined" ? null : localStorage);
  bootLive().then(render, (e: unknown) => {
    document.getElementById("root")!.textContent = `Không khởi tạo được kết nối live: ${e instanceof Error ? e.message : String(e)}`;
  });
} else render();

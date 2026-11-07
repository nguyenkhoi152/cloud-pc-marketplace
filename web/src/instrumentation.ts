import { loadConfig } from "@cpm/shared";

/**
 * Chạy một lần khi server Next khởi động (next dev / next start).
 * APP_MODE=production thiếu hoặc sai cấu hình -> ném lỗi, server không phục vụ request.
 * Bỏ qua ở pha build (CI build không có secret); kiểm tra lại khi start.
 */
export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  loadConfig(process.env);
}

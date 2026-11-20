/**
 * GET /api/connect — trang "Mở bằng app" của liên kết kết nối (xem server/src/api/connectPage.ts).
 * Không cần cấu hình DB/chuỗi: chạy được cả khi phần còn lại của API chưa sẵn sàng. Địa chỉ lấy từ WALLET_DOMAIN của chính máy chủ.
 */
import { connectPageResponse } from "@cpm/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return connectPageResponse(process.env.WALLET_DOMAIN);
}

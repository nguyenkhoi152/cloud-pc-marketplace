import { addDays, DEMO_DATE, formatDateVi, formatDuration } from "@/domain/clock";
import { currentWindow, maxBookableMinutes } from "@/domain/pricing";
import type { Category, Machine } from "@/domain/types";

export const CATEGORY_LABEL: Record<Category, string> = { game: "Game", graphics: "Đồ họa", dev: "Lập trình" };

export function rentability(m: Machine): { canRent: boolean; text: string; sub?: string } {
  if (m.state === "offline") return { canRent: false, text: "Máy đang offline", sub: "Chủ máy chưa bật nhận thuê hoặc máy đã mất kết nối" };
  if (m.state === "busy") return { canRent: false, text: "Đang có phiên", sub: "Mở lại sau khi dọn dẹp xong" };
  if (m.state === "blocked") return { canRent: false, text: "Đang xử lý sự cố", sub: "Chưa nhận khách" };
  // Chế độ live: máy chủ đã đo heartbeat. Không dùng khung giờ mô phỏng (windows) ở đây.
  if (m.state === "online") return { canRent: true, text: "Gói 15 phút", sub: "Máy đang online" };
  if (m.state === "unverified") return { canRent: true, text: "Gói 15 phút", sub: "Sẽ kiểm tra khi bạn giữ máy" };
  const w = currentWindow(m);
  if (w) {
    const max = maxBookableMinutes(m);
    return max > 0
      ? { canRent: true, text: `Thuê được tới ${w.end}`, sub: `Tối đa ${formatDuration(max)}` }
      : { canRent: false, text: `Khung giờ kết thúc ${w.end}`, sub: "Còn dưới 15 phút" };
  }
  const next = m.windows.find((x) => x.date > DEMO_DATE || x.date === DEMO_DATE);
  if (next) {
    const when = next.date === addDays(DEMO_DATE, 1) ? "ngày mai" : formatDateVi(next.date);
    return { canRent: false, text: `Mở lúc ${next.start} ${when}`, sub: "Ngoài khung giờ hiện tại" };
  }
  return { canRent: false, text: "Chưa có khung giờ" };
}

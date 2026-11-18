/**
 * Điều hướng khi KHỞI ĐỘNG app đã cài. Mở app từ Start Menu thì URL không có hash; router coi hash rỗng là "/welcome" (route công khai), nên
 * trước đây người ĐÃ đăng nhập (phiên khôi phục thành công) vẫn thấy màn Welcome như chưa đăng nhập. Hàm thuần này quyết định chỉ MỘT lần,
 * ngay sau khi khôi phục phiên: nếu đang đứng ở một trang vào cửa công khai thì chuyển tới trang chủ của chế độ lần trước; mở bằng liên kết
 * sâu (ví dụ `#/rent/history`, tải lại trang) thì giữ nguyên.
 */
export type Mode = "rent" | "host";

/** Các trang vào cửa công khai: người đã đăng nhập không có lý do ở lại đó khi vừa mở app. */
const PUBLIC_ENTRY = new Set(["", "/", "/welcome", "/login", "/register", "/recover"]);

export function startupRoute(hash: string, mode: Mode): string | null {
  const path = (hash.replace(/^#/, "").split("?")[0] ?? "").replace(/\/+$/, "") || "";
  if (!PUBLIC_ENTRY.has(path)) return null;
  return mode === "host" ? "/host" : "/rent/discover";
}

export const MODE_KEY = "cpm.mode.v1";
type Store = Pick<Storage, "getItem" | "setItem"> | null | undefined;

/** Chế độ dùng lần trước; mọi lỗi/giá trị lạ ⇒ "rent". Không bao giờ ném lỗi (storage có thể bị chặn). */
export function readSavedMode(storage: Store): Mode {
  try {
    return storage?.getItem(MODE_KEY) === "host" ? "host" : "rent";
  } catch {
    return "rent";
  }
}
/** Chỉ lưu chế độ giao diện (không phải quyền): quyền host luôn do máy chủ quyết định. */
export function saveMode(storage: Store, mode: Mode): void {
  try {
    storage?.setItem(MODE_KEY, mode);
  } catch {
    /* storage bị chặn: bỏ qua, lần sau mở ở chế độ Thuê */
  }
}
export const safeLocalStorage = (): Store => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

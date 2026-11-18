/**
 * Tuỳ chọn "Chạy nền khi đóng cửa sổ" của máy host (chỉ app Windows đã cài). Mặc định TẮT.
 * Lưu trên máy này và đồng bộ sang lớp native lúc khởi động: nếu không đồng bộ, lớp native luôn bắt đầu ở trạng thái tắt và lựa chọn đã lưu bị bỏ qua.
 */
import { hostNative, hostNativeAvailable } from "./hostNative";

export const BACKGROUND_KEY = "cpm.hostBackground.v1";
type Store = Pick<Storage, "getItem" | "setItem"> | null | undefined;

export function readBackgroundPref(storage: Store): boolean {
  try {
    return storage?.getItem(BACKGROUND_KEY) === "1";
  } catch {
    return false;
  }
}

/** Lưu rồi báo lớp native. Trả false nếu lớp native không nhận (khi đó KHÔNG lưu: giao diện không được nói "bật" khi thực tế tắt). */
export async function setBackgroundPref(storage: Store, enabled: boolean, native: Pick<typeof hostNative, "setBackground"> = hostNative): Promise<boolean> {
  try {
    await native.setBackground(enabled);
  } catch {
    return false;
  }
  try {
    storage?.setItem(BACKGROUND_KEY, enabled ? "1" : "0");
  } catch {
    /* chỉ áp dụng phiên này */
  }
  return true;
}

/** Gọi lúc khởi động app (chỉ khi có lớp native). Không ném lỗi. */
export async function syncBackgroundToNative(storage: Store, available = hostNativeAvailable(), native: Pick<typeof hostNative, "setBackground"> = hostNative): Promise<void> {
  if (!available) return;
  try {
    await native.setBackground(readBackgroundPref(storage));
  } catch {
    /* lớp native cũ không có lệnh này: coi như tắt */
  }
}

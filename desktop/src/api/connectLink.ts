/**
 * Liên kết kết nối `cloudpc://connect?server=<https://….trycloudflare.com>`: lớp native (src-tauri/src/connect.rs) kiểm dạng liên kết và đưa địa chỉ
 * cho giao diện; ở đây kiểm danh sách tên miền được phép (cùng nguồn với ô dán mã: endpoint.ts) rồi giao diện HỎI XÁC NHẬN.
 * Không có đường nào đổi máy chủ im lặng: địa chỉ máy chủ nhận phiên đăng nhập của người dùng.
 */
import { apiHost, isAllowedOverride, normalizeApiBase, OVERRIDE_HOST_SUFFIXES } from "./endpoint";

export type ConnectTarget = { ok: true; base: string } | { ok: false; reason: string };

/** Địa chỉ liên kết yêu cầu, đã chuẩn hoá và đã kiểm danh sách cho phép; hoặc lý do bị từ chối (hiện nguyên văn cho người dùng). */
export function connectTarget(raw: string | null | undefined): ConnectTarget {
  const n = normalizeApiBase(raw);
  if (!n) return { ok: false, reason: "Liên kết không chứa địa chỉ máy chủ hợp lệ." };
  if (!isAllowedOverride(n)) {
    return { ok: false, reason: `${apiHost(n)} không nằm trong danh sách máy chủ được hỗ trợ (https://….${OVERRIDE_HOST_SUFFIXES[0]}) nên đã bị chặn để bảo vệ tài khoản của bạn.` };
  }
  return { ok: true, base: n };
}

interface TauriGlobal {
  core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
  event?: { listen?: (name: string, cb: (e: unknown) => void) => Promise<() => void> };
}
const tauri = () => (globalThis as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;

/** Lấy (và xoá) địa chỉ đang chờ xác nhận do lớp native giữ. Ngoài app Windows (trình duyệt/test) luôn null. */
export async function takePendingConnect(): Promise<string | null> {
  const invoke = tauri()?.core?.invoke;
  if (typeof invoke !== "function") return null;
  try {
    const v = await invoke<unknown>("connect_take_pending");
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Nghe liên kết được bấm khi app đang mở. Payload KHÔNG được tin: người nghe gọi takePendingConnect(). Trả hàm huỷ. */
export function onConnectLink(cb: () => void): () => void {
  const listen = tauri()?.event?.listen;
  if (typeof listen !== "function") return () => {};
  let off: (() => void) | null = null;
  let stopped = false;
  listen("cpm-connect", () => cb()).then(
    (f) => (stopped ? f() : (off = f)),
    () => {},
  );
  return () => {
    stopped = true;
    off?.();
  };
}

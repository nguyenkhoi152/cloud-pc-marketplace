/**
 * Địa chỉ máy chủ API cấu hình LÚC CHẠY (người thử dán "mã kết nối" do người tổ chức gửi), ưu tiên hơn giá trị lúc build.
 *
 * AN TOÀN: app gửi token đăng nhập Supabase của người dùng tới máy chủ API (Authorization: Bearer). Một địa chỉ độc hại sẽ nhận được token đó.
 * Vì vậy: chỉ nhận https (hoặc http loopback cho dev), không userinfo/query/fragment, CSP của app chỉ cho phép các tên miền đã khai, và giao diện
 * nói rõ "chỉ nhập mã từ người bạn tin". Đây là mức bảo vệ đủ cho giai đoạn thử nghiệm có người tổ chức, KHÔNG phải cho dịch vụ công khai.
 */
const BASE_RE = /^(https:\/\/[^/\s?#@]+|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?)(\/[^\s?#]*)?$/;

/** Chuẩn hoá: bỏ khoảng trắng/dấu / cuối, chỉ có origin thì thêm "/api". null nếu không hợp lệ. */
export function normalizeApiBase(raw: string | null | undefined): string | null {
  let v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!BASE_RE.test(v)) return null;
  if (!/^https?:\/\/[^/]+\/.+/.test(v)) v += "/api";
  return v;
}

/**
 * Tên miền mà mã kết nối (ghi đè lúc chạy) được phép trỏ tới. PHẢI khớp connect-src trong src-tauri/tauri.conf.json (có test đối chiếu):
 * nếu không, WebView chặn yêu cầu và người dùng chỉ thấy "máy chủ không trả lời". Loopback http luôn được phép (chạy trên chính máy này).
 */
export const OVERRIDE_HOST_SUFFIXES = ["trycloudflare.com"] as const;
export function isAllowedOverride(base: string): boolean {
  const m = /^(https?):\/\/([^/:]+)/.exec(base);
  if (!m) return false;
  const [, scheme, host] = m;
  if (scheme === "http") return host === "127.0.0.1" || host === "localhost";
  return OVERRIDE_HOST_SUFFIXES.some((s) => host!.endsWith(`.${s}`) && host!.length > s.length + 1);
}

export const API_OVERRIDE_KEY = "cpm.apiBase.v1";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem"> | null | undefined;

export function readApiOverride(storage: Store): string | null {
  try {
    const n = normalizeApiBase(storage?.getItem(API_OVERRIDE_KEY));
    return n && isAllowedOverride(n) ? n : null;
  } catch {
    return null;
  }
}
/** value=null ⇒ xoá ghi đè (quay về giá trị lúc build). Trả false nếu giá trị không hợp lệ hoặc storage lỗi. */
export function saveApiOverride(storage: Store, value: string | null): boolean {
  try {
    if (value === null) {
      storage?.removeItem(API_OVERRIDE_KEY);
      return true;
    }
    const n = normalizeApiBase(value);
    if (!n || !isAllowedOverride(n) || !storage) return false;
    storage.setItem(API_OVERRIDE_KEY, n);
    return true;
  } catch {
    return false;
  }
}

/** Địa chỉ đang dùng: ghi đè lúc chạy nếu có, không thì giá trị lúc build. */
export function effectiveApiBase(buildTime: string | undefined, storage: Store): string | null {
  return readApiOverride(storage) ?? normalizeApiBase(buildTime);
}
export const apiHost = (base: string) => /^https?:\/\/([^/]+)/.exec(base)?.[1] ?? base;

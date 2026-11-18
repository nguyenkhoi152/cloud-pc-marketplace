/**
 * Cấu hình chế độ chạy. `preview` = dữ liệu mô phỏng có nhãn. `live` = Supabase thật; thiếu/sai cấu hình thì
 * app KHÔNG khởi động ở chế độ live và KHÔNG chuyển sang mock để báo thành công.
 * Mọi VITE_* bị nhúng vào bundle nên chỉ được chứa giá trị công khai: key có quyền service/secret bị từ chối.
 */
export type AppMode = "preview" | "live";

export type EnvResult =
  | { mode: "preview" }
  | { mode: "live"; url: string; anonKey: string; apiBase?: string }
  | { mode: "invalid"; problems: string[] };

type RawEnv = Record<string, string | undefined>;

/** Giải mã phần payload của JWT (không xác minh chữ ký) để nhận ra key service_role. */
function jwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf8");
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

export function keyProblem(key: string): string | null {
  if (key.startsWith("sb_secret_")) return "VITE_SUPABASE_ANON_KEY là key SECRET (sb_secret_…). Chỉ dùng key công khai (publishable/anon). Hãy xoay key này trong dashboard vì nó đã bị đặt vào file của app.";
  if (jwtRole(key) === "service_role") return "VITE_SUPABASE_ANON_KEY là key service_role. Chỉ dùng key công khai (publishable/anon). Hãy xoay key này trong dashboard vì nó đã bị đặt vào file của app.";
  if (!key.startsWith("sb_publishable_") && jwtRole(key) !== "anon") return "VITE_SUPABASE_ANON_KEY không giống key publishable (sb_publishable_…) hoặc anon (JWT role=anon).";
  return null;
}

export function readEnv(raw: RawEnv): EnvResult {
  const mode = (raw.VITE_APP_MODE ?? "preview").trim();
  if (mode === "preview" || mode === "") return { mode: "preview" };
  if (mode !== "live") return { mode: "invalid", problems: [`VITE_APP_MODE="${mode}" không hợp lệ (preview | live).`] };
  const problems: string[] = [];
  const url = (raw.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (raw.VITE_SUPABASE_ANON_KEY ?? "").trim();
  if (!url) problems.push("Thiếu VITE_SUPABASE_URL.");
  else if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) problems.push("VITE_SUPABASE_URL phải có dạng https://<project-ref>.supabase.co.");
  if (!key) problems.push("Thiếu VITE_SUPABASE_ANON_KEY.");
  else {
    const p = keyProblem(key);
    if (p) problems.push(p);
  }
  // API server (ví, quote, nhận đường dẫn xem): tuỳ chọn; thiếu thì các thao tác đó bị khoá có lý do, không giả.
  const apiRaw = (raw.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (apiRaw && !/^(https:\/\/[^/\s]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)(\/[^\s]*)?$/.test(apiRaw)) problems.push("VITE_API_BASE_URL phải là https://… (hoặc http://localhost cho dev).");
  return problems.length ? { mode: "invalid", problems } : { mode: "live", url, anonKey: key, apiBase: apiRaw || undefined };
}

export const ENV: EnvResult = readEnv(import.meta.env as unknown as RawEnv);
export const isLive = () => ENV.mode === "live";

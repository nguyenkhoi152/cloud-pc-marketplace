/**
 * Nói thẳng app đang nối với cái gì: phần nào là dữ liệu dev thật, phần nào GIẢ LẬP, phần nào CHƯA kết nối.
 * Suy ra từ cấu hình thật của bản build (không phải chuỗi cố định) để nhãn không lệch với thực tế.
 */
export interface EnvFacts {
  mode: "preview" | "live";
  /** VITE_API_BASE_URL đã chuẩn hoá hoặc null. */
  apiBase: string | null;
  /** RPC của ví giả lập (đã qua kiểm loopback) hoặc null nếu ví giả lập không bật. */
  wallet: { kind: "dev" | "testnet"; rpc: string } | null;
  /** Đang chạy trong app Windows đã cài (có lớp native cho host). */
  native: boolean;
}

export type EnvKind = "real-dev" | "simulated" | "not-connected" | "untested";
export interface EnvRow {
  key: "data" | "api" | "payment" | "stream" | "host" | "workspace" | "extras";
  what: string;
  kind: EnvKind;
  label: string;
  detail: string;
}

export const ENV_KIND_LABEL: Record<EnvKind, string> = {
  "real-dev": "Thật (môi trường dev)",
  simulated: "GIẢ LẬP",
  "not-connected": "Chưa kết nối",
  untested: "Chạy được, chưa đo/kiểm đủ",
};

const isLoopback = (url: string) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/|$)/.test(url);
const hostOf = (url: string) => /^https?:\/\/([^/]+)/.exec(url)?.[1] ?? url;

export function describeEnv(f: EnvFacts): { banner: string; rows: EnvRow[] } {
  if (f.mode === "preview")
    return {
      banner: "BẢN XEM TRƯỚC GIAO DIỆN — dữ liệu, đăng nhập, thanh toán, cài đặt và kết nối đều là mô phỏng.",
      rows: [{ key: "data", what: "Toàn bộ app", kind: "simulated", label: "Dữ liệu mẫu", detail: "Không có máy chủ, ví, chuỗi hay máy cho thuê nào được gọi." }],
    };
  const rows: EnvRow[] = [];
  rows.push({ key: "data", what: "Tài khoản, danh mục máy, đặt chỗ", kind: "real-dev", label: "Supabase dev", detail: "Dữ liệu thật trên project thử nghiệm; không phải dịch vụ công khai, có thể bị xoá." });
  rows.push(
    !f.apiBase
      ? { key: "api", what: "Máy chủ API (ví, báo giá, cấp quyền xem)", kind: "not-connected", label: "Chưa cấu hình", detail: "Thiếu địa chỉ máy chủ API nên không thanh toán và không mở được màn hình máy thuê." }
      : isLoopback(f.apiBase)
        ? { key: "api", what: "Máy chủ API (ví, báo giá, cấp quyền xem)", kind: "real-dev", label: "Chạy cục bộ trên máy này", detail: `${hostOf(f.apiBase)} — chỉ hoạt động khi bộ demo đang chạy trên chính máy này.` }
        : { key: "api", what: "Máy chủ API (ví, báo giá, cấp quyền xem)", kind: "real-dev", label: hostOf(f.apiBase), detail: "Máy chủ thử nghiệm." },
  );
  rows.push(
    f.wallet?.kind === "testnet"
      ? { key: "payment", what: "Ví và thanh toán PCP", kind: "real-dev", label: "VÍ THỬ trong app · Avalanche Fuji (testnet)", detail: `Giao dịch thật trên mạng thử công khai (${hostOf(f.wallet.rpc)}). PCP và AVAX testnet không có giá trị tiền và không đổi ra tiền được. Khoá ví lưu trong app: chỉ dùng cho testnet; xoá dữ liệu app là mất ví.` }
      : f.wallet?.kind === "dev"
      ? { key: "payment", what: "Ví và thanh toán PCP", kind: "simulated", label: "VÍ GIẢ LẬP · chuỗi Hardhat cục bộ", detail: `Chuỗi mô phỏng tại ${hostOf(f.wallet!.rpc)} (không phải Avalanche Fuji, không phải mainnet). PCP ở đây không có giá trị và không đổi được ra tiền.` }
      : { key: "payment", what: "Ví và thanh toán PCP", kind: "not-connected", label: "Chưa kết nối", detail: "Bản này chưa có kết nối ví thật; không thanh toán được nên phiên dừng ở bước giữ máy." },
  );
  rows.push({ key: "stream", what: "Màn hình máy thuê", kind: "untested", label: "Desktop Linux qua Selkies", detail: "Hình ảnh và chuột/bàn phím thật qua gateway của host. Chưa đo độ trễ/FPS, chưa kiểm âm thanh và toàn màn hình; chưa thử trên host có GPU." });
  rows.push({
    key: "host", what: "Cho thuê máy trên Windows", kind: "untested",
    label: f.native ? "Guest Linux qua WSL2 (cần tự cài WSL)" : "Chỉ có trong app Windows đã cài",
    detail: "App kiểm tra, cài thành phần trong guest, chạy và dừng agent; có giới hạn RAM/CPU, kênh Cloudflare cho người ở mạng khác, chạy nền ở khay hệ thống và nút cài WSL giúp. Mã hoá bằng GPU trong WSL2, khay hệ thống và nút cài WSL chưa được kiểm chứng trên máy thật.",
  });
  rows.push({ key: "workspace", what: "Workspace / lưu project", kind: "not-connected", label: "Chưa kết nối", detail: "Dữ liệu trong máy thuê bị xoá khi phiên kết thúc. Đừng để dữ liệu cần giữ trong phiên." });
  rows.push({ key: "extras", what: "Sự cố, thông báo, hỗ trợ, tranh chấp", kind: "not-connected", label: "Chưa kết nối", detail: "Chưa có màn hình thật cho các mục này. (Thu nhập host đã có: PCP thử, rút về ví.)" });
  const pay = f.wallet?.kind === "testnet" ? "giao dịch trên mạng thử Fuji bằng VÍ THỬ trong app (không có giá trị tiền)" : f.wallet ? "thanh toán bằng VÍ GIẢ LẬP trên chuỗi Hardhat cục bộ (không phải Fuji, không có giá trị)" : "thanh toán CHƯA kết nối";
  return { banner: `BẢN DEMO — dữ liệu Supabase dev · ${pay} · màn hình máy thuê qua Selkies chưa đo hiệu năng.`, rows };
}

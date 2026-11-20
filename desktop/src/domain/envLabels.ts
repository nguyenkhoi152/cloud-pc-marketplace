/**
 * Nhãn mạng hiển thị cho người dùng, SUY RA từ cấu hình thật của bản build (không ghi cứng) để không bao giờ nói sai mạng đang dùng:
 * ví thử trên chuỗi công khai ⇒ Avalanche Fuji; ví cục bộ ⇒ mạng thử cục bộ; chưa có ví ⇒ không nhắc tên mạng.
 * Mọi nhãn nói rõ PCP/AVAX ở đây không có giá trị quy đổi (đó là sự thật của bản này, không phải lời giải thích kỹ thuật).
 */
export interface EnvFacts {
  mode: "preview" | "live";
  /** Địa chỉ máy chủ API đã chuẩn hoá hoặc null. */
  apiBase: string | null;
  /** Ví trong app: `testnet` = ví thử trên chuỗi công khai, `dev` = ví cục bộ; null nếu app không có ví. */
  wallet: { kind: "dev" | "testnet"; rpc: string } | null;
  /** Đang chạy trong app Windows đã cài (có lớp native cho host). */
  native: boolean;
}

export interface NetworkLabel {
  /** Chip ngắn ở thanh trên. */
  chip: string;
  /** Dòng ở chân thanh bên. */
  footer: string;
  /** Chú thích đầy đủ (tooltip, trang Giới thiệu). */
  note: string;
}

/**
 * Nhãn mạng cho chế độ live; null ở bản xem trước (đã có dải "dữ liệu mẫu" riêng).
 * Chưa có ví (chưa biết mạng cụ thể): vẫn nói PCP là token thử nghiệm, KHÔNG gọi tên mạng nào. Điều này đúng với mọi bản hiện tại,
 * và tránh hiện giá PCP mà không có chú thích nào.
 */
export function networkLabel(f: EnvFacts): NetworkLabel | null {
  if (f.mode !== "live") return null;
  if (!f.wallet) return { chip: "Testnet", footer: "Mạng thử nghiệm · PCP không có giá trị quy đổi", note: "PCP là token thử nghiệm và không có giá trị quy đổi." };
  if (f.wallet.kind === "testnet")
    return { chip: "Testnet", footer: "Avalanche Fuji · mạng thử nghiệm", note: "Mạng thử nghiệm Avalanche Fuji. PCP và AVAX ở đây không có giá trị quy đổi." };
  return { chip: "Testnet cục bộ", footer: "Mạng thử nghiệm cục bộ", note: "Mạng thử nghiệm cục bộ trên máy này. PCP ở đây không có giá trị quy đổi." };
}

/** Dải ngắn ở bản xem trước (dữ liệu thật sự là dữ liệu mẫu nên PHẢI ghi rõ). */
export const PREVIEW_BANNER = "Bản xem trước · dữ liệu mẫu";

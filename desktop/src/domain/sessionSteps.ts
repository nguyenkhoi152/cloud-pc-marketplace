/**
 * Tiến trình một phiên thuê theo ngôn ngữ người dùng, suy ra từ trạng thái THẬT (tiền × truy cập) của booking.
 * Không tự suy thêm trạng thái: bước nào chưa có bằng chứng từ máy chủ thì chưa đánh dấu xong.
 */
export type StepState = "done" | "current" | "todo" | "failed" | "skipped";
export interface StepView {
  key: "reserve" | "pay" | "prepare" | "activate" | "use" | "settle" | "cleanup";
  label: string;
  state: StepState;
}
export interface SessionInput {
  state: string;
  accessState: string;
}

const ORDER: { key: StepView["key"]; label: string }[] = [
  { key: "reserve", label: "Giữ máy" },
  { key: "pay", label: "Trả tiền" },
  { key: "prepare", label: "Chuẩn bị máy" },
  { key: "activate", label: "Kích hoạt" },
  { key: "use", label: "Dùng máy" },
  { key: "settle", label: "Kết thúc và thanh toán" },
  { key: "cleanup", label: "Thu hồi và dọn máy" },
];
const ENDING = new Set(["revoking", "revoked", "resetting", "reset_verified"]);
const BAD_ACCESS = new Set(["unknown", "failed"]);

/** Chỉ số bước đang diễn ra (0-based); `ORDER.length` nghĩa là xong hết. */
function currentIndex(b: SessionInput): number {
  switch (b.state) {
    case "reserved":
      return 1;
    case "funded":
      return b.accessState === "ready" ? 3 : 2;
    case "active":
      return ENDING.has(b.accessState) ? 5 : 4;
    case "settled":
    case "resolved":
    case "refunded":
      return b.accessState === "reset_verified" || b.accessState === "not_granted" ? ORDER.length : 6;
    case "disputed":
      return 5;
    default:
      return 1;
  }
}

export function sessionSteps(b: SessionInput): StepView[] {
  // Hết hạn/hủy: chưa bao giờ vào phiên. Các bước chưa tới được đánh dấu "bỏ qua", không phải "xong".
  if (b.state === "expired" || b.state === "cancelled")
    return ORDER.map((s, i) => ({ ...s, state: i === 0 ? "done" : "skipped" }));
  const cur = currentIndex(b);
  const failed = BAD_ACCESS.has(b.accessState);
  return ORDER.map((s, i) => ({ ...s, state: i < cur ? "done" : i === cur ? (failed ? "failed" : "current") : "todo" }));
}

/** Một dòng cho CHỦ MÁY: khách đang ở đâu và máy của mình đang làm gì. Không lộ thông tin của khách. */
export function hostSessionLabel(b: SessionInput): { text: string; tone: "info" | "ok" | "warn" | "neutral"; live: boolean } {
  const mk = (text: string, tone: "info" | "ok" | "warn" | "neutral", live: boolean) => ({ text, tone, live });
  if (BAD_ACCESS.has(b.accessState) && b.state !== "settled") return mk("Máy chưa xác nhận được một bước (đang thử lại); máy bị giữ cho tới khi rõ", "warn", true);
  switch (b.state) {
    case "reserved":
      return mk("Có khách giữ máy, đang chờ khách trả tiền", "info", true);
    case "funded":
      return mk(b.accessState === "ready" ? "Khách đã trả tiền; máy sẵn sàng, chờ kích hoạt" : "Khách đã trả tiền; đang chuẩn bị môi trường khách", "info", true);
    case "active":
      if (b.accessState === "granted") return mk("Khách đang dùng máy", "ok", true);
      if (ENDING.has(b.accessState)) return mk("Phiên đã hết giờ; đang thu hồi quyền và dọn máy", "info", true);
      return mk("Đã kích hoạt; đang cấp quyền cho khách", "info", true);
    case "settled":
      if (b.accessState === "reset_verified" || b.accessState === "not_granted") return mk("Hoàn tất: đã ghi nhận thanh toán cho bạn, máy đã dọn sạch", "ok", false);
      return mk("Đã ghi nhận thanh toán cho bạn; đang thu hồi quyền và dọn máy", "info", true);
    case "disputed":
      return mk("Khách mở tranh chấp; tiền được giữ chờ xử lý", "warn", true);
    case "refunded":
      return mk("Đã hoàn tiền cho khách", "neutral", false);
    case "resolved":
      return mk("Tranh chấp đã được giải quyết", "neutral", false);
    case "expired":
      return mk("Khách không trả tiền kịp; máy đã được nhả", "neutral", false);
    case "cancelled":
      return mk("Khách hủy trước khi kích hoạt; máy đã được nhả", "neutral", false);
    default:
      return mk(`Trạng thái ${b.state}`, "neutral", false);
  }
}

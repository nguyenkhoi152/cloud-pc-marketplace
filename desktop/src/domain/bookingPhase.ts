/**
 * Ánh xạ trạng thái THẬT của booking (tiền × truy cập) sang giai đoạn hiển thị và chính sách tiền áp dụng nếu dừng ở giai đoạn đó.
 * Theo CONTRACT_SPEC (Q3 của spec 003): `activate` đặt startedAt TRƯỚC khi cấp grant; hủy trước activate hoàn đủ;
 * sau activate, kết thúc sớm vẫn trả cả gói. Không đổi chính sách tiền — chỉ nói đúng thời điểm áp dụng chính sách nào.
 */
export type RefundPolicy = "release_free" | "full_refund_on_cancel" | "full_package_charged" | "settled" | "refunded" | "dispute" | "none";

export interface PhaseInput {
  state: string;
  accessState: string;
  startedAt?: string | null;
  endAt?: string | null;
}

export interface BookingPhase {
  key: string;
  label: string;
  detail: string;
  /** Chính sách nếu người dùng dừng ngay ở giai đoạn này. */
  policy: RefundPolicy;
  policyText: string;
  /** Đồng hồ gói đang chạy (chỉ sau activate được chuỗi xác nhận). */
  clockRunning: boolean;
  /** Còn khoảng bao lâu theo endAt trên chuỗi; null nếu đồng hồ chưa chạy/không biết. */
  remainingSec: number | null;
}

export function bookingPhase(b: PhaseInput, nowMs: number = Date.now()): BookingPhase {
  const end = b.endAt ? new Date(b.endAt).getTime() : null;
  const remaining = end === null ? null : Math.max(0, Math.round((end - nowMs) / 1000));
  const mk = (key: string, label: string, detail: string, policy: RefundPolicy, policyText: string, clockRunning = false): BookingPhase => ({
    key, label, detail, policy, policyText, clockRunning, remainingSec: clockRunning ? remaining : null,
  });
  switch (b.state) {
    case "reserved":
      return mk("reserved", "Đang giữ máy, chờ thanh toán", "Máy bị giữ tới hạn thanh toán; chưa tốn PCP nào.", "release_free", "Không thanh toán thì máy được nhả sau khi máy chủ đối soát chuỗi; không mất gì.");
    case "funded": {
      const ready = b.accessState === "ready";
      return mk("funded", ready ? "Đã thanh toán, chờ kích hoạt" : "Đã thanh toán, đang chuẩn bị máy", ready ? "Máy đã sẵn sàng; hệ thống sẽ kích hoạt. Đồng hồ gói CHƯA chạy." : "Đang chuẩn bị môi trường. Đồng hồ gói CHƯA chạy.", "full_refund_on_cancel", "Hủy trước khi kích hoạt: hoàn đủ PCP đã trả.");
    }
    case "active": {
      // Hết giờ (hoặc dừng sớm): watchdog/worker thu hồi quyền trong khi tiền còn `active` (chờ accept/claim được ghi nhận).
      if (["revoking", "revoked", "resetting", "reset_verified"].includes(b.accessState))
        return mk("active_ending", "Đã hết giờ, đang thu hồi và dọn máy", "Quyền vào máy đã/đang bị thu hồi; máy được reset rồi mới nhận khách khác. Việc thanh toán chốt khi giao dịch được ghi nhận trên chuỗi.", "full_package_charged", "Đã dùng hết gói/kết thúc: đã trả cả gói (không hoàn phần chưa dùng).");
      if (b.accessState === "granted")
        return mk("active_granted", "Đang dùng", "Phiên đang mở. Đồng hồ gói chạy theo thời điểm kết thúc trên chuỗi.", "full_package_charged", "Kết thúc sớm sau khi đã kích hoạt: vẫn trả cả gói (không hoàn phần chưa dùng).", true);
      if (b.accessState === "unknown" || b.accessState === "failed")
        return mk("active_blocked", "Đã kích hoạt nhưng chưa vào được", "Đồng hồ gói ĐÃ chạy nhưng việc cấp quyền gặp sự cố; có thể mở tranh chấp nếu không dùng được.", "full_package_charged", "Đã kích hoạt: nếu không tự giải quyết được, dùng tranh chấp thay vì mong hoàn tự động.", true);
      return mk("active_pending_grant", "Đã kích hoạt, đang cấp quyền vào máy", "Đồng hồ gói ĐÃ chạy (từ lúc kích hoạt), kể cả khi chưa mở viewer.", "full_package_charged", "Từ lúc kích hoạt, dừng sớm vẫn trả cả gói.", true);
    }
    case "settled":
      return mk("settled", "Đã kết thúc và thanh toán", "Đã trả cả gói cho host.", "settled", "Không hoàn.");
    case "refunded":
      return mk("refunded", "Đã hoàn", "Booking đã hoàn tiền.", "refunded", "Đã hoàn.");
    case "disputed":
      return mk("disputed", "Đang tranh chấp", "Tiền được giữ chờ trọng tài; quyền truy cập đã thu hồi.", "dispute", "Kết quả do trọng tài quyết định (hết hạn không giải quyết: hoàn đủ).");
    case "resolved":
      return mk("resolved", "Đã giải quyết tranh chấp", "Đã chia theo quyết định trọng tài.", "settled", "Đã chốt.");
    case "expired":
    case "cancelled":
      return mk(b.state, b.state === "expired" ? "Hết hạn giữ máy" : "Đã hủy", "Không có khoản nào bị trừ.", "none", "Không có khoản nào bị trừ.");
    default:
      return mk("unknown", `Trạng thái ${b.state}`, "Chưa có mô tả cho trạng thái này.", "none", "");
  }
}

export const formatRemaining = (sec: number) => `${Math.floor(sec / 60)} phút ${String(sec % 60).padStart(2, "0")} giây`;

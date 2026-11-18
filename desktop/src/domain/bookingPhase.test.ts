import { describe, expect, it } from "vitest";
import { bookingPhase, formatRemaining } from "./bookingPhase";

const NOW = Date.parse("2026-11-09T13:00:00Z");

describe("bookingPhase (Q3: hủy trước kích hoạt ≠ kết thúc sau kích hoạt)", () => {
  it("trước kích hoạt: đồng hồ CHƯA chạy; hủy hoàn đủ; còn reserved thì không mất gì", () => {
    const r = bookingPhase({ state: "reserved", accessState: "not_granted" }, NOW);
    expect([r.clockRunning, r.remainingSec, r.policy]).toEqual([false, null, "release_free"]);
    for (const access of ["not_granted", "preparing", "ready"]) {
      const f = bookingPhase({ state: "funded", accessState: access }, NOW);
      expect(f.clockRunning).toBe(false);
      expect(f.policy).toBe("full_refund_on_cancel");
      expect(f.policyText).toMatch(/hoàn đủ/);
    }
  });

  it("sau kích hoạt: đồng hồ chạy ngay (kể cả chưa cấp quyền/chưa mở viewer); kết thúc sớm vẫn trả cả gói; còn lại tính theo endAt", () => {
    const endAt = "2026-11-09T13:12:30Z";
    for (const access of ["ready", "granted", "failed", "unknown"]) {
      const a = bookingPhase({ state: "active", accessState: access, endAt }, NOW);
      expect(a.clockRunning, access).toBe(true);
      expect(a.policy, access).toBe("full_package_charged");
      expect(a.remainingSec, access).toBe(750);
    }
    expect(bookingPhase({ state: "active", accessState: "ready", endAt }, NOW).label).toMatch(/Đã kích hoạt/);
    expect(bookingPhase({ state: "active", accessState: "granted", endAt }, NOW).label).toBe("Đang dùng");
    expect(bookingPhase({ state: "active", accessState: "granted", endAt: "2026-11-09T12:00:00Z" }, NOW).remainingSec).toBe(0); // quá hạn: không âm
  });

  it("sau endAt: tiền còn active nhưng quyền đã thu hồi/dọn → 'đang thu hồi', KHÔNG phải 'đang cấp quyền'; không đếm ngược", () => {
    for (const access of ["revoking", "revoked", "resetting", "reset_verified"]) {
      const a = bookingPhase({ state: "active", accessState: access, endAt: "2026-11-09T12:59:00Z" }, NOW);
      expect(a.key, access).toBe("active_ending");
      expect(a.label, access).toMatch(/thu hồi/);
      expect(a.clockRunning, access).toBe(false);
      expect(a.remainingSec, access).toBeNull();
      expect(a.policy, access).toBe("full_package_charged");
    }
  });

  it("trạng thái cuối và lạ: không hứa hoàn hay trừ sai; trạng thái lạ không làm hỏng giao diện", () => {
    expect(bookingPhase({ state: "settled", accessState: "reset_verified" }, NOW).policy).toBe("settled");
    expect(bookingPhase({ state: "refunded", accessState: "not_granted" }, NOW).policy).toBe("refunded");
    expect(bookingPhase({ state: "disputed", accessState: "revoked" }, NOW).policy).toBe("dispute");
    expect(bookingPhase({ state: "expired", accessState: "not_granted" }, NOW).policyText).toMatch(/Không có khoản nào/);
    expect(bookingPhase({ state: "chua-co", accessState: "x" }, NOW).key).toBe("unknown");
    expect(bookingPhase({ state: "funded", accessState: "ready", endAt: "2026-11-09T13:10:00Z" }, NOW).remainingSec).toBeNull(); // chưa kích hoạt: không hiện đếm ngược
  });

  it("formatRemaining", () => {
    expect(formatRemaining(750)).toBe("12 phút 30 giây");
    expect(formatRemaining(5)).toBe("0 phút 05 giây");
  });
});

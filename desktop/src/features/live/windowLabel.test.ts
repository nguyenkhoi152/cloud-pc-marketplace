// Khung nhận thuê của host hiển thị như app thật: thứ + ngày/tháng + giờ phút theo GMT+7, không có giây hay định dạng ISO.
import { describe, expect, it } from "vitest";
import { windowLabel } from "./LiveScreens";

describe("windowLabel", () => {
  it("19:00–23:00 giờ Việt Nam của Thứ Hai 23/11/2026 (12:00–16:00 UTC)", () => {
    expect(windowLabel({ day: "2026-11-23", startsAt: "2026-11-23T12:00:00Z", endsAt: "2026-11-23T16:00:00Z" })).toBe("Thứ Hai 23/11, 19:00–23:00");
  });
  it("đúng thứ ở đầu và cuối tuần, kể cả ngày mà giờ UTC sang ngày khác", () => {
    expect(windowLabel({ day: "2026-11-22", startsAt: "2026-11-22T13:00:00Z", endsAt: "2026-11-22T17:00:00Z" })).toBe("Chủ nhật 22/11, 20:00–00:00");
    expect(windowLabel({ day: "2026-11-27", startsAt: "2026-11-27T03:30:00Z", endsAt: "2026-11-27T05:00:00Z" })).toBe("Thứ Sáu 27/11, 10:30–12:00");
  });
  it("không còn dạng ISO hay giây", () => {
    const s = windowLabel({ day: "2026-11-23", startsAt: "2026-11-23T12:00:00Z", endsAt: "2026-11-23T16:00:00Z" });
    expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}|:\d{2}:\d{2}/);
  });
});

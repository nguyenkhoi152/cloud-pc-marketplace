import { describe, expect, it } from "vitest";
import { mapBooking } from "./live";

const base = { id: "b", machine_id: "m", state: "funded", access_state: "not_granted", price_units: "20000000000000000000", fee_bps: 1000, duration_seconds: 900, fund_by: "2026-11-10T00:00:00Z", activate_by: "2026-11-10T00:05:00Z", workspace_mode: "none" as const, created_at: "2026-11-10T00:00:00Z" };

describe("mapBooking: mã booking trên chuỗi", () => {
  it("bytea dạng \\x… của PostgREST → 0x + 64 hex", () => {
    const hex = "ab".repeat(32);
    expect(mapBooking({ ...base, chain_booking_id: "\\x" + hex }).chainBookingId).toBe("0x" + hex);
  });
  it("thiếu, rỗng, sai độ dài hoặc không phải hex → null (không đoán)", () => {
    for (const v of [undefined, null, "", "\\x1234", "0x" + "ab".repeat(32), "\\x" + "zz".repeat(32)]) {
      expect(mapBooking({ ...base, chain_booking_id: v as string | null | undefined }).chainBookingId, String(v)).toBeNull();
    }
  });
});

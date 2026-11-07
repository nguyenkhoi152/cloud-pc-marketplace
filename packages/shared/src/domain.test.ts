import { describe, expect, it } from "vitest";
import { filterMachines, formatPcp, parsePcp, parsePositivePcp, PCP_SUPPLY_CAP_UNITS, loadConfig, machineSchema, previewMachines, splitFee } from "./index";

describe("domain", () => {
  it("fixture hợp lệ schema và không khẳng định online", () => {
    for (const m of previewMachines) expect(machineSchema.parse(m).online).toBe("unknown");
  });
  it("lọc theo VRAM và workspace", () => {
    expect(filterMachines(previewMachines, { minVramGb: 10 }).map((m) => m.id)).toEqual(["demo-3"]);
    expect(filterMachines(previewMachines, { workspaceOnly: true })).toHaveLength(2);
  });
  it("phí 10% của 20 PCP = 2 PCP, bảo toàn tổng", () => {
    const { fee, host } = splitFee(parsePcp("20"), 1000);
    expect(fee).toBe(parsePcp("2"));
    expect(host).toBe(parsePcp("18"));
    expect(fee + host).toBe(parsePcp("20"));
  });
  it("feeBps ngoài khoảng bị từ chối", () => {
    expect(() => splitFee(1n, 10_001)).toThrow();
    expect(() => splitFee(1n, -1)).toThrow();
  });
});

describe("PCP bigint", () => {
  it("parse chính xác 18 decimals", () => {
    expect(parsePcp("0")).toBe(0n);
    expect(parsePcp("1")).toBe(10n ** 18n);
    expect(parsePcp("0.000000000000000001")).toBe(1n);
    expect(parsePcp("1.123456789012345678")).toBe(1123456789012345678n);
    expect(parsePcp("0.1") + parsePcp("0.2")).toBe(parsePcp("0.3")); // float sẽ sai
  });
  it("từ chối số âm, sai định dạng, quá độ chính xác", () => {
    for (const bad of ["-1", "+1", "1e3", "1,5", " 1", "1 ", "", ".5", "5.", "01", "0x10", "NaN", "1.0000000000000000001", "١٢"]) {
      expect(() => parsePcp(bad), bad).toThrow(RangeError);
    }
    // @ts-expect-error kiểm tra runtime với number
    expect(() => parsePcp(20)).toThrow(RangeError);
  });
  it("giới hạn supply cap và số dương", () => {
    expect(parsePcp("1000000")).toBe(PCP_SUPPLY_CAP_UNITS);
    expect(() => parsePcp("1000000.000000000000000001")).toThrow(RangeError);
    expect(() => parsePositivePcp("0")).toThrow(RangeError);
    expect(parsePositivePcp("0.000000000000000001")).toBe(1n);
  });
  it("format round-trip", () => {
    for (const s of ["0", "20", "0.5", "1.123456789012345678", "999999.999999999999999999"]) {
      expect(formatPcp(parsePcp(s))).toBe(s);
    }
    expect(() => formatPcp(-1n)).toThrow(RangeError);
  });
  it("lọc giá không mất độ chính xác", () => {
    expect(filterMachines(previewMachines, { maxPrice: "19.999999999999999999" })).toHaveLength(0);
    expect(filterMachines(previewMachines, { maxPrice: "20" })).toHaveLength(3);
  });
  it("phí trên số lẻ 1 wei không tạo/mất token", () => {
    const { fee, host } = splitFee(1n, 1000);
    expect(fee + host).toBe(1n);
  });
});

describe("loadConfig", () => {
  it("preview chạy không cần secret", () => {
    expect(loadConfig({}).APP_MODE).toBe("preview");
  });
  it("production từ chối khi thiếu cấu hình", () => {
    expect(() => loadConfig({ APP_MODE: "production" })).toThrow(/thiếu/);
  });
  it("production hợp lệ thì qua", () => {
    const a = "0x" + "1".repeat(40);
    expect(
      loadConfig({
        APP_MODE: "production", SUPABASE_URL: "https://x", SUPABASE_ANON_KEY: "k",
        NEXT_PUBLIC_PCP_ADDRESS: a, NEXT_PUBLIC_ESCROW_ADDRESS: a,
      }).APP_MODE,
    ).toBe("production");
  });
});

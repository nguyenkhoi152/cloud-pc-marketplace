import { describe, expect, it } from "vitest";
import { shortUnits } from "./displayUnits";

describe("shortUnits", () => {
  it("số ngắn giữ nguyên, không thêm dấu ≈", () => {
    expect(shortUnits("20")).toEqual({ text: "20", exact: "20", truncated: false });
    expect(shortUnits("0.5")).toEqual({ text: "0.5", exact: "0.5", truncated: false });
    expect(shortUnits("1.2345")).toMatchObject({ text: "1.2345", truncated: false });
  });
  it("số dài bị cắt còn 4 chữ số lẻ, kèm ≈, và giữ giá trị đầy đủ", () => {
    expect(shortUnits("12.34567890123456789")).toEqual({ text: "≈ 12.3456", exact: "12.34567890123456789", truncated: true });
  });
  it("cắt chứ không làm tròn lên (không hiển thị nhiều hơn số thật)", () => {
    expect(shortUnits("0.99999999").text).toBe("≈ 0.9999");
    expect(shortUnits("5.12349999").text).toBe("≈ 5.1234");
  });
  it("phần lẻ bị cắt toàn số 0 thì bỏ luôn phần lẻ", () => {
    expect(shortUnits("3.000012345").text).toBe("≈ 3");
    expect(shortUnits("10.00004").text).toBe("≈ 10");
  });
  it("nhận số lẻ tùy chỉnh", () => {
    expect(shortUnits("1.23456789", 2).text).toBe("≈ 1.23");
  });
});

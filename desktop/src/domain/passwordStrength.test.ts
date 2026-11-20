import { describe, expect, it } from "vitest";
import { passwordStrength } from "./passwordStrength";

describe("passwordStrength", () => {
  it("rỗng thì không hiển thị gì; dưới 8 ký tự thì chưa đạt", () => {
    expect(passwordStrength("")).toEqual({ level: 0, label: "" });
    expect(passwordStrength("abc123!")).toEqual({ level: 0, label: "Chưa đủ 8 ký tự" });
  });
  it("đủ 8 ký tự là đạt yêu cầu, kể cả khi toàn chữ thường", () => {
    expect(passwordStrength("abcdefgh")).toEqual({ level: 1, label: "Đạt yêu cầu" });
  });
  it("dài và đa dạng hơn thì lên mức khá rồi mạnh", () => {
    expect(passwordStrength("abcdefgh12")).toEqual({ level: 2, label: "Khá" });
    expect(passwordStrength("Abcdefgh1234")).toEqual({ level: 3, label: "Mạnh" });
  });
  it("dài nhưng chỉ một loại ký tự thì không quá mức đạt", () => {
    expect(passwordStrength("aaaaaaaaaaaaaaaa").level).toBe(1);
  });
  it("mức luôn đơn điệu theo độ dài khi thêm ký tự đa dạng (không tụt mức)", () => {
    const steps = ["a", "abcdefgh", "abcdefgh1", "abcdefgh12", "Abcdefgh12!", "Abcdefgh12!x"].map((p) => passwordStrength(p).level);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]!);
  });
});

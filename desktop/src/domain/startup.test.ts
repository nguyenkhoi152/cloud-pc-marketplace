import { describe, expect, it } from "vitest";
import { MODE_KEY, readSavedMode, saveMode, startupRoute } from "./startup";

describe("startupRoute: người đã đăng nhập mở app không còn kẹt ở Welcome", () => {
  it("URL không hash (mở từ Start Menu) và các trang vào cửa công khai ⇒ về trang chủ của chế độ lần trước", () => {
    for (const h of ["", "#", "#/", "#/welcome", "#/login", "#/register", "#/recover", "#/welcome?x=1", "#/login/"]) {
      expect(startupRoute(h, "rent"), h).toBe("/rent/discover");
      expect(startupRoute(h, "host"), h).toBe("/host");
    }
  });
  it("liên kết sâu / tải lại giữa chừng được giữ nguyên (không bị đẩy về trang chủ)", () => {
    for (const h of ["#/rent/history", "#/host/setup", "#/wallet", "#/choose-mode", "#/rent/machine/abc", "#/about"]) {
      expect(startupRoute(h, "rent"), h).toBeNull();
      expect(startupRoute(h, "host"), h).toBeNull();
    }
  });
});

describe("chế độ lần trước", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
  it("lưu rồi đọc lại; mặc định và giá trị lạ là Thuê", () => {
    const s = mem();
    expect(readSavedMode(s)).toBe("rent");
    saveMode(s, "host");
    expect(s.m.get(MODE_KEY)).toBe("host");
    expect(readSavedMode(s)).toBe("host");
    s.m.set(MODE_KEY, "admin");
    expect(readSavedMode(s)).toBe("rent"); // không có đường nào để một giá trị lạ trở thành quyền
    expect(readSavedMode(null)).toBe("rent");
  });
  it("storage bị chặn (ném lỗi) không làm app lỗi", () => {
    const bad = { getItem: () => { throw new Error("chặn"); }, setItem: () => { throw new Error("chặn"); } };
    expect(readSavedMode(bad)).toBe("rent");
    expect(() => saveMode(bad, "host")).not.toThrow();
  });
});

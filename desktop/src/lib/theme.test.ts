import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, THEME_KEY, applyTheme, loadTheme, parseTheme, saveTheme } from "./theme";

const memory = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => void (data[k] = v),
  };
};

describe("theme: đọc/lưu/áp dụng", () => {
  it("mặc định là tối", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(loadTheme(memory())).toBe("dark");
    expect(loadTheme(null)).toBe("dark");
  });

  it("chỉ 'light' ra theme sáng; giá trị lạ hay rỗng về tối", () => {
    expect(parseTheme("light")).toBe("light");
    for (const v of ["dark", "", "LIGHT", "blue", null, undefined, 1]) expect(parseTheme(v)).toBe("dark");
  });

  it("lưu rồi đọc lại đúng lựa chọn", () => {
    const s = memory();
    saveTheme(s, "light");
    expect(s.data[THEME_KEY]).toBe("light");
    expect(loadTheme(s)).toBe("light");
    saveTheme(s, "dark");
    expect(loadTheme(s)).toBe("dark");
  });

  it("storage bị chặn (ném lỗi) thì không văng, dùng mặc định", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(loadTheme(broken)).toBe("dark");
    expect(() => saveTheme(broken, "light")).not.toThrow();
  });

  it("gắn theme lên thuộc tính data-theme của <html>", () => {
    const root = { dataset: {} as DOMStringMap };
    applyTheme("light", root);
    expect(root.dataset.theme).toBe("light");
    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");
  });
});

describe("theme: chuyển đổi và nhớ lựa chọn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("toggle đổi tối <-> sáng, ghi vào storage và báo cho người nghe", async () => {
    const s = memory();
    const root = { dataset: {} as DOMStringMap };
    vi.stubGlobal("localStorage", s);
    vi.stubGlobal("document", { documentElement: root });
    vi.resetModules();
    const t = await import("./theme");

    expect(t.getTheme()).toBe("dark");
    t.initTheme();
    expect(root.dataset.theme).toBe("dark");

    t.toggleTheme();
    expect(t.getTheme()).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(s.data[THEME_KEY]).toBe("light");

    t.toggleTheme();
    expect(t.getTheme()).toBe("dark");
    expect(s.data[THEME_KEY]).toBe("dark");
  });

  it("lần mở sau đọc lại theme đã lưu", async () => {
    vi.stubGlobal("localStorage", memory({ [THEME_KEY]: "light" }));
    vi.resetModules();
    const t = await import("./theme");
    expect(t.getTheme()).toBe("light");
  });
});

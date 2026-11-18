import { describe, expect, it } from "vitest";
import { BACKGROUND_KEY, readBackgroundPref, setBackgroundPref, syncBackgroundToNative } from "./background";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe("tuỳ chọn chạy nền", () => {
  it("mặc định TẮT; chỉ '1' mới là bật; storage lỗi ⇒ tắt", () => {
    expect(readBackgroundPref(mem())).toBe(false);
    const s = mem();
    s.m.set(BACKGROUND_KEY, "1");
    expect(readBackgroundPref(s)).toBe(true);
    s.m.set(BACKGROUND_KEY, "true");
    expect(readBackgroundPref(s)).toBe(false);
    expect(readBackgroundPref({ getItem: () => { throw new Error("x"); }, setItem: () => undefined })).toBe(false);
    expect(readBackgroundPref(null)).toBe(false);
  });
  it("bật: báo lớp native rồi mới lưu; lớp native từ chối ⇒ KHÔNG lưu và trả false (giao diện không nói 'bật' khi thực tế tắt)", async () => {
    const calls: boolean[] = [];
    const s = mem();
    expect(await setBackgroundPref(s, true, { setBackground: async (v) => { calls.push(v); } })).toBe(true);
    expect(calls).toEqual([true]);
    expect(s.m.get(BACKGROUND_KEY)).toBe("1");
    const bad = mem();
    expect(await setBackgroundPref(bad, true, { setBackground: async () => { throw new Error("unsupported"); } })).toBe(false);
    expect(bad.m.has(BACKGROUND_KEY)).toBe(false);
  });
  it("đồng bộ lúc khởi động: gửi giá trị đã lưu; không có lớp native thì không gọi; lỗi không làm sập", async () => {
    const calls: boolean[] = [];
    const s = mem();
    s.m.set(BACKGROUND_KEY, "1");
    await syncBackgroundToNative(s, true, { setBackground: async (v) => { calls.push(v); } });
    await syncBackgroundToNative(s, false, { setBackground: async (v) => { calls.push(!v); } });
    expect(calls).toEqual([true]);
    await expect(syncBackgroundToNative(s, true, { setBackground: async () => { throw new Error("old shell"); } })).resolves.toBeUndefined();
  });
});

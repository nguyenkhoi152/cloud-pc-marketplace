import { describe, expect, it } from "vitest";
import { cpuChoices, limitWarning, loadLimits, ramChoicesGb, saveLimits, toLimitInput } from "./hostLimits";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe("lựa chọn giới hạn", () => {
  it("RAM: tối đa 80% tổng, luôn chừa phần cho chủ máy; không biết tổng thì không đưa lựa chọn", () => {
    expect(ramChoicesGb(16 * 1024)).toEqual([2, 4, 6, 8, 12]); // 80% của 16 GB = 12.8 → 12
    expect(ramChoicesGb(4 * 1024)).toEqual([2]); // 3.2 → 3 ⇒ chỉ 2
    expect(ramChoicesGb(2 * 1024)).toEqual([]); // 1.6 → 1: không đủ cho mức tối thiểu 2 GB
    expect(ramChoicesGb(null)).toEqual([]);
    expect(ramChoicesGb(0)).toEqual([]);
  });
  it("CPU: chừa ít nhất một lõi khi có từ 2 lõi", () => {
    expect(cpuChoices(8)).toEqual([1, 2, 3, 4, 6]); // 80% của 8 = 6.4 → 6
    expect(cpuChoices(2)).toEqual([1]);
    expect(cpuChoices(1)).toEqual([1]);
    expect(cpuChoices(null)).toEqual([]);
  });
  it("toLimitInput: đổi GB → MiB; bỏ giá trị không còn hợp lệ với máy này (lưu từ máy khác)", () => {
    expect(toLimitInput({ ramGb: 8, cpus: 4 }, 16 * 1024, 8)).toEqual({ memoryMb: 8192, cpus: 4 });
    expect(toLimitInput({ ramGb: 64, cpus: 32 }, 16 * 1024, 8)).toEqual({});
    expect(toLimitInput({ ramGb: null, cpus: null }, 16 * 1024, 8)).toEqual({});
    expect(toLimitInput({ ramGb: 8, cpus: 4 }, null, null)).toEqual({});
  });
  it("lưu/đọc; giá trị hỏng hoặc storage lỗi ⇒ không giới hạn", () => {
    const s = mem();
    saveLimits(s, { ramGb: 8, cpus: 4 });
    expect(loadLimits(s)).toEqual({ ramGb: 8, cpus: 4 });
    s.m.set("cpm.hostLimits.v1", "{\"ramGb\":\"8; rm -rf\",\"cpus\":1.5}");
    expect(loadLimits(s)).toEqual({ ramGb: null, cpus: null });
    s.m.set("cpm.hostLimits.v1", "không phải json");
    expect(loadLimits(s)).toEqual({ ramGb: null, cpus: null });
    expect(loadLimits(null)).toEqual({ ramGb: null, cpus: null });
    expect(() => saveLimits({ getItem: () => null, setItem: () => { throw new Error("x"); } }, { ramGb: 2, cpus: 1 })).not.toThrow();
  });
  it("cảnh báo khi dưới mức khuyến nghị", () => {
    expect(limitWarning({ ramGb: 8, cpus: 4 })).toBeNull();
    expect(limitWarning({ ramGb: 2, cpus: 1 })).toContain("RAM dưới 4 GB và dưới 2 CPU");
    expect(limitWarning({ ramGb: null, cpus: null })).toBeNull();
  });
});

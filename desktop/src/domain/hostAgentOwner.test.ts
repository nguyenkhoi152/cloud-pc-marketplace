import { describe, expect, it } from "vitest";
import { backgroundAgent, blocksEnroll } from "./hostAgentOwner";

const M1 = "11111111-2222-3333-4444-555555555555";
const M2 = "99999999-8888-7777-6666-555555555555";
const probe = (o: Partial<{ ok: boolean; agentRunning: boolean; machineId: string | null }> = {}) => ({ ok: true, agentRunning: true, machineId: M1 as string | null, ...o });

describe("backgroundAgent: agent chạy nền trong bản Linux không do app này quản lý", () => {
  it("máy do chính app này bật thì không phải 'chạy nền' (đã có nút Dừng riêng)", () => {
    expect(backgroundAgent(probe(), true, [M1])).toEqual({ kind: "none" });
  });
  it("không có agent chạy, hoặc chưa có kết quả kiểm tra tin cậy: không có", () => {
    expect(backgroundAgent(probe({ agentRunning: false }), false, [M1])).toEqual({ kind: "none" });
    expect(backgroundAgent(probe({ ok: false }), false, [M1])).toEqual({ kind: "none" });
    expect(backgroundAgent(null, false, [M1])).toEqual({ kind: "none" });
  });
  it("máy của agent thuộc tài khoản đang đăng nhập: mine", () => {
    expect(backgroundAgent(probe(), false, [M2, M1])).toEqual({ kind: "mine", machineId: M1 });
  });
  it("máy của agent KHÔNG thuộc tài khoản đang đăng nhập (vd. Neeez còn chạy nền, đăng nhập tài khoản khác): other", () => {
    expect(backgroundAgent(probe(), false, [M2])).toEqual({ kind: "other", machineId: M1 });
    expect(backgroundAgent(probe(), false, [])).toEqual({ kind: "other", machineId: M1 });
  });
  it("chưa biết máy nào hoặc chưa tải được danh sách máy của tài khoản: unknown (không đoán là của ai)", () => {
    expect(backgroundAgent(probe({ machineId: null }), false, [M1])).toEqual({ kind: "unknown", machineId: null });
    expect(backgroundAgent(probe(), false, null)).toEqual({ kind: "unknown", machineId: M1 });
  });
});

describe("blocksEnroll", () => {
  it("mọi agent chạy nền đều chặn ghi danh (bản Linux từ chối khi còn agent), không có thì không chặn", () => {
    expect(blocksEnroll({ kind: "none" })).toBe(false);
    for (const kind of ["mine", "other", "unknown"] as const) expect(blocksEnroll({ kind, machineId: M1 })).toBe(true);
  });
});

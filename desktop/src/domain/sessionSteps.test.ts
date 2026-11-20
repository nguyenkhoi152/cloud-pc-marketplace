import { describe, expect, it } from "vitest";
import { hostSessionLabel, sessionSteps } from "./sessionSteps";

const states = (state: string, accessState: string) => sessionSteps({ state, accessState }).map((s) => s.state).join(",");

describe("sessionSteps (theo đúng vòng đời đã chạy thật: reserved → funded → active → settled → reset_verified)", () => {
  it("mỗi cặp trạng thái tiền × truy cập chỉ có MỘT bước đang diễn ra và các bước trước nó đã xong", () => {
    expect(states("reserved", "not_granted")).toBe("done,current,todo,todo,todo,todo,todo");
    expect(states("funded", "not_granted")).toBe("done,done,current,todo,todo,todo,todo");
    expect(states("funded", "preparing")).toBe("done,done,current,todo,todo,todo,todo");
    expect(states("funded", "ready")).toBe("done,done,done,current,todo,todo,todo");
    expect(states("active", "ready")).toBe("done,done,done,done,current,todo,todo");
    expect(states("active", "granted")).toBe("done,done,done,done,current,todo,todo");
    expect(states("active", "revoked")).toBe("done,done,done,done,done,current,todo");
    expect(states("settled", "granted")).toBe("done,done,done,done,done,done,current");
    expect(states("settled", "resetting")).toBe("done,done,done,done,done,done,current");
    expect(states("settled", "reset_verified")).toBe("done,done,done,done,done,done,done");
  });
  it("dọn máy CHƯA xác minh thì chưa bao giờ đánh dấu xong hết", () => {
    for (const a of ["granted", "revoking", "revoked", "resetting", "unknown"]) expect(states("settled", a).endsWith("done")).toBe(false);
  });
  it("bước gặp sự cố (unknown/failed) hiện là lỗi, không phải đang chạy", () => {
    expect(states("active", "unknown")).toBe("done,done,done,done,failed,todo,todo");
    expect(states("funded", "failed")).toBe("done,done,failed,todo,todo,todo,todo");
  });
  it("hết hạn/hủy: các bước chưa tới là 'bỏ qua', không phải 'xong'", () => {
    expect(states("expired", "not_granted")).toBe("done,skipped,skipped,skipped,skipped,skipped,skipped");
    expect(states("cancelled", "not_granted")).toBe("done,skipped,skipped,skipped,skipped,skipped,skipped");
  });
});

describe("hostSessionLabel", () => {
  it("nói bằng lời cho chủ máy; chỉ báo hoàn tất khi máy đã dọn và xác minh", () => {
    expect(hostSessionLabel({ state: "reserved", accessState: "not_granted" })).toMatchObject({ live: true, text: expect.stringContaining("chờ khách trả tiền") });
    expect(hostSessionLabel({ state: "active", accessState: "granted" })).toMatchObject({ live: true, tone: "ok", text: "Khách đang dùng máy" });
    expect(hostSessionLabel({ state: "settled", accessState: "resetting" })).toMatchObject({ live: true, text: expect.stringContaining("đang thu hồi") });
    expect(hostSessionLabel({ state: "settled", accessState: "reset_verified" })).toMatchObject({ live: false, tone: "ok", text: expect.stringContaining("Hoàn tất") });
    expect(hostSessionLabel({ state: "active", accessState: "unknown" })).toMatchObject({ tone: "warn", live: true });
    expect(hostSessionLabel({ state: "expired", accessState: "not_granted" }).live).toBe(false);
  });
});

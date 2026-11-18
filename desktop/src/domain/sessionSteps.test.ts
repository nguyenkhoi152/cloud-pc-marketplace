import { describe, expect, it } from "vitest";
import { describeEnv } from "./envLabels";
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

describe("describeEnv (nhãn thật/giả lập/chưa kết nối suy từ cấu hình)", () => {
  const live = { mode: "live" as const, apiBase: "http://127.0.0.1:3000/api", wallet: { kind: "dev" as const, rpc: "http://127.0.0.1:8545" }, native: true };
  const row = (e: ReturnType<typeof describeEnv>, k: string) => e.rows.find((r) => r.key === k)!;
  it("demo cục bộ: ví GIẢ LẬP + Hardhat cục bộ + không phải Fuji; API cục bộ; dữ liệu dev", () => {
    const e = describeEnv(live);
    expect(e.banner).toContain("VÍ GIẢ LẬP");
    expect(e.banner).toContain("không phải Fuji");
    expect(row(e, "payment")).toMatchObject({ kind: "simulated", label: expect.stringContaining("Hardhat cục bộ") });
    expect(row(e, "payment").detail).toContain("không có giá trị");
    expect(row(e, "api")).toMatchObject({ kind: "real-dev", label: "Chạy cục bộ trên máy này" });
    expect(row(e, "data").kind).toBe("real-dev");
    expect(row(e, "workspace").kind).toBe("not-connected");
  });
  it("không có ví giả lập ⇒ thanh toán 'chưa kết nối' (không gọi là giả lập, không gọi là thật)", () => {
    const e = describeEnv({ ...live, wallet: null });
    expect(row(e, "payment").kind).toBe("not-connected");
    expect(e.banner).toContain("thanh toán CHƯA kết nối");
    expect(e.banner).not.toContain("VÍ GIẢ LẬP");
  });
  it("ví thử trên chuỗi công khai: gọi là VÍ THỬ (testnet), nói rõ không có giá trị tiền, KHÔNG gọi là giả lập Hardhat", () => {
    const e = describeEnv({ ...live, apiBase: "https://abc-def.trycloudflare.com/api", wallet: { kind: "testnet", rpc: "https://api.avax-test.network/ext/bc/C/rpc" } });
    expect(row(e, "payment")).toMatchObject({ kind: "real-dev", label: expect.stringContaining("VÍ THỬ") });
    expect(row(e, "payment").detail).toContain("không có giá trị tiền");
    expect(row(e, "payment").detail).toContain("api.avax-test.network");
    expect(e.banner).toContain("mạng thử Fuji");
    expect(e.banner).not.toContain("Hardhat");
    expect(row(e, "api").label).toBe("abc-def.trycloudflare.com");
  });
  it("thiếu máy chủ API ⇒ nói rõ hệ quả; API từ xa ⇒ hiện tên máy chủ", () => {
    expect(row(describeEnv({ ...live, apiBase: null }), "api").kind).toBe("not-connected");
    expect(row(describeEnv({ ...live, apiBase: "https://api.example.com/api" }), "api").label).toBe("api.example.com");
  });
  it("không bao giờ nhận stream có GPU hay hiệu năng đã đo", () => {
    const s = row(describeEnv(live), "stream");
    expect(s.kind).toBe("untested");
    expect(s.detail).toContain("Chưa đo");
    expect(row(describeEnv(live), "host").detail).toContain("chưa được kiểm chứng");
    expect(row(describeEnv({ ...live, native: false }), "host").label).toContain("app Windows đã cài");
  });
  it("preview: mọi thứ là dữ liệu mẫu", () => {
    const e = describeEnv({ mode: "preview", apiBase: null, wallet: null, native: false });
    expect(e.rows).toHaveLength(1);
    expect(e.rows[0]!.kind).toBe("simulated");
  });
});

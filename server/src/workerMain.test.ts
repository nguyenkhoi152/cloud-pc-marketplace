import { describe, expect, it } from "vitest";
import { noHostProvider, pickProvider } from "./workerMain";

const db = { tx: async () => { throw new Error("không được gọi khi chỉ chọn provider"); } } as never;

describe("chọn provider của worker", () => {
  it("mặc định là noHostProvider (fail-closed: bước cần host trả Unknown)", async () => {
    const p = pickProvider({}, db);
    expect(p).toBe(noHostProvider);
    expect(await p.prepare({ bookingId: "x" } as never)).toMatchObject({ ok: false, unknown: true });
  });
  it("WORKER_PROVIDER=agent dùng kênh lệnh của host-agent (đủ 5 hàm), không phải noHostProvider", () => {
    const p = pickProvider({ WORKER_PROVIDER: "agent" }, db);
    expect(p).not.toBe(noHostProvider);
    for (const k of ["prepare", "grant", "revoke", "reset", "verifyReset"] as const) expect(typeof p[k]).toBe("function");
  });
  it("giá trị sai hoặc khoảng thời gian ngoài giới hạn bị từ chối, không rơi về bản giả", () => {
    expect(() => pickProvider({ WORKER_PROVIDER: "fake" }, db)).toThrow(/WORKER_PROVIDER/);
    expect(() => pickProvider({ WORKER_PROVIDER: "agent", AGENT_COMMAND_TIMEOUT_MS: "5" }, db)).toThrow(/AGENT_COMMAND_TIMEOUT_MS/);
    expect(() => pickProvider({ WORKER_PROVIDER: "agent", AGENT_COMMAND_POLL_MS: "1" }, db)).toThrow(/AGENT_COMMAND_POLL_MS/);
    expect(() => pickProvider({ WORKER_PROVIDER: "agent", AGENT_COMMAND_TIMEOUT_MS: "abc" }, db)).toThrow();
  });
});

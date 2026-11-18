// guardPool: lỗi kết nối nhàn rỗi của pg.Pool không được làm chết tiến trình (worker/API chạy nhiều giờ trên Supabase qua Internet).
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { guardPool } from "./core";
import { runForever, type WorkerDeps } from "./worker";

const reset = () => Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", errno: -4077, syscall: "read" });

describe("guardPool", () => {
  it("ĐỐI CHỨNG: EventEmitter có sự kiện 'error' mà không ai nghe thì ném (đúng cơ chế đã làm worker chết)", () => {
    const bare = new EventEmitter();
    expect(() => bare.emit("error", reset())).toThrow(/ECONNRESET/);
  });

  it("có guardPool: sự kiện 'error' của pool không ném, được ghi lại với mã lỗi, và không lộ chuỗi kết nối", () => {
    const logs: string[] = [];
    const pool = guardPool(new EventEmitter() as unknown as pg.Pool, (m) => logs.push(m));
    expect(() => pool.emit("error", Object.assign(reset(), { message: "read ECONNRESET postgresql://u:pw@host/db" }))).not.toThrow();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("ECONNRESET");
    expect(logs[0]!.length).toBeLessThan(260);
    // Chuỗi kết nối nếu lọt vào thông điệp lỗi phải bị che (không có mật khẩu trong log).
    expect(logs[0]).not.toContain("pw");
    expect(logs[0]).not.toContain("postgresql://");
    expect(logs[0]).toContain("[chuỗi kết nối đã ẩn]");
  });

  it("với pg.Pool THẬT (không kết nối tới đâu): pool.emit('error') không làm sập tiến trình, pool vẫn dùng được để đóng", async () => {
    const logs: string[] = [];
    const pool = guardPool(new pg.Pool({ host: "127.0.0.1", port: 1, max: 1 }), (m) => logs.push(m));
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    expect(() => pool.emit("error", reset())).not.toThrow();
    expect(logs[0]).toContain("ECONNRESET");
    await pool.end();
  });

  it("tiến trình Node thật: pool có guardPool sống sót sau lỗi kết nối nhàn rỗi, pool trần thì thoát với mã 1", () => {
    const run = (guarded: boolean) =>
      spawnSync(process.execPath, ["-e", `
        const { EventEmitter } = require("node:events");
        const pool = new EventEmitter();
        ${guarded ? 'pool.on("error", () => {});' : ""}
        setTimeout(() => pool.emit("error", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), 20);
        setTimeout(() => { console.log("còn sống"); process.exit(0); }, 150);
      `], { encoding: "utf8" });
    const bare = run(false);
    const guarded = run(true);
    expect(bare.status).toBe(1);
    expect(guarded.status).toBe(0);
    expect(guarded.stdout).toContain("còn sống");
  });
});

describe("runForever (worker)", () => {
  it("không để lại listener 'abort' sau mỗi vòng chờ (chạy nhiều giờ không rò rỉ)", async () => {
    const ac = new AbortController();
    const deps = { db: { tx: async () => { throw new Error("không có DB trong test này"); } }, workerId: "t" } as unknown as WorkerDeps;
    const logs: string[] = [];
    const done = runForever(deps, { intervalMs: 5, signal: ac.signal, log: (m) => logs.push(m) });
    await new Promise((r) => setTimeout(r, 120)); // ~20 vòng; mỗi vòng lỗi vì không có DB nhưng worker không chết
    const listeners = EventEmitter.getEventListeners(ac.signal, "abort").length;
    ac.abort();
    await done;
    expect(logs.some((l) => l.includes("worker tick lỗi"))).toBe(true);
    expect(listeners).toBeLessThanOrEqual(1); // chỉ listener của vòng đang chờ; trước khi sửa là ~20
  });
});

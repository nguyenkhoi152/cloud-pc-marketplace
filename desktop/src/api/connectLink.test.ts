// Liên kết kết nối: danh sách tên miền, cầu nối tới lớp native, và hợp đồng tên lệnh/sự kiện với mã Rust.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectTarget, onConnectLink, takePendingConnect } from "./connectLink";

const g = globalThis as unknown as { __TAURI__?: unknown };
afterEach(() => {
  delete g.__TAURI__;
});

describe("connectTarget (danh sách cho phép giống ô dán mã)", () => {
  it("nhận https://<nhãn>.trycloudflare.com và thêm /api", () => {
    expect(connectTarget("https://able-seat-9-fox.trycloudflare.com")).toEqual({ ok: true, base: "https://able-seat-9-fox.trycloudflare.com/api" });
    expect(connectTarget("https://able-seat-9-fox.trycloudflare.com/api")).toEqual({ ok: true, base: "https://able-seat-9-fox.trycloudflare.com/api" });
    expect(connectTarget("http://127.0.0.1:3000")).toEqual({ ok: true, base: "http://127.0.0.1:3000/api" });
  });
  it("từ chối tên miền lạ, http ngoài loopback, userinfo, lookalike, rỗng: kèm lý do hiển thị được", () => {
    for (const bad of ["https://evil.example", "http://x.trycloudflare.com", "https://x.trycloudflare.com.evil.example", "https://eviltrycloudflare.com", "https://user:pw@x.trycloudflare.com", "http://10.0.0.5:3000", "javascript:alert(1)"]) {
      const t = connectTarget(bad);
      expect(t.ok, bad).toBe(false);
      if (!t.ok) expect(t.reason.length, bad).toBeGreaterThan(10);
    }
    for (const empty of ["", "   ", null, undefined]) expect(connectTarget(empty).ok).toBe(false);
  });
  it("tên miền bị chặn được nêu trong lý do (để người dùng biết mình đang bị yêu cầu gì)", () => {
    const t = connectTarget("https://evil.example");
    expect(!t.ok && t.reason).toContain("evil.example");
  });
});

describe("cầu nối native", () => {
  it("ngoài app Windows (không có __TAURI__): không có gì chờ, nghe sự kiện là no-op", async () => {
    expect(await takePendingConnect()).toBeNull();
    const off = onConnectLink(() => {});
    expect(() => off()).not.toThrow();
  });
  it("lấy địa chỉ đang chờ bằng lệnh connect_take_pending; giá trị lạ hoặc lỗi ⇒ null", async () => {
    const invoke = vi.fn(async (_c: string) => "https://a.trycloudflare.com");
    g.__TAURI__ = { core: { invoke } };
    expect(await takePendingConnect()).toBe("https://a.trycloudflare.com");
    expect(invoke).toHaveBeenCalledWith("connect_take_pending");
    g.__TAURI__ = { core: { invoke: async () => ({ x: 1 }) } };
    expect(await takePendingConnect()).toBeNull();
    g.__TAURI__ = { core: { invoke: async () => null } };
    expect(await takePendingConnect()).toBeNull();
    g.__TAURI__ = { core: { invoke: async () => { throw new Error("native lỗi"); } } };
    expect(await takePendingConnect()).toBeNull();
  });
  it("nghe sự kiện cpm-connect, huỷ nghe đúng cả khi huỷ trước lúc đăng ký xong", async () => {
    let cb: ((e: unknown) => void) | undefined;
    const unlisten = vi.fn();
    const listen = vi.fn(async (_n: string, f: (e: unknown) => void) => { cb = f; return unlisten; });
    g.__TAURI__ = { event: { listen } };
    const seen = vi.fn();
    const off = onConnectLink(seen);
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith("cpm-connect", expect.any(Function));
    cb!({ payload: "bất kỳ" });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
    // huỷ ngay khi vừa gọi (trước khi promise của listen xong): vẫn phải gọi unlisten, không để rò
    const unlisten2 = vi.fn();
    g.__TAURI__ = { event: { listen: async () => unlisten2 } };
    onConnectLink(() => {})();
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten2).toHaveBeenCalledTimes(1);
  });
});

describe("hợp đồng với mã Rust và cấu hình Tauri", () => {
  const rust = readFileSync(new URL("../../src-tauri/src/connect.rs", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  it("tên lệnh và sự kiện giữa giao diện và Rust trùng nhau, lệnh được đăng ký", () => {
    expect(rust).toContain('pub const EVENT: &str = "cpm-connect"');
    expect(rust).toContain("pub fn connect_take_pending");
    expect(lib).toContain("connect::connect_take_pending");
    expect(lib).toContain("tauri_plugin_single_instance::init");
    expect(lib).toContain("tauri_plugin_deep_link::init");
    expect(lib.indexOf("tauri_plugin_single_instance")).toBeLessThan(lib.indexOf("tauri_plugin_deep_link::init")); // single-instance phải đăng ký trước
  });
  it("scheme cloudpc được khai cho bộ cài và bản build cho phép đúng tên miền mà liên kết dùng", () => {
    const conf = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { plugins?: { "deep-link"?: { desktop?: { schemes?: string[] } } }; app: { security: { csp: string } } };
    expect(conf.plugins?.["deep-link"]?.desktop?.schemes).toEqual(["cloudpc"]);
    expect(conf.app.security.csp).toContain("https://*.trycloudflare.com");
  });
});

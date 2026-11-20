// Trang "Mở bằng app": địa chỉ lạ không bao giờ vào liên kết/HTML; scheme khớp cấu hình Tauri (nếu lệch, bấm liên kết sẽ không mở app).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONNECT_SCHEME, connectDeepLink, connectHost, connectPageResponse, renderConnectPage } from "./api/connectPage";

const HOST = "able-seat-9-fox.trycloudflare.com";

describe("connectHost", () => {
  it("chỉ nhận <nhãn>.trycloudflare.com, chuẩn hoá chữ thường", () => {
    expect(connectHost(HOST)).toBe(HOST);
    expect(connectHost(` ${HOST.toUpperCase()} `)).toBe(HOST);
    for (const bad of [null, undefined, "", "trycloudflare.com", ".trycloudflare.com", "evil.example", `${HOST}.evil.example`, `evil${HOST.replace(/^[a-z0-9-]+/, "")}x`, `${HOST}:443`, `${HOST}/x`, "-a.trycloudflare.com", "a_b.trycloudflare.com", "a b.trycloudflare.com", `"><script>alert(1)</script>.trycloudflare.com`, "https://able.trycloudflare.com"]) {
      expect(connectHost(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });
});

describe("liên kết và trang", () => {
  it("liên kết là cloudpc://connect?server=<https địa chỉ> đã mã hoá", () => {
    expect(connectDeepLink(HOST)).toBe(`cloudpc://connect?server=https%3A%2F%2F${HOST}`);
  });
  it("trang có nút mở app, địa chỉ để dán thủ công và dòng cảnh báo xác nhận trong app", () => {
    const html = renderConnectPage(HOST);
    expect(html).toContain(`href="cloudpc://connect?server=https%3A%2F%2F${HOST}"`);
    expect(html).toContain(`<code id="addr">https://${HOST}</code>`);
    expect(html).toContain("hỏi xác nhận một lần nữa");
    expect(html).toContain("<!doctype html>");
    expect(html).not.toMatch(/https?:\/\/(?!able-seat-9-fox\.trycloudflare\.com)[a-z0-9.-]+\//i); // không tài nguyên ngoài
  });
  it("địa chỉ lạ/độc hại ⇒ trang giải thích, KHÔNG có liên kết cloudpc:// và không phản chiếu giá trị đầu vào", () => {
    for (const bad of [null, "", "evil.example", `"><script>alert(1)</script>.trycloudflare.com`, "x.trycloudflare.com.evil.example"]) {
      const html = renderConnectPage(bad);
      expect(html, String(bad)).not.toContain("cloudpc://");
      expect(html, String(bad)).not.toContain("<script");
      if (bad) expect(html).not.toContain(bad);
    }
  });
  it("phản hồi HTTP: HTML, không lưu đệm, CSP chặt (không tải gì từ ngoài, không nhúng khung)", async () => {
    const r = connectPageResponse(HOST);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/https?:/);
    expect(await r.text()).toContain("cloudpc://connect");
    expect(await connectPageResponse(undefined).text()).not.toContain("cloudpc://");
  });
});

describe("khớp cấu hình Tauri", () => {
  it("scheme của liên kết nằm trong plugins.deep-link.desktop.schemes của tauri.conf.json (bộ cài đăng ký đúng scheme này)", () => {
    const conf = JSON.parse(readFileSync(new URL("../../desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { plugins?: { "deep-link"?: { desktop?: { schemes?: string[] } } } };
    expect(conf.plugins?.["deep-link"]?.desktop?.schemes).toContain(CONNECT_SCHEME);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NeedApp } from "@/features/web/WebScreens";
import { DEFAULT_DOWNLOAD_URL, DOWNLOAD_URL, WEB_OPEN_ROUTES, gateTitle, isOpenOnWeb, safeDownloadUrl } from "./webAccess";

describe("bản web: màn nào mở, màn nào bị chặn", () => {
  it("mở: danh sách máy, so sánh, chi tiết máy, giới thiệu, cài đặt, hỗ trợ, màn chào", () => {
    for (const p of ["/welcome", "/rent/discover", "/rent/compare", "/rent/machine/m-1", "/about", "/settings", "/support", "/rent/discover?cat=game"]) {
      expect(isOpenOnWeb(p), p).toBe(true);
    }
  });

  it("chặn: mọi thứ cần tài khoản hoặc chạy trong app, kể cả đăng nhập giả", () => {
    for (const p of [
      "/rent/checkout/m-1", "/rent/session", "/rent/workspaces", "/rent/history", "/rent/history/b-1",
      "/host", "/host/setup", "/host/configure", "/host/onboarding/intro", "/host/runtime",
      "/wallet", "/notifications", "/account", "/admin",
      "/login", "/register", "/recover", "/choose-mode",
    ]) {
      expect(isOpenOnWeb(p), p).toBe(false);
    }
  });

  it("danh sách mở nhỏ và không chứa luồng thuê/cho thuê/đăng nhập", () => {
    expect(WEB_OPEN_ROUTES.length).toBeLessThanOrEqual(8);
    for (const r of WEB_OPEN_ROUTES) expect(r).not.toMatch(/checkout|session|host|wallet|login|register/);
  });
});

describe("bản web: tên mục trên lời nhắc", () => {
  it("đặt tên đúng theo tiền tố (kể cả đường dẫn thuộc nhóm 'Khám phá máy' như checkout)", () => {
    expect(gateTitle("/rent/checkout/m-1")).toBe("Thuê máy");
    expect(gateTitle("/rent/history/b-1")).toBe("Lịch sử thuê");
    expect(gateTitle("/host/onboarding/intro")).toBe("Cho thuê máy");
    expect(gateTitle("/host")).toBe("Cho thuê máy");
    expect(gateTitle("/wallet?x=1")).toBe("Số dư & giao dịch");
    expect(gateTitle("/login")).toBe("Đăng nhập");
  });
  it("không biết thì dùng câu chung; không nhầm tiền tố (/hostile không phải /host)", () => {
    expect(gateTitle("/gi-do")).toBe("Mục này");
    expect(gateTitle("/hostile")).toBe("Mục này");
  });
});

describe("bản web: link tải app", () => {
  it("mặc định trỏ trang Releases của repo", () => {
    expect(DEFAULT_DOWNLOAD_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/cloud-pc-marketplace\/releases\/latest$/);
    expect(DOWNLOAD_URL).toBe(DEFAULT_DOWNLOAD_URL); // test chạy không có VITE_DOWNLOAD_URL
  });
  it("chỉ nhận https; giá trị lạ về mặc định (không dựng ra javascript:/data:/http:)", () => {
    expect(safeDownloadUrl("https://example.com/setup.exe")).toBe("https://example.com/setup.exe");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://example.com/a.exe", "ftp://x/y", "", "   ", "không phải url", undefined]) {
      expect(safeDownloadUrl(bad), String(bad)).toBe(DEFAULT_DOWNLOAD_URL);
    }
  });
});

describe("bản web: màn nhắc tải app", () => {
  it("hiện tên mục, nút tải mở tab mới an toàn, và lưu ý bộ cài chưa ký số", () => {
    const html = renderToStaticMarkup(<NeedApp path="/rent/checkout/m-1" />);
    expect(html).toContain('data-testid="need-app"');
    expect(html).toContain("Thuê máy");
    expect(html).toContain(`href="${DOWNLOAD_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("chưa ký số");
    expect(html).toContain("SHA256SUMS.txt");
  });
  it("không có nút giả vờ thực hiện thuê/cho thuê", () => {
    const html = renderToStaticMarkup(<NeedApp path="/host" />);
    expect(html).not.toMatch(/Thanh toán|Giữ máy|Bắt đầu cung cấp|Đăng nhập/);
  });
});

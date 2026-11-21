import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Thanh bên ở chế độ live: giả lập isLive() = true (ENV thật trong test luôn là preview).
vi.mock("@/api/env", async (orig) => ({ ...(await orig<typeof import("@/api/env")>()), isLive: () => true }));

import { Sidebar } from "./Chrome";

// HTML tĩnh viết "&" thành "&amp;": đổi lại để so sánh với nhãn thật.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

// Render phía server của zustand luôn lấy trạng thái ban đầu (chế độ Thuê máy), nên bài này chỉ bao phủ chế độ Thuê máy;
// chế độ Cho thuê máy được kiểm ở nav.test.ts (hostNav) vì cùng một logic chọn mục.
describe("Sidebar ở chế độ live", () => {
  it("chế độ Thuê máy: hiện Workspace (Sắp có), 'Phiên & đặt chỗ của tôi', Thông báo và Hỗ trợ (Sắp có)", () => {
    const html = renderToStaticMarkup(<Sidebar path="/rent/discover" />);
    const t = text(html);
    expect(t).toContain("Khám phá máy");
    expect(t).toMatch(/Workspace\s+Sắp có/);
    expect(t).toContain("Phiên & đặt chỗ của tôi");
    expect(t).not.toMatch(/Phiên & đặt chỗ của tôi\s+Sắp có/);
    expect(t).toMatch(/Thông báo\s+Sắp có/);
    expect(t).toMatch(/Hỗ trợ\s+Sắp có/);
    expect(t).not.toMatch(/Cài đặt\s+Sắp có/);
    expect(t).not.toMatch(/Giới thiệu\s+Sắp có/);
    expect(t).not.toMatch(/Ví\s+Sắp có/);
    expect((html.match(/data-testid="nav-soon"/g) ?? []).length).toBe(3);
  });

  it("mục 'Sắp có' vẫn là liên kết bấm được (dẫn tới trang đang hoàn thiện), không phải chữ chết", () => {
    const html = renderToStaticMarkup(<Sidebar path="/rent/discover" />);
    expect(html).toContain('href="#/rent/workspaces"');
    expect(html).toContain('href="#/notifications"');
    expect(html).toContain('href="#/support"');
  });
});

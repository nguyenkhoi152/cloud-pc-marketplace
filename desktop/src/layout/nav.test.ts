import { describe, expect, it } from "vitest";
import { COMMON_NAV, LIVE_NAV, hostNav, isComingSoon, rentNav } from "./nav";

const tos = (items: { to: string }[]) => items.map((i) => i.to);

describe("thanh bên: app (live) hiện đủ mục như bản web", () => {
  it("thuê máy: hiện Khám phá, Workspace, Lịch sử; bỏ 'Phiên hiện tại' (trùng với Phiên & đặt chỗ của tôi)", () => {
    expect(tos(rentNav({ live: true, hasSession: false }))).toEqual(["/rent/discover", "/rent/workspaces", "/rent/history"]);
    // có phiên hay không cũng vậy ở live: màn phiên nằm trong 'Phiên & đặt chỗ của tôi'
    expect(tos(rentNav({ live: true, hasSession: true }))).not.toContain("/rent/session");
  });

  it("cho thuê máy: đủ mục như web, cộng 'Thiết lập & chạy máy', bỏ bản mô phỏng 'Thiết lập cho thuê'", () => {
    const t = tos(hostNav({ live: true, approved: false }));
    expect(t).toEqual(["/host", "/host/setup", "/host/configure", "/host/sessions", "/host/earnings", "/host/incidents", "/host/runtime"]);
    expect(tos(hostNav({ live: true, approved: true }))).toEqual(t); // live không phụ thuộc trạng thái duyệt
  });

  it("mọi mục chung (ví, thông báo, hỗ trợ, cài đặt, giới thiệu) đều hiện", () => {
    expect(tos(COMMON_NAV)).toEqual(["/wallet", "/notifications", "/support", "/settings", "/about"]);
  });
});

describe("thanh bên: preview và web giữ nguyên như trước", () => {
  it("thuê máy: 'Phiên hiện tại' chỉ hiện khi đang có phiên", () => {
    expect(tos(rentNav({ live: false, hasSession: false }))).toEqual(["/rent/discover", "/rent/workspaces", "/rent/history"]);
    expect(tos(rentNav({ live: false, hasSession: true }))).toEqual(["/rent/discover", "/rent/session", "/rent/workspaces", "/rent/history"]);
  });

  it("cho thuê máy: không có mục chỉ-live; 'Thiết lập cho thuê' chỉ hiện khi chưa được duyệt", () => {
    const pending = tos(hostNav({ live: false, approved: false }));
    expect(pending).not.toContain("/host/setup");
    expect(pending).toContain("/host/onboarding/intro");
    const approved = tos(hostNav({ live: false, approved: true }));
    expect(approved).not.toContain("/host/onboarding/intro");
    expect(approved).toEqual(["/host", "/host/configure", "/host/sessions", "/host/earnings", "/host/incidents", "/host/runtime"]);
  });
});

describe("nhãn 'Sắp có'", () => {
  it("chỉ ở live, chỉ cho mục chưa nối chức năng thật", () => {
    for (const to of ["/rent/workspaces", "/host/incidents", "/host/runtime", "/notifications", "/support"]) {
      expect(isComingSoon(to, true), to).toBe(true);
      expect(isComingSoon(to, false), `${to} ngoài live`).toBe(false);
    }
    for (const to of LIVE_NAV) expect(isComingSoon(to, true), to).toBe(false);
  });

  it("mọi mục đang hiện ở live hoặc đã nối thật hoặc có nhãn 'Sắp có' (không có mục nào im lặng)", () => {
    const shown = [...rentNav({ live: true, hasSession: false }), ...hostNav({ live: true, approved: false }), ...COMMON_NAV];
    const soon = shown.filter((i) => isComingSoon(i.to, true)).map((i) => i.to);
    const wired = shown.filter((i) => !isComingSoon(i.to, true)).map((i) => i.to);
    expect(soon.sort()).toEqual(["/host/incidents", "/host/runtime", "/notifications", "/rent/workspaces", "/support"]);
    expect(wired.sort()).toEqual(["/about", "/host", "/host/configure", "/host/earnings", "/host/sessions", "/host/setup", "/rent/discover", "/rent/history", "/settings", "/wallet"]);
  });
});

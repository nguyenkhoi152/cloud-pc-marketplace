// @vitest-environment node
/**
 * Render lần đầu các màn mới (không có lớp native, không có máy chủ): bắt lỗi import/render và kiểm các câu KHÔNG được sai.
 * Không thay thế kiểm tra trong app đã cài (scripts/vm/host-flow-e2e.mjs).
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hostNativeAvailable, viewerOrigins } from "@/api/hostNative";
import { envFacts } from "@/api/envFacts";
import { About } from "./About";
import { HostSetup } from "./HostSetup";

describe("màn hình host khi KHÔNG ở trong app Windows đã cài", () => {
  it("không có lớp native ⇒ nói rõ, không hiện danh sách bước hay kết quả giả", () => {
    expect(hostNativeAvailable()).toBe(false);
    const h = renderToString(<HostSetup />);
    expect(h).toContain("Chỉ có trong app Windows đã cài");
    expect(h).not.toContain("Bắt đầu nhận thuê");
    expect(h).not.toContain("data-testid=\"host-steps\"");
  });
});

describe("Bản thử này gồm gì (chế độ xem trước trong test)", () => {
  it("nêu rõ không có tiền thật; ở bản xem trước mọi thứ là dữ liệu mẫu", () => {
    expect(envFacts()).toEqual({ mode: "preview", apiBase: null, wallet: null, native: false });
    const h = renderToString(<About />);
    expect(h).toContain("Không có tiền thật");
    expect(h).toContain("data-kind=\"simulated\"");
  });
});

describe("viewerOrigins", () => {
  it("luôn có origin của app Tauri; origin dev chỉ thêm ở demo cục bộ; origin lạ/sai dạng bị bỏ", () => {
    expect(viewerOrigins("http://tauri.localhost", false)).toEqual(["http://tauri.localhost"]);
    expect(viewerOrigins("http://tauri.localhost", true)).toEqual(["http://tauri.localhost", "http://127.0.0.1:5174", "http://localhost:5174"]);
    expect(viewerOrigins("https://app.example.com", false)).toEqual(["http://tauri.localhost", "https://app.example.com"]);
    expect(viewerOrigins("http://x/duong-dan *", false)).toEqual(["http://tauri.localhost"]);
  });
});

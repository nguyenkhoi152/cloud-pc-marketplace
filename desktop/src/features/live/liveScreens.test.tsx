// @vitest-environment node
/**
 * Render lần đầu các màn mới (không có lớp native, không có máy chủ): bắt lỗi import/render và kiểm các câu KHÔNG được sai.
 * Không thay thế kiểm tra trong app đã cài (scripts/vm/host-flow-e2e.mjs).
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hostNativeAvailable, viewerOrigins } from "@/api/hostNative";
import { envFacts } from "@/api/envFacts";
import { networkLabel } from "@/domain/envLabels";
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

describe("Giới thiệu (chế độ xem trước trong test)", () => {
  it("ở bản xem trước nói rõ mọi thứ là dữ liệu mẫu và không nêu tên mạng nào", () => {
    expect(envFacts()).toEqual({ mode: "preview", apiBase: null, wallet: null, native: false });
    const h = renderToString(<About />);
    expect(h).toContain("Dữ liệu mẫu");
    expect(h).not.toContain("Avalanche Fuji");
  });
});

describe("nhãn mạng suy từ cấu hình thật (không ghi cứng)", () => {
  const live = { mode: "live" as const, apiBase: "https://x.trycloudflare.com/api", native: true };
  it("ví thử trên chuỗi công khai ⇒ Avalanche Fuji; ví cục bộ ⇒ KHÔNG gọi là Fuji; chưa có ví ⇒ chỉ nói testnet, không gọi tên mạng; bản xem trước ⇒ không nêu", () => {
    expect(networkLabel({ ...live, wallet: { kind: "testnet", rpc: "https://api.avax-test.network/ext/bc/C/rpc" } })).toMatchObject({ chip: "Testnet", footer: expect.stringContaining("Avalanche Fuji") });
    const local = networkLabel({ ...live, wallet: { kind: "dev", rpc: "http://127.0.0.1:8545" } })!;
    expect(local.footer).not.toContain("Fuji");
    expect(local.note).toContain("không có giá trị quy đổi");
    const noWallet = networkLabel({ ...live, wallet: null })!;
    expect(noWallet.chip).toBe("Testnet");
    expect(noWallet.footer).not.toMatch(/Fuji|Hardhat|cục bộ/);
    expect(noWallet.note).toContain("không có giá trị quy đổi");
    expect(networkLabel({ mode: "preview", apiBase: null, wallet: null, native: false })).toBeNull();
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

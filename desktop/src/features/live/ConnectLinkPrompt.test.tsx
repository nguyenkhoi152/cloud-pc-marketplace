// @vitest-environment jsdom
// Hộp xác nhận liên kết kết nối: LUÔN hỏi trước; chỉ lưu sau khi bấm "Kết nối" và máy chủ mới trả lời đúng; tên miền lạ không bao giờ được lưu.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CURRENT = "https://old-one.trycloudflare.com/api";
const setApiOverride = vi.fn(async (_v: string | null) => true);
const fetchChainInfo = vi.fn(async (_b: string): Promise<{ chainId: number; faucet: boolean } | null> => ({ chainId: 43113, faucet: true }));
vi.mock("@/api", () => ({ apiBase: () => CURRENT, setApiOverride: (v: string | null) => setApiOverride(v) }));
vi.mock("@/api/server", () => ({ fetchChainInfo: (b: string) => fetchChainInfo(b) }));

import { ConnectLinkPrompt } from "./ConnectLinkPrompt";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const g = globalThis as unknown as { __TAURI__?: unknown };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const reload = vi.fn();
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = () => document.body.textContent ?? "";
const button = (label: string) => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

async function mount(pending: string | null) {
  g.__TAURI__ = { core: { invoke: async () => pending }, event: { listen: async () => () => {} } };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<ConnectLinkPrompt reload={reload} />));
  await flush();
}

beforeEach(() => {
  setApiOverride.mockClear();
  fetchChainInfo.mockClear();
  fetchChainInfo.mockImplementation(async () => ({ chainId: 43113, faucet: true }));
  reload.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.innerHTML = "";
  delete g.__TAURI__;
});

describe("ConnectLinkPrompt", () => {
  it("không có liên kết đang chờ ⇒ không hiện gì", async () => {
    await mount(null);
    expect(text()).toBe("");
  });

  it("có liên kết hợp lệ ⇒ HỎI trước, nêu tên máy chủ, chưa lưu gì", async () => {
    await mount("https://new-one.trycloudflare.com");
    expect(text()).toContain("Kết nối máy chủ mới?");
    expect(document.querySelector('[data-testid="connect-host"]')?.textContent).toBe("new-one.trycloudflare.com");
    expect(text()).toContain("Chỉ đồng ý nếu liên kết đến từ người bạn tin");
    expect(fetchChainInfo).not.toHaveBeenCalled();
    expect(setApiOverride).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("bấm Không ⇒ đóng, không lưu, không tải lại", async () => {
    await mount("https://new-one.trycloudflare.com");
    act(() => button("Không")!.click());
    await flush();
    expect(text()).not.toContain("Kết nối máy chủ mới?");
    expect(setApiOverride).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("bấm Kết nối ⇒ kiểm /chain-info của máy chủ mới, lưu, rồi tải lại app", async () => {
    await mount("https://new-one.trycloudflare.com");
    act(() => button("Kết nối")!.click());
    await flush();
    expect(fetchChainInfo).toHaveBeenCalledWith("https://new-one.trycloudflare.com/api");
    expect(setApiOverride).toHaveBeenCalledWith("https://new-one.trycloudflare.com/api");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("máy chủ mới không trả lời ⇒ báo lỗi rõ, KHÔNG lưu, KHÔNG tải lại", async () => {
    fetchChainInfo.mockImplementation(async () => null);
    await mount("https://new-one.trycloudflare.com");
    act(() => button("Kết nối")!.click());
    await flush();
    expect(document.querySelector('[data-testid="connect-problem"]')?.textContent).toContain("new-one.trycloudflare.com");
    expect(setApiOverride).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("tên miền ngoài danh sách cho phép ⇒ chỉ báo bị chặn (không có nút Kết nối), không bao giờ lưu", async () => {
    await mount("https://evil.example");
    expect(document.querySelector('[data-testid="connect-rejected"]')?.textContent).toContain("evil.example");
    expect(button("Kết nối")).toBeUndefined();
    expect(fetchChainInfo).not.toHaveBeenCalled();
    expect(setApiOverride).not.toHaveBeenCalled();
  });

  it("liên kết trỏ đúng máy chủ đang dùng ⇒ không làm phiền người dùng", async () => {
    await mount("https://old-one.trycloudflare.com");
    expect(text()).toBe("");
    expect(setApiOverride).not.toHaveBeenCalled();
  });
});

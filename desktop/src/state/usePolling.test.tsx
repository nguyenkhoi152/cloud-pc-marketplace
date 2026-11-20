// @vitest-environment jsdom
/** Nhịp làm mới nền: tăng đều theo chu kỳ, dừng khi tắt hoặc khi cửa sổ bị ẩn, làm mới ngay khi hiện lại, dọn sạch khi gỡ. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const seen: number[] = [];

function Probe({ ms, enabled }: { ms: number; enabled?: boolean }) {
  seen.push(usePolling(ms, enabled));
  return null;
}
const mount = (ms: number, enabled?: boolean) => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Probe ms={ms} enabled={enabled} />));
};
const last = () => seen[seen.length - 1];
const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
};

beforeEach(() => { vi.useFakeTimers(); seen.length = 0; setVisibility("visible"); });
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null;
  vi.useRealTimers();
});

describe("usePolling", () => {
  it("tăng một nấc mỗi chu kỳ", () => {
    mount(10_000);
    expect(last()).toBe(0);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(last()).toBe(1);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(last()).toBe(3);
  });
  it("enabled=false ⇒ không có đồng hồ nào chạy (chế độ demo)", () => {
    mount(10_000, false);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(last()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cửa sổ bị ẩn ⇒ không làm mới; hiện lại ⇒ làm mới ngay", () => {
    mount(10_000);
    setVisibility("hidden");
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(last()).toBe(0);
    setVisibility("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(last()).toBe(1);
  });
  it("gỡ thành phần ⇒ dừng đồng hồ và bỏ lắng nghe", () => {
    mount(10_000);
    act(() => root!.unmount());
    root = createRoot(host!); // để afterEach gỡ được
    expect(vi.getTimerCount()).toBe(0);
    const before = seen.length;
    act(() => { vi.advanceTimersByTime(60_000); document.dispatchEvent(new Event("visibilitychange")); });
    expect(seen.length).toBe(before);
  });
});

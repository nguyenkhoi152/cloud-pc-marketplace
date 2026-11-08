// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Segmented } from "./controls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

function Demo() {
  const [v, setV] = useState<"a" | "b" | "c">("b");
  return (
    <>
      <Segmented label="Chế độ" value={v} onChange={setV} items={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]} />
      <output data-testid="v">{v}</output>
    </>
  );
}

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Demo />));
  return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
}
const press = (el: Element, key: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));

describe("RadioGroup bàn phím (roving tabindex + mũi tên)", () => {
  it("chỉ nút đang chọn nằm trong thứ tự Tab", () => {
    const r = mount();
    expect(r.map((x) => x.tabIndex)).toEqual([-1, 0, -1]);
    expect(r.map((x) => x.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });
  it("ArrowRight/ArrowLeft di chuyển focus và đổi lựa chọn, lặp vòng", () => {
    const r = mount();
    r[1]!.focus();
    press(r[1]!, "ArrowRight");
    expect(document.activeElement).toBe(r[2]);
    expect(r[2]!.getAttribute("aria-checked")).toBe("true");
    press(r[2]!, "ArrowRight");
    expect(document.activeElement).toBe(r[0]);
    expect(r[0]!.getAttribute("aria-checked")).toBe("true");
    press(r[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(r[2]);
  });
  it("Home/End về đầu/cuối", () => {
    const r = mount();
    r[1]!.focus();
    press(r[1]!, "End");
    expect(document.activeElement).toBe(r[2]);
    press(r[2]!, "Home");
    expect(document.activeElement).toBe(r[0]);
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import { useAppStore } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom không cài Element.scrollTo
Element.prototype.scrollTo = () => {};

let root: Root;
let host: HTMLDivElement;
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const press = (el: Element, key: string) => act(async () => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 30));
});
const modeRadios = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Chế độ sử dụng"] [role="radio"]'));

beforeEach(async () => {
  useAppStore.setState({ authed: true });
  window.location.hash = "#/rent/discover";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<AppShell><p>nội dung</p></AppShell>));
  await tick();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("focus khi đổi chế độ bằng bàn phím", () => {
  it("ArrowRight rồi ArrowLeft liên tiếp: lựa chọn, route và focus đều đúng, không cần refocus", async () => {
    const [rent, hostBtn] = modeRadios() as [HTMLButtonElement, HTMLButtonElement];
    rent.focus();
    expect(rent.getAttribute("aria-checked")).toBe("true");

    await press(rent, "ArrowRight");
    expect(window.location.hash).toBe("#/host");
    expect(useAppStore.getState().account.mode).toBe("host");
    expect(useAppStore.getState().account.hostApproval).toBe("none"); // đổi chế độ không cấp quyền host
    const after1 = modeRadios();
    expect(after1[1]!.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(after1[1]);
    expect(document.activeElement).toBe(hostBtn);

    await press(document.activeElement!, "ArrowLeft");
    expect(window.location.hash).toBe("#/rent/discover");
    expect(useAppStore.getState().account.mode).toBe("rent");
    const after2 = modeRadios();
    expect(after2[0]!.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(after2[0]);
  });

  it("điều hướng khác vẫn đưa focus về vùng nội dung (main)", async () => {
    const link = Array.from(document.querySelectorAll<HTMLAnchorElement>("nav a")).find((a) => a.textContent?.includes("Lịch sử thuê"))!;
    link.focus();
    await act(async () => {
      link.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(window.location.hash).toBe("#/rent/history");
    expect(document.activeElement?.id).toBe("main");
  });

  it("skip link đưa focus tới main", async () => {
    const skip = document.querySelector<HTMLAnchorElement>('a[href="#main"]')!;
    skip.focus();
    await act(async () => void skip.click());
    expect(document.activeElement?.id).toBe("main");
  });
});

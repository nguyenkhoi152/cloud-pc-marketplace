// @vitest-environment jsdom
/**
 * useAsync: mặc định một lần tải lại lỗi đưa màn từ ready sang error (các màn khác và kịch bản mô phỏng lỗi dựa vào đó).
 * Với keepDataOnError (làm mới nền của danh sách máy): lần tải lại lỗi giữ dữ liệu cũ, lần tải ĐẦU lỗi vẫn là error.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useAsync, type AsyncOptions, type AsyncState } from "./useAsync";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: AsyncState<string> | null = null;
let setTick: (n: number) => void = () => undefined;

function View({ load, opts }: { load: (n: number) => Promise<string>; opts?: AsyncOptions }) {
  const [tick, set] = useState(0);
  setTick = set;
  latest = useAsync(() => load(tick), [tick], opts);
  return null;
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const mount = async (load: (n: number) => Promise<string>, opts?: AsyncOptions) => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<View load={load} opts={opts} />));
  await flush();
};
const reload = async (n: number) => { await act(async () => setTick(n)); await flush(); };

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null; latest = null;
});

const flaky = (failOn: number[]) => async (n: number) => {
  if (failOn.includes(n)) throw new Error(`lỗi ở lần ${n}`);
  return `dữ liệu ${n}`;
};

describe("useAsync", () => {
  it("mặc định: tải lại lỗi ⇒ từ ready sang error (hành vi cũ không đổi)", async () => {
    await mount(flaky([1]));
    expect(latest).toMatchObject({ status: "ready", data: "dữ liệu 0" });
    await reload(1);
    expect(latest?.status).toBe("error");
  });
  it("keepDataOnError: tải lại nền lỗi ⇒ vẫn hiện dữ liệu cũ; lần sau thành công ⇒ cập nhật", async () => {
    await mount(flaky([1]), { keepDataOnError: true });
    expect(latest).toMatchObject({ status: "ready", data: "dữ liệu 0" });
    await reload(1); // chập chờn mạng
    expect(latest).toMatchObject({ status: "ready", data: "dữ liệu 0" });
    await reload(2);
    expect(latest).toMatchObject({ status: "ready", data: "dữ liệu 2" });
  });
  it("keepDataOnError: lần tải ĐẦU lỗi vẫn báo lỗi (chưa có gì để giữ)", async () => {
    await mount(flaky([0]), { keepDataOnError: true });
    expect(latest?.status).toBe("error");
    await reload(1); // thử lại thành công thì hiện bình thường
    expect(latest).toMatchObject({ status: "ready", data: "dữ liệu 1" });
  });
});

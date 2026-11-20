import { useCallback, useEffect, useRef, useState } from "react";
import { ServiceError } from "../mock/scenarios";
import { useAppStore } from "./store";

export type AsyncState<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "error"; data?: undefined; error: ServiceError | Error }
  | { status: "ready"; data: T; error?: undefined };

export interface AsyncOptions {
  /**
   * Tải lại THẤT BẠI khi đang có dữ liệu thì giữ dữ liệu cũ thay vì chuyển sang màn lỗi. Dành cho làm mới nền theo chu kỳ
   * (một lần mạng chập chờn không được làm trống danh sách); lần tải ĐẦU tiên lỗi vẫn báo lỗi. Mặc định tắt: các màn khác
   * (và kịch bản mô phỏng lỗi) vẫn đi từ ready sang error như trước.
   */
  keepDataOnError?: boolean;
}

/** Đọc dữ liệu từ lớp dịch vụ mock; tự tải lại khi đổi kịch bản hoặc dữ liệu thay đổi. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: AsyncOptions = {}): AsyncState<T> & { retry: () => void } {
  const scenario = useAppStore((s) => s.scenario);
  const version = useAppStore((s) => s.dataVersion);
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keepRef = useRef(opts.keepDataOnError ?? false);
  keepRef.current = opts.keepDataOnError ?? false;

  useEffect(() => {
    let alive = true;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    fnRef.current().then(
      (data) => alive && setState({ status: "ready", data }),
      (error: Error) => alive && setState((s) => (keepRef.current && s.status === "ready" ? s : { status: "error", error })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, version, nonce, ...deps]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);
  return { ...state, retry } as AsyncState<T> & { retry: () => void };
}

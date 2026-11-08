import { useCallback, useEffect, useRef, useState } from "react";
import { ServiceError } from "../mock/scenarios";
import { useAppStore } from "./store";

export type AsyncState<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "error"; data?: undefined; error: ServiceError | Error }
  | { status: "ready"; data: T; error?: undefined };

/** Đọc dữ liệu từ lớp dịch vụ mock; tự tải lại khi đổi kịch bản hoặc dữ liệu thay đổi. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> & { retry: () => void } {
  const scenario = useAppStore((s) => s.scenario);
  const version = useAppStore((s) => s.dataVersion);
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    fnRef.current().then(
      (data) => alive && setState({ status: "ready", data }),
      (error: Error) => alive && setState({ status: "error", error }),
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

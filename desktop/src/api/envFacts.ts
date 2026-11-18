/** Sự thật về cấu hình của bản build đang chạy (để nhãn "thật / giả lập / chưa kết nối" không lệch với thực tế). */
import type { EnvFacts } from "../domain/envLabels";
import { apiBase, getDevWallet } from "./index";
import { ENV } from "./env";
import { hostNativeAvailable } from "./hostNative";

export function envFacts(): EnvFacts {
  const live = ENV.mode === "live";
  const w = live ? getDevWallet() : null;
  return { mode: live ? "live" : "preview", apiBase: live ? apiBase() : null, wallet: w ? { kind: w.kind, rpc: w.rpcUrl } : null, native: hostNativeAvailable() };
}

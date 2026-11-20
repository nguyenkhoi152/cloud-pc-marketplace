import { useEffect, useState } from "react";

/**
 * Trả về một số tăng dần mỗi `ms` mili giây; đưa nó vào `deps` của `useAsync` để làm mới dữ liệu NỀN (useAsync giữ dữ liệu cũ
 * trong lúc tải lại nên danh sách không nháy và không chạy lại hiệu ứng). Tạm dừng khi cửa sổ bị ẩn và làm mới ngay khi hiện lại.
 * `enabled=false` ⇒ không đặt đồng hồ nào (chế độ demo không cần).
 */
export function usePolling(ms: number, enabled = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setTick((n) => n + 1);
    const id = setInterval(() => { if (document.visibilityState !== "hidden") bump(); }, ms);
    const onVisible = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [ms, enabled]);
  return tick;
}

import { useState } from "react";
import { readBackgroundPref, setBackgroundPref } from "@/api/background";
import { hostNativeAvailable } from "@/api/hostNative";
import { Switch } from "@/ui/controls";
import { Banner } from "@/ui/feedback";

/** Cài đặt → Cho thuê máy → Chạy nền khi đóng cửa sổ (chế độ live). Chỉ bật được trong app Windows đã cài. */
export function HostBackgroundRow() {
  const native = hostNativeAvailable();
  const [on, setOn] = useState(() => (native ? readBackgroundPref(typeof localStorage === "undefined" ? null : localStorage) : false));
  const [err, setErr] = useState("");
  const change = async (v: boolean) => {
    setErr("");
    const ok = await setBackgroundPref(typeof localStorage === "undefined" ? null : localStorage, v);
    if (ok) setOn(v);
    else setErr("Lớp native của app không nhận được lựa chọn này (bản cài cũ?).");
  };
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-6">
        <div>
          <label htmlFor="bg-live" className="font-semibold">Chạy nền khi đóng cửa sổ</label>
          <p className="text-sm text-ink-soft">
            {native
              ? "Khi đang nhận thuê, đóng cửa sổ chỉ thu app về khay hệ thống và máy vẫn nhận thuê. Thoát hẳn: chuột phải biểu tượng ở khay → “Dừng nhận thuê và thoát”. Tắt tuỳ chọn này thì đóng cửa sổ là dừng nhận thuê."
              : "Chỉ dùng được trong app Windows đã cài."}
          </p>
        </div>
        <Switch id="bg-live" label="Chạy nền khi đóng cửa sổ" checked={on} onCheckedChange={(v) => void change(v)} disabled={!native} />
      </div>
      {on && <Banner tone="info" className="mt-2" title="Lưu ý">Chưa có tự khởi động cùng Windows: sau khi khởi động lại máy, bạn phải mở app và bấm Bắt đầu nhận thuê. Tính năng khay chưa được kiểm trên máy thật.</Banner>}
      {err && <Banner tone="danger" className="mt-2" title="Chưa đổi được">{err}</Banner>}
    </div>
  );
}

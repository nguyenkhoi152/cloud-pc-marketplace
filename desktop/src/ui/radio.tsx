import type { KeyboardEvent, ReactNode } from "react";

/**
 * Nhóm radio tự dựng đúng mẫu WAI-ARIA: roving tabindex (mỗi nút radio tự đặt tabIndex={checked ? 0 : -1}),
 * mũi tên Trái/Phải/Lên/Xuống di chuyển + chọn (lặp vòng), Home/End về đầu/cuối, bỏ qua nút bị khóa.
 * `keepFocus`: nếu chọn làm đổi route, AppShell không chuyển focus về main (xem AppShell).
 */
export function RadioGroup({ label, className, children, keepFocus }: { label: string; className?: string; children: ReactNode; keepFocus?: boolean }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
    if (radios.length === 0) return;
    const cur = radios.findIndex((r) => r === document.activeElement);
    let next = cur < 0 ? 0 : cur;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (cur + 1) % radios.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (cur - 1 + radios.length) % radios.length;
    else if (e.key === "Home") next = 0;
    else next = radios.length - 1;
    e.preventDefault();
    const target = radios[next]!;
    target.focus();
    target.click();
  };
  return (
    <div role="radiogroup" aria-label={label} className={className} onKeyDown={onKeyDown} data-keep-focus={keepFocus ? "" : undefined}>
      {children}
    </div>
  );
}

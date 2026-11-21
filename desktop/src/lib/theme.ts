import { useSyncExternalStore } from "react";

/**
 * Theme giao diện: TỐI (mặc định) hoặc SÁNG. Lựa chọn được nhớ trong localStorage của WebView/trình duyệt.
 * Giá trị màu nằm ở src/styles/index.css: theme tối là giá trị mặc định, theme sáng ghi đè qua html[data-theme="light"].
 */
export type Theme = "dark" | "light";

export const THEME_KEY = "cpm.theme";
export const DEFAULT_THEME: Theme = "dark";

/** Chỉ "light" mới ra theme sáng; thiếu, rỗng hay giá trị lạ đều về mặc định (tối). */
export const parseTheme = (v: unknown): Theme => (v === "light" ? "light" : DEFAULT_THEME);

export function loadTheme(storage: Pick<Storage, "getItem"> | null): Theme {
  try {
    return parseTheme(storage?.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME; // trình duyệt chặn storage: dùng mặc định, không báo lỗi
  }
}

export function saveTheme(storage: Pick<Storage, "setItem"> | null, theme: Theme): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    /* không lưu được: lựa chọn chỉ áp dụng cho phiên này */
  }
}

/** Gắn theme lên <html>. CSS đọc thuộc tính này; color-scheme (ô nhập, thanh cuộn gốc) đi theo trong CSS. */
export function applyTheme(theme: Theme, root: { dataset: DOMStringMap } | undefined = typeof document === "undefined" ? undefined : document.documentElement): void {
  if (root) root.dataset.theme = theme;
}

const store = () => (typeof localStorage === "undefined" ? null : localStorage);
const listeners = new Set<() => void>();
let current: Theme | null = null;

export const getTheme = (): Theme => (current ??= loadTheme(store()));

export function setTheme(theme: Theme): void {
  current = theme;
  saveTheme(store(), theme);
  applyTheme(theme);
  listeners.forEach((l) => l());
}

export const toggleTheme = (): void => setTheme(getTheme() === "dark" ? "light" : "dark");

/** Gọi một lần trước khi render để áp theme đã lưu lên <html>. */
export const initTheme = (): void => applyTheme(getTheme());

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => DEFAULT_THEME);
}

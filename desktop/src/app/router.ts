import { createElement, useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode } from "react";

/** Router hash tối giản (hoạt động trong trình duyệt và WebView khi đóng gói Tauri). */
const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const snapshot = () => window.location.hash.replace(/^#/, "") || "/welcome";

export function usePath(): string {
  return useSyncExternalStore(subscribe, snapshot, () => "/welcome");
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (snapshot() === path) return;
  if (opts.replace) window.location.replace(`#${path}`);
  else window.location.hash = path;
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("?")[0]!.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i]!;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(b[i]!);
    else if (seg !== b[i]) return null;
  }
  return params;
}

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return createElement("a", { ...rest, href: `#${to}` }, children);
}

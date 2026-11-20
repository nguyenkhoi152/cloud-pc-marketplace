import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { usePath } from "@/app/router";
import { DemoBanner, Sidebar, ToastRegion, TopBar } from "./Chrome";
import { HostWindowOverlay } from "./HostWindowOverlay";

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePath();
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
    // Điều hướng do bàn phím trên điều khiển đánh dấu data-keep-focus (bộ chuyển chế độ): giữ focus tại đó
    // để người dùng đổi tiếp bằng mũi tên. Các điều hướng khác vẫn đưa focus về vùng nội dung.
    if (document.activeElement?.closest("[data-keep-focus]")) return;
    main.current?.focus({ preventScroll: true });
  }, [path]);

  return (
    <div className="flex h-full flex-col">
      <a href="#main" onClick={(e) => { e.preventDefault(); main.current?.focus(); }} className="sr-only z-[70] rounded-md bg-navy px-3 py-2 text-white focus:not-sr-only focus:absolute focus:left-2 focus:top-2">
        Bỏ qua điều hướng
      </a>
      <DemoBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar path={path} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main id="main" ref={main} tabIndex={-1} className="relative min-h-0 flex-1 overflow-y-auto outline-none">
            {/* Nền trang trí ở đầu trang (phẳng, ẩn khỏi trình đọc màn hình, không nhận chuột). Bọc overflow-hidden để không sinh thanh cuộn ngang. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden" aria-hidden data-testid="shell-backdrop">
              <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-sky/50" />
              <div className="absolute right-44 top-6 h-14 w-14 rounded-full border-[7px] border-sky/70" />
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={path.split("?")[0]} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="relative mx-auto w-full max-w-[1160px] px-6 py-6">
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
      <HostWindowOverlay />
      <ToastRegion />
    </div>
  );
}

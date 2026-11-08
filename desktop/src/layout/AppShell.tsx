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
          <main id="main" ref={main} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={path.split("?")[0]} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="mx-auto w-full max-w-[1160px] px-6 py-6">
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

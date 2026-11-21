import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePath } from "@/app/router";
import { DemoBanner, Sidebar, ToastRegion, TopBar } from "./Chrome";
import { HostWindowOverlay } from "./HostWindowOverlay";

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePath();
  const main = useRef<HTMLElement>(null);
  // Màn hẹp (dưới 1024px: điện thoại, máy tính bảng, bản web): thanh bên thành ngăn kéo mở bằng nút menu ở thanh trên.
  // Cửa sổ app desktop có độ rộng tối thiểu 1024px nên không bao giờ rơi vào nhánh này.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [path]);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return; // môi trường không có matchMedia (vd. DOM giả khi test)
    const mq = window.matchMedia("(min-width: 1024px)");
    const close = () => mq.matches && setNavOpen(false);
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, []);
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
        <div className="hidden lg:flex"><Sidebar path={path} /></div>
        <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim animate-fade-in lg:hidden" />
            <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 flex animate-fade-in outline-none lg:hidden">
              <Dialog.Title className="sr-only">Điều hướng chính</Dialog.Title>
              <Sidebar path={path} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenu={() => setNavOpen(true)} />
          <main id="main" ref={main} tabIndex={-1} className="relative min-h-0 flex-1 overflow-y-auto outline-none">
            {/* Nền trang trí ở đầu trang (phẳng, ẩn khỏi trình đọc màn hình, không nhận chuột). Bọc overflow-hidden để không sinh thanh cuộn ngang. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden" aria-hidden data-testid="shell-backdrop">
              <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-sky/50" />
              <div className="absolute right-44 top-6 h-14 w-14 rounded-full border-[7px] border-sky/70" />
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={path.split("?")[0]} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="relative mx-auto w-full max-w-[1160px] px-4 py-5 sm:px-6 sm:py-6">
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

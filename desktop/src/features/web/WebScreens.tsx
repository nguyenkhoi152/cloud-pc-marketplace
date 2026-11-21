import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { navigate } from "@/app/router";
import { DOWNLOAD_URL, gateTitle } from "@/app/webAccess";
import { cn } from "@/lib/utils";
import { Button, buttonStyles } from "@/ui/button";
import { PageHeader } from "@/ui/page";

/** Nút tải app: là liên kết thật (mở tab mới) nhưng trông như nút. Chỉ dùng ở bản web. */
export function DownloadButton({ size = "md", variant = "primary", className, children = "Tải app cho Windows" }: { size?: "sm" | "md" | "lg"; variant?: "primary" | "secondary"; className?: string; children?: ReactNode }) {
  return (
    <a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" data-testid="download-link" className={cn(buttonStyles({ variant, size }), className)}>
      <Download className="h-4 w-4" aria-hidden />
      {children}
    </a>
  );
}

/**
 * Thay cho mọi màn cần tài khoản hoặc cần chạy trong app (thuê, cho thuê, ví, phiên, lịch sử…) trên bản web.
 * Nằm trong khung app nên giao diện giữ nguyên; không có nút nào giả vờ thực hiện việc đó.
 */
export function NeedApp({ path }: { path: string }) {
  const title = gateTitle(path);
  return (
    <div data-testid="need-app">
      <PageHeader title={title} subtitle="Mục này chỉ có trong app Cloud PC Companion." icon={Download} />
      <div className="enter max-w-2xl rounded-xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(15_23_42/0.05)]">
        <h2 className="text-lg font-bold">Thuê máy và cho thuê máy chạy trong app</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Bản web chỉ để xem danh sách máy và tìm hiểu dịch vụ. Thuê máy, cho thuê máy, ví PCP và xem màn hình máy thuê cần cài app Cloud PC Companion cho Windows.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <DownloadButton size="lg" />
          <Button variant="secondary" size="lg" onClick={() => navigate("/rent/discover")}>Xem danh sách máy</Button>
        </div>
        <ul className="mt-5 list-disc space-y-1.5 pl-5 text-xs text-ink-faint">
          <li>Yêu cầu Windows 11, 64-bit.</li>
          <li>Bộ cài chưa ký số, nên Windows SmartScreen có thể cảnh báo. Trước khi chạy, hãy đối chiếu mã SHA-256 với tệp SHA256SUMS.txt đi kèm bộ cài.</li>
          <li>Trang web này không có tài khoản và không lưu dữ liệu của bạn.</li>
        </ul>
      </div>
    </div>
  );
}

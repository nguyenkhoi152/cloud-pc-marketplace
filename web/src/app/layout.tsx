import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { PreviewBanner } from "@/components/ui";

export const metadata: Metadata = {
  title: "Cloud PC Marketplace (preview)",
  description: "Chợ thuê máy tính từ xa — bản preview M1, dữ liệu minh hoạ.",
};

const nav = [
  ["/", "Danh sách máy"],
  ["/host", "Host"],
  ["/admin", "Duyệt máy"],
  ["/wallet", "Ví PCP"],
  ["/sessions", "Phiên thuê"],
  ["/history", "Lịch sử"],
  ["/workspace", "Workspace"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen">
        <PreviewBanner />
        <nav className="flex flex-wrap gap-4 px-4 py-3 border-b border-slate-300/60 text-sm">
          <span className="font-semibold">Cloud PC Marketplace</span>
          {nav.map(([href, label]) => (
            <Link key={href} href={href} className="hover:underline">
              {label}
            </Link>
          ))}
        </nav>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

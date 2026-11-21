import { Moon, Sun } from "lucide-react";
import { toggleTheme, useTheme } from "@/lib/theme";
import { Button } from "./button";

/** Nút chuyển giao diện sáng/tối. Biểu tượng là theme SẼ chuyển sang (đang tối thì hiện mặt trời); nhãn đọc ra đúng hành động. */
export function ThemeToggle({ className }: { className?: string }) {
  const dark = useTheme() === "dark";
  const label = dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";
  return (
    <Button variant="ghost" size="icon" className={className} onClick={toggleTheme} aria-label={label} title={label} data-testid="theme-toggle">
      {dark ? <Sun className="h-[18px] w-[18px]" aria-hidden /> : <Moon className="h-[18px] w-[18px]" aria-hidden />}
    </Button>
  );
}

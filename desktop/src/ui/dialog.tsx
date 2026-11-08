import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
}

/** Hộp thoại dựa trên Radix: khóa focus, đóng bằng Esc, trả focus về nút mở. */
export function Dialog({ open, onOpenChange, title, description, children, footer, width = "max-w-lg" }: Props) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-navy/45 animate-fade-in" />
        <D.Content
          className={cn("fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-line bg-surface p-6 shadow-pop animate-pop-in", width)}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <D.Title className="text-lg font-bold">{title}</D.Title>
            <D.Close asChild>
              <Button variant="ghost" size="icon" className="-mr-2 -mt-1 h-8 w-8" aria-label="Đóng hộp thoại">
                <X className="h-4 w-4" />
              </Button>
            </D.Close>
          </div>
          {description ? <D.Description className="mb-4 text-sm text-ink-soft">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          {children}
          {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

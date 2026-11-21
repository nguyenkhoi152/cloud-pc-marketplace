import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-teal text-white hover:bg-teal-dark",
        navy: "bg-navy text-white hover:bg-navy-2",
        secondary: "border border-line-strong bg-surface text-ink hover:bg-subtle",
        ghost: "text-ink-soft hover:bg-sky/60 hover:text-ink",
        danger: "bg-danger-solid text-white hover:bg-[#991b1b]",
        "danger-outline": "border border-danger/50 bg-surface text-danger hover:bg-danger-bg",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-5 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  loading?: boolean;
}

export function Button({ className, variant, size, loading, disabled, children, type = "button", ...rest }: Props) {
  return (
    <button type={type} className={cn(buttonStyles({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-[spin_0.9s_linear_infinite]" aria-hidden />}
      {children}
    </button>
  );
}

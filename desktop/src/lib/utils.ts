import { clsx, type ClassValue } from "clsx";
import type { CSSProperties } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Thứ tự xếp tầng cho lớp `.enter` (xem index.css): `<li className="enter" style={stagger(i)}>`. */
export const stagger = (i: number): CSSProperties => ({ "--i": i }) as CSSProperties;

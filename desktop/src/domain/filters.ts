import { maxBookableMinutes } from "./pricing";
import type { Category, Machine } from "./types";

export interface MachineFilters {
  category: Category | "all";
  query: string;
  maxPrice: number | null;
  minRam: number;
  minVram: number;
  location: string;
  workspaceOnly: boolean;
  rentableNow: boolean;
  /** Ẩn máy đang offline (chỉ `offline`: máy `unverified` là không biết, không đoán là offline nên vẫn hiện). */
  hideOffline: boolean;
  sort: "price" | "ram" | "vram" | "window";
}

export const DEFAULT_FILTERS: MachineFilters = {
  category: "game",
  query: "",
  maxPrice: null,
  minRam: 0,
  minVram: 0,
  location: "all",
  workspaceOnly: false,
  rentableNow: false,
  hideOffline: false,
  sort: "price",
};

const norm = (s: string) =>
  s
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");

export function filterMachines(machines: Machine[], f: MachineFilters): Machine[] {
  const q = norm(f.query.trim());
  const out = machines.filter((m) => {
    if (f.category !== "all" && !m.categories.includes(f.category)) return false;
    if (q && !norm([m.name, m.gpu ?? "", m.cpu, m.location, ...m.apps.map((a) => a.name)].join(" ")).includes(q)) return false;
    if (f.maxPrice !== null && m.pricePer15 > f.maxPrice) return false;
    if (m.ramGb < f.minRam) return false;
    if (m.vramGb < f.minVram) return false;
    if (f.location !== "all" && m.location !== f.location) return false;
    if (f.workspaceOnly && !m.workspace) return false;
    if (f.rentableNow && maxBookableMinutes(m) === 0) return false;
    if (f.hideOffline && m.state === "offline") return false;
    return true;
  });
  const key: Record<MachineFilters["sort"], (m: Machine) => number> = {
    price: (m) => m.pricePer15,
    ram: (m) => -m.ramGb,
    vram: (m) => -m.vramGb,
    window: (m) => -maxBookableMinutes(m),
  };
  return out.sort((a, b) => key[f.sort](a) - key[f.sort](b) || a.name.localeCompare(b.name));
}

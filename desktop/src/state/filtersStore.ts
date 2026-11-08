import { create } from "zustand";
import { DEFAULT_FILTERS, type MachineFilters } from "../domain/filters";

interface FiltersState {
  filters: MachineFilters;
  set: (p: Partial<MachineFilters>) => void;
  reset: () => void;
}

/** Bộ lọc khám phá giữ nguyên khi người dùng đi vào chi tiết rồi quay lại. */
export const useFilters = create<FiltersState>((set) => ({
  filters: DEFAULT_FILTERS,
  set: (p) => set((s) => ({ filters: { ...s.filters, ...p } })),
  reset: () => set({ filters: DEFAULT_FILTERS }),
}));

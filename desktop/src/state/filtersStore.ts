import { create } from "zustand";
import { isLive } from "../api/env";
import { DEFAULT_FILTERS as BASE_FILTERS, type MachineFilters } from "../domain/filters";

/** Live: mặc định xem tất cả danh mục (máy thật có thể không thuộc "Game"). */
const DEFAULT_FILTERS: MachineFilters = isLive() ? { ...BASE_FILTERS, category: "all" } : BASE_FILTERS;

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

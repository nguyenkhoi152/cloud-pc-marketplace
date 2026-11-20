// @vitest-environment node
/** Mặc định của bộ lọc khám phá: chế độ thật ẩn máy offline (bật lại được, "Xóa lọc" đưa về mặc định); bản xem trước giữ nguyên. */
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadStore(live: boolean) {
  vi.resetModules();
  vi.doMock("../api/env", () => ({ isLive: () => live }));
  return (await import("./filtersStore")).useFilters;
}

afterEach(() => { vi.doUnmock("../api/env"); vi.resetModules(); });

describe("useFilters: mặc định", () => {
  it("chế độ thật: xem mọi danh mục và ẨN máy offline; hiện lại được; reset về ẩn", async () => {
    const useFilters = await loadStore(true);
    expect(useFilters.getState().filters).toMatchObject({ category: "all", hideOffline: true });
    useFilters.getState().set({ hideOffline: false });
    expect(useFilters.getState().filters.hideOffline).toBe(false);
    useFilters.getState().reset();
    expect(useFilters.getState().filters.hideOffline).toBe(true);
  });
  it("bản xem trước: không ẩn máy offline (dữ liệu mẫu có máy offline để minh hoạ)", async () => {
    const useFilters = await loadStore(false);
    expect(useFilters.getState().filters).toMatchObject({ category: "game", hideOffline: false });
  });
});

// @vitest-environment node
/**
 * Form tạo máy và thẻ máy của chủ máy: chỉ tự nhập tên và mô tả (cùng giá và vị trí); thông số do app đọc từ máy.
 * Render phía server nên không có tương tác; trình tự quét → ghi → đăng được kiểm ở machineScan.test.ts.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HostMachine } from "@/api/live";

vi.mock("@/api", async (orig) => ({
  ...(await orig<typeof import("@/api")>()),
  getLiveApi: () => ({ host: { listCommitments: async () => [], listRules: async () => [], getAccepting: async () => false, health: async () => "unknown", windows: async () => [] } }),
}));

const { NewMachine, MachinePanel } = await import("./LiveScreens");

const machine = (over: Partial<HostMachine> = {}): HostMachine => ({ id: "m1", name: "Máy của Minh", status: "draft", priceUnits: "20000000000000000000", specs: {}, machineKey: "k", ...over });

describe("form Thêm máy mới", () => {
  const h = renderToString(<NewMachine onCreated={() => {}} />);
  it("chỉ có tên máy, mô tả ngắn, giá và vị trí", () => {
    for (const id of ["nm-name", "nm-sum", "nm-price", "nm-loc"]) expect(h).toContain(`id="${id}"`);
    expect((h.match(/<input /g) ?? []).length).toBe(4);
    expect(h).not.toContain('type="checkbox"');
  });
  it("không còn ô nhập thông số phần cứng", () => {
    for (const id of ["nm-cpu", "nm-cores", "nm-ram", "nm-gpu", "nm-vram", "nm-sto", "nm-net"]) expect(h).not.toContain(`id="${id}"`);
    expect(h).not.toMatch(/Số nhân|VRAM \(GB\)|Mạng \(Mbps\)/);
  });
  it("nói rõ cấu hình do app tự đọc khi Quét & đăng máy; mô tả giới hạn 200 ký tự, tên 120 ký tự", () => {
    expect(h).toContain("do app tự đọc từ máy của bạn");
    expect(h).toContain("Quét &amp; đăng máy");
    expect(h).toMatch(/id="nm-sum"[^>]*maxLength="200"|maxLength="200"[^>]*id="nm-sum"/i);
    expect(h).toMatch(/id="nm-name"[^>]*maxLength="120"|maxLength="120"[^>]*id="nm-name"/i);
    expect(h).toContain("0/200 ký tự");
  });
});

describe("thẻ máy của chủ máy", () => {
  it("máy nháp chưa quét: nói thông số sẽ được đọc khi đăng, có nút Quét & đăng máy, chưa có nút đọc lại", () => {
    const h = renderToString(<MachinePanel m={machine()} onChange={() => {}} />);
    expect(h).toContain("Cấu hình sẽ được đọc từ máy của bạn");
    expect(h).toContain("Quét &amp; đăng máy");
    expect(h).not.toContain("Đọc lại cấu hình");
  });
  it("máy đã đăng: hiện mô tả và cấu hình đã đọc, có nút Đọc lại cấu hình, không còn nút đăng", () => {
    const m = machine({ status: "approved", specs: { summary: "Máy dựng phim, mở 19h–23h", cpu: "Intel i7", cores: 16, ramGb: 32, gpu: "NVIDIA GeForce RTX 3070", vramGb: 8, storageGb: 412 } });
    const h = renderToString(<MachinePanel m={m} onChange={() => {}} />);
    expect(h).toContain("Máy dựng phim, mở 19h–23h");
    expect(h).toContain("Intel i7 · 16 nhân · 32 GB RAM · NVIDIA GeForce RTX 3070 · 8 GB VRAM · 412 GB ổ trống");
    expect(h).toContain("Đọc lại cấu hình");
    expect(h).not.toContain("Quét &amp; đăng máy</button>");
    // Số nhân và RAM là phần chia sẻ: nói rõ và dẫn tới chỗ đổi (Thiết lập & chạy máy).
    expect(h).toContain('data-testid="machine-share-hint"');
    expect(h).toContain("Số nhân và RAM là phần bạn chia sẻ cho khách");
    expect(h).toContain('href="#/host/setup"');
  });
  it("máy nháp chưa có cấu hình: chưa có gợi ý về phần chia sẻ (chưa có số nào để giải thích)", () => {
    expect(renderToString(<MachinePanel m={machine()} onChange={() => {}} />)).not.toContain("machine-share-hint");
  });
  it("giá hiển thị đúng và không cần chủ máy nhập thông số", () => {
    const h = renderToString(<MachinePanel m={machine()} onChange={() => {}} />);
    // React tách chuỗi thành nhiều nút văn bản khi render phía server ("20<!-- --> PCP / gói").
    expect(h.replace(/<!-- -->/g, "")).toContain("20 PCP / gói");
  });
});

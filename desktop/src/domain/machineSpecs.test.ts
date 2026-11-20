import { describe, expect, it } from "vitest";
import { parseProbe } from "./hostEnv";
import { MIN_GPU_VRAM_GB, mergeDetectedSpecs, specsFromProbe, specsSummary } from "./machineSpecs";

/** Dựng kết quả quét từ cặp khóa=giá trị như bản Linux in ra (qua đúng bộ phân tích của app). */
const probe = (kv: Record<string, string>) =>
  parseProbe({ code: 0, stdout: Object.entries({ probe_version: "1", cpu_count: "16", mem_total_mb: "15861", disk_free_gb: "412", probe_done: "1", ...kv }).map(([k, v]) => `${k}=${v}`).join("\n"), stderr: "" });

describe("specsFromProbe", () => {
  it("đọc đủ: tên CPU, nhân, RAM làm tròn theo GB, ổ trống", () => {
    const r = specsFromProbe(probe({ cpu_model: "Intel(R) Core(TM) i7-13700 CPU @ 2.10GHz" }));
    expect(r).toEqual({ ok: true, specs: { cpu: "Intel(R) Core(TM) i7-13700 CPU @ 2.10GHz", cores: 16, ramGb: 15, gpu: null, vramGb: 0, storageGb: 412, categories: ["dev"] } });
  });
  it("RAM làm tròn đến GB gần nhất (7942 MB ⇒ 8 GB, 15861 MB ⇒ 15 GB), tối thiểu 1 GB", () => {
    const ram = (mb: string) => { const r = specsFromProbe(probe({ mem_total_mb: mb })); return r.ok ? r.specs.ramGb : null; };
    expect(ram("7942")).toBe(8);
    expect(ram("15861")).toBe(15);
    expect(ram("16384")).toBe(16);
    expect(ram("300")).toBe(1);
  });
  it("có GPU đủ VRAM ⇒ thêm Game và Đồ họa; tên và VRAM lấy từ máy", () => {
    const r = specsFromProbe(probe({ gpu_nvidia: "NVIDIA GeForce RTX 3070", gpu_vram_mb: "8192" }));
    expect(r).toMatchObject({ ok: true, specs: { gpu: "NVIDIA GeForce RTX 3070", vramGb: 8, categories: ["game", "graphics", "dev"] } });
  });
  it(`GPU dưới ${MIN_GPU_VRAM_GB} GB VRAM ⇒ chỉ Lập trình`, () => {
    const r = specsFromProbe(probe({ gpu_nvidia: "NVIDIA GeForce GTX 1050", gpu_vram_mb: "2048" }));
    expect(r).toMatchObject({ ok: true, specs: { vramGb: 2, categories: ["dev"] } });
  });
  it("có tên GPU nhưng bản quét cũ chưa trả VRAM ⇒ không đoán, không xếp Game/Đồ họa", () => {
    const r = specsFromProbe(probe({ gpu_nvidia: "NVIDIA GeForce RTX 4070" }));
    expect(r).toMatchObject({ ok: true, specs: { gpu: "NVIDIA GeForce RTX 4070", vramGb: 0, categories: ["dev"] } });
  });
  it("VRAM không có GPU thì bỏ qua", () => {
    const r = specsFromProbe(probe({ gpu_vram_mb: "8192" }));
    expect(r).toMatchObject({ ok: true, specs: { gpu: null, vramGb: 0 } });
  });
  it("thiếu số nhân hoặc RAM ⇒ từ chối, nói rõ thiếu gì", () => {
    expect(specsFromProbe(probe({ cpu_count: "" }))).toEqual({ ok: false, reason: "không đọc được số nhân CPU" });
    expect(specsFromProbe(probe({ mem_total_mb: "" }))).toEqual({ ok: false, reason: "không đọc được dung lượng RAM" });
  });
  it("quét lỗi hoặc không có kết quả ⇒ từ chối", () => {
    expect(specsFromProbe(null)).toEqual({ ok: false, reason: "chưa quét được máy" });
    expect(specsFromProbe(parseProbe({ code: 1, stdout: "", stderr: "boom" }))).toMatchObject({ ok: false });
  });
});

describe("mergeDetectedSpecs", () => {
  const detected = { cpu: "AMD Ryzen 7", cores: 16, ramGb: 32, gpu: null, vramGb: 0, storageGb: 500, categories: ["dev" as const] };
  it("ghi đè phần cứng nhưng giữ mô tả, vị trí, bí danh và workspace do chủ máy đặt", () => {
    const m = mergeDetectedSpecs({ cores: 2, ramGb: 4, summary: "Máy học tập", location: "Đà Nẵng", hostAlias: "Minh", workspace: false }, detected);
    expect(m).toMatchObject({ ...detected, summary: "Máy học tập", location: "Đà Nẵng", hostAlias: "Minh", workspace: false });
  });
  it("bỏ con số mạng tự khai cũ vì app không đo được", () => {
    const m = mergeDetectedSpecs({ networkMbps: 100, summary: "x" }, detected);
    expect("networkMbps" in m).toBe(false);
  });
  it("không sửa đối tượng đầu vào", () => {
    const before = { cores: 2, networkMbps: 100 };
    mergeDetectedSpecs(before, detected);
    expect(before).toEqual({ cores: 2, networkMbps: 100 });
  });
});

describe("specsSummary", () => {
  it("chưa đọc lần nào ⇒ null", () => {
    expect(specsSummary({})).toBeNull();
    expect(specsSummary({ cores: 8 })).toBeNull();
  });
  it("tóm tắt có/không GPU, có/không tên CPU", () => {
    expect(specsSummary({ cpu: "Intel i7", cores: 8, ramGb: 16, gpu: "RTX 3070", vramGb: 8, storageGb: 256 })).toBe("Intel i7 · 8 nhân · 16 GB RAM · RTX 3070 · 8 GB VRAM · 256 GB ổ trống");
    expect(specsSummary({ cpu: "", cores: 4, ramGb: 8, gpu: null, vramGb: 0, storageGb: 0 })).toBe("4 nhân · 8 GB RAM · Không có GPU rời");
  });
});

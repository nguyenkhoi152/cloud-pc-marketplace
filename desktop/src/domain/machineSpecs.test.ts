import { describe, expect, it } from "vitest";
import { parseProbe } from "./hostEnv";
import { GPU_UNNAMED, MIN_GPU_VRAM_GB, mergeDetectedSpecs, specsFromProbe, specsSummary } from "./machineSpecs";

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
  it("chủ máy chọn chia sẻ ít hơn ⇒ số nhân và RAM trên thẻ là phần khách được dùng, CPU/GPU vẫn là số đọc được", () => {
    const r = specsFromProbe(probe({ cpu_count: "16", mem_total_mb: "31000", cpu_model: "AMD Ryzen 9 5950X", gpu_nvidia: "NVIDIA GeForce RTX 3070", gpu_vram_mb: "8192" }), { ramGb: 8, cpus: 4 });
    expect(r).toMatchObject({ ok: true, specs: { cpu: "AMD Ryzen 9 5950X", cores: 4, ramGb: 8, gpu: "NVIDIA GeForce RTX 3070", vramGb: 8 } });
  });
  it("không chọn chia sẻ ⇒ lấy toàn bộ phần bản Linux thấy", () => {
    const r = specsFromProbe(probe({ cpu_count: "16", mem_total_mb: "31000" }), { ramGb: null, cpus: null });
    expect(r).toMatchObject({ ok: true, specs: { cores: 16, ramGb: 30 } });
  });
  it("mức đã lưu không còn hợp lệ với máy này (lưu từ máy khác lớn hơn) ⇒ bỏ qua, không khoe nhiều hơn máy có", () => {
    const r = specsFromProbe(probe({ cpu_count: "4", mem_total_mb: "7942" }), { ramGb: 64, cpus: 32 });
    expect(r).toMatchObject({ ok: true, specs: { cores: 4, ramGb: 8 } });
  });
  it("dịch vụ đang chạy ⇒ lấy mức ĐANG ÁP DỤNG của container khách (ví dụ bật bằng script: 4 GB, 2 CPU), không phải mức chọn trong app", () => {
    const r = specsFromProbe(probe({ cpu_count: "16", mem_total_mb: "31000", agent_running: "1", applied_memory_mb: "4096", applied_cpus: "2" }), { ramGb: 12, cpus: 8 });
    expect(r).toMatchObject({ ok: true, specs: { cores: 2, ramGb: 4 } });
  });
  it("dịch vụ đang chạy mà cấu hình không có giới hạn ⇒ khách dùng toàn bộ, KHÔNG rơi về mức đã chọn (chưa áp dụng)", () => {
    const r = specsFromProbe(probe({ cpu_count: "16", mem_total_mb: "31000", agent_running: "1" }), { ramGb: 8, cpus: 4 });
    expect(r).toMatchObject({ ok: true, specs: { cores: 16, ramGb: 30 } });
  });
  it("dịch vụ chưa chạy ⇒ bỏ qua mức cấu hình cũ trong tệp, dùng mức chủ máy đã chọn", () => {
    const r = specsFromProbe(probe({ cpu_count: "16", mem_total_mb: "31000", agent_running: "0", applied_memory_mb: "4096", applied_cpus: "2" }), { ramGb: 12, cpus: 8 });
    expect(r).toMatchObject({ ok: true, specs: { cores: 8, ramGb: 12 } });
  });
  it("mức đang áp dụng lớn hơn máy có (cấu hình cũ từ máy khác) ⇒ không vượt phần bản Linux thấy", () => {
    const r = specsFromProbe(probe({ cpu_count: "4", mem_total_mb: "7942", agent_running: "1", applied_memory_mb: "65536", applied_cpus: "32" }));
    expect(r).toMatchObject({ ok: true, specs: { cores: 4, ramGb: 8 } });
  });
  it("thấy thiết bị GPU nhưng không đọc được tên ⇒ ghi rõ chưa đọc được tên, không khẳng định không có GPU, không xếp Game/Đồ họa", () => {
    const r = specsFromProbe(probe({ gpu_dxg: "1" }));
    expect(r).toMatchObject({ ok: true, specs: { gpu: GPU_UNNAMED, vramGb: 0, categories: ["dev"] } });
    const render = specsFromProbe(probe({ gpu_render_node: "1" }));
    expect(render).toMatchObject({ ok: true, specs: { gpu: GPU_UNNAMED } });
  });
  it("không thấy thiết bị GPU nào ⇒ gpu null", () => {
    expect(specsFromProbe(probe({ gpu_dxg: "0", gpu_render_node: "0" }))).toMatchObject({ ok: true, specs: { gpu: null } });
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

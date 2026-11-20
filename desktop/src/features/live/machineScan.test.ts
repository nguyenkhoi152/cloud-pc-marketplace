import { describe, expect, it, vi } from "vitest";
import { assertMachineEligible, readMachineSpecs, rescanSpecs, scanAndPublish, scanForPublish, syncOwnMachineSpecs, type ScanDeps } from "./machineScan";

// Đầu ra dạng `cpm-guest.sh probe` (cùng định dạng hostEnv.test.ts dùng). Chỉ thay đổi các khoá cần thử.
const probeText = (over: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    probe_version: "1", os_id: "ubuntu", os_version: "24.04", is_wsl: "1", systemd: "1", user: "cpm", in_docker_group: "1", cpu_count: "8",
    mem_total_mb: "7942", disk_free_gb: "44", docker_cli: "29.1.3", docker_sock: "1", docker_daemon: "1", image_present: "1", node: "18.19.1",
    agent_installed: "1", agent_sha256: "x", configured: "1", enrolled: "0", machine_id: "", agent_running: "0", api_reachable: "1", probe_done: "1",
  };
  return Object.entries({ ...base, ...over }).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
};

const deps = (over: Partial<ScanDeps> = {}): ScanDeps => ({
  available: () => true,
  overview: async () => ({ backend: { kind: "wsl" } }),
  probe: async () => ({ code: 0, stdout: probeText(), stderr: "" }),
  apiBase: () => "https://x.trycloudflare.com/api",
  ...over,
});

describe("assertMachineEligible: cổng quét trước khi đăng máy (không còn admin duyệt)", () => {
  it("guest đủ thành phần ⇒ qua", async () => {
    await expect(assertMachineEligible(deps())).resolves.toBeUndefined();
  });
  it("chạy ngoài app Windows (không có lớp native) ⇒ chặn, KHÔNG gọi quét", async () => {
    const probe = vi.fn();
    await expect(assertMachineEligible(deps({ available: () => false, probe }))).rejects.toThrow(/app Cloud PC Companion trên Windows/);
    expect(probe).not.toHaveBeenCalled();
  });
  it("chưa chọn guest ⇒ chặn, nói phải vào Thiết lập & chạy máy", async () => {
    await expect(assertMachineEligible(deps({ overview: async () => ({ backend: null }) }))).rejects.toThrow(/Chưa chọn bản Linux/);
  });
  it("quét thất bại ⇒ chặn với lý do, không coi là đạt", async () => {
    const probe = async () => ({ code: 1, stdout: "", stderr: "There is no distribution with the supplied name." });
    await expect(assertMachineEligible(deps({ probe }))).rejects.toThrow(/Chưa quét được máy: Không tìm thấy bản Linux/);
  });
  it("thiếu thành phần ⇒ chặn và liệt kê đúng thứ thiếu", async () => {
    const probe = async () => ({ code: 0, stdout: probeText({ image_present: "0", docker_daemon: "0" }), stderr: "" });
    await expect(assertMachineEligible(deps({ probe }))).rejects.toThrow(/Docker dùng được; môi trường desktop cho khách/);
  });
  it("địa chỉ máy chủ chuyển cho lệnh quét đúng như cấu hình hiện tại", async () => {
    const probe = vi.fn(async () => ({ code: 0, stdout: probeText(), stderr: "" }));
    await assertMachineEligible(deps({ probe }));
    expect(probe).toHaveBeenCalledWith("https://x.trycloudflare.com/api");
  });
});

describe("đọc thông số máy (chủ máy chỉ đặt tên và mô tả)", () => {
  const withGpu = { cpu_model: "Intel(R) Core(TM) i7-13700 CPU @ 2.10GHz", gpu_nvidia: "NVIDIA GeForce RTX 3070", gpu_vram_mb: "8192" };
  const probeOf = (over: Record<string, string>) => async () => ({ code: 0, stdout: probeText(over), stderr: "" });

  it("readMachineSpecs: đọc CPU, nhân, RAM, GPU, VRAM, ổ trống và danh mục từ máy", async () => {
    await expect(readMachineSpecs(deps({ probe: probeOf(withGpu) }))).resolves.toEqual({
      cpu: "Intel(R) Core(TM) i7-13700 CPU @ 2.10GHz", cores: 8, ramGb: 8, gpu: "NVIDIA GeForce RTX 3070", vramGb: 8, storageGb: 44, categories: ["game", "graphics", "dev"],
    });
  });
  it("readMachineSpecs: không đòi máy đã đủ điều kiện đăng (đọc lại cấu hình khi chưa cài đủ thành phần vẫn được)", async () => {
    await expect(readMachineSpecs(deps({ probe: probeOf({ image_present: "0", docker_daemon: "0", agent_installed: "0" }) }))).resolves.toMatchObject({ cores: 8 });
  });
  it("readMachineSpecs: chạy trên trình duyệt ⇒ chặn, KHÔNG gọi quét", async () => {
    const probe = vi.fn();
    await expect(readMachineSpecs(deps({ available: () => false, probe }))).rejects.toThrow(/app Cloud PC Companion trên Windows/);
    expect(probe).not.toHaveBeenCalled();
  });
  it("readMachineSpecs: thiếu số nhân hoặc RAM ⇒ nói rõ thiếu gì, không đoán", async () => {
    await expect(readMachineSpecs(deps({ probe: probeOf({ cpu_count: "" }) }))).rejects.toThrow(/Chưa đọc được cấu hình máy: không đọc được số nhân CPU/);
    await expect(readMachineSpecs(deps({ probe: probeOf({ mem_total_mb: "" }) }))).rejects.toThrow(/không đọc được dung lượng RAM/);
  });
  it("scanForPublish: một lần quét vừa kiểm tra đủ điều kiện vừa đọc thông số (không quét hai lần)", async () => {
    const probe = vi.fn(probeOf(withGpu));
    await expect(scanForPublish(deps({ probe }))).resolves.toMatchObject({ gpu: "NVIDIA GeForce RTX 3070", vramGb: 8 });
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it("scanForPublish: máy chưa đủ điều kiện ⇒ chặn với danh sách thiếu, dù đọc được thông số", async () => {
    await expect(scanForPublish(deps({ probe: probeOf({ ...withGpu, image_present: "0" }) }))).rejects.toThrow(/Máy chưa đủ điều kiện để đăng: còn thiếu môi trường desktop cho khách/);
  });
});

describe("đăng máy và đọc lại cấu hình: ghi thông số đọc được, giữ nguyên phần chủ máy tự đặt", () => {
  const probeOf = (over: Record<string, string>) => async () => ({ code: 0, stdout: probeText(over), stderr: "" });
  const hostSpecs = { summary: "Máy học tập", location: "Đà Nẵng", workspace: false, cores: 2, ramGb: 4, networkMbps: 100 };
  const fakeApi = () => {
    const calls: string[] = [];
    return {
      calls,
      api: {
        updateMachineSpecs: vi.fn(async (id: string, s: object) => { calls.push(`update:${id}:${Object.keys(s).includes("networkMbps")}`); }),
        publishMachine: vi.fn(async (id: string) => { calls.push(`publish:${id}`); return "approved" as const; }),
      },
    };
  };

  it("scanAndPublish: quét → ghi thông số → đăng, đúng thứ tự; thông số đọc ghi đè số tự khai cũ, mô tả và vị trí được giữ", async () => {
    const { api, calls } = fakeApi();
    await expect(scanAndPublish(api, { id: "m1", specs: hostSpecs }, deps({ probe: probeOf({ gpu_nvidia: "NVIDIA GeForce RTX 3070", gpu_vram_mb: "8192" }) }))).resolves.toBe("approved");
    expect(calls).toEqual(["update:m1:false", "publish:m1"]);
    expect(api.updateMachineSpecs).toHaveBeenCalledWith("m1", expect.objectContaining({ summary: "Máy học tập", location: "Đà Nẵng", cores: 8, ramGb: 8, gpu: "NVIDIA GeForce RTX 3070", vramGb: 8, storageGb: 44, categories: ["game", "graphics", "dev"] }));
  });
  it("scanAndPublish: máy chưa đủ điều kiện ⇒ KHÔNG ghi thông số, KHÔNG đăng", async () => {
    const { api } = fakeApi();
    await expect(scanAndPublish(api, { id: "m1", specs: hostSpecs }, deps({ probe: probeOf({ image_present: "0" }) }))).rejects.toThrow(/chưa đủ điều kiện/);
    expect(api.updateMachineSpecs).not.toHaveBeenCalled();
    expect(api.publishMachine).not.toHaveBeenCalled();
  });
  it("scanAndPublish: ghi thông số lỗi ⇒ không đăng", async () => {
    const { api } = fakeApi();
    api.updateMachineSpecs.mockRejectedValueOnce(new Error("không ghi được"));
    await expect(scanAndPublish(api, { id: "m1", specs: hostSpecs }, deps())).rejects.toThrow("không ghi được");
    expect(api.publishMachine).not.toHaveBeenCalled();
  });
  it("scanAndPublish: ngoài app Windows ⇒ không ghi, không đăng", async () => {
    const { api } = fakeApi();
    await expect(scanAndPublish(api, { id: "m1", specs: hostSpecs }, deps({ available: () => false }))).rejects.toThrow(/app Cloud PC Companion trên Windows/);
    expect(api.updateMachineSpecs).not.toHaveBeenCalled();
    expect(api.publishMachine).not.toHaveBeenCalled();
  });
  it("rescanSpecs: ghi đè phần cứng, không đăng lại; quét thất bại thì không ghi gì", async () => {
    const { api } = fakeApi();
    await rescanSpecs(api, { id: "m2", specs: hostSpecs }, deps());
    expect(api.updateMachineSpecs).toHaveBeenCalledWith("m2", expect.objectContaining({ summary: "Máy học tập", cores: 8 }));
    expect(api.publishMachine).not.toHaveBeenCalled();
    const bad = fakeApi();
    await expect(rescanSpecs(bad.api, { id: "m2", specs: hostSpecs }, deps({ probe: probeOf({ cpu_count: "" }) }))).rejects.toThrow(/không đọc được số nhân CPU/);
    expect(bad.api.updateMachineSpecs).not.toHaveBeenCalled();
  });
});

describe("tự điền thông số cho máy đang chạy trên PC này (không cần bấm gì)", () => {
  const MY_ID = "11111111-2222-3333-4444-555555555555";
  const probeOf = (over: Record<string, string>) => async () => ({ code: 0, stdout: probeText({ machine_id: MY_ID, enrolled: "1", cpu_model: "AMD Ryzen 9 5950X", gpu_nvidia: "NVIDIA GeForce RTX 3070", gpu_vram_mb: "8192", ...over }), stderr: "" });
  const typed = { cores: 8, ramGb: 16, networkMbps: 100, summary: "Máy học tập", location: "Đà Nẵng" };
  const mk = () => ({ updateMachineSpecs: vi.fn(async () => undefined) });

  it("máy khớp mã ghi danh ⇒ ghi CPU, GPU, VRAM đọc được; mô tả và vị trí được giữ; số mạng tự khai cũ bị dọn", async () => {
    const api = mk();
    const r = await syncOwnMachineSpecs(api, [{ id: MY_ID, specs: typed }], deps({ probe: probeOf({}) }));
    expect(r).toEqual({ machineId: MY_ID, changed: true });
    const written = (api.updateMachineSpecs.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(written).toMatchObject({ cpu: "AMD Ryzen 9 5950X", gpu: "NVIDIA GeForce RTX 3070", vramGb: 8, summary: "Máy học tập", location: "Đà Nẵng" });
    expect("networkMbps" in written).toBe(false);
  });
  it("chỉ đụng máy chạy trên PC này: máy khác của cùng tài khoản không bị ghi", async () => {
    const api = mk();
    expect(await syncOwnMachineSpecs(api, [{ id: "other-machine", specs: typed }], deps({ probe: probeOf({}) }))).toBeNull();
    expect(api.updateMachineSpecs).not.toHaveBeenCalled();
  });
  it("chưa ghi danh (không có mã máy) ⇒ không ghi gì", async () => {
    const api = mk();
    expect(await syncOwnMachineSpecs(api, [{ id: MY_ID, specs: typed }], deps({ probe: probeOf({ machine_id: "" }) }))).toBeNull();
    expect(api.updateMachineSpecs).not.toHaveBeenCalled();
  });
  it("không có thay đổi ⇒ không ghi lại (ổ trống dao động dưới 20 GB không tính)", async () => {
    const api = mk();
    const first = (await readMachineSpecs(deps({ probe: probeOf({}) })));
    const specs = { ...first, summary: "x", storageGb: first.storageGb + 10 };
    expect(await syncOwnMachineSpecs(api, [{ id: MY_ID, specs }], deps({ probe: probeOf({}) }))).toEqual({ machineId: MY_ID, changed: false });
    expect(api.updateMachineSpecs).not.toHaveBeenCalled();
  });
  it("chủ máy đổi mức chia sẻ ⇒ số nhân và RAM trên thẻ đổi theo (CPU/GPU vẫn là số đọc được)", async () => {
    const api = mk();
    const full = await readMachineSpecs(deps({ probe: probeOf({ cpu_count: "16", mem_total_mb: "31000" }) }));
    await syncOwnMachineSpecs(api, [{ id: MY_ID, specs: { ...full, summary: "x" } }], deps({ probe: probeOf({ cpu_count: "16", mem_total_mb: "31000" }), share: () => ({ ramGb: 8, cpus: 4 }) }));
    expect(api.updateMachineSpecs).toHaveBeenCalledWith(MY_ID, expect.objectContaining({ cores: 4, ramGb: 8, cpu: "AMD Ryzen 9 5950X" }));
  });
  it("không bao giờ ném lỗi: ngoài app Windows, chưa chọn bản Linux, quét lỗi hoặc ghi lỗi đều trả null", async () => {
    const m = [{ id: MY_ID, specs: typed }];
    expect(await syncOwnMachineSpecs(mk(), m, deps({ available: () => false }))).toBeNull();
    expect(await syncOwnMachineSpecs(mk(), m, deps({ overview: async () => ({ backend: null }) }))).toBeNull();
    expect(await syncOwnMachineSpecs(mk(), m, deps({ probe: async () => ({ code: 1, stdout: "", stderr: "boom" }) }))).toBeNull();
    expect(await syncOwnMachineSpecs(mk(), m, deps({ probe: async () => { throw new Error("native lỗi"); } }))).toBeNull();
    const failing = { updateMachineSpecs: vi.fn(async () => { throw new Error("không ghi được"); }) };
    expect(await syncOwnMachineSpecs(failing, m, deps({ probe: probeOf({}) }))).toBeNull();
  });
  it("đăng máy và đọc lại cấu hình cũng theo mức chia sẻ đã chọn", async () => {
    const api = { updateMachineSpecs: vi.fn(async () => undefined), publishMachine: vi.fn(async () => "approved" as const) };
    await scanAndPublish(api, { id: "m9", specs: typed }, deps({ probe: probeOf({ cpu_count: "16", mem_total_mb: "31000" }), share: () => ({ ramGb: 12, cpus: 6 }) }));
    expect(api.updateMachineSpecs).toHaveBeenCalledWith("m9", expect.objectContaining({ cores: 6, ramGb: 12 }));
  });
});

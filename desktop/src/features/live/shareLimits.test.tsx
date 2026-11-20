// @vitest-environment node
/**
 * Mục "Chia sẻ cho khách": luôn có ô chọn RAM/CPU (không còn biến mất khi dịch vụ đã chạy), nói đúng mức ĐANG áp dụng đọc từ cấu hình thật,
 * và cảnh báo khi mức chọn khác mức đang chạy. Render phía server nên kiểm bằng chuỗi; logic so sánh kiểm riêng.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseProbe } from "@/domain/hostEnv";
import { ShareLimits, appliedLimits, limitsDiffer, limitsSummary } from "./ShareLimits";

const probe = (kv: Record<string, string> = {}) =>
  parseProbe({ code: 0, stdout: Object.entries({ probe_version: "1", cpu_count: "16", mem_total_mb: "31000", disk_free_gb: "400", probe_done: "1", ...kv }).map(([k, v]) => `${k}=${v}`).join("\n"), stderr: "" });
const html = (kv: Record<string, string>, limits = { ramGb: null as number | null, cpus: null as number | null }, running = false) =>
  renderToString(<ShareLimits probe={probe(kv)} limits={limits} onChange={() => {}} agentRunning={running} />).replace(/<!-- -->/g, "");
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("mục Chia sẻ cho khách", () => {
  it("có ô chọn RAM và CPU, kể cả khi dịch vụ đang chạy (không còn nằm trong bước Bắt đầu)", () => {
    for (const running of [false, true]) {
      const s = html({ agent_running: running ? "1" : "0" }, undefined, running);
      expect(s).toContain('data-testid="limits"');
      expect(s).toContain('id="hs-ram"');
      expect(s).toContain('id="hs-cpu"');
      expect(text(s)).toContain("Chia sẻ cho khách");
    }
  });
  it("các lựa chọn không vượt phần bản Linux có (tối đa 80%)", () => {
    const s = html({ mem_total_mb: "7942", cpu_count: "4" });
    expect(s).toContain("<option value=\"4\">4 GB</option>");
    expect(s).not.toContain("<option value=\"8\">8 GB</option>"); // 80% của 7,75 GB là 6,2 GB
    expect(s).toContain("<option value=\"2\">2 CPU</option>");
    expect(s).not.toContain("<option value=\"4\">4 CPU</option>"); // chừa lõi cho chủ máy: 80% của 4 là 3
  });
  it("chưa chạy: nói mức chọn sẽ áp dụng ở lần bắt đầu tới, không hiện dòng 'Đang áp dụng'", () => {
    const t = text(html({}, { ramGb: 8, cpus: 4 }));
    expect(t).toContain("Chưa nhận thuê");
    expect(t).toContain("RAM 8 GB · CPU 4");
    expect(t).not.toContain("Đang áp dụng cho khách");
  });
  it("đang chạy: hiện mức ĐANG áp dụng đọc từ cấu hình (ví dụ bật bằng script: 4 GB, 2 CPU)", () => {
    const t = text(html({ agent_running: "1", applied_memory_mb: "4096", applied_cpus: "2" }, { ramGb: 4, cpus: 2 }, true));
    expect(t).toContain("Đang áp dụng cho khách: RAM 4 GB · CPU 2");
    expect(t).not.toContain("khác mức đang áp dụng");
  });
  it("đang chạy mà mức chọn khác mức đang áp dụng: cảnh báo phải dừng rồi bắt đầu lại", () => {
    const t = text(html({ agent_running: "1", applied_memory_mb: "4096", applied_cpus: "2" }, { ramGb: 12, cpus: 8 }, true));
    expect(t).toContain("Đang áp dụng cho khách: RAM 4 GB · CPU 2");
    expect(t).toContain("Mức bạn chọn khác mức đang áp dụng");
    expect(t).toContain("Dừng nhận thuê rồi Bắt đầu nhận thuê lại");
  });
  it("đang chạy không giới hạn (cấu hình không có khoá): nói không giới hạn, không bịa số", () => {
    const t = text(html({ agent_running: "1" }, undefined, true));
    expect(t).toContain("Đang áp dụng cho khách: RAM không giới hạn · CPU không giới hạn");
  });
});

describe("logic mức chia sẻ", () => {
  it("appliedLimits: null khi chưa chạy; đổi MiB sang GB; thiếu khoá là không giới hạn", () => {
    expect(appliedLimits(probe({ applied_memory_mb: "4096", applied_cpus: "2" }), false)).toBeNull();
    expect(appliedLimits(null, true)).toBeNull();
    expect(appliedLimits(probe({ agent_running: "1", applied_memory_mb: "4096", applied_cpus: "2" }), true)).toEqual({ ramGb: 4, cpus: 2 });
    expect(appliedLimits(probe({ agent_running: "1" }), true)).toEqual({ ramGb: null, cpus: null });
  });
  it("limitsDiffer: chỉ so khi đang chạy; null (không giới hạn) và số khác nhau là khác", () => {
    expect(limitsDiffer({ ramGb: 8, cpus: 4 }, null)).toBe(false);
    expect(limitsDiffer({ ramGb: 4, cpus: 2 }, { ramGb: 4, cpus: 2 })).toBe(false);
    expect(limitsDiffer({ ramGb: null, cpus: 2 }, { ramGb: 4, cpus: 2 })).toBe(true);
    expect(limitsDiffer({ ramGb: 4, cpus: 2 }, { ramGb: 4, cpus: null })).toBe(true);
  });
  it("limitsSummary", () => {
    expect(limitsSummary({ ramGb: 8, cpus: 4 })).toBe("RAM 8 GB · CPU 4");
    expect(limitsSummary({ ramGb: null, cpus: null })).toBe("RAM không giới hạn · CPU không giới hạn");
    expect(limitsSummary({ ramGb: 1.5, cpus: null })).toBe("RAM 1.5 GB · CPU không giới hạn");
  });
});

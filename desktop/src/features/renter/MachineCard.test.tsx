// @vitest-environment node
/**
 * Thẻ máy ở "Khám phá máy": chỉ hiện số liệu có thật (dòng thiếu số liệu thì ẩn), trạng thái đúng, giá đúng,
 * nút so sánh có tên truy cập, liên kết tới chi tiết máy.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Machine } from "@/domain/types";
import { MachineCard, indicatorOf, isCardBackgroundClick } from "./MachineCard";

const machine = (over: Partial<Machine> = {}): Machine => ({
  id: "m-1", name: "Máy dựng phim", hostAlias: "Minh", categories: ["game", "graphics", "dev"], location: "Hồ Chí Minh",
  cpu: "Ryzen 9 5950X", cores: 32, ramGb: 58, gpu: "NVIDIA GeForce RTX 4090", vramGb: 24, storageGb: 723, networkMbps: 0, pricePer15: 20,
  workspace: false, state: "online", apps: [], windows: [], summary: "Máy dựng phim và render, mở tối thứ Hai đến thứ Sáu.", ...over,
});
const html = (m: Machine, over: { compared?: boolean } = {}) => renderToString(<MachineCard m={m} index={0} compared={over.compared ?? false} onToggle={() => {}} />);
const text = (s: string) => s.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("thẻ máy", () => {
  it("hiện tên do chủ máy đặt, mô tả, vị trí và các dòng cấu hình đọc từ máy", () => {
    const t = text(html(machine()));
    expect(t).toContain("Máy dựng phim");
    expect(t).toContain("Máy dựng phim và render, mở tối thứ Hai đến thứ Sáu.");
    expect(t).toContain("Minh · Hồ Chí Minh");
    expect(t).toContain("GPU GeForce RTX 4090"); // bỏ tiền tố hãng như bảng cũ
    expect(t).toContain("VRAM 24 GB");
    expect(t).toContain("CPU Ryzen 9 5950X 32 nhân");
    expect(t).toContain("RAM 58 GB");
    expect(t).toContain("Disk 723 GB trống");
  });
  it("máy không GPU: nói rõ và không có dòng VRAM", () => {
    const t = text(html(machine({ gpu: null, vramGb: 0, categories: ["dev"] })));
    expect(t).toContain("GPU Không có GPU rời");
    expect(t).not.toContain("VRAM");
  });
  it("không bịa số liệu: thiếu tốc độ mạng, ổ đĩa hay tên CPU thì ẩn dòng hoặc chỉ nêu số nhân", () => {
    const t = text(html(machine({ networkMbps: 0, storageGb: 0, cpu: "" })));
    expect(t).not.toContain("Net");
    expect(t).not.toContain("Disk");
    expect(t).toContain("CPU 32 nhân");
  });
  it("có số đo mạng (bản xem trước) thì hiện kèm chữ mô phỏng", () => {
    const t = text(html(machine({ networkMbps: 300 })));
    expect(t).toContain("Net 300 Mbps mô phỏng");
  });
  it("GPU có tên nhưng chưa rõ VRAM: ghi Chưa rõ, không ghi 0 GB", () => {
    const t = text(html(machine({ vramGb: 0 })));
    expect(t).toContain("VRAM Chưa rõ");
    expect(t).not.toContain("0 GB");
  });
  it("giá và đơn vị đúng (bản xem trước ghi PCP thử)", () => {
    const s = html(machine({ pricePer15: 12.5 }));
    expect(s).toMatch(/data-testid="machine-price"[^>]*>12.5</);
    expect(text(s)).toContain("PCP thử / 15 phút");
  });
  it("danh mục và workspace hiện dạng nhãn", () => {
    const t = text(html(machine({ workspace: true })));
    for (const c of ["Game", "Đồ họa", "Lập trình", "Lưu workspace"]) expect(t).toContain(c);
  });
  it("liên kết tới chi tiết máy: tên máy và nút Chi tiết, nút có tên truy cập riêng", () => {
    const s = html(machine());
    expect((s.match(/href="#\/rent\/machine\/m-1"/g) ?? []).length).toBe(2);
    expect(s).toContain('aria-label="Chi tiết Máy dựng phim"');
  });
  it("ô so sánh có tên truy cập theo máy và phản ánh trạng thái đã chọn", () => {
    expect(html(machine()).replace(/<!-- -->/g, "")).toContain("So sánh Máy dựng phim");
    expect(html(machine(), { compared: true })).toMatch(/type="checkbox"[^>]*checked/);
    expect(html(machine(), { compared: false })).not.toMatch(/type="checkbox"[^>]*checked/);
  });
  it("là thẻ có tên truy cập và xếp tầng theo thứ tự", () => {
    const s = renderToString(<MachineCard m={machine()} index={3} compared={false} onToggle={() => {}} />);
    expect(s).toContain('aria-label="Máy dựng phim"');
    expect(s).toContain("--i:3");
  });
});

describe("cả thẻ là một vùng bấm", () => {
  const target = (hit: boolean) => ({ closest: (sel: string) => (hit ? { sel } : null) });
  it("bấm vào nền thẻ ⇒ mở chi tiết", () => {
    expect(isCardBackgroundClick(target(false), "")).toBe(true);
    expect(isCardBackgroundClick(target(false), "   ")).toBe(true);
  });
  it("bấm vào liên kết, nút, ô So sánh hay nhãn của nó ⇒ để điều khiển đó tự xử lý, không mở thêm", () => {
    const sels: string[] = [];
    expect(isCardBackgroundClick({ closest: (s: string) => (sels.push(s), { ok: true }) }, "")).toBe(false);
    for (const tag of ["a", "button", "input", "label"]) expect(sels[0]).toContain(tag);
  });
  it("đang bôi đen chữ để sao chép ⇒ không mở", () => {
    expect(isCardBackgroundClick(target(false), "RTX 3060")).toBe(false);
  });
  it("không có đích bấm ⇒ không mở", () => {
    expect(isCardBackgroundClick(null, "")).toBe(false);
  });
  it("thẻ là một nhóm: có con trỏ bấm được và các phần đổi màu theo cả thẻ (không chỉ chữ tên máy)", () => {
    const s = html(machine());
    expect(s).toMatch(/<article[^>]*class="[^"]*\bgroup\b[^"]*\bcursor-pointer\b/);
    expect(s).toContain("group-hover:text-teal-dark"); // tên máy
    expect(s).toContain("group-hover:bg-teal-tint/60"); // dải đầu và chân thẻ
    expect(s).toContain("group-hover:bg-teal-dark"); // nút Chi tiết
    expect(s).not.toContain("hover:underline"); // không còn phản ứng riêng của chữ tên máy
  });
});

describe("trạng thái ở góc thẻ", () => {
  it("mỗi trạng thái có chữ riêng (không chỉ dựa vào màu)", () => {
    const texts = (["online", "available", "busy", "offline", "blocked", "unverified"] as const).map((s) => indicatorOf(s).text);
    expect(texts).toEqual(["Online", "Sẵn sàng", "Đang có phiên", "Offline", "Đang xử lý sự cố", "Chưa xác minh"]);
    expect(new Set(texts).size).toBe(6);
  });
  it("chỉ máy đang online mới nhấp nháy", () => {
    expect(indicatorOf("online").pulse).toBe(true);
    for (const s of ["available", "busy", "offline", "blocked", "unverified"] as const) expect(indicatorOf(s).pulse).toBeFalsy();
  });
  it("thẻ máy offline hiện chữ Offline và lý do không thuê được", () => {
    const t = text(html(machine({ state: "offline" })));
    expect(t).toContain("Offline");
    expect(t).toContain("Máy đang offline");
  });
});

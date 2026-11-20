// @vitest-environment node
/**
 * Màn Giới thiệu: nội dung có đủ mục, không lộ thuật ngữ kỹ thuật, và các con số nêu trong lời khớp cấu hình hợp đồng đã deploy
 * (contracts/deployments/fuji.json). Đổi cấu hình hợp đồng mà quên sửa lời thì test này đỏ.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { About, HowTab, OverviewTab, PaymentTab, TermsTab } from "./About";
import * as content from "./aboutContent";

const html = (el: React.ReactElement) => renderToString(el);

function findKey(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === key) return v;
      const r = findKey(v, key);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}
const fuji = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../contracts/deployments/fuji.json", import.meta.url)), "utf8"));

const allText = (): string[] => {
  const out: string[] = [content.PURPOSE, ...content.PCP_FACTS];
  for (const a of content.AUDIENCES) out.push(a.title, a.who, ...a.needs);
  for (const s of [...content.RENTER_STEPS, ...content.HOST_STEPS]) out.push(s.title, s.text);
  for (const r of content.PAYMENT_RULES) out.push(r.title, r.text);
  for (const g of content.TERMS) out.push(g.title, ...g.items);
  for (const h of content.HIGHLIGHTS) out.push(h.value, h.label);
  return out;
};

describe("nội dung Giới thiệu", () => {
  it("không chứa thuật ngữ kỹ thuật hay lời của người phát triển", () => {
    const banned = /supabase|migration|heartbeat|selkies|\bagent\b|\bguest\b|gateway|tunnel|chưa nối|mô phỏng|dữ liệu mẫu|credential|\bworker\b|vite_|\brls\b|\bjwt\b|hardhat|\.md\b|\bbooking\b|\buser\b|chainid|\brpc\b|\bsql\b|escrow/i;
    for (const t of allText()) expect(t, t).not.toMatch(banned);
  });

  it("không ghi cứng tên mạng: nội dung đúng với mọi cấu hình build (tên mạng chỉ hiện ở tab Mạng & hợp đồng)", () => {
    for (const t of allText()) expect(t, t).not.toMatch(/Fuji|Avalanche|Snowtrace|Hardhat/i);
  });

  it("giải thích PCP là gì ngay từ đầu: PC Point, token thử nghiệm, không có giá trị quy đổi", () => {
    const s = content.PCP_FACTS.join(" ");
    expect(s).toContain("PC Point (PCP)");
    expect(s).toMatch(/token thử nghiệm/);
    expect(s).toMatch(/không có giá trị quy đổi/);
  });

  it("con số trong lời khớp cấu hình hợp đồng đã deploy trên Fuji", () => {
    const duration = Number(findKey(fuji, "durationSeconds"));
    const feeBps = Number(findKey(fuji, "feeBps"));
    const grace = Number(findKey(fuji, "graceSeconds"));
    const arbitration = Number(findKey(fuji, "arbitrationSeconds"));
    const rules = content.PAYMENT_RULES.map((r) => `${r.title} ${r.text}`).join(" ");
    expect(`${duration / 60} phút`).toBe("15 phút");
    expect(rules).toContain(`Gói thuê ${duration / 60} phút`);
    expect(rules).toContain(`Phí ${feeBps / 100}%`);
    expect(rules).toContain(`Chủ máy nhận ${100 - feeBps / 100}%`);
    expect(rules).toContain(`${grace / 60} phút sau khi hết gói`);
    expect(rules).toContain(`${arbitration / 3600} giờ`);
    expect(content.HIGHLIGHTS.map((h) => h.value)).toContain(`${100 - feeBps / 100}%`);
    expect(content.RENTER_STEPS.map((s) => s.text).join(" ")).toContain(`Gói ${duration / 60} phút`);
  });

  it("quy tắc của chủ máy khớp giao diện: cam kết tối thiểu 4 giờ, khung tối thiểu 30 phút theo mốc 15 phút", () => {
    const host = content.HOST_STEPS.map((s) => s.text).join(" ");
    expect(host).toMatch(/tối thiểu 4 giờ/);
    expect(host).toMatch(/tối thiểu 30 phút/);
    expect(host).toMatch(/mốc 15 phút/);
  });

  it("điều khoản có đủ các nhóm cần có và nói rõ giới hạn của bản thử nghiệm", () => {
    const titles = content.TERMS.map((g) => g.title);
    for (const t of ["Phạm vi", "Tài khoản và ví", "Khi thuê máy", "Khi cho thuê máy", "Dữ liệu ứng dụng lưu", "Tạm khóa", "Giới hạn của bản thử nghiệm"]) expect(titles).toContain(t);
    const all = content.TERMS.flatMap((g) => g.items).join(" ");
    expect(all).toMatch(/không có giá trị tiền/);
    expect(all).toMatch(/công khai trên chuỗi khối/);
    expect(all).toMatch(/quản trị viên không lấy được/i);
    // Không hứa điều sản phẩm không có căn cứ.
    expect(all).not.toMatch(/bảo mật tuyệt đối|đảm bảo an toàn|cam kết hoạt động 24\/7|bồi thường|hoàn tiền 100%/i);
  });

  it("quy tắc tranh chấp nói thật: nút mở tranh chấp trong app đang được hoàn thiện", () => {
    const dispute = content.PAYMENT_RULES.find((r) => r.icon === "scale");
    expect(dispute?.text).toMatch(/đang được hoàn thiện/);
  });
});

describe("giao diện Giới thiệu", () => {
  it("các tab nội dung render đủ mục", () => {
    const overview = html(<OverviewTab />);
    expect(overview).toContain("Mục đích");
    expect(overview).toContain("Dành cho ai");
    expect(overview).toContain("Người thuê");
    expect(overview).toContain("Chủ máy");
    expect(overview).toContain('data-testid="about-highlights"');
    const how = html(<HowTab />);
    expect(how).toContain("Khi bạn thuê máy");
    expect(how).toContain("Khi bạn cho thuê máy");
    expect((how.match(/<li /g) ?? []).length).toBe(content.RENTER_STEPS.length + content.HOST_STEPS.length);
    const pay = html(<PaymentTab />);
    expect(pay).toContain('data-testid="money-flow"');
    for (const r of content.PAYMENT_RULES) expect(pay).toContain(r.title);
    const terms = html(<TermsTab />);
    expect(terms).toContain("Điều khoản sử dụng bản thử nghiệm");
    for (const g of content.TERMS) expect(terms).toContain(g.title);
  });

  it("bản xem trước: hiện dải Dữ liệu mẫu, có 4 tab nội dung và không có tab Mạng & hợp đồng", () => {
    const s = html(<About />);
    expect(s).toContain("Dữ liệu mẫu");
    for (const t of ["Tổng quan", "Cách hoạt động", "Thanh toán", "Điều khoản"]) expect(s).toContain(t);
    expect(s).not.toContain("Mạng &amp; hợp đồng");
    expect(s).not.toContain("Snowtrace");
  });

  it("không dùng neo #… (router theo hash): mọi liên kết trong trang là liên kết ngoài", () => {
    const s = [html(<OverviewTab />), html(<HowTab />), html(<PaymentTab />), html(<TermsTab />)].join("");
    expect(s).not.toMatch(/href="#/);
  });
});

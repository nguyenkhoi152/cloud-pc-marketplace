// @vitest-environment node
/**
 * Khung đăng nhập: panel trái mang hình ảnh + lợi ích; phần phải là thẻ biểu mẫu.
 * Giữ các ràng buộc khó thấy bằng mắt: minh họa chỉ trang trí (aria-hidden), panel trái không có phần tử bấm được
 * (vòng focus xanh mặc định rất khó thấy trên nền navy), ô giới thiệu vai trò không giống nút bấm.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChooseMode, Login, Recover, Register, Welcome } from "./Auth";

const html = (el: React.ReactElement) => renderToString(el);
const aside = (s: string) => /<aside[\s\S]*?<\/aside>/.exec(s)?.[0] ?? "";

describe("khung màn đăng nhập", () => {
  it("mọi màn đều có panel trái với minh họa ẩn khỏi trình đọc màn hình và ba lợi ích", () => {
    for (const C of [Welcome, Login, Register, Recover, ChooseMode]) {
      const a = aside(html(<C />));
      expect(a).toContain('data-testid="auth-illustration"');
      expect(a).toMatch(/<svg[^>]*aria-hidden/);
      expect(a).toContain("PCP nằm trong hợp đồng giữ tiền");
      expect(a).toContain("Hủy trước khi kích hoạt, hoàn đủ");
      expect(a).toContain("Màn hình máy thuê hiện ngay trong app");
    }
  });

  it("panel trái không có phần tử bấm được hay focus được", () => {
    for (const C of [Welcome, Login, Register, Recover, ChooseMode]) {
      expect(aside(html(<C />))).not.toMatch(/<(a|button|input|select|textarea)\b|tabindex=/i);
    }
  });

  it("minh họa không chứa chữ nào ngoài nhãn PCP", () => {
    const svg = /<svg[^>]*data-testid="auth-illustration"[\s\S]*?<\/svg>/.exec(aside(html(<Welcome />)))?.[0] ?? "";
    expect(svg.length).toBeGreaterThan(500);
    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(texts).toEqual(["PCP"]);
  });

  it("Chào mừng: hai ô vai trò chỉ để đọc, nút hành động vẫn là Đăng nhập / Tạo tài khoản", () => {
    const s = html(<Welcome />);
    // Từ ô vai trò đến hết <main> (hai ô là phần tử cuối của cột phải).
    const tiles = s.slice(s.indexOf('data-testid="role-tiles"'), s.indexOf("</main>"));
    expect(tiles.length).toBeGreaterThan(100);
    expect(tiles).toContain("Thuê máy");
    expect(tiles).toContain("Cho thuê máy");
    expect(tiles).not.toMatch(/<(a|button)\b/);
    expect(s).toContain("Đăng nhập");
    expect(s).toContain("Tạo tài khoản");
  });

  it("Xin chào: không còn câu 'không tự cấp quyền host' (host tự đăng ký, không cần duyệt)", () => {
    expect(html(<ChooseMode />)).not.toContain("không tự cấp quyền host");
  });

  it("nửa phải: nền trang trí ẩn khỏi trình đọc màn hình, mỗi thẻ có biểu tượng và thanh nhấn", () => {
    for (const C of [Welcome, Login, Register, Recover, ChooseMode]) {
      const s = html(<C />);
      expect(s).toMatch(/data-testid="auth-backdrop"[^>]*aria-hidden|aria-hidden[^>]*data-testid="auth-backdrop"/);
      expect(s).toContain("bg-teal-tint text-teal-ink"); // huy hiệu biểu tượng cạnh tiêu đề
      expect(s).toContain("h-1.5 bg-teal"); // thanh nhấn trên cùng của thẻ
    }
  });

  it("hàng thông tin dưới thẻ chỉ nêu điều có thật ở màn Giới thiệu, và có mặt ở các màn biểu mẫu", () => {
    for (const C of [Login, Register, Recover, ChooseMode]) {
      const s = html(<C />);
      expect(s).toContain("Desktop Linux riêng cho mỗi phiên");
      expect(s).toContain("Dữ liệu trong máy thuê bị xóa khi phiên kết thúc");
      expect(s).toContain("Chủ máy tự đặt lịch nhận thuê");
    }
  });

  it("Đăng nhập/Đăng ký: nút hiện mật khẩu là type=button (không gửi form) và có nhãn truy cập", () => {
    for (const C of [Login, Register]) {
      const s = html(<C />);
      expect(s).toMatch(/<button[^>]*type="button"[^>]*aria-label="Hiện mật khẩu"[^>]*aria-pressed="false"|<button[^>]*aria-label="Hiện mật khẩu"[^>]*type="button"/);
      expect(s).toMatch(/type="password"/);
    }
  });

  it("liên kết chuyển Đăng nhập ⇄ Đăng ký nằm dưới thẻ, mỗi màn chỉ có một", () => {
    // Link render thành href="#/đường-dẫn" (router theo hash).
    expect((html(<Login />).match(/href="#\/register"/g) ?? []).length).toBe(1);
    expect((html(<Register />).match(/href="#\/login"/g) ?? []).length).toBe(1);
  });

  it("Xin chào: hai lựa chọn là nút thật, có mũi tên", () => {
    const s = html(<ChooseMode />);
    // Chỉ đếm trong <main>: bản xem trước còn có bảng kịch bản demo cố định ngoài vùng này.
    const main = /<main[\s\S]*<\/main>/.exec(s)?.[0] ?? "";
    expect((main.match(/<button[^>]*type="button"/g) ?? []).length).toBe(2);
    expect(s).toContain("Thuê máy");
    expect(s).toContain("Cho thuê máy");
  });

  it("giữ các id ô nhập mà script kiểm tra trình duyệt dựa vào", () => {
    expect(html(<Login />)).toMatch(/id="email"[\s\S]*id="pw"/);
    expect(html(<Register />)).toMatch(/id="name"[\s\S]*id="remail"[\s\S]*id="rpw"/);
    expect(html(<Recover />)).toContain('id="qemail"');
  });
});

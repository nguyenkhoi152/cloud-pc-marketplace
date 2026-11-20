// @vitest-environment node
import { Coins } from "lucide-react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { iconForPath } from "@/layout/nav";
import { PageHeader, Section, StatTile } from "./page";

describe("huy hiệu biểu tượng ở đầu trang", () => {
  it("lấy theo mục điều hướng khớp đường dẫn, kể cả màn con", () => {
    expect(iconForPath("/about")).toBeDefined();
    expect(iconForPath("/rent/machine/abc")).toBe(iconForPath("/rent/discover"));
    expect(iconForPath("/host/earnings?x=1")).toBeDefined();
    expect(iconForPath("/admin")).toBeDefined();
    expect(iconForPath("/khong-co")).toBeUndefined();
  });
  it("`icon` truyền vào được ưu tiên; không có đường dẫn khớp thì không hiện huy hiệu", () => {
    expect(renderToString(<PageHeader title="Thu nhập" icon={Coins} />)).toContain('data-testid="page-icon"');
    // Render phía server: usePath trả "/welcome", không thuộc mục nào.
    expect(renderToString(<PageHeader title="Chào" />)).not.toContain('data-testid="page-icon"');
  });
  it("huy hiệu ẩn khỏi trình đọc màn hình; tiêu đề vẫn là h1", () => {
    const s = renderToString(<PageHeader title="Thu nhập" icon={Coins} />);
    expect(s).toMatch(/aria-hidden="true"[^>]*data-testid="page-icon"|data-testid="page-icon"[^>]*aria-hidden="true"/);
    expect(s).toContain("<h1");
  });
});

describe("StatTile", () => {
  it("hiện nhãn, giá trị, ghi chú và xếp tầng theo index", () => {
    const s = renderToString(<StatTile label="Đã nhận" value="12 PCP" hint="Cập nhật khi phiên hoàn tất" icon={Coins} index={3} />);
    expect(s).toContain("Đã nhận");
    expect(s).toContain("12 PCP");
    expect(s).toContain("Cập nhật khi phiên hoàn tất");
    expect(s).toContain("--i:3");
    expect(s).toContain("enter");
  });
});

describe("Section", () => {
  it("bordered bo góc lớn và có bóng nhẹ", () => {
    const s = renderToString(<Section title="Tổng quan" bordered>x</Section>);
    expect(s).toContain("rounded-xl");
  });
});

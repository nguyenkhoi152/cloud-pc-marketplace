import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StepView } from "@/domain/sessionSteps";
import { StepList } from "@/ui/steps";
import { UpcomingWindows, WeeklySchedulePanel } from "./WeeklySchedulePanel";

const steps: StepView[] = [
  { key: "reserve", label: "Giữ máy", state: "done" },
  { key: "pay", label: "Trả tiền", state: "current" },
  { key: "prepare", label: "Chuẩn bị máy", state: "todo" },
  { key: "activate", label: "Kích hoạt", state: "failed" },
  { key: "use", label: "Dùng máy", state: "skipped" },
];

describe("StepList (tiến trình phiên dạng danh sách dọc)", () => {
  const html = renderToStaticMarkup(<StepList steps={steps} />);
  it("mỗi bước có nhãn, trạng thái cho trình đọc màn hình và thuộc tính để kiểm thử", () => {
    expect(html).toContain('data-testid="session-steps"');
    expect(html).toContain('data-step="pay" data-state="current"');
    expect(html).toContain("Giữ máy");
    for (const t of ["đã xong", "đang diễn ra", "chưa tới", "gặp sự cố", "không diễn ra"]) expect(html).toContain(t);
  });
  it("chỉ bước đang diễn ra có aria-current=step", () => {
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1);
  });
  it("bước bị bỏ qua bị gạch, bước lỗi tô đỏ", () => {
    expect(html).toMatch(/line-through[^>]*>\s*Dùng máy/);
    expect(html).toMatch(/text-danger[^>]*>\s*Kích hoạt/);
  });
});

describe("UpcomingWindows (7 ngày tới theo lịch đã lưu)", () => {
  // 2026-11-21 là Thứ Bảy. 02:00Z = 09:00 giờ Việt Nam.
  const windows = [
    { day: "2026-11-21", startsAt: "2026-11-21T02:00:00Z", endsAt: "2026-11-21T05:00:00Z" },
    { day: "2026-11-23", startsAt: "2026-11-23T12:00:00Z", endsAt: "2026-11-23T16:00:00Z" },
  ];
  const html = renderToStaticMarkup(<UpcomingWindows windows={windows} today="2026-11-21" />);
  it("hiện đủ 7 ngày, hôm nay ghi 'Hôm nay', ngày không có khung ghi 'Không cung cấp'", () => {
    expect((html.match(/<li /g) ?? []).length).toBe(7);
    expect(html).toContain("Hôm nay");
    expect((html.match(/Không cung cấp/g) ?? []).length).toBe(5);
  });
  it("giờ hiển thị theo giờ Việt Nam (GMT+7)", () => {
    expect(html).toContain("09:00–12:00");
    expect(html).toContain("19:00–23:00");
    expect(html).toContain("GMT+7");
  });
});

describe("WeeklySchedulePanel", () => {
  const rules = [
    { id: "a", weekday: 0, startMinute: 1140, endMinute: 1380 },
    { id: "b", weekday: 5, startMinute: 600, endMinute: 1440 },
  ];
  const html = renderToStaticMarkup(<WeeklySchedulePanel machineId="m1" rules={rules} windows={[]} today="2026-11-21" onSaved={() => {}} />);
  it("nạp lịch đã lưu vào bảng 7 ngày (giờ bắt đầu và kết thúc đúng, nửa đêm là 00:00)", () => {
    expect(html).toContain('value="19:00"');
    expect(html).toContain('value="23:00"');
    expect(html).toContain('value="10:00"');
    expect(html).toContain('value="00:00"');
    for (const d of ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"]) expect(html).toContain(d);
  });
  it("chưa sửa gì thì không cho lưu hay hoàn tác, và không báo có thay đổi chưa lưu", () => {
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*(<svg[^>]*>.*?<\/svg>)?\s*Lưu lịch/s);
    expect(html).not.toContain("Có thay đổi chưa lưu");
    expect(html).not.toContain("Sửa các lỗi màu đỏ");
  });
  it("tổng giờ mỗi tuần tính cả khung đến nửa đêm (Thứ Hai 19:00–23:00 = 4 giờ, Thứ Bảy 10:00–00:00 = 14 giờ, tổng 18 giờ)", () => {
    expect(html).toContain("<b class=\"num\">18</b>");
  });
});

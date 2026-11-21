import { describe, expect, it } from "vitest";
import { parseEndHM, parseHM } from "./clock";
import { diffRules, hasScheduleChanges, rulesToWeekly, weeklyToRules, type RuleRow } from "./liveSchedule";
import { totalWeeklyMinutes, validateRanges } from "./schedule";

const r = (id: string, weekday: number, startMinute: number, endMinute: number): RuleRow => ({ id, weekday, startMinute, endMinute });

describe("giờ kết thúc nửa đêm", () => {
  it("'00:00' làm giờ kết thúc nghĩa là hết ngày (1440), còn giờ bắt đầu vẫn là 0", () => {
    expect(parseEndHM("00:00")).toBe(1440);
    expect(parseHM("00:00")).toBe(0);
    expect(parseEndHM("23:45")).toBe(1425);
    expect(parseEndHM("sai")).toBeNull();
  });
  it("khung 19:00–00:00 hợp lệ (đến nửa đêm), tính đủ 5 giờ; 00:00–00:00 là cả ngày", () => {
    expect(validateRanges([{ start: "19:00", end: "00:00" }])).toEqual([]);
    expect(totalWeeklyMinutes([[{ start: "19:00", end: "00:00" }], [], [], [], [], [], []])).toBe(300);
    expect(validateRanges([{ start: "00:00", end: "00:00" }])).toEqual([]);
  });
  it("vẫn báo lỗi khi đúng là sai: kết thúc không sau bắt đầu, dưới 30 phút, không đúng mốc 15", () => {
    expect(validateRanges([{ start: "10:00", end: "09:00" }]).map((x) => x.code)).toEqual(["start_not_before_end"]);
    expect(validateRanges([{ start: "23:45", end: "00:00" }]).map((x) => x.code)).toEqual(["too_short"]);
    expect(validateRanges([{ start: "10:05", end: "12:00" }]).map((x) => x.code)).toEqual(["not_quarter"]);
  });
});

describe("rulesToWeekly / weeklyToRules", () => {
  it("xếp theo ngày (0 = Thứ Hai) và theo giờ bắt đầu; khung đến 1440 hiện là 00:00", () => {
    const w = rulesToWeekly([r("a", 2, 1140, 1440), r("b", 0, 1140, 1380), r("c", 0, 540, 660)]);
    expect(w[0]).toEqual([{ start: "09:00", end: "11:00" }, { start: "19:00", end: "23:00" }]);
    expect(w[2]).toEqual([{ start: "19:00", end: "00:00" }]);
    expect(w[1]).toEqual([]);
    expect(w).toHaveLength(7);
  });
  it("bỏ dòng có ngày ngoài 0–6", () => {
    const w = rulesToWeekly([r("x", 9, 60, 120), r("y", -1, 60, 120)]);
    expect(w.flat()).toEqual([]);
  });
  it("đi một vòng không đổi gì: dòng → bảng lịch → dòng", () => {
    const rows = [r("a", 0, 540, 660), r("b", 0, 1140, 1380), r("c", 6, 600, 1440)];
    const back = weeklyToRules(rulesToWeekly(rows));
    expect(back.map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute }))).toEqual([
      { weekday: 0, startMinute: 540, endMinute: 660 },
      { weekday: 0, startMinute: 1140, endMinute: 1380 },
      { weekday: 6, startMinute: 600, endMinute: 1440 },
    ]);
  });
});

describe("diffRules", () => {
  const cur = [r("a", 0, 540, 660), r("b", 0, 1140, 1380), r("c", 6, 600, 1440)];
  it("không đổi gì thì không xóa, không thêm", () => {
    const d = diffRules(cur, rulesToWeekly(cur));
    expect(d).toEqual({ remove: [], add: [] });
    expect(hasScheduleChanges(cur, rulesToWeekly(cur))).toBe(false);
  });
  it("sửa một khung: xóa đúng khung cũ, thêm khung mới, các khung khác giữ nguyên", () => {
    const w = rulesToWeekly(cur);
    w[0] = [{ start: "09:00", end: "11:00" }, { start: "19:00", end: "22:00" }];
    const d = diffRules(cur, w);
    expect(d.remove).toEqual(["b"]);
    expect(d.add).toEqual([{ weekday: 0, startMinute: 1140, endMinute: 1320 }]);
  });
  it("xóa hết một ngày và thêm khung ở ngày khác", () => {
    const w = rulesToWeekly(cur);
    w[6] = [];
    w[3] = [{ start: "20:00", end: "23:00" }];
    const d = diffRules(cur, w);
    expect(d.remove).toEqual(["c"]);
    expect(d.add).toEqual([{ weekday: 3, startMinute: 1200, endMinute: 1380 }]);
  });
  it("bảng lịch trống thì xóa hết", () => {
    const d = diffRules(cur, [[], [], [], [], [], [], []]);
    expect(d.remove.sort()).toEqual(["a", "b", "c"]);
    expect(d.add).toEqual([]);
  });
  it("hai dòng trùng nhau trong CSDL: chỉ giữ số lượng bảng lịch yêu cầu", () => {
    const dup = [r("p", 1, 600, 720), r("q", 1, 600, 720)];
    const w = rulesToWeekly([r("p", 1, 600, 720)]);
    const d = diffRules(dup, w);
    expect(d.remove).toEqual(["q"]);
    expect(d.add).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { switchMode, receiveGate } from "./access";
import { checkCompatibility } from "./compat";
import { DEFAULT_FILTERS, filterMachines } from "./filters";
import { checkDuration, maxBookableMinutes, quote } from "./pricing";
import { effectiveRanges, isInsideOfferWindow, upcomingWindows, validateRanges } from "./schedule";
import { machineAfter, newSession, sessionReducer, settle, type SessionEvent, type SessionState } from "./session";
import type { Account, HostProfile, Machine, Wallet } from "./types";
import { addTransaction, releaseHeld } from "./wallet";
import { emptyWeek } from "./schedule";

const machine = (over: Partial<Machine> = {}): Machine => ({
  id: "m",
  name: "Máy thử",
  hostAlias: "h",
  categories: ["game"],
  location: "Hà Nội",
  cpu: "cpu",
  cores: 8,
  ramGb: 32,
  gpu: "GPU",
  vramGb: 12,
  storageGb: 200,
  networkMbps: 100,
  pricePer15: 20,
  workspace: true,
  state: "available",
  apps: [],
  windows: [{ date: "2026-11-09", start: "19:00", end: "22:00" }], // demo now = 20:10 → còn 110 phút
  summary: "",
  ...over,
});

const run = (s: SessionState, ...events: SessionEvent[]) => events.reduce(sessionReducer, s);
const base = () =>
  newSession({ id: "s", machineId: "m", machineName: "M", hostAlias: "h", pricePer15: 20, durationMin: 60, workspaceMode: "save" });
const toActive = (s: SessionState) =>
  run(s, { type: "PREPARE_STEP" }, { type: "PREPARE_STEP" }, { type: "PREPARE_STEP" }, { type: "PREPARE_STEP" }, { type: "ENTER" });

describe("đổi chế độ", () => {
  it("không cấp quyền host", () => {
    const a: Account = { name: "A", email: "a@x", mode: "rent", hostApproval: "none" };
    const b = switchMode(a, "host");
    expect(b.mode).toBe("host");
    expect(b.hostApproval).toBe("none");
    expect(receiveGate({ approval: b.hostApproval, agentRunning: true, accepting: true, insideWindow: true, blocked: false, online: true }).ok).toBe(false);
  });
});

describe("thời lượng thuê theo cửa sổ host", () => {
  it("tối đa là phần còn lại của cửa sổ, làm tròn xuống 15 phút", () => {
    expect(maxBookableMinutes(machine())).toBe(105); // 20:10→22:00 = 110 → 105
  });
  it("từ chối thời lượng vượt cửa sổ", () => {
    expect(checkDuration(machine(), 120)).toEqual({ ok: false, reason: "exceeds_window" });
    expect(checkDuration(machine(), 105)).toEqual({ ok: true });
  });
  it("từ chối khi ngoài khung giờ hoặc máy bận", () => {
    expect(checkDuration(machine({ windows: [] }), 15)).toEqual({ ok: false, reason: "outside_window" });
    expect(checkDuration(machine({ state: "busy" }), 15).ok).toBe(false);
  });
  it("giá và phí 10% khớp", () => {
    expect(quote(20, 60)).toMatchObject({ slots: 4, gross: 80, fee: 8, hostNet: 72 });
  });
});

describe("lịch host", () => {
  it("phát hiện giờ không hợp lệ", () => {
    expect(validateRanges([{ start: "22:00", end: "06:00" }])[0]?.code).toBe("start_not_before_end");
    expect(validateRanges([{ start: "19:10", end: "21:00" }])[0]?.code).toBe("not_quarter");
    expect(validateRanges([{ start: "19:00", end: "19:15" }])[0]?.code).toBe("too_short");
    expect(validateRanges([{ start: "xx", end: "21:00" }])[0]?.code).toBe("invalid_time");
  });
  it("phát hiện chồng lấn ở cả hai khung", () => {
    const issues = validateRanges([
      { start: "18:00", end: "21:00" },
      { start: "20:00", end: "23:00" },
    ]);
    expect(issues.map((i) => i.index)).toEqual([0, 1]);
    expect(issues.every((i) => i.code === "overlap")).toBe(true);
  });
  it("khung liền kề không bị coi là chồng lấn", () => {
    expect(validateRanges([{ start: "18:00", end: "20:00" }, { start: "20:00", end: "22:00" }])).toHaveLength(0);
  });
  it("ngoại lệ tạm bỏ ngày thắng lịch tuần", () => {
    const weekly = emptyWeek();
    weekly[0] = [{ start: "19:00", end: "23:00" }]; // Thứ Hai
    expect(isInsideOfferWindow(weekly, [])).toBe(true);
    const ex = [{ id: "e", date: "2026-11-09", kind: "skip" as const }];
    expect(isInsideOfferWindow(weekly, ex)).toBe(false);
    expect(effectiveRanges("2026-11-09", weekly, ex).source).toBe("skip");
    expect(upcomingWindows(weekly, ex, 1)).toHaveLength(0);
    expect(upcomingWindows(weekly, [], 8).map((w) => w.date)).toEqual(["2026-11-09", "2026-11-16"]);
  });
});

describe("vòng đời phiên", () => {
  it("đi đủ chuẩn bị → sẵn sàng → đang dùng → kết thúc → dọn dẹp → hoàn tất", () => {
    let s = base();
    expect(s.phase).toBe("preparing");
    s = run(s, { type: "PREPARE_STEP" }, { type: "PREPARE_STEP" }, { type: "PREPARE_STEP" }, { type: "PREPARE_STEP" });
    expect(s.phase).toBe("ready");
    s = run(s, { type: "ENTER" });
    expect(s.phase).toBe("active");
    s = run(s, { type: "END" });
    expect([s.phase, s.saveStatus]).toEqual(["ending", "saving"]);
    s = run(s, { type: "SAVE_OK" });
    expect(s.phase).toBe("cleaning");
    s = run(s, { type: "CLEANUP_OK" });
    expect(s.phase).toBe("completed");
    expect(machineAfter(s)).toBe("available");
  });
  it("cleanup thất bại KHÔNG đưa máy về sẵn sàng", () => {
    const s = run(toActive(base()), { type: "END" }, { type: "SAVE_OK" }, { type: "CLEANUP_FAIL" });
    expect(s.phase).toBe("cleanup_failed");
    expect(machineAfter(s)).toBe("blocked");
    expect(run(s, { type: "CLEANUP_OK" }).phase).toBe("cleanup_failed"); // không nhảy cóc
    expect(run(s, { type: "ENTER" }).phase).toBe("cleanup_failed");
    expect(run(s, { type: "CLEANUP_RETRY" }).phase).toBe("cleaning");
  });
  it("lưu workspace lỗi chờ người dùng; bỏ qua mới sang dọn dẹp", () => {
    let s = run(toActive(base()), { type: "END" }, { type: "SAVE_FAIL" });
    expect([s.phase, s.saveStatus]).toEqual(["ending", "failed"]);
    s = run(s, { type: "CLEANUP_OK" });
    expect(s.phase).toBe("ending");
    s = run(s, { type: "SAVE_SKIP" });
    expect([s.phase, s.saveStatus]).toEqual(["cleaning", "skipped"]);
  });
  it("không lưu workspace thì vào dọn dẹp ngay", () => {
    const s = run(
      toActive(newSession({ id: "s", machineId: "m", machineName: "M", hostAlias: "h", pricePer15: 20, durationMin: 30, workspaceMode: "none" })),
      { type: "END" },
    );
    expect(s.phase).toBe("cleaning");
  });
  it("mất kết nối ⇄ kết nối lại; hết giờ tự kết thúc", () => {
    let s = run(toActive(base()), { type: "DISCONNECT" });
    expect(s.phase).toBe("reconnecting");
    s = run(s, { type: "RECONNECT_OK" });
    expect(s.phase).toBe("active");
    s = run(s, { type: "TICK", sec: 60 * 60 });
    expect(s.phase).toBe("ending");
  });
  it("chuẩn bị lỗi hoàn đủ tiền, không ghi thu nhập host", () => {
    const s = run(base(), { type: "PREPARE_FAIL", reason: "x" });
    expect(settle(s)).toMatchObject({ charged: 0, refunded: 80, hostStatus: "none" });
  });
  it("kết thúc sớm vẫn trả cả gói (theo MVP/CONTRACT_SPEC); cleanup lỗi giữ thu nhập host", () => {
    let s = run(toActive(base()), { type: "TICK", sec: 16 * 60 }, { type: "END" }, { type: "SAVE_OK" }, { type: "CLEANUP_FAIL" });
    const st = settle(s);
    expect(st).toMatchObject({ billedSlots: 4, charged: 80, refunded: 0, hostNet: 72, hostStatus: "held" });
    s = run(s, { type: "CLEANUP_RETRY" }, { type: "CLEANUP_OK" });
    expect(settle(s).hostStatus).toBe("settled");
  });
});

describe("số dư và thu nhập host", () => {
  it("tách sổ; thu nhập giữ cho tới khi cleanup xong", () => {
    let w: Wallet = { usable: 100, hostSettled: 0, hostHeld: 0, faucetClaimed: true, transactions: [] };
    w = addTransaction(w, { id: "1", at: "", kind: "charge", ledger: "usable", amount: -40, status: "done", label: "" });
    w = addTransaction(w, { id: "2", at: "", kind: "host_earning", ledger: "host", amount: 36, status: "held", label: "", sessionId: "s" });
    expect(w).toMatchObject({ usable: 60, hostSettled: 0, hostHeld: 36 });
    w = releaseHeld(w, "s");
    expect(w).toMatchObject({ usable: 60, hostSettled: 36, hostHeld: 0 });
  });
});

describe("lọc máy", () => {
  const list = [
    machine({ id: "a", name: "Alpha", vramGb: 24, pricePer15: 30, categories: ["game", "graphics"] }),
    machine({ id: "b", name: "Beta", vramGb: 0, gpu: null, pricePer15: 5, categories: ["dev"], workspace: false, location: "TP.HCM" }),
  ];
  it("lọc theo danh mục, VRAM, workspace, vị trí và từ khóa không dấu", () => {
    const f = { ...DEFAULT_FILTERS, category: "all" as const };
    expect(filterMachines(list, { ...f, category: "dev" }).map((m) => m.id)).toEqual(["b"]);
    expect(filterMachines(list, { ...f, minVram: 12 }).map((m) => m.id)).toEqual(["a"]);
    expect(filterMachines(list, { ...f, workspaceOnly: true }).map((m) => m.id)).toEqual(["a"]);
    expect(filterMachines(list, { ...f, location: "TP.HCM" }).map((m) => m.id)).toEqual(["b"]);
    expect(filterMachines(list, { ...f, query: "mảy" }).length).toBe(0);
    expect(filterMachines(list, { ...f, maxPrice: 10 }).map((m) => m.id)).toEqual(["b"]);
  });
});

describe("tương thích host", () => {
  const ok: HostProfile = {
    id: "ok", label: "", cpu: "c", cores: 8, ramGb: 32, gpu: "RTX", vramGb: 8, os: "Windows 11 Pro",
    virtualization: true, wsl: "ready", freeDiskGb: 400, uploadMbps: 50,
  };
  it("đạt / hạn chế (không GPU) / không đạt", () => {
    expect(checkCompatibility(ok).verdict).toBe("eligible");
    expect(checkCompatibility({ ...ok, gpu: null, vramGb: 0 }).verdict).toBe("limited");
    expect(checkCompatibility({ ...ok, ramGb: 8 }).verdict).toBe("ineligible");
    expect(checkCompatibility({ ...ok, virtualization: false }).verdict).toBe("ineligible");
  });
});

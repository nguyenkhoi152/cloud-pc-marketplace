import { describe, expect, it } from "vitest";
import type { SetupStep } from "./hostEnv";
import { WIZARD, wizardItems } from "./hostWizard";

const step = (id: SetupStep["id"], status: SetupStep["status"]): SetupStep => ({ id, title: id, status, detail: "" });
const ALL: SetupStep["id"][] = ["wsl", "distro", "connect", "systemd", "packages", "image", "agent", "network", "enroll", "run"];
const steps = (over: Partial<Record<SetupStep["id"], SetupStep["status"]>> = {}) => ALL.map((id) => step(id, over[id] ?? "ok"));
const states = (s: SetupStep[], ack: boolean) => wizardItems(s, ack).items.map((i) => `${i.id}:${i.state}`);

describe("trình hướng dẫn thiết lập cho thuê", () => {
  it("sáu bước, mỗi bước thật thuộc đúng một nhóm (không sót, không trùng)", () => {
    expect(WIZARD.map((w) => w.id)).toEqual(["intro", "check", "install", "enroll", "share", "run"]);
    const members = WIZARD.flatMap((w) => w.members).sort();
    expect(members).toEqual([...ALL].sort());
  });

  it("chưa có kết quả kiểm tra: chỉ có bước Quyền và trách nhiệm là bước hiện tại, không bước nào xong", () => {
    expect(states([], false)).toEqual(["intro:current", "check:todo", "install:todo", "enroll:todo", "share:todo", "run:todo"]);
    // đã xác nhận quyền nhưng chưa kiểm tra máy: Kiểm tra máy là bước hiện tại, không nhóm nào "xong" khi chưa có bằng chứng
    expect(states([], true)).toEqual(["intro:done", "check:current", "install:todo", "enroll:todo", "share:todo", "run:todo"]);
  });

  it("bước hiện tại là bước đầu tiên chưa xong; các bước sau chưa mở được", () => {
    const w = wizardItems(steps({ packages: "action", image: "action", agent: "blocked", network: "blocked", enroll: "blocked", run: "blocked" }), true);
    expect(w.currentId).toBe("install");
    expect(w.items.map((i) => [i.id, i.reachable])).toEqual([["intro", true], ["check", true], ["install", true], ["enroll", false], ["share", false], ["run", false]]);
  });

  it("một bước con chưa xong thì cả nhóm chưa xong (ví dụ chưa cài Docker dù bản Linux đã sẵn sàng)", () => {
    const s = states(steps({ packages: "action" }), true);
    expect(s).toContain("check:done");
    expect(s).toContain("install:current");
  });

  it("bước 'info' (không áp dụng) và bước vắng mặt (không có systemd) không chặn", () => {
    const s = steps({ wsl: "info" }).filter((x) => x.id !== "systemd");
    expect(states(s, true)[1]).toBe("check:done");
  });

  it("'manual' và 'blocked' vẫn là chưa xong", () => {
    for (const st of ["manual", "blocked", "action"] as const) {
      expect(states(steps({ distro: st }), true)[1], st).toBe("check:current");
    }
  });

  it("Tài nguyên và chia sẻ chỉ là tùy chỉnh: xong ngay khi đã ghi danh xong", () => {
    const s = states(steps({ run: "action" }), true);
    expect(s).toEqual(["intro:done", "check:done", "install:done", "enroll:done", "share:done", "run:current"]);
    expect(states(steps({ enroll: "action", run: "blocked" }), true)).toEqual(["intro:done", "check:done", "install:done", "enroll:current", "share:todo", "run:todo"]);
  });

  it("mọi thứ xong (máy đang nhận thuê): không còn bước hiện tại", () => {
    const w = wizardItems(steps(), true);
    expect(w.currentId).toBeNull();
    expect(w.items.every((i) => i.state === "done" && i.reachable)).toBe(true);
  });

  it("chưa xác nhận quyền và trách nhiệm thì chưa mở được bước nào sau đó, kể cả khi máy đã sẵn sàng", () => {
    const w = wizardItems(steps(), false);
    expect(w.currentId).toBe("intro");
    expect(w.items.filter((i) => i.reachable).map((i) => i.id)).toEqual(["intro"]);
  });
});

// Guest Docker với bộ chạy lệnh GIẢ (không phải docker thật). Bằng chứng với docker/Selkies thật nằm ở scripts/vm/.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DockerSelkiesGuest, sshDockerRunner, type GuestRunner } from "./dockerGuest";

const ID1 = "a".repeat(64), ID2 = "b".repeat(64);
interface Box { id: string; running: boolean; health: string }
let dir: string;
let box: Box | null;
let calls: string[][];
let nextId: string;
let failMode: "none" | "timeout" | "inspect-error" | "run-fails";
let upstreamStatus: number;

const runner: GuestRunner = {
  async docker(args) {
    calls.push(args);
    if (failMode === "timeout") throw new Error("hết giờ");
    const [cmd] = args;
    if (cmd === "inspect") {
      if (failMode === "inspect-error") return { code: 125, stdout: "", stderr: "Cannot connect to the Docker daemon" };
      if (!box) return { code: 1, stdout: "", stderr: "Error: No such object: selkies" };
      return { code: 0, stdout: `${box.id}|${box.running}|${box.health}\n`, stderr: "" };
    }
    if (cmd === "rm") { box = null; return { code: 0, stdout: "selkies", stderr: "" }; }
    if (cmd === "run") {
      if (failMode === "run-fails") return { code: 125, stdout: "", stderr: "boom" };
      box = { id: nextId, running: true, health: "starting" };
      return { code: 0, stdout: nextId, stderr: "" };
    }
    return { code: 2, stdout: "", stderr: "lệnh lạ" };
  },
};
const fetchImpl = (async () => new Response("x", { status: upstreamStatus })) as unknown as typeof fetch;
const mk = (extra: Partial<ConstructorParameters<typeof DockerSelkiesGuest>[0]> = {}) =>
  new DockerSelkiesGuest({ runner, stateDir: dir, image: "ghcr.io/selkies-project/selkies/desktop@sha256:" + "c".repeat(64), upstreamUrl: "http://127.0.0.1:18080/", fetchImpl, ...extra });

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "cpm-guest-"));
  box = { id: ID1, running: true, health: "healthy" };
  calls = [];
  nextId = ID2;
  failMode = "none";
  upstreamStatus = 200;
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("prepare", () => {
  it("ok khi container healthy và upstream trả 200", async () => {
    expect(await mk().prepare()).toMatchObject({ ok: true });
  });
  it("không tồn tại / không chạy ⇒ không (không phải unknown); chưa healthy / upstream lỗi ⇒ unknown", async () => {
    const definitelyNot = async () => { const r = await mk().prepare(); expect(r.ok).toBe(false); expect(r.unknown).toBeFalsy(); };
    box = null;
    await definitelyNot();
    box = { id: ID1, running: false, health: "none" };
    await definitelyNot();
    box = { id: ID1, running: true, health: "starting" };
    expect(await mk().prepare()).toMatchObject({ ok: false, unknown: true });
    box = { id: ID1, running: true, health: "healthy" };
    upstreamStatus = 502;
    expect(await mk().prepare()).toMatchObject({ ok: false, unknown: true });
  });
  it("hết giờ hoặc docker lỗi ⇒ Unknown, KHÔNG BAO GIỜ ok", async () => {
    failMode = "timeout";
    expect(await mk().prepare()).toMatchObject({ ok: false, unknown: true });
    failMode = "inspect-error";
    expect(await mk().prepare()).toMatchObject({ ok: false, unknown: true });
  });
});

describe("reset + verifyReset", () => {
  it("tạo lại container từ image đã có (--pull=never), rồi chỉ được coi là đã reset khi container MỚI healthy và upstream 200", async () => {
    const g = mk();
    expect(await g.reset()).toMatchObject({ ok: true });
    const run = calls.find((c) => c[0] === "run")!;
    expect(run).toContain("--pull=never");
    expect(run[run.length - 1]).toMatch(/@sha256:c{64}$/);
    expect(calls.find((c) => c[0] === "rm")).toEqual(["rm", "-f", "selkies"]);
    // vừa tạo: chưa healthy ⇒ chưa xác minh được (unknown), chưa thành công
    expect(await g.verifyReset()).toMatchObject({ ok: false, unknown: true });
    box!.health = "healthy";
    const v = await g.verifyReset();
    expect(v).toMatchObject({ ok: true });
    expect(v.evidence).toContain(ID2.slice(0, 12));
  });
  it("verifyReset từ chối khi container vẫn là bản cũ, bị thay sau reset, hoặc không có reset nào", async () => {
    const g = mk();
    await g.reset();
    box = { id: ID1, running: true, health: "healthy" }; // quay về id cũ
    expect(await g.verifyReset()).toMatchObject({ ok: false });
    box = { id: "d".repeat(64), running: true, health: "healthy" }; // id lạ, không phải do reset tạo
    expect(await g.verifyReset()).toMatchObject({ ok: false });
    // chưa từng reset: không có trạng thái ⇒ không thể xác nhận
    const fresh = await mkdtemp(path.join(os.tmpdir(), "cpm-guest2-"));
    try {
      expect(await new DockerSelkiesGuest({ runner, stateDir: fresh, image: "img:tag", upstreamUrl: "http://x/", fetchImpl }).verifyReset()).toMatchObject({ ok: false });
    } finally { await rm(fresh, { recursive: true, force: true }); }
  });
  it("trạng thái bền qua tiến trình mới: verify ở instance khác vẫn đúng", async () => {
    await mk().reset();
    box!.health = "healthy";
    expect(await mk().verifyReset()).toMatchObject({ ok: true });
  });
  it("docker run lỗi hoặc hết giờ ⇒ Unknown; container không tồn tại sau reset ⇒ không", async () => {
    failMode = "run-fails";
    expect(await mk().reset()).toMatchObject({ ok: false, unknown: true });
    failMode = "timeout";
    expect(await mk().reset()).toMatchObject({ ok: false, unknown: true });
    failMode = "none";
    box = null;
    expect(await mk().verifyReset()).toMatchObject({ ok: false });
  });
});

describe("ensureReady (agent khởi động) + cleanup (host dừng cung cấp)", () => {
  it("chưa có container ⇒ tạo mới từ image đã có; publish chỉ ở loopback khi cấu hình; không có --gpus khi không bật", async () => {
    box = null;
    const g = mk({ publishAddr: "127.0.0.1", hostPort: 8080 });
    expect(await g.ensureReady()).toMatchObject({ ok: true });
    const run = calls.find((c) => c[0] === "run")!;
    expect(run).toContain("--pull=never");
    expect(run[run.indexOf("-p") + 1]).toBe("127.0.0.1:8080:8080");
    expect(run).not.toContain("--gpus");
    expect(box).toMatchObject({ id: ID2 });
  });
  it("container lạ (không do agent này tạo) hoặc đã dừng ⇒ KHÔNG dùng lại: xoá và tạo mới", async () => {
    // box mặc định là ID1 nhưng chưa có trạng thái nào được lưu ⇒ nguồn gốc không rõ
    expect(await mk().ensureReady()).toMatchObject({ ok: true });
    expect(calls.map((c) => c[0])).toEqual(["inspect", "rm", "run", "inspect"]);
    expect(box!.id).toBe(ID2);
    // đúng container của mình nhưng đã dừng ⇒ cũng tạo lại
    box!.running = false;
    nextId = "e".repeat(64);
    calls = [];
    expect(await mk().ensureReady()).toMatchObject({ ok: true });
    expect(box!.id).toBe("e".repeat(64));
  });
  it("đúng container do agent tạo và đang chạy ⇒ giữ nguyên (không xoá); sau đó verifyReset vẫn nhận nó là bản sạch", async () => {
    box = null;
    await mk().ensureReady();
    calls = [];
    expect(await mk().ensureReady()).toMatchObject({ ok: true, evidence: expect.stringContaining("giữ container") });
    expect(calls.map((c) => c[0])).toEqual(["inspect"]);
    box!.health = "healthy";
    expect(await mk().verifyReset()).toMatchObject({ ok: true });
  });
  it("docker lỗi/hết giờ khi khởi tạo ⇒ Unknown, không bao giờ ok", async () => {
    box = null;
    failMode = "run-fails";
    expect(await mk().ensureReady()).toMatchObject({ ok: false, unknown: true });
    failMode = "timeout";
    expect(await mk().ensureReady()).toMatchObject({ ok: false, unknown: true });
  });
  it("cleanup xoá container; không có sẵn cũng là đã dọn; lỗi ⇒ Unknown", async () => {
    expect(await mk().cleanup()).toMatchObject({ ok: true });
    expect(box).toBeNull();
    expect(calls.find((c) => c[0] === "rm")).toEqual(["rm", "-f", "selkies"]);
    expect(await mk().cleanup()).toMatchObject({ ok: true });
    failMode = "timeout";
    expect(await mk().cleanup()).toMatchObject({ ok: false, unknown: true });
  });
  it("sau cleanup rồi khởi động lại: container mới được coi là bản sạch (khác bản người thuê đã dùng)", async () => {
    const g = mk();
    await g.ensureReady(); // ID1 lạ → ID2
    await g.cleanup();
    nextId = "f".repeat(64);
    await mk().ensureReady();
    box!.health = "healthy";
    const v = await mk().verifyReset();
    expect(v).toMatchObject({ ok: true });
    expect(v.evidence).toContain("f".repeat(12));
  });
  it("gpus=all thêm đúng `--gpus all` (chỉ kiểm tham số; chưa phải bằng chứng GPU thật)", async () => {
    box = null;
    await mk({ gpus: "all" }).ensureReady();
    const run = calls.find((c) => c[0] === "run")!;
    expect(run.slice(run.indexOf("--gpus"), run.indexOf("--gpus") + 2)).toEqual(["--gpus", "all"]);
  });
  it("giới hạn RAM/CPU: --memory và --memory-swap bằng nhau (không tràn sang swap của host), --cpus đúng giá trị; không đặt thì không có cờ nào", async () => {
    box = null;
    await mk({ memoryMb: 4096, cpus: 2 }).ensureReady();
    const run = calls.find((c) => c[0] === "run")!;
    expect(run).toContain("--memory=4096m");
    expect(run).toContain("--memory-swap=4096m");
    expect(run).toContain("--cpus=2");
    expect(run.indexOf("--cpus=2")).toBeLessThan(run.indexOf("-p")); // nằm trước cờ publish, trước image
    box = null;
    calls.length = 0;
    await mk().ensureReady();
    const plain = calls.find((c) => c[0] === "run")!;
    expect(plain.some((a) => a.startsWith("--memory") || a.startsWith("--cpus"))).toBe(false);
  });
});

describe("kiểm dạng đầu vào", () => {
  it("giới hạn RAM/CPU sai bị từ chối (dưới mức Selkies chạy được, vượt trần, không nguyên, kiểu lạ)", () => {
    for (const memoryMb of [0, 512, 1023, 262145, 4096.5, Number.NaN, -1]) expect(() => mk({ memoryMb }), String(memoryMb)).toThrow();
    for (const cpus of [0, 129, 1.5, Number.NaN, -2]) expect(() => mk({ cpus }), String(cpus)).toThrow();
    expect(() => mk({ memoryMb: 1024, cpus: 1 })).not.toThrow();
    expect(() => mk({ memoryMb: 262144, cpus: 128 })).not.toThrow();
  });
  it("tên container, image, cổng, ssh target sai bị từ chối (không có đường chèn lệnh)", () => {
    expect(() => mk({ container: "x; rm -rf /" })).toThrow();
    expect(() => mk({ container: "UPPER" })).toThrow();
    expect(() => mk({ image: "img --privileged" })).toThrow();
    expect(() => mk({ image: "img$(id)" })).toThrow();
    expect(() => mk({ hostPort: 70000 })).toThrow();
    expect(() => mk({ publishAddr: "127.0.0.1 --privileged" })).toThrow();
    expect(() => mk({ publishAddr: "999.0.0.1" })).toThrow();
    expect(() => mk({ gpus: "device=0" as "all" })).toThrow();
    expect(() => sshDockerRunner({ target: "a@b;rm", keyFile: "k", knownHostsFile: "h" })).toThrow();
    expect(() => sshDockerRunner({ target: "cpm@127.0.0.1", keyFile: "k", knownHostsFile: "h" })).not.toThrow();
  });
});

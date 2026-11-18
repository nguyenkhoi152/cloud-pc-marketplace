/**
 * Kiểm guest Docker THẬT: container Selkies trong VM thử, qua SSH (chỉ demo; xem host-agent/src/dockerGuest.ts).
 * Không dùng Supabase/chuỗi khối. Không tải lại image (--pull=never). Không in khoá/mật khẩu.
 * Chạy:  npx tsx scripts/vm/guest-live-check.mts <secretsDir> <knownHostsFile> [upstream http://127.0.0.1:18080/]
 */
import path from "node:path";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import { DockerSelkiesGuest, sshDockerRunner } from "../../host-agent/src/dockerGuest";

const [secrets, knownHosts, upstream = "http://127.0.0.1:18080/"] = process.argv.slice(2);
if (!secrets || !knownHosts) throw new Error("Dùng: <secretsDir> <knownHostsFile> [upstream]");
const results: boolean[] = [];
const check = (ok: boolean, name: string, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const runner = sshDockerRunner({ target: "cpm@127.0.0.1", port: 2222, keyFile: path.join(secrets, "cpm-test-host.ed25519"), knownHostsFile: knownHosts });
const docker = async (...a: string[]) => runner.docker(a, 120_000);
const digestRes = await docker("image", "inspect", "--format", "{{index .RepoDigests 0}}", "ghcr.io/selkies-project/selkies/desktop:2.2.1-ubuntu26.04");
const image = digestRes.stdout.trim();
check(/^ghcr\.io\/selkies-project\/selkies\/desktop@sha256:[0-9a-f]{64}$/.test(image), "image ghim theo digest (đã có sẵn, không tải lại)", image.replace(/sha256:(.{12}).*/, "sha256:$1…"));

const stateDir = mkdtempSync(path.join(os.tmpdir(), "cpm-guest-live-"));
const guest = new DockerSelkiesGuest({ runner, stateDir, image, upstreamUrl: upstream, log: (m) => console.log("  log:", m) });

const p1 = await guest.prepare();
check(p1.ok, "prepare: Selkies healthy + upstream 200", p1.evidence);
const idBefore = (await docker("inspect", "--format", "{{.Id}}", "selkies")).stdout.trim();
// Mô phỏng dấu vết của người thuê trước: một file trong thư mục home của container. Sau reset phải biến mất.
const mark = await docker("exec", "selkies", "sh", "-c", "echo renter-secret > /home/ubuntu/cpm-renter-file && test -s /home/ubuntu/cpm-renter-file && echo present");
check(mark.stdout.trim() === "present", "tạo dấu vết của người thuê trong container trước reset");
console.log(`INFO  trước reset: id=${idBefore.slice(0, 12)}`);

const t0 = Date.now();
const r = await guest.reset();
check(r.ok, "reset: tạo lại container từ image có sẵn", r.evidence);
let v = await guest.verifyReset();
for (let i = 0; i < 40 && !v.ok && v.unknown; i++) { await sleep(10_000); v = await guest.verifyReset(); }
check(v.ok, "verifyReset: container mới, healthy, upstream 200", `${Math.round((Date.now() - t0) / 1000)}s — ${v.evidence}`);
const idAfter = (await docker("inspect", "--format", "{{.Id}}", "selkies")).stdout.trim();
check(!!idAfter && idAfter !== idBefore, "id container khác trước reset", `${idBefore.slice(0, 12)} → ${idAfter.slice(0, 12)}`);
const gone = await docker("exec", "selkies", "sh", "-c", "test -e /home/ubuntu/cpm-renter-file && echo STILL || echo gone");
check(gone.stdout.trim() === "gone", "dấu vết của người thuê trước đã biến mất sau reset (container mới, không giữ dữ liệu)", gone.stdout.trim());
const pol = (await docker("inspect", "--format", "{{.HostConfig.RestartPolicy.Name}}|{{.HostConfig.ShmSize}}", "selkies")).stdout.trim();
check(pol.startsWith("unless-stopped|"), "container mới giữ chính sách tự khởi động lại", pol);
const p2 = await guest.prepare();
check(p2.ok, "prepare sau reset vẫn ok", p2.evidence);

console.log(`\n${results.filter(Boolean).length}/${results.length} đạt`);
process.exit(results.every(Boolean) ? 0 : 1);

/**
 * Test workspace: Postgres THẬT cục bộ + thư mục tạm thật (LocalFsStore). Không phải S3, không phải host thật.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linkWallet, makeApprovedHost, makeMachine, newUser, renterWithWallet, reserve } from "../../db/tests/harness";
import { asPglite, startRealPg, type RealPg } from "../../db/tests/realpg";
import { ApiError, pgServiceDb, type ApiUser } from "./core";
import { createApiHandler } from "./http";
import {
  acquireLease, commitWorkspace, createWorkspace, deleteWorkspace, gcWorkspace, LocalFsStore, normalizeManifest, putObject, readManifest, readObject, releaseLease, type WsDeps,
} from "./workspace";

let real: RealPg;
let admin: pg.Client;
let pool: pg.Pool;
let dir: string;
let deps: WsDeps;
const A = () => asPglite(admin);
const user = (id: string): ApiUser => ({ id, email: null });
const bytes = (s: string) => new TextEncoder().encode(s);
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const lease = (t: string) => `Lease ${t}`;

beforeAll(async () => {
  const r = await startRealPg();
  if (!r) throw new Error("Không có binary Postgres cục bộ");
  real = r;
  admin = await real.connect();
  pool = new pg.Pool({ host: "127.0.0.1", port: real.port, user: "postgres", database: "postgres", max: 4 });
  dir = mkdtempSync(path.join(os.tmpdir(), "cpm-ws-"));
  const cfg = { supabaseUrl: "https://x.test", anonKey: "k", chainId: 43113, escrow: "0x" + "e5".repeat(20), pcp: "0x" + "c1".repeat(20), treasury: "0x" + "d7".repeat(20), quoteSigner: privateKeyToAccount(generatePrivateKey()), minConfirmations: 2, graceSeconds: 600, arbitrationSeconds: 86_400, configVersion: 1, walletDomain: "a", walletUri: "https://a", allowedOrigins: [] };
  deps = { db: pgServiceDb(pool), cfg, store: new LocalFsStore(dir), maxObjectBytes: 1024 };
}, 120_000);
afterAll(async () => { await pool?.end(); await admin?.end(); await real?.stop(); rmSync(dir, { recursive: true, force: true }); }, 60_000);

const rejects = async (p: Promise<unknown>, status: number, code: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e, `kỳ vọng ${status}/${code}`).toBeInstanceOf(ApiError);
  expect([(e as ApiError).status, (e as ApiError).code]).toEqual([status, code]);
};

/** Booking Active (end_at tương lai) của một renter; trả cả id renter. */
async function activeBooking(renter?: string) {
  const host = await makeApprovedHost(A());
  await linkWallet(A(), host);
  const machine = await makeMachine(A(), host);
  const r = renter ?? (await renterWithWallet(A()));
  const id = (await reserve(A(), r, machine)).id;
  await admin.query("alter table public.bookings disable trigger bookings_guard");
  await admin.query("update public.bookings set state = 'active', access_state = 'granted', started_at = now(), end_at = now() + interval '15 minutes' where id = $1", [id]);
  await admin.query("alter table public.bookings enable trigger bookings_guard");
  return { renter: r, bookingId: id };
}
const newWs = async (renter: string) => ((await createWorkspace(deps, user(renter), { name: "dự án thử" })).body as { id: string }).id;
const getLease = async (renter: string, ws: string, bookingId: string) => ((await acquireLease(deps, user(renter), ws, { bookingId })).body as { leaseToken: string; expiresAt: string });
const upload = (ws: string, tok: string, content: string) => putObject(deps, ws, sha(content), lease(tok), bytes(content));

describe("LocalFsStore", () => {
  it("chống traversal, bất biến, nguyên tử, không để file tạm", async () => {
    const store = new LocalFsStore(dir);
    const ws = "11111111-1111-1111-1111-111111111111";
    const data = bytes("nội dung");
    const key = `${ws}/${sha(data)}`;
    for (const bad of ["../x", `${ws}/../../etc`, `${ws}/${"g".repeat(64)}`, "x/y", `${ws}/${sha(data)}/x`, "/tmp/x"]) await expect(store.put(bad, data)).rejects.toThrow();
    await expect(store.put(`${ws}/${sha("khác")}`, data)).rejects.toThrow(/checksum/); // key không khớp nội dung
    const st = await store.put(key, data);
    expect(st).toEqual({ key, size: data.byteLength, sha256: sha(data) });
    expect((await store.put(key, data)).sha256).toBe(sha(data)); // idempotent
    expect(readdirSync(path.join(dir, ws)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    writeFileSync(path.join(dir, ws, sha(data)), "bị sửa ngoài luồng");
    expect((await store.stat(key))!.sha256).not.toBe(sha(data)); // stat tính lại checksum → phát hiện hỏng
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });
});

describe("manifest", () => {
  const f = (p: string, content = "x") => ({ path: p, sha256: sha(content), size: content.length });
  it("chuẩn hoá, sắp xếp, băm ổn định; từ chối đường dẫn nguy hiểm/trùng/số liệu sai", () => {
    const a = normalizeManifest({ files: [f("b.txt"), f("src/a.ts")] });
    const b = normalizeManifest({ files: [f("src/a.ts"), f("b.txt")] });
    expect(a.sha256).toBe(b.sha256);
    for (const p of ["../x", "/abs", "C:/x", "a\\b", "a/../b", "./a", "a//b", "", "a\u0000b", "x".repeat(300)]) expect(() => normalizeManifest({ files: [f(p)] }), p).toThrow(ApiError);
    expect(() => normalizeManifest({ files: [f("A.txt"), f("a.TXT")] })).toThrow(/Trùng/);
    expect(() => normalizeManifest({ files: [{ path: "a", sha256: "xyz", size: 1 }] })).toThrow(ApiError);
    expect(() => normalizeManifest({ files: [{ path: "a", sha256: sha("x"), size: -1 }] })).toThrow(ApiError);
    expect(() => normalizeManifest({})).toThrow(ApiError);
  });
});

describe("workspace: lease, upload, commit, khôi phục, dọn dẹp", () => {
  it("vòng đời: tạo → lease → tải lên → commit v1 → v2 (đúng expectedVersion) → đọc lại byte y hệt", async () => {
    const { renter, bookingId } = await activeBooking();
    const ws = await newWs(renter);
    const { leaseToken } = await getLease(renter, ws, bookingId);
    await upload(ws, leaseToken, "print('v1')");
    const c1 = await commitWorkspace(deps, ws, lease(leaseToken), { expectedVersion: 0, manifest: { files: [{ path: "main.py", sha256: sha("print('v1')"), size: bytes("print('v1')").length }] } });
    expect(c1.body).toMatchObject({ saved: true, version: 1 });
    await upload(ws, leaseToken, "print('v2')");
    const c2 = await commitWorkspace(deps, ws, lease(leaseToken), { expectedVersion: 1, manifest: { files: [{ path: "main.py", sha256: sha("print('v2')"), size: bytes("print('v2')").length }] } });
    expect(c2.body).toMatchObject({ version: 2 });
    const m = (await readManifest(deps, ws, 1, lease(leaseToken))).body as { manifest: { files: { sha256: string }[] } };
    const got = await readObject(deps, ws, m.manifest.files[0]!.sha256, lease(leaseToken));
    expect(new TextDecoder().decode(got.data)).toBe("print('v1')");
    expect((await admin.query("select latest_version from public.workspaces where id = $1", [ws])).rows[0].latest_version).toBe(2);
  });

  it("commit nguyên tử: thiếu object/kích thước sai/blob hỏng → không có version mới", async () => {
    const { renter, bookingId } = await activeBooking();
    const ws = await newWs(renter);
    const { leaseToken } = await getLease(renter, ws, bookingId);
    await upload(ws, leaseToken, "ok-file");
    const good = { path: "a", sha256: sha("ok-file"), size: 7 };
    await rejects(commitWorkspace(deps, ws, lease(leaseToken), { expectedVersion: 0, manifest: { files: [good, { path: "b", sha256: sha("chua-tai"), size: 8 }] } }), 422, "missing_object");
    await rejects(commitWorkspace(deps, ws, lease(leaseToken), { expectedVersion: 0, manifest: { files: [{ ...good, size: 99 }] } }), 422, "missing_object");
    writeFileSync(path.join(dir, ws, sha("ok-file")), "hỏng"); // blob bị sửa ngoài luồng
    await rejects(commitWorkspace(deps, ws, lease(leaseToken), { expectedVersion: 0, manifest: { files: [good] } }), 422, "missing_object");
    expect((await admin.query("select latest_version, (select count(*)::int from public.workspace_versions v where v.workspace_id = w.id) as n from public.workspaces w where id = $1", [ws])).rows[0]).toEqual({ latest_version: 0, n: 0 });
  });

  it("không last-write-wins: expectedVersion cũ bị từ chối; không nhảy version", async () => {
    const { renter, bookingId } = await activeBooking();
    const ws = await newWs(renter);
    const { leaseToken } = await getLease(renter, ws, bookingId);
    await upload(ws, leaseToken, "A");
    const man = { files: [{ path: "a", sha256: sha("A"), size: 1 }] };
    await commitWorkspace(deps, ws, lease(leaseToken), { expectedVersion: 0, manifest: man });
    await rejects(commitWorkspace(deps, ws, lease(leaseToken), { expectedVersion: 0, manifest: man }), 409, "version_conflict");
    await rejects(commitWorkspace(deps, ws, lease(leaseToken), { expectedVersion: 5, manifest: man }), 409, "version_conflict");
  });

  it("tải lên: checksum sai, quá lớn, thiếu/sai token bị từ chối và không để lại blob; quota vượt thì dọn blob", async () => {
    const { renter, bookingId } = await activeBooking();
    const ws = await newWs(renter);
    const { leaseToken } = await getLease(renter, ws, bookingId);
    await rejects(putObject(deps, ws, sha("A"), lease(leaseToken), bytes("B")), 422, "checksum_mismatch");
    await rejects(putObject(deps, ws, sha("x".repeat(2000)), lease(leaseToken), bytes("x".repeat(2000))), 413, "object_too_large");
    await rejects(putObject(deps, ws, sha("A"), null, bytes("A")), 401, "lease_invalid");
    await rejects(putObject(deps, ws, sha("A"), lease("t".repeat(43)), bytes("A")), 401, "lease_invalid");
    expect(() => readdirSync(path.join(dir, ws))).toThrow(); // chưa có gì được ghi
    await admin.query("update public.workspaces set quota_bytes = 10 where id = $1", [ws]);
    await upload(ws, leaseToken, "123456"); // 6 byte
    await rejects(upload(ws, leaseToken, "abcdefgh"), 413, "quota_exceeded"); // 6 + 8 > 10
    expect(readdirSync(path.join(dir, ws))).toEqual([sha("123456")]); // blob vượt quota đã bị dọn
    expect((await upload(ws, leaseToken, "123456")).status).toBe(200); // upload lại cùng object: idempotent, không tính quota hai lần
  });

  it("một writer: booking khác không lấy được lease khi còn hạn; token cũ vô hiệu khi cấp lại; chủ khác bị cấm", async () => {
    const a = await activeBooking();
    const ws = await newWs(a.renter);
    const first = await getLease(a.renter, ws, a.bookingId);
    const other = await activeBooking(a.renter); // cùng renter, booking khác (máy khác)
    await rejects(acquireLease(deps, user(a.renter), ws, { bookingId: other.bookingId }), 409, "lease_held");
    const renewed = await getLease(a.renter, ws, a.bookingId); // cùng booking: thay token
    await rejects(upload(ws, first.leaseToken, "x"), 401, "lease_invalid");
    expect((await upload(ws, renewed.leaseToken, "x")).status).toBe(201);

    const stranger = await renterWithWallet(A());
    await rejects(acquireLease(deps, user(stranger), ws, { bookingId: a.bookingId }), 403, "forbidden");
    const mine = await activeBooking(stranger);
    await rejects(acquireLease(deps, user(stranger), ws, { bookingId: mine.bookingId }), 403, "forbidden"); // booking của mình nhưng workspace của người khác
    await rejects(acquireLease(deps, user(a.renter), ws, { bookingId: mine.bookingId }), 403, "forbidden"); // workspace của mình nhưng booking của người khác
  });

  it("bàn giao sang host/booking khác: sau khi nhả lease (hoặc hết hạn) booking mới khôi phục đúng nội dung", async () => {
    const a = await activeBooking();
    const ws = await newWs(a.renter);
    const l1 = await getLease(a.renter, ws, a.bookingId);
    await upload(ws, l1.leaseToken, "dữ liệu dự án");
    await commitWorkspace(deps, ws, lease(l1.leaseToken), { expectedVersion: 0, manifest: { files: [{ path: "p.txt", sha256: sha("dữ liệu dự án"), size: bytes("dữ liệu dự án").length }] } });
    const b = await activeBooking(a.renter);
    await rejects(acquireLease(deps, user(a.renter), ws, { bookingId: b.bookingId }), 409, "lease_held");
    expect((await releaseLease(deps, ws, lease(l1.leaseToken))).body).toEqual({ released: true });
    const l2 = await getLease(a.renter, ws, b.bookingId);
    const man = (await readManifest(deps, ws, 1, lease(l2.leaseToken))).body as { manifest: { files: { sha256: string }[] } };
    expect(new TextDecoder().decode((await readObject(deps, ws, man.manifest.files[0]!.sha256, lease(l2.leaseToken))).data)).toBe("dữ liệu dự án");
    await rejects(upload(ws, l1.leaseToken, "ghi lén bằng token cũ"), 401, "lease_invalid");
  });

  it("recovery giới hạn: hạn lease không vượt endAt+600s; hết cửa sổ thì không cấp; booking chưa Active thì không cấp", async () => {
    const a = await activeBooking();
    const ws = await newWs(a.renter);
    const l = await getLease(a.renter, ws, a.bookingId);
    const endMs = (await admin.query("select extract(epoch from end_at) * 1000 as e from public.bookings where id = $1", [a.bookingId])).rows[0].e as number;
    expect(new Date(l.expiresAt).getTime()).toBeLessThanOrEqual(Math.round(endMs) + 600_000 + 5);
    await admin.query("alter table public.bookings disable trigger bookings_guard");
    await admin.query("update public.bookings set end_at = now() - interval '11 minutes' where id = $1", [a.bookingId]);
    await rejects(acquireLease(deps, user(a.renter), ws, { bookingId: a.bookingId }), 410, "recovery_window_closed");
    await admin.query("update public.bookings set state = 'funded' where id = $1", [a.bookingId]);
    await admin.query("alter table public.bookings enable trigger bookings_guard");
    await rejects(acquireLease(deps, user(a.renter), ws, { bookingId: a.bookingId }), 409, "booking_not_active");
  });

  it("lease hết hạn thì mọi thao tác bị chặn; worker thu hồi phiên chấm dứt lease (ws_release_for_booking)", async () => {
    const a = await activeBooking();
    const ws = await newWs(a.renter);
    const l = await getLease(a.renter, ws, a.bookingId);
    await admin.query("update public.workspace_leases set expires_at = now() - interval '1 second' where workspace_id = $1", [ws]);
    await rejects(upload(ws, l.leaseToken, "x"), 401, "lease_invalid");
    const l2 = await getLease(a.renter, ws, a.bookingId);
    expect((await upload(ws, l2.leaseToken, "y")).status).toBe(201);
    await pool.query("begin"); // dùng đúng quyền service_role như worker
    await pool.query("rollback");
    await deps.db.tx(async (c) => c.query("select public.ws_release_for_booking($1)", [a.bookingId]));
    await rejects(upload(ws, l2.leaseToken, "z"), 401, "lease_invalid");
  });

  it("dọn dẹp: GC xoá staging cũ không thuộc version giữ lại; xoá workspace dọn mọi blob và bị chặn khi còn lease", async () => {
    const a = await activeBooking();
    const ws = await newWs(a.renter);
    const l = await getLease(a.renter, ws, a.bookingId);
    for (const c of ["giữ", "mồ côi"]) await upload(ws, l.leaseToken, c);
    await commitWorkspace(deps, ws, lease(l.leaseToken), { expectedVersion: 0, manifest: { files: [{ path: "keep", sha256: sha("giữ"), size: bytes("giữ").length }] } });
    expect(await gcWorkspace(deps, ws)).toBe(0); // còn mới (< 1 giờ): chưa dọn
    await admin.query("update public.workspace_objects set created_at = now() - interval '2 hours' where workspace_id = $1", [ws]);
    expect(await gcWorkspace(deps, ws)).toBe(1); // chỉ object mồ côi
    expect(readdirSync(path.join(dir, ws))).toEqual([sha("giữ")]);

    await rejects(deleteWorkspace(deps, user(a.renter), ws), 409, "lease_held");
    await releaseLease(deps, ws, lease(l.leaseToken));
    await rejects(deleteWorkspace(deps, user(await renterWithWallet(A())), ws), 403, "forbidden");
    expect((await deleteWorkspace(deps, user(a.renter), ws)).body).toEqual({ deleted: true, objects: 1 });
    expect(() => readdirSync(path.join(dir, ws))).not.toThrow(); // thư mục có thể còn, nhưng trống
    expect(readdirSync(path.join(dir, ws))).toEqual([]);
    expect((await admin.query("select count(*)::int as n from public.workspaces where id = $1", [ws])).rows[0].n).toBe(0);
  });

  it("giới hạn số workspace; client không ghi trực tiếp; chủ chỉ đọc workspace của mình qua RLS", async () => {
    const u = await newUser(A(), "wsl");
    for (let i = 0; i < 5; i++) await createWorkspace(deps, user(u), { name: `w${i}` });
    await rejects(createWorkspace(deps, user(u), { name: "w6" }), 409, "workspace_limit");
    await rejects(createWorkspace(deps, user(u), { name: "" }), 400, "bad_request");
    await admin.query("begin");
    await admin.query("set local role authenticated");
    await admin.query("select set_config('request.jwt.claim.sub', $1, true)", [u]);
    expect((await admin.query("select count(*)::int as n from public.workspaces")).rows[0].n).toBe(5);
    await expect(admin.query("insert into public.workspaces (owner_id, name) values ($1, 'tự tạo')", [u])).rejects.toThrow(/permission denied/);
    await admin.query("rollback");
    const outsider = await renterWithWallet(A());
    await admin.query("begin");
    await admin.query("set local role authenticated");
    await admin.query("select set_config('request.jwt.claim.sub', $1, true)", [outsider]);
    expect((await admin.query("select count(*)::int as n from public.workspaces")).rows[0].n).toBe(0);
    await admin.query("rollback");
  });
});

describe("qua lớp HTTP", () => {
  it("tạo → lease → PUT nhị phân → commit → GET manifest/object; chặn thiếu token, quá lớn, sai kho", async () => {
    const a = await activeBooking();
    const tokenFor = new Map<string, string>([["Bearer " + "u".repeat(40), a.renter]]);
    const authFetch = (async (_u: string, init: RequestInit) => {
      const id = tokenFor.get((init.headers as Record<string, string>).authorization ?? "");
      return id ? new Response(JSON.stringify({ id, email: null })) : new Response("{}", { status: 401 });
    }) as unknown as typeof fetch;
    const h = createApiHandler({ ...deps, fetchImpl: authFetch });
    const userAuth = { authorization: "Bearer " + "u".repeat(40), "content-type": "application/json" };
    const call = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
      h(new Request(`http://api.test${p}`, { method, headers, body: body === undefined ? undefined : body instanceof Uint8Array ? (body as unknown as ArrayBuffer) : JSON.stringify(body) }));

    const ws = ((await (await call("POST", "/api/workspaces", { name: "qua http" }, userAuth)).json()) as { id: string }).id;
    const lr = await call("POST", `/api/workspaces/${ws}/lease`, { bookingId: a.bookingId }, userAuth);
    expect(lr.status).toBe(201);
    const tok = ((await lr.json()) as { leaseToken: string }).leaseToken;
    const L = { authorization: `Lease ${tok}` };
    const content = "nội dung qua http";
    expect((await call("PUT", `/api/workspaces/${ws}/objects/${sha(content)}`, bytes(content), L)).status).toBe(201);
    expect((await call("PUT", `/api/workspaces/${ws}/objects/${sha(content)}`, bytes(content), {})).status).toBe(401);
    const big = "x".repeat(2000);
    expect((await call("PUT", `/api/workspaces/${ws}/objects/${sha(big)}`, bytes(big), { ...L, "content-length": "2000" })).status).toBe(413);
    expect((await call("PUT", `/api/workspaces/${ws}/objects/${sha("khác")}`, bytes(content), L)).status).toBe(422);
    const cm = await call("POST", `/api/workspaces/${ws}/commit`, { expectedVersion: 0, manifest: { files: [{ path: "a.txt", sha256: sha(content), size: bytes(content).length }] } }, { ...L, "content-type": "application/json" });
    expect(await cm.json()).toMatchObject({ saved: true, version: 1 });
    const mf = await call("GET", `/api/workspaces/${ws}/versions/1`, undefined, L);
    expect(((await mf.json()) as { manifest: { files: unknown[] } }).manifest.files).toHaveLength(1);
    const ob = await call("GET", `/api/workspaces/${ws}/objects/${sha(content)}`, undefined, L);
    expect(new TextDecoder().decode(new Uint8Array(await ob.arrayBuffer()))).toBe(content);
    expect((await call("GET", `/api/workspaces/${ws}/objects/${sha(content)}`, undefined, { authorization: "Lease " + "z".repeat(43) })).status).toBe(401);
    const noStore = createApiHandler({ ...deps, store: undefined, fetchImpl: authFetch });
    expect((await noStore(new Request("http://api.test/api/workspaces", { method: "POST", headers: userAuth, body: JSON.stringify({ name: "x" }) }))).status).toBe(503);
    expect((await call("DELETE", `/api/workspaces/${ws}`, undefined, userAuth)).status).toBe(409); // còn lease
  });
});

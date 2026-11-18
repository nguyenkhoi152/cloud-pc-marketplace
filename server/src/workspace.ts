/**
 * Workspace broker + driver lưu trữ cục bộ (dev/test). Driver chỉ lưu byte; quyền, lease, quota, manifest do broker + DB.
 * Không có root key trong guest: renter/guest chỉ có token lease theo booking, hết hạn và bị thu hồi khi phiên kết thúc.
 * "Đã lưu" chỉ khi commit nguyên tử thành công. S3-compatible là adapter khác cùng giao diện WorkspaceStore (chưa làm).
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError, ok, pgMessage, randomToken, sha256Bytes, type ApiResult, type ApiUser, type Deps } from "./core";

export interface ObjectStat {
  key: string;
  size: number;
  sha256: string;
}
export interface WorkspaceStore {
  put(key: string, data: Uint8Array): Promise<ObjectStat>;
  get(key: string): Promise<Uint8Array | null>;
  stat(key: string): Promise<ObjectStat | null>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f]{64}$/;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Lưu theo `<workspaceId>/<sha256>`; ghi tạm rồi rename (nguyên tử); bất biến: cùng key khác nội dung bị từ chối. */
export class LocalFsStore implements WorkspaceStore {
  constructor(private root: string) {}
  private file(key: string) {
    if (!KEY_RE.test(key)) throw new Error("key không hợp lệ");
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("key ngoài thư mục gốc");
    return p;
  }
  async put(key: string, data: Uint8Array): Promise<ObjectStat> {
    const f = this.file(key);
    const digest = sha(data);
    if (key.split("/")[1] !== digest) throw new Error("key không khớp checksum nội dung");
    const existing = await this.stat(key);
    if (existing) return existing; // bất biến + idempotent: cùng sha ⇒ cùng nội dung
    await mkdir(path.dirname(f), { recursive: true });
    const tmp = `${f}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, data, { flag: "wx" });
    await rename(tmp, f);
    return { key, size: data.byteLength, sha256: digest };
  }
  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.file(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async stat(key: string): Promise<ObjectStat | null> {
    const data = await this.get(key);
    return data ? { key, size: data.byteLength, sha256: sha(data) } : null; // tính lại checksum: phát hiện hỏng/đổi file
  }
  async delete(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }
}

export interface WsDeps extends Deps {
  store: WorkspaceStore;
  maxObjectBytes?: number;
}

export interface ManifestFile {
  path: string;
  sha256: string;
  size: number;
}
const MAX_FILES = 5000;
const MAX_OBJECT_DEFAULT = 8 * 1024 * 1024;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);

/** Chuẩn hoá và kiểm manifest: đường dẫn tương đối an toàn, không trùng (kể cả khác hoa/thường), sha/size đúng dạng. */
export function normalizeManifest(raw: unknown): { files: ManifestFile[]; json: string; sha256: string } {
  const files = (raw as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.length > MAX_FILES) throw new ApiError(400, "invalid_manifest", `Manifest cần mảng files (tối đa ${MAX_FILES}).`);
  const seen = new Set<string>();
  const out: ManifestFile[] = files.map((f: unknown) => {
    const x = f as Partial<ManifestFile>;
    const p = typeof x.path === "string" ? x.path : "";
    if (!p || p.length > 260 || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.includes("\\") || /[\u0000-\u001f]/.test(p) || p.split("/").some((s) => s === ".." || s === "." || s === ""))
      throw new ApiError(400, "invalid_path", `Đường dẫn không hợp lệ: ${p.slice(0, 40)}`);
    if (typeof x.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(x.sha256) || !Number.isSafeInteger(x.size) || (x.size as number) < 0)
      throw new ApiError(400, "invalid_manifest", "Mỗi tệp cần sha256 (hex 64) và size nguyên không âm.");
    const k = p.toLowerCase();
    if (seen.has(k)) throw new ApiError(400, "duplicate_path", `Trùng đường dẫn: ${p.slice(0, 40)}`);
    seen.add(k);
    return { path: p, sha256: x.sha256, size: x.size as number };
  });
  out.sort((a, b) => (a.path < b.path ? -1 : 1));
  const json = JSON.stringify({ files: out });
  return { files: out, json, sha256: createHash("sha256").update(json).digest("hex") };
}

const mapPg = (e: unknown): never => {
  const m = pgMessage(e);
  const table: [string, number, string, string][] = [
    ["forbidden", 403, "forbidden", "Bạn không có quyền với workspace/booking này."],
    ["workspace_limit", 409, "workspace_limit", "Đã đạt giới hạn số workspace."],
    ["booking_not_active", 409, "booking_not_active", "Booking chưa Active nên chưa mở workspace."],
    ["recovery_window_closed", 410, "recovery_window_closed", "Đã hết thời gian phục hồi sau phiên."],
    ["lease_held", 409, "lease_held", "Workspace đang được một phiên khác ghi."],
    ["lease_invalid", 401, "lease_invalid", "Token workspace không hợp lệ hoặc đã hết hạn."],
    ["quota_exceeded", 413, "quota_exceeded", "Vượt dung lượng workspace."],
    ["version_conflict", 409, "version_conflict", "Phiên bản đã thay đổi; tải lại rồi lưu lại."],
    ["missing_object", 422, "missing_object", "Manifest tham chiếu tệp chưa được tải lên đầy đủ."],
    ["invalid_manifest", 400, "invalid_manifest", "Manifest không hợp lệ."],
    ["invalid_request", 400, "bad_request", "Yêu cầu không hợp lệ."],
  ];
  for (const [k, s, c, t] of table) if (m.includes(k)) throw new ApiError(s, c, t);
  throw e;
};

const leaseHash = (tokenHeader: string | null | undefined) => {
  const m = /^Lease ([A-Za-z0-9_-]{20,100})$/.exec(tokenHeader ?? "");
  if (!m) throw new ApiError(401, "lease_invalid", "Thiếu token workspace.");
  return sha256Bytes(m[1]!);
};

export async function createWorkspace(deps: WsDeps, user: ApiUser, body: unknown): Promise<ApiResult> {
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 80) throw new ApiError(400, "bad_request", "Tên workspace 1–80 ký tự.");
  try {
    const id = await deps.db.tx(async (c) => (await c.query<{ id: string }>("select public.ws_create($1, $2) as id", [user.id, name.trim()])).rows[0]!.id);
    return ok({ id }, 201);
  } catch (e) {
    return mapPg(e);
  }
}

/** Cấp lease cho booking Active của chính renter; trả token MỘT lần (DB chỉ giữ băm). */
export async function acquireLease(deps: WsDeps, user: ApiUser, workspaceId: unknown, body: unknown): Promise<ApiResult> {
  const b = (body ?? {}) as { bookingId?: unknown; ttlSeconds?: unknown };
  if (!uuid(workspaceId) || !uuid(b.bookingId)) throw new ApiError(400, "bad_request", "Thiếu workspaceId/bookingId.");
  const ttl = b.ttlSeconds === undefined ? 900 : b.ttlSeconds;
  if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 30 || ttl > 3600) throw new ApiError(400, "bad_request", "ttlSeconds 30–3600.");
  const token = randomToken(32);
  try {
    const exp = await deps.db.tx(async (c) => (await c.query<{ e: Date }>("select public.ws_acquire_lease($1, $2, $3, $4, $5) as e", [workspaceId, user.id, b.bookingId, sha256Bytes(token), ttl])).rows[0]!.e);
    return ok({ leaseToken: token, expiresAt: exp.toISOString() }, 201);
  } catch (e) {
    return mapPg(e);
  }
}

/** Tải một object (≤ giới hạn): server tự tính SHA-256 từ byte nhận được, không tin checksum client. */
export async function putObject(deps: WsDeps, workspaceId: unknown, sha256: unknown, auth: string | null | undefined, data: Uint8Array): Promise<ApiResult> {
  if (!uuid(workspaceId) || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) throw new ApiError(400, "bad_request", "Tham số không hợp lệ.");
  const hash = leaseHash(auth);
  if (data.byteLength > (deps.maxObjectBytes ?? MAX_OBJECT_DEFAULT)) throw new ApiError(413, "object_too_large", "Tệp vượt giới hạn một lần tải.");
  if (sha(data) !== sha256) throw new ApiError(422, "checksum_mismatch", "Nội dung không khớp checksum đã khai báo.");
  try {
    await deps.db.tx(async (c) => c.query("select public.ws_check_lease($1, $2)", [workspaceId, hash])); // kiểm lease trước khi ghi byte
  } catch (e) {
    return mapPg(e);
  }
  const key = `${workspaceId}/${sha256}`;
  await deps.store.put(key, data);
  try {
    const fresh = await deps.db.tx(async (c) => (await c.query<{ r: boolean }>("select public.ws_register_object($1, $2, $3, $4) as r", [workspaceId, hash, sha256, data.byteLength])).rows[0]!.r);
    return ok({ stored: true, new: fresh }, fresh ? 201 : 200);
  } catch (e) {
    // Đăng ký thất bại (quota/lease hết hạn giữa chừng): xoá blob vừa ghi nếu chưa có hàng tham chiếu.
    const still = await deps.db.tx(async (c) => (await c.query("select 1 from public.workspace_objects where workspace_id = $1 and sha256 = $2", [workspaceId, sha256])).rows.length);
    if (!still) await deps.store.delete(key);
    return mapPg(e);
  }
}

/** Commit manifest nguyên tử. Kiểm thêm blob trong store còn đúng checksum/kích thước trước khi chốt "Đã lưu". */
export async function commitWorkspace(deps: WsDeps, workspaceId: unknown, auth: string | null | undefined, body: unknown): Promise<ApiResult> {
  if (!uuid(workspaceId)) throw new ApiError(400, "bad_request", "workspaceId không hợp lệ.");
  const hash = leaseHash(auth);
  const expected = (body as { expectedVersion?: unknown } | null)?.expectedVersion;
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0) throw new ApiError(400, "bad_request", "Thiếu expectedVersion.");
  const m = normalizeManifest((body as { manifest?: unknown }).manifest);
  for (const f of m.files) {
    const st = await deps.store.stat(`${workspaceId}/${f.sha256}`);
    if (!st || st.sha256 !== f.sha256 || st.size !== f.size) throw new ApiError(422, "missing_object", `Tệp ${f.path.slice(0, 40)} chưa có hoặc đã hỏng trong kho.`);
  }
  try {
    const version = await deps.db.tx(async (c) => (await c.query<{ v: number }>("select public.ws_commit($1, $2, $3, $4::jsonb, $5) as v", [workspaceId, hash, expected, m.json, m.sha256])).rows[0]!.v);
    return ok({ saved: true, version, manifestSha256: m.sha256 }, 201);
  } catch (e) {
    return mapPg(e);
  }
}

/** Đọc manifest/object để khôi phục: cần lease hợp lệ (booking Active hoặc trong cửa sổ recovery), không đọc sau khi bị thu hồi. */
export async function readManifest(deps: WsDeps, workspaceId: unknown, version: unknown, auth: string | null | undefined): Promise<ApiResult> {
  if (!uuid(workspaceId) || typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new ApiError(400, "bad_request", "Tham số không hợp lệ.");
  const hash = leaseHash(auth);
  try {
    const r = await deps.db.tx(async (c) => {
      await c.query("select public.ws_check_lease($1, $2)", [workspaceId, hash]);
      return (await c.query<{ manifest: unknown; manifest_sha256: string }>("select manifest, manifest_sha256 from public.workspace_versions where workspace_id = $1 and version = $2", [workspaceId, version])).rows[0];
    });
    if (!r) throw new ApiError(404, "not_found", "Không có phiên bản này.");
    return ok({ manifest: r.manifest, manifestSha256: r.manifest_sha256 });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    return mapPg(e);
  }
}

export async function readObject(deps: WsDeps, workspaceId: unknown, sha256: unknown, auth: string | null | undefined): Promise<{ status: number; data?: Uint8Array; body?: unknown }> {
  if (!uuid(workspaceId) || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) throw new ApiError(400, "bad_request", "Tham số không hợp lệ.");
  const hash = leaseHash(auth);
  try {
    const known = await deps.db.tx(async (c) => {
      await c.query("select public.ws_check_lease($1, $2)", [workspaceId, hash]);
      return (await c.query("select 1 from public.workspace_objects where workspace_id = $1 and sha256 = $2", [workspaceId, sha256])).rows.length;
    });
    if (!known) throw new ApiError(404, "not_found", "Không có tệp này trong workspace.");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    return mapPg(e);
  }
  const data = await deps.store.get(`${workspaceId}/${sha256}`);
  if (!data || sha(data) !== sha256) throw new ApiError(500, "storage_corrupt", "Tệp trong kho bị mất hoặc hỏng.");
  return { status: 200, data };
}

export async function releaseLease(deps: WsDeps, workspaceId: unknown, auth: string | null | undefined): Promise<ApiResult> {
  if (!uuid(workspaceId)) throw new ApiError(400, "bad_request", "workspaceId không hợp lệ.");
  const released = await deps.db.tx(async (c) => (await c.query<{ r: boolean }>("select public.ws_release_lease($1, $2) as r", [workspaceId, leaseHash(auth)])).rows[0]!.r);
  return ok({ released });
}

/** Xoá workspace theo yêu cầu chủ sở hữu và dọn mọi blob. */
export async function deleteWorkspace(deps: WsDeps, user: ApiUser, workspaceId: unknown): Promise<ApiResult> {
  if (!uuid(workspaceId)) throw new ApiError(400, "bad_request", "workspaceId không hợp lệ.");
  let shas: string[];
  try {
    shas = await deps.db.tx(async (c) => (await c.query<{ ws_delete: string }>("select * from public.ws_delete($1, $2)", [workspaceId, user.id])).rows.map((r) => r.ws_delete));
  } catch (e) {
    return mapPg(e);
  }
  for (const s of shas) await deps.store.delete(`${workspaceId}/${s}`);
  return ok({ deleted: true, objects: shas.length });
}

/** Dọn staging cũ (worker gọi định kỳ). Trả số blob đã xoá. */
export async function gcWorkspace(deps: WsDeps, workspaceId: string, keepVersions = 3): Promise<number> {
  const shas = await deps.db.tx(async (c) => (await c.query<{ ws_gc: string }>("select * from public.ws_gc($1, $2)", [workspaceId, keepVersions])).rows.map((r) => r.ws_gc));
  for (const s of shas) await deps.store.delete(`${workspaceId}/${s}`);
  return shas.length;
}


/**
 * Driver WorkspaceStore cho kho đối tượng kiểu S3, đứng sau giao diện `ObjectClient` tối thiểu (tiêm từ ngoài).
 * CHƯA thử với S3/MinIO/R2 thật: chỉ kiểm bằng client giả trong bộ nhớ (xem s3store.test.ts). Chưa có wrapper cho
 * `@aws-sdk/client-s3` vì chưa thêm dependency/tài khoản/bucket; khi có đích thật hãy viết wrapper mỏng ~30 dòng cho `ObjectClient`.
 *
 * Giữ nguyên bất biến của LocalFsStore:
 *  - key phải đúng dạng `<workspaceId>/<sha256>` và sha256 của nội dung phải bằng phần thứ hai của key;
 *  - bất biến + idempotent: cùng key đã tồn tại và nội dung đúng checksum ⇒ trả lại bản có sẵn, không ghi đè;
 *  - đối tượng có sẵn nhưng sai checksum (hỏng/bị sửa ngoài) ⇒ báo lỗi, KHÔNG âm thầm ghi đè hay coi là hợp lệ;
 *  - stat/get tính lại SHA-256 từ byte đã tải (phát hiện hỏng).
 * Ghi có điều kiện (`If-None-Match: *`) chỉ là lớp bảo vệ bổ sung: không phải kho tương thích S3 nào cũng hỗ trợ,
 * nên không dựa vào nó để bảo đảm bất biến — bảo đảm chính là key theo nội dung (cùng key ⇒ cùng byte) cộng kiểm checksum.
 * Quyền truy cập bucket (credential/IAM) thuộc server/worker, không bao giờ đưa vào guest; guest chỉ có lease theo booking.
 */
import { createHash } from "node:crypto";
import type { ObjectStat, WorkspaceStore } from "./workspace";

/** Client kho đối tượng tối thiểu. `get`/`head` trả null khi không tồn tại; `put` ném `ObjectExistsError` khi điều kiện ghi-một-lần thất bại. */
export interface ObjectClient {
  put(key: string, body: Uint8Array, opts: { sha256Base64: string; ifNoneMatch: boolean }): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
}
export class ObjectExistsError extends Error {
  constructor() {
    super("object_exists");
  }
}

const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f]{64}$/;
const PREFIX_RE = /^(?:[A-Za-z0-9._-]+\/)*$/; // rỗng hoặc dạng "a/b/"
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export class S3WorkspaceStore implements WorkspaceStore {
  constructor(
    private client: ObjectClient,
    private prefix = "",
    private opts: { conditionalPut?: boolean } = {},
  ) {
    if (!PREFIX_RE.test(prefix) || prefix.startsWith("/") || prefix.includes("..")) throw new Error("prefix không hợp lệ");
  }
  private k(key: string) {
    if (!KEY_RE.test(key)) throw new Error("key không hợp lệ");
    return this.prefix + key;
  }
  /** Đọc đối tượng có sẵn và xác minh checksum đúng với key (key theo nội dung). */
  private async verified(key: string): Promise<ObjectStat | null> {
    const data = await this.client.get(this.k(key));
    if (!data) return null;
    const digest = sha(data);
    if (digest !== key.split("/")[1]) throw new Error("đối tượng đã lưu không khớp checksum (hỏng hoặc bị sửa)");
    return { key, size: data.byteLength, sha256: digest };
  }
  async put(key: string, data: Uint8Array): Promise<ObjectStat> {
    const full = this.k(key);
    const digest = sha(data);
    if (key.split("/")[1] !== digest) throw new Error("key không khớp checksum nội dung");
    const existing = await this.verified(key);
    if (existing) return existing; // bất biến + idempotent
    try {
      await this.client.put(full, data, { sha256Base64: Buffer.from(digest, "hex").toString("base64"), ifNoneMatch: this.opts.conditionalPut !== false });
    } catch (e) {
      if (!(e instanceof ObjectExistsError)) throw e;
      // Có người ghi cùng key đồng thời: cùng key ⇒ cùng byte; vẫn xác minh trước khi coi là thành công.
      const now = await this.verified(key);
      if (!now) throw e;
      return now;
    }
    return { key, size: data.byteLength, sha256: digest };
  }
  async get(key: string): Promise<Uint8Array | null> {
    const data = await this.client.get(this.k(key));
    if (!data) return null;
    if (sha(data) !== key.split("/")[1]) throw new Error("đối tượng đã lưu không khớp checksum (hỏng hoặc bị sửa)");
    return data;
  }
  async stat(key: string): Promise<ObjectStat | null> {
    const data = await this.client.get(this.k(key));
    return data ? { key, size: data.byteLength, sha256: sha(data) } : null; // tính lại: như LocalFsStore, caller so với manifest
  }
  async delete(key: string): Promise<void> {
    await this.client.delete(this.k(key));
  }
}

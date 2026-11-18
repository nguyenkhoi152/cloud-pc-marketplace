/**
 * Test S3WorkspaceStore với client GIẢ trong bộ nhớ (không phải S3/MinIO/R2 thật).
 * Kiểm bất biến của driver: key theo nội dung, idempotent, không ghi đè bản hỏng, race ghi đồng thời, prefix, kho không hỗ trợ ghi có điều kiện.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ObjectExistsError, S3WorkspaceStore, type ObjectClient } from "./s3store";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytes = (s: string) => new TextEncoder().encode(s);
const WS = "11111111-2222-3333-4444-555555555555";
const keyOf = (b: Uint8Array) => `${WS}/${sha(b)}`;

class FakeClient implements ObjectClient {
  objects = new Map<string, Uint8Array>();
  puts: { key: string; ifNoneMatch: boolean; sha256Base64: string }[] = [];
  supportsConditional = true;
  /** mô phỏng đối thủ ghi cùng key ngay sau lần head/get đầu tiên của ta */
  raceOnce: ((k: string) => void) | null = null;
  async put(key: string, body: Uint8Array, opts: { sha256Base64: string; ifNoneMatch: boolean }) {
    this.puts.push({ key, ifNoneMatch: opts.ifNoneMatch, sha256Base64: opts.sha256Base64 });
    if (this.raceOnce) { const f = this.raceOnce; this.raceOnce = null; f(key); }
    if (opts.ifNoneMatch && this.supportsConditional && this.objects.has(key)) throw new ObjectExistsError();
    this.objects.set(key, new Uint8Array(body));
  }
  async get(key: string) { const v = this.objects.get(key); return v ? new Uint8Array(v) : null; }
  async head(key: string) { const v = this.objects.get(key); return v ? { size: v.byteLength } : null; }
  async delete(key: string) { this.objects.delete(key); }
}

describe("S3WorkspaceStore (client giả)", () => {
  it("put/get/stat/delete round-trip; checksum gửi kèm là SHA-256 base64; ghi có điều kiện mặc định bật", async () => {
    const c = new FakeClient(), s = new S3WorkspaceStore(c, "ws/");
    const d = bytes("nội dung"), k = keyOf(d);
    expect(await s.put(k, d)).toEqual({ key: k, size: d.byteLength, sha256: sha(d) });
    expect(c.puts[0]).toMatchObject({ key: `ws/${k}`, ifNoneMatch: true, sha256Base64: Buffer.from(sha(d), "hex").toString("base64") });
    expect(new TextDecoder().decode((await s.get(k))!)).toBe("nội dung");
    expect(await s.stat(k)).toMatchObject({ size: d.byteLength, sha256: sha(d) });
    await s.delete(k);
    expect(await s.get(k)).toBeNull();
    expect(await s.stat(k)).toBeNull();
    await s.delete(k); // xoá lại không lỗi
  });

  it("từ chối key sai dạng, traversal, key không khớp nội dung, prefix xấu", async () => {
    const s = new S3WorkspaceStore(new FakeClient());
    const d = bytes("a");
    await expect(s.put("../x", d)).rejects.toThrow("key không hợp lệ");
    await expect(s.put(`${WS}/../${"0".repeat(64)}`, d)).rejects.toThrow("key không hợp lệ");
    await expect(s.put(`${WS}/${"0".repeat(64)}`, d)).rejects.toThrow("key không khớp checksum");
    await expect(s.get("x")).rejects.toThrow("key không hợp lệ");
    for (const p of ["/abs/", "a/../b/", "a b/", "a//b/", "ws"]) expect(() => new S3WorkspaceStore(new FakeClient(), p), p).toThrow("prefix không hợp lệ");
  });

  it("idempotent: put lần hai không ghi lại; đối tượng có sẵn nhưng HỎNG → lỗi, không ghi đè, get/stat phát hiện", async () => {
    const c = new FakeClient(), s = new S3WorkspaceStore(c);
    const d = bytes("bản gốc"), k = keyOf(d);
    await s.put(k, d);
    await s.put(k, d);
    expect(c.puts).toHaveLength(1);
    c.objects.set(k, bytes("bị sửa ngoài"));
    await expect(s.put(k, d)).rejects.toThrow("không khớp checksum");
    expect(c.puts).toHaveLength(1); // không ghi đè bản hỏng
    await expect(s.get(k)).rejects.toThrow("không khớp checksum");
    expect((await s.stat(k))!.sha256).not.toBe(sha(d)); // stat để broker so với manifest
  });

  it("race: kẻ khác ghi cùng key giữa lúc kiểm và ghi → ghi có điều kiện thất bại, ta xác minh rồi trả bản có sẵn", async () => {
    const c = new FakeClient(), s = new S3WorkspaceStore(c);
    const d = bytes("race"), k = keyOf(d);
    c.raceOnce = (full) => c.objects.set(full, new Uint8Array(d)); // cùng key ⇒ cùng byte
    expect(await s.put(k, d)).toMatchObject({ sha256: sha(d) });
    // Đối thủ ghi byte KHÁC (kho bị can thiệp) → không coi là thành công
    const d2 = bytes("race-2"), k2 = keyOf(d2);
    c.raceOnce = (full) => c.objects.set(full, bytes("rác"));
    await expect(s.put(k2, d2)).rejects.toThrow("không khớp checksum");
  });

  it("kho không hỗ trợ ghi có điều kiện: tắt cờ vẫn đúng nhờ key theo nội dung + kiểm checksum", async () => {
    const c = new FakeClient();
    c.supportsConditional = false;
    const s = new S3WorkspaceStore(c, "", { conditionalPut: false });
    const d = bytes("không điều kiện"), k = keyOf(d);
    await s.put(k, d);
    expect(c.puts[0]!.ifNoneMatch).toBe(false);
    expect(await s.put(k, d)).toMatchObject({ sha256: sha(d) });
    expect(c.puts).toHaveLength(1);
  });

  it("lỗi hạ tầng không bị nuốt (khác ObjectExistsError)", async () => {
    const c = new FakeClient();
    c.put = async () => { throw new Error("503 SlowDown"); };
    const d = bytes("x");
    await expect(new S3WorkspaceStore(c).put(keyOf(d), d)).rejects.toThrow("503 SlowDown");
  });
});

// @vitest-environment node
/**
 * Ví thử THEO TÀI KHOẢN: mỗi tài khoản một khoá riêng trên PC (máy chủ chỉ cho một địa chỉ ví thuộc một tài khoản, nên dùng chung một ví
 * làm tài khoản thứ hai không liên kết được). Kế thừa ví dùng chung cũ chỉ dành cho tài khoản đang liên kết ĐÚNG địa chỉ đó.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { legacyTestnetAddress, loadAccountTestnetKey, needsLinkedLookup, TESTNET_STORAGE_KEY, testnetAccountKeyName } from "./testnetWallet";

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const addr = (k: `0x${string}`) => privateKeyToAccount(k).address;

describe("loadAccountTestnetKey: mỗi tài khoản một ví", () => {
  it("hai tài khoản trên cùng PC có HAI ví khác nhau, mỗi bên ổn định qua các lần mở app", () => {
    const st = memStore();
    const a = loadAccountTestnetKey(st, A, null);
    const b = loadAccountTestnetKey(st, B, null);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(addr(a)).not.toBe(addr(b)); // đúng điều người dùng cần: tài khoản thứ hai liên kết được ví của riêng mình
    expect(loadAccountTestnetKey(st, A, null)).toBe(a);
    expect(loadAccountTestnetKey(st, B, "0xbat-ky")).toBe(b); // đã có khoá riêng thì không hỏi lại ví đã liên kết
    expect(st.m.has(testnetAccountKeyName(A))).toBe(true);
    expect(st.m.has(TESTNET_STORAGE_KEY)).toBe(false); // không đụng khoá dùng chung khi chưa từng có
  });

  it("kế thừa ví dùng chung cũ CHỈ cho tài khoản đang liên kết đúng địa chỉ đó; tài khoản khác nhận ví mới", () => {
    const st = memStore();
    const legacy = generatePrivateKey();
    st.m.set(TESTNET_STORAGE_KEY, legacy);
    const legacyAddr = addr(legacy);
    expect(legacyTestnetAddress(st)).toBe(legacyAddr.toLowerCase());
    // B chưa liên kết gì ⇒ KHÔNG được lấy ví cũ (nếu A đang giữ nó thì B sẽ lại vướng "ví đã liên kết với tài khoản khác").
    const b = loadAccountTestnetKey(st, B, null);
    expect(b).not.toBe(legacy);
    // A liên kết đúng ví cũ (so sánh không phân biệt hoa thường) ⇒ kế thừa, giữ nguyên địa chỉ và số dư.
    expect(needsLinkedLookup(st, A)).toBe(true);
    const a = loadAccountTestnetKey(st, A, legacyAddr.toUpperCase().replace("0X", "0x"));
    expect(a).toBe(legacy);
    expect(st.m.get(testnetAccountKeyName(A))).toBe(legacy);
    expect(needsLinkedLookup(st, A)).toBe(false);
    // Khoá cũ vẫn còn nguyên trong máy (không xoá, đề phòng cần khôi phục).
    expect(st.m.get(TESTNET_STORAGE_KEY)).toBe(legacy);
  });

  it("tài khoản liên kết một ví KHÁC với ví cũ (ví nằm trên máy khác) ⇒ ví mới cho PC này, không lấy ví cũ", () => {
    const st = memStore();
    const legacy = generatePrivateKey();
    st.m.set(TESTNET_STORAGE_KEY, legacy);
    const other = addr(generatePrivateKey());
    expect(loadAccountTestnetKey(st, A, other)).not.toBe(legacy);
  });

  it("không tra cứu được ví đã liên kết (máy chủ tắt) ⇒ tạm dùng khoá cũ nhưng KHÔNG lưu khoá riêng (không nhận nhầm, lần sau tra lại)", () => {
    const st = memStore();
    const legacy = generatePrivateKey();
    st.m.set(TESTNET_STORAGE_KEY, legacy);
    expect(loadAccountTestnetKey(st, A, undefined)).toBe(legacy);
    expect(st.m.has(testnetAccountKeyName(A))).toBe(false);
    expect(needsLinkedLookup(st, A)).toBe(true); // lần sau vẫn hỏi lại
    // Không có khoá cũ thì tra lỗi cũng chẳng ảnh hưởng: sinh khoá riêng như thường.
    const fresh = memStore();
    expect(loadAccountTestnetKey(fresh, A, undefined)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fresh.m.has(testnetAccountKeyName(A))).toBe(true);
  });

  it("không cần hỏi máy chủ khi chưa có khoá cũ hoặc đã có khoá riêng; khoá hỏng bị bỏ qua", () => {
    const st = memStore();
    expect(needsLinkedLookup(st, A)).toBe(false); // PC mới: không có gì để kế thừa
    st.m.set(TESTNET_STORAGE_KEY, "không phải khoá");
    expect(needsLinkedLookup(st, A)).toBe(false);
    expect(legacyTestnetAddress(st)).toBeNull();
    st.m.set(testnetAccountKeyName(A), "hỏng");
    expect(loadAccountTestnetKey(st, A, null)).toMatch(/^0x[0-9a-f]{64}$/); // khoá riêng hỏng ⇒ sinh lại
  });

  it("storage lỗi hoặc không có ⇒ khoá tạm của phiên, không ném lỗi", () => {
    expect(loadAccountTestnetKey(null, A, null)).toMatch(/^0x[0-9a-f]{64}$/);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadAccountTestnetKey(broken, A, null)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(needsLinkedLookup(broken, A)).toBe(false);
  });
});

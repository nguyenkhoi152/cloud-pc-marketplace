// Ví GIẢ cục bộ: tài khoản viem sinh ngẫu nhiên đóng vai provider EIP-1193. Không phải ví thật, không có mạng, không có AVAX.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress, hexToString } from "viem";
import { describe, expect, it } from "vitest";
import { linkWallet, type Eip1193 } from "./wallet";

const acct = privateKeyToAccount(generatePrivateKey());
const provider = (o: { chainId?: string; accounts?: string[]; rejectSign?: boolean; rejectConnect?: boolean } = {}): Eip1193 & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    async request({ method, params }) {
      calls.push(method);
      if (method === "eth_requestAccounts") { if (o.rejectConnect) throw Object.assign(new Error("User rejected the request."), { code: 4001 }); return o.accounts ?? [acct.address]; }
      if (method === "eth_chainId") return o.chainId ?? "0xa869"; // 43113
      if (method === "personal_sign") {
        if (o.rejectSign) throw Object.assign(new Error("User denied message signature."), { code: 4001 });
        const [hex, addr] = params as [`0x${string}`, string];
        expect(addr.toLowerCase()).toBe(acct.address.toLowerCase());
        return acct.signMessage({ message: hexToString(hex) });
      }
      throw new Error("method không hỗ trợ: " + method);
    },
  };
};
const server = () => {
  const seen: { challenge?: [string, number]; verify?: [string, string] } = {};
  return {
    seen,
    api: {
      walletChallenge: async (a: string, c: number) => { seen.challenge = [a, c]; return { message: `Xác minh ví ${a}\nNonce: n1`, nonce: "n1", expiresAt: "x" }; },
      walletVerify: async (n: string, s: string) => { seen.verify = [n, s]; return { linked: true, address: acct.address.toLowerCase() }; },
    },
  };
};

describe("linkWallet (EIP-1193)", () => {
  it("luồng đúng: xin tài khoản → kiểm mạng → challenge → ký thông điệp đúng chữ → verify; chữ ký khôi phục đúng ví", async () => {
    const s = server();
    const r = await linkWallet(provider(), s.api, 43113);
    expect(r.address).toBe(acct.address.toLowerCase());
    expect(s.seen.challenge).toEqual([acct.address, 43113]);
    const [nonce, sig] = s.seen.verify!;
    expect(nonce).toBe("n1");
    expect(await recoverMessageAddress({ message: `Xác minh ví ${acct.address}\nNonce: n1`, signature: sig as `0x${string}` })).toBe(acct.address);
  });
  it("sai mạng: báo rõ và KHÔNG gọi server hay ký; không tự đổi mạng", async () => {
    const s = server();
    const p = provider({ chainId: "0x1" });
    await expect(linkWallet(p, s.api, 43113)).rejects.toMatchObject({ code: "rejected", message: expect.stringMatching(/mạng 1;.*43113/) });
    expect(s.seen.challenge).toBeUndefined();
    expect(p.calls).not.toContain("personal_sign");
    expect(p.calls).not.toContain("wallet_switchEthereumChain");
  });
  it("người dùng từ chối kết nối/ký → thông báo thân thiện, không verify; địa chỉ rác hoặc không có tài khoản bị từ chối", async () => {
    const s = server();
    await expect(linkWallet(provider({ rejectConnect: true }), s.api, 43113)).rejects.toMatchObject({ message: expect.stringMatching(/từ chối trong ví/) });
    await expect(linkWallet(provider({ rejectSign: true }), s.api, 43113)).rejects.toMatchObject({ message: expect.stringMatching(/từ chối trong ví/) });
    expect(s.seen.verify).toBeUndefined();
    await expect(linkWallet(provider({ accounts: [] }), s.api, 43113)).rejects.toMatchObject({ message: expect.stringMatching(/địa chỉ hợp lệ/) });
    await expect(linkWallet(provider({ accounts: ["0xabc"] }), s.api, 43113)).rejects.toMatchObject({ message: expect.stringMatching(/địa chỉ hợp lệ/) });
  });
  it("lỗi từ server (ví đã thuộc người khác…) được chuyển nguyên cho UI", async () => {
    const s = server();
    s.api.walletVerify = async () => { throw Object.assign(new Error("Ví này đã thuộc tài khoản khác."), { code: "rejected" }); };
    await expect(linkWallet(provider(), s.api, 43113)).rejects.toThrow(/đã thuộc tài khoản khác/);
  });
});

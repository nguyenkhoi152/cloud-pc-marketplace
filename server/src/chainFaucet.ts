/**
 * Vòi (faucet) testnet phía server: mint PCP thử (một lần/ví, do hợp đồng ép) và nhỏ giọt một ít AVAX gas để người thử có thể ký giao dịch
 * bằng ví thử trong app. Chỉ phụ thuộc viem, không import tương đối. Khoá vòi phải có ISSUER_ROLE trên PCP và chỉ nằm ở môi trường server.
 */
import { parseAbi, type Hex } from "viem";

const ABI = parseAbi(["function faucetMint(address to)", "function faucetClaimed(address) view returns (bool)"]);

export interface FaucetChain {
  pcpClaimed(address: string): Promise<boolean>;
  gasBalance(address: string): Promise<bigint>;
  /** Mint PCP cho ví; chờ receipt thành công rồi trả tx hash. Ném lỗi nếu hợp đồng từ chối (ví dụ đã nhận). */
  mintPcp(address: string): Promise<Hex>;
  /** Chuyển `wei` AVAX gas tới ví; chờ receipt thành công rồi trả tx hash. */
  sendGas(address: string, wei: bigint): Promise<Hex>;
}

export interface PublicClientLike {
  readContract(a: { address: `0x${string}`; abi: typeof ABI; functionName: "faucetClaimed"; args: readonly [`0x${string}`] }): Promise<unknown>;
  getBalance(a: { address: `0x${string}` }): Promise<bigint>;
  waitForTransactionReceipt(a: { hash: Hex }): Promise<{ status: string }>;
}
export interface FaucetWalletLike {
  writeContract(a: { address: `0x${string}`; abi: typeof ABI; functionName: "faucetMint"; args: readonly [`0x${string}`]; account?: unknown; chain?: unknown }): Promise<Hex>;
  sendTransaction(a: { to: `0x${string}`; value: bigint; account?: unknown; chain?: unknown }): Promise<Hex>;
  account?: { address: `0x${string}` } | undefined;
}

export function makeViemFaucetChain(pub: PublicClientLike, wallet: FaucetWalletLike, pcp: string): FaucetChain {
  const token = pcp as `0x${string}`;
  const acct = () => {
    if (!wallet.account) throw new Error("khoá vòi chưa có tài khoản");
    return wallet.account;
  };
  const confirm = async (hash: Hex) => {
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error("giao dịch vòi bị hoàn tác trên chuỗi");
    return hash;
  };
  return {
    async pcpClaimed(address) {
      return (await pub.readContract({ address: token, abi: ABI, functionName: "faucetClaimed", args: [address as `0x${string}`] })) as boolean;
    },
    gasBalance: (address) => pub.getBalance({ address: address as `0x${string}` }),
    async mintPcp(address) {
      return confirm(await wallet.writeContract({ address: token, abi: ABI, functionName: "faucetMint", args: [address as `0x${string}`], account: acct() }));
    },
    async sendGas(address, wei) {
      return confirm(await wallet.sendTransaction({ to: address as `0x${string}`, value: wei, account: acct() }));
    },
  };
}

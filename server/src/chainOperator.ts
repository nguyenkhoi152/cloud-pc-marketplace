/**
 * Operator thật: gửi `activate` lên RentalEscrow bằng khoá operator (chỉ ở server/worker). Chỉ phụ thuộc viem, không
 * import tương đối. Contract tự chặn gọi sai trạng thái/sai vai trò/quá hạn; worker còn kiểm stateOf trước khi gửi.
 */
import { parseAbi, type Hex } from "viem";

const ABI = parseAbi(["function activate(bytes32 id)", "function claimAfterGrace(bytes32 id)"]);

export interface WalletClientLike {
  account?: { address: `0x${string}` } | undefined;
  writeContract(a: { address: `0x${string}`; abi: typeof ABI; functionName: "activate" | "claimAfterGrace"; args: readonly [Hex]; account?: unknown; chain?: unknown }): Promise<Hex>;
}

export function makeViemOperator(wallet: WalletClientLike, escrow: string) {
  const send = (functionName: "activate" | "claimAfterGrace", bookingId: Hex): Promise<Hex> => {
    if (!wallet.account) throw new Error("operator chưa có tài khoản");
    return wallet.writeContract({ address: escrow as `0x${string}`, abi: ABI, functionName, args: [bookingId], account: wallet.account });
  };
  return {
    activate: (bookingId: Hex) => send("activate", bookingId),
    /** Ai cũng gọi được sau endAt + ân hạn; worker gọi để người thuê không bấm gì vẫn kết thúc phiên và host nhận tiền (contract tự chặn gọi sớm/sai trạng thái). */
    claimAfterGrace: (bookingId: Hex) => send("claimAfterGrace", bookingId),
  };
}

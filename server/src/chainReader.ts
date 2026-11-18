/**
 * Đọc trạng thái escrow trên chuỗi (view). Chỉ phụ thuộc viem, không import tương đối (contracts/test nạp trực tiếp được).
 * Worker dùng để đối soát trước khi hết hạn booking; API dùng để không cấp quote khi máy còn bị chiếm on-chain.
 */
import { parseAbi, type Hex } from "viem";

const ABI = parseAbi(["function machineOccupied(bytes32) view returns (bool)", "function stateOf(bytes32) view returns (uint8)"]);

export interface ReadClientLike {
  readContract(a: { address: `0x${string}`; abi: typeof ABI; functionName: "machineOccupied" | "stateOf"; args: readonly [Hex] }): Promise<unknown>;
}

export const ESCROW_STATE = { None: 0, Funded: 1, Active: 2, Disputed: 3, Settled: 4, Resolved: 5, Refunded: 6 } as const;

export function makeEscrowReader(client: ReadClientLike, escrow: string) {
  const address = escrow as `0x${string}`;
  return {
    async machineOccupied(machineKeyHash: Hex): Promise<boolean> {
      return (await client.readContract({ address, abi: ABI, functionName: "machineOccupied", args: [machineKeyHash] })) as boolean;
    },
    /** 0 = chưa có booking trên chuỗi (None). */
    async stateOf(bookingId: Hex): Promise<number> {
      return Number(await client.readContract({ address, abi: ABI, functionName: "stateOf", args: [bookingId] }));
    },
  };
}
export type EscrowReader = ReturnType<typeof makeEscrowReader>;

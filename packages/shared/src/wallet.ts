/**
 * Chứng minh sở hữu ví (EOA) bằng chữ ký EIP-191. Server tự dựng lại thông điệp từ challenge đã lưu
 * (không tin thông điệp client gửi). Không import tương đối.
 * Ví hợp đồng (EIP-1271) chưa hỗ trợ: chữ ký không phải 65 byte bị từ chối.
 */
import { getAddress, isAddress, isHex, recoverMessageAddress, type Address, type Hex } from "viem";

export interface WalletChallengeFields {
  domain: string;
  uri: string;
  address: string;
  chainId: number;
  userId: string;
  nonce: string;
  issuedAt: string; // ISO
  expiresAt: string; // ISO
}

export function walletMessage(c: WalletChallengeFields): string {
  if (!isAddress(c.address, { strict: false })) throw new Error("địa chỉ ví không hợp lệ");
  return [
    `${c.domain} yêu cầu bạn xác minh sở hữu ví để liên kết với tài khoản Cloud PC Companion.`,
    "Chỉ là chữ ký xác minh: không gửi giao dịch, không tốn phí, không cấp quyền chi tiêu.",
    "",
    `URI: ${c.uri}`,
    `Địa chỉ: ${getAddress(c.address)}`,
    `Chain ID: ${c.chainId}`,
    `Tài khoản: ${c.userId}`,
    `Nonce: ${c.nonce}`,
    `Phát hành lúc: ${c.issuedAt}`,
    `Hết hạn: ${c.expiresAt}`,
  ].join("\n");
}

export async function verifyWalletSignature(message: string, signature: string, expected: string): Promise<boolean> {
  if (!isHex(signature, { strict: true }) || signature.length !== 132) return false; // EOA: 65 byte
  try {
    const who: Address = await recoverMessageAddress({ message, signature: signature as Hex });
    return who.toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

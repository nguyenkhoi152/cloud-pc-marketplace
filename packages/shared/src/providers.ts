/**
 * Interfaces ranh giới. M1 chỉ có kiểu; adapter thật ở M3–M5.
 * Preview không cấp quyền thật.
 */

export interface Quote {
  bookingId: string;
  machineId: string;
  amountUnits: bigint;
  durationSeconds: number;
  expiresAt: number;
}
export interface Receipt {
  txHash: string;
  chainId: number;
  blockNumber: bigint;
  confirmed: boolean;
}
export interface OnchainBooking {
  bookingId: string;
  state: string;
  startedAt?: number;
  endAt?: number;
}

export interface PaymentProvider {
  quote(bookingId: string): Promise<Quote>;
  fund(quote: Quote): Promise<Receipt>;
  readReceipt(txHash: string): Promise<Receipt | null>;
  readBooking(bookingId: string): Promise<OnchainBooking | null>;
  withdrawCredit(account: string): Promise<Receipt>;
  reconcile(bookingId: string): Promise<OnchainBooking | null>;
}

/** Mọi hành động idempotent theo (bookingId, actionId). Không có shell tuỳ ý. */
export interface RemoteActionInput {
  bookingId: string;
  actionId: string;
}
export type RemoteResult =
  | { ok: true; evidence: string }
  | { ok: false; reason: string; unknown?: boolean }; // Unknown không coi là thành công

export interface RemoteSessionProvider {
  health(machineId: string): Promise<RemoteResult>;
  prepare(i: RemoteActionInput): Promise<RemoteResult>;
  grant(i: RemoteActionInput): Promise<RemoteResult>;
  inspect(i: RemoteActionInput): Promise<RemoteResult>;
  revoke(i: RemoteActionInput): Promise<RemoteResult>;
  reset(i: RemoteActionInput): Promise<RemoteResult>;
  verifyReset(i: RemoteActionInput): Promise<RemoteResult>;
}

export interface ObjectStat {
  key: string;
  size: number;
  sha256: string;
}
/** Driver lưu trữ thuần: auth/lease/quota/manifest thuộc WorkspaceService, không thuộc driver. */
export interface WorkspaceStore {
  put(key: string, data: Uint8Array): Promise<ObjectStat>;
  get(key: string): Promise<Uint8Array | null>;
  stat(key: string): Promise<ObjectStat | null>;
  delete(key: string): Promise<void>;
}

export interface RecommendationQuery {
  maxPrice?: string; // PCP dạng chuỗi thập phân
  minRamGb?: number;
  minVramGb?: number;
  apps?: string[];
}
export interface Recommendation {
  machineId: string;
  reasons: string[];
}
/** Chỉ đọc catalog; mặc định rule/filter, không LLM, không quyền giao dịch. */
export interface RecommendationProvider {
  recommend(q: RecommendationQuery): Promise<Recommendation[]>;
}

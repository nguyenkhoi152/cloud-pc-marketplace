import { z } from "zod";

export const PCP_DECIMALS = 18;
export const DEMO_PACKAGE = {
  durationSeconds: 900,
  pricePcp: "20",
  feeBps: 1000,
} as const;

/** Supply cap demo: 1.000.000 PCP. Mọi số tiền hợp lệ nằm trong (0, cap]. */
export const PCP_SUPPLY_CAP_UNITS = 1_000_000n * 10n ** 18n;

/**
 * Parse chuỗi thập phân PCP -> base units (bigint). Không dùng number.
 * Chấp nhận: "0", "20", "0.5", "1.123456789012345678". Từ chối: dấu +/-, khoảng trắng,
 * số mũ, dấu phẩy, số 0 đầu thừa, quá 18 chữ số thập phân, vượt supply cap.
 */
export function parsePcp(input: string): bigint {
  if (typeof input !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(input)) {
    throw new RangeError("Số PCP không hợp lệ (cần chuỗi thập phân không âm, tối đa 18 chữ số thập phân)");
  }
  const [whole, frac = ""] = input.split(".");
  const units = BigInt(whole as string) * 10n ** 18n + BigInt(frac.padEnd(18, "0"));
  if (units > PCP_SUPPLY_CAP_UNITS) throw new RangeError("Số PCP vượt giới hạn supply cap");
  return units;
}

/** Số tiền giao dịch phải > 0. */
export function parsePositivePcp(input: string): bigint {
  const u = parsePcp(input);
  if (u === 0n) throw new RangeError("Số PCP phải lớn hơn 0");
  return u;
}

/** base units -> chuỗi thập phân chính xác, bỏ số 0 thừa cuối. */
export function formatPcp(units: bigint): string {
  if (units < 0n) throw new RangeError("Số PCP âm");
  const whole = units / 10n ** 18n;
  const frac = (units % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export const pcpDecimalString = z.string().refine((s) => {
  try {
    return parsePositivePcp(s) > 0n;
  } catch {
    return false;
  }
}, "PCP không hợp lệ");

export const machineStatus = z.enum(["draft", "review", "approved", "suspended"]);
export type MachineStatus = z.infer<typeof machineStatus>;

export const machineSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostName: z.string(),
  status: machineStatus,
  cpu: z.string(),
  ramGb: z.number().int().positive(),
  gpu: z.string().nullable(),
  vramGb: z.number().int().nonnegative(),
  os: z.string(),
  apps: z.array(z.string()),
  region: z.string(),
  pricePcp: pcpDecimalString,
  windowHours: z.number().min(4),
  workspaceCompatible: z.boolean(),
  lastCheckedAt: z.string(),
  // M1: không khẳng định máy online khi chưa có heartbeat thật.
  online: z.literal("unknown"),
});
export type Machine = z.infer<typeof machineSchema>;

export const remoteState = z.enum([
  "Preparing", "Ready", "Connecting", "Active", "Disconnected", "Expired", "Revoking", "CleanupFailed",
]);
export const cloudState = z.enum(["NotEnabled", "Restoring", "Syncing", "Saved", "Failed"]);
export type RemoteState = z.infer<typeof remoteState>;
export type CloudState = z.infer<typeof cloudState>;

export const machineFilterSchema = z.object({
  q: z.string().optional(),
  minRamGb: z.coerce.number().optional(),
  minVramGb: z.coerce.number().optional(),
  maxPrice: pcpDecimalString.optional(),
  os: z.string().optional(),
  region: z.string().optional(),
  workspaceOnly: z.boolean().optional(),
});
export type MachineFilter = z.infer<typeof machineFilterSchema>;

export function filterMachines(list: Machine[], f: MachineFilter): Machine[] {
  const q = f.q?.trim().toLowerCase();
  return list.filter((m) => {
    if (q && !`${m.name} ${m.cpu} ${m.gpu ?? ""} ${m.apps.join(" ")}`.toLowerCase().includes(q)) return false;
    if (f.minRamGb !== undefined && m.ramGb < f.minRamGb) return false;
    if (f.minVramGb !== undefined && m.vramGb < f.minVramGb) return false;
    if (f.maxPrice !== undefined && parsePcp(m.pricePcp) > parsePcp(f.maxPrice)) return false;
    if (f.os && m.os !== f.os) return false;
    if (f.region && m.region !== f.region) return false;
    if (f.workspaceOnly && !m.workspaceCompatible) return false;
    return true;
  });
}

/** Phí tính trên gross trả host (bps), làm tròn xuống; fee + host luôn bằng gross. */
export function splitFee(grossUnits: bigint, feeBps: number): { fee: bigint; host: bigint } {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new RangeError("feeBps phải là số nguyên trong 0..10000");
  }
  const fee = (grossUnits * BigInt(feeBps)) / 10_000n;
  return { fee, host: grossUnits - fee };
}

/**
 * Lõi dùng chung của API server và worker: truy cập DB với quyền service_role, lỗi API, xác thực người dùng, cấu hình.
 * Server KHÔNG dùng service-role key của Supabase REST: nó kết nối Postgres trực tiếp (SUPABASE_DB_URL, chỉ ở môi trường
 * server) rồi `set local role service_role` trong từng transaction → đúng quyền đã cấp, không hơn.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type pg from "pg";
import { mnemonicToAccount, privateKeyToAccount, type LocalAccount } from "viem/accounts";
import type { ChainClientLike } from "@cpm/shared/src/chainEvents";

export interface Tx {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}
export interface ServiceDb {
  /** Một transaction với `set local role service_role`; commit nếu fn xong, rollback nếu ném lỗi. */
  tx<T>(fn: (c: Tx) => Promise<T>): Promise<T>;
}

/**
 * Cấu hình TLS cho kết nối Postgres từ biến môi trường server.
 *  - localhost/127.0.0.1: không TLS (dev).
 *  - SUPABASE_DB_CA=<đường dẫn file PEM>: xác minh bằng CA đó (khuyến nghị nếu chuỗi chứng chỉ không nằm trong kho tin cậy của Node).
 *  - SUPABASE_DB_SSL=no-verify: KHÔNG xác minh chứng chỉ (phương án cuối, mở cửa cho MITM; chỉ để thử).
 *  - mặc định: xác minh bằng kho tin cậy của Node.
 */
export function dbSsl(connectionString: string, env: Record<string, string | undefined>): pg.PoolConfig["ssl"] {
  if (/@(localhost|127\.0\.0\.1)(:|\/)/.test(connectionString)) return undefined;
  const ca = env.SUPABASE_DB_CA?.trim();
  if (ca) return { ca: readFileSync(ca, "utf8"), rejectUnauthorized: true };
  if (env.SUPABASE_DB_SSL === "no-verify") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

/**
 * BẮT BUỘC cho mọi pg.Pool chạy lâu (worker, API): máy chủ Postgres/pooler có thể đóng kết nối nhàn rỗi bất cứ lúc nào, khi đó
 * `pg` phát sự kiện 'error' trên client. Không có listener thì Node coi là lỗi không bắt được và THOÁT TIẾN TRÌNH (đã xảy ra thật
 * 12/11/2026 với `read ECONNRESET`, làm worker chết và phiên mồ côi không bao giờ được `claim_after_grace`). Có listener thì pg gỡ
 * client hỏng khỏi pool và lần truy vấn sau dùng kết nối mới. Chỉ ghi mã lỗi + thông điệp ngắn: không bao giờ ghi chuỗi kết nối.
 */
export function guardPool<T extends Pick<pg.Pool, "on">>(pool: T, log: (m: string) => void = (m) => console.error(m)): T {
  pool.on("error", (e: Error & { code?: string }) => {
    const msg = String(e?.message ?? e).replace(/postgres(?:ql)?:\/\/\S+/gi, "[chuỗi kết nối đã ẩn]").slice(0, 120);
    log(`pg pool: kết nối nhàn rỗi bị đóng (${e?.code ?? "không rõ mã"}): ${msg}; sẽ dùng kết nối mới`);
  });
  return pool;
}

export function pgServiceDb(pool: pg.Pool): ServiceDb {
  return {
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("set local role service_role");
        const out = await fn(c as unknown as Tx);
        await c.query("commit");
        return out;
      } catch (e) {
        await c.query("rollback").catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
  };
}

/** Lỗi nghiệp vụ trả về client với mã HTTP và mã máy đọc được; thông điệp không chứa secret. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiResult {
  status: number;
  body: unknown;
}
export const ok = (body: unknown, status = 200): ApiResult => ({ status, body });

export interface ApiUser {
  id: string;
  email: string | null;
}

export interface ServerConfig {
  supabaseUrl: string;
  anonKey: string;
  chainId: number;
  escrow: string;
  pcp: string;
  treasury: string;
  quoteSigner: LocalAccount;
  minConfirmations: number;
  graceSeconds: number;
  arbitrationSeconds: number;
  configVersion: number;
  walletDomain: string;
  walletUri: string;
  allowedOrigins: string[];
  /** RPC CÔNG KHAI cho app (không chứa khoá API riêng). Fuji: PUBLIC_RPC_URL; chuỗi cục bộ: tự lấy từ RPC_URL nếu là loopback. */
  publicRpcUrl?: string;
}

export interface Deps {
  db: ServiceDb;
  cfg: ServerConfig;
  chain?: ChainClientLike;
  /** Đồng hồ (ms epoch) — chỉ dùng cho kiểm tra phía JS; mốc hết hạn lưu trữ luôn tính bằng now() của DB. */
  now?: () => number;
}

/** RPC chỉ ở máy này (http loopback). Mọi dạng khác (https, IP mạng, tên miền) coi là mạng từ xa. */
export const isLoopbackRpc = (url: string | undefined) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/.*)?$/.test((url ?? "").trim());

/**
 * 20 tài khoản mặc định của Hardhat/Anvil sinh từ mnemonic CÔNG KHAI "test test … junk": ai cũng biết khoá riêng.
 * Chỉ được dùng làm khoá ký của server/worker khi RPC là loopback (chuỗi mô phỏng cục bộ). Trỏ tới mạng từ xa ⇒ từ chối khởi động.
 */
let publicDevAddresses: Set<string> | null = null;
export function isPublicDevAddress(address: string): boolean {
  publicDevAddresses ??= new Set(Array.from({ length: 20 }, (_, i) => mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: i }).address.toLowerCase()));
  return publicDevAddresses.has(address.toLowerCase());
}
/** Trả lý do từ chối (chỉ nêu TÊN biến) nếu khoá thử công khai bị dùng với RPC không phải loopback; null nếu ổn. */
export function publicDevKeyProblem(name: string, address: string, rpcUrl: string | undefined): string | null {
  if (!isPublicDevAddress(address)) return null;
  if (!rpcUrl?.trim() || isLoopbackRpc(rpcUrl)) return null;
  return `${name} (là khoá thử CÔNG KHAI của Hardhat: chỉ được dùng khi RPC_URL là loopback, không dùng với mạng từ xa)`;
}

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
export const sha256Bytes = (s: string) => createHash("sha256").update(s).digest();
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Trích thông báo `raise exception 'xxx'` của Postgres. */
export const pgMessage = (e: unknown) => String((e as { message?: string }).message ?? e);

/**
 * Xác thực người dùng bằng token Supabase Auth (GET /auth/v1/user) — chỉ cần anon key công khai.
 * Trả null nếu thiếu/sai/hết hạn. Không tin vai trò từ token: mọi quyền do DB kiểm.
 */
export async function authenticate(authorization: string | null | undefined, cfg: Pick<ServerConfig, "supabaseUrl" | "anonKey">, fetchImpl: typeof fetch = fetch): Promise<ApiUser | null> {
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/.exec(authorization ?? "");
  if (!m) return null;
  let r: Response;
  try {
    r = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { apikey: cfg.anonKey, authorization: `Bearer ${m[1]}` } });
  } catch {
    throw new ApiError(503, "auth_unavailable", "Không kết nối được dịch vụ xác thực.");
  }
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new ApiError(503, "auth_unavailable", "Dịch vụ xác thực trả lỗi.");
  const u = (await r.json()) as { id?: unknown; email?: unknown };
  return typeof u.id === "string" && /^[0-9a-f-]{36}$/.test(u.id) ? { id: u.id, email: typeof u.email === "string" ? u.email : null } : null;
}

export const requireUser = (u: ApiUser | null): ApiUser => {
  if (!u) throw new ApiError(401, "unauthorized", "Cần đăng nhập.");
  return u;
};

/** Đọc cấu hình server từ biến môi trường; thiếu/sai thì liệt kê TÊN biến (không bao giờ in giá trị). */
export function loadServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const bad: string[] = [];
  const get = (k: string) => {
    const v = (env[k] ?? "").trim();
    if (!v) bad.push(`${k} (thiếu)`);
    return v;
  };
  const addr = (k: string) => {
    const v = get(k);
    if (v && !/^0x[0-9a-fA-F]{40}$/.test(v)) bad.push(`${k} (không phải địa chỉ)`);
    return v;
  };
  const num = (k: string, d?: number) => {
    const raw = env[k]?.trim();
    if (!raw && d !== undefined) return d;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) bad.push(`${k} (không phải số nguyên)`);
    return n;
  };
  const supabaseUrl = get("SUPABASE_URL").replace(/\/+$/, "");
  const anonKey = get("SUPABASE_ANON_KEY");
  const key = get("QUOTE_SIGNER_PRIVATE_KEY");
  let quoteSigner: LocalAccount | null = null;
  if (key) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) bad.push("QUOTE_SIGNER_PRIVATE_KEY (sai định dạng)");
    else quoteSigner = privateKeyToAccount(key as `0x${string}`);
  }
  // Fail-closed: khoá thử công khai + RPC từ xa (ví dụ lỡ trỏ demo cục bộ sang Fuji/mainnet) ⇒ không khởi động.
  const devKey = quoteSigner && publicDevKeyProblem("QUOTE_SIGNER_PRIVATE_KEY", quoteSigner.address, env.RPC_URL);
  if (devKey) bad.push(devKey);
  const cfg = {
    supabaseUrl,
    anonKey,
    chainId: num("CHAIN_ID", 43113),
    escrow: addr("ESCROW_ADDRESS"),
    pcp: addr("PCP_ADDRESS"),
    treasury: addr("TREASURY_ADDRESS"),
    minConfirmations: num("MIN_CONFIRMATIONS", 2),
    graceSeconds: num("GRACE_SECONDS", 600),
    arbitrationSeconds: num("ARBITRATION_SECONDS", 86_400),
    configVersion: num("CONFIG_VERSION", 1),
    walletDomain: get("WALLET_DOMAIN"),
    walletUri: get("WALLET_URI"),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    publicRpcUrl: undefined as string | undefined,
  };
  // RPC công khai: https, hoặc http loopback (chuỗi cục bộ). Không bao giờ lấy RPC_URL từ xa làm công khai (có thể chứa khoá API riêng).
  const pubRaw = env.PUBLIC_RPC_URL?.trim();
  if (pubRaw) {
    if (/^https:\/\/[^\s/]+(\/\S*)?$/.test(pubRaw) || isLoopbackRpc(pubRaw)) cfg.publicRpcUrl = pubRaw;
    else bad.push("PUBLIC_RPC_URL (phải là https:// hoặc http loopback)");
  } else if (isLoopbackRpc(env.RPC_URL)) cfg.publicRpcUrl = env.RPC_URL!.trim();
  if (bad.length || !quoteSigner) throw new Error(`Cấu hình server chưa đủ/đúng: ${bad.join(", ")}`);
  return { ...cfg, quoteSigner };
}

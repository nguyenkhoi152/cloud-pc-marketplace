/**
 * Điểm vào worker thường trực. Fail-closed: thiếu/sai cấu hình thì thoát với danh sách TÊN biến (không in giá trị).
 * Provider remote hiện là "chưa có host-agent": mọi bước cần host trả Unknown → job thử lại, máy giữ nguyên bị khoá.
 * Không có bản giả nào được dùng ở đây.
 */
import pg from "pg";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { makeControlPlaneProvider } from "./api/agent";
import { makeViemOperator } from "./chainOperator";
import { makeEscrowReader } from "./chainReader";
import { dbSsl, guardPool, loadServerConfig, pgServiceDb, publicDevKeyProblem } from "./core";
import { runForever, type SessionProvider, type WorkerDeps } from "./worker";

const unavailable = async () => ({ ok: false as const, unknown: true, reason: "host-agent chưa được nối" });
export const noHostProvider: SessionProvider = { prepare: unavailable, grant: unavailable, revoke: unavailable, reset: unavailable, verifyReset: unavailable };

/**
 * WORKER_PROVIDER=agent: giao lệnh prepare/grant/revoke/reset cho host-agent qua kênh lệnh trong DB và chờ kết quả (agent im lặng ⇒ Unknown,
 * không bao giờ thành công). Mặc định (không đặt) là "chưa có host-agent" ⇒ mọi bước cần host trả Unknown. Không có chế độ giả thành công.
 */
export function pickProvider(env: Record<string, string | undefined>, db: WorkerDeps["db"]): SessionProvider {
  const mode = env.WORKER_PROVIDER?.trim();
  if (!mode) return noHostProvider;
  if (mode !== "agent") throw new Error("Cấu hình worker chưa đúng: WORKER_PROVIDER (chỉ hỗ trợ agent)");
  const timeoutMs = Number(env.AGENT_COMMAND_TIMEOUT_MS ?? 45_000);
  const pollMs = Number(env.AGENT_COMMAND_POLL_MS ?? 500);
  if (!(timeoutMs >= 1_000 && timeoutMs <= 600_000) || !(pollMs >= 50 && pollMs <= 10_000)) throw new Error("Cấu hình worker chưa đúng: AGENT_COMMAND_TIMEOUT_MS/AGENT_COMMAND_POLL_MS (ngoài khoảng cho phép)");
  return makeControlPlaneProvider(db, { timeoutMs, pollMs });
}

export async function main(env: Record<string, string | undefined> = process.env) {
  const cfg = loadServerConfig(env);
  const need = ["SUPABASE_DB_URL", "RPC_URL", "OPERATOR_PRIVATE_KEY"].filter((k) => !env[k]?.trim());
  if (need.length) throw new Error(`Cấu hình worker chưa đủ: ${need.join(", ")} (thiếu)`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.OPERATOR_PRIVATE_KEY!.trim())) throw new Error("Cấu hình worker chưa đúng: OPERATOR_PRIVATE_KEY (sai định dạng)");
  const operatorAccount = privateKeyToAccount(env.OPERATOR_PRIVATE_KEY!.trim() as `0x${string}`);
  const devKey = publicDevKeyProblem("OPERATOR_PRIVATE_KEY", operatorAccount.address, env.RPC_URL);
  if (devKey) throw new Error(`Cấu hình worker chưa đúng: ${devKey}`);
  const pool = guardPool(new pg.Pool({ connectionString: env.SUPABASE_DB_URL, max: 4, ssl: dbSsl(env.SUPABASE_DB_URL!, env) }), (m) => console.error(m));
  const transport = http(env.RPC_URL!.trim());
  const publicClient = createPublicClient({ transport });
  const wallet = createWalletClient({ account: operatorAccount, transport });
  const deps: WorkerDeps = {
    db: pgServiceDb(pool), cfg,
    escrowReader: makeEscrowReader(publicClient as never, cfg.escrow),
    operator: makeViemOperator(wallet as never, cfg.escrow),
    provider: pickProvider(env, pgServiceDb(pool)),
    chainLogs: publicClient as never,
    workerId: env.WORKER_ID?.trim() || `worker-${process.pid}`,
    deployBlock: BigInt(env.ESCROW_DEPLOY_BLOCK?.trim() || "0"),
    expireMarginSeconds: Number(env.EXPIRE_MARGIN_SECONDS ?? 120),
    leaseSeconds: Number(env.LEASE_SECONDS ?? 60),
  };
  const ac = new AbortController();
  process.on("SIGINT", () => ac.abort());
  process.on("SIGTERM", () => ac.abort());
  await runForever(deps, { intervalMs: Number(env.WORKER_INTERVAL_MS ?? 5000), signal: ac.signal, log: (m) => console.log(m) });
  await pool.end();
}

if (process.argv[1] && /workerMain\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}

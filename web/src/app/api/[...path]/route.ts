/**
 * Cổng API cho app Companion (xem server/ để biết logic). Chỉ chạy trên Node (cần Postgres trực tiếp).
 * Cấu hình thiếu/sai → 503 chỉ nêu TÊN biến, không lộ giá trị. Không có service-role key Supabase: server nối Postgres
 * (SUPABASE_DB_URL, chỉ ở môi trường server) và `set local role service_role` trong từng transaction.
 */
import pg from "pg";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApiHandler, dbSsl, guardPool, LocalFsStore, loadServerConfig, makeEscrowReader, makeViemFaucetChain, pgServiceDb, publicDevKeyProblem, type HttpDeps } from "@cpm/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cached: { handler: (req: Request) => Promise<Response> } | { error: string } | null = null;

function build() {
  try {
    const cfg = loadServerConfig(process.env);
    const dbUrl = process.env.SUPABASE_DB_URL?.trim();
    const rpc = process.env.RPC_URL?.trim();
    const missing = [!dbUrl && "SUPABASE_DB_URL (thiếu)", !rpc && "RPC_URL (thiếu)"].filter(Boolean);
    if (missing.length) throw new Error(`Cấu hình server chưa đủ/đúng: ${missing.join(", ")}`);
    const pool = guardPool(new pg.Pool({ connectionString: dbUrl, max: 5, ssl: dbSsl(dbUrl!, process.env) }), (m) => console.error(m));
    const client = createPublicClient({ transport: http(rpc) });
    // Kho workspace cục bộ chỉ cho dev (WORKSPACE_DIR). Không dùng filesystem của Vercel cho dữ liệu bền vững; S3 là adapter sau.
    const store = process.env.WORKSPACE_DIR?.trim() ? new LocalFsStore(process.env.WORKSPACE_DIR.trim()) : undefined;
    // Vòi testnet (tuỳ chọn): chỉ bật khi có FAUCET_PRIVATE_KEY (khoá có ISSUER_ROLE trên PCP, chỉ ở môi trường server). Khoá thử công khai của Hardhat bị từ chối với RPC từ xa.
    let faucet: HttpDeps["faucet"];
    const fk = process.env.FAUCET_PRIVATE_KEY?.trim();
    if (fk) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(fk)) throw new Error("Cấu hình server chưa đủ/đúng: FAUCET_PRIVATE_KEY (sai định dạng)");
      const account = privateKeyToAccount(fk as `0x${string}`);
      const problem = publicDevKeyProblem("FAUCET_PRIVATE_KEY", account.address, rpc);
      if (problem) throw new Error(`Cấu hình server chưa đủ/đúng: ${problem}`);
      const gasAvax = process.env.FAUCET_GAS_AVAX?.trim() || "0.05";
      if (!/^\d{1,3}(\.\d{1,6})?$/.test(gasAvax)) throw new Error("Cấu hình server chưa đủ/đúng: FAUCET_GAS_AVAX (sai định dạng)");
      faucet = { chain: makeViemFaucetChain(client as never, createWalletClient({ account, transport: http(rpc) }) as never, cfg.pcp), gasWei: parseEther(gasAvax), minGasWei: parseEther("0.01") };
    }
    const deps: HttpDeps = { store, db: pgServiceDb(pool), cfg, faucet, chain: client as unknown as HttpDeps["chain"], escrowReader: makeEscrowReader(client as never, cfg.escrow), log: (m) => console.error(m) };
    return { handler: createApiHandler(deps) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function handle(req: Request): Promise<Response> {
  cached ??= build();
  if ("error" in cached) {
    const failed = build(); // thử lại: người dùng có thể vừa sửa env
    if ("error" in failed) return Response.json({ error: { code: "server_not_configured", message: failed.error } }, { status: 503, headers: { "cache-control": "no-store" } });
    cached = failed;
  }
  return cached.handler(req);
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as OPTIONS };

/**
 * Bộ định tuyến HTTP (Web Request/Response) dùng chung cho Next.js route và test. Không phụ thuộc framework.
 * Mặc định từ chối: CORS chỉ cho origin trong ALLOWED_ORIGINS; body tối đa 16 KB; lỗi lạ không lộ chi tiết.
 */
import { connectToSession, pollCommands, reportCommand } from "./api/agent";
import { requestFaucet, type FaucetDeps } from "./api/faucet";
import { issueQuote } from "./api/quote";
import { createEnrollment, heartbeat, redeemEnrollment, revokeDevice } from "./api/enrollment";
import { reconcileByTx } from "./api/reconcile";
import { walletChallenge, walletVerify } from "./api/wallet";
import { acquireLease, commitWorkspace, createWorkspace, deleteWorkspace, putObject, readManifest, readObject, releaseLease, type WorkspaceStore } from "./workspace";
import type { EscrowReader } from "./chainReader";
import { ApiError, authenticate, requireUser, type ApiResult, type Deps } from "./core";

const MAX_BODY = 16 * 1024;

export interface HttpDeps extends Deps {
  store?: WorkspaceStore;
  maxObjectBytes?: number;
  escrowReader?: EscrowReader;
  /** Vòi testnet (tắt nếu không có). */
  faucet?: FaucetDeps;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

function cors(req: Request, deps: HttpDeps): Record<string, string> {
  const origin = req.headers.get("origin");
  const h: Record<string, string> = { vary: "origin" };
  if (origin && deps.cfg.allowedOrigins.includes(origin)) {
    h["access-control-allow-origin"] = origin;
    h["access-control-allow-headers"] = "authorization, content-type";
    h["access-control-allow-methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    h["access-control-max-age"] = "600";
  }
  return h;
}

/**
 * Đọc body có trần BYTE, theo luồng: dừng và huỷ luồng ngay khi vượt trần (không nạp hết vào bộ nhớ rồi mới kiểm,
 * kể cả khi thiếu/khai sai Content-Length hoặc dùng chunked). Chạy trước xác thực nên phải rẻ với người gửi xấu.
 */
async function readCapped(req: Request, max: number, tooLarge: () => ApiError): Promise<Uint8Array> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > max) throw tooLarge();
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

async function readJson(req: Request): Promise<unknown> {
  if (req.method === "GET" || req.method === "DELETE") return undefined;
  const bytes = await readCapped(req, MAX_BODY, () => new ApiError(413, "too_large", "Nội dung yêu cầu quá lớn."));
  const text = new TextDecoder().decode(bytes);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "bad_json", "JSON không hợp lệ.");
  }
}

function workspaceDeps(deps: HttpDeps): HttpDeps & { store: WorkspaceStore } {
  if (!deps.store) throw new ApiError(503, "storage_unavailable", "Kho workspace chưa được cấu hình.");
  return deps as HttpDeps & { store: WorkspaceStore };
}

async function route(req: Request, deps: HttpDeps): Promise<ApiResult> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const key = `${req.method} ${path}`;
  const auth = req.headers.get("authorization");
  const user = () => authenticate(auth, deps.cfg, deps.fetchImpl).then(requireUser);

  if (key === "GET /api/health") return { status: 200, body: { ok: true } };
  // Thông tin chuỗi công khai (không bí mật): app cần địa chỉ escrow để gọi accept/cancel và địa chỉ PCP để đọc số dư.
  if (key === "GET /api/chain-info") return { status: 200, body: { chainId: deps.cfg.chainId, escrow: deps.cfg.escrow, pcp: deps.cfg.pcp, ...(deps.cfg.publicRpcUrl ? { rpcUrl: deps.cfg.publicRpcUrl } : {}), faucet: !!deps.faucet } };

  // Workspace: nhị phân (tải/đọc object) xử lý trước khi đọc JSON.
  const wsObj = /^(PUT|GET) \/api\/workspaces\/([0-9a-f-]{36})\/objects\/([0-9a-f]{64})$/.exec(key);
  if (wsObj) {
    const ws = workspaceDeps(deps);
    if (wsObj[1] === "PUT") {
      const max = ws.maxObjectBytes ?? 8 * 1024 * 1024;
      // Cần có credential dạng Lease trước khi nhận byte (kiểm đầy đủ vẫn ở putObject); trần byte theo luồng.
      if (!/^Lease [A-Za-z0-9_-]{20,200}$/.test(auth ?? "")) throw new ApiError(401, "unauthorized", "Thiếu lease workspace.");
      const buf = await readCapped(req, max, () => new ApiError(413, "object_too_large", "Tệp vượt giới hạn một lần tải."));
      return putObject(ws, wsObj[2], wsObj[3], auth, buf);
    }
    const r = await readObject(ws, wsObj[2], wsObj[3], auth);
    return { status: r.status, body: r.data };
  }
  const body = await readJson(req);
  if (key === "POST /api/faucet") return requestFaucet(deps, await user());
  if (key === "POST /api/wallet/challenge") return walletChallenge(deps, await user(), body);
  if (key === "POST /api/wallet/verify") return walletVerify(deps, await user(), body);
  // Chủ máy tự ghi danh/thu hồi thiết bị của MÁY MÌNH (đi qua proxy công khai). Quyền kiểm ở DB: người lạ nhận 403.
  if (key === "POST /api/host/enrollments") return createEnrollment(deps, await user(), body);
  if (key === "POST /api/host/devices/revoke") return revokeDevice(deps, await user(), body);
  // Cùng hàm DB; đường admin giữ cho script quản trị chạy trên máy chủ (proxy công khai chặn /api/admin/*).
  if (key === "POST /api/admin/enrollments") return createEnrollment(deps, await user(), body);
  if (key === "POST /api/admin/devices/revoke") return revokeDevice(deps, await user(), body);
  if (key === "POST /api/agent/enroll") return redeemEnrollment(deps, body);
  if (key === "POST /api/agent/heartbeat") return heartbeat(deps, auth, body);
  if (key === "GET /api/agent/commands") return pollCommands(deps, auth);
  const rc = /^POST \/api\/agent\/commands\/([0-9]{1,18})\/result$/.exec(key);
  if (rc) return reportCommand(deps, auth, rc[1], body);
  if (key === "POST /api/workspaces") return createWorkspace(workspaceDeps(deps), await user(), body);
  const w = /^(POST|GET|DELETE) \/api\/workspaces\/([0-9a-f-]{36})(?:\/(lease|commit|release|versions\/(\d{1,6})))?$/.exec(key);
  if (w) {
    const ws = workspaceDeps(deps);
    if (w[1] === "POST" && w[3] === "lease") return acquireLease(ws, await user(), w[2], body);
    if (w[1] === "POST" && w[3] === "commit") return commitWorkspace(ws, w[2], auth, body);
    if (w[1] === "POST" && w[3] === "release") return releaseLease(ws, w[2], auth);
    if (w[1] === "GET" && w[4]) return readManifest(ws, w[2], Number(w[4]), auth);
    if (w[1] === "DELETE" && !w[3]) return deleteWorkspace(ws, await user(), w[2]);
  }
  const m = /^POST \/api\/bookings\/([0-9a-f-]{36})\/(quote|reconcile|connect)$/.exec(key);
  if (m?.[2] === "quote") return issueQuote(deps, await user(), m[1], deps.escrowReader);
  if (m?.[2] === "connect") return connectToSession(deps, await user(), m[1]);
  if (m?.[2] === "reconcile") return reconcileByTx(deps, await user(), m[1], (body as { txHash?: unknown } | null)?.txHash);
  throw new ApiError(404, "not_found", "Không có đường dẫn này.");
}

export function createApiHandler(deps: HttpDeps) {
  return async (req: Request): Promise<Response> => {
    const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(req, deps) };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      const r = await route(req, deps);
      if (r.body instanceof Uint8Array) return new Response(r.body as unknown as ArrayBuffer, { status: r.status, headers: { ...headers, "content-type": "application/octet-stream" } });
      return new Response(JSON.stringify(r.body), { status: r.status, headers });
    } catch (e) {
      if (e instanceof ApiError) return new Response(JSON.stringify({ error: { code: e.code, message: e.message } }), { status: e.status, headers });
      deps.log?.(`api_error ${req.method} ${new URL(req.url).pathname}: ${(e as Error).message.slice(0, 200)}`);
      return new Response(JSON.stringify({ error: { code: "internal", message: "Lỗi máy chủ." } }), { status: 500, headers });
    }
  };
}

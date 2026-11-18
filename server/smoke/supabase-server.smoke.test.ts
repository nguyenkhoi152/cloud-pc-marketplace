/**
 * SMOKE: API server + DB trên Supabase dev THẬT. Dùng đúng code của server (core, wallet, quote, enrollment, agent, workspace).
 * KHÔNG dùng chuỗi khối (địa chỉ contract là giả, khoá ký quote sinh ngẫu nhiên, chưa Fuji) và KHÔNG áp dụng sự kiện chuỗi giả
 * lên dữ liệu thật. Không xoá/reset dữ liệu. Không tạo tài khoản mới. Không in URL/khoá/mật khẩu/chuỗi kết nối.
 *
 * Quy tắc kết quả như smoke Supabase trước: KHÔNG skip. Thiếu cấu hình/tiền điều kiện → test ĐỎ kèm việc cần làm.
 * Cần: web/.env.local có SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_DB_URL; đã áp dụng migration 000003–000006;
 * và (cho bước quote) một booking `reserved` còn hạn của renter smoke → chạy `npm run smoke:supabase` ngay trước đó.
 */
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { quoteDomain, recoverQuoteSigner, type Quote } from "@cpm/shared/src/quote";
import { ApiError, authenticate, dbSsl, pgServiceDb, type ApiUser, type Deps, type ServerConfig } from "../src/core";
import { createEnrollment, heartbeat, redeemEnrollment } from "../src/api/enrollment";
import { issueQuote } from "../src/api/quote";
import { walletChallenge, walletVerify } from "../src/api/wallet";
import { acquireLease, createWorkspace } from "../src/workspace";

const SMOKE = path.resolve(process.cwd(), "../desktop/.env.smoke.local");
const kv = (f: string) => (existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])) : {});
const smoke = kv(SMOKE);
const URL_ = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const DB_URL = process.env.SUPABASE_DB_URL ?? "";

const st: { pool?: pg.Pool; deps?: Deps; users: Record<string, ApiUser>; tokens: Record<string, string> } = { users: {}, tokens: {} };
const need = (...k: ("deps" | "users")[]) => {
  if (k.includes("deps") && !st.deps) throw new Error("CHƯA ĐẠT — kết nối DB/cấu hình chưa sẵn sàng (xem test 0).");
  if (k.includes("users") && !st.users.renter) throw new Error("CHƯA ĐẠT — chưa xác thực được tài khoản smoke (xem test 2).");
};
const rejects = async (p: Promise<unknown>, status: number, code: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e, `kỳ vọng ${status}/${code}`).toBeInstanceOf(ApiError);
  expect([(e as ApiError).status, (e as ApiError).code]).toEqual([status, code]);
};
const signIn = async (role: string) => {
  const email = smoke[`SMOKE_${role}_EMAIL`], password = smoke[`SMOKE_${role}_PASSWORD`];
  if (!email || !password) throw new Error(`CHƯA ĐẠT — thiếu tài khoản smoke ${role} (chạy npm run smoke:supabase để tạo).`);
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`CHƯA ĐẠT — đăng nhập ${role} thất bại (HTTP ${r.status}).`);
  return ((await r.json()) as { access_token: string }).access_token;
};
/** Khoá ví thử (không có giá trị, chỉ để ký xác minh) lưu cục bộ trong file bị Git bỏ qua. */
const walletKey = (name: string) => {
  const k = `SMOKE_${name}_WALLET_KEY`;
  if (!smoke[k]) { const v = generatePrivateKey(); appendFileSync(SMOKE, `${k}=${v}\n`); smoke[k] = v; }
  return privateKeyToAccount(smoke[k] as `0x${string}`);
};

describe("API server trên Supabase dev thật", () => {
  it("0. cấu hình + kết nối DB bằng chuỗi kết nối server + set local role service_role + bảng/hàm mới có mặt", async () => {
    const miss = [!URL_ && "SUPABASE_URL", !ANON && "SUPABASE_ANON_KEY", !DB_URL && "SUPABASE_DB_URL"].filter(Boolean);
    expect(miss, `Thiếu trong web/.env.local: ${miss.join(", ")}`).toEqual([]);
    // TLS: mặc định xác minh; nếu lỗi chuỗi chứng chỉ, đặt SUPABASE_DB_CA=<file PEM> (xem web/.env.example). no-verify chỉ là phương án cuối.
    st.pool = new pg.Pool({ connectionString: DB_URL, max: 3, ssl: dbSsl(DB_URL, process.env) });
    const cfg: ServerConfig = {
      supabaseUrl: URL_, anonKey: ANON, chainId: 43113, escrow: "0x" + "e5".repeat(20), pcp: "0x" + "c1".repeat(20), treasury: "0x" + "d7".repeat(20),
      quoteSigner: privateKeyToAccount(generatePrivateKey()), minConfirmations: 2, graceSeconds: 600, arbitrationSeconds: 86_400, configVersion: 1,
      walletDomain: "smoke.cloudpc.test", walletUri: "https://smoke.cloudpc.test", allowedOrigins: [],
    };
    st.deps = { db: pgServiceDb(st.pool), cfg };
    const r = await st.deps.db.tx(async (c) => {
      const role = (await c.query<{ r: string }>("select current_user as r")).rows[0]!.r;
      const t = (await c.query<{ n: number }>("select count(*)::int as n from unnest(array['agent_commands','chain_events','session_grants','workspace_leases','workspace_objects','workspace_versions','workspaces']) t where to_regclass('public.' || t) is not null")).rows[0]!.n;
      const f = (await c.query<{ n: number }>("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('apply_chain_event','claim_jobs','agent_poll','agent_report','grant_claim','ws_create','ws_commit')")).rows[0]!.n;
      return { role, t, f };
    });
    expect(r).toEqual({ role: "service_role", t: 7, f: 7 });
  });

  it("1. trong transaction của server, role là service_role và KHÔNG phải superuser", async () => {
    need("deps");
    // Server dùng chuỗi kết nối Postgres nhưng `set local role service_role`: không phải superuser, chỉ có quyền đã cấp cho service_role.
    const r = await st.deps!.db.tx(async (c) => (await c.query<{ s: boolean }>("select rolsuper as s from pg_roles where rolname = current_user")).rows[0]!.s);
    expect(r).toBe(false);
  });

  it("2. xác thực JWT thật của Supabase Auth cho renter/host/admin smoke (chỉ dùng anon key)", async () => {
    need("deps");
    for (const role of ["RENTER", "HOST", "ADMIN"]) {
      const tok = await signIn(role);
      const u = await authenticate(`Bearer ${tok}`, st.deps!.cfg);
      expect(u?.id).toMatch(/^[0-9a-f-]{36}$/);
      st.users[role.toLowerCase()] = u!;
      st.tokens[role.toLowerCase()] = tok;
    }
    expect(await authenticate("Bearer " + "x".repeat(60), st.deps!.cfg)).toBeNull(); // token rác bị từ chối
  });

  it("3. liên kết ví host bằng chữ ký (khoá thử cục bộ): đúng → linked; dùng lại nonce, chữ ký người khác → bị từ chối", async () => {
    need("deps", "users");
    const deps = st.deps!, host = st.users.host!, w = walletKey("HOST");
    const mk = async () => (await walletChallenge(deps, host, { address: w.address, chainId: 43113 })).body as { message: string; nonce: string };
    const c1 = await mk();
    await rejects(walletVerify(deps, host, { nonce: c1.nonce, signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message: c1.message }) }), 401, "bad_signature");
    const sig = await w.signMessage({ message: c1.message });
    expect((await walletVerify(deps, host, { nonce: c1.nonce, signature: sig })).body).toMatchObject({ linked: true, address: w.address.toLowerCase() });
    await rejects(walletVerify(deps, host, { nonce: c1.nonce, signature: sig }), 400, "invalid_challenge");
    const row = await deps.db.tx(async (c) => (await c.query<{ address: string }>("select address from public.wallet_links where user_id = $1", [host.id])).rows[0]);
    expect(row?.address).toBe(w.address.toLowerCase());
  });

  it("4. renter smoke đang có booking chưa kết thúc ⇒ đổi ví bị chặn (wallet_change_blocked) trên DB thật", async () => {
    need("deps", "users");
    const deps = st.deps!, renter = st.users.renter!, other = privateKeyToAccount(generatePrivateKey());
    const c = (await walletChallenge(deps, renter, { address: other.address, chainId: 43113 })).body as { message: string; nonce: string };
    await rejects(walletVerify(deps, renter, { nonce: c.nonce, signature: await other.signMessage({ message: c.message }) }), 409, "wallet_change_blocked");
  });

  it("5. quote cho booking reserved còn hạn: ký đúng signer, khớp snapshot DB (cần booking mới ≤ 10 phút)", async () => {
    need("deps", "users");
    const deps = st.deps!, renter = st.users.renter!;
    const b = await deps.db.tx(async (c) => (await c.query<{ id: string; p: string }>("select id, price_units::text as p from public.bookings where renter_id = $1 and state = 'reserved' and fund_by > now() + interval '30 seconds' order by created_at desc limit 1", [renter.id])).rows[0]);
    if (!b) throw new Error("CHƯA ĐẠT — không có booking reserved còn hạn của renter smoke. Chạy `npm run smoke:supabase` rồi chạy lại ngay (booking giữ máy 10 phút).");
    const r = await issueQuote(deps, renter, b.id);
    const { quote, signature } = r.body as { quote: Record<keyof Quote, string>; signature: `0x${string}` };
    expect(quote.priceUnits).toBe(b.p);
    expect(BigInt(quote.fundBy) - BigInt(quote.issuedAt)).toBe(600n);
    const q = Object.fromEntries(Object.entries(quote).map(([k, v]) => [k, /^[0-9]+$/.test(v) && !["bookingId", "machineKey", "policyHash"].includes(k) ? BigInt(v) : v])) as unknown as Quote;
    expect(await recoverQuoteSigner(q, quoteDomain(43113, deps.cfg.escrow), signature)).toBe(deps.cfg.quoteSigner.address);
    await rejects(issueQuote(deps, st.users.host!, b.id), 404, "not_found"); // host không phải chủ booking
  });

  it("6. kênh agent trên DB thật: admin tạo enrollment → thiết bị đổi credential → heartbeat (chống replay, sức khỏe ok); cuối cùng thu hồi thiết bị", async () => {
    need("deps", "users");
    const deps = st.deps!, admin = st.users.admin!;
    const m = await deps.db.tx(async (c) => (await c.query<{ machine_id: string; booking_id: string }>("select b.machine_id, b.id as booking_id from public.bookings b join public.machines m on m.id = b.machine_id where m.status = 'approved' and b.state = 'reserved' order by b.created_at desc limit 1")).rows[0]);
    if (!m) throw new Error("CHƯA ĐẠT — không có máy đã duyệt có booking để thử lệnh agent (chạy npm run smoke:supabase).");
    const t = (await createEnrollment(deps, admin, { machineId: m.machine_id, ttlSeconds: 300 })).body as { enrollmentToken: string };
    let credential = "";
    try {
      const r = (await redeemEnrollment(deps, { token: t.enrollmentToken })).body as { credential: string; machineId: string };
      credential = r.credential;
      expect(r.machineId).toBe(m.machine_id);
      expect((await heartbeat(deps, `Device ${credential}`, { counter: 1 })).status).toBe(200);
      await rejects(heartbeat(deps, `Device ${credential}`, { counter: 1 }), 401, "invalid_heartbeat"); // replay
      const health = await deps.db.tx(async (c) => (await c.query<{ h: string }>("select public.machine_health($1) as h", [m.machine_id])).rows[0]!.h);
      expect(health).toBe("ok");
    } finally {
      // Trả máy về trạng thái không có thiết bị đang hiệu lực (không xoá hàng nào; chỉ đặt revoked_at).
      await deps.db.tx(async (c) => c.query("select public.revoke_device($1, $2)", [admin.id, m.machine_id]));
    }
  });

  it("7. workspace trên DB thật: tạo (dùng lại nếu đã có), lease khi booking chưa Active bị từ chối đúng mã", async () => {
    need("deps", "users");
    const deps = st.deps!, renter = st.users.renter!;
    let ws = await deps.db.tx(async (c) => (await c.query<{ id: string }>("select id from public.workspaces where owner_id = $1 order by created_at limit 1", [renter.id])).rows[0]?.id);
    if (!ws) ws = ((await createWorkspace({ ...deps, store: { put: async () => { throw new Error("không dùng"); }, get: async () => null, stat: async () => null, delete: async () => undefined } }, renter, { name: "smoke-workspace" })).body as { id: string }).id;
    const b = await deps.db.tx(async (c) => (await c.query<{ id: string }>("select id from public.bookings where renter_id = $1 and state = 'reserved' order by created_at desc limit 1", [renter.id])).rows[0]);
    if (!b) throw new Error("CHƯA ĐẠT — không có booking của renter smoke.");
    await rejects(acquireLease({ ...deps, store: { put: async () => { throw new Error("x"); }, get: async () => null, stat: async () => null, delete: async () => undefined } }, renter, ws, { bookingId: b.id }), 409, "booking_not_active");
  });
});

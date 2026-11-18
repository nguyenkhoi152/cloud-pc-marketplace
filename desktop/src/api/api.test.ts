// Client Supabase GIẢ (có nhãn) chỉ để kiểm logic của lớp API; không phải bằng chứng với Supabase thật.
// Bằng chứng thật nằm ở scripts/supabase-smoke.mjs chạy với project dev.
import { describe, expect, it } from "vitest";
import { keyProblem, readEnv } from "./env";
import { createServerApi } from "./server";
import { createLiveApi, formatUnits, mapError, mapMachine, parseUnits, requestHash, splitFeeUnits, type Db } from "./live";

const REF = "abcdefghij0123456789";
const URL_OK = `https://${REF}.supabase.co`;
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, "")}.sig`;

describe("cấu hình môi trường (fail-closed)", () => {
  it("mặc định preview; live cần URL + key công khai hợp lệ", () => {
    expect(readEnv({})).toEqual({ mode: "preview" });
    expect(readEnv({ VITE_APP_MODE: "live", VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: "sb_publishable_abc" })).toEqual({ mode: "live", url: URL_OK, anonKey: "sb_publishable_abc" });
    expect(readEnv({ VITE_APP_MODE: "live", VITE_SUPABASE_URL: URL_OK + "/", VITE_SUPABASE_ANON_KEY: jwt("anon") }).mode).toBe("live");
  });
  it("live thiếu cấu hình hoặc sai chế độ → invalid, không rơi về preview", () => {
    const r = readEnv({ VITE_APP_MODE: "live" });
    expect(r.mode).toBe("invalid");
    expect(readEnv({ VITE_APP_MODE: "prod" }).mode).toBe("invalid");
    expect(readEnv({ VITE_APP_MODE: "live", VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_ANON_KEY: "sb_publishable_x" }).mode).toBe("invalid");
  });
  it("từ chối key nhạy cảm bị đặt vào VITE_* (secret, service_role)", () => {
    expect(keyProblem("sb_secret_abcdef")).toMatch(/SECRET/);
    expect(keyProblem(jwt("service_role"))).toMatch(/service_role/);
    expect(keyProblem("chuoi-la")).toMatch(/không giống/);
    expect(keyProblem("sb_publishable_ok")).toBeNull();
    const r = readEnv({ VITE_APP_MODE: "live", VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: jwt("service_role") });
    expect(r.mode).toBe("invalid");
    expect(JSON.stringify(r)).not.toContain(jwt("service_role")); // không lặp lại key trong thông báo
  });
});

describe("tiền: chuỗi đơn vị nhỏ nhất, không number", () => {
  it("parseUnits/formatUnits round-trip và từ chối đầu vào xấu", () => {
    expect(parseUnits("20")).toBe("20000000000000000000");
    expect(parseUnits("0.000000000000000001")).toBe("1");
    expect(formatUnits(parseUnits("12.345678901234567891"))).toBe("12.345678901234567891");
    expect(formatUnits("20000000000000000000")).toBe("20");
    for (const bad of ["", "0", "-1", "+1", "1e3", "1,5", " 1", "1 ", "01", "1.", ".5", "1.1234567890123456789", "١٢"]) expect(() => parseUnits(bad), bad).toThrow();
  });
  it("giá lớn không mất chính xác; phí chia bảo toàn tổng", () => {
    const big = "123456789012345678901234567"; // > 2^53
    expect(formatUnits(big)).toBe("123456789.012345678901234567");
    const { fee, host } = splitFeeUnits(big, 1000);
    expect(BigInt(fee) + BigInt(host)).toBe(BigInt(big));
    expect(splitFeeUnits("1", 1000)).toEqual({ fee: "0", host: "1" });
  });
  it("mapMachine từ chối tiền ở dạng number (JSON number có thể đã mất chính xác)", () => {
    const row = { id: "m1", name: "Máy", declared_specs: {}, price_units: 20000000000000000000 as unknown as string, created_at: "2026-11-09T00:00:00Z" };
    expect(() => mapMachine(row)).toThrow(/dạng chuỗi/);
    expect(mapMachine({ ...row, price_units: "20000000000000000000" }).pricePer15).toBe(20);
  });
  it("mapMachine: specs thiếu/sai kiểu có mặc định an toàn, trạng thái 'chưa xác minh'", () => {
    const m = mapMachine({ id: "m1", name: "Máy", declared_specs: { cores: -5, ramGb: "16", categories: ["game", "hack"], gpu: 5 }, price_units: "1", created_at: "x" });
    expect(m).toMatchObject({ cores: 0, ramGb: 0, categories: ["game"], gpu: null, state: "unverified", location: "Chưa khai" });
    expect(mapMachine({ id: "m2", name: "x", declared_specs: null, price_units: "1", created_at: "x" }).categories).toEqual(["dev"]);
  });
});

describe("mapError", () => {
  it("map thông báo nghiệp vụ DB, mạng, auth", () => {
    expect(mapError({ code: "P0001", message: "wallet_required" })).toMatchObject({ code: "rejected", message: expect.stringMatching(/ví/) });
    expect(mapError({ message: "unavailable" }).code).toBe("rejected");
    expect(mapError(new TypeError("Failed to fetch")).code).toBe("offline");
    expect(mapError({ message: "Invalid login credentials" }).code).toBe("auth");
    expect(mapError({ code: "42501", message: "permission denied for table x" }).code).toBe("rejected");
    expect(mapError({ message: "boom" }).code).toBe("server");
  });
});

/** Client giả tối thiểu: ghi lại lời gọi, trả kết quả dựng sẵn. */
function fakeDb(handlers: { rpc?: (fn: string, args: Record<string, unknown>) => unknown; table?: (t: string, sel: string, filters: [string, unknown][]) => unknown; user?: { id: string; email: string } | null }) {
  const calls: { kind: string; name: string; detail: unknown }[] = [];
  const db = {
    auth: { getUser: async () => (handlers.user === null ? { data: { user: null }, error: { message: "no" } } : { data: { user: handlers.user ?? { id: "u1", email: "a@b.c", user_metadata: {} } }, error: null }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ kind: "rpc", name: fn, detail: args });
      return { data: handlers.rpc?.(fn, args) ?? null, error: null };
    },
    from: (t: string) => {
      let sel = "";
      const filters: [string, unknown][] = [];
      const q = {
        select: (s: string) => ((sel = s), q),
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        order: () => q,
        limit: (n: number) => (filters.push(["__limit", n]), q),
        single: async () => (calls.push({ kind: "from", name: t, detail: { sel, filters } }), { data: handlers.table?.(t, sel, filters) ?? null, error: null }),
        maybeSingle: async () => (calls.push({ kind: "from", name: t, detail: { sel, filters } }), { data: handlers.table?.(t, sel, filters) ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => (calls.push({ kind: "from", name: t, detail: { sel, filters } }), res({ data: handlers.table?.(t, sel, filters) ?? null, error: null })),
      };
      return q;
    },
  };
  return { db: db as unknown as Db, calls };
}

describe("đặt thuê (reserve) qua lớp API", () => {
  const bookingRow = { id: "b1", machine_id: "m1", state: "reserved", access_state: "not_granted", price_units: "20000000000000000000", fee_bps: 1000, duration_seconds: 900, fund_by: "2026-11-09T13:10:00Z", activate_by: "2026-11-09T13:15:00Z", workspace_mode: "none", created_at: "2026-11-09T13:00:00Z" };

  it("gọi reserve_machine với khóa idempotency + hash ổn định, rồi đọc lại booking với tiền dạng chuỗi", async () => {
    const { db, calls } = fakeDb({
      rpc: (fn) => (fn === "reserve_machine" ? { id: "b1", price_units: 2e19 } : null),
      table: (t) => (t === "bookings" ? bookingRow : null),
    });
    const b = await createLiveApi(db).bookings.reserve("m1", "rsv-abc12345", "none");
    expect(b).toMatchObject({ id: "b1", state: "reserved", priceUnits: "20000000000000000000", durationSeconds: 900 });
    const rpc = calls.find((c) => c.kind === "rpc")!;
    expect(rpc.name).toBe("reserve_machine");
    expect(rpc.detail).toEqual({ p_machine_id: "m1", p_idempotency_key: "rsv-abc12345", p_request_hash: await requestHash("m1", "none"), p_workspace_mode: "none" });
    const read = calls.find((c) => c.kind === "from" && c.name === "bookings")!;
    expect((read.detail as { sel: string }).sel).toContain("price_units::text"); // không đọc tiền dạng numeric/number
  });

  it("host.listBookings: lọc theo host_id của người đang đăng nhập (không theo tham số từ UI), tiền dạng chuỗi, có giới hạn", async () => {
    const { db, calls } = fakeDb({ table: (t) => (t === "bookings" ? [{ ...bookingRow, state: "active", access_state: "granted" }] : null), user: { id: "host-1", email: "h@x.y" } });
    const list = await createLiveApi(db).host.listBookings();
    expect(list).toMatchObject([{ id: "b1", state: "active", accessState: "granted", priceUnits: "20000000000000000000" }]);
    const read = calls.find((c) => c.kind === "from" && c.name === "bookings")!.detail as { sel: string; filters: [string, unknown][] };
    expect(read.filters).toContainEqual(["host_id", "host-1"]);
    expect(read.filters).toContainEqual(["__limit", 20]);
    expect(read.sel).toContain("price_units::text");
    expect(read.sel).not.toMatch(/renter_id|email/); // không kéo định danh của khách về máy host
  });

  it("hash yêu cầu khác nhau theo máy/workspace và lặp lại giống nhau", async () => {
    expect(await requestHash("m1", "none")).toBe(await requestHash("m1", "none"));
    expect(await requestHash("m1", "none")).not.toBe(await requestHash("m2", "none"));
    expect(await requestHash("m1", "none")).not.toBe(await requestHash("m1", "project"));
  });

  it("lỗi nghiệp vụ từ DB được dịch; không đăng nhập thì báo auth, không gọi RPC", async () => {
    const failing = {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
      rpc: async () => ({ data: null, error: { code: "P0001", message: "wallet_required" } }),
      from: () => ({}),
    } as unknown as Db;
    await expect(createLiveApi(failing).bookings.reserve("m1", "rsv-abc12345")).rejects.toMatchObject({ code: "rejected", message: expect.stringMatching(/ví/) });
    const { db, calls } = fakeDb({ user: null });
    await expect(createLiveApi(db).bookings.listMine()).rejects.toMatchObject({ code: "auth" });
    expect(calls).toHaveLength(0);
  });
});

describe("client API server", () => {
  const mk = (res: (url: string, init: RequestInit) => Response | Promise<Response>, token: string | null = "tok") =>
    createServerApi({ baseUrl: "https://api.test/api/", getToken: async () => token, fetchImpl: (async (u: string, i: RequestInit) => res(u, i)) as unknown as typeof fetch });

  it("gửi Bearer token người dùng, JSON, đúng đường dẫn; trả dữ liệu", async () => {
    let seen: { url: string; auth: string; body: string } | null = null;
    const api = mk((url, init) => { seen = { url, auth: (init.headers as Record<string, string>).authorization!, body: String(init.body) }; return Response.json({ viewerUrl: "http://gw/x" }); });
    expect(await api.connect("b-1")).toEqual({ viewerUrl: "http://gw/x" });
    expect(seen).toEqual({ url: "https://api.test/api/bookings/b-1/connect", auth: "Bearer tok", body: "undefined" });
  });
  it("không có token → lỗi auth, không gọi mạng; mã lỗi máy chủ → thông báo tiếng Việt; mạng đứt → offline", async () => {
    let called = false;
    await expect(mk(() => { called = true; return Response.json({}); }, null).connect("b")).rejects.toMatchObject({ code: "auth" });
    expect(called).toBe(false);
    await expect(mk(() => Response.json({ error: { code: "no_grant", message: "x" } }, { status: 409 })).connect("b")).rejects.toMatchObject({ code: "rejected", message: expect.stringMatching(/Chưa có quyền xem/) });
    await expect(mk(() => Response.json({ error: { code: "unauthorized" } }, { status: 401 })).connect("b")).rejects.toMatchObject({ code: "auth" });
    await expect(mk(() => Response.json({ error: { code: "internal" } }, { status: 500 })).connect("b")).rejects.toMatchObject({ code: "server" });
    await expect(mk(() => { throw new TypeError("fetch failed"); }).connect("b")).rejects.toMatchObject({ code: "offline" });
  });
  it("reconcile phân biệt 202 (đang chờ xác nhận) với đã áp dụng", async () => {
    expect(await mk(() => Response.json({ status: "pending" }, { status: 202 })).reconcile("b", "0x1")).toMatchObject({ pending: true });
    expect(await mk(() => Response.json({ status: "ok", applied: [{ event: "Funded", outcome: "applied" }] })).reconcile("b", "0x1")).toMatchObject({ pending: false });
  });
});

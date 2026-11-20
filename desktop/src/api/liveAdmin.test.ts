// Client Supabase GIẢ (có nhãn): chỉ kiểm logic lớp API (cột availability, dự phòng DB cũ, isAdmin, snapshot quản trị).
// Bằng chứng với Supabase thật: bảng kiểm migration (post_migration_checks hàng 16) và xem màn Quản trị trên project dev.
import { describe, expect, it } from "vitest";
import { createLiveApi, mapMachine, stateOfAvailability, type Db } from "./live";

const row = { id: "m1", name: "Máy", declared_specs: { cores: 8, ramGb: 16 }, price_units: "20000000000000000000", created_at: "2026-11-20T00:00:00Z" };

describe("trạng thái online thật của máy (availability)", () => {
  it("stateOfAvailability: chỉ nhận ba giá trị đã biết, còn lại là 'chưa biết' chứ KHÔNG đoán online", () => {
    expect(stateOfAvailability("online")).toBe("online");
    expect(stateOfAvailability("busy")).toBe("busy");
    expect(stateOfAvailability("offline")).toBe("offline");
    for (const v of [undefined, null, "", "ok", "ONLINE", 1, {}]) expect(stateOfAvailability(v), String(v)).toBe("unverified");
  });
  it("mapMachine lấy trạng thái từ availability; thiếu cột (DB cũ) giữ 'unverified'", () => {
    expect(mapMachine({ ...row, availability: "online" }).state).toBe("online");
    expect(mapMachine({ ...row, availability: "offline" }).state).toBe("offline");
    expect(mapMachine({ ...row, availability: "busy" }).state).toBe("busy");
    expect(mapMachine(row).state).toBe("unverified");
  });
});

/** Client giả cho danh mục: `answer(cols)` quyết định kết quả theo danh sách cột được chọn; ghi lại các lần chọn. */
function catalogDb(answer: (cols: string) => { data: unknown; error: { code?: string; message?: string } | null }) {
  const selects: string[] = [];
  const db = {
    auth: {},
    rpc: async () => ({ data: null, error: null }),
    from: () => ({
      select: (cols: string) => {
        selects.push(cols);
        const res = answer(cols);
        const done = { then: (ok: (v: unknown) => unknown) => ok(res), maybeSingle: async () => res };
        return { order: () => done, eq: () => done };
      },
    }),
  };
  return { db: db as unknown as Db, selects };
}

describe("danh mục công khai: chọn cột availability, có dự phòng khi DB chưa áp migration", () => {
  it("DB đã áp migration: chọn kèm availability một lần và hiện đúng online/offline/busy", async () => {
    const { db, selects } = catalogDb(() => ({ data: [{ ...row, availability: "online" }, { ...row, id: "m2", availability: "offline" }, { ...row, id: "m3", availability: "busy" }], error: null }));
    const list = await createLiveApi(db).catalog.list();
    expect(list.map((m) => m.state)).toEqual(["online", "offline", "busy"]);
    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain("availability");
    expect(selects[0]).toContain("price_units::text"); // tiền vẫn đọc dạng chuỗi
  });
  it("DB CŨ (cột availability chưa có, mã 42703): chọn lại không có cột đó, danh mục vẫn hiện, trạng thái 'unverified'", async () => {
    const { db, selects } = catalogDb((cols) =>
      cols.includes("availability")
        ? { data: null, error: { code: "42703", message: "column public_machines.availability does not exist" } }
        : { data: [row], error: null },
    );
    const list = await createLiveApi(db).catalog.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.state).toBe("unverified");
    expect(selects).toHaveLength(2);
    expect(selects[1]).not.toContain("availability");
  });
  it("cũng nhận diện qua nội dung thông báo (không có mã) và áp dụng cho get()", async () => {
    const { db } = catalogDb((cols) => (cols.includes("availability") ? { data: null, error: { message: 'column "availability" does not exist' } } : { data: row, error: null }));
    const got = await createLiveApi(db).catalog.get("m1");
    expect(got?.machine.state).toBe("unverified");
    expect(got?.priceUnits).toBe("20000000000000000000");
  });
  it("lỗi KHÁC (ví dụ mất quyền) không bị nuốt bằng cách thử lại: báo lỗi", async () => {
    const { db, selects } = catalogDb(() => ({ data: null, error: { code: "42501", message: "permission denied for view public_machines" } }));
    await expect(createLiveApi(db).catalog.list()).rejects.toMatchObject({ code: "rejected" });
    expect(selects).toHaveLength(1);
  });
});

/** Client giả nhiều bảng cho account()/snapshot(). */
function tablesDb(tables: Record<string, unknown>, opts: { rpc?: (fn: string, args: Record<string, unknown>) => unknown; user?: { id: string; email: string } } = {}) {
  const calls: { kind: "from" | "rpc"; name: string; sel?: string; args?: unknown }[] = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: opts.user ?? { id: "admin-1", email: "a@b.c", user_metadata: {} } }, error: null }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ kind: "rpc", name: fn, args });
      const r = opts.rpc?.(fn, args);
      return r && typeof r === "object" && "error" in (r as object) ? r : { data: r ?? null, error: null };
    },
    from: (t: string) => {
      let sel = "";
      const q = {
        select: (s: string) => ((sel = s), q),
        eq: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => (calls.push({ kind: "from", name: t, sel }), { data: Array.isArray(tables[t]) ? ((tables[t] as unknown[])[0] ?? null) : (tables[t] ?? null), error: null }),
        then: (ok: (v: unknown) => unknown) => (calls.push({ kind: "from", name: t, sel }), ok({ data: tables[t] ?? [], error: null })),
      };
      return q;
    },
  };
  return { db: db as unknown as Db, calls };
}

describe("account(): cờ isAdmin chỉ từ role của CHÍNH người dùng", () => {
  it("có role admin ⇒ true; không có ⇒ false; role khác ⇒ false", async () => {
    const base = { profiles: { display_name: "X" }, host_profiles: null };
    expect((await createLiveApi(tablesDb({ ...base, user_roles: [{ role: "admin" }] }).db).account()).isAdmin).toBe(true);
    expect((await createLiveApi(tablesDb({ ...base, user_roles: [] }).db).account()).isAdmin).toBe(false);
    expect((await createLiveApi(tablesDb({ ...base, user_roles: [{ role: "operator" }] }).db).account()).isAdmin).toBe(false);
  });
});

describe("admin.snapshot / deleteMachine", () => {
  const tables = {
    profiles: [{ user_id: "h1", display_name: "Neeez", created_at: "2026-11-02T00:00:00Z" }],
    host_profiles: [{ user_id: "h1", status: "approved", created_at: "2026-11-02T00:00:00Z" }],
    machines: [
      { id: "m1", name: "Neeez", status: "approved", owner_id: "h1", machine_key: "k1", price_units: "20000000000000000000", created_at: "2026-11-03T00:00:00Z", active_booking_id: null },
      { id: "m2", name: "Nháp", status: "draft", owner_id: "h1", machine_key: "k2", price_units: "1", created_at: "2026-11-04T00:00:00Z", active_booking_id: null },
    ],
    bookings: [],
    user_roles: [],
    audit_logs: [],
  };

  it("đọc đủ các bảng, tiền dạng chuỗi, chỉ hỏi sức khoẻ thiết bị cho máy ĐANG ĐĂNG", async () => {
    const { db, calls } = tablesDb(tables, { rpc: (fn) => (fn === "my_machine_health" ? "ok" : null) });
    const snap = await createLiveApi(db).admin.snapshot();
    expect(snap.machines.find((m) => m.id === "m1")).toMatchObject({ health: "ok", ownerName: "Neeez", priceUnits: "20000000000000000000" });
    expect(snap.machines.find((m) => m.id === "m2")?.health).toBe("unknown");
    const reads = calls.filter((c) => c.kind === "from");
    expect(reads.map((c) => c.name).sort()).toEqual(["audit_logs", "bookings", "host_profiles", "machines", "profiles", "user_roles"]);
    expect(reads.find((c) => c.name === "machines")!.sel).toContain("price_units::text");
    expect(reads.find((c) => c.name === "bookings")!.sel).toContain("price_units::text");
    const health = calls.filter((c) => c.kind === "rpc");
    expect(health).toEqual([{ kind: "rpc", name: "my_machine_health", args: { p_machine: "m1" } }]);
  });

  it("từ chối tiền không ở dạng chuỗi (tránh mất chính xác)", async () => {
    const bad = { ...tables, machines: [{ ...tables.machines[0]!, price_units: 2e19 }] };
    await expect(createLiveApi(tablesDb(bad).db).admin.snapshot()).rejects.toMatchObject({ message: expect.stringMatching(/Không đọc được số tiền/) });
  });

  it("deleteMachine gọi RPC admin_delete_machine; 'has_history' thành câu tiếng Việt nói rõ chỉ đình chỉ được", async () => {
    const ok = tablesDb({});
    await createLiveApi(ok.db).admin.deleteMachine("m1");
    expect(ok.calls).toEqual([{ kind: "rpc", name: "admin_delete_machine", args: { p_machine: "m1" } }]);
    const refused = tablesDb({}, { rpc: () => ({ data: null, error: { code: "P0001", message: "has_history" } }) });
    await expect(createLiveApi(refused.db).admin.deleteMachine("m1")).rejects.toMatchObject({ code: "rejected", message: expect.stringMatching(/đình chỉ thay vì xóa/) });
    const forbidden = tablesDb({}, { rpc: () => ({ data: null, error: { code: "P0001", message: "forbidden" } }) });
    await expect(createLiveApi(forbidden.db).admin.deleteMachine("m1")).rejects.toMatchObject({ code: "rejected", message: expect.stringMatching(/không có quyền/) });
  });
});

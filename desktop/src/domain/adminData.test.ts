import { describe, expect, it } from "vitest";
import { ACCESS_STATE_LABEL, BOOKING_STATE_LABEL, HEALTH_LABEL, auditLabel, buildAdminSnapshot, isLiveBooking, isNeverFunded, isTestName, resourceLabel, summarize, type AdminRaw } from "./adminData";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const HOST = "00000000-0000-4000-8000-000000000002";
const SMOKE_HOST = "00000000-0000-4000-8000-000000000003";
const RENTER = "00000000-0000-4000-8000-000000000004";
const T = (n: number) => `2026-11-${String(n).padStart(2, "0")}T10:00:00Z`;

const machine = (id: string, name: string, owner: string, status: string, day: number) => ({ id, name, status, owner_id: owner, machine_key: `key-${id}`, price_units: "20000000000000000000", created_at: T(day), active_booking_id: null });
const booking = (id: string, machine_id: string, state: string, access_state: string, day: number) => ({ id, machine_id, renter_id: RENTER, host_id: HOST, state, access_state, price_units: "20000000000000000000", created_at: T(day) });

const raw: AdminRaw = {
  profiles: [
    { user_id: ADMIN, display_name: "Quản trị", created_at: T(1) },
    { user_id: HOST, display_name: "Neeez", created_at: T(2) },
    { user_id: SMOKE_HOST, display_name: "Smoke host", created_at: T(3) },
    { user_id: RENTER, display_name: "Người thuê", created_at: T(4) },
    { user_id: "00000000-0000-4000-8000-000000000009", display_name: "Kiểm Fuji (tạm)", created_at: T(5) },
  ],
  hosts: [
    { user_id: HOST, status: "approved", created_at: T(2) },
    { user_id: SMOKE_HOST, status: "suspended", created_at: T(3) },
  ],
  machines: [
    machine("m-real", "Neeez", HOST, "approved", 10),
    machine("m-offline", "Máy B", HOST, "approved", 11),
    machine("m-smoke", "smoke-123", SMOKE_HOST, "approved", 12),
    machine("m-susp", "Máy cũ", HOST, "suspended", 9),
  ],
  bookings: [
    booking("b1", "m-real", "settled", "reset_verified", 15),
    booking("b2", "m-real", "active", "granted", 16),
    booking("b3", "m-smoke", "expired", "not_granted", 14),
    booking("b4", "m-susp", "expired", "not_granted", 13),
    booking("b5", "gone", "reserved", "not_granted", 17),
  ],
  roles: [{ user_id: ADMIN, role: "admin" }],
  audit: [
    { id: 1, actor: ADMIN, action: "review_machine", resource: "machine:m-susp", outcome: "ok", detail: {}, created_at: T(18) },
    { id: 2, actor: null, action: "expire_unfunded_booking", resource: "booking:b3", outcome: "ok", detail: {}, created_at: T(18) },
  ],
  health: { "m-real": "ok", "m-smoke": "unknown" },
};

describe("quy tắc booking (khớp DB)", () => {
  it("isLiveBooking khớp booking_is_live: chỉ trạng thái kết thúc VÀ truy cập đã đóng mới là không sống", () => {
    expect(isLiveBooking("reserved", "not_granted")).toBe(true);
    expect(isLiveBooking("active", "granted")).toBe(true);
    expect(isLiveBooking("settled", "revoking")).toBe(true); // tiền xong nhưng máy chưa dọn
    expect(isLiveBooking("settled", "reset_verified")).toBe(false);
    expect(isLiveBooking("expired", "not_granted")).toBe(false);
  });
  it("isNeverFunded khớp admin_delete_machine: chỉ expired/cancelled VÀ chưa từng cấp quyền xem", () => {
    expect(isNeverFunded("expired", "not_granted")).toBe(true);
    expect(isNeverFunded("cancelled", "not_granted")).toBe(true);
    expect(isNeverFunded("settled", "reset_verified")).toBe(false);
    expect(isNeverFunded("refunded", "reset_verified")).toBe(false);
    expect(isNeverFunded("expired", "failed")).toBe(false);
  });
  it("nhận diện tài khoản/máy thử", () => {
    for (const n of ["Smoke host", "smoke-1794144212143", "Kiểm Fuji (tạm)", " Smoke admin "]) expect(isTestName(n), n).toBe(true);
    for (const n of ["Neeez", "Người thuê demo", "nam_nguyen", "Smoker"]) expect(isTestName(n), n).toBe(false);
  });
});

describe("buildAdminSnapshot", () => {
  const s = buildAdminSnapshot(raw, new Date("2026-11-20T00:00:00Z"));

  it("nối tên chủ máy/người thuê, sắp mới nhất trước, đánh dấu máy thử, tiền giữ nguyên dạng chuỗi", () => {
    expect(s.machines.map((m) => m.id)).toEqual(["m-smoke", "m-offline", "m-real", "m-susp"]);
    const real = s.machines.find((m) => m.id === "m-real")!;
    expect(real).toMatchObject({ ownerName: "Neeez", status: "approved", health: "ok", priceUnits: "20000000000000000000", isTest: false, bookingsTotal: 2, bookingsLive: 1 });
    expect(s.machines.find((m) => m.id === "m-smoke")).toMatchObject({ isTest: true, ownerName: "Smoke host" });
    expect(s.bookings.find((b) => b.id === "b5")).toMatchObject({ machineName: "(máy đã xoá)", renterName: "Người thuê" });
  });

  it("deletable: chỉ máy mà MỌI booking chưa từng chạm tiền/phiên (kể cả máy không có booking)", () => {
    const d = Object.fromEntries(s.machines.map((m) => [m.id, m.deletable]));
    expect(d).toEqual({ "m-real": false, "m-offline": true, "m-smoke": true, "m-susp": true });
  });

  it("host: đếm số máy, người dùng: vai trò admin/host", () => {
    expect(s.hosts.find((h) => h.userId === HOST)).toMatchObject({ machines: 3, status: "approved" });
    expect(s.users.find((u) => u.userId === ADMIN)).toMatchObject({ isAdmin: true, isHost: false });
    expect(s.users.find((u) => u.userId === SMOKE_HOST)).toMatchObject({ isHost: true, hostStatus: "suspended", isTest: true });
    expect(s.users.find((u) => u.name === "Người thuê")).toMatchObject({ isAdmin: false, isHost: false });
  });

  it("nhật ký: dòng không có actor là '(hệ thống)'; trạng thái lạ rơi về mặc định an toàn", () => {
    expect(s.audit.find((a) => a.id === 2)!.actorName).toBe("(hệ thống)");
    const odd = buildAdminSnapshot({ ...raw, hosts: [{ user_id: HOST, status: "???", created_at: T(2) }], machines: [machine("x", "X", HOST, "weird", 1)], health: { x: "???" } });
    expect(odd.hosts[0]!.status).toBe("pending");
    expect(odd.machines[0]).toMatchObject({ status: "draft", health: "unknown" });
  });
});

describe("nhãn hiển thị cho người dùng: không lộ tên kỹ thuật", () => {
  // Mọi hành động mà máy chủ/DB ghi vào nhật ký (xem server/src và supabase/migrations) phải có nhãn tiếng Việt.
  const ACTIONS = ["review_host", "review_machine", "publish_machine", "delete_machine", "create_enrollment", "revoke_device", "redeem_enrollment", "expire_unfunded_booking", "release_machine", "chain_event_applied", "chain_event_rejected", "revoke_or_reset_failed", "faucet_request", "faucet_pcp", "faucet_gas", "issue_quote", "job_dead", "activate_sent", "activation_window_missed", "claim_after_grace_sent", "grant_failed", "prepare_failed", "needs_attention", "needs_refund"];
  const TECH = /_|heartbeat|agent|supabase|guest|gateway|tunnel|escrow|worker|\brls\b|jwt|token|faucet|migration|not_granted|reserved/i;
  it("hành động trong nhật ký đều có nhãn riêng, không còn dạng snake_case", () => {
    for (const a of ACTIONS) {
      expect(auditLabel(a), a).not.toBe(a);
      expect(auditLabel(a), a).not.toMatch(TECH);
    }
  });
  it("đối tượng trong nhật ký đọc được: loại + mã ngắn, không lộ tiền tố kỹ thuật", () => {
    expect(resourceLabel("booking:b7de698c-b41a-4d9f-9a31-aaaaaaaaaaaa")).toBe("Phiên thuê b7de698c");
    expect(resourceLabel("machine:822b3cd9-7175-4529-9794-0244a23bf42e")).toBe("Máy 822b3cd9");
    expect(resourceLabel("wallet:0x2f3b2a67fcab8c1d9e0f1a2b3c4d5e6f76dfb8f8")).toBe("Ví 0x2f3b2a…b8f8");
    expect(resourceLabel("host:abcd1234-0000")).toBe("Host abcd1234");
    expect(resourceLabel("khac")).toBe("khac");
    for (const r of ["booking:x", "machine:x", "wallet:0xabc", "host:x"]) expect(resourceLabel(r)).not.toMatch(/^[a-z_]+:/);
  });
  it("nhãn trạng thái phiên, quyền xem và kết nối không chứa thuật ngữ kỹ thuật", () => {
    for (const t of [...Object.values(BOOKING_STATE_LABEL), ...Object.values(ACCESS_STATE_LABEL), ...Object.values(HEALTH_LABEL)]) expect(t).not.toMatch(TECH);
  });
});

describe("summarize (Tổng quan)", () => {
  const s = buildAdminSnapshot(raw);
  it("ẩn máy/host/người dùng thử theo mặc định; máy online/offline/busy đếm đúng", () => {
    const x = summarize(s);
    expect(x.machines).toMatchObject({ published: 2, suspended: 1, online: 0, busy: 1, offline: 1 }); // m-real có booking sống => busy; m-offline chưa có agent
    expect(x.hosts).toEqual({ approved: 1, suspended: 0 });
    expect(x.users).toEqual({ total: 3, test: 2 });
    expect(x.bookings.total).toBe(4); // 5 booking, b3 của máy thử bị ẩn (b5 thuộc máy đã xoá nên vẫn tính)
  });
  it("hideTest=false thấy tất cả", () => {
    const x = summarize(s, false);
    expect(x.machines.published).toBe(3);
    expect(x.hosts.suspended).toBe(1);
    expect(x.bookings.expiredUnfunded).toBe(2);
  });
  it("attention = máy đang đăng, không có phiên, agent không gửi tín hiệu", () => {
    expect(summarize(s).attention.map((m) => m.id)).toEqual(["m-offline"]);
    const online = buildAdminSnapshot({ ...raw, health: { ...raw.health, "m-offline": "suspect" } });
    expect(summarize(online).attention).toEqual([]);
    expect(summarize(online).machines.online).toBe(1);
  });
});

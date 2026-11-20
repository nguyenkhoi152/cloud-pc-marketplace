// @vitest-environment jsdom
// Màn Quản trị: ẩn với người không phải admin; thao tác nguy hiểm LUÔN hỏi xác nhận; gọi đúng API; lỗi hiện rõ; tài khoản thử bị ẩn mặc định.
// API là bản giả có nhãn (không gọi Supabase). Quyền thật nằm ở DB và được kiểm ở db/tests/admin.test.ts.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdminSnapshot, type AdminRaw } from "@/domain/adminData";

// vi.mock được kéo lên đầu file: dữ liệu giả phải khai trong vi.hoisted.
const { flags, admin, server } = vi.hoisted(() => ({
  flags: { live: true },
  admin: { snapshot: vi.fn(), reviewMachine: vi.fn(), reviewHost: vi.fn(), deleteMachine: vi.fn() },
  server: { revokeMyDevice: vi.fn() },
}));
vi.mock("@/api", () => ({ getLiveApi: () => ({ admin }), getServerApi: () => server, service: {} }));
vi.mock("@/api/env", async (orig) => ({ ...(await orig<typeof import("@/api/env")>()), isLive: () => flags.live }));

import { useAppStore } from "@/state/store";
import { AdminDashboard } from "./AdminDashboard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST = "00000000-0000-4000-8000-000000000002";
const SMOKE = "00000000-0000-4000-8000-000000000003";
const RENTER = "00000000-0000-4000-8000-000000000004";
const price = "20000000000000000000";
const m = (id: string, name: string, owner: string, status: string, day: number) => ({ id, name, status, owner_id: owner, machine_key: `key-${id}`, price_units: price, created_at: `2026-11-${day}T10:00:00Z`, active_booking_id: null });
const b = (id: string, machine_id: string, state: string, access_state: string) => ({ id, machine_id, renter_id: RENTER, host_id: HOST, state, access_state, price_units: price, created_at: "2026-11-15T10:00:00Z" });

const RAW: AdminRaw = {
  profiles: [
    { user_id: HOST, display_name: "Neeez", created_at: "2026-11-02T00:00:00Z" },
    { user_id: SMOKE, display_name: "Smoke host", created_at: "2026-11-03T00:00:00Z" },
    { user_id: RENTER, display_name: "Người thuê", created_at: "2026-11-04T00:00:00Z" },
  ],
  hosts: [{ user_id: HOST, status: "approved", created_at: "2026-11-02T00:00:00Z" }, { user_id: SMOKE, status: "approved", created_at: "2026-11-03T00:00:00Z" }],
  machines: [m("m-real", "MayThat", HOST, "approved", 10), m("m-new", "MayChuaCoLichSu", HOST, "approved", 11), m("m-smoke", "smoke-999", SMOKE, "approved", 12), m("m-susp", "MayDinhChi", HOST, "suspended", 9)],
  bookings: [b("b1", "m-real", "settled", "reset_verified"), b("b2", "m-smoke", "expired", "not_granted")],
  roles: [],
  audit: [{ id: 1, actor: HOST, action: "publish_machine", resource: "machine:m-real", outcome: "ok", detail: {}, created_at: "2026-11-18T10:00:00Z" }],
  health: { "m-real": "ok", "m-new": "unknown", "m-smoke": "ok" },
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = () => document.body.textContent ?? "";
const buttons = () => Array.from(document.body.querySelectorAll("button"));
const rowOf = (name: string) => Array.from(document.body.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(name));
const inRow = (name: string, label: string) => Array.from(rowOf(name)?.querySelectorAll("button") ?? []).find((x) => x.textContent?.trim() === label) as HTMLButtonElement | undefined;
const dialog = () => document.body.querySelector('[role="dialog"]');
const dialogButton = (label: string) => Array.from(dialog()?.querySelectorAll("button") ?? []).find((x) => x.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined | null) => { expect(el, "không tìm thấy phần tử để bấm").toBeTruthy(); act(() => (el as HTMLElement).click()); await flush(); };
const tab = (label: string) => buttons().find((x) => x.getAttribute("role") === "radio" && x.textContent?.trim() === label);

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<AdminDashboard />));
  await flush();
}

beforeEach(() => {
  flags.live = true;
  useAppStore.setState({ account: { name: "Admin", email: "a@b.c", mode: "rent", hostApproval: "none", isAdmin: true } });
  admin.snapshot.mockReset().mockImplementation(async () => buildAdminSnapshot(RAW));
  admin.reviewMachine.mockReset().mockResolvedValue(undefined);
  admin.reviewHost.mockReset().mockResolvedValue(undefined);
  admin.deleteMachine.mockReset().mockResolvedValue(undefined);
  server.revokeMyDevice.mockReset().mockResolvedValue({ revoked: true });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.innerHTML = "";
});

describe("AdminDashboard: quyền hiển thị", () => {
  it("ngoài chế độ live: báo chỉ có ở live, KHÔNG gọi API", async () => {
    flags.live = false;
    await mount();
    expect(text()).toContain("Không khả dụng");
    expect(admin.snapshot).not.toHaveBeenCalled();
  });
  it("tài khoản không phải admin: báo không có quyền, KHÔNG tải dữ liệu quản trị", async () => {
    useAppStore.setState({ account: { name: "U", email: "u@b.c", mode: "rent", hostApproval: "none", isAdmin: false } });
    await mount();
    expect(text()).toContain("Không có quyền");
    expect(admin.snapshot).not.toHaveBeenCalled();
  });
});

describe("AdminDashboard: dữ liệu và bộ lọc", () => {
  it("Tổng quan: đếm máy đang đăng, nhắc máy mất tín hiệu; máy/tài khoản thử bị ẩn mặc định", async () => {
    await mount();
    expect(text()).toContain("Quản trị");
    expect(text()).toContain("Máy đang đăng");
    expect(text()).toContain("1 máy đang đăng nhưng mất kết nối"); // m-new chưa có agent; m-smoke là máy thử nên ẩn
    expect(text()).toContain("MayChuaCoLichSu");
    expect(text()).not.toContain("smoke-999");
  });
  it("Máy: bỏ tick 'Ẩn tài khoản và máy thử' thì thấy máy smoke; ô tìm kiếm lọc theo tên", async () => {
    await mount();
    await click(tab("Máy"));
    expect(rowOf("MayThat")).toBeTruthy();
    expect(rowOf("smoke-999")).toBeUndefined();
    const label = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.includes("Ẩn tài khoản"));
    await click(document.getElementById(label!.htmlFor));
    expect(rowOf("smoke-999")).toBeTruthy();
    const input = document.body.querySelector('input[aria-label="Tìm theo tên"]') as HTMLInputElement;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "MayDinhChi");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(rowOf("MayDinhChi")).toBeTruthy();
    expect(rowOf("MayThat")).toBeUndefined();
  });
  it("nút Xóa chỉ bật khi máy chưa từng có tiền/phiên; máy đã settled chỉ đình chỉ được", async () => {
    await mount();
    await click(tab("Máy"));
    expect(inRow("MayThat", "Xóa")!.disabled).toBe(true); // có booking settled
    expect(inRow("MayChuaCoLichSu", "Xóa")!.disabled).toBe(false);
  });
});

describe("AdminDashboard: thao tác LUÔN hỏi xác nhận rồi mới gọi API", () => {
  it("Đình chỉ máy: bấm hiện hộp xác nhận, chưa gọi API; hủy thì không gọi; xác nhận mới gọi review_machine rồi tải lại", async () => {
    await mount();
    await click(tab("Máy"));
    await click(inRow("MayThat", "Đình chỉ"));
    expect(dialog()?.textContent).toContain("Đình chỉ máy?");
    expect(admin.reviewMachine).not.toHaveBeenCalled();
    await click(dialogButton("Quay lại"));
    expect(admin.reviewMachine).not.toHaveBeenCalled();
    const before = admin.snapshot.mock.calls.length;
    await click(inRow("MayThat", "Đình chỉ"));
    await click(dialogButton("Đình chỉ"));
    expect(admin.reviewMachine).toHaveBeenCalledWith("m-real", "suspended");
    expect(admin.snapshot.mock.calls.length).toBeGreaterThan(before);
  });
  it("Đăng lại máy bị đình chỉ gọi review_machine(approved)", async () => {
    await mount();
    await click(tab("Máy"));
    await click(inRow("MayDinhChi", "Đăng lại"));
    await click(dialogButton("Đăng lại"));
    expect(admin.reviewMachine).toHaveBeenCalledWith("m-susp", "approved");
  });
  it("Xóa máy: nói rõ không hoàn tác; xác nhận mới gọi admin_delete_machine", async () => {
    await mount();
    await click(tab("Máy"));
    await click(inRow("MayChuaCoLichSu", "Xóa"));
    expect(dialog()?.textContent).toContain("Không hoàn tác được");
    expect(admin.deleteMachine).not.toHaveBeenCalled();
    await click(dialogButton("Xóa máy"));
    expect(admin.deleteMachine).toHaveBeenCalledWith("m-new");
  });
  it("Thu hồi thiết bị dùng API server của chủ máy/admin (không đường /admin bị proxy chặn)", async () => {
    await mount();
    await click(tab("Máy"));
    await click(inRow("MayThat", "Thu hồi thiết bị")); // chỉ hiện khi agent đã từng ghi danh (health != unknown)
    expect(dialog()?.textContent).toContain("Thu hồi thiết bị?");
    await click(dialogButton("Thu hồi"));
    expect(server.revokeMyDevice).toHaveBeenCalledWith("m-real");
    expect(inRow("MayChuaCoLichSu", "Thu hồi thiết bị")).toBeUndefined(); // máy chưa có agent: không có gì để thu hồi
  });
  it("Đình chỉ host: gọi review_host(suspended)", async () => {
    await mount();
    await click(tab("Host"));
    await click(inRow("Neeez", "Đình chỉ"));
    await click(dialogButton("Đình chỉ"));
    expect(admin.reviewHost).toHaveBeenCalledWith(HOST, "suspended");
  });
});

describe("AdminDashboard: lỗi hiện rõ, không nuốt", () => {
  it("DB từ chối xóa (has_history): hiện thông báo, màn không vỡ", async () => {
    admin.deleteMachine.mockRejectedValue(new Error("Không xóa được: máy này đã từng có tiền hoặc phiên thuê"));
    await mount();
    await click(tab("Máy"));
    await click(inRow("MayChuaCoLichSu", "Xóa"));
    await click(dialogButton("Xóa máy"));
    expect(text()).toContain("Thao tác không thành công");
    expect(text()).toContain("đã từng có tiền hoặc phiên thuê");
    expect(rowOf("MayChuaCoLichSu")).toBeTruthy();
  });
  it("tải dữ liệu lỗi: báo rõ và có nút Tải lại", async () => {
    admin.snapshot.mockRejectedValue(new Error("Không kết nối được tới máy chủ."));
    await mount();
    expect(text()).toContain("Không tải được dữ liệu quản trị");
    expect(text()).toContain("Không kết nối được tới máy chủ.");
    expect(buttons().some((x) => x.textContent?.includes("Tải lại"))).toBe(true);
  });
});

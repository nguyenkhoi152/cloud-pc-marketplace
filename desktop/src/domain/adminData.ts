/**
 * Dữ liệu cho màn Quản trị (admin). Thuần: nhận các hàng THÔ do PostgREST trả về (qua RLS của tài khoản admin) và dựng ra danh sách đã nối tên,
 * đếm, và cờ "xoá được". Không I/O. Tiền luôn là chuỗi đơn vị nhỏ nhất (không dùng number).
 * Quyền thật nằm ở DB (RLS + hàm kiểm admin); `isAdmin` ở giao diện chỉ để ẩn/hiện màn.
 */

export interface RawProfile { user_id: string; display_name: string; created_at: string }
export interface RawHost { user_id: string; status: string; created_at: string }
export interface RawMachine { id: string; name: string; status: string; owner_id: string; machine_key: string; price_units: string; created_at: string; active_booking_id: string | null }
export interface RawBooking { id: string; machine_id: string; renter_id: string; host_id: string; state: string; access_state: string; price_units: string; created_at: string }
export interface RawRole { user_id: string; role: string }
export interface RawAudit { id: number; actor: string | null; action: string; resource: string; outcome: string; detail: unknown; created_at: string }
export interface AdminRaw {
  profiles: RawProfile[];
  hosts: RawHost[];
  machines: RawMachine[];
  bookings: RawBooking[];
  roles: RawRole[];
  audit: RawAudit[];
  /** machineId → "ok" | "suspect" | "incident" | "unknown" (my_machine_health). Máy không có trong bảng coi là "unknown". */
  health: Record<string, string>;
}

export type Health = "ok" | "suspect" | "incident" | "unknown";
export type HostStatus = "pending" | "approved" | "suspended";
export type MachineStatus = "draft" | "review" | "approved" | "suspended";

export interface AdminUser { userId: string; name: string; createdAt: string; isAdmin: boolean; isHost: boolean; hostStatus: HostStatus | null; isTest: boolean }
export interface AdminHost { userId: string; name: string; status: HostStatus; createdAt: string; machines: number; isTest: boolean }
export interface AdminMachine {
  id: string;
  name: string;
  status: MachineStatus;
  ownerId: string;
  ownerName: string;
  machineKey: string;
  priceUnits: string;
  createdAt: string;
  health: Health;
  bookingsTotal: number;
  bookingsLive: number;
  /** Mọi booking đã nạp đều chưa từng chạm tiền/phiên ⇒ DB cho phép xoá (DB vẫn kiểm lại; đây chỉ để bật/tắt nút). */
  deletable: boolean;
  isTest: boolean;
}
export interface AdminBooking { id: string; machineId: string; machineName: string; renterName: string; hostName: string; state: string; accessState: string; priceUnits: string; createdAt: string; live: boolean }
export interface AdminAudit { id: number; actorName: string; action: string; resource: string; outcome: string; createdAt: string }
export interface AdminSnapshot { users: AdminUser[]; hosts: AdminHost[]; machines: AdminMachine[]; bookings: AdminBooking[]; audit: AdminAudit[]; fetchedAt: string }

/** Tài khoản/máy do bộ kiểm tra tự động tạo: mặc định ẩn khỏi danh sách để dashboard không rối. */
export const isTestName = (name: string) => /^(smoke[\s-]|kiểm fuji)/i.test(name.trim());

const DEAD_STATES = new Set(["settled", "refunded", "resolved", "cancelled", "expired"]);
const DEAD_ACCESS = new Set(["not_granted", "reset_verified"]);
/** Khớp public.booking_is_live (DB): booking còn chiếm máy. */
export const isLiveBooking = (state: string, access: string) => !(DEAD_STATES.has(state) && DEAD_ACCESS.has(access));
/** Khớp điều kiện của admin_delete_machine: chưa từng qua bước thanh toán hay cấp quyền xem. */
export const isNeverFunded = (state: string, access: string) => (state === "expired" || state === "cancelled") && access === "not_granted";

const asHealth = (h: string | undefined): Health => (h === "ok" || h === "suspect" || h === "incident" ? h : "unknown");
const asHostStatus = (s: string): HostStatus => (s === "approved" || s === "suspended" ? s : "pending");
const asMachineStatus = (s: string): MachineStatus => (s === "approved" || s === "suspended" || s === "review" ? s : "draft");

export function buildAdminSnapshot(raw: AdminRaw, now = new Date()): AdminSnapshot {
  const nameOf = new Map(raw.profiles.map((p) => [p.user_id, p.display_name]));
  const name = (id: string | null | undefined) => (id ? (nameOf.get(id) ?? `(không rõ ${id.slice(0, 8)})`) : "(hệ thống)");
  const hostStatus = new Map(raw.hosts.map((h) => [h.user_id, asHostStatus(h.status)]));
  const adminIds = new Set(raw.roles.filter((r) => r.role === "admin").map((r) => r.user_id));
  const machineName = new Map(raw.machines.map((m) => [m.id, m.name]));

  const bookingsOf = new Map<string, RawBooking[]>();
  for (const b of raw.bookings) {
    const list = bookingsOf.get(b.machine_id);
    if (list) list.push(b);
    else bookingsOf.set(b.machine_id, [b]);
  }
  const machineCount = new Map<string, number>();
  for (const m of raw.machines) machineCount.set(m.owner_id, (machineCount.get(m.owner_id) ?? 0) + 1);

  const machines: AdminMachine[] = raw.machines.map((m) => {
    const bs = bookingsOf.get(m.id) ?? [];
    return {
      id: m.id,
      name: m.name,
      status: asMachineStatus(m.status),
      ownerId: m.owner_id,
      ownerName: name(m.owner_id),
      machineKey: m.machine_key,
      priceUnits: m.price_units,
      createdAt: m.created_at,
      health: asHealth(raw.health[m.id]),
      bookingsTotal: bs.length,
      bookingsLive: bs.filter((b) => isLiveBooking(b.state, b.access_state)).length,
      deletable: bs.every((b) => isNeverFunded(b.state, b.access_state)),
      isTest: isTestName(m.name) || isTestName(name(m.owner_id)),
    };
  });

  return {
    users: raw.profiles
      .map((p) => ({ userId: p.user_id, name: p.display_name, createdAt: p.created_at, isAdmin: adminIds.has(p.user_id), isHost: hostStatus.has(p.user_id), hostStatus: hostStatus.get(p.user_id) ?? null, isTest: isTestName(p.display_name) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    hosts: raw.hosts
      .map((h) => ({ userId: h.user_id, name: name(h.user_id), status: asHostStatus(h.status), createdAt: h.created_at, machines: machineCount.get(h.user_id) ?? 0, isTest: isTestName(name(h.user_id)) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    machines: machines.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    bookings: raw.bookings
      .map((b) => ({ id: b.id, machineId: b.machine_id, machineName: machineName.get(b.machine_id) ?? "(máy đã xoá)", renterName: name(b.renter_id), hostName: name(b.host_id), state: b.state, accessState: b.access_state, priceUnits: b.price_units, createdAt: b.created_at, live: isLiveBooking(b.state, b.access_state) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    audit: raw.audit.map((a) => ({ id: a.id, actorName: name(a.actor), action: a.action, resource: a.resource, outcome: a.outcome, createdAt: a.created_at })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id),
    fetchedAt: now.toISOString(),
  };
}

export interface AdminSummary {
  hosts: { approved: number; suspended: number };
  machines: { published: number; suspended: number; unpublished: number; online: number; offline: number; busy: number };
  bookings: { total: number; live: number; settled: number; expiredUnfunded: number };
  users: { total: number; test: number };
  /** Máy đang đăng nhưng agent không gửi tín hiệu: người thuê sẽ thấy Offline. */
  attention: AdminMachine[];
}

/** Đếm cho màn Tổng quan. `hideTest`: bỏ tài khoản/máy thử (mặc định khi hiển thị). */
export function summarize(s: AdminSnapshot, hideTest = true): AdminSummary {
  const machines = s.machines.filter((m) => !(hideTest && m.isTest));
  const published = machines.filter((m) => m.status === "approved");
  const busy = published.filter((m) => m.bookingsLive > 0);
  const online = published.filter((m) => m.bookingsLive === 0 && (m.health === "ok" || m.health === "suspect"));
  const hosts = s.hosts.filter((h) => !(hideTest && h.isTest));
  const bookings = hideTest ? s.bookings.filter((b) => !s.machines.find((m) => m.id === b.machineId)?.isTest) : s.bookings;
  return {
    hosts: { approved: hosts.filter((h) => h.status === "approved").length, suspended: hosts.filter((h) => h.status === "suspended").length },
    machines: {
      published: published.length,
      suspended: machines.filter((m) => m.status === "suspended").length,
      unpublished: machines.filter((m) => m.status === "draft" || m.status === "review").length,
      online: online.length,
      offline: published.length - online.length - busy.length,
      busy: busy.length,
    },
    bookings: {
      total: bookings.length,
      live: bookings.filter((b) => b.live).length,
      settled: bookings.filter((b) => b.state === "settled" || b.state === "resolved").length,
      expiredUnfunded: bookings.filter((b) => isNeverFunded(b.state, b.accessState)).length,
    },
    users: { total: s.users.filter((u) => !(hideTest && u.isTest)).length, test: s.users.filter((u) => u.isTest).length },
    attention: published.filter((m) => m.bookingsLive === 0 && (m.health === "unknown" || m.health === "incident")),
  };
}

export const BOOKING_STATE_LABEL: Record<string, string> = {
  reserved: "Đang giữ máy",
  funded: "Đã trả tiền",
  active: "Đang chạy",
  settled: "Đã chia tiền",
  refunded: "Đã hoàn tiền",
  disputed: "Đang tranh chấp",
  resolved: "Đã phân xử",
  cancelled: "Đã hủy",
  expired: "Hết hạn giữ",
};
export const ACCESS_STATE_LABEL: Record<string, string> = {
  not_granted: "Chưa cấp quyền xem",
  preparing: "Đang chuẩn bị",
  ready: "Sẵn sàng",
  granted: "Đã cấp quyền xem",
  revoking: "Đang thu hồi",
  revoked: "Đã thu hồi",
  resetting: "Đang dọn máy",
  reset_verified: "Máy sạch",
  failed: "Lỗi",
  unknown: "Chưa rõ",
};
const AUDIT_LABEL: Record<string, string> = {
  review_host: "Đổi trạng thái host",
  review_machine: "Đổi trạng thái máy",
  publish_machine: "Đăng máy",
  delete_machine: "Xóa máy",
  create_enrollment: "Cấp mã ghi danh thiết bị",
  revoke_device: "Thu hồi thiết bị",
  expire_unfunded_booking: "Nhả máy hết hạn giữ",
  redeem_enrollment: "Thiết bị ghi danh",
  release_machine: "Nhả máy sau phiên",
  chain_event_applied: "Áp sự kiện từ chuỗi",
  chain_event_rejected: "Từ chối sự kiện chuỗi",
  revoke_or_reset_failed: "Thu hồi/dọn máy thất bại",
  faucet_request: "Yêu cầu nhận PCP và AVAX miễn phí",
  faucet_pcp: "Cấp PCP miễn phí",
  faucet_gas: "Cấp AVAX trả phí giao dịch",
  issue_quote: "Báo giá thuê máy",
  job_dead: "Tác vụ nền thất bại nhiều lần",
  activate_sent: "Kích hoạt phiên thuê",
  activation_window_missed: "Lỡ thời hạn kích hoạt",
  claim_after_grace_sent: "Chốt thanh toán sau thời gian chờ",
  grant_failed: "Cấp quyền xem màn hình thất bại",
  prepare_failed: "Chuẩn bị máy thất bại",
  needs_attention: "Cần xem xét thủ công",
  needs_refund: "Cần hoàn tiền",
};
export const auditLabel = (action: string) => AUDIT_LABEL[action] ?? action;

const RESOURCE_KIND: Record<string, string> = { booking: "Phiên thuê", machine: "Máy", host: "Host", wallet: "Ví", device: "Thiết bị" };
/** "booking:b7de698c-…" → "Phiên thuê b7de698c"; dạng lạ giữ nguyên (rút gọn). */
export function resourceLabel(resource: string): string {
  const m = /^([a-z_]+):(.+)$/.exec(resource);
  const kind = m ? RESOURCE_KIND[m[1]!] : undefined;
  if (!m || !kind) return resource.length > 40 ? `${resource.slice(0, 22)}…${resource.slice(-8)}` : resource;
  const id = m[2]!.startsWith("0x") ? `${m[2]!.slice(0, 8)}…${m[2]!.slice(-4)}` : m[2]!.slice(0, 8);
  return `${kind} ${id}`;
}
export const HEALTH_LABEL: Record<Health, string> = { ok: "Online", suspect: "Chậm", incident: "Mất kết nối", unknown: "Chưa kết nối" };

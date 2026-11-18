/**
 * Lớp API THẬT (Supabase). Mọi quyền do RLS/hàm DB quyết định; client chỉ gửi token người dùng (anon key công khai).
 * Không dùng service-role, không tính tiền bằng number: giá/phí luôn là chuỗi đơn vị nhỏ nhất (18 decimals).
 * Hàm nhận `Db` (tập con của SupabaseClient) để test được bằng bản giả có nhãn.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, HostApproval, Machine } from "../domain/types";
import { ServiceError } from "../mock/scenarios";

export type Db = Pick<SupabaseClient, "from" | "rpc" | "auth">;

interface PgErr {
  code?: string;
  message?: string;
}

/** Thông báo nghiệp vụ từ `raise exception` trong DB → tiếng Việt. */
const DB_MESSAGES: Record<string, string> = {
  forbidden: "Bạn không có quyền thực hiện thao tác này.",
  unavailable: "Máy hiện không thể giữ (đang có người giữ, chưa đủ điều kiện hoặc chưa được duyệt).",
  wallet_required: "Cần liên kết ví đã xác minh trước khi giữ máy.",
  invalid_request: "Yêu cầu không hợp lệ.",
  idempotency_conflict: "Khóa yêu cầu đã dùng với nội dung khác. Thử lại từ đầu.",
  commitment_in_use: "Không thể sửa/xóa cam kết đang bảo đảm một booking còn hiệu lực.",
  schedule_overlap: "Khung giờ bị chồng với khung đã có.",
};

export function mapError(e: unknown): ServiceError {
  if (e instanceof ServiceError) return e;
  const err = (e ?? {}) as PgErr & { name?: string; status?: number };
  const msg = String(err.message ?? e);
  if (err.name === "TypeError" || /failed to fetch|networkerror|network request failed|fetch failed/i.test(msg))
    return new ServiceError("offline", "Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.");
  for (const [k, text] of Object.entries(DB_MESSAGES)) if (msg.includes(k)) return new ServiceError("rejected", text);
  if (err.code === "42501" || /permission denied|row-level security/i.test(msg)) return new ServiceError("rejected", "Bạn không có quyền thực hiện thao tác này.");
  if (err.code === "23514" && /commitment_min_4h/.test(msg)) return new ServiceError("rejected", "Cam kết phải kéo dài tối thiểu 4 giờ.");
  if (/invalid login credentials/i.test(msg)) return new ServiceError("auth", "Email hoặc mật khẩu không đúng.");
  if (/email not confirmed/i.test(msg)) return new ServiceError("auth", "Email chưa được xác nhận.");
  if (/user already registered|already been registered/i.test(msg)) return new ServiceError("auth", "Email này đã có tài khoản.");
  if (/rate limit|too many/i.test(msg)) return new ServiceError("auth", "Quá nhiều yêu cầu, thử lại sau ít phút.");
  if (/password/i.test(msg) && /(at least|weak|short)/i.test(msg)) return new ServiceError("auth", "Mật khẩu chưa đủ mạnh (tối thiểu 8 ký tự).");
  return new ServiceError("server", `Máy chủ trả lỗi: ${msg}`);
}

function unwrap<T>(res: { data: T | null; error: PgErr | null }): T {
  if (res.error) throw mapError(res.error);
  return res.data as T;
}
async function guard<T>(fn: () => PromiseLike<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw mapError(e);
  }
}

/* ---------------- tiền: chuỗi đơn vị nhỏ nhất ↔ chuỗi thập phân (không dùng number) ---------------- */
export const UNIT_DECIMALS = 18;
export function formatUnits(units: string | bigint): string {
  const v = BigInt(units);
  const whole = v / 10n ** BigInt(UNIT_DECIMALS);
  const frac = (v % 10n ** BigInt(UNIT_DECIMALS)).toString().padStart(UNIT_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
/** Chuỗi thập phân ≤18 chữ số lẻ → đơn vị nhỏ nhất; từ chối mọi dạng khác (âm, mũ, dấu phẩy, khoảng trắng). */
export function parseUnits(input: string): string {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(input)) throw new ServiceError("rejected", "Giá không hợp lệ (số dương, tối đa 18 chữ số thập phân).");
  const [w, f = ""] = input.split(".");
  const units = BigInt(w!) * 10n ** 18n + BigInt(f.padEnd(18, "0"));
  if (units <= 0n) throw new ServiceError("rejected", "Giá phải lớn hơn 0.");
  return units.toString();
}
/** Chia phí theo bps, phần lẻ về host (khớp splitFee của packages/shared). */
export function splitFeeUnits(gross: string, feeBps: number): { fee: string; host: string } {
  const g = BigInt(gross);
  const fee = (g * BigInt(feeBps)) / 10_000n;
  return { fee: fee.toString(), host: (g - fee).toString() };
}

/** Tiền phải đến dạng chuỗi (select …::text). Nhận number là lỗi: JSON number có thể đã mất chính xác. */
function moneyStr(v: unknown): string {
  if (typeof v === "string" && /^[0-9]+$/.test(v)) return v;
  throw new ServiceError("server", "Máy chủ trả số tiền không ở dạng chuỗi nguyên; từ chối để tránh sai số.");
}

/* ---------------- máy ---------------- */
export interface DeclaredSpecs {
  cpu?: string;
  cores?: number;
  ramGb?: number;
  gpu?: string | null;
  vramGb?: number;
  storageGb?: number;
  networkMbps?: number;
  categories?: Category[];
  location?: string;
  workspace?: boolean;
  summary?: string;
  hostAlias?: string;
}
const CATS: Category[] = ["game", "graphics", "dev"];
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v.slice(0, 200) : d);

export interface PublicMachineRow {
  id: string;
  name: string;
  declared_specs: unknown;
  price_units: string;
  created_at: string;
}
export function mapMachine(r: PublicMachineRow): Machine {
  const s = (r.declared_specs && typeof r.declared_specs === "object" ? r.declared_specs : {}) as Record<string, unknown>;
  const categories = Array.isArray(s.categories) ? (s.categories.filter((c) => CATS.includes(c as Category)) as Category[]) : [];
  const units = moneyStr(r.price_units);
  return {
    id: r.id,
    name: r.name,
    hostAlias: str(s.hostAlias, "Host"),
    categories: categories.length ? categories : ["dev"],
    location: str(s.location, "Chưa khai"),
    cpu: str(s.cpu, "Chưa khai"),
    cores: num(s.cores),
    ramGb: num(s.ramGb),
    gpu: typeof s.gpu === "string" && s.gpu ? s.gpu.slice(0, 120) : null,
    vramGb: num(s.vramGb),
    storageGb: num(s.storageGb),
    networkMbps: num(s.networkMbps),
    // Chỉ để hiển thị/lọc; mọi phép tính tiền thật dùng price_units dạng chuỗi.
    pricePer15: Number(formatUnits(units)),
    workspace: s.workspace === true,
    state: "unverified",
    apps: [],
    windows: [],
    summary: str(s.summary, "Cấu hình do host tự khai, chưa được hệ thống xác minh."),
  };
}
export const priceUnitsOf = (m: PublicMachineRow) => moneyStr(m.price_units);

/* ---------------- booking ---------------- */
export interface LiveBooking {
  id: string;
  machineId: string;
  state: string;
  accessState: string;
  priceUnits: string;
  feeBps: number;
  durationSeconds: number;
  fundBy: string;
  activateBy: string;
  workspaceMode: "none" | "project";
  createdAt: string;
  /** Mốc từ block activate (chuỗi); null trước khi kích hoạt. */
  startedAt: string | null;
  endAt: string | null;
  /** Mã booking trên chuỗi (bytes32, 0x + 64 hex); cần để accept/hủy bằng ví. */
  chainBookingId: string | null;
}
interface BookingRow {
  id: string;
  machine_id: string;
  state: string;
  access_state: string;
  price_units: string;
  fee_bps: number;
  duration_seconds: number;
  fund_by: string;
  activate_by: string;
  workspace_mode: "none" | "project";
  created_at: string;
  started_at?: string | null;
  end_at?: string | null;
  /** PostgREST trả bytea dạng "\x…". */
  chain_booking_id?: string | null;
}
const BOOKING_COLS = "id,machine_id,state,access_state,price_units::text,fee_bps,duration_seconds,fund_by,activate_by,workspace_mode,created_at,started_at,end_at,chain_booking_id";
export function mapBooking(r: BookingRow): LiveBooking {
  return {
    id: r.id,
    machineId: r.machine_id,
    state: r.state,
    accessState: r.access_state,
    priceUnits: moneyStr(r.price_units),
    feeBps: r.fee_bps,
    durationSeconds: r.duration_seconds,
    fundBy: r.fund_by,
    activateBy: r.activate_by,
    workspaceMode: r.workspace_mode,
    createdAt: r.created_at,
    startedAt: r.started_at ?? null,
    endAt: r.end_at ?? null,
    chainBookingId: r.chain_booking_id && /^\\x[0-9a-fA-F]{64}$/.test(r.chain_booking_id) ? `0x${r.chain_booking_id.slice(2)}` : null,
  };
}

export async function requestHash(machineId: string, workspaceMode: string): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify({ machine_id: machineId, workspace_mode: workspaceMode }));
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------------- host ---------------- */
export type HostMachineStatus = "draft" | "review" | "approved" | "suspended";
export interface HostMachine {
  id: string;
  name: string;
  status: HostMachineStatus;
  priceUnits: string;
  specs: DeclaredSpecs;
  machineKey: string;
}
export interface ScheduleRule {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}
export interface Commitment {
  id: string;
  startsAt: string;
  endsAt: string;
}

const hostApprovalOf = (status: string | undefined): HostApproval =>
  status === "approved" ? "approved" : status === "pending" ? "pending" : status === "suspended" ? "rejected" : "none";

export interface LiveAccount {
  userId: string;
  email: string;
  name: string;
  hostApproval: HostApproval;
}

export function createLiveApi(db: Db) {
  const uid = async () => {
    const { data, error } = await db.auth.getUser();
    if (error || !data.user) throw new ServiceError("auth", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
    return data.user;
  };

  const api = {
    /** Access token hiện tại (để gọi API server); null nếu chưa đăng nhập. */
    async accessToken(): Promise<string | null> {
      return (await db.auth.getSession()).data.session?.access_token ?? null;
    },
    auth: {
      async signUp(email: string, password: string, displayName: string): Promise<{ confirmed: boolean }> {
        return guard(async () => {
          const { data, error } = await db.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
          if (error) throw error;
          if (!data.session) return { confirmed: false }; // dự án đang bật xác nhận email
          await api.auth.ensureProfile(displayName);
          return { confirmed: true };
        });
      },
      async signIn(email: string, password: string): Promise<void> {
        await guard(async () => {
          const { error } = await db.auth.signInWithPassword({ email, password });
          if (error) throw error;
          await api.auth.ensureProfile();
        });
      },
      async signOut(): Promise<void> {
        await guard(async () => {
          const { error } = await db.auth.signOut();
          if (error) throw error;
        });
      },
      async recover(email: string): Promise<void> {
        await guard(async () => {
          const { error } = await db.auth.resetPasswordForEmail(email);
          if (error) throw error;
        });
      },
      /** Tạo dòng profiles nếu chưa có (không có trigger tự tạo; reserve_machine cần profile active). */
      async ensureProfile(displayName?: string): Promise<void> {
        const u = await uid();
        const existing = unwrap(await db.from("profiles").select("user_id").eq("user_id", u.id).maybeSingle());
        if (existing) return;
        const meta = (u.user_metadata ?? {}) as { display_name?: unknown };
        const name = (displayName ?? (typeof meta.display_name === "string" ? meta.display_name : "") ?? "").trim() || (u.email ?? "Người dùng").split("@")[0]!;
        unwrap(await db.from("profiles").insert({ user_id: u.id, display_name: name.slice(0, 80) }));
      },
      /** Khôi phục phiên đã lưu (refresh token tự động). null nếu chưa đăng nhập. */
      async restore(): Promise<LiveAccount | null> {
        return guard(async () => {
          const { data } = await db.auth.getSession();
          if (!data.session) return null;
          return api.account();
        });
      },
    },

    wallet: {
      /** Ví đã xác minh của chính người dùng (RLS: chỉ đọc dòng của mình); null nếu chưa liên kết. */
      async linked(): Promise<{ address: string; chainId: number; verifiedAt: string } | null> {
        return guard(async () => {
          const u = await uid();
          const r = unwrap(await db.from("wallet_links").select("address,chain_id,verified_at").eq("user_id", u.id).maybeSingle()) as { address: string; chain_id: number; verified_at: string } | null;
          return r ? { address: r.address, chainId: r.chain_id, verifiedAt: r.verified_at } : null;
        });
      },
    },

    async account(): Promise<LiveAccount> {
      const u = await uid();
      const profile = unwrap(await db.from("profiles").select("display_name").eq("user_id", u.id).maybeSingle()) as { display_name: string } | null;
      const host = unwrap(await db.from("host_profiles").select("status").eq("user_id", u.id).maybeSingle()) as { status: string } | null;
      return {
        userId: u.id,
        email: u.email ?? "",
        name: profile?.display_name ?? (u.email ?? "Người dùng").split("@")[0]!,
        hostApproval: hostApprovalOf(host?.status),
      };
    },

    catalog: {
      async list(): Promise<Machine[]> {
        return guard(async () => {
          const rows = unwrap(await db.from("public_machines").select("id,name,declared_specs,price_units::text,created_at").order("created_at", { ascending: false })) as PublicMachineRow[];
          return rows.map(mapMachine);
        });
      },
      async get(id: string): Promise<{ machine: Machine; priceUnits: string } | null> {
        return guard(async () => {
          const r = unwrap(await db.from("public_machines").select("id,name,declared_specs,price_units::text,created_at").eq("id", id).maybeSingle()) as PublicMachineRow | null;
          return r ? { machine: mapMachine(r), priceUnits: priceUnitsOf(r) } : null;
        });
      },
      async contractConfig(): Promise<{ packageSeconds: number; feeBps: number; chainId: number; quoteTtlSeconds: number; activateBufferSeconds: number }> {
        return guard(async () => {
          const r = unwrap(await db.from("contract_config").select("package_seconds,fee_bps,chain_id,quote_ttl_seconds,activate_buffer_seconds").single()) as {
            package_seconds: number; fee_bps: number; chain_id: number; quote_ttl_seconds: number; activate_buffer_seconds: number;
          };
          return { packageSeconds: r.package_seconds, feeBps: r.fee_bps, chainId: r.chain_id, quoteTtlSeconds: r.quote_ttl_seconds, activateBufferSeconds: r.activate_buffer_seconds };
        });
      },
    },

    bookings: {
      /** Giữ máy nguyên tử ở DB (reserve_machine). `key` giữ nguyên khi thử lại để replay idempotent. */
      async reserve(machineId: string, key: string, workspaceMode: "none" | "project" = "none"): Promise<LiveBooking> {
        return guard(async () => {
          const hash = await requestHash(machineId, workspaceMode);
          const made = unwrap(await db.rpc("reserve_machine", { p_machine_id: machineId, p_idempotency_key: key, p_request_hash: hash, p_workspace_mode: workspaceMode })) as { id: string };
          // Đọc lại với tiền dạng chuỗi (kết quả RPC trả numeric dạng JSON number).
          const r = unwrap(await db.from("bookings").select(BOOKING_COLS).eq("id", made.id).single()) as BookingRow;
          return mapBooking(r);
        });
      },
      async listMine(): Promise<LiveBooking[]> {
        return guard(async () => {
          const u = await uid();
          const rows = unwrap(await db.from("bookings").select(BOOKING_COLS).eq("renter_id", u.id).order("created_at", { ascending: false })) as BookingRow[];
          return rows.map(mapBooking);
        });
      },
    },

    host: {
      async apply(): Promise<void> {
        await guard(async () => {
          const u = await uid();
          unwrap(await db.from("host_profiles").insert({ user_id: u.id }));
        });
      },
      async listMachines(): Promise<HostMachine[]> {
        return guard(async () => {
          const u = await uid();
          const rows = unwrap(await db.from("machines").select("id,name,status,price_units::text,declared_specs,machine_key").eq("owner_id", u.id).order("created_at", { ascending: false })) as {
            id: string; name: string; status: HostMachineStatus; price_units: string; declared_specs: DeclaredSpecs; machine_key: string;
          }[];
          return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, priceUnits: moneyStr(r.price_units), specs: r.declared_specs ?? {}, machineKey: r.machine_key }));
        });
      },
      async createMachine(i: { name: string; pricePcp: string; specs: DeclaredSpecs; machineKey?: string }): Promise<string> {
        return guard(async () => {
          const u = await uid();
          const name = i.name.trim();
          if (name.length < 1 || name.length > 120) throw new ServiceError("rejected", "Tên máy 1–120 ký tự.");
          const key = i.machineKey ?? "m-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
          const r = unwrap(await db.from("machines").insert({ owner_id: u.id, machine_key: key, name, declared_specs: i.specs, price_units: parseUnits(i.pricePcp) }).select("id").single()) as { id: string };
          return r.id;
        });
      },
      async addCommitment(machineId: string, startsAt: Date, endsAt: Date): Promise<void> {
        await guard(async () => {
          unwrap(await db.from("host_commitments").insert({ machine_id: machineId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() }));
        });
      },
      async listCommitments(machineId: string): Promise<Commitment[]> {
        return guard(async () => {
          const rows = unwrap(await db.from("host_commitments").select("id,starts_at,ends_at").eq("machine_id", machineId).order("starts_at")) as { id: string; starts_at: string; ends_at: string }[];
          return rows.map((r) => ({ id: r.id, startsAt: r.starts_at, endsAt: r.ends_at }));
        });
      },
      async submitForReview(machineId: string): Promise<void> {
        await guard(async () => {
          unwrap(await db.rpc("submit_machine_for_review", { p_machine: machineId }));
        });
      },
      async listRules(machineId: string): Promise<ScheduleRule[]> {
        return guard(async () => {
          const rows = unwrap(await db.from("host_schedule_rules").select("id,weekday,start_minute,end_minute").eq("machine_id", machineId).order("weekday").order("start_minute")) as { id: string; weekday: number; start_minute: number; end_minute: number }[];
          return rows.map((r) => ({ id: r.id, weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute }));
        });
      },
      async addRule(machineId: string, weekday: number, startMinute: number, endMinute: number): Promise<void> {
        await guard(async () => {
          unwrap(await db.from("host_schedule_rules").insert({ machine_id: machineId, weekday, start_minute: startMinute, end_minute: endMinute }));
        });
      },
      async removeRule(ruleId: string): Promise<void> {
        await guard(async () => {
          unwrap(await db.from("host_schedule_rules").delete().eq("id", ruleId));
        });
      },
      async setAccepting(machineId: string, accepting: boolean): Promise<void> {
        await guard(async () => {
          // Không dùng upsert: PostgREST ghi cả machine_id trong UPDATE, cột này chỉ có quyền INSERT (grant theo cột).
          const cur = unwrap(await db.from("machine_availability").select("machine_id").eq("machine_id", machineId).maybeSingle());
          if (cur) unwrap(await db.from("machine_availability").update({ accepting }).eq("machine_id", machineId));
          else unwrap(await db.from("machine_availability").insert({ machine_id: machineId, accepting }));
        });
      },
      async getAccepting(machineId: string): Promise<boolean> {
        return guard(async () => {
          const r = unwrap(await db.from("machine_availability").select("accepting").eq("machine_id", machineId).maybeSingle()) as { accepting: boolean } | null;
          return r?.accepting ?? false;
        });
      },
      async windows(machineId: string, from: string, to: string): Promise<{ day: string; startsAt: string; endsAt: string }[]> {
        return guard(async () => {
          const rows = unwrap(await db.rpc("schedule_windows", { p_machine: machineId, p_from: from, p_to: to })) as { day: string; starts_at: string; ends_at: string }[];
          return rows.map((r) => ({ day: r.day, startsAt: r.starts_at, endsAt: r.ends_at }));
        });
      },
      async health(machineId: string): Promise<"unknown" | "ok" | "suspect" | "incident"> {
        return guard(async () => unwrap(await db.rpc("my_machine_health", { p_machine: machineId })) as "unknown" | "ok" | "suspect" | "incident");
      },
      /** Phiên trên các máy của host (RLS: host_id = người đang đăng nhập). Không trả thông tin định danh của khách. */
      async listBookings(limit = 20): Promise<LiveBooking[]> {
        return guard(async () => {
          const u = await uid();
          const rows = unwrap(await db.from("bookings").select(BOOKING_COLS).eq("host_id", u.id).order("created_at", { ascending: false }).limit(limit)) as BookingRow[];
          return rows.map(mapBooking);
        });
      },
    },

    /** Chỉ cho admin (kiểm quyền ở DB). Dùng trong smoke test; UI chưa có màn hình admin. */
    admin: {
      async reviewHost(userId: string, status: "pending" | "approved" | "suspended"): Promise<void> {
        await guard(async () => {
          unwrap(await db.rpc("review_host", { p_user: userId, p_status: status }));
        });
      },
      async reviewMachine(machineId: string, status: "draft" | "review" | "approved" | "suspended"): Promise<void> {
        await guard(async () => {
          unwrap(await db.rpc("review_machine", { p_machine: machineId, p_status: status }));
        });
      },
    },
  };
  return api;
}
export type LiveApi = ReturnType<typeof createLiveApi>;

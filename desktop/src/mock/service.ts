/**
 * Lớp dịch vụ MOCK. Không có mạng, backend hay blockchain thật. UI chỉ nói chuyện với module này
 * (đọc qua `useAsync`, thao tác qua store). Kịch bản demo quyết định kết quả/độ trễ.
 */
import { checkCompatibility } from "../domain/compat";
import type { AppNotification, HistoryItem, Incident, Machine, Workspace } from "../domain/types";
import { HISTORY, HOST_PROFILES, INCIDENTS_SEED, INSTALL_COMPONENTS, MACHINES, NOTIFICATIONS, WORKSPACES } from "./fixtures";
import { ServiceError, type ScenarioId } from "./scenarios";

let scenario: ScenarioId = "normal";
export const setServiceScenario = (s: ScenarioId) => {
  scenario = s;
};
export const currentScenario = () => scenario;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Bộ nhớ "máy chủ" giả: thay đổi chỉ tồn tại tới khi tải lại trang. */
const db = {
  history: [...HISTORY],
  workspaces: [...WORKSPACES],
  notifications: [...NOTIFICATIONS],
  incidents: [...INCIDENTS_SEED],
  machineState: {} as Record<string, Machine["state"]>,
};

const withState = (m: Machine): Machine => ({ ...m, state: db.machineState[m.id] ?? m.state });

async function read<T>(data: () => T, opts: { emptyValue?: T; delay?: number } = {}): Promise<T> {
  await sleep(scenario === "loading" ? 2800 : (opts.delay ?? 450));
  if (scenario === "offline") throw new ServiceError("offline", "Không có kết nối mạng.");
  if (scenario === "error") throw new ServiceError("server", "Dịch vụ mô phỏng đang trả lỗi.");
  if (scenario === "empty" && opts.emptyValue !== undefined) return opts.emptyValue;
  return data();
}

export const service = {
  listMachines: () => read<Machine[]>(() => MACHINES.map(withState), { emptyValue: [] }),
  getMachine: (id: string) => read<Machine | null>(() => MACHINES.map(withState).find((m) => m.id === id) ?? null, { delay: 300 }),
  setMachineState: (id: string, state: Machine["state"]) => void (db.machineState[id] = state),
  listHistory: () => read<HistoryItem[]>(() => db.history, { emptyValue: [] }),
  getHistoryItem: (id: string) => read<HistoryItem | null>(() => db.history.find((h) => h.id === id) ?? null, { delay: 250 }),
  listWorkspaces: () => read<Workspace[]>(() => db.workspaces, { emptyValue: [] }),
  listNotifications: () => read<AppNotification[]>(() => db.notifications, { emptyValue: [] }),
  listIncidents: () => read<Incident[]>(() => db.incidents, { emptyValue: [] }),

  /** Ghi (mock): chỉ gọi từ store sau khi có sự kiện thật trong luồng demo. */
  addHistory: (h: HistoryItem) => void db.history.unshift(h),
  addWorkspace: (w: Workspace) => void db.workspaces.unshift(w),
  deleteWorkspace: (id: string) => void (db.workspaces = db.workspaces.filter((w) => w.id !== id)),
  markNotification: (id: string, read: boolean) => void (db.notifications = db.notifications.map((n) => (n.id === id ? { ...n, read } : n))),
  markAllNotifications: () => void (db.notifications = db.notifications.map((n) => ({ ...n, read: true }))),
  addNotification: (n: AppNotification) => void db.notifications.unshift(n),
  addIncident: (i: Incident) => void db.incidents.unshift(i),
  resolveIncident: (id: string) => void (db.incidents = db.incidents.map((i) => (i.id === id ? { ...i, status: "resolved" as const } : i))),

  async runCompatCheck(profileId: string) {
    await sleep(1600);
    if (scenario === "offline") throw new ServiceError("offline", "Cần mạng để kiểm tra phiên bản thành phần.");
    const p = HOST_PROFILES.find((x) => x.id === profileId) ?? HOST_PROFILES[0]!;
    return { profile: p, ...checkCompatibility(p) };
  },

  /** Một bước cài đặt mô phỏng. Ở kịch bản lỗi, bước thứ 3 thất bại. */
  async installStep(index: number) {
    await sleep(1100);
    if (scenario === "offline") throw new ServiceError("offline", "Mất mạng khi tải thành phần.");
    if (scenario === "error" && index === 2)
      throw new ServiceError("server", `Không tải được ${INSTALL_COMPONENTS[index]?.name ?? "thành phần"} (mô phỏng).`);
  },

  async submitListing() {
    await sleep(1200);
    if (scenario === "offline") throw new ServiceError("offline", "Không gửi được: không có mạng.");
    if (scenario === "error") throw new ServiceError("server", "Gửi duyệt thất bại (mô phỏng). Thử lại sau.");
  },

  async prepareStep(index: number) {
    await sleep(1000);
    if (scenario === "offline") throw new ServiceError("offline", "Mất mạng khi chuẩn bị phiên.");
    if (scenario === "error" && index === 1) throw new ServiceError("server", "Không khởi tạo được môi trường Linux của phiên (mô phỏng).");
  },

  async saveWorkspace() {
    await sleep(1800);
    if (scenario === "save-fail") throw new ServiceError("server", "Checkpoint workspace không xác nhận được (mô phỏng).");
    if (scenario === "offline") throw new ServiceError("offline", "Mất mạng khi lưu workspace.");
  },

  async cleanup() {
    await sleep(2000);
    if (scenario === "cleanup-fail") throw new ServiceError("server", "Reset môi trường không xác minh được (mô phỏng).");
  },

  async reconnect() {
    await sleep(2200);
    if (scenario === "offline") throw new ServiceError("offline", "Vẫn chưa có mạng.");
  },
};

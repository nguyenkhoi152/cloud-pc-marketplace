/** Kiểu dữ liệu dùng chung cho toàn app. Chỉ mô phỏng — chưa có backend. */

export type Mode = "rent" | "host";
export type Category = "game" | "graphics" | "dev";
export type HostApproval = "none" | "pending" | "rejected" | "approved";
export type SupportLevel = "verified" | "limited" | "untested";

export interface Account {
  name: string;
  email: string;
  mode: Mode;
  /** Quyền host chỉ đổi qua duyệt, không đổi khi chuyển chế độ. */
  hostApproval: HostApproval;
}

export interface AppCompat {
  name: string;
  kind: "game" | "app";
  level: SupportLevel;
  note: string;
}

/** Khung giờ host cung cấp máy trong một ngày cụ thể (giờ địa phương GMT+7). */
export interface OfferWindow {
  date: string; // YYYY-MM-DD
  start: string; // HH:mm
  end: string; // HH:mm
}

export type MachineState = "available" | "busy" | "offline" | "blocked";

export interface Machine {
  id: string;
  name: string;
  hostAlias: string;
  categories: Category[];
  location: string;
  cpu: string;
  cores: number;
  ramGb: number;
  gpu: string | null;
  vramGb: number;
  storageGb: number;
  networkMbps: number;
  pricePer15: number; // PCP thử / 15 phút
  workspace: boolean;
  state: MachineState;
  apps: AppCompat[];
  windows: OfferWindow[];
  summary: string;
}

export interface TimeRange {
  start: string;
  end: string;
}
/** Chỉ số 0 = Thứ Hai … 6 = Chủ nhật. */
export type WeeklySchedule = TimeRange[][];

export type ScheduleException =
  | { id: string; date: string; kind: "skip" }
  | { id: string; date: string; kind: "custom"; ranges: TimeRange[] };

export type TxKind = "faucet" | "hold" | "charge" | "refund" | "host_earning";
export type TxStatus = "done" | "held";
export interface Transaction {
  id: string;
  at: string;
  kind: TxKind;
  /** Sổ ghi: số dư sử dụng hoặc thu nhập host. */
  ledger: "usable" | "host";
  amount: number; // dương = cộng, âm = trừ
  status: TxStatus;
  label: string;
  sessionId?: string;
}

export interface Wallet {
  usable: number;
  hostSettled: number;
  /** Thu nhập chưa ghi nhận vì cleanup chưa xác nhận. */
  hostHeld: number;
  faucetClaimed: boolean;
  transactions: Transaction[];
}

export interface Quote {
  slots: number;
  minutes: number;
  gross: number;
  fee: number;
  hostNet: number;
}

export interface Workspace {
  id: string;
  name: string;
  machineName: string;
  sizeMb: number;
  checkpoints: number;
  savedAt: string;
  status: "saved" | "save_failed";
}

export interface HistoryItem {
  id: string;
  machineName: string;
  hostAlias: string;
  startedAt: string;
  minutes: number;
  charged: number;
  refunded: number;
  workspace: "none" | "saved" | "failed" | "skipped";
  outcome: "completed" | "cleanup_failed" | "prepare_failed";
}

export interface AppNotification {
  id: string;
  at: string;
  scope: "rent" | "host" | "all";
  title: string;
  body: string;
  tone: "info" | "warn" | "error" | "ok";
  read: boolean;
}

export interface Incident {
  id: string;
  at: string;
  title: string;
  detail: string;
  status: "open" | "resolved";
  kind: "cleanup" | "network" | "other";
}

export type HostMachineState = "offline" | "paused" | "accepting" | "busy" | "blocked";

export interface HostProfile {
  id: string;
  label: string;
  cpu: string;
  cores: number;
  ramGb: number;
  gpu: string | null;
  vramGb: number;
  os: string;
  virtualization: boolean;
  wsl: "ready" | "not_installed";
  freeDiskGb: number;
  uploadMbps: number;
}

export interface HostConfig {
  name: string;
  cores: number;
  ramGb: number;
  shareGpu: boolean;
  storageGb: number;
  pricePer15: number;
  categories: Category[];
  weekly: WeeklySchedule;
  exceptions: ScheduleException[];
}

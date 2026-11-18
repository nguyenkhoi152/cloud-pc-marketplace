export type ScenarioId =
  | "normal"
  | "empty"
  | "loading"
  | "error"
  | "offline"
  | "host-pending"
  | "save-fail"
  | "cleanup-fail";

export interface ScenarioInfo {
  id: ScenarioId;
  label: string;
  hint: string;
}

export const SCENARIOS: ScenarioInfo[] = [
  { id: "normal", label: "Thành công", hint: "Mọi thao tác mô phỏng đều thành công." },
  { id: "empty", label: "Chưa có dữ liệu", hint: "Danh sách máy, lịch sử, workspace, thông báo đều trống." },
  { id: "loading", label: "Đang tải chậm", hint: "Mỗi lần tải dữ liệu chờ vài giây với khung xương." },
  { id: "error", label: "Lỗi dịch vụ", hint: "Tải danh sách lỗi; chuẩn bị phiên và cài đặt host thất bại." },
  { id: "offline", label: "Mất mạng", hint: "Thiết bị offline: thao tác cần mạng bị chặn, phiên mất kết nối." },
  { id: "host-pending", label: "Host chưa được duyệt", hint: "Tài khoản đã gửi đăng máy nhưng chưa được duyệt." },
  { id: "save-fail", label: "Lỗi lưu workspace", hint: "Khi kết thúc phiên, lưu workspace thất bại." },
  { id: "cleanup-fail", label: "Lỗi dọn dẹp (cleanup)", hint: "Dọn dẹp sau phiên thất bại; máy bị khóa, không nhận khách." },
];

export class ServiceError extends Error {
  constructor(
    public code: "offline" | "server" | "unsupported" | "auth" | "rejected",
    message: string,
  ) {
    super(message);
  }
}

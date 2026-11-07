import { Card, DisabledAction, PageTitle, StatusPill } from "@/components/ui";
import { previewMachines } from "@cpm/shared";

export default function HostPage() {
  return (
    <>
      <PageTitle sub="Quyền host do admin cấp ở server; client không tự cấp.">Bảng điều khiển host</PageTitle>
      <h2 className="font-medium mb-2">Máy của tôi (minh hoạ)</h2>
      <ul className="space-y-3">
        {previewMachines.slice(0, 1).map((m) => (
          <li key={m.id}>
            <Card>
              <div className="flex justify-between">
                <span>{m.name}</span>
                <StatusPill>Đã duyệt (minh hoạ)</StatusPill>
              </div>
              <p className="text-sm opacity-70 mt-1">Cửa sổ sẵn sàng ≥ 4 giờ · heartbeat: chưa có agent</p>
            </Card>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-6">
        <DisabledAction label="Tạo listing mới" reason="cần đăng nhập và quyền host (M2)." />
        <DisabledAction label="Đăng cửa sổ sẵn sàng" reason="cần host agent và heartbeat (M4)." />
      </div>
    </>
  );
}

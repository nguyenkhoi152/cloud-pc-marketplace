import { cloudState } from "@cpm/shared";
import { Card, DisabledAction, PageTitle } from "@/components/ui";

export default function WorkspacePage() {
  return (
    <>
      <PageTitle sub="Mặc định không bật cloud: dự án không được tải lên. “Đã lưu” chỉ sau khi checkpoint được xác nhận.">
        Workspace
      </PageTitle>
      <Card>
        <p className="text-sm mb-2">Trạng thái hiện tại: <strong>NotEnabled</strong></p>
        <ul className="text-sm space-y-1">
          <li>Quota demo: 100 MiB gồm mọi phiên bản, tối đa 3 checkpoint thành công, một writer.</li>
          <li>Mỗi file ≤ 10 MiB, ≤ 500 file; giữ 7 ngày từ checkpoint cuối.</li>
          <li>Không chuyển toàn bộ Windows/RAM/ứng dụng. Cần export dự án trước khi kết thúc nếu không bật cloud.</li>
        </ul>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {cloudState.options.map((s) => (
            <li key={s} className="rounded-full bg-slate-200 text-slate-800 px-2 py-0.5">{s}</li>
          ))}
        </ul>
      </Card>
      <div className="mt-6 flex flex-wrap gap-6">
        <DisabledAction label="Bật workspace cloud" reason="cần WorkspaceService và storage (M5)." />
        <DisabledAction label="Khôi phục phiên bản" reason="cần checkpoint đã xác nhận (M5)." />
      </div>
    </>
  );
}

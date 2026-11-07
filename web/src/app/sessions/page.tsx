import { remoteState } from "@cpm/shared";
import { Card, DisabledAction, PageTitle } from "@/components/ui";

export default function SessionsPage() {
  return (
    <>
      <PageTitle sub="Chưa có phiên nào. Quyền truy cập chỉ được cấp sau khi nhận tiền đã xác nhận và kích hoạt.">
        Phiên thuê
      </PageTitle>
      <Card>
        <p className="text-sm mb-2">Các trạng thái remote sẽ hiển thị riêng (không gộp thành “thành công”):</p>
        <ul className="flex flex-wrap gap-2 text-xs">
          {remoteState.options.map((s) => (
            <li key={s} className="rounded-full bg-slate-200 text-slate-800 px-2 py-0.5">{s}</li>
          ))}
        </ul>
      </Card>
      <div className="mt-6">
        <DisabledAction label="Mở Moonlight / ghép cặp" reason="cần host agent và Sunshine thật (M4); preview không giả desktop." />
      </div>
    </>
  );
}

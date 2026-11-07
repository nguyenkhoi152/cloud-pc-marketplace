import { previewPendingReview } from "@cpm/shared";
import { Card, DisabledAction, PageTitle, StatusPill } from "@/components/ui";

export default function AdminPage() {
  return (
    <>
      <PageTitle sub="Preview: trang này chưa có kiểm tra quyền admin; M2 sẽ chặn ở server/RLS.">Duyệt máy</PageTitle>
      <ul className="space-y-3">
        {previewPendingReview.map((m) => (
          <li key={m.id}>
            <Card>
              <div className="flex justify-between">
                <span>{m.name}</span>
                <StatusPill>Chờ duyệt (minh hoạ)</StatusPill>
              </div>
              <p className="text-sm opacity-70 mt-1">
                {m.cpu} · {m.ramGb} GB · {m.gpu ?? "Không GPU rời"} · khai báo ngày {m.lastCheckedAt}
              </p>
              <div className="mt-3 flex flex-wrap gap-6">
                <DisabledAction label="Duyệt" reason="cần xác thực admin và DB (M2)." />
                <DisabledAction label="Từ chối / tạm dừng" reason="cần xác thực admin và DB (M2)." />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

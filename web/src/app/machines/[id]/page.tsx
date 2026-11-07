import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_PACKAGE, previewMachines } from "@cpm/shared";
import { Card, PageTitle } from "@/components/ui";

export default async function MachinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = previewMachines.find((x) => x.id === id);
  if (!m) notFound();

  return (
    <>
      <PageTitle sub={`Host: ${m.hostName} · kiểm tra cấu hình lần cuối ${m.lastCheckedAt} (khai báo minh hoạ)`}>
        {m.name}
      </PageTitle>
      <Card>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt>CPU</dt><dd>{m.cpu}</dd>
          <dt>RAM</dt><dd>{m.ramGb} GB</dd>
          <dt>GPU</dt><dd>{m.gpu ? `${m.gpu} (${m.vramGb} GB VRAM)` : "Không có GPU rời"}</dd>
          <dt>Hệ điều hành</dt><dd>{m.os}</dd>
          <dt>Ứng dụng</dt><dd>{m.apps.join(", ")}</dd>
          <dt>Vùng</dt><dd>{m.region}</dd>
          <dt>Cửa sổ host cam kết</dt><dd>≥ {m.windowHours} giờ</dd>
          <dt>Workspace</dt><dd>{m.workspaceCompatible ? "Tương thích" : "Chưa tương thích"}</dd>
          <dt>Trạng thái online</dt><dd>Chưa xác định (chưa có heartbeat)</dd>
          <dt>Gói demo</dt><dd>{DEMO_PACKAGE.durationSeconds / 60} phút · {m.pricePcp} PCP</dd>
        </dl>
      </Card>
      <div className="mt-6 flex flex-wrap gap-6 items-start">
        <Link href={`/checkout/${m.id}`} className="rounded bg-slate-800 text-white px-4 py-2 text-sm">
          Xem trang đặt thuê (preview)
        </Link>
      </div>
    </>
  );
}


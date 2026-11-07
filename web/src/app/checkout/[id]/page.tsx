import { notFound } from "next/navigation";
import { DEMO_PACKAGE, formatPcp, parsePositivePcp, previewMachines, splitFee } from "@cpm/shared";
import { Card, DisabledAction, PageTitle } from "@/components/ui";

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = previewMachines.find((x) => x.id === id);
  if (!m) notFound();
  const { fee, host } = splitFee(parsePositivePcp(m.pricePcp), DEMO_PACKAGE.feeBps);

  return (
    <>
      <PageTitle sub="Preview: chưa có quote ký, chưa có hợp đồng escrow.">Đặt thuê — {m.name}</PageTitle>
      <Card>
        <ul className="text-sm space-y-1">
          <li>Gói: {DEMO_PACKAGE.durationSeconds / 60} phút, trả {m.pricePcp} PCP (token thử).</li>
          <li>Phí nền tảng {DEMO_PACKAGE.feeBps / 100}% phần gross trả host: {formatPcp(fee)} PCP; host nhận {formatPcp(host)} PCP.</li>
          <li>Kết thúc sớm hoặc xác nhận hoàn tất vẫn trả cả gói; huỷ trước khi kích hoạt được hoàn đủ.</li>
          <li>Thời gian bắt đầu tính từ block kích hoạt trên chain; thời gian chờ xác nhận nằm trong gói.</li>
          <li>Máy bị khoá tới khi tiền ở trạng thái cuối và quyền truy cập đã thu hồi/reset được xác minh.</li>
        </ul>
      </Card>
      <div className="mt-6">
        <DisabledAction
          label="Ký và thanh toán PCP"
          reason="cần đăng nhập, liên kết ví, quote ký và escrow (M2–M3); preview không tạo receipt giả."
        />
      </div>
    </>
  );
}

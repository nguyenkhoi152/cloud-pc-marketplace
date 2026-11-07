import { Card, DisabledAction, PageTitle } from "@/components/ui";

export default function HistoryPage() {
  return (
    <>
      <PageTitle sub="Chỉ hiển thị giao dịch có receipt xác nhận từ chain; preview không tạo receipt.">
        Lịch sử thuê
      </PageTitle>
      <Card>
        <p className="text-sm">Chưa có giao dịch nào.</p>
      </Card>
      <div className="mt-6 flex flex-wrap gap-6">
        <DisabledAction label="Báo sự cố" reason="cần booking thật (M2–M4)." />
        <DisabledAction label="Mở tranh chấp" reason="cần escrow on-chain (M3)." />
      </div>
    </>
  );
}

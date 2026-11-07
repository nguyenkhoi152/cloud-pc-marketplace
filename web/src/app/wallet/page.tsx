import { Card, DisabledAction, PageTitle } from "@/components/ui";

const buckets = ["Available", "Reserved", "Spent", "Refunded", "Earned", "Withdrawable"];

export default function WalletPage() {
  return (
    <>
      <PageTitle sub="PCP là token thử trên Avalanche Fuji, không có giá trị tiền thật, không mua/bán/rút VND.">
        Ví PCP
      </PageTitle>
      <Card>
        <p className="text-sm mb-3">Chưa liên kết ví — không có số dư thật để hiển thị.</p>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          {buckets.map((b) => (
            <li key={b} className="rounded border px-3 py-2">{b}: <span className="opacity-60">—</span></li>
          ))}
        </ul>
      </Card>
      <div className="mt-6 flex flex-wrap gap-6">
        <DisabledAction label="Liên kết ví" reason="cần challenge có nonce và xác minh server (M2)." />
        <DisabledAction label="Nhận 1.000 PCP thử" reason="cần faucet allowlist và contract PCP (M3)." />
        <DisabledAction label="Rút credit" reason="cần escrow pull-credit (M3)." />
      </div>
    </>
  );
}

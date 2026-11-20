import { Clock, Coins, Wallet } from "lucide-react";
import { useState } from "react";
import { getDevWallet, getLiveApi, getServerApi } from "@/api";
import { summarizeEarnings, type EarningRow } from "@/domain/earnings";
import { stagger } from "@/lib/utils";
import { useAsync } from "@/state/useAsync";
import { Button } from "@/ui/button";
import { Async, Banner } from "@/ui/feedback";
import { PageHeader, Section, StatTile } from "@/ui/page";
import { Amount } from "./Amount";

const TZ = "Asia/Ho_Chi_Minh";
const fmt = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: TZ, hour12: false, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Rows({ rows, empty }: { rows: EarningRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-ink-soft">{empty}</p>;
  return (
    <ul className="space-y-1.5" data-testid="earn-rows">
      {rows.slice(0, 20).map((r, i) => (
        <li key={r.id} style={stagger(i)} className="enter flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm">
          <span className="text-ink-soft">Phiên {r.id.slice(0, 8)} · {fmt(r.createdAt)}</span>
          <span className="font-semibold">+<Amount units={r.hostUnits} suffix="PCP" inline /></span>
        </li>
      ))}
    </ul>
  );
}

/** Thu nhập host (chế độ live): từ booking đọc qua RLS + số dư có thể rút đọc thẳng từ escrow bằng ví của app. */
export function HostEarnings() {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const wallet = getDevWallet();
  const state = useAsync(async () => {
    const bookings = await getLiveApi().host.listBookings();
    let credit: string | null = null;
    let creditNote = "";
    if (wallet) {
      try {
        const ci = await getServerApi().chainInfo();
        credit = await wallet.credit(ci.escrow as `0x${string}`);
      } catch (e) {
        creditNote = (e as Error).message;
      }
    } else creditNote = "Chưa có ví trong ứng dụng nên chưa xem được số tiền có thể rút.";
    return { e: summarizeEarnings(bookings), credit, creditNote };
  }, [tick]);

  const withdraw = async () => {
    if (!wallet) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const ci = await getServerApi().chainInfo();
      const tx = await wallet.withdraw(ci.escrow as `0x${string}`);
      setMsg(`Đã rút về ví (giao dịch ${tx.slice(0, 10)}…).`);
      setTick((n) => n + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Thu nhập" subtitle="Thu nhập từ các phiên thuê máy của bạn." />
      <Async state={state} skeleton={<p className="text-sm text-ink-faint">Đang tải…</p>}>
        {({ e, credit, creditNote }) => (
          <>
            <Section title="Tổng quan">
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile index={0} icon={Coins} tone="ok" label="Đã nhận" value={<Amount testId="earn-settled" units={e.settledTotal} suffix="PCP" />} hint="Từ các phiên đã hoàn tất" />
                <StatTile index={1} icon={Clock} label="Đang chờ" value={<Amount testId="earn-pending" units={e.pendingTotal} suffix="PCP" />} hint="Phiên chưa kết thúc" />
                <StatTile
                  index={2}
                  icon={Wallet}
                  tone="warn"
                  label="Có thể rút về ví"
                  value={credit === null ? <span className="block text-sm font-medium leading-snug text-ink-faint">{creditNote || "Chưa xem được"}</span> : <Amount testId="earn-credit" units={credit} suffix="PCP" />}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={() => void withdraw()} disabled={busy || !wallet || !credit || credit === "0"} loading={busy}>Rút về ví</Button>
                <Button variant="ghost" onClick={() => setTick((n) => n + 1)}>Làm mới</Button>
                {wallet && credit === "0" && <span className="text-xs text-ink-faint">Chưa có gì để rút.</span>}
              </div>
              {msg && <Banner tone="ok" className="mt-2" title="Đã rút">{msg}</Banner>}
              {err && <Banner tone="danger" className="mt-2" title="Chưa rút được">{err}</Banner>}
              <p className="mt-2 text-xs text-ink-faint">Số “Đã nhận” cập nhật khi phiên hoàn tất. Số “Có thể rút” là tiền đang chờ trong hợp đồng giữ tiền, tính theo ví đang dùng trong ứng dụng. Rút về ví cần một ít AVAX để trả phí giao dịch.</p>
            </Section>
            <Section title="Đã hoàn tất" bordered className="mt-4"><Rows rows={e.settled} empty="Chưa có phiên nào hoàn tất." /></Section>
            <Section title="Đang chờ" bordered className="mt-4"><Rows rows={e.pending} empty="Không có phiên đang chạy." /></Section>
            {e.resolved.length > 0 && (
              <Section title="Đã phân xử" bordered className="mt-4">
                <Banner tone="info" title="Không cộng vào tổng">Với phiên đã phân xử, số tiền do trọng tài quyết định nên không tính vào các tổng ở trên.</Banner>
                <ul className="mt-2 space-y-1 text-sm">{e.resolved.map((r) => <li key={r.id} className="text-ink-soft">Phiên {r.id.slice(0, 8)} · {fmt(r.createdAt)}</li>)}</ul>
              </Section>
            )}
          </>
        )}
      </Async>
    </div>
  );
}

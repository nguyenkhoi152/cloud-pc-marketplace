/**
 * Giới thiệu ứng dụng: mục đích, đối tượng, cách hoạt động, quy tắc thanh toán và điều khoản sử dụng bản thử nghiệm.
 * Nội dung nằm ở aboutContent.ts (mỗi câu có nguồn). Khối "Mạng & hợp đồng" chỉ có ở bản live; bản xem trước hiện cùng nội dung
 * nhưng giữ dải "Dữ liệu mẫu". Chuyển mục bằng Tabs (không dùng neo #… vì router theo hash).
 */
import { ArrowDownToLine, ArrowRight, Check, Clock, Coins, ExternalLink, FileText, Flag, Lock, MonitorSmartphone, Pause, Percent, RotateCcw, Scale, Server, Target, Users, Wallet, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { apiBase } from "@/api";
import { isLive } from "@/api/env";
import { envFacts } from "@/api/envFacts";
import { fetchChainInfo } from "@/api/server";
import { networkLabel } from "@/domain/envLabels";
import { cn } from "@/lib/utils";
import { useAsync } from "@/state/useAsync";
import { Banner } from "@/ui/feedback";
import { TabPanel, Tabs } from "@/ui/controls";
import { PageHeader } from "@/ui/page";
import { ABOUT_UPDATED, AUDIENCES, HIGHLIGHTS, HOST_STEPS, PAYMENT_RULES, PCP_FACTS, PURPOSE, RENTER_STEPS, TERMS, type PaymentIcon, type Step } from "./aboutContent";

const SNOWTRACE = "https://testnet.snowtrace.io/address/";
const FUJI = 43113;

const card = "rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgb(15_23_42/0.05)]";
const stagger = (i: number) => ({ "--i": i }) as React.CSSProperties;

function Badge({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-tint text-teal-ink", className)} aria-hidden><Icon className="h-5 w-5" /></span>;
}

/* ---------- Tổng quan ---------- */
export function OverviewTab() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className={cn(card, "enter flex flex-col")} style={stagger(0)} aria-labelledby="about-purpose">
          <div className="flex items-center gap-3"><Badge icon={Target} /><h2 id="about-purpose" className="text-lg font-bold">Mục đích</h2></div>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">{PURPOSE}</p>
          <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-line pt-4" data-testid="about-highlights">
            {HIGHLIGHTS.map((h) => (
              <div key={h.label}><dt className="sr-only">{h.label}</dt><dd className="text-xl font-bold leading-tight text-teal-ink">{h.value}</dd><p className="mt-0.5 text-xs text-ink-faint" aria-hidden>{h.label}</p></div>
            ))}
          </dl>
        </section>
        <section className="enter rounded-xl bg-panel p-5 text-white" style={stagger(1)} aria-labelledby="about-pcp">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-2 text-panel-ink" aria-hidden><Coins className="h-5 w-5" /></span>
            <h2 id="about-pcp" className="text-lg font-bold">PC Point (PCP)</h2>
          </div>
          <ul className="mt-3 space-y-2 text-sm leading-snug text-panel-ink">
            {PCP_FACTS.map((f) => (
              <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-white" aria-hidden />{f}</li>
            ))}
          </ul>
        </section>
      </div>

      <div>
        <h2 className="mb-3 flex items-center gap-2 text-base font-bold"><Users className="h-4 w-4 text-teal" aria-hidden />Dành cho ai</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {AUDIENCES.map((a, i) => (
            <section key={a.id} className={cn(card, "enter")} style={stagger(i + 2)} aria-labelledby={`about-aud-${a.id}`}>
              <div className="flex items-center gap-3">
                <Badge icon={a.id === "rent" ? MonitorSmartphone : Server} />
                <h3 id={`about-aud-${a.id}`} className="text-base font-bold">{a.title}</h3>
              </div>
              <p className="mt-3 text-sm text-ink-soft">{a.who}</p>
              <p className="mt-3 text-xs font-bold uppercase tracking-wider text-ink-faint">Bạn cần</p>
              <ul className="mt-1.5 space-y-1.5 text-sm">
                {a.needs.map((n) => (
                  <li key={n} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden /><span className="text-ink-soft">{n}</span></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Cách hoạt động ---------- */
function Timeline({ title, icon, steps, index }: { title: string; icon: LucideIcon; steps: Step[]; index: number }) {
  return (
    <section className={cn(card, "enter")} style={stagger(index)} aria-label={title}>
      <div className="flex items-center gap-3"><Badge icon={icon} /><h2 className="text-lg font-bold">{title}</h2></div>
      <ol className="mt-5">
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-3.5 pb-5 last:pb-0">
            {i < steps.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-line" aria-hidden />}
            <span className="num relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal text-sm font-bold text-white" aria-hidden>{i + 1}</span>
            <div className="min-w-0">
              <p className="font-semibold">{s.title}</p>
              <p className="mt-0.5 text-sm text-ink-soft">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function HowTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Timeline title="Khi bạn thuê máy" icon={MonitorSmartphone} steps={RENTER_STEPS} index={0} />
      <Timeline title="Khi bạn cho thuê máy" icon={Server} steps={HOST_STEPS} index={1} />
    </div>
  );
}

/* ---------- Thanh toán ---------- */
const PAYMENT_ICON: Record<PaymentIcon, LucideIcon> = { clock: Clock, lock: Lock, undo: RotateCcw, flag: Flag, percent: Percent, scale: Scale, download: ArrowDownToLine, pause: Pause };

function FlowNode({ icon: Icon, title, sub, className }: { icon: LucideIcon; title: string; sub: string; className?: string }) {
  return (
    <div className={cn("flex min-w-[150px] flex-1 items-center gap-3 rounded-lg border border-line bg-subtle px-3.5 py-3", className)}>
      <Badge icon={Icon} className="h-9 w-9" />
      <div className="min-w-0"><p className="text-sm font-bold">{title}</p><p className="text-xs text-ink-soft">{sub}</p></div>
    </div>
  );
}

function MoneyFlow() {
  return (
    <section className={cn(card, "enter")} style={stagger(0)} aria-label="Dòng tiền của một phiên thuê" data-testid="money-flow">
      <h2 className="text-lg font-bold">Dòng tiền của một phiên</h2>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <FlowNode icon={Wallet} title="Ví của bạn" sub="Trả giá gói bằng PCP" />
        <ArrowRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
        <FlowNode icon={Lock} title="Hợp đồng giữ tiền" sub="Giữ tới khi phiên kết thúc" />
        <ArrowRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
        <div className="flex min-w-[170px] flex-1 flex-col gap-2">
          <FlowNode icon={Server} title="Chủ máy · 90%" sub="Rút về ví khi muốn" />
          <FlowNode icon={Percent} title="Phí nền tảng · 10%" sub="Trừ khi tất toán" />
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-faint">Hủy trước khi kích hoạt thì toàn bộ PCP quay về ví của người thuê, không mất phí.</p>
    </section>
  );
}

export function PaymentTab() {
  return (
    <div className="space-y-4">
      <MoneyFlow />
      <div className="grid gap-4 md:grid-cols-2">
        {PAYMENT_RULES.map((r, i) => (
          <section key={r.title} className={cn(card, "enter", r.icon === "scale" && "md:col-span-2")} style={stagger(i + 1)} aria-label={r.title}>
            <div className="flex items-center gap-3"><Badge icon={PAYMENT_ICON[r.icon]} /><h3 className="text-base font-bold">{r.title}</h3></div>
            <p className="mt-3 text-sm text-ink-soft">{r.text}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ---------- Điều khoản ---------- */
export function TermsTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge icon={FileText} />
        <div>
          <h2 className="text-lg font-bold">Điều khoản sử dụng bản thử nghiệm</h2>
          <p className="text-xs text-ink-faint">Cập nhật lần cuối {ABOUT_UPDATED}. Bằng việc tạo tài khoản và dùng app, bạn đồng ý với các điều khoản dưới đây.</p>
        </div>
      </div>
      <ol className="space-y-4">
        {TERMS.map((g, i) => (
          <li key={g.title} className={cn(card, "enter")} style={stagger(i)}>
            <h3 className="flex items-center gap-2.5 text-base font-bold">
              <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white" aria-hidden>{i + 1}</span>
              {g.title}
            </h3>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink-soft marker:text-line-strong">
              {g.items.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- Mạng & hợp đồng (chỉ live) ---------- */
function ContractLine({ label, address, chainId }: { label: string; address: string; chainId: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
      <span className="font-semibold">{label}</span>
      <span className="flex items-center gap-2">
        <code className="num break-all text-xs text-ink-soft">{address}</code>
        {chainId === FUJI && (
          <a href={`${SNOWTRACE}${address}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded text-xs font-semibold text-teal-ink hover:underline">
            Xem trên Snowtrace <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </span>
    </div>
  );
}

export function ContractsTab() {
  const base = apiBase();
  const info = useAsync(async () => (base ? fetchChainInfo(base) : null), [base]);
  const net = networkLabel(envFacts());
  const c = info.status === "ready" ? info.data : null;
  return (
    <div className="space-y-4">
      {net && <Banner tone="info" title={net.chip}>{net.note}</Banner>}
      {c ? (
        <section className={cn(card, "enter")} aria-label="Hợp đồng">
          <h2 className="text-lg font-bold">Hợp đồng</h2>
          <p className="mt-1 text-sm text-ink-soft">Mã nguồn và giao dịch của hai hợp đồng dưới đây đều công khai trên chuỗi khối.</p>
          <div className="mt-3 divide-y divide-line">
            {c.pcp && <ContractLine label="PC Point (PCP)" address={c.pcp} chainId={c.chainId} />}
            <ContractLine label="RentalEscrow (giữ tiền)" address={c.escrow} chainId={c.chainId} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-ink-soft">Chưa đọc được địa chỉ hợp đồng. Hãy kiểm tra kết nối máy chủ.</p>
      )}
    </div>
  );
}

/* ---------- Màn ---------- */
type TabId = "overview" | "how" | "payment" | "terms" | "contracts";

export function About() {
  const live = isLive();
  const [tab, setTab] = useState<TabId>("overview");
  const items: { value: TabId; label: ReactNode }[] = [
    { value: "overview", label: "Tổng quan" },
    { value: "how", label: "Cách hoạt động" },
    { value: "payment", label: "Thanh toán" },
    { value: "terms", label: "Điều khoản" },
    ...(live ? [{ value: "contracts" as const, label: "Mạng & hợp đồng" }] : []),
  ];
  return (
    <div>
      <PageHeader title="Giới thiệu" subtitle="Cloud PC Companion: thuê và cho thuê máy tính từ xa, thanh toán bằng PCP qua hợp đồng giữ tiền." />
      {!live && <Banner tone="info" title="Dữ liệu mẫu" className="mb-4">Mọi máy, tài khoản và giao dịch trong bản xem trước đều là dữ liệu mẫu; chưa có kết nối thật nào.</Banner>}
      <Tabs value={tab} onValueChange={setTab} items={items}>
        <TabPanel value="overview" className="animate-fade-in pt-5"><OverviewTab /></TabPanel>
        <TabPanel value="how" className="animate-fade-in pt-5"><HowTab /></TabPanel>
        <TabPanel value="payment" className="animate-fade-in pt-5"><PaymentTab /></TabPanel>
        <TabPanel value="terms" className="animate-fade-in pt-5"><TermsTab /></TabPanel>
        {live && <TabPanel value="contracts" className="animate-fade-in pt-5"><ContractsTab /></TabPanel>}
      </Tabs>
    </div>
  );
}

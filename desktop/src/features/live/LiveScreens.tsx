/**
 * Màn hình chỉ có ở chế độ live (dữ liệu thật trên Supabase dev). Mọi thứ chưa nối được nói rõ là chưa nối;
 * không dựng số dư, phiên, thanh toán hay trạng thái online giả.
 */
import { ArrowDownToLine, CircleSlash, Coins, Fuel, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getDevWallet, getLiveApi, getServerApi, serverApiConfigured } from "@/api";
import { linkWallet, type Eip1193 } from "@/api/wallet";
import { formatUnits, splitFeeUnits, type DeclaredSpecs, type HostMachine, type HostMachineStatus, type LiveBooking } from "@/api/live";
import { navigate } from "@/app/router";
import { ACCESS_STATE_LABEL, BOOKING_STATE_LABEL } from "@/domain/adminData";
import { bookingPhase, formatRemaining } from "@/domain/bookingPhase";
import { sessionSteps, type StepView } from "@/domain/sessionSteps";
import { cn, stagger } from "@/lib/utils";
import { HostSessions } from "./HostSetup";
import { defaultScanDeps, rescanSpecs, scanAndPublish } from "./machineScan";
import { specsSummary } from "@/domain/machineSpecs";
import { useAppStore } from "@/state/store";
import { useAsync } from "@/state/useAsync";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Field, Input, Select, Switch } from "@/ui/controls";
import { Async, Banner, EmptyState } from "@/ui/feedback";
import { KeyValue, PageHeader, Section, StatTile } from "@/ui/page";
import { Amount } from "./Amount";

const TZ = "Asia/Ho_Chi_Minh";
const fmt = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: TZ, hour12: false, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const parseHm = (s: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const WEEKDAYS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"];
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit" });
/** Khung nhận thuê: "Thứ Hai 23/11, 19:00–23:00" (ngày theo giờ Việt Nam; `day` là ngày địa phương dạng YYYY-MM-DD). */
export function windowLabel(w: { day: string; startsAt: string; endsAt: string }): string {
  const [y, m, d] = w.day.split("-").map(Number);
  const wd = WEEKDAYS[(new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay() + 6) % 7]!;
  return `${wd} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}, ${timeOf(w.startsAt)}–${timeOf(w.endsAt)}`;
}
const chainName = (id: number) => (id === 43113 ? "Avalanche Fuji" : id === 43114 ? "Avalanche" : `Mạng ${id}`);

/* ------------------------------------------------------------------ Ví */
export function LiveWallet() {
  const state = useAsync(async () => {
    const api = getLiveApi();
    const [w, cfg] = await Promise.all([api.wallet.linked(), api.catalog.contractConfig()]);
    return { w, chainId: cfg.chainId };
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const dev = getDevWallet();
  const provider: Eip1193 | undefined = dev?.provider ?? (typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: Eip1193 }).ethereum);
  const blocked = !serverApiConfigured() ? "Ứng dụng chưa kết nối máy chủ. Vào Cài đặt → Kết nối máy chủ để nhập địa chỉ." : !provider ? "Chưa tìm thấy ví. Hãy cài một ví trình duyệt (ví dụ Core hoặc MetaMask) rồi thử lại." : "";
  const link = async (chainId: number) => {
    setBusy(true);
    setErr("");
    setDone("");
    try {
      const r = await linkWallet(provider!, getServerApi(), chainId);
      setDone(`Đã xác minh và liên kết ví ${r.address}.`);
      state.retry();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Ví" subtitle="Liên kết ví để thuê máy và nhận lại tiền hoàn. Chỉ cần một chữ ký: không giao dịch, không tốn phí." />
      <Async state={state}>
        {({ w, chainId }) => (
          <>
            {dev && (
              <Banner tone="info" className="mb-3" title="Ví trong ứng dụng">
                {dev.kind === "dev" ? <>Địa chỉ <span className="num break-all">{dev.address}</span>. Ví này chỉ dùng được trên mạng thử nghiệm cục bộ.</> : <>Địa chỉ <span className="num break-all">{dev.address}</span>. Ví được tạo và lưu trong ứng dụng trên máy này: xóa dữ liệu ứng dụng sẽ mất ví. Chỉ dùng cho mạng thử nghiệm, đừng chuyển tài sản có giá trị vào địa chỉ này.</>}
              </Banner>
            )}
            <Section title="Ví đã liên kết">
              {w ? (
                <KeyValue items={[{ k: "Địa chỉ", v: <span className="num break-all">{w.address}</span> }, { k: "Mạng", v: chainName(w.chainId) }, { k: "Xác minh lúc", v: fmt(w.verifiedAt) }]} />
              ) : (
                <p className="text-sm text-ink-soft">Bạn chưa liên kết ví. Hãy liên kết ví trước khi thuê máy.</p>
              )}
              {w && <Banner tone="info" className="mt-3" title="Đổi ví">Chỉ đổi được ví khi không còn phiên thuê nào đang diễn ra.</Banner>}
              {err && <Banner tone="danger" className="mt-3" title="Chưa liên kết được">{err}</Banner>}
              {done && <Banner tone="ok" className="mt-3" title="Thành công">{done}</Banner>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={() => void link(chainId)} disabled={busy || !!blocked}>{busy ? "Đang chờ ví…" : w ? "Liên kết ví khác" : "Liên kết ví"}</Button>
                {blocked && <span className="text-xs text-ink-faint">{blocked}</span>}
              </div>
            </Section>
            <Section title="Số dư PCP" className="mt-4">
              {dev && serverApiConfigured() ? <DevBalance /> : <p className="text-sm text-ink-soft">Chưa đọc được số dư. Hãy liên kết ví hoặc kiểm tra kết nối máy chủ.</p>}
            </Section>
          </>
        )}
      </Async>
    </div>
  );
}

/** Số dư của ví hiện tại, đọc trực tiếp từ chuỗi (không phải số trong cơ sở dữ liệu). Ví thử trên chuỗi công khai có nút xin PCP + gas từ vòi của máy chủ. */
function DevBalance() {
  const dev = getDevWallet()!;
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const state = useAsync(async () => {
    const ci = await getServerApi().chainInfo();
    if (!ci.pcp || !/^0x[0-9a-fA-F]{40}$/.test(ci.pcp)) throw new Error("Chưa đọc được số dư PCP. Hãy thử lại sau.");
    const [pcp, gas, credit] = await Promise.all([dev.balance(ci.pcp as `0x${string}`), dev.gasBalance(), dev.credit(ci.escrow as `0x${string}`)]);
    return { pcp, gas, credit, escrow: ci.escrow as `0x${string}`, faucet: ci.faucet === true };
  }, [tick]);
  /** Tiền hoàn (hủy trước khi kích hoạt, hết hạn…) được ghi CÓ trong ví giữ tiền, không tự về ví: phải rút (escrow.withdrawPCP). */
  const withdraw = async (escrow: `0x${string}`) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const tx = await dev.withdraw(escrow);
      setMsg(`Đã rút về ví (giao dịch ${tx.slice(0, 10)}…).`);
      setTick((n) => n + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const claim = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await getServerApi().faucet();
      setMsg(r.pcp.minted ? "Đã nhận 1000 PCP." : r.pcp.claimed ? "Ví này đã nhận PCP trước đó (mỗi ví nhận một lần)." : "Chưa nhận được PCP.");
      if (r.gas.sent) setMsg((m) => m + " Đã nhận một ít AVAX để trả phí giao dịch.");
      else if (r.gas.reason) setMsg((m) => m + " " + r.gas.reason);
      setTick((n) => n + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Async state={state} skeleton={<p className="text-sm text-ink-faint">Đang tải số dư…</p>}>
      {({ pcp, gas, credit, escrow, faucet }) => (
        <div data-testid="dev-balance" data-kind={dev.kind}>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile index={0} icon={Coins} label="Số dư PCP" value={<Amount units={pcp} suffix="PCP" />} />
            {dev.kind === "testnet" && <StatTile index={1} icon={Fuel} label="AVAX (phí giao dịch)" value={<Amount units={gas} suffix="AVAX" />} />}
            {credit !== "0" && <StatTile index={2} tone="warn" icon={ArrowDownToLine} label="PCP đang chờ rút" value={<Amount units={credit} suffix="PCP" />} hint="Tiền hoàn từ các phiên đã hủy" />}
          </div>
          {credit !== "0" && (
            <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="pending-credit">
              <Button size="sm" variant="primary" onClick={() => void withdraw(escrow)} disabled={busy}>{busy ? "Đang rút…" : "Rút về ví"}</Button>
              <span className="text-xs text-ink-faint">Rút số PCP đang chờ về ví của bạn.</span>
            </div>
          )}
          <p className="mt-1 text-xs text-ink-faint">
            {dev.kind === "dev"
              ? "Số dư đọc trực tiếp từ mạng thử nghiệm cục bộ. Ví mới bắt đầu với 0 PCP và tự nhận PCP ở lần thanh toán đầu tiên."
              : "Số dư đọc trực tiếp từ Avalanche Fuji. PCP và AVAX trên mạng thử nghiệm không có giá trị quy đổi. Mỗi ví nhận 1000 PCP một lần, kèm một ít AVAX để trả phí giao dịch."}
          </p>
          {dev.kind === "testnet" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => void claim()} disabled={busy || !faucet}>{busy ? "Đang nhận…" : "Nhận PCP và AVAX"}</Button>
              {!faucet && <span className="text-xs text-ink-faint">Hiện chưa phát PCP miễn phí. Hãy liên hệ người vận hành để được cấp.</span>}
              <Button size="sm" variant="ghost" onClick={() => setTick((n) => n + 1)}>Làm mới số dư</Button>
            </div>
          )}
          {msg && <Banner tone="ok" className="mt-2" title="Đã xử lý">{msg}</Banner>}
          {err && <Banner tone="danger" className="mt-2" title="Chưa nhận được">{err}</Banner>}
        </div>
      )}
    </Async>
  );
}

/** Tính năng chưa có trong bản này: trang trung tính, không nêu lý do kỹ thuật và không hiện dữ liệu mẫu. */
export function NotWired({ what }: { what: string; why?: string }) {
  return (
    <div>
      <PageHeader title={what} />
      <EmptyState icon={CircleSlash} title="Tính năng đang được hoàn thiện" action={<Button onClick={() => navigate("/rent/discover")}>Về danh mục máy</Button>}>
        Tính năng này sẽ sớm có mặt. Bạn vẫn có thể thuê hoặc cho thuê máy như bình thường.
      </EmptyState>
    </div>
  );
}

/* ------------------------------------------------------------------ Thuê: giữ máy */
const reserveKeys = new Map<string, string>();
const keyFor = (machineId: string) => {
  let k = reserveKeys.get(machineId);
  if (!k) reserveKeys.set(machineId, (k = "rsv-" + crypto.randomUUID()));
  return k;
};

export function LiveCheckout({ id }: { id: string }) {
  const state = useAsync(async () => {
    const api = getLiveApi();
    const [m, cfg] = await Promise.all([api.catalog.get(id), api.catalog.contractConfig()]);
    return m ? { ...m, cfg } : null;
  }, [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState<LiveBooking | null>(null);
  const key = useRef(keyFor(id));

  const reserve = async () => {
    setBusy(true);
    setError("");
    try {
      // Cùng khóa khi thử lại → máy chủ replay kết quả cũ, không tạo booking thứ hai.
      setBooking(await getLiveApi().bookings.reserve(id, key.current, "none"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Async state={state} isEmpty={(m) => m === null} empty={<EmptyState title="Không tìm thấy máy" action={<Button onClick={() => navigate("/rent/discover")}>Về danh sách</Button>} />}>
      {(d) => {
        if (!d) return null;
        const { fee, host } = splitFeeUnits(d.priceUnits, d.cfg.feeBps);
        return (
          <div>
            <PageHeader title="Giữ máy" subtitle={d.machine.name} crumbs={[{ label: "Khám phá", to: "/rent/discover" }, { label: d.machine.name, to: `/rent/machine/${id}` }, { label: "Giữ máy" }]} />
            {booking ? (
              <Section title="Đã giữ máy">
                <Banner tone="ok" title="Máy đã được giữ cho bạn">
                  Mã phiên <span className="num font-semibold">{booking.id.slice(0, 8)}</span>. Hãy thanh toán trước <strong>{fmt(booking.fundBy)}</strong>, nếu không máy sẽ được nhả cho người khác.
                </Banner>
                <KeyValue className="mt-4" items={[
                  { k: "Gói", v: `${booking.durationSeconds / 60} phút` },
                  { k: "Giá gói", v: `${formatUnits(booking.priceUnits)} PCP` },
                  { k: "Hạn thanh toán", v: fmt(booking.fundBy) },
                  { k: "Hạn kích hoạt", v: fmt(booking.activateBy) },
                  { k: "Trạng thái", v: `${BOOKING_STATE_LABEL[booking.state] ?? booking.state} · ${ACCESS_STATE_LABEL[booking.accessState] ?? booking.accessState}` },
                ]} />
                {getDevWallet() && serverApiConfigured() ? (
                  <Banner tone="info" className="mt-4" title="Bước tiếp theo: thanh toán">
                    Mở Phiên & đặt chỗ của tôi rồi bấm Trả tiền. Sau khi thanh toán, máy được chuẩn bị và bạn mở được màn hình.
                  </Banner>
                ) : (
                  <Banner tone="warn" className="mt-4" title="Cần ví để thanh toán">
                    Hãy liên kết ví ở mục Ví để thanh toán. Máy sẽ được nhả nếu quá hạn thanh toán.
                  </Banner>
                )}
                <div className="mt-4 flex gap-2">
                  <Button variant="primary" onClick={() => navigate("/rent/history")}>Tới Phiên & đặt chỗ của tôi</Button>
                  <Button variant="secondary" onClick={() => navigate("/rent/discover")}>Về danh mục</Button>
                </div>
              </Section>
            ) : (
              <Section title="Xác nhận giữ máy">
                <KeyValue items={[
                  { k: "Thời lượng gói", v: `${d.cfg.packageSeconds / 60} phút` },
                  { k: "Giá gói", v: `${formatUnits(d.priceUnits)} PCP` },
                  { k: `Phí nền tảng ${d.cfg.feeBps / 100}% (đã gồm trong giá)`, v: `${formatUnits(fee)} PCP` },
                  { k: "Host nhận", v: `${formatUnits(host)} PCP` },
                  { k: "Hạn thanh toán sau khi giữ", v: `${d.cfg.quoteTtlSeconds / 60} phút` },
                ]} />
                <Banner tone="info" className="mt-4" title="Quy tắc thanh toán">
                  Hủy trước khi máy được kích hoạt: hoàn đủ, tiền hoàn nằm trong hợp đồng và bạn rút về ví ở mục Ví. Thời gian thuê tính từ lúc máy được kích hoạt. Kết thúc sớm sau khi kích hoạt vẫn trả cả gói.
                </Banner>
                {error && <Banner tone="danger" className="mt-4" title="Không giữ được máy">{error}</Banner>}
                <div className="mt-4 flex gap-2">
                  <Button variant="primary" size="lg" onClick={reserve} disabled={busy}>{busy ? "Đang giữ máy…" : "Giữ máy"}</Button>
                  <Button variant="secondary" size="lg" onClick={() => navigate(`/rent/machine/${id}`)}>Quay lại</Button>
                </div>
                <p className="mt-2 text-xs text-ink-faint">Bạn cần liên kết ví trước, và không thuê được máy của chính mình.</p>
              </Section>
            )}
          </div>
        );
      }}
    </Async>
  );
}

const BOOKING_TONE: Record<string, "info" | "ok" | "warn" | "neutral"> = { reserved: "info", funded: "info", active: "ok", settled: "ok", refunded: "neutral", cancelled: "neutral", expired: "neutral", disputed: "warn", resolved: "neutral" };

/** Viewer thử nghiệm: nạp đường dẫn xem MỘT lần từ gateway của host trong khung nhúng (không mở trình duyệt ngoài). */
function LiveViewer({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="mt-3 w-full rounded-lg border border-line bg-black/5 p-2">
      <div className="mb-2 flex items-center justify-between text-xs text-ink-faint">
        <span>Màn hình máy thuê</span>
        <Button size="sm" variant="ghost" onClick={onClose}>Đóng</Button>
      </div>
      <iframe title="Màn hình máy thuê" src={url} className="h-[480px] w-full rounded border-0 bg-black" sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock" allow="fullscreen; clipboard-read; clipboard-write; keyboard-map; autoplay" />
    </div>
  );
}

/** Kích mỗi giây khi đồng hồ gói đang chạy (chỉ để hiển thị; mốc kết thúc luôn lấy từ endAt trên chuỗi). */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function BookingActions({ b, onChanged }: { b: LiveBooking; onChanged: () => void }) {
  const [viewer, setViewer] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [signErr, setSignErr] = useState("");
  const dev = getDevWallet();
  // Phiên không còn Active/granted (kết thúc, hết giờ, thu hồi): đóng viewer ngay, đừng để lại khung "unauthorized".
  const live = b.state === "active" && b.accessState === "granted";
  useEffect(() => {
    if (!live && viewer) {
      setViewer(null);
      setNote("Phiên đã kết thúc hoặc quyền xem đã bị thu hồi; màn hình đã đóng.");
    }
  }, [live, viewer]);
  /** Hành động ký bằng ví giả lập; xong thì tải lại danh sách (trạng thái do worker/chuỗi quyết định, không tự suy ra). */
  const sign = async (what: string, run: (w: NonNullable<typeof dev>) => Promise<{ txHash: string; status: string }>) => {
    setBusy(true);
    setSignErr("");
    setNote("");
    try {
      const r = await run(dev!);
      setNote(`${what} thành công (giao dịch ${r.txHash.slice(0, 10)}…). Trạng thái phiên sẽ tự cập nhật trong giây lát.`);
      onChanged();
    } catch (e) {
      setSignErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const needChain = async () => {
    if (!b.chainBookingId) throw new Error("Phiên này chưa sẵn sàng để thực hiện giao dịch. Hãy thử lại sau ít phút.");
    const ci = await getServerApi().chainInfo();
    return { bookingId: b.id, chainBookingId: b.chainBookingId as `0x${string}`, chain: { chainId: ci.chainId, escrow: ci.escrow as `0x${string}` } };
  };
  const clock = b.state === "active";
  const now = useNow(clock);
  const ph = bookingPhase(b, now);
  const open = async () => {
    setBusy(true);
    setErr("");
    try {
      setViewer((await getServerApi().connect(b.id)).viewerUrl);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="w-full space-y-2">
      <SessionProgress steps={sessionSteps(b)} />
      <div className="rounded-md bg-subtle p-2.5 text-sm">
        <p className="font-semibold" data-testid="phase-label">{ph.label}</p>
        <p className="text-ink-soft">{ph.detail}</p>
        <p className="mt-1 text-xs"><b>Nếu dừng ở bước này:</b> {ph.policyText}</p>
        {ph.clockRunning && ph.remainingSec !== null && <p className="num mt-1 text-xs font-semibold">Còn lại: {formatRemaining(ph.remainingSec)}</p>}
      </div>
      {b.state === "active" && b.accessState === "granted" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={open} disabled={busy || !serverApiConfigured()}>{busy ? "Đang mở…" : "Mở màn hình"}</Button>
          {!serverApiConfigured() && <span className="text-xs text-ink-faint">Ứng dụng chưa kết nối máy chủ (Cài đặt → Kết nối máy chủ).</span>}
        </div>
      )}
      {b.state === "reserved" && (dev && serverApiConfigured()
        ? <SignAction label="Trả tiền" busy={busy} onClick={() => void sign("Thanh toán", (w) => w.pay(b.id, getServerApi()))} />
        : <DisabledAction label="Trả tiền" reason="Hãy liên kết ví ở mục Ví trước." />)}
      {b.state === "funded" && (dev && serverApiConfigured()
        ? <SignAction label="Hủy trước khi kích hoạt (hoàn đủ)" busy={busy} onClick={() => void sign("Hủy", async (w) => w.cancelBeforeStart(await needChain(), getServerApi()))} />
        : <DisabledAction label="Hủy trước khi kích hoạt (hoàn đủ)" reason="Hãy liên kết ví ở mục Ví trước." />)}
      {b.state === "active" && (dev && serverApiConfigured()
        ? <SignAction label="Kết thúc sớm (vẫn trả cả gói)" busy={busy} onClick={() => void sign("Kết thúc", async (w) => w.accept(await needChain(), getServerApi()))} />
        : <DisabledAction label="Kết thúc sớm (vẫn trả cả gói)" reason="Hãy liên kết ví ở mục Ví trước." />)}
      {note && <Banner tone="ok" title="Đã gửi">{note}</Banner>}
      {signErr && <Banner tone="danger" title="Chưa thực hiện được">{signErr}</Banner>}
      {err && <Banner tone="danger" title="Không mở được màn hình">{err}</Banner>}
      {viewer && <LiveViewer url={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

const STEP_CLS: Record<StepView["state"], string> = {
  done: "border-ok bg-ok text-white",
  current: "border-teal bg-teal-tint text-teal-dark",
  failed: "border-danger bg-danger-bg text-danger",
  todo: "border-line-strong bg-surface text-ink-faint",
  skipped: "border-line bg-subtle text-ink-faint line-through",
};
const STEP_SR: Record<StepView["state"], string> = { done: "đã xong", current: "đang diễn ra", failed: "gặp sự cố", todo: "chưa tới", skipped: "không diễn ra" };
/** Bảy bước của một phiên; chỉ phản ánh trạng thái do máy chủ/chuỗi xác nhận. */
function SessionProgress({ steps }: { steps: StepView[] }) {
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Tiến trình phiên" data-testid="session-steps">
      {steps.map((s, i) => (
        <li key={s.key} data-step={s.key} data-state={s.state} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold", STEP_CLS[s.state])} aria-current={s.state === "current" ? "step" : undefined}>
          <span aria-hidden>{s.state === "done" ? "✓" : s.state === "failed" ? "!" : i + 1}</span>
          {s.label}
          <span className="sr-only"> — {STEP_SR[s.state]}</span>
        </li>
      ))}
    </ol>
  );
}

function SignAction({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" onClick={onClick} disabled={busy}>{busy ? "Đang xử lý giao dịch…" : label}</Button>
    </div>
  );
}

function DisabledAction({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled>{label}</Button>
      <span className="text-xs text-ink-faint">{reason}</span>
    </div>
  );
}

const TERMINAL_MONEY = new Set(["settled", "refunded", "resolved", "cancelled", "expired"]);
const isDone = (b: LiveBooking) => TERMINAL_MONEY.has(b.state) && (b.accessState === "not_granted" || b.accessState === "reset_verified");

export function LiveBookings() {
  const [tick, setTick] = useState(0);
  const state = useAsync(async () => {
    const api = getLiveApi();
    const [bookings, machines] = await Promise.all([api.bookings.listMine(), api.catalog.list()]);
    const names = new Map(machines.map((m) => [m.id, m.name]));
    return bookings.map((b) => ({ b, name: names.get(b.machineId) ?? `Máy ${b.machineId.slice(0, 8)}` }));
  }, [tick]);
  // Trạng thái do worker/chuỗi quyết định: tự tải lại mỗi 4 giây khi còn booking chưa kết thúc (không nháy danh sách).
  const pending = state.status === "ready" && state.data.some(({ b }) => !isDone(b));
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, [pending]);
  return (
    <div>
      <PageHeader title="Đặt chỗ của tôi" subtitle="Theo dõi các phiên thuê của bạn. Trạng thái tự cập nhật, không cần tải lại." />
      <Async state={state} isEmpty={(l) => l.length === 0} empty={<EmptyState title="Bạn chưa giữ máy nào" action={<Button onClick={() => navigate("/rent/discover")}>Khám phá máy</Button>} />}>
        {(list) => (
          <ul className="space-y-2">
            {list.map(({ b, name }, i) => (
              <li key={b.id} style={stagger(i)} className="enter flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3.5 shadow-[0_1px_2px_rgb(11_31_58/0.05)]">
                <div>
                  <p className="font-semibold">{name}</p>
                  <p className="text-xs text-ink-faint">Giữ lúc {fmt(b.createdAt)} · hạn thanh toán {fmt(b.fundBy)} · <Amount units={b.priceUnits} suffix="PCP" inline /></p>
                </div>
                <Badge tone={BOOKING_TONE[b.state] ?? "neutral"} icon={false}>{BOOKING_STATE_LABEL[b.state] ?? b.state}</Badge>
                <BookingActions b={b} onChanged={() => setTick((n) => n + 1)} />
              </li>
            ))}
          </ul>
        )}
      </Async>
    </div>
  );
}

/* ------------------------------------------------------------------ Host */
const STATUS_LABEL: Record<HostMachineStatus, { text: string; tone: "neutral" | "warn" | "ok" | "info" }> = {
  draft: { text: "Nháp", tone: "neutral" },
  review: { text: "Đang chờ", tone: "warn" },
  approved: { text: "Đã đăng", tone: "ok" },
  suspended: { text: "Bị tạm khóa", tone: "warn" },
};

export function HostLive() {
  const approval = useAppStore((s) => s.account.hostApproval);
  const refreshAccount = useAppStore((s) => s.refreshAccount);
  const [err, setErr] = useState("");
  const apply = async () => {
    setErr("");
    try {
      await getLiveApi().host.apply();
      await refreshAccount();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div>
      <PageHeader title="Máy của tôi" subtitle="Quản lý máy, giờ nhận thuê và trạng thái. Muốn máy nhận khách, vào Thiết lập & chạy máy rồi bấm Bắt đầu nhận thuê." actions={<Button variant="primary" onClick={() => navigate("/host/setup")}>Thiết lập & chạy máy</Button>} />
      <Section title="Tài khoản host">
        {approval === "none" && (
          <div className="space-y-3">
            <Banner tone="info" title="Bạn chưa là host">Đăng ký làm host để cho thuê máy của bạn.</Banner>
            {err && <Banner tone="danger" title="Không đăng ký được">{err}</Banner>}
            <Button variant="primary" onClick={apply}>Đăng ký làm host</Button>
          </div>
        )}
        {approval === "pending" && <Banner tone="warn" title="Hồ sơ host đang được xem xét">Bạn sẽ đăng được máy ngay khi hồ sơ được xác nhận.</Banner>}
        {approval === "rejected" && <Banner tone="danger" title="Tài khoản host đang bị tạm khóa">Bạn chưa thể đăng máy hay nhận thuê. Hãy liên hệ người vận hành để biết thêm.</Banner>}
        {approval === "approved" && <Banner tone="ok" title="Bạn đã là host">Thêm máy rồi bấm Quét & đăng máy để người thuê nhìn thấy máy của bạn.</Banner>}
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => void refreshAccount()}>Làm mới</Button>
      </Section>
      {approval === "approved" && <HostMachines />}
      {approval === "approved" && <HostSessions />}
    </div>
  );
}

export function HostSessionsPage() {
  return (
    <div>
      <PageHeader title="Phiên trên máy của tôi" subtitle="Các phiên trên máy của bạn, tự cập nhật. Bạn không thấy màn hình hay dữ liệu của người thuê." />
      <HostSessions />
    </div>
  );
}

function HostMachines() {
  const state = useAsync(() => getLiveApi().host.listMachines());
  return (
    <>
      <Section title="Máy của tôi">
        <Async state={state} isEmpty={(l) => l.length === 0} empty={<p className="text-sm text-ink-soft">Chưa có máy. Tạo máy ở bên dưới.</p>}>
          {(list) => <div className="space-y-4">{list.map((m, i) => <div key={m.id} className="enter" style={stagger(i)}><MachinePanel m={m} onChange={state.retry} /></div>)}</div>}
        </Async>
      </Section>
      <NewMachine onCreated={state.retry} />
    </>
  );
}

export function NewMachine({ onCreated }: { onCreated: () => void }) {
  const [f, setF] = useState({ name: "", summary: "", price: "20", location: "Hồ Chí Minh" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      // Chủ máy chỉ đặt tên và mô tả. CPU, số nhân, RAM, GPU, ổ đĩa và danh mục do app đọc từ máy khi bấm "Quét & đăng máy"
      // (ghi danh thiết bị cần máy đã tồn tại, nên chưa thể đọc ở bước tạo).
      const specs: DeclaredSpecs = { location: f.location.trim(), summary: f.summary.trim(), workspace: false };
      await getLiveApi().host.createMachine({ name: f.name, pricePcp: f.price.trim(), specs });
      setF({ ...f, name: "", summary: "" });
      onCreated();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Section title="Thêm máy mới">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
        <p className="col-span-2 text-sm text-ink-soft" data-testid="new-machine-intro">Bạn chỉ cần đặt tên và viết vài dòng giới thiệu. Cấu hình máy (CPU, RAM, GPU, ổ đĩa) do app tự đọc từ máy của bạn khi bạn bấm <b>Quét & đăng máy</b>.</p>
        <Field label="Tên máy" htmlFor="nm-name" className="col-span-2"><Input id="nm-name" maxLength={120} value={f.name} onChange={set("name")} /></Field>
        <Field label="Mô tả ngắn" htmlFor="nm-sum" className="col-span-2" hint={`${f.summary.length}/200 ký tự. Hiện cho người thuê khi xem máy.`}>
          <Input id="nm-sum" maxLength={200} value={f.summary} onChange={set("summary")} />
        </Field>
        <Field label="Giá mỗi gói (PCP)" htmlFor="nm-price" hint="Số dương, tối đa 18 chữ số thập phân."><Input id="nm-price" inputMode="decimal" value={f.price} onChange={set("price")} /></Field>
        <Field label="Vị trí" htmlFor="nm-loc" hint="Hiện ở danh sách máy."><Input id="nm-loc" value={f.location} onChange={set("location")} /></Field>
        {err && <div className="col-span-2"><Banner tone="danger" title="Không tạo được máy">{err}</Banner></div>}
        <div className="col-span-2"><Button type="submit" variant="primary" disabled={busy || f.name.trim().length === 0}><Plus className="h-4 w-4" aria-hidden />{busy ? "Đang tạo…" : "Tạo máy"}</Button></div>
      </form>
    </Section>
  );
}

export function MachinePanel({ m, onChange }: { m: HostMachine; onChange: () => void }) {
  const api = getLiveApi().host;
  const detail = useAsync(async () => {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
    const end = new Date(Date.now() + 6 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: TZ });
    const [commitments, rules, accepting, health, windows] = await Promise.all([api.listCommitments(m.id), api.listRules(m.id), api.getAccepting(m.id), api.health(m.id), api.windows(m.id, today, end)]);
    return { commitments, rules, accepting, health, windows };
  }, [m.id]);
  const [err, setErr] = useState("");
  const [hours, setHours] = useState("4");
  const [rule, setRule] = useState({ weekday: "0", from: "19:00", to: "23:00" });
  const run = async (fn: () => Promise<void>, after: "detail" | "list" = "detail") => {
    setErr("");
    try {
      await fn();
      if (after === "list") onChange();
      detail.retry();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const [publishing, setPublishing] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [note, setNote] = useState("");
  /**
   * Quét guest (app Windows) rồi đăng. Không còn admin duyệt: quét đạt là máy hiện công khai ngay.
   * Cùng lần quét đó đọc thông số máy (CPU, RAM, GPU, ổ đĩa) và ghi vào máy trước khi đăng; chủ máy không tự gõ.
   */
  const publish = async () => {
    setPublishing(true);
    setNote("");
    try {
      await run(async () => {
        const status = await scanAndPublish(api, m, defaultScanDeps());
        if (status !== "approved") {
          onChange();
          throw new Error("Máy đã được gửi nhưng chưa hiển thị cho người thuê. Hãy thử lại sau hoặc liên hệ người vận hành.");
        }
      }, "list");
    } finally {
      setPublishing(false);
    }
  };
  /** Đọc lại cấu hình từ máy (phần cứng có thể đã đổi). Không bắt máy phải đủ điều kiện đăng, vì máy đã đăng rồi. */
  const rescan = async () => {
    setRescanning(true);
    setNote("");
    try {
      await run(async () => {
        await rescanSpecs(api, m, defaultScanDeps());
        setNote("Đã cập nhật cấu hình từ máy.");
      }, "list");
    } finally {
      setRescanning(false);
    }
  };
  const st = STATUS_LABEL[m.status];
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold">{m.name}</p>
          <p className="text-xs text-ink-faint">{formatUnits(m.priceUnits)} PCP / gói</p>
          {m.specs.summary && <p className="mt-1 text-sm text-ink-soft">{m.specs.summary}</p>}
          <p className="mt-1 text-xs text-ink-soft" data-testid="machine-specs">{specsSummary(m.specs) ?? "Cấu hình sẽ được đọc từ máy của bạn khi bạn bấm Quét & đăng máy."}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={st.tone}>{st.text}</Badge>
          {m.status === "draft" && <Button size="sm" variant="primary" loading={publishing} onClick={() => void publish()}>Quét & đăng máy</Button>}
          {m.status === "approved" && <Button size="sm" variant="ghost" loading={rescanning} onClick={() => void rescan()}>Đọc lại cấu hình</Button>}
        </div>
      </div>
      {note && <Banner tone="ok" className="mt-3" title="Đã cập nhật">{note}</Banner>}
      {err && <Banner tone="danger" className="mt-3" title="Thao tác không thành công">{err}</Banner>}
      <Async state={detail} skeleton={<p className="mt-3 text-sm text-ink-faint">Đang tải…</p>}>
        {(d) => (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 text-sm font-semibold">Cam kết cho thuê (tối thiểu 4 giờ)</p>
              {d.commitments.length === 0 ? <p className="text-sm text-ink-soft">Chưa có. Cần ít nhất một cam kết để người thuê giữ được máy.</p> : (
                <ul className="space-y-1 text-sm">{d.commitments.map((c) => <li key={c.id}>{fmt(c.startsAt)} → {fmt(c.endsAt)}</li>)}</ul>
              )}
              <div className="mt-2 flex items-end gap-2">
                <Field label="Thời lượng cam kết" htmlFor={`h-${m.id}`}>
                  <Select id={`h-${m.id}`} value={hours} onChange={(e) => setHours(e.target.value)}>
                    {[4, 8, 12, 24].map((h) => <option key={h} value={h}>{h} giờ</option>)}
                  </Select>
                </Field>
                <Button size="sm" variant="secondary" onClick={() => void run(() => api.addCommitment(m.id, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000 + Number(hours) * 3_600_000)))}>Thêm cam kết</Button>
              </div>
              <p className="mt-1 text-xs text-ink-faint">Không rút được cam kết khi đang có phiên thuê dựa trên cam kết đó.</p>
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold">Lịch nhận thuê hằng tuần (GMT+7)</p>
              {d.rules.length === 0 ? <p className="text-sm text-ink-soft">Chưa có khung giờ.</p> : (
                <ul className="space-y-1 text-sm">
                  {d.rules.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span>{WEEKDAYS[r.weekday]} {hm(r.startMinute)}–{hm(r.endMinute)}</span>
                      <Button size="sm" variant="ghost" aria-label="Xóa khung giờ" onClick={() => void run(() => api.removeRule(r.id))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field label="Ngày" htmlFor={`d-${m.id}`}>
                  <Select id={`d-${m.id}`} value={rule.weekday} onChange={(e) => setRule({ ...rule, weekday: e.target.value })}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</Select>
                </Field>
                <Field label="Từ" htmlFor={`f-${m.id}`}><Input id={`f-${m.id}`} className="w-24" value={rule.from} onChange={(e) => setRule({ ...rule, from: e.target.value })} /></Field>
                <Field label="Đến" htmlFor={`t-${m.id}`}><Input id={`t-${m.id}`} className="w-24" value={rule.to} onChange={(e) => setRule({ ...rule, to: e.target.value })} /></Field>
                <Button size="sm" variant="secondary" onClick={() => void run(async () => {
                  const a = parseHm(rule.from), b = parseHm(rule.to);
                  if (a === null || b === null) throw new Error("Giờ phải có dạng HH:mm.");
                  await api.addRule(m.id, Number(rule.weekday), a, b);
                })}>Thêm</Button>
              </div>
              <p className="mt-1 text-xs text-ink-faint">Mỗi khung dài tối thiểu 30 phút, tính theo mốc 15 phút, không qua nửa đêm và không chồng nhau. Lịch chỉ là giờ bạn sẵn sàng; máy chỉ nhận khách khi bạn đã bắt đầu nhận thuê.</p>
            </div>
            <div className="md:col-span-2">
              <KeyValue items={[
                { k: "Nhận phiên mới", v: <Switch id={`acc-${m.id}`} label="Nhận phiên mới" checked={d.accepting} onCheckedChange={(v) => void run(() => api.setAccepting(m.id, v))} /> },
                { k: "Kết nối của máy", v: d.health === "unknown" ? "Chưa kết nối (hãy ghi danh và bắt đầu nhận thuê)" : d.health === "ok" ? "Đang kết nối" : d.health === "suspect" ? "Kết nối chậm" : "Mất kết nối" },
                { k: "Khung nhận thuê 7 ngày tới", v: d.windows.length ? d.windows.map(windowLabel).join("; ") : "Chưa có" },
              ]} />
            </div>
          </div>
        )}
      </Async>
    </div>
  );
}

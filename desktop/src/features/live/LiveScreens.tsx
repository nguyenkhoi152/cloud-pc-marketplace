/**
 * Màn hình chỉ có ở chế độ live (dữ liệu thật trên Supabase dev). Mọi thứ chưa nối được nói rõ là chưa nối;
 * không dựng số dư, phiên, thanh toán hay trạng thái online giả.
 */
import { CircleSlash, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getDevWallet, getLiveApi, getServerApi, serverApiConfigured } from "@/api";
import { linkWallet, type Eip1193 } from "@/api/wallet";
import { formatUnits, splitFeeUnits, type DeclaredSpecs, type HostMachine, type HostMachineStatus, type LiveBooking } from "@/api/live";
import { navigate } from "@/app/router";
import { bookingPhase, formatRemaining } from "@/domain/bookingPhase";
import { sessionSteps, type StepView } from "@/domain/sessionSteps";
import { cn } from "@/lib/utils";
import { HostSessions } from "./HostSetup";
import type { Category } from "@/domain/types";
import { useAppStore } from "@/state/store";
import { useAsync } from "@/state/useAsync";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox, Field, Input, Select, Switch } from "@/ui/controls";
import { Async, Banner, EmptyState } from "@/ui/feedback";
import { KeyValue, PageHeader, Section } from "@/ui/page";

const TZ = "Asia/Ho_Chi_Minh";
const fmt = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: TZ, hour12: false });
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const parseHm = (s: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const WEEKDAYS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"];

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
  const blocked = !serverApiConfigured() ? "Chưa có địa chỉ máy chủ API: vào Cài đặt → Kết nối máy chủ để nhập mã kết nối." : !provider ? "Không thấy ví trình duyệt (EIP-1193). Trong app native chưa có connector ví; cần ví trong trình duyệt hoặc connector hỗ trợ." : "";
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
      <PageHeader title="Ví" subtitle="Liên kết ví bằng chữ ký xác minh. Không giao dịch, không tốn phí, không cấp quyền chi tiêu. PCP là điểm thử, không phải tiền thật." />
      <Async state={state}>
        {({ w, chainId }) => (
          <>
            {dev && (
              <Banner tone="warn" className="mb-3" title={dev.label}>
                {dev.kind === "dev" ? <>Ví thử này do trình duyệt tự sinh (địa chỉ <span className="num break-all">{dev.address}</span>) và chỉ ký được trên chuỗi cục bộ {dev.rpcUrl}. Không dùng cho tiền thật.</> : <>Ví thử này do app tự sinh (địa chỉ <span className="num break-all">{dev.address}</span>), ký trên mạng thử Avalanche Fuji qua {dev.rpcUrl}. Không có giá trị tiền: đừng chuyển tiền thật vào địa chỉ này. Khoá chỉ nằm trong app trên máy này; xoá dữ liệu app là mất ví.</>}
              </Banner>
            )}
            <Section title="Ví đã liên kết">
              {w ? (
                <KeyValue items={[{ k: "Địa chỉ", v: <span className="num break-all">{w.address}</span> }, { k: "Mạng", v: `Chain ${w.chainId}` }, { k: "Xác minh lúc", v: fmt(w.verifiedAt) }]} />
              ) : (
                <p className="text-sm text-ink-soft">Chưa liên kết ví. Cần ví đã xác minh trước khi giữ máy.</p>
              )}
              {w && <Banner tone="info" className="mt-3" title="Đổi ví">Không đổi được ví khi còn booking chưa kết thúc (máy chủ chặn).</Banner>}
              {err && <Banner tone="danger" className="mt-3" title="Chưa liên kết được">{err}</Banner>}
              {done && <Banner tone="ok" className="mt-3" title="Thành công">{done}</Banner>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={() => void link(chainId)} disabled={busy || !!blocked}>{busy ? "Đang chờ ví…" : w ? "Liên kết ví khác" : "Liên kết ví"}</Button>
                {blocked && <span className="text-xs text-ink-faint">{blocked}</span>}
              </div>
            </Section>
            <Section title="Số dư PCP" className="mt-4">
              {dev && serverApiConfigured() ? <DevBalance /> : <p className="text-sm text-ink-soft">Chưa kết nối: bản này chưa có ví thật nên không đọc được số dư trên chuỗi. Không hiển thị số mẫu.</p>}
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
    if (!ci.pcp || !/^0x[0-9a-fA-F]{40}$/.test(ci.pcp)) throw new Error("Máy chủ chưa cho biết địa chỉ PCP.");
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
      setMsg(r.pcp.minted ? "Đã nhận 1000 PCP thử." : r.pcp.claimed ? "Ví này đã nhận PCP thử trước đó (vòi chỉ cấp một lần cho mỗi ví)." : "Chưa nhận được PCP.");
      if (r.gas.sent) setMsg((m) => m + " Đã nhận một ít AVAX testnet để trả gas.");
      else if (r.gas.reason) setMsg((m) => m + " " + r.gas.reason);
      setTick((n) => n + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Async state={state} skeleton={<p className="text-sm text-ink-faint">Đang đọc chuỗi…</p>}>
      {({ pcp, gas, credit, escrow, faucet }) => (
        <div data-testid="dev-balance" data-kind={dev.kind}>
          <p className="text-lg font-bold"><span className="num">{formatUnits(pcp)}</span> <span className="text-sm font-medium text-ink-faint">PCP thử</span></p>
          {credit !== "0" && (
            <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="pending-credit">
              <p className="text-sm"><span className="num font-semibold">{formatUnits(credit)}</span> <span className="text-ink-faint">PCP thử đang chờ rút (tiền hoàn được ghi có ở ví giữ tiền)</span></p>
              <Button size="sm" variant="primary" onClick={() => void withdraw(escrow)} disabled={busy}>{busy ? "Đang rút…" : "Rút về ví"}</Button>
            </div>
          )}
          {dev.kind === "testnet" && <p className="text-sm"><span className="num font-semibold">{formatUnits(gas)}</span> <span className="text-ink-faint">AVAX testnet (để trả gas)</span></p>}
          <p className="mt-1 text-xs text-ink-faint">
            {dev.kind === "dev"
              ? `Đọc từ chuỗi Hardhat cục bộ (${dev.rpcUrl}). Ví mới có số dư 0; lần trả tiền đầu tiên, ví giả lập tự nhận 1000 PCP thử từ vòi cấp của chuỗi mô phỏng. Không có giá trị tiền.`
              : `Đọc từ mạng thử Fuji (${dev.rpcUrl}). PCP và AVAX testnet không có giá trị tiền. Vòi của máy chủ cấp 1000 PCP một lần mỗi ví và nhỏ giọt một ít AVAX gas.`}
          </p>
          {dev.kind === "testnet" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => void claim()} disabled={busy || !faucet}>{busy ? "Đang xin…" : "Nhận PCP thử và gas"}</Button>
              {!faucet && <span className="text-xs text-ink-faint">Máy chủ này không bật vòi; tự nạp AVAX testnet vào địa chỉ ví và nhờ người tổ chức cấp PCP.</span>}
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

export function NotWired({ what, why }: { what: string; why: string }) {
  return (
    <div>
      <PageHeader title={what} />
      <EmptyState icon={CircleSlash} title="Chưa nối dữ liệu thật" action={<Button onClick={() => navigate("/rent/discover")}>Về danh mục máy</Button>}>
        {why} Màn hình này không hiển thị dữ liệu mẫu ở chế độ live.
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
              <Section title="Đã giữ máy (bước đầu của thuê thật)">
                <Banner tone="ok" title="Máy đã được giữ nguyên tử trên máy chủ">
                  Booking <span className="num font-semibold">{booking.id.slice(0, 8)}</span> ở trạng thái <strong>{booking.state}</strong>. Cần thanh toán trước <strong>{fmt(booking.fundBy)}</strong> (giờ GMT+7), nếu không máy sẽ được nhả sau khi máy chủ đối soát.
                </Banner>
                <KeyValue className="mt-4" items={[
                  { k: "Gói", v: `${booking.durationSeconds / 60} phút` },
                  { k: "Giá gói", v: `${formatUnits(booking.priceUnits)} PCP thử` },
                  { k: "Hạn thanh toán", v: fmt(booking.fundBy) },
                  { k: "Hạn kích hoạt", v: fmt(booking.activateBy) },
                  { k: "Trạng thái tiền / truy cập", v: `${booking.state} / ${booking.accessState}` },
                ]} />
                {getDevWallet() && serverApiConfigured() ? (
                  <Banner tone="info" className="mt-4" title={`Bước tiếp theo: trả tiền bằng ${getDevWallet()!.kind === "dev" ? "ví giả lập" : "ví thử"}`}>
                    Mở Phiên & đặt chỗ của tôi rồi bấm Trả tiền. {getDevWallet()!.kind === "dev" ? "Thanh toán chạy trên chuỗi Hardhat cục bộ bằng PCP thử (không có giá trị tiền)." : "Thanh toán chạy trên mạng thử Avalanche Fuji bằng PCP thử (không có giá trị tiền); app tự xin PCP và gas từ vòi nếu ví còn thiếu."} Sau đó máy được chuẩn bị, kích hoạt và bạn mở được màn hình.
                  </Banner>
                ) : (
                  <Banner tone="warn" className="mt-4" title="Chưa kết nối thanh toán">
                    Bản này chưa có ví để ký giao dịch nên phiên dừng ở bước giữ máy. Máy sẽ được nhả khi hết hạn thanh toán.
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
                  { k: "Gói duy nhất (theo cấu hình hợp đồng)", v: `${d.cfg.packageSeconds / 60} phút` },
                  { k: "Giá gói", v: `${formatUnits(d.priceUnits)} PCP thử` },
                  { k: `Phí nền tảng ${d.cfg.feeBps / 100}% (đã gồm trong giá)`, v: `${formatUnits(fee)} PCP thử` },
                  { k: "Host nhận", v: `${formatUnits(host)} PCP thử` },
                  { k: "Hạn thanh toán sau khi giữ", v: `${d.cfg.quoteTtlSeconds / 60} phút` },
                ]} />
                <Banner tone="info" className="mt-4" title="Quy tắc tiền (theo hợp đồng hiện hành)">
                  Hủy trước khi kích hoạt hoàn đủ: tiền hoàn được ghi có ở ví giữ tiền và bạn rút về ví ở màn Ví. Đồng hồ gói chạy từ lúc kích hoạt (sau khi thanh toán và máy sẵn sàng), không phải lúc bạn mở viewer; kết thúc sớm sau kích hoạt vẫn trả cả gói. PCP là điểm thử, không phải tiền thật.
                </Banner>
                {error && <Banner tone="danger" className="mt-4" title="Không giữ được máy">{error}</Banner>}
                <div className="mt-4 flex gap-2">
                  <Button variant="primary" size="lg" onClick={reserve} disabled={busy}>{busy ? "Đang giữ máy…" : "Giữ máy"}</Button>
                  <Button variant="secondary" size="lg" onClick={() => navigate(`/rent/machine/${id}`)}>Quay lại</Button>
                </div>
                <p className="mt-2 text-xs text-ink-faint">Máy chủ kiểm tra: bạn không phải chủ máy, máy đã được duyệt, chưa có booking đang giữ, cam kết của host đủ phủ thời gian, và ví đã xác minh.</p>
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
        <span>Viewer thử nghiệm qua gateway của host (đã kiểm với Selkies thật trong VM không GPU; chưa kiểm hiệu năng/GPU, âm thanh, toàn màn hình).</span>
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
      setNote(`${what}: giao dịch ${r.txHash.slice(0, 12)}… đã được đối soát (${r.status}). Trạng thái cập nhật khi worker xử lý.`);
      onChanged();
    } catch (e) {
      setSignErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const needChain = async () => {
    if (!b.chainBookingId) throw new Error("Chưa có mã booking trên chuỗi.");
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
        {ph.clockRunning && ph.remainingSec !== null && <p className="num mt-1 text-xs font-semibold">Còn lại theo thời điểm kết thúc trên chuỗi: {formatRemaining(ph.remainingSec)}</p>}
      </div>
      {b.state === "active" && b.accessState === "granted" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={open} disabled={busy || !serverApiConfigured()}>{busy ? "Đang mở…" : "Mở màn hình"}</Button>
          {!serverApiConfigured() && <span className="text-xs text-ink-faint">Cần đặt VITE_API_BASE_URL để gọi máy chủ API.</span>}
        </div>
      )}
      {b.state === "reserved" && (dev && serverApiConfigured()
        ? <SignAction label={`Trả tiền PCP thử (${dev.kind === "dev" ? "ví giả lập" : "ví thử"})`} busy={busy} onClick={() => void sign("Trả tiền", (w) => w.pay(b.id, getServerApi()))} />
        : <DisabledAction label="Thanh toán PCP thử" reason="cần ví đã liên kết để ký giao dịch (xem mục Ví); chưa hỗ trợ ký trong app" />)}
      {b.state === "funded" && (dev && serverApiConfigured()
        ? <SignAction label="Hủy trước khi kích hoạt (hoàn đủ)" busy={busy} onClick={() => void sign("Hủy", async (w) => w.cancelBeforeStart(await needChain(), getServerApi()))} />
        : <DisabledAction label="Hủy trước khi kích hoạt (hoàn đủ)" reason="cần ví ký giao dịch cancelBeforeStart; chưa hỗ trợ ký trong app" />)}
      {b.state === "active" && (dev && serverApiConfigured()
        ? <SignAction label="Kết thúc sớm (vẫn trả cả gói)" busy={busy} onClick={() => void sign("Kết thúc", async (w) => w.accept(await needChain(), getServerApi()))} />
        : <DisabledAction label="Kết thúc sớm (vẫn trả cả gói)" reason="cần ví ký giao dịch accept; chưa hỗ trợ ký trong app" />)}
      {dev && b.state !== "settled" && b.state !== "expired" && b.state !== "cancelled" && b.state !== "refunded" && <p className="text-xs text-ink-faint">{dev.label}.</p>}
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
      <Button size="sm" variant="primary" onClick={onClick} disabled={busy}>{busy ? "Đang ký và gửi giao dịch…" : label}</Button>
    </div>
  );
}

function DisabledAction({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled>{label}</Button>
      <span className="text-xs text-ink-faint">Chưa dùng được: {reason}.</span>
    </div>
  );
}

const TERMINAL_MONEY = new Set(["settled", "refunded", "resolved", "cancelled", "expired"]);
const isDone = (b: LiveBooking) => TERMINAL_MONEY.has(b.state) && (b.accessState === "not_granted" || b.accessState === "reset_verified");

export function LiveBookings() {
  const [tick, setTick] = useState(0);
  const dev = getDevWallet();
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
      <PageHeader title="Đặt chỗ của tôi" subtitle={dev ? `Mỗi phiên đi qua bảy bước bên dưới và tự cập nhật. Thanh toán bằng ${dev.kind === "dev" ? "ví giả lập trên chuỗi Hardhat cục bộ" : "ví thử trên mạng thử Fuji"} (không phải tiền thật).` : "Dữ liệu thật từ máy chủ. Thanh toán, phiên và kết thúc cần ví ký giao dịch; bản này chưa kết nối ví."} />
      <Async state={state} isEmpty={(l) => l.length === 0} empty={<EmptyState title="Bạn chưa giữ máy nào" action={<Button onClick={() => navigate("/rent/discover")}>Khám phá máy</Button>} />}>
        {(list) => (
          <ul className="space-y-2">
            {list.map(({ b, name }) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3">
                <div>
                  <p className="font-semibold">{name}</p>
                  <p className="text-xs text-ink-faint">Giữ lúc {fmt(b.createdAt)} · hạn thanh toán {fmt(b.fundBy)} · {formatUnits(b.priceUnits)} PCP thử</p>
                </div>
                <Badge tone={BOOKING_TONE[b.state] ?? "neutral"} className="num" icon={false}>{b.state} / {b.accessState}</Badge>
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
const CATS: { v: Category; label: string }[] = [{ v: "game", label: "Game" }, { v: "graphics", label: "Đồ họa" }, { v: "dev", label: "Lập trình" }];
const STATUS_LABEL: Record<HostMachineStatus, { text: string; tone: "neutral" | "warn" | "ok" | "info" }> = {
  draft: { text: "Nháp", tone: "neutral" },
  review: { text: "Chờ duyệt", tone: "warn" },
  approved: { text: "Đã duyệt", tone: "ok" },
  suspended: { text: "Bị đình chỉ", tone: "warn" },
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
      <PageHeader title="Máy của tôi" subtitle="Đăng máy, cam kết và lịch nhận thuê. Để máy thật sự nhận khách, vào Thiết lập & chạy máy và bấm Bắt đầu nhận thuê." actions={<Button variant="primary" onClick={() => navigate("/host/setup")}>Thiết lập & chạy máy</Button>} />
      <Section title="Trạng thái host">
        {approval === "none" && (
          <div className="space-y-3">
            <Banner tone="info" title="Bạn chưa là host">Gửi đăng ký để admin duyệt. Chọn chế độ Cho thuê máy không tự cấp quyền host.</Banner>
            {err && <Banner tone="danger" title="Không gửi được">{err}</Banner>}
            <Button variant="primary" onClick={apply}>Đăng ký làm host</Button>
          </div>
        )}
        {approval === "pending" && <Banner tone="warn" title="Đang chờ admin duyệt">Bạn chưa thể đăng máy cho tới khi được duyệt (kiểm tra ở máy chủ).</Banner>}
        {approval === "rejected" && <Banner tone="danger" title="Tài khoản host bị đình chỉ">Liên hệ admin.</Banner>}
        {approval === "approved" && <Banner tone="ok" title="Host đã được duyệt">Bạn có thể đăng máy và gửi duyệt.</Banner>}
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => void refreshAccount()}>Tải lại trạng thái</Button>
      </Section>
      {approval === "approved" && <HostMachines />}
      {approval === "approved" && <HostSessions />}
    </div>
  );
}

export function HostSessionsPage() {
  return (
    <div>
      <PageHeader title="Phiên trên máy của tôi" subtitle="Tự cập nhật mỗi vài giây. Bạn chỉ thấy trạng thái phiên, không thấy màn hình hay dữ liệu của khách." />
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
          {(list) => <div className="space-y-4">{list.map((m) => <MachinePanel key={m.id} m={m} onChange={state.retry} />)}</div>}
        </Async>
      </Section>
      <NewMachine onCreated={state.retry} />
    </>
  );
}

function NewMachine({ onCreated }: { onCreated: () => void }) {
  const [f, setF] = useState({ name: "", price: "20", cpu: "", cores: "8", ramGb: "16", gpu: "", vramGb: "0", storageGb: "256", networkMbps: "100", location: "Hồ Chí Minh", summary: "", cats: ["dev"] as Category[] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const n = (v: string) => Math.max(0, Number(v) || 0);
      const specs: DeclaredSpecs = { cpu: f.cpu, cores: n(f.cores), ramGb: n(f.ramGb), gpu: f.gpu || null, vramGb: n(f.vramGb), storageGb: n(f.storageGb), networkMbps: n(f.networkMbps), location: f.location, categories: f.cats, summary: f.summary, workspace: false };
      await getLiveApi().host.createMachine({ name: f.name, pricePcp: f.price.trim(), specs });
      setF({ ...f, name: "" });
      onCreated();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Section title="Đăng máy mới (nháp)">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
        <Field label="Tên máy" htmlFor="nm-name" className="col-span-2"><Input id="nm-name" value={f.name} onChange={set("name")} /></Field>
        <Field label="Giá mỗi gói (PCP thử)" htmlFor="nm-price" hint="Số dương, tối đa 18 chữ số thập phân."><Input id="nm-price" inputMode="decimal" value={f.price} onChange={set("price")} /></Field>
        <Field label="Vị trí" htmlFor="nm-loc"><Input id="nm-loc" value={f.location} onChange={set("location")} /></Field>
        <Field label="CPU (tự khai)" htmlFor="nm-cpu"><Input id="nm-cpu" value={f.cpu} onChange={set("cpu")} /></Field>
        <Field label="Số nhân" htmlFor="nm-cores"><Input id="nm-cores" inputMode="numeric" value={f.cores} onChange={set("cores")} /></Field>
        <Field label="RAM (GB)" htmlFor="nm-ram"><Input id="nm-ram" inputMode="numeric" value={f.ramGb} onChange={set("ramGb")} /></Field>
        <Field label="GPU (để trống nếu không có)" htmlFor="nm-gpu"><Input id="nm-gpu" value={f.gpu} onChange={set("gpu")} /></Field>
        <Field label="VRAM (GB)" htmlFor="nm-vram"><Input id="nm-vram" inputMode="numeric" value={f.vramGb} onChange={set("vramGb")} /></Field>
        <Field label="Ổ đĩa (GB)" htmlFor="nm-sto"><Input id="nm-sto" inputMode="numeric" value={f.storageGb} onChange={set("storageGb")} /></Field>
        <Field label="Mạng (Mbps)" htmlFor="nm-net"><Input id="nm-net" inputMode="numeric" value={f.networkMbps} onChange={set("networkMbps")} /></Field>
        <div className="col-span-2 flex flex-wrap gap-4">
          {CATS.map((c) => (
            <Checkbox key={c.v} label={c.label} checked={f.cats.includes(c.v)} onChange={(on) => setF({ ...f, cats: on ? [...f.cats, c.v] : f.cats.filter((x) => x !== c.v) })} />
          ))}
        </div>
        <Field label="Mô tả ngắn" htmlFor="nm-sum" className="col-span-2"><Input id="nm-sum" value={f.summary} onChange={set("summary")} /></Field>
        {err && <div className="col-span-2"><Banner tone="danger" title="Không tạo được máy">{err}</Banner></div>}
        <p className="col-span-2 text-xs text-ink-faint">Cấu hình là do bạn tự khai; hệ thống chưa tự đo và chưa kiểm chứng.</p>
        <div className="col-span-2"><Button type="submit" variant="primary" disabled={busy || f.name.trim().length === 0}><Plus className="h-4 w-4" aria-hidden />{busy ? "Đang tạo…" : "Tạo máy nháp"}</Button></div>
      </form>
    </Section>
  );
}

function MachinePanel({ m, onChange }: { m: HostMachine; onChange: () => void }) {
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
  const st = STATUS_LABEL[m.status];
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold">{m.name}</p>
          <p className="text-xs text-ink-faint">{formatUnits(m.priceUnits)} PCP thử / gói · mã {m.machineKey}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={st.tone}>{st.text}</Badge>
          {m.status === "draft" && <Button size="sm" variant="primary" onClick={() => void run(() => api.submitForReview(m.id), "list")}>Gửi duyệt</Button>}
        </div>
      </div>
      {err && <Banner tone="danger" className="mt-3" title="Thao tác không thành công">{err}</Banner>}
      <Async state={detail} skeleton={<p className="mt-3 text-sm text-ink-faint">Đang tải…</p>}>
        {(d) => (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 text-sm font-semibold">Cam kết (tối thiểu 4 giờ)</p>
              {d.commitments.length === 0 ? <p className="text-sm text-ink-soft">Chưa có. Không có cam kết thì không ai giữ được máy.</p> : (
                <ul className="space-y-1 text-sm">{d.commitments.map((c) => <li key={c.id}>{fmt(c.startsAt)} → {fmt(c.endsAt)}</li>)}</ul>
              )}
              <div className="mt-2 flex items-end gap-2">
                <Field label="Số giờ kể từ 1 giờ trước" htmlFor={`h-${m.id}`}>
                  <Select id={`h-${m.id}`} value={hours} onChange={(e) => setHours(e.target.value)}>
                    {[4, 8, 12, 24].map((h) => <option key={h} value={h}>{h} giờ</option>)}
                  </Select>
                </Field>
                <Button size="sm" variant="secondary" onClick={() => void run(() => api.addCommitment(m.id, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000 + Number(hours) * 3_600_000)))}>Thêm cam kết</Button>
              </div>
              <p className="mt-1 text-xs text-ink-faint">Cam kết không thể bị rút/xóa khi đang bảo đảm một booking còn hiệu lực (máy chủ chặn).</p>
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
              <p className="mt-1 text-xs text-ink-faint">Bội của 15 phút, tối thiểu 30 phút, không qua nửa đêm (tách khung), không chồng nhau. Lịch không tự bật nguồn máy.</p>
            </div>
            <div className="md:col-span-2">
              <KeyValue items={[
                { k: "Nhận phiên mới (host chọn)", v: <Switch id={`acc-${m.id}`} label="Nhận phiên mới" checked={d.accepting} onCheckedChange={(v) => void run(() => api.setAccepting(m.id, v))} /> },
                { k: "Heartbeat của thiết bị", v: d.health === "unknown" ? "Chưa có (máy chưa ghi danh hoặc agent chưa chạy)" : d.health === "ok" ? "Ổn (dưới 30 giây)" : d.health === "suspect" ? "Chậm (quá 30 giây)" : "Mất (quá 90 giây)" },
                { k: "Khung nhận thuê 7 ngày tới", v: d.windows.length ? d.windows.map((w) => `${w.day} ${fmt(w.startsAt).split(" ")[0]}–${fmt(w.endsAt).split(" ")[0]}`).join("; ") : "Chưa có" },
              ]} />
            </div>
          </div>
        )}
      </Async>
    </div>
  );
}

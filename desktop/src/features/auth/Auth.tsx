import { ArrowRight, CalendarClock, Compass, Eraser, Eye, EyeOff, KeyRound, Lock, LogIn, Mail, MailCheck, MonitorPlay, MonitorSmartphone, RotateCcw, Server, TerminalSquare, User, UserPlus, Wallet, type LucideIcon } from "lucide-react";
import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { passwordStrength } from "@/domain/passwordStrength";
import { Link, navigate } from "@/app/router";
import { activateWalletForAccount, getLiveApi } from "@/api";
import { IS_WEB, isLive } from "@/api/env";
import { DownloadButton } from "@/features/web/WebScreens";
import { useAppStore } from "@/state/store";
import { Banner } from "@/ui/feedback";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/controls";
import { ThemeToggle } from "@/ui/theme-toggle";
import { DemoBanner, DemoPanel, ToastRegion } from "@/layout/Chrome";
import { envFacts } from "@/api/envFacts";
import { networkLabel } from "@/domain/envLabels";

/**
 * Minh họa phẳng (không gradient, theo hệ token Sky): người thuê ⇄ hợp đồng giữ tiền ⇄ máy được thuê. Chỉ trang trí, nên `aria-hidden`.
 * Co theo chiều cao còn lại của panel (meet) để không bao giờ đẩy nội dung ra ngoài ở cửa sổ thấp.
 */
function AuthIllustration() {
  return (
    <svg viewBox="0 0 420 300" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden focusable="false" data-testid="auth-illustration">
      <defs>
        <pattern id="auth-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" fill="var(--illus-body)" /></pattern>
      </defs>
      <rect width="420" height="300" fill="url(#auth-dots)" />
      {/* Máy được thuê (host): cửa sổ desktop từ xa */}
      <rect x="215" y="28" width="185" height="128" rx="12" fill="#ffffff" />
      <path d="M215 40a12 12 0 0 1 12-12h161a12 12 0 0 1 12 12v14H215z" fill="var(--illus-light)" />
      <circle cx="232" cy="41" r="3.5" fill="var(--illus-mid)" /><circle cx="246" cy="41" r="3.5" fill="var(--illus-mid)" /><circle cx="260" cy="41" r="3.5" fill="var(--illus-accent)" />
      <rect x="229" y="68" width="70" height="8" rx="4" fill="var(--illus-light)" /><rect x="229" y="84" width="52" height="8" rx="4" fill="var(--illus-light)" />
      <rect x="229" y="100" width="62" height="8" rx="4" fill="var(--illus-light)" /><rect x="229" y="116" width="44" height="8" rx="4" fill="var(--illus-light)" />
      <rect x="310" y="66" width="76" height="60" rx="8" fill="var(--illus-accent)" /><path d="M336 84v24l22-12z" fill="var(--illus-accent-soft)" />
      <rect x="229" y="134" width="157" height="8" rx="4" fill="var(--illus-accent-soft)" />
      <path d="M352 112v22l6-5 4 9 5-2-4-9 8-1z" fill="var(--illus-ink)" stroke="#ffffff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M290 156h35l6 22h-47z" fill="var(--illus-light)" /><rect x="272" y="178" width="71" height="8" rx="4" fill="var(--illus-mid)" />
      {/* Người thuê: laptop */}
      <rect x="20" y="168" width="130" height="82" rx="8" fill="var(--illus-body)" stroke="var(--illus-light)" strokeWidth="2" />
      <rect x="30" y="178" width="110" height="62" rx="4" fill="var(--illus-ink)" />
      <rect x="40" y="188" width="60" height="8" rx="4" fill="var(--illus-light)" /><rect x="40" y="202" width="84" height="6" rx="3" fill="var(--illus-mute)" />
      <rect x="40" y="216" width="38" height="14" rx="7" fill="var(--illus-accent)" /><circle cx="122" cy="224" r="9" fill="var(--illus-light)" />
      <path d="M8 250h154l-10 12H18z" fill="var(--illus-light)" />
      {/* Đường nối và hợp đồng giữ tiền ở giữa */}
      <path d="M150 205C166 205 168 172 182 160" fill="none" stroke="var(--illus-light)" strokeWidth="2" strokeDasharray="4 6" strokeLinecap="round" />
      <path d="M200 138C206 122 206 114 215 108" fill="none" stroke="var(--illus-light)" strokeWidth="2" strokeDasharray="4 6" strokeLinecap="round" />
      <circle cx="162" cy="196" r="3" fill="var(--illus-accent-soft)" /><circle cx="173" cy="174" r="3" fill="var(--illus-accent-soft)" /><circle cx="207" cy="122" r="3" fill="var(--illus-accent-soft)" />
      <circle cx="190" cy="150" r="25" fill="var(--illus-accent)" stroke="var(--illus-ink)" strokeWidth="6" />
      <path d="M184 151v-4a6 6 0 0 1 12 0v4" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
      <rect x="181" y="151" width="18" height="14" rx="3" fill="#ffffff" /><circle cx="190" cy="158" r="2" fill="var(--illus-accent)" />
      <rect x="160" y="182" width="60" height="20" rx="10" fill="var(--illus-body)" stroke="var(--illus-light)" strokeWidth="1.5" />
      <text x="190" y="196" textAnchor="middle" fill="var(--illus-light)" fontSize="11" fontWeight="700">PCP</text>
    </svg>
  );
}

const BENEFITS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Wallet, title: "PCP nằm trong hợp đồng giữ tiền", text: "Tiền chỉ chuyển cho chủ máy khi phiên kết thúc." },
  { icon: RotateCcw, title: "Hủy trước khi kích hoạt, hoàn đủ", text: "Mỗi gói thuê kéo dài 15 phút." },
  { icon: MonitorPlay, title: "Màn hình máy thuê hiện ngay trong app", text: "Không cần mở thêm ứng dụng khác." },
];

/**
 * Khung chung của các màn đăng nhập. Panel trái (navy) mang phần hình ảnh; phần phải chỉ tập trung vào thẻ biểu mẫu (+ `extra` nếu có).
 * Panel trái không chứa phần tử bấm được (vòng focus xanh mặc định rất khó thấy trên nền navy). Không animation lặp (tôn trọng "Giảm chuyển động").
 */
function AuthLayout({ children, title, subtitle, extra, icon: Icon }: { children: ReactNode; title: string; subtitle?: string; extra?: ReactNode; icon: LucideIcon }) {
  return (
    <div className="flex h-full flex-col">
      <DemoBanner />
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(300px,2fr)_3fr]">
        <aside className="hidden min-h-0 flex-col gap-5 overflow-auto bg-panel p-8 text-white lg:flex lg:p-10" data-testid="auth-aside">
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal"><MonitorSmartphone className="h-5 w-5" aria-hidden /></span>
            <span className="font-bold leading-tight">Cloud PC Companion</span>
          </div>
          <div className="flex min-h-[120px] flex-1 items-center justify-center"><div className="h-full max-h-[300px] w-full max-w-[420px]"><AuthIllustration /></div></div>
          <div className="shrink-0">
            <h2 className="max-w-md text-2xl font-bold leading-snug">Một app cho cả người thuê và người cho thuê máy.</h2>
            <ul className="mt-4 max-w-md space-y-3">
              {BENEFITS.map((b) => (
                <li key={b.title} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-2 text-panel-ink"><b.icon className="h-4 w-4" aria-hidden /></span>
                  <span className="text-sm leading-snug"><span className="block font-semibold text-white">{b.title}</span><span className="block text-panel-ink">{b.text}</span></span>
                </li>
              ))}
            </ul>
          </div>
          <p className="shrink-0 text-xs text-panel-ink/80">{isLive() ? (networkLabel(envFacts())?.note ?? "") : "Bản xem trước giao diện. Không có tài khoản, thanh toán hay kết nối thật."}</p>
        </aside>
        <main className="relative min-h-0 overflow-hidden">
          <AuthBackdrop />
          {/* Bản xem trước: chừa chỗ phía trên cho bảng kịch bản demo (cố định ở góc phải) để không đè lên thẻ. */}
          <div className={cn("relative flex h-full min-h-0 overflow-auto p-4 sm:p-8", (!isLive() || IS_WEB) && "pt-14 sm:pt-12")}>
            <div className="m-auto w-full max-w-[460px] space-y-4">
              {/* Màn hẹp: panel trái bị ẩn nên có logo nhỏ ở đây. */}
              <div className="flex items-center gap-2.5 lg:hidden">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal text-white"><MonitorSmartphone className="h-5 w-5" aria-hidden /></span>
                <span className="font-bold leading-tight">Cloud PC Companion</span>
              </div>
              <div className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
                <div className="h-1.5 bg-teal" aria-hidden />
                <div className="p-6">
                  <div className="flex items-start gap-3.5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-tint text-teal-ink" aria-hidden><Icon className="h-6 w-6" /></span>
                    <div className="min-w-0">
                      <h1 className="text-2xl font-bold leading-tight">{title}</h1>
                      {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
                    </div>
                  </div>
                  <div className="mt-6">{children}</div>
                </div>
              </div>
              {extra}
            </div>
          </div>
        </main>
      </div>
      <div className={cn("fixed right-4 flex items-center gap-2", isLive() && !IS_WEB ? "top-3" : "top-10")}>
        <ThemeToggle />
        {!isLive() && !IS_WEB && <DemoPanel />}
      </div>
      <ToastRegion />
    </div>
  );
}

/** Nền nửa phải: hai hình tròn phẳng + hai lưới chấm. Chỉ trang trí (không gradient, không blur), không nhận chuột. */
function AuthBackdrop() {
  const dots = (pid: string, cls: string) => (
    <svg className={cn("absolute text-line-strong/70", cls)} width="132" height="132" viewBox="0 0 132 132" aria-hidden focusable="false">
      <defs><pattern id={pid} width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="currentColor" /></pattern></defs>
      <rect width="132" height="132" fill={`url(#${pid})`} />
    </svg>
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden data-testid="auth-backdrop">
      <div className="absolute -right-28 -top-28 h-80 w-80 rounded-full bg-sky/70" />
      <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-teal-tint/80" />
      <div className="absolute right-16 top-[58%] h-24 w-24 rounded-full border-[10px] border-sky/80" />
      {dots("auth-grid-a", "left-10 top-10")}
      {dots("auth-grid-b", "bottom-10 right-8 [@media(max-height:760px)]:hidden")}
    </div>
  );
}

/** Chip nhỏ cho nhãn nhu cầu / bước (chỉ để đọc). */
function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-sky/60 px-2.5 py-0.5 text-xs font-semibold text-ink-soft">{children}</span>;
}

/** Ô giới thiệu vai trò: chỉ để đọc (không hover, không mũi tên) nên không giống nút bấm. */
function RoleTile({ icon: Icon, title, text, chips }: { icon: LucideIcon; title: string; text: string; chips: string[] }) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgb(15_23_42/0.06)]">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-tint text-teal-ink"><Icon className="h-5 w-5" aria-hidden /></span>
      <p className="mt-3 font-bold">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{text}</p>
      <div className="mt-3 flex flex-wrap gap-1.5 [@media(max-height:780px)]:hidden">{chips.map((c) => <Chip key={c}>{c}</Chip>)}</div>
    </div>
  );
}

/** Ba điều người dùng cần biết (khác với panel trái); ẩn khi cửa sổ thấp để form luôn vừa màn hình. */
const FACTS: { icon: LucideIcon; text: string }[] = [
  { icon: TerminalSquare, text: "Desktop Linux riêng cho mỗi phiên" },
  { icon: Eraser, text: "Dữ liệu trong máy thuê bị xóa khi phiên kết thúc" },
  { icon: CalendarClock, text: "Chủ máy tự đặt lịch nhận thuê" },
];
function FactStrip() {
  return (
    <ul className="grid grid-cols-3 gap-2 [@media(max-height:780px)]:hidden" data-testid="auth-facts">
      {FACTS.map((f) => (
        <li key={f.text} className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-surface/80 px-2 py-3 text-center text-xs font-medium leading-snug text-ink-soft">
          <f.icon className="h-4 w-4 text-teal" aria-hidden />{f.text}
        </li>
      ))}
    </ul>
  );
}

/** Dòng chuyển giữa đăng nhập và đăng ký, nằm dưới thẻ (không nằm trong thẻ để không trùng liên kết). */
function AuthSwitch({ text, to, cta }: { text: string; to: string; cta: string }) {
  return <p className="text-center text-sm text-ink-soft">{text} <Link to={to} className="rounded font-semibold text-teal-ink hover:underline">{cta}</Link></p>;
}

/** Ô nhập có biểu tượng đầu dòng (và nút phụ ở cuối nếu có). Giữ nguyên `id`, `type`, `autoComplete` do nơi gọi truyền vào. */
function IconInput({ icon: Icon, trailing, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { icon: LucideIcon; trailing?: ReactNode }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      <Input className={cn("h-10 pl-9", trailing ? "pr-11" : "", className)} {...p} />
      {trailing && <div className="absolute right-1 top-1/2 -translate-y-1/2">{trailing}</div>}
    </div>
  );
}

/** Ô mật khẩu có nút hiện/ẩn. Nút nằm ngoài luồng gõ (type="button") nên không gửi form. */
function PasswordInput({ icon = Lock, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { icon?: LucideIcon }) {
  const [show, setShow] = useState(false);
  return (
    <IconInput
      {...p}
      icon={icon}
      type={show ? "text" : "password"}
      trailing={
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={show} className="flex h-8 w-8 items-center justify-center rounded text-ink-faint hover:text-ink">
          {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      }
    />
  );
}

/** Thanh độ mạnh mật khẩu (3 đoạn + nhãn). Chỉ là gợi ý; điều kiện bắt buộc vẫn là tối thiểu 8 ký tự. */
function StrengthMeter({ pw }: { pw: string }) {
  const s = passwordStrength(pw);
  if (!s.label) return null;
  const tone = s.level === 0 ? "bg-danger" : s.level === 1 ? "bg-warn-line" : "bg-ok";
  const text = s.level === 0 ? "text-danger" : s.level === 1 ? "text-warn" : "text-ok";
  return (
    <div className="flex items-center gap-2" data-testid="pw-strength">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3].map((i) => <span key={i} className={cn("h-1.5 flex-1 rounded-full", i <= Math.max(s.level, 1) ? tone : "bg-line")} />)}
      </div>
      <span className={cn("w-28 text-right text-xs font-semibold", text)}>{s.label}</span>
    </div>
  );
}

export function Welcome() {
  const signIn = useAppStore((s) => s.signIn);
  return (
    <AuthLayout
      icon={MonitorSmartphone}
      title="Chào mừng"
      subtitle="Thuê sức mạnh máy tính từ xa, hoặc cho thuê máy của bạn vào những giờ rảnh."
      extra={
        <div className="grid grid-cols-2 gap-3" data-testid="role-tiles">
          <RoleTile icon={MonitorSmartphone} title="Thuê máy" text="Chọn máy theo cấu hình và giá, giữ máy rồi thanh toán bằng PCP." chips={["Game", "Đồ họa", "Lập trình"]} />
          <RoleTile icon={Server} title="Cho thuê máy" text="Đăng máy của bạn, đặt giờ nhận thuê và nhận PCP khi có người thuê." chips={["Quét máy", "Đặt lịch", "Nhận PCP"]} />
        </div>
      }
    >
      {IS_WEB ? (
        // Bản web: không có đăng nhập/đăng ký (kể cả giả). Hai việc duy nhất: tải app, hoặc xem danh sách máy mẫu.
        <>
          <div className="space-y-3">
            <DownloadButton size="lg" className="w-full" />
            <Button variant="secondary" size="lg" className="w-full" onClick={() => navigate("/rent/discover")}>Xem danh sách máy <ArrowRight className="h-4 w-4" aria-hidden /></Button>
          </div>
          <Banner tone="info" className="mt-6" title="Bản web chỉ để xem">
            Thuê máy và cho thuê máy cần cài app Cloud PC Companion cho Windows. Danh sách máy trên web là dữ liệu mẫu.
          </Banner>
        </>
      ) : (
        <>
          <div className="space-y-3">
            <Button variant="primary" size="lg" className="w-full" onClick={() => navigate("/login")}>Đăng nhập</Button>
            <Button variant="secondary" size="lg" className="w-full" onClick={() => navigate("/register")}>Tạo tài khoản</Button>
            {!isLive() && <Button variant="ghost" className="w-full" onClick={() => { signIn(); navigate("/choose-mode"); }}>Vào nhanh với tài khoản demo <ArrowRight className="h-4 w-4" aria-hidden /></Button>}
          </div>
          {!isLive() && (
            <Banner tone="warn" className="mt-6" title="Dữ liệu mẫu">
              Đăng nhập và đăng ký chỉ minh họa luồng. Không dữ liệu nào được gửi đi hay lưu lại.
            </Banner>
          )}
        </>
      )}
    </AuthLayout>
  );
}

export function Login() {
  const signIn = useAppStore((s) => s.signIn);
  const applyLive = useAppStore((s) => s.applyLiveAccount);
  const live = isLive();
  const [email, setEmail] = useState(live ? "" : "minhanh@example.test");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<{ email?: string; pw?: string }>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const x: typeof err = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) x.email = "Nhập email đúng định dạng.";
    if (pw.length < 1) x.pw = live ? "Nhập mật khẩu." : "Nhập mật khẩu (bất kỳ — đây là mô phỏng).";
    setErr(x);
    if (Object.keys(x).length) return;
    if (!live) {
      signIn(undefined, email);
      navigate("/choose-mode");
      return;
    }
    setBusy(true);
    setFail("");
    try {
      const api = getLiveApi();
      await api.auth.signIn(email.trim(), pw);
      const acc = await api.account();
      await activateWalletForAccount(acc.userId); // ví của chính tài khoản này (mỗi tài khoản một ví trên PC)
      applyLive(acc);
      navigate("/choose-mode");
    } catch (ex) {
      setFail((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout
      icon={LogIn}
      title="Đăng nhập"
      subtitle={live ? "Đăng nhập để thuê hoặc cho thuê máy." : "Dùng email bất kỳ và mật khẩu bất kỳ để xem thử."}
      extra={<><AuthSwitch text="Chưa có tài khoản?" to="/register" cta="Tạo tài khoản" /><FactStrip /></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {fail && <Banner tone="danger" title="Không đăng nhập được">{fail}</Banner>}
        <Field label="Email" htmlFor="email" error={err.email}>
          <IconInput icon={Mail} id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!err.email} />
        </Field>
        <Field label="Mật khẩu" htmlFor="pw" error={err.pw}>
          <PasswordInput id="pw" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!err.pw} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</Button>
      </form>
      <div className="mt-4 text-center text-sm">
        <Link to="/recover" className="rounded font-semibold text-teal-ink hover:underline">Quên mật khẩu?</Link>
      </div>
    </AuthLayout>
  );
}

export function Register() {
  const signIn = useAppStore((s) => s.signIn);
  const applyLive = useAppStore((s) => s.applyLiveAccount);
  const live = isLive();
  const [f, setF] = useState({ name: "", email: "", pw: "", agree: false });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");
  const [needConfirm, setNeedConfirm] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (f.name.trim().length < 2) x.name = "Nhập tên hiển thị (ít nhất 2 ký tự).";
    if (!/^\S+@\S+\.\S+$/.test(f.email)) x.email = "Nhập email đúng định dạng.";
    if (f.pw.length < 8) x.pw = "Mật khẩu tối thiểu 8 ký tự.";
    if (!f.agree) x.agree = "Cần đồng ý để tiếp tục.";
    setErr(x);
    if (Object.keys(x).length) return;
    if (!live) {
      signIn(f.name, f.email);
      navigate("/choose-mode");
      return;
    }
    setBusy(true);
    setFail("");
    try {
      const api = getLiveApi();
      const r = await api.auth.signUp(f.email.trim(), f.pw, f.name.trim());
      if (!r.confirmed) return setNeedConfirm(true);
      const acc = await api.account();
      await activateWalletForAccount(acc.userId); // ví của chính tài khoản này (mỗi tài khoản một ví trên PC)
      applyLive(acc);
      navigate("/choose-mode");
    } catch (ex) {
      setFail((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (needConfirm)
    return (
      <AuthLayout icon={MailCheck} title="Kiểm tra email" subtitle="Chúng tôi đã gửi email xác nhận cho bạn.">
        <Banner tone="info" title="Đã tạo tài khoản">Mở email xác nhận rồi quay lại đăng nhập.</Banner>
        <Button variant="primary" className="mt-4 w-full" onClick={() => navigate("/login")}>Đến đăng nhập</Button>
      </AuthLayout>
    );
  return (
    <AuthLayout
      icon={UserPlus}
      title="Tạo tài khoản"
      subtitle="Một tài khoản dùng cho cả thuê máy và cho thuê máy."
      extra={<><AuthSwitch text="Đã có tài khoản?" to="/login" cta="Đăng nhập" /><FactStrip /></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {fail && <Banner tone="danger" title="Không tạo được tài khoản">{fail}</Banner>}
        <Field label="Tên hiển thị" htmlFor="name" error={err.name}>
          <IconInput icon={User} id="name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-invalid={!!err.name} />
        </Field>
        <Field label="Email" htmlFor="remail" error={err.email}>
          <IconInput icon={Mail} id="remail" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-invalid={!!err.email} />
        </Field>
        <Field label="Mật khẩu" htmlFor="rpw" error={err.pw} hint="Tối thiểu 8 ký tự.">
          <PasswordInput id="rpw" autoComplete="new-password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} aria-invalid={!!err.pw} />
          <StrengthMeter pw={f.pw} />
        </Field>
        <div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} className="mt-1 h-4 w-4 accent-teal" aria-invalid={!!err.agree} />
            <span>{live ? "Tôi hiểu PCP và AVAX trên mạng thử nghiệm không có giá trị quy đổi." :"Tôi hiểu đây là bản xem trước và đồng ý với điều khoản mẫu."}</span>
          </label>
          {err.agree && <p role="alert" className="mt-1 text-xs font-semibold text-danger">{err.agree}</p>}
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>{busy ? "Đang tạo…" : "Tạo tài khoản"}</Button>
      </form>
    </AuthLayout>
  );
}

export function Recover() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Nhập email đúng định dạng.");
    setErr("");
    if (isLive()) {
      try {
        await getLiveApi().auth.recover(email.trim());
      } catch (ex) {
        return setErr((ex as Error).message);
      }
    }
    setSent(true);
  };
  return (
    <AuthLayout icon={KeyRound} title="Khôi phục mật khẩu" subtitle="Nhập email để nhận liên kết đặt lại mật khẩu." extra={<FactStrip />}>
      {sent ? (
        <div className="space-y-4">
          <Banner tone="ok" title={isLive() ? "Đã gửi yêu cầu" : "Đã gửi (mô phỏng)"}>
            <MailCheck className="mr-1 inline h-4 w-4" aria-hidden />{isLive() ? "Nếu email có tài khoản, liên kết đặt lại mật khẩu sẽ được gửi tới email đó." :"Sẽ không có email thật nào được gửi trong bản xem trước."}
          </Banner>
          <Button variant="primary" className="w-full" onClick={() => navigate("/login")}>Quay lại đăng nhập</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="qemail" error={err}>
            <IconInput icon={Mail} id="qemail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!err} />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full">Gửi liên kết</Button>
          <Link to="/login" className="block rounded text-center text-sm font-semibold text-teal-ink hover:underline">Quay lại đăng nhập</Link>
        </form>
      )}
    </AuthLayout>
  );
}

/** Lựa chọn chế độ ở màn Xin chào: là nút thật (có mũi tên và hover), khác với ô giới thiệu chỉ để đọc ở màn Chào mừng. */
function ModeChoice({ icon: Icon, title, text, chips, onPick }: { icon: LucideIcon; title: string; text: string; chips: string[]; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} className="group flex w-full items-start gap-3.5 rounded-xl border border-line-strong bg-surface p-4 text-left transition-colors hover:border-teal hover:bg-teal-tint/40">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-tint text-teal-ink"><Icon className="h-5 w-5" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-soft">{text}</span>
        <span className="mt-2.5 flex flex-wrap gap-1.5">{chips.map((c) => <Chip key={c}>{c}</Chip>)}</span>
      </span>
      <ArrowRight className="mt-2.5 h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-teal" aria-hidden />
    </button>
  );
}

export function ChooseMode() {
  const setMode = useAppStore((s) => s.setMode);
  const name = useAppStore((s) => s.account.name);
  const pick = (m: "rent" | "host") => {
    setMode(m);
    navigate(m === "rent" ? "/rent/discover" : "/host");
  };
  return (
    <AuthLayout icon={Compass} title={`Xin chào, ${name.split(" ").slice(-1)[0]}`} subtitle="Bạn muốn làm gì trước? Có thể đổi chế độ bất cứ lúc nào ở thanh trên, không cần đăng xuất." extra={<FactStrip />}>
      <div className="space-y-3">
        <ModeChoice icon={MonitorSmartphone} title="Thuê máy" text="Tìm máy theo nhu cầu và dùng desktop Linux ngay trong app." chips={["Game", "Đồ họa", "Lập trình"]} onPick={() => pick("rent")} />
        <ModeChoice icon={Server} title="Cho thuê máy" text="Chia sẻ tài nguyên máy Windows của bạn theo lịch. Cần quét máy đạt điều kiện trước khi đăng máy." chips={["Quét máy", "Đặt lịch", "Nhận PCP"]} onPick={() => pick("host")} />
      </div>
    </AuthLayout>
  );
}

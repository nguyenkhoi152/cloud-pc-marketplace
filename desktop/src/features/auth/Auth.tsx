import { ArrowRight, MailCheck, MonitorSmartphone, Server } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, navigate } from "@/app/router";
import { useAppStore } from "@/state/store";
import { Banner } from "@/ui/feedback";
import { Button } from "@/ui/button";
import { Field, Input } from "@/ui/controls";
import { DemoBanner, DemoPanel, ToastRegion } from "@/layout/Chrome";

function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex h-full flex-col">
      <DemoBanner />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,2fr)_3fr]">
        <aside className="flex flex-col justify-between bg-navy p-8 text-white lg:p-10">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal"><MonitorSmartphone className="h-5 w-5" aria-hidden /></span>
            <span className="font-bold leading-tight">Cloud PC Companion</span>
          </div>
          <div>
            <h2 className="max-w-sm text-2xl font-bold leading-snug">Một app cho cả người thuê và người cho thuê máy.</h2>
            <ul className="mt-5 max-w-sm space-y-2.5 text-sm text-sky">
              <li>Một tài khoản, đổi giữa Thuê máy và Cho thuê máy mà không cần đăng xuất.</li>
              <li>Chọn chế độ Cho thuê máy không tự cấp quyền host: cần kiểm tra máy và chờ duyệt.</li>
              <li>Desktop Linux trong app qua Selkies là hướng dự kiến, còn cần thử nghiệm trên máy thật.</li>
            </ul>
          </div>
          <p className="text-xs text-sky/80">Bản xem trước giao diện. Không có tài khoản, thanh toán hay kết nối thật.</p>
        </aside>
        <main className="flex items-center justify-center overflow-auto p-8">
          <div className="w-full max-w-[420px]">
            <h1 className="text-2xl font-bold">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
        </main>
      </div>
      <div className="fixed right-4 top-10"><DemoPanel /></div>
      <ToastRegion />
    </div>
  );
}

export function Welcome() {
  const signIn = useAppStore((s) => s.signIn);
  return (
    <AuthLayout title="Chào mừng" subtitle="Thuê sức mạnh máy tính từ xa, hoặc cho thuê máy của bạn vào những giờ rảnh.">
      <div className="space-y-3">
        <Button variant="primary" size="lg" className="w-full" onClick={() => navigate("/login")}>Đăng nhập</Button>
        <Button variant="secondary" size="lg" className="w-full" onClick={() => navigate("/register")}>Tạo tài khoản</Button>
        <Button variant="ghost" className="w-full" onClick={() => { signIn(); navigate("/choose-mode"); }}>Vào nhanh với tài khoản demo <ArrowRight className="h-4 w-4" aria-hidden /></Button>
      </div>
      <Banner tone="warn" className="mt-6" title="Đây là mô phỏng">
        Đăng nhập và đăng ký chỉ minh họa luồng. Không dữ liệu nào được gửi đi hay lưu lại.
      </Banner>
    </AuthLayout>
  );
}

export function Login() {
  const signIn = useAppStore((s) => s.signIn);
  const [email, setEmail] = useState("minhanh@example.test");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<{ email?: string; pw?: string }>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const x: typeof err = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) x.email = "Nhập email đúng định dạng.";
    if (pw.length < 1) x.pw = "Nhập mật khẩu (bất kỳ — đây là mô phỏng).";
    setErr(x);
    if (Object.keys(x).length) return;
    signIn(undefined, email);
    navigate("/choose-mode");
  };
  return (
    <AuthLayout title="Đăng nhập" subtitle="Dùng email bất kỳ và mật khẩu bất kỳ để xem thử.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email" error={err.email}>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!err.email} />
        </Field>
        <Field label="Mật khẩu" htmlFor="pw" error={err.pw}>
          <Input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!err.pw} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full">Đăng nhập</Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link to="/recover" className="rounded font-semibold text-teal-dark hover:underline">Quên mật khẩu?</Link>
        <Link to="/register" className="rounded font-semibold text-teal-dark hover:underline">Tạo tài khoản</Link>
      </div>
    </AuthLayout>
  );
}

export function Register() {
  const signIn = useAppStore((s) => s.signIn);
  const [f, setF] = useState({ name: "", email: "", pw: "", agree: false });
  const [err, setErr] = useState<Record<string, string>>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (f.name.trim().length < 2) x.name = "Nhập tên hiển thị (ít nhất 2 ký tự).";
    if (!/^\S+@\S+\.\S+$/.test(f.email)) x.email = "Nhập email đúng định dạng.";
    if (f.pw.length < 8) x.pw = "Mật khẩu tối thiểu 8 ký tự.";
    if (!f.agree) x.agree = "Cần đồng ý để tiếp tục.";
    setErr(x);
    if (Object.keys(x).length) return;
    signIn(f.name, f.email);
    navigate("/choose-mode");
  };
  return (
    <AuthLayout title="Tạo tài khoản" subtitle="Một tài khoản dùng cho cả thuê máy và cho thuê máy.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Tên hiển thị" htmlFor="name" error={err.name}>
          <Input id="name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-invalid={!!err.name} />
        </Field>
        <Field label="Email" htmlFor="remail" error={err.email}>
          <Input id="remail" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-invalid={!!err.email} />
        </Field>
        <Field label="Mật khẩu" htmlFor="rpw" error={err.pw} hint="Tối thiểu 8 ký tự.">
          <Input id="rpw" type="password" autoComplete="new-password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} aria-invalid={!!err.pw} />
        </Field>
        <div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} className="mt-1 h-4 w-4 accent-teal" aria-invalid={!!err.agree} />
            <span>Tôi hiểu đây là bản xem trước và đồng ý với điều khoản mẫu.</span>
          </label>
          {err.agree && <p role="alert" className="mt-1 text-xs font-semibold text-danger">{err.agree}</p>}
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full">Tạo tài khoản</Button>
      </form>
      <p className="mt-4 text-sm">Đã có tài khoản? <Link to="/login" className="rounded font-semibold text-teal-dark hover:underline">Đăng nhập</Link></p>
    </AuthLayout>
  );
}

export function Recover() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Nhập email đúng định dạng.");
    setErr("");
    setSent(true);
  };
  return (
    <AuthLayout title="Khôi phục mật khẩu" subtitle="Nhập email để nhận liên kết đặt lại mật khẩu.">
      {sent ? (
        <div className="space-y-4">
          <Banner tone="ok" title="Đã gửi (mô phỏng)">
            <MailCheck className="mr-1 inline h-4 w-4" aria-hidden />Sẽ không có email thật nào được gửi trong bản xem trước.
          </Banner>
          <Button variant="primary" className="w-full" onClick={() => navigate("/login")}>Quay lại đăng nhập</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="qemail" error={err}>
            <Input id="qemail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!err} />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full">Gửi liên kết</Button>
          <Link to="/login" className="block rounded text-center text-sm font-semibold text-teal-dark hover:underline">Quay lại đăng nhập</Link>
        </form>
      )}
    </AuthLayout>
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
    <AuthLayout title={`Xin chào, ${name.split(" ").slice(-1)[0]}`} subtitle="Bạn muốn làm gì trước? Có thể đổi chế độ bất cứ lúc nào ở thanh trên, không cần đăng xuất.">
      <div className="space-y-3">
        <button type="button" onClick={() => pick("rent")} className="flex w-full items-start gap-3 rounded-lg border border-line-strong bg-surface p-4 text-left transition-colors hover:border-teal hover:bg-teal-tint/50">
          <MonitorSmartphone className="mt-0.5 h-6 w-6 text-teal" aria-hidden />
          <span><span className="block font-bold">Thuê máy</span><span className="block text-sm text-ink-soft">Tìm máy theo nhu cầu Game, Đồ họa hoặc Lập trình và dùng desktop Linux trong app.</span></span>
        </button>
        <button type="button" onClick={() => pick("host")} className="flex w-full items-start gap-3 rounded-lg border border-line-strong bg-surface p-4 text-left transition-colors hover:border-teal hover:bg-teal-tint/50">
          <Server className="mt-0.5 h-6 w-6 text-teal" aria-hidden />
          <span><span className="block font-bold">Cho thuê máy</span><span className="block text-sm text-ink-soft">Chia sẻ tài nguyên máy Windows của bạn theo lịch. Cần kiểm tra máy và chờ duyệt trước khi nhận khách.</span></span>
        </button>
      </div>
      <Banner tone="info" className="mt-5">Chọn chế độ Cho thuê máy chỉ mở hướng dẫn thiết lập — không tự cấp quyền host.</Banner>
    </AuthLayout>
  );
}

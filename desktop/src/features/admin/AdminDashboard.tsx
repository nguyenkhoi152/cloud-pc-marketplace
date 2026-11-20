/**
 * Màn Quản trị (admin): thay cho script `admin.mts` ở terminal. Chỉ hiện ở chế độ live với tài khoản có role admin.
 * Mọi thao tác là lời gọi RPC/API có kiểm quyền ở DB (review_host, review_machine, admin_delete_machine, thu hồi thiết bị qua server);
 * cờ `isAdmin` ở đây chỉ để ẩn/hiện màn, người không phải admin gọi thẳng vẫn bị DB từ chối.
 */
import { Receipt, RefreshCw, Server, ShieldCheck, UserRound, Users, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getLiveApi, getServerApi } from "@/api";
import { isLive } from "@/api/env";
import { formatUnits } from "@/api/live";
import {
  ACCESS_STATE_LABEL, BOOKING_STATE_LABEL, HEALTH_LABEL, auditLabel, resourceLabel, summarize,
  type AdminAudit, type AdminBooking, type AdminHost, type AdminMachine, type AdminSnapshot, type AdminUser, type Health,
} from "@/domain/adminData";
import { useAppStore } from "@/state/store";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm";
import { Checkbox, Input, Segmented } from "@/ui/controls";
import { Banner, EmptyState } from "@/ui/feedback";
import { PageHeader, Section, StatTile } from "@/ui/page";

const TZ = "Asia/Ho_Chi_Minh";
const fmt = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: TZ, hour12: false });
const pcp = (units: string) => `${formatUnits(units)} PCP`;
const REFRESH_MS = 15_000;
const TABLE_LIMIT = 100;

type Tab = "overview" | "machines" | "hosts" | "bookings" | "users" | "audit";
type Confirm =
  | { kind: "suspend-machine" | "restore-machine" | "delete-machine" | "revoke-device"; id: string; name: string }
  | { kind: "suspend-host" | "restore-host"; id: string; name: string };

const HEALTH_TONE: Record<Health, "ok" | "warn" | "danger" | "neutral"> = { ok: "ok", suspect: "warn", incident: "danger", unknown: "neutral" };
const MACHINE_STATUS: Record<AdminMachine["status"], { text: string; tone: "ok" | "neutral" | "warn" | "danger" }> = {
  approved: { text: "Đang đăng", tone: "ok" },
  draft: { text: "Nháp", tone: "neutral" },
  review: { text: "Chờ duyệt (cũ)", tone: "warn" },
  suspended: { text: "Đình chỉ", tone: "danger" },
};
const HOST_STATUS: Record<AdminHost["status"], { text: string; tone: "ok" | "warn" | "danger" }> = {
  approved: { text: "Hoạt động", tone: "ok" },
  pending: { text: "Chờ (cũ)", tone: "warn" },
  suspended: { text: "Đình chỉ", tone: "danger" },
};

function Table({ head, children, empty, total, shown }: { head: string[]; children: ReactNode; empty: string; total: number; shown: number }) {
  if (total === 0) return <EmptyState title={empty} />;
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-subtle text-xs text-ink-soft">
            <tr>{head.map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {total > shown && <p className="mt-2 text-xs text-ink-faint">Đang hiện {shown} trên {total} dòng gần nhất. Dùng ô tìm kiếm để thu hẹp.</p>}
    </div>
  );
}
const Td = ({ children, className = "" }: { children: ReactNode; className?: string }) => <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
const TestTag = () => <span className="ml-1.5 rounded border border-line-strong px-1.5 py-px text-[11px] font-semibold text-ink-faint">kiểm thử</span>;

function Stat({ label, value, sub, tone, icon, index }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "danger"; icon: LucideIcon; index: number }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-ink";
  return <StatTile index={index} icon={icon} label={label} value={<span className={color}>{value}</span>} hint={sub} tone={tone === "ok" ? "ok" : tone ? "warn" : "default"} />;
}

export function AdminDashboard() {
  const isAdmin = useAppStore((s) => !!s.account.isAdmin);
  if (!isLive()) return <Banner tone="info" title="Không khả dụng">Màn Quản trị không có trong bản xem trước.</Banner>;
  if (!isAdmin)
    return (
      <Banner tone="danger" title="Không có quyền truy cập">
        Tài khoản của bạn không có quyền quản trị.
      </Banner>
    );
  return <AdminInner />;
}

function AdminInner() {
  const toast = useAppStore((s) => s.toast);
  const [snap, setSnap] = useState<AdminSnapshot | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [q, setQ] = useState("");
  const [hideTest, setHideTest] = useState(true);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState("");
  const [actionErr, setActionErr] = useState("");
  const alive = useRef(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const s = await getLiveApi().admin.snapshot();
      if (alive.current) { setSnap(s); setLoadErr(""); }
    } catch (e) {
      if (alive.current) setLoadErr((e as Error).message);
    } finally {
      if (alive.current) setRefreshing(false);
    }
  }, []);
  // Tự làm mới giữ nguyên dữ liệu cũ trên màn (không nháy trắng); trạng thái online đổi theo heartbeat.
  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setActionErr("");
    try {
      await fn();
      toast(ok, "ok");
      await load();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const doConfirm = (c: Confirm) => {
    const api = getLiveApi().admin;
    const key = `${c.kind}:${c.id}`;
    switch (c.kind) {
      case "suspend-machine": return act(key, () => api.reviewMachine(c.id, "suspended"), `Đã đình chỉ máy "${c.name}": không còn hiện cho người thuê.`);
      case "restore-machine": return act(key, () => api.reviewMachine(c.id, "approved"), `Đã đăng lại máy "${c.name}".`);
      case "delete-machine": return act(key, () => api.deleteMachine(c.id), `Đã xóa máy "${c.name}".`);
      case "revoke-device": return act(key, () => getServerApi().revokeMyDevice(c.id), `Đã thu hồi thiết bị của máy "${c.name}". Host cần ghi danh lại.`);
      case "suspend-host": return act(key, () => api.reviewHost(c.id, "suspended"), `Đã đình chỉ host "${c.name}": mất quyền đăng máy và ghi danh.`);
      case "restore-host": return act(key, () => api.reviewHost(c.id, "approved"), `Đã bỏ đình chỉ host "${c.name}".`);
    }
  };

  const needle = q.trim().toLowerCase();
  const has = (...vals: string[]) => !needle || vals.some((v) => v.toLowerCase().includes(needle));
  const view = useMemo(() => {
    if (!snap) return null;
    const keepTest = (isTest: boolean) => !hideTest || isTest === false;
    const testMachine = new Set(snap.machines.filter((m) => m.isTest).map((m) => m.id));
    return {
      summary: summarize(snap, hideTest),
      machines: snap.machines.filter((m) => keepTest(m.isTest) && has(m.name, m.ownerName, m.machineKey)),
      hosts: snap.hosts.filter((h) => keepTest(h.isTest) && has(h.name)),
      users: snap.users.filter((u) => keepTest(u.isTest) && has(u.name)),
      bookings: snap.bookings.filter((b) => keepTest(testMachine.has(b.machineId)) && has(b.machineName, b.renterName, b.hostName, b.id)),
      audit: snap.audit.filter((a) => has(a.actorName, a.action, auditLabel(a.action), a.resource)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, hideTest, needle]);

  const isBusy = (kind: Confirm["kind"], id: string) => busy === `${kind}:${id}`;

  return (
    <div>
      <PageHeader
        title="Quản trị"
        subtitle="Theo dõi và quản lý host, máy, phiên thuê và nhật ký hoạt động. Mọi thao tác đều được ghi lại."
        actions={
          <>
            <span className="text-xs text-ink-faint">{snap ? `Cập nhật ${fmt(snap.fetchedAt)}` : ""}</span>
            <Button size="sm" variant="secondary" loading={refreshing} onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden />Tải lại</Button>
          </>
        }
      />

      {loadErr && <Banner tone="danger" className="mb-4" title="Không tải được dữ liệu quản trị">{loadErr}</Banner>}
      {actionErr && <Banner tone="danger" className="mb-4" title="Thao tác không thành công">{actionErr}</Banner>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<Tab>
          label="Mục quản trị"
          value={tab}
          onChange={setTab}
          items={[
            { value: "overview", label: "Tổng quan" },
            { value: "machines", label: "Máy" },
            { value: "hosts", label: "Host" },
            { value: "bookings", label: "Phiên thuê" },
            { value: "users", label: "Người dùng" },
            { value: "audit", label: "Nhật ký" },
          ]}
        />
        {tab !== "overview" && <Input aria-label="Tìm theo tên" placeholder="Tìm theo tên, mã…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />}
        <Checkbox checked={hideTest} onChange={setHideTest} label="Ẩn tài khoản và máy dùng để kiểm thử" />
      </div>

      {!snap || !view ? (
        loadErr ? null : <p className="text-sm text-ink-soft" role="status">Đang tải dữ liệu quản trị…</p>
      ) : (
        <>
          {tab === "overview" && <Overview summary={view.summary} audit={snap.audit} onTab={setTab} />}
          {tab === "machines" && <MachinesTab rows={view.machines} onAsk={setConfirm} isBusy={isBusy} />}
          {tab === "hosts" && <HostsTab rows={view.hosts} onAsk={setConfirm} isBusy={isBusy} />}
          {tab === "bookings" && <BookingsTab rows={view.bookings} />}
          {tab === "users" && <UsersTab rows={view.users} />}
          {tab === "audit" && <AuditTab rows={view.audit} />}
        </>
      )}

      {confirm && <ConfirmFor confirm={confirm} onClose={() => setConfirm(null)} onConfirm={() => void doConfirm(confirm)} />}
    </div>
  );
}

function ConfirmFor({ confirm, onClose, onConfirm }: { confirm: Confirm; onClose: () => void; onConfirm: () => void }) {
  const text: Record<Confirm["kind"], { title: string; body: ReactNode; label: string; danger?: boolean }> = {
    "suspend-machine": { title: "Đình chỉ máy?", label: "Đình chỉ", danger: true, body: <>Máy <b>{confirm.name}</b> sẽ biến khỏi danh mục của người thuê và không ai giữ được nữa. Phiên đang chạy không bị ảnh hưởng. Đăng lại được bất cứ lúc nào.</> },
    "restore-machine": { title: "Đăng lại máy?", label: "Đăng lại", body: <>Máy <b>{confirm.name}</b> sẽ hiện lại cho người thuê.</> },
    "delete-machine": { title: "Xóa vĩnh viễn máy?", label: "Xóa máy", danger: true, body: <>Xóa <b>{confirm.name}</b> cùng cam kết giờ và các lượt giữ máy chưa từng trả tiền. <b>Không hoàn tác được.</b> Máy đã có tiền hay phiên thuê sẽ bị từ chối (chỉ đình chỉ được).</> },
    "revoke-device": { title: "Thu hồi thiết bị?", label: "Thu hồi", danger: true, body: <>Thiết bị hiện tại của <b>{confirm.name}</b> sẽ ngừng hoạt động ngay (không còn nhận lệnh và mất kết nối). Chủ máy phải ghi danh lại. Chỉ làm khi họ cài lại môi trường hoặc thiết bị có nguy cơ bị lộ.</> },
    "suspend-host": { title: "Đình chỉ host?", label: "Đình chỉ", danger: true, body: <>Host <b>{confirm.name}</b> mất quyền đăng máy, ghi danh thiết bị và các máy của họ biến khỏi danh mục. Host không tự gỡ được.</> },
    "restore-host": { title: "Bỏ đình chỉ host?", label: "Bỏ đình chỉ", body: <>Host <b>{confirm.name}</b> có lại quyền đăng máy. Các máy của họ không tự đăng lại: đăng lại từng máy ở mục Máy.</> },
  };
  const t = text[confirm.kind];
  return <ConfirmDialog open onOpenChange={(o) => !o && onClose()} title={t.title} confirmLabel={t.label} danger={t.danger} onConfirm={onConfirm}>{t.body}</ConfirmDialog>;
}

function Overview({ summary: s, audit, onTab }: { summary: ReturnType<typeof summarize>; audit: AdminAudit[]; onTab: (t: Tab) => void }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat index={0} icon={Server} label="Máy đang đăng" value={s.machines.published} sub={`${s.machines.online} online · ${s.machines.busy} đang có phiên · ${s.machines.offline} offline`} tone={s.machines.offline > 0 ? "warn" : "ok"} />
        <Stat index={1} icon={Users} label="Host hoạt động" value={s.hosts.approved} sub={s.hosts.suspended ? `${s.hosts.suspended} bị đình chỉ` : "Không ai bị đình chỉ"} />
        <Stat index={2} icon={Receipt} label="Phiên thuê" value={s.bookings.total} sub={`${s.bookings.live} đang sống · ${s.bookings.settled} đã chia tiền · ${s.bookings.expiredUnfunded} hết hạn chưa trả`} />
        <Stat index={3} icon={UserRound} label="Người dùng" value={s.users.total} sub={s.users.test ? `${s.users.test} tài khoản kiểm thử đang ẩn` : undefined} />
      </div>

      <Section title="Cần chú ý" aside={<Button size="sm" variant="ghost" onClick={() => onTab("machines")}>Xem tất cả máy</Button>}>
        {s.attention.length === 0 ? (
          <Banner tone="ok" title="Không có máy nào mất tín hiệu">Mọi máy đang đăng đều đang online hoặc đang có phiên.</Banner>
        ) : (
          <div className="space-y-2">
            <Banner tone="warn" title={`${s.attention.length} máy đang đăng nhưng mất kết nối`}>Người thuê thấy các máy này là Offline và không giữ được. Thường do chủ máy chưa bật nhận thuê hoặc đã tắt ứng dụng.</Banner>
            <ul className="space-y-1 text-sm">
              {s.attention.map((m) => <li key={m.id}><b>{m.name}</b> · chủ {m.ownerName} · {HEALTH_LABEL[m.health]}</li>)}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Hoạt động gần đây" aside={<Button size="sm" variant="ghost" onClick={() => onTab("audit")}>Xem nhật ký</Button>}>
        {audit.length === 0 ? <p className="text-sm text-ink-soft">Chưa có hoạt động nào.</p> : (
          <ul className="space-y-1 text-sm">
            {audit.slice(0, 8).map((a) => <li key={a.id}><span className="text-ink-faint">{fmt(a.createdAt)}</span> · {auditLabel(a.action)} · {a.actorName}</li>)}
          </ul>
        )}
      </Section>
    </div>
  );
}

function MachinesTab({ rows, onAsk, isBusy }: { rows: AdminMachine[]; onAsk: (c: Confirm) => void; isBusy: (k: Confirm["kind"], id: string) => boolean }) {
  return (
    <Table head={["Máy", "Chủ máy", "Trạng thái", "Kết nối", "Giá / gói", "Phiên", "Thao tác"]} total={rows.length} shown={Math.min(rows.length, TABLE_LIMIT)} empty="Không có máy nào khớp.">
      {rows.slice(0, TABLE_LIMIT).map((m) => {
        const st = MACHINE_STATUS[m.status];
        return (
          <tr key={m.id} className="border-b border-line last:border-0 hover:bg-subtle/70">
            <Td><p className="font-bold">{m.name}{m.isTest && <TestTag />}</p><p className="num text-xs text-ink-faint">{m.id.slice(0, 8)} · {m.machineKey}</p></Td>
            <Td>{m.ownerName}</Td>
            <Td><Badge tone={st.tone}>{st.text}</Badge></Td>
            <Td>{m.status === "approved" ? <Badge tone={HEALTH_TONE[m.health]}>{HEALTH_LABEL[m.health]}</Badge> : <span className="text-xs text-ink-faint">—</span>}</Td>
            <Td className="num whitespace-nowrap">{pcp(m.priceUnits)}</Td>
            <Td className="text-xs">{m.bookingsTotal} lượt{m.bookingsLive > 0 && <span className="ml-1 font-semibold text-info">· {m.bookingsLive} đang sống</span>}</Td>
            <Td>
              <div className="flex flex-wrap gap-1.5">
                {m.status === "approved" && <Button size="sm" variant="secondary" loading={isBusy("suspend-machine", m.id)} onClick={() => onAsk({ kind: "suspend-machine", id: m.id, name: m.name })}>Đình chỉ</Button>}
                {m.status === "suspended" && <Button size="sm" variant="secondary" loading={isBusy("restore-machine", m.id)} onClick={() => onAsk({ kind: "restore-machine", id: m.id, name: m.name })}>Đăng lại</Button>}
                {m.status === "approved" && m.health !== "unknown" && <Button size="sm" variant="ghost" loading={isBusy("revoke-device", m.id)} onClick={() => onAsk({ kind: "revoke-device", id: m.id, name: m.name })}>Thu hồi thiết bị</Button>}
                <Button size="sm" variant="danger" disabled={!m.deletable || m.bookingsLive > 0} title={m.deletable ? undefined : "Máy đã có tiền hoặc phiên thuê: chỉ đình chỉ được"} loading={isBusy("delete-machine", m.id)} onClick={() => onAsk({ kind: "delete-machine", id: m.id, name: m.name })}>Xóa</Button>
              </div>
            </Td>
          </tr>
        );
      })}
    </Table>
  );
}

function HostsTab({ rows, onAsk, isBusy }: { rows: AdminHost[]; onAsk: (c: Confirm) => void; isBusy: (k: Confirm["kind"], id: string) => boolean }) {
  return (
    <Table head={["Host", "Trạng thái", "Số máy", "Đăng ký lúc", "Thao tác"]} total={rows.length} shown={Math.min(rows.length, TABLE_LIMIT)} empty="Không có host nào khớp.">
      {rows.slice(0, TABLE_LIMIT).map((h) => {
        const st = HOST_STATUS[h.status];
        return (
          <tr key={h.userId} className="border-b border-line last:border-0 hover:bg-subtle/70">
            <Td><p className="font-bold">{h.name}{h.isTest && <TestTag />}</p><p className="num text-xs text-ink-faint">{h.userId.slice(0, 8)}</p></Td>
            <Td><Badge tone={st.tone}>{st.text}</Badge></Td>
            <Td className="num">{h.machines}</Td>
            <Td className="whitespace-nowrap text-xs">{fmt(h.createdAt)}</Td>
            <Td>
              {h.status === "suspended"
                ? <Button size="sm" variant="secondary" loading={isBusy("restore-host", h.userId)} onClick={() => onAsk({ kind: "restore-host", id: h.userId, name: h.name })}>Bỏ đình chỉ</Button>
                : <Button size="sm" variant="secondary" loading={isBusy("suspend-host", h.userId)} onClick={() => onAsk({ kind: "suspend-host", id: h.userId, name: h.name })}>Đình chỉ</Button>}
            </Td>
          </tr>
        );
      })}
    </Table>
  );
}

function BookingsTab({ rows }: { rows: AdminBooking[] }) {
  return (
    <Table head={["Máy", "Người thuê", "Host", "Tiền", "Truy cập", "Giá", "Tạo lúc"]} total={rows.length} shown={Math.min(rows.length, TABLE_LIMIT)} empty="Không có phiên thuê nào khớp.">
      {rows.slice(0, TABLE_LIMIT).map((b) => (
        <tr key={b.id} className="border-b border-line last:border-0 hover:bg-subtle/70">
          <Td><p className="font-bold">{b.machineName}</p><p className="num text-xs text-ink-faint">{b.id.slice(0, 8)}</p></Td>
          <Td>{b.renterName}</Td>
          <Td>{b.hostName}</Td>
          <Td><Badge tone={b.live ? "info" : b.state === "settled" || b.state === "resolved" ? "ok" : "neutral"}>{BOOKING_STATE_LABEL[b.state] ?? b.state}</Badge></Td>
          <Td className="text-xs">{ACCESS_STATE_LABEL[b.accessState] ?? b.accessState}</Td>
          <Td className="num whitespace-nowrap">{pcp(b.priceUnits)}</Td>
          <Td className="whitespace-nowrap text-xs">{fmt(b.createdAt)}</Td>
        </tr>
      ))}
    </Table>
  );
}

function UsersTab({ rows }: { rows: AdminUser[] }) {
  return (
    <Table head={["Tên hiển thị", "Vai trò", "Tạo lúc"]} total={rows.length} shown={Math.min(rows.length, TABLE_LIMIT)} empty="Không có người dùng nào khớp.">
      {rows.slice(0, TABLE_LIMIT).map((u) => (
        <tr key={u.userId} className="border-b border-line last:border-0 hover:bg-subtle/70">
          <Td><p className="font-bold">{u.name}{u.isTest && <TestTag />}</p><p className="num text-xs text-ink-faint">{u.userId.slice(0, 8)}</p></Td>
          <Td>
            <div className="flex flex-wrap gap-1.5">
              {u.isAdmin && <Badge tone="teal" icon={ShieldCheck}>Admin</Badge>}
              {u.isHost && <Badge tone={u.hostStatus === "suspended" ? "danger" : "ok"}>{u.hostStatus === "suspended" ? "Host (đình chỉ)" : "Host"}</Badge>}
              {!u.isAdmin && !u.isHost && <span className="text-xs text-ink-faint">Người thuê</span>}
            </div>
          </Td>
          <Td className="whitespace-nowrap text-xs">{fmt(u.createdAt)}</Td>
        </tr>
      ))}
    </Table>
  );
}

function AuditTab({ rows }: { rows: AdminAudit[] }) {
  return (
    <Table head={["Lúc", "Ai", "Việc", "Đối tượng", "Kết quả"]} total={rows.length} shown={Math.min(rows.length, TABLE_LIMIT)} empty="Chưa có dòng nhật ký nào khớp.">
      {rows.slice(0, TABLE_LIMIT).map((a) => (
        <tr key={a.id} className="border-b border-line last:border-0 hover:bg-subtle/70">
          <Td className="whitespace-nowrap text-xs">{fmt(a.createdAt)}</Td>
          <Td>{a.actorName}</Td>
          <Td>{auditLabel(a.action)}</Td>
          <Td className="num text-xs">{resourceLabel(a.resource)}</Td>
          <Td><Badge tone={a.outcome === "ok" ? "ok" : "warn"}>{a.outcome}</Badge></Td>
        </tr>
      ))}
    </Table>
  );
}

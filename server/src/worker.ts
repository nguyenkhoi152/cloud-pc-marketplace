/**
 * Worker vòng đời phiên: nhận job từ outbox (lease + fencing), xử lý idempotent, retry có backoff.
 * Nguyên tắc: tiền, quyền truy cập, cleanup là các trạng thái ĐỘC LẬP; Unknown/lỗi giữ máy bị khoá cho tới khi đối soát;
 * không cấp remote khi chưa có Active xác nhận từ chuỗi; không dùng timer trong tab/app.
 * Provider remote và operator chuỗi là giao diện — test dùng bản giả CÓ NHÃN; bản thật nối host-agent/viem ở mốc sau.
 */
import { scanBookingEvents, type LogsClientLike } from "@cpm/shared/src/chainEvents";
import { keccak256, toBytes, type Hex } from "viem";
import { applyEvents, BOOKING_CHAIN_SQL, type BookingChainRow } from "./api/reconcile";
import { ESCROW_STATE, type EscrowReader } from "./chainReader";
import type { Deps, Tx } from "./core";

export type RemoteResult = { ok: true; evidence: string } | { ok: false; reason: string; unknown?: boolean };
/** Mọi hành động idempotent theo (bookingId, actionId). Không có shell/đường dẫn/URL/port từ renter. */
export interface SessionProvider {
  prepare(i: { bookingId: string; actionId: string }): Promise<RemoteResult>;
  grant(i: { bookingId: string; actionId: string; renterId: string; endAtMs: number }): Promise<RemoteResult>;
  revoke(i: { bookingId: string; actionId: string }): Promise<RemoteResult>;
  reset(i: { bookingId: string; actionId: string }): Promise<RemoteResult>;
  verifyReset(i: { bookingId: string; actionId: string }): Promise<RemoteResult>;
}
/** Chỉ operator (khoá ở server) gọi được activate trên escrow. */
export interface ChainOperator {
  activate(bookingId: Hex): Promise<Hex>;
  claimAfterGrace(bookingId: Hex): Promise<Hex>;
}

export interface WorkerDeps extends Deps {
  escrowReader: EscrowReader;
  operator: ChainOperator;
  provider: SessionProvider;
  chainLogs?: LogsClientLike;
  workerId: string;
  /** Khối bắt đầu quét sự kiện (khối deploy escrow). */
  deployBlock: bigint;
  /** Chỉ hết hạn booking sau fund_by + margin (giây) và khi chuỗi xác nhận không có booking. */
  expireMarginSeconds: number;
  leaseSeconds: number;
}

/** Lỗi có thể thử lại (RPC, provider chưa biết, đang chờ điều kiện). */
export class RetryableError extends Error {}
/** Lỗi không thể tự khỏi: job vào trạng thái dead + audit để người xử lý. */
export class PermanentError extends Error {}

interface Job {
  id: string; action_key: string; job_type: string; payload: { booking_id?: string; reason?: string }; attempts: number;
}
interface BookingRow {
  id: string; state: string; access_state: string; renter_id: string; machine_id: string; cid: string;
  end_ms: string | null; activate_ok: boolean;
}

const TERMINAL = ["settled", "refunded", "resolved", "cancelled", "expired"];

async function loadBooking(c: Tx, id: string): Promise<BookingRow | undefined> {
  return (
    await c.query<BookingRow>(
      `select id, state, access_state, renter_id, machine_id, encode(chain_booking_id, 'hex') as cid,
              (extract(epoch from end_at) * 1000)::bigint::text as end_ms, (activate_by > now()) as activate_ok
         from public.bookings where id = $1 for update`,
      [id],
    )
  ).rows[0];
}

const setAccess = (c: Tx, id: string, to: string) => c.query("update public.bookings set access_state = $2 where id = $1", [id, to]);
const audit = (c: Tx, action: string, resource: string, outcome: string, detail: object = {}) =>
  c.query("insert into public.audit_logs (actor, action, resource, outcome, detail) values (null, $1, $2, $3, $4::jsonb)", [action, resource, outcome, JSON.stringify(detail)]);
const enqueue = (c: Tx, key: string, type: string, payload: object, delay = 0) => c.query("select public.enqueue_job($1, $2, $3::jsonb, $4)", [key, type, JSON.stringify(payload), delay]);

/** Chạy provider NGOÀI transaction DB (không giữ khoá hàng khi gọi bên ngoài), rồi ghi kết quả. */
async function callProvider(deps: WorkerDeps, fn: () => Promise<RemoteResult>): Promise<RemoteResult> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, reason: `provider_error:${(e as Error).message.slice(0, 120)}`, unknown: true };
  }
}

/* --------------------------------------------------------------------------------------------- handlers */

async function expireBooking(deps: WorkerDeps, id: string) {
  const info = await deps.db.tx(async (c) => (await c.query<{ state: string; cid: string; past: boolean }>(
    "select state, encode(chain_booking_id, 'hex') as cid, (fund_by + make_interval(secs => $2) < now()) as past from public.bookings where id = $1", [id, deps.expireMarginSeconds])).rows[0]);
  if (!info || info.state !== "reserved") return { skipped: info?.state ?? "missing" };
  if (!info.past) throw new RetryableError("chưa quá hạn giữ máy cộng biên an toàn");
  let st: number;
  try {
    st = await deps.escrowReader.stateOf(`0x${info.cid}`);
  } catch (e) {
    throw new RetryableError(`không đọc được chuỗi: ${(e as Error).message.slice(0, 100)}`); // RPC lỗi → giữ khoá, thử lại
  }
  if (st !== ESCROW_STATE.None) {
    // Chuỗi đã có booking: DB chưa kịp thấy. Đối soát thay vì hết hạn (không bao giờ nhả máy đang có tiền).
    const rec = await reconcile(deps, id);
    return { reconciled: true, chainState: st, ...rec };
  }
  await deps.db.tx(async (c) => {
    await c.query("select public.expire_unfunded_booking($1, true)", [id]);
  });
  return { expired: true };
}

async function reconcile(deps: WorkerDeps, id: string) {
  if (!deps.chainLogs) throw new RetryableError("chưa cấu hình RPC để đối soát");
  const row = await deps.db.tx(async (c) => (await c.query<BookingChainRow>(`${BOOKING_CHAIN_SQL} where b.id = $1`, [id])).rows[0]);
  if (!row) return { skipped: "missing" };
  let scan;
  try {
    scan = await scanBookingEvents(deps.chainLogs, { escrow: deps.cfg.escrow, bookingId: `0x${row.cid}`, fromBlock: deps.deployBlock, minConfirmations: deps.cfg.minConfirmations });
  } catch (e) {
    throw new RetryableError(`không quét được chuỗi: ${(e as Error).message.slice(0, 100)}`);
  }
  const applied = await deps.db.tx((c) => applyEvents(deps, c, row, scan.events));
  return { events: applied.length, outcomes: applied.map((a) => a.outcome) };
}

async function prepareSession(deps: WorkerDeps, id: string) {
  const b = await deps.db.tx(async (c) => {
    const r = await loadBooking(c, id);
    if (r && r.state === "funded" && ["not_granted", "failed", "unknown", "preparing"].includes(r.access_state)) await setAccess(c, id, "preparing");
    return r;
  });
  if (!b || b.state !== "funded") return { skipped: b?.state ?? "missing" };
  if (!["not_granted", "failed", "unknown", "preparing"].includes(b.access_state)) return { skipped: `access:${b.access_state}` };
  const r = await callProvider(deps, () => deps.provider.prepare({ bookingId: id, actionId: `prepare:${id}` }));
  await deps.db.tx(async (c) => {
    if (r.ok) {
      await setAccess(c, id, "ready");
      await enqueue(c, `activate:${id}`, "activate_booking", { booking_id: id });
    } else {
      await setAccess(c, id, r.unknown ? "unknown" : "failed");
      await audit(c, "prepare_failed", `booking:${id}`, r.unknown ? "unknown" : "failed", { reason: r.reason });
    }
  });
  if (!r.ok) throw new RetryableError(`prepare ${r.unknown ? "không rõ" : "thất bại"}: ${r.reason}`);
  return { prepared: true };
}

async function activateBooking(deps: WorkerDeps, id: string) {
  const b = await deps.db.tx(async (c) => loadBooking(c, id));
  if (!b) return { skipped: "missing" };
  if (b.state === "active") return { skipped: "already_active" };
  if (b.state !== "funded") throw new PermanentError(`không kích hoạt được ở trạng thái ${b.state}`);
  if (b.access_state !== "ready") throw new RetryableError(`guest chưa sẵn sàng (${b.access_state})`);
  if (!b.activate_ok) {
    await deps.db.tx((c) => audit(c, "activation_window_missed", `booking:${id}`, "needs_refund", {}));
    throw new PermanentError("quá hạn kích hoạt: cần hoàn tiền trên chuỗi (refundExpired)");
  }
  let st: number;
  try {
    st = await deps.escrowReader.stateOf(`0x${b.cid}`);
  } catch (e) {
    throw new RetryableError(`không đọc được chuỗi: ${(e as Error).message.slice(0, 100)}`);
  }
  // Idempotent theo trạng thái chuỗi: crash giữa chừng không gửi activate lần hai.
  if (st === ESCROW_STATE.Funded) {
    let tx: Hex;
    try {
      tx = await deps.operator.activate(`0x${b.cid}`);
    } catch (e) {
      throw new RetryableError(`gửi activate lỗi: ${(e as Error).message.slice(0, 100)}`);
    }
    await deps.db.tx((c) => audit(c, "activate_sent", `booking:${id}`, "ok", { tx }));
  } else if (st === ESCROW_STATE.None) throw new RetryableError("chuỗi chưa thấy Funded (chờ xác nhận)");
  await deps.db.tx((c) => enqueue(c, `reconcile:${id}:activation`, "reconcile_booking", { booking_id: id }, 2));
  return { activateRequested: st === ESCROW_STATE.Funded, chainState: st };
}

/**
 * Người thuê không accept/dispute: sau endAt + ân hạn, operator gọi claimAfterGrace để phiên kết thúc và host nhận tiền
 * (không phụ thuộc người thuê còn mở app hay còn ví). Chỉ gửi giao dịch khi CHUỖI đang Active (idempotent, crash giữa chừng không gửi hai lần);
 * các trạng thái chuỗi khác chỉ cần đối soát. Revert do gọi sớm hoặc trạng thái đổi giữa chừng được thử lại, không coi là thành công.
 */
async function claimAfterGrace(deps: WorkerDeps, id: string) {
  const b = await deps.db.tx(async (c) => loadBooking(c, id));
  if (!b) return { skipped: "missing" };
  if (b.state !== "active") return { skipped: b.state };
  let st: number;
  try {
    st = await deps.escrowReader.stateOf(`0x${b.cid}`);
  } catch (e) {
    throw new RetryableError(`không đọc được chuỗi: ${(e as Error).message.slice(0, 100)}`);
  }
  if (st === ESCROW_STATE.None || st === ESCROW_STATE.Funded) throw new RetryableError(`chuỗi chưa ở Active (state=${st})`);
  if (st === ESCROW_STATE.Active) {
    let tx: Hex;
    try {
      tx = await deps.operator.claimAfterGrace(`0x${b.cid}`);
    } catch (e) {
      throw new RetryableError(`gửi claimAfterGrace lỗi: ${(e as Error).message.slice(0, 100)}`);
    }
    await deps.db.tx((c) => audit(c, "claim_after_grace_sent", `booking:${id}`, "ok", { tx }));
  }
  await deps.db.tx((c) => enqueue(c, `reconcile:${id}:claim`, "reconcile_booking", { booking_id: id }, 2));
  return { claimRequested: st === ESCROW_STATE.Active, chainState: st };
}

async function grantSession(deps: WorkerDeps, id: string) {
  const b = await deps.db.tx(async (c) => loadBooking(c, id));
  if (!b) return { skipped: "missing" };
  // Chưa có Active được chuỗi xác nhận thì KHÔNG cấp remote.
  if (b.state !== "active") throw new RetryableError(`chưa Active (${b.state})`);
  if (b.access_state === "granted") return { skipped: "already_granted" };
  if (b.access_state !== "ready") throw new RetryableError(`guest chưa sẵn sàng (${b.access_state})`);
  const endMs = Number(b.end_ms);
  if (!Number.isFinite(endMs) || endMs <= Date.now() + 10_000) {
    await deps.db.tx((c) => enqueue(c, `revoke:${id}:expired_before_grant`, "revoke_session", { booking_id: id, reason: "expired_before_grant" }));
    return { skipped: "expired" };
  }
  const r = await callProvider(deps, () => deps.provider.grant({ bookingId: id, actionId: `grant:${id}`, renterId: b.renter_id, endAtMs: endMs }));
  if (!r.ok) {
    await deps.db.tx((c) => audit(c, "grant_failed", `booking:${id}`, r.unknown ? "unknown" : "failed", { reason: r.reason }));
    throw new RetryableError(`grant ${r.unknown ? "không rõ" : "thất bại"}: ${r.reason}`);
  }
  await deps.db.tx((c) => setAccess(c, id, "granted"));
  return { granted: true };
}

/** Thu hồi → reset → xác minh reset; mỗi bước lưu access_state nên crash/restart tiếp tục đúng chỗ. */
async function revokeSession(deps: WorkerDeps, id: string) {
  const act = (n: string) => ({ bookingId: id, actionId: `${n}:${id}` });
  // Chấm dứt quyền ghi workspace TRƯỚC khi thu hồi remote: không còn writer sau khi bắt đầu thu hồi.
  await deps.db.tx(async (c) => c.query("select public.ws_release_for_booking($1)", [id]));
  for (let guard = 0; guard < 6; guard++) {
    const b = await deps.db.tx(async (c) => loadBooking(c, id));
    if (!b) return { skipped: "missing" };
    const a = b.access_state;
    if (a === "not_granted" || a === "reset_verified") break;
    let r: RemoteResult;
    let to: string;
    if (a === "revoked" || a === "resetting") {
      await deps.db.tx((c) => setAccess(c, id, "resetting"));
      r = await callProvider(deps, () => deps.provider.reset(act("reset")));
      if (r.ok) r = await callProvider(deps, () => deps.provider.verifyReset(act("verify_reset")));
      to = "reset_verified";
    } else {
      await deps.db.tx((c) => setAccess(c, id, "revoking"));
      r = await callProvider(deps, () => deps.provider.revoke(act("revoke")));
      to = "revoked";
    }
    await deps.db.tx(async (c) => {
      if (r.ok) await setAccess(c, id, to);
      else {
        await setAccess(c, id, r.unknown ? "unknown" : "failed");
        await audit(c, "revoke_or_reset_failed", `booking:${id}`, r.unknown ? "unknown" : "failed", { reason: r.reason, step: to });
      }
    });
    if (!r.ok) throw new RetryableError(`${to === "revoked" ? "thu hồi" : "reset"} ${r.unknown ? "không rõ" : "thất bại"}: ${r.reason}`);
  }
  // Máy chỉ được nhả khi tiền terminal VÀ truy cập đã reset xác minh. Tiền chưa terminal (disputed) → giữ khoá.
  const final = await deps.db.tx(async (c) => loadBooking(c, id));
  if (final && TERMINAL.includes(final.state) && (final.access_state === "reset_verified" || final.access_state === "not_granted")) {
    await deps.db.tx(async (c) => {
      await c.query("select public.release_machine($1)", [id]);
    });
    return { released: true };
  }
  return { released: false, state: final?.state, access: final?.access_state };
}

const HANDLERS: Record<string, (deps: WorkerDeps, id: string) => Promise<unknown>> = {
  issue_quote: async () => ({ skipped: "quote cấp theo yêu cầu qua API" }),
  expire_booking: expireBooking,
  reconcile_booking: reconcile,
  prepare_session: prepareSession,
  activate_booking: activateBooking,
  claim_after_grace: claimAfterGrace,
  grant_session: grantSession,
  revoke_session: revokeSession,
};

/* --------------------------------------------------------------------------------------------- runner */

export interface RunSummary {
  claimed: number; done: number; retried: number; dead: number; stale: number;
}

/** Lập lịch phụ thuộc thời gian (watchdog endAt, hết hạn, đối soát định kỳ) bằng cách xếp job idempotent. */
export async function scheduleTick(deps: WorkerDeps): Promise<void> {
  await deps.db.tx(async (c) => {
    await c.query("select public.enqueue_expiry_jobs()");
    // Watchdog phía worker: hết endAt mà còn quyền truy cập thì thu hồi (watchdog host độc lập vẫn là lớp chính).
    const due = await c.query<{ id: string }>("select id from public.bookings where state = 'active' and end_at < now() and access_state in ('granted', 'ready', 'unknown', 'failed')");
    for (const r of due.rows) await enqueue(c, `revoke:${r.id}:endAt`, "revoke_session", { booking_id: r.id, reason: "endAt" });
    // Hết endAt + ân hạn (+30 s dự phòng đồng hồ) mà booking vẫn Active: operator tự kết thúc (claimAfterGrace) để host nhận tiền.
    const stale = await c.query<{ id: string }>("select id from public.bookings where state = 'active' and end_at + make_interval(secs => $1) < now()", [deps.cfg.graceSeconds + 30]);
    for (const r of stale.rows) await enqueue(c, `claim:${r.id}`, "claim_after_grace", { booking_id: r.id });
    // Đối soát định kỳ (mỗi 5 phút) cho booking chưa terminal: bắt kịp sự kiện bị bỏ lỡ sau crash/RPC lỗi.
    const open = await c.query<{ id: string }>("select id from public.bookings where state in ('reserved', 'funded', 'active', 'disputed')");
    const bucket = Math.floor(Date.now() / 300_000);
    for (const r of open.rows) await enqueue(c, `reconcile:${r.id}:t${bucket}`, "reconcile_booking", { booking_id: r.id });
  });
}

export async function runOnce(deps: WorkerDeps, limit = 10, opts: { schedule?: boolean } = {}): Promise<RunSummary> {
  if (opts.schedule !== false) await scheduleTick(deps);
  const jobs = await deps.db.tx(async (c) => (await c.query<Job>("select id::text, action_key, job_type, payload, attempts from public.claim_jobs($1, $2, $3)", [deps.workerId, limit, deps.leaseSeconds])).rows);
  const s: RunSummary = { claimed: jobs.length, done: 0, retried: 0, dead: 0, stale: 0 };
  for (const j of jobs) {
    try {
      const h = HANDLERS[j.job_type];
      if (!h) throw new PermanentError(`job_type lạ: ${j.job_type}`);
      const id = j.payload.booking_id;
      if (!id) throw new PermanentError("payload thiếu booking_id");
      const result = await h(deps, id);
      const okDone = await deps.db.tx(async (c) => (await c.query<{ r: boolean }>("select public.complete_job($1, $2, $3, $4::jsonb) as r", [j.id, deps.workerId, j.attempts, JSON.stringify(result ?? {})])).rows[0]!.r);
      if (okDone) s.done++;
      else s.stale++; // false: lease đã mất/đổi chủ — kết quả không được ghi hai lần
    } catch (e) {
      const retry = !(e instanceof PermanentError);
      const r = await deps.db.tx(async (c) => (await c.query<{ r: string }>("select public.fail_job($1, $2, $3, $4, $5) as r", [j.id, deps.workerId, j.attempts, (e as Error).message, retry])).rows[0]!.r);
      if (r === "retry") s.retried++;
      else if (r === "dead") {
        s.dead++;
        await deps.db.tx((c) => audit(c, "job_dead", `job:${j.action_key}`, "needs_attention", { type: j.job_type, error: (e as Error).message.slice(0, 200) }));
      } else s.stale++;
    }
  }
  return s;
}

/** Vòng lặp thường trực. Dừng bằng AbortSignal; một tick lỗi không làm chết worker. */
export async function runForever(deps: WorkerDeps, o: { intervalMs: number; signal: AbortSignal; log?: (m: string) => void }): Promise<void> {
  while (!o.signal.aborted) {
    try {
      const s = await runOnce(deps);
      if (s.claimed) o.log?.(`worker ${deps.workerId}: ${JSON.stringify(s)}`);
    } catch (e) {
      o.log?.(`worker tick lỗi: ${(e as Error).message.slice(0, 200)}`);
    }
    await new Promise<void>((r) => {
      const onAbort = () => { clearTimeout(t); r(); };
      const t = setTimeout(() => { o.signal.removeEventListener("abort", onAbort); r(); }, o.intervalMs);
      o.signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export const machineKeyOf = (machineKey: string) => keccak256(toBytes(machineKey));

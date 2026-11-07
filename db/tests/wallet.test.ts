import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createDb, makeApprovedHost, makeMachine, newUser, renterWithWallet, reserve } from "./harness";

let db: PGlite;
beforeAll(async () => { db = await createDb(); }, 60_000);
afterAll(async () => { await db.close(); });

const addr = (n: number) => "0x" + n.toString(16).padStart(40, "a");
const DOMAIN = "app.example.invalid";

async function challenge(user: string, address: string, nonce: string, expiresSql = "now() + interval '5 minutes'") {
  await db.query(
    `insert into public.wallet_challenges (user_id, domain, address, chain_id, nonce_hash, expires_at)
     values ($1, $2, $3, 43113, $4, ${expiresSql})`,
    [user, DOMAIN, address, nonce],
  );
}
const consume = (user: string, nonce: string, address: string, domain = DOMAIN, chain = 43113) =>
  as(db, "service_role", () => db.query("select public.consume_wallet_challenge($1, $2, $3, $4, $5)", [user, nonce, address, chain, domain]));

describe("wallet challenge", () => {
  it("dùng được đúng một lần và liên kết ví chuẩn hoá chữ thường", async () => {
    const u = await newUser(db);
    await challenge(u, addr(1), "n-1");
    await consume(u, "n-1", addr(1).toUpperCase().replace("0X", "0x"));
    const link = await db.query<{ address: string }>("select address from public.wallet_links where user_id = $1", [u]);
    expect(link.rows[0]!.address).toBe(addr(1));
    await expect(consume(u, "n-1", addr(1))).rejects.toThrow(/invalid_challenge/);
  });

  it("từ chối challenge hết hạn, sai user, sai domain, sai chain, sai address, nonce không tồn tại", async () => {
    const u = await newUser(db);
    const other = await newUser(db);
    await challenge(u, addr(2), "n-expired", "now() - interval '1 second'");
    await challenge(u, addr(2), "n-ok");
    await expect(consume(u, "n-expired", addr(2))).rejects.toThrow(/invalid_challenge/);
    await expect(consume(other, "n-ok", addr(2))).rejects.toThrow(/invalid_challenge/);
    await expect(consume(u, "n-ok", addr(2), "evil.example")).rejects.toThrow(/invalid_challenge/);
    await expect(consume(u, "n-ok", addr(2), DOMAIN, 1)).rejects.toThrow(/invalid_challenge/);
    await expect(consume(u, "n-ok", addr(3))).rejects.toThrow(/invalid_challenge/);
    await expect(consume(u, "n-missing", addr(2))).rejects.toThrow(/invalid_challenge/);
    // thất bại không làm cháy nonce hợp lệ
    await consume(u, "n-ok", addr(2));
  });

  it("một ví không thể gắn cho hai user", async () => {
    const a = await newUser(db);
    const b = await newUser(db);
    await challenge(a, addr(4), "n-a");
    await challenge(b, addr(4), "n-b");
    await consume(a, "n-a", addr(4));
    await expect(consume(b, "n-b", addr(4))).rejects.toThrow(/wallet_taken/);
    // rollback: nonce của b chưa bị tiêu
    const row = await db.query<{ consumed_at: string | null }>("select consumed_at from public.wallet_challenges where nonce_hash = 'n-b'");
    expect(row.rows[0]!.consumed_at).toBeNull();
  });

  it("không đổi ví khi còn booking chưa terminal; đổi được sau khi giải phóng", async () => {
    const host = await makeApprovedHost(db);
    const m = await makeMachine(db, host);
    const renter = await renterWithWallet(db);
    const b = await reserve(db, renter, m);
    await challenge(renter, addr(5), "n-change");
    await expect(consume(renter, "n-change", addr(5))).rejects.toThrow(/wallet_change_blocked/);

    await db.query("update public.bookings set state = 'cancelled' where id = $1", [b.id]);
    await consume(renter, "n-change", addr(5));
    expect((await db.query<{ address: string }>("select address from public.wallet_links where user_id = $1", [renter])).rows[0]!.address).toBe(addr(5));
  });

  it("client không đọc/ghi challenge và không tự ghi wallet_links", async () => {
    const u = await newUser(db);
    await expect(as(db, { user: u }, () => db.query("select * from public.wallet_challenges"))).rejects.toThrow(/permission denied/);
    await expect(as(db, { user: u }, () => db.query("insert into public.wallet_links (user_id, address, chain_id) values ($1, $2, 1)", [u, addr(9)]))).rejects.toThrow(/permission denied/);
  });

  it("địa chỉ sai định dạng bị từ chối ở mức schema", async () => {
    const u = await newUser(db);
    await expect(db.query("insert into public.wallet_links (user_id, address, chain_id) values ($1, '0xABC', 1)", [u])).rejects.toThrow(/check constraint/);
    await expect(db.query("insert into public.wallet_links (user_id, address, chain_id) values ($1, $2, 1)", [u, "0x" + "A".repeat(40)])).rejects.toThrow(/check constraint/);
  });
});

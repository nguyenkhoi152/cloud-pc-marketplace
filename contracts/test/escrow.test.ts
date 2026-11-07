import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther, zeroAddress } from "viem";
import {
  ARBITRATION, DURATION, GRACE, PRICE, State, activated, addr, credit, deployAll, expectRevert, fundBooking, fundWallet,
  makeQuote, networkHelpers, signQuote, viem, type Env,
} from "./helpers.ts";

/** Fixture: env + renter đã có faucet và allowance. */
async function setup(): Promise<Env> {
  const env = await deployAll();
  await fundWallet(env, env.renter);
  await fundWallet(env, env.renter2);
  return env;
}
const fixture = () => networkHelpers.loadFixture(setup);
const stateOf = (env: Env, id: `0x${string}`) => env.escrow.read.stateOf([id]);
const bal = (env: Env, a: `0x${string}`) => env.pcp.read.balanceOf([a]);
const at = async (t: bigint) => networkHelpers.time.setNextBlockTimestamp(Number(t));

describe("fund và quote EIP-712", () => {
  it("fund hợp lệ: giữ đúng PCP, Funded, occupied, event, solvent", async () => {
    const env = await fixture();
    const q = await makeQuote(env);
    const sig = await signQuote(env, q);
    const before = await bal(env, addr(env.renter));
    await env.escrow.write.fund([q, sig], { account: env.renter.account });
    assert.equal(await stateOf(env, q.bookingId), State.Funded);
    assert.equal(await bal(env, env.escrow.address), PRICE);
    assert.equal(before - (await bal(env, addr(env.renter))), PRICE);
    assert.equal(await env.escrow.read.machineOccupied([q.machineKey]), true);
    assert.equal(await env.escrow.read.lockedPrincipal(), PRICE);
    assert.equal(await env.escrow.read.isSolvent(), true);
    const ev = await env.escrow.getEvents.Funded({ bookingId: q.bookingId });
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!.args.priceUnits, PRICE);
  });

  const bad: [string, (q: Awaited<ReturnType<typeof makeQuote>>, env: Env) => object, string][] = [
    ["token sai", (_q, e) => ({ token: addr(e.stranger) }), "InvalidQuote"],
    ["giá 0", () => ({ priceUnits: 0n }), "InvalidAmount"],
    ["fee không khớp cấu hình", () => ({ feeBps: 500n }), "InvalidQuote"],
    ["treasury không khớp", (_q, e) => ({ treasury: addr(e.stranger) }), "InvalidQuote"],
    ["configVersion cũ", () => ({ configVersion: 0n }), "InvalidQuote"],
    ["duration tuỳ ý", () => ({ durationSeconds: 99_999n }), "InvalidQuote"],
    ["grace tuỳ ý", () => ({ graceSeconds: 1n }), "InvalidQuote"],
    ["arbitration tuỳ ý", () => ({ arbitrationSeconds: 1n }), "InvalidQuote"],
    ["renter trùng host", (_q, e) => ({ host: addr(e.renter) }), "InvalidQuote"],
    ["host zero", () => ({ host: zeroAddress }), "InvalidQuote"],
    ["bookingId zero", () => ({ bookingId: `0x${"00".repeat(32)}` as `0x${string}` }), "InvalidQuote"],
    ["issuedAt ở tương lai", (q) => ({ issuedAt: q.issuedAt + 10_000n, fundBy: q.issuedAt + 10_600n, activateBy: q.issuedAt + 10_900n }), "InvalidQuote"],
    ["fundBy sai", (q) => ({ fundBy: q.fundBy + 1n }), "InvalidQuote"],
    ["activateBy sai", (q) => ({ activateBy: q.activateBy + 1n }), "InvalidQuote"],
  ];
  for (const [name, mut, err] of bad) {
    it(`từ chối quote: ${name}`, async () => {
      const env = await fixture();
      const base = await makeQuote(env);
      const q = { ...base, ...mut(base, env) } as typeof base;
      const sig = await signQuote(env, q);
      await expectRevert(env.escrow.write.fund([q, sig], { account: env.renter.account }), err);
      assert.equal(await bal(env, env.escrow.address), 0n);
      assert.equal(await env.escrow.read.machineOccupied([q.machineKey]), false);
    });
  }

  it("từ chối: người gọi không phải renter", async () => {
    const env = await fixture();
    const q = await makeQuote(env);
    await expectRevert(env.escrow.write.fund([q, await signQuote(env, q)], { account: env.renter2.account }), "InvalidQuote");
  });

  it("từ chối chữ ký: signer không có quyền, sai chainId, sai verifyingContract, sửa trường sau khi ký", async () => {
    const env = await fixture();
    const q = await makeQuote(env);
    const call = (sig: `0x${string}`, quote = q) => env.escrow.write.fund([quote, sig], { account: env.renter.account });
    await expectRevert(call(await signQuote(env, q, { by: env.stranger })), "BadSignature");
    await expectRevert(call(await signQuote(env, q, { chainId: 1 })), "BadSignature");
    await expectRevert(call(await signQuote(env, q, { verifyingContract: env.pcp.address })), "BadSignature");
    const sig = await signQuote(env, q);
    await expectRevert(call(sig, { ...q, priceUnits: q.priceUnits - 1n }), "BadSignature");
    await expectRevert(call("0x1234"), /ECDSA|reverted/);
  });

  it("từ chối khi hết hạn fundBy (biên: now >= fundBy)", async () => {
    const env = await fixture();
    const q = await makeQuote(env);
    const sig = await signQuote(env, q);
    await at(q.fundBy);
    await expectRevert(env.escrow.write.fund([q, sig], { account: env.renter.account }), "TooLate");
    const q2 = await makeQuote(env);
    const sig2 = await signQuote(env, q2);
    await at(q2.fundBy - 1n);
    await env.escrow.write.fund([q2, sig2], { account: env.renter.account });
  });

  it("bookingId dùng một lần vĩnh viễn; machineKey occupied chặn booking khác", async () => {
    const env = await fixture();
    const q = await fundBooking(env);
    const dup = await makeQuote(env, { bookingId: q.bookingId });
    await expectRevert(env.escrow.write.fund([dup, await signQuote(env, dup)], { account: env.renter.account }), "BookingUsed");
    const same = await makeQuote(env, { machineKey: q.machineKey, renter: addr(env.renter2) });
    await expectRevert(env.escrow.write.fund([same, await signQuote(env, same)], { account: env.renter2.account }), "MachineOccupied");

    // Sau terminal: machine nhả được, bookingId vẫn không tái sử dụng.
    await env.escrow.write.cancelBeforeStart([q.bookingId], { account: env.renter.account });
    assert.equal(await env.escrow.read.machineOccupied([q.machineKey]), false);
    await expectRevert(env.escrow.write.fund([dup, await signQuote(env, dup)], { account: env.renter.account }), "BookingUsed");
    const again = await makeQuote(env, { machineKey: q.machineKey });
    await env.escrow.write.fund([again, await signQuote(env, again)], { account: env.renter.account });
  });

  it("thiếu allowance hoặc số dư: revert, không đổi state", async () => {
    const env = await fixture();
    await env.pcp.write.approve([env.escrow.address, 0n], { account: env.renter.account });
    const q = await makeQuote(env);
    await expectRevert(env.escrow.write.fund([q, await signQuote(env, q)], { account: env.renter.account }), /ERC20InsufficientAllowance|reverted/);
    assert.equal(await stateOf(env, q.bookingId), State.None);
    assert.equal(await env.escrow.read.machineOccupied([q.machineKey]), false);
    assert.equal(await env.escrow.read.lockedPrincipal(), 0n);

    // ví không có PCP
    const q2 = await makeQuote(env, { renter: addr(env.stranger) });
    await env.pcp.write.approve([env.escrow.address, PRICE], { account: env.stranger.account });
    await expectRevert(env.escrow.write.fund([q2, await signQuote(env, q2)], { account: env.stranger.account }), /ERC20InsufficientBalance|reverted/);
    assert.equal(await stateOf(env, q2.bookingId), State.None);
  });

  it("không nhận AVAX và không có đường sweep/rescue", async () => {
    const env = await fixture();
    await assert.rejects(env.renter.sendTransaction({ to: env.escrow.address, value: 1n }));
    const names: string[] = env.escrow.abi.filter((x) => x.type === "function").map((x) => x.name.toLowerCase());
    for (const n of names) assert.ok(!/sweep|rescue|recover|emergency/.test(n), n);
  });
});

describe("trước khi bắt đầu", () => {
  it("cancelBeforeStart: chỉ renter; hoàn P; không thu phí", async () => {
    const env = await fixture();
    const q = await fundBooking(env);
    await expectRevert(env.escrow.write.cancelBeforeStart([q.bookingId], { account: env.host.account }), "NotAuthorized");
    await env.escrow.write.cancelBeforeStart([q.bookingId], { account: env.renter.account });
    assert.equal(await stateOf(env, q.bookingId), State.Refunded);
    assert.equal(await credit(env, addr(env.renter)), PRICE);
    assert.equal(await credit(env, addr(env.treasury)), 0n);
    assert.equal(await credit(env, addr(env.host)), 0n);
    await expectRevert(env.escrow.write.cancelBeforeStart([q.bookingId], { account: env.renter.account }), "InvalidState");
  });

  it("refundBeforeStart: host hoặc operator; người lạ không", async () => {
    const env = await fixture();
    const a = await fundBooking(env);
    await expectRevert(env.escrow.write.refundBeforeStart([a.bookingId], { account: env.stranger.account }), "NotAuthorized");
    await expectRevert(env.escrow.write.refundBeforeStart([a.bookingId], { account: env.admin.account }), "NotAuthorized");
    await env.escrow.write.refundBeforeStart([a.bookingId], { account: env.host.account });
    assert.equal(await stateOf(env, a.bookingId), State.Refunded);
    const c = await fundBooking(env);
    await env.escrow.write.refundBeforeStart([c.bookingId], { account: env.operator.account });
    assert.equal(await credit(env, addr(env.renter)), PRICE * 2n);
  });

  it("refundExpired: ai cũng gọi được, biên now >= activateBy; activate biên now < activateBy", async () => {
    const env = await fixture();
    const q = await fundBooking(env);
    await at(q.activateBy - 1n);
    await expectRevert(env.escrow.write.refundExpired([q.bookingId], { account: env.stranger.account }), "TooEarly");
    await at(q.activateBy);
    await expectRevert(env.escrow.write.activate([q.bookingId], { account: env.operator.account }), "TooLate");
    await env.escrow.write.refundExpired([q.bookingId], { account: env.stranger.account });
    assert.equal(await credit(env, addr(env.renter)), PRICE); // tiền về renter, không về người gọi
    assert.equal(await credit(env, addr(env.stranger)), 0n);
  });

  it("activate: chỉ operator; startedAt = block timestamp; endAt = +900; không activate hai lần", async () => {
    const env = await fixture();
    const q = await fundBooking(env);
    await expectRevert(env.escrow.write.activate([q.bookingId], { account: env.host.account }), "AccessControlUnauthorizedAccount");
    await expectRevert(env.escrow.write.activate([q.bookingId], { account: env.renter.account }), "AccessControlUnauthorizedAccount");
    await at(q.activateBy - 1n);
    await env.escrow.write.activate([q.bookingId], { account: env.operator.account });
    const b = await env.escrow.read.getBooking([q.bookingId]);
    assert.equal(b.startedAt, q.activateBy - 1n);
    assert.equal(b.endAt, q.activateBy - 1n + DURATION);
    assert.equal(b.state, State.Active);
    await expectRevert(env.escrow.write.activate([q.bookingId], { account: env.operator.account }), "InvalidState");
  });

  it("race cancel/activate: thứ tự trên chain quyết định, bên sau thất bại", async () => {
    const env = await fixture();
    const a = await fundBooking(env);
    await env.escrow.write.cancelBeforeStart([a.bookingId], { account: env.renter.account });
    await expectRevert(env.escrow.write.activate([a.bookingId], { account: env.operator.account }), "InvalidState");
    const b = await fundBooking(env);
    await env.escrow.write.activate([b.bookingId], { account: env.operator.account });
    await expectRevert(env.escrow.write.cancelBeforeStart([b.bookingId], { account: env.renter.account }), "InvalidState");
    await expectRevert(env.escrow.write.refundBeforeStart([b.bookingId], { account: env.host.account }), "InvalidState");
  });
});

describe("settle, dispute, resolve", () => {
  it("accept (kể cả kết thúc sớm): H=P, host 18, treasury 2, renter 0; chỉ renter", async () => {
    const env = await fixture();
    const q = await activated(env);
    await expectRevert(env.escrow.write.accept([q.bookingId], { account: env.host.account }), "NotAuthorized");
    await env.escrow.write.accept([q.bookingId], { account: env.renter.account });
    assert.equal(await stateOf(env, q.bookingId), State.Settled);
    assert.equal(await credit(env, addr(env.host)), parseEther("18"));
    assert.equal(await credit(env, addr(env.treasury)), parseEther("2"));
    assert.equal(await credit(env, addr(env.renter)), 0n);
    assert.equal(await env.escrow.read.totalCredits(), PRICE);
    assert.equal(await env.escrow.read.lockedPrincipal(), 0n);
    assert.equal(await env.escrow.read.machineOccupied([q.machineKey]), false);
    await expectRevert(env.escrow.write.accept([q.bookingId], { account: env.renter.account }), "InvalidState");
  });

  it("claimAfterGrace: biên now >= endAt+grace; ai cũng gọi, tiền vào đúng beneficiary", async () => {
    const env = await fixture();
    const q = await activated(env);
    const end = (await env.escrow.read.getBooking([q.bookingId])).endAt;
    await at(end + GRACE - 1n);
    await expectRevert(env.escrow.write.claimAfterGrace([q.bookingId], { account: env.stranger.account }), "TooEarly");
    await at(end + GRACE);
    await env.escrow.write.claimAfterGrace([q.bookingId], { account: env.stranger.account });
    assert.equal(await credit(env, addr(env.host)), parseEther("18"));
    assert.equal(await credit(env, addr(env.stranger)), 0n);
  });

  it("openDispute: renter hoặc host; biên now < endAt+grace; người lạ không", async () => {
    const env = await fixture();
    const q = await activated(env);
    const end = (await env.escrow.read.getBooking([q.bookingId])).endAt;
    await expectRevert(env.escrow.write.openDispute([q.bookingId], { account: env.stranger.account }), "NotAuthorized");
    await at(end + GRACE);
    await expectRevert(env.escrow.write.openDispute([q.bookingId], { account: env.renter.account }), "TooLate");
    await networkHelpers.mine(); // chốt block tại timestamp đã đặt để quote mới dùng thời gian hiện tại
    const q2 = await activated(env);
    const end2 = (await env.escrow.read.getBooking([q2.bookingId])).endAt;
    await at(end2 + GRACE - 1n);
    await env.escrow.write.openDispute([q2.bookingId], { account: env.host.account });
    const b = await env.escrow.read.getBooking([q2.bookingId]);
    assert.equal(b.state, State.Disputed);
    assert.equal(b.resolutionDeadline, end2 + GRACE - 1n + ARBITRATION);
  });

  it("race dispute/claim: bên đến trước thắng, bên sau InvalidState", async () => {
    const env = await fixture();
    const a = await activated(env);
    await env.escrow.write.openDispute([a.bookingId], { account: env.renter.account });
    const endA = (await env.escrow.read.getBooking([a.bookingId])).endAt;
    await networkHelpers.time.increaseTo(endA + GRACE + 5n);
    await expectRevert(env.escrow.write.claimAfterGrace([a.bookingId], { account: env.host.account }), "InvalidState");
    const b = await activated(env);
    const endB = (await env.escrow.read.getBooking([b.bookingId])).endAt;
    await networkHelpers.time.increaseTo(endB + GRACE + 5n);
    await env.escrow.write.claimAfterGrace([b.bookingId], { account: env.host.account });
    await expectRevert(env.escrow.write.openDispute([b.bookingId], { account: env.renter.account }), "InvalidState");
  });

  it("resolve: chỉ arbitrator; 0<=H<=P; chia đúng; không resolve hai lần; hết hạn thì không", async () => {
    const env = await fixture();
    const q = await activated(env);
    await env.escrow.write.openDispute([q.bookingId], { account: env.renter.account });
    await expectRevert(env.escrow.write.resolve([q.bookingId, PRICE], { account: env.admin.account }), "AccessControlUnauthorizedAccount");
    await expectRevert(env.escrow.write.resolve([q.bookingId, PRICE + 1n], { account: env.arbitrator.account }), "InvalidAmount");
    const H = parseEther("5");
    await env.escrow.write.resolve([q.bookingId, H], { account: env.arbitrator.account });
    assert.equal(await stateOf(env, q.bookingId), State.Resolved);
    assert.equal(await credit(env, addr(env.treasury)), parseEther("0.5"));
    assert.equal(await credit(env, addr(env.host)), parseEther("4.5"));
    assert.equal(await credit(env, addr(env.renter)), parseEther("15"));
    await expectRevert(env.escrow.write.resolve([q.bookingId, H], { account: env.arbitrator.account }), "InvalidState");
    await expectRevert(env.escrow.write.refundUnresolved([q.bookingId], { account: env.stranger.account }), "InvalidState");

    const late = await activated(env);
    await env.escrow.write.openDispute([late.bookingId], { account: env.host.account });
    const dl = (await env.escrow.read.getBooking([late.bookingId])).resolutionDeadline;
    await at(dl);
    await expectRevert(env.escrow.write.resolve([late.bookingId, 0n], { account: env.arbitrator.account }), "TooLate");
  });

  it("resolve H=0 hoàn đủ renter không phí; làm tròn xuống phí: fee=floor(H*B/10000)", async () => {
    const env = await fixture();
    const a = await activated(env);
    await env.escrow.write.openDispute([a.bookingId], { account: env.renter.account });
    await env.escrow.write.resolve([a.bookingId, 0n], { account: env.arbitrator.account });
    assert.equal(await credit(env, addr(env.renter)), PRICE);
    assert.equal(await credit(env, addr(env.treasury)), 0n);

    const b = await activated(env);
    await env.escrow.write.openDispute([b.bookingId], { account: env.renter.account });
    await env.escrow.write.resolve([b.bookingId, 9n], { account: env.arbitrator.account }); // fee = floor(0.9) = 0
    assert.equal(await credit(env, addr(env.treasury)), 0n);
    assert.equal(await credit(env, addr(env.host)), 9n);
    const c = await activated(env);
    await env.escrow.write.openDispute([c.bookingId], { account: env.renter.account });
    await env.escrow.write.resolve([c.bookingId, 19n], { account: env.arbitrator.account }); // fee = floor(1.9) = 1
    assert.equal(await credit(env, addr(env.treasury)), 1n);
    assert.equal(await credit(env, addr(env.host)), 9n + 18n);
  });

  it("refundUnresolved: biên now >= deadline, ai cũng gọi, hoàn đủ renter, host 0", async () => {
    const env = await fixture();
    const q = await activated(env);
    await env.escrow.write.openDispute([q.bookingId], { account: env.host.account });
    const dl = (await env.escrow.read.getBooking([q.bookingId])).resolutionDeadline;
    await at(dl - 1n);
    await expectRevert(env.escrow.write.refundUnresolved([q.bookingId], { account: env.stranger.account }), "TooEarly");
    await at(dl);
    await env.escrow.write.refundUnresolved([q.bookingId], { account: env.stranger.account });
    assert.equal(await stateOf(env, q.bookingId), State.Refunded);
    assert.equal(await credit(env, addr(env.renter)), PRICE);
    assert.equal(await credit(env, addr(env.host)), 0n);
  });
});

describe("withdraw và bảo toàn", () => {
  it("withdrawPCP chuyển đúng số, một lần, qua token hạn chế; admin không rút hộ", async () => {
    const env = await fixture();
    const q = await activated(env);
    await env.escrow.write.accept([q.bookingId], { account: env.renter.account });
    await expectRevert(env.escrow.write.withdrawPCP({ account: env.admin.account }), "NothingToWithdraw");
    await expectRevert(env.escrow.write.withdrawPCP({ account: env.stranger.account }), "NothingToWithdraw");
    await env.escrow.write.withdrawPCP({ account: env.host.account });
    assert.equal(await bal(env, addr(env.host)), parseEther("18"));
    assert.equal(await credit(env, addr(env.host)), 0n);
    await expectRevert(env.escrow.write.withdrawPCP({ account: env.host.account }), "NothingToWithdraw");
    await env.escrow.write.withdrawPCP({ account: env.treasury.account });
    assert.equal(await bal(env, addr(env.treasury)), parseEther("2"));
    assert.equal(await bal(env, env.escrow.address), 0n);
    assert.equal(await env.escrow.read.isSolvent(), true);
    // sau khi rút, ví vẫn không P2P được
    await expectRevert(env.pcp.write.transfer([addr(env.stranger), 1n], { account: env.host.account }), "TransferRestricted");
  });

  it("host trùng treasury: credit cộng dồn, không ghi đè", async () => {
    const env = await fixture();
    await env.escrow.write.setConfig([FEE, addr(env.host)], { account: env.admin.account });
    const q = await activated(env, { treasury: addr(env.host), configVersion: 2n });
    await env.escrow.write.accept([q.bookingId], { account: env.renter.account });
    assert.equal(await credit(env, addr(env.host)), PRICE);
  });

  it("bảo toàn qua nhiều booking với kết cục khác nhau", async () => {
    const env = await fixture();
    await env.pcp.write.faucetMint([addr(env.host)], { account: env.issuer.account }); // host cũng có ví
    let total = 0n;
    const outcomes = ["accept", "cancel", "resolve-7", "resolve-0", "resolve-P", "unresolved"] as const;
    for (const o of outcomes) {
      const q = o === "cancel" ? await fundBooking(env) : await activated(env);
      total += PRICE;
      if (o === "accept") await env.escrow.write.accept([q.bookingId], { account: env.renter.account });
      if (o === "cancel") await env.escrow.write.cancelBeforeStart([q.bookingId], { account: env.renter.account });
      if (o.startsWith("resolve") || o === "unresolved") {
        await env.escrow.write.openDispute([q.bookingId], { account: env.renter.account });
        if (o === "unresolved") {
          const dl = (await env.escrow.read.getBooking([q.bookingId])).resolutionDeadline;
          await networkHelpers.time.increaseTo(dl);
          await env.escrow.write.refundUnresolved([q.bookingId], { account: env.stranger.account });
        } else {
          const h = o === "resolve-7" ? 7n : o === "resolve-0" ? 0n : PRICE;
          await env.escrow.write.resolve([q.bookingId, h], { account: env.arbitrator.account });
        }
      }
      assert.equal(await env.escrow.read.isSolvent(), true);
      assert.equal(await env.escrow.read.lockedPrincipal(), 0n);
    }
    const sum = (await credit(env, addr(env.host))) + (await credit(env, addr(env.treasury))) + (await credit(env, addr(env.renter)));
    assert.equal(sum, total);
    assert.equal(await env.escrow.read.totalCredits(), total);
    for (const w of [env.host, env.treasury, env.renter]) {
      if ((await credit(env, addr(w))) > 0n) await env.escrow.write.withdrawPCP({ account: w.account });
    }
    assert.equal(await bal(env, env.escrow.address), 0n);
    assert.equal(await env.escrow.read.totalCredits(), 0n);
  });
});

const FEE = 1000n;

describe("config và pause", () => {
  it("setConfig: chỉ admin; tăng version, vô hiệu quote cũ; booking đã fund giữ fee snapshot", async () => {
    const env = await fixture();
    await expectRevert(env.escrow.write.setConfig([500n, addr(env.treasury)], { account: env.operator.account }), "AccessControlUnauthorizedAccount");
    await expectRevert(env.escrow.write.setConfig([10_001n, addr(env.treasury)], { account: env.admin.account }), "InvalidConfig");
    await expectRevert(env.escrow.write.setConfig([500n, zeroAddress], { account: env.admin.account }), "InvalidConfig");
    const funded = await activated(env);
    const stale = await makeQuote(env);
    const staleSig = await signQuote(env, stale);
    await env.escrow.write.setConfig([5000n, addr(env.stranger)], { account: env.admin.account });
    assert.equal(await env.escrow.read.configVersion(), 2n);
    await expectRevert(env.escrow.write.fund([stale, staleSig], { account: env.renter.account }), "InvalidQuote");
    await env.escrow.write.accept([funded.bookingId], { account: env.renter.account });
    assert.equal(await credit(env, addr(env.treasury)), parseEther("2")); // fee 10% + treasury cũ
    assert.equal(await credit(env, addr(env.stranger)), 0n);
  });

  it("pause funding/activation chặn phiên mới nhưng mọi đường thoát tiền vẫn dùng được", async () => {
    const env = await fixture();
    const fundedOnly = await fundBooking(env);
    const active = await activated(env);
    const disputed = await activated(env);
    await env.escrow.write.openDispute([disputed.bookingId], { account: env.renter.account });
    const toCancel = await fundBooking(env);
    await env.escrow.write.setFundingPaused([true], { account: env.admin.account });
    await env.escrow.write.setActivationPaused([true], { account: env.admin.account });

    const q = await makeQuote(env);
    await expectRevert(env.escrow.write.fund([q, await signQuote(env, q)], { account: env.renter.account }), "Paused");
    await expectRevert(env.escrow.write.activate([fundedOnly.bookingId], { account: env.operator.account }), "Paused");

    await env.escrow.write.cancelBeforeStart([toCancel.bookingId], { account: env.renter.account });
    await env.escrow.write.refundBeforeStart([fundedOnly.bookingId], { account: env.host.account });
    await env.escrow.write.accept([active.bookingId], { account: env.renter.account });
    await env.escrow.write.resolve([disputed.bookingId, 0n], { account: env.arbitrator.account });
    await env.escrow.write.withdrawPCP({ account: env.renter.account });
    await env.escrow.write.withdrawPCP({ account: env.host.account });
    assert.equal(await env.escrow.read.isSolvent(), true);
  });

  it("không có hàm đổi beneficiary hay rút principal cho admin", async () => {
    const env = await fixture();
    const names: string[] = env.escrow.abi.filter((x) => x.type === "function").map((x) => x.name);
    assert.deepEqual(names.filter((n) => /set|update|change/i.test(n)).sort(), ["setActivationPaused", "setConfig", "setFundingPaused"]);
  });
});

describe("token thử nghiệm: lỗi chuyển, reentrancy, fee-on-transfer", () => {
  async function mockEnv() {
    const base = await deployAll();
    const tok = await viem.deployContract("TestToken");
    const escrow = await viem.deployContract("RentalEscrow", [
      tok.address, addr(base.admin), addr(base.operator), addr(base.arbitrator), addr(base.signer),
      FEE, addr(base.treasury), DURATION, GRACE, ARBITRATION,
    ]);
    const env = { ...base, pcp: tok as unknown as Env["pcp"], escrow: escrow as unknown as Env["escrow"] } as Env;
    await tok.write.mint([addr(base.renter), PRICE * 10n]);
    await tok.write.approve([escrow.address, PRICE * 10n], { account: base.renter.account });
    return { env, tok, escrow };
  }

  it("transfer lỗi khi withdraw: revert và credit còn nguyên, rút lại được sau đó", async () => {
    const { env, tok, escrow } = await mockEnv();
    const q = await makeQuote(env, { token: tok.address });
    await escrow.write.fund([q, await signQuote(env, q)], { account: env.renter.account });
    await escrow.write.cancelBeforeStart([q.bookingId], { account: env.renter.account });
    await tok.write.setFail([true]);
    await assert.rejects(escrow.write.withdrawPCP({ account: env.renter.account }));
    assert.equal(await escrow.read.credit([addr(env.renter)]), PRICE);
    assert.equal(await escrow.read.totalCredits(), PRICE);
    await tok.write.setFail([false]);
    await escrow.write.withdrawPCP({ account: env.renter.account });
    assert.equal(await escrow.read.credit([addr(env.renter)]), 0n);
  });

  it("reentrancy trong lúc withdraw bị chặn; credit không bị rút đôi", async () => {
    const { env, tok, escrow } = await mockEnv();
    const q = await makeQuote(env, { token: tok.address });
    await escrow.write.fund([q, await signQuote(env, q)], { account: env.renter.account });
    await escrow.write.cancelBeforeStart([q.bookingId], { account: env.renter.account });
    const data = (await import("viem")).encodeFunctionData({ abi: escrow.abi, functionName: "withdrawPCP" });
    await tok.write.setHook([escrow.address, data]);
    await assert.rejects(escrow.write.withdrawPCP({ account: env.renter.account }));
    assert.equal(await escrow.read.credit([addr(env.renter)]), PRICE);
    assert.equal(await escrow.read.isSolvent(), true);
  });

  it("fee-on-transfer bị từ chối khi fund (số nhận phải đúng P)", async () => {
    const { env, tok, escrow } = await mockEnv();
    await tok.write.setFee([100n]);
    const q = await makeQuote(env, { token: tok.address });
    await expectRevert(escrow.write.fund([q, await signQuote(env, q)], { account: env.renter.account }), "TransferAmountMismatch");
    assert.equal(await escrow.read.lockedPrincipal(), 0n);
    assert.equal(await escrow.read.machineOccupied([q.machineKey]), false);
  });
});

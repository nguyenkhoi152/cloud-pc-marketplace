/**
 * Tích hợp: quote do MÔ-ĐUN SERVER (packages/shared) dựng và ký phải được RentalEscrow thật chấp nhận,
 * và sự kiện đọc từ receipt phải khớp. Chạy trên mạng Hardhat cục bộ — không phải Fuji.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex, type Hex } from "viem";
import { makeViemOperator } from "../../server/src/chainOperator.ts";
import { makeEscrowReader } from "../../server/src/chainReader.ts";
import { readEscrowEvents, scanBookingEvents } from "../../packages/shared/src/chainEvents.ts";
import { buildQuote, machineKeyHash, quoteDomain, signQuote } from "../../packages/shared/src/quote.ts";
import { ARBITRATION, DURATION, FEE_BPS, GRACE, PRICE, State, expectRevert, networkHelpers, viem } from "./helpers.ts";

const MACHINE_KEY = "m-0123456789ab";

async function setup() {
  const [admin, operator, arbitrator, , issuer, treasury, renter, host] = await viem.getWalletClients();
  assert.ok(admin && operator && arbitrator && issuer && treasury && renter && host);
  const signer = privateKeyToAccount(generatePrivateKey()); // quote signer của server (khoá ngẫu nhiên, chỉ trong test)
  const pcp = await viem.deployContract("PCP", [admin.account.address, issuer.account.address]);
  const escrow = await viem.deployContract("RentalEscrow", [
    pcp.address, admin.account.address, operator.account.address, arbitrator.account.address, signer.address,
    FEE_BPS, treasury.account.address, DURATION, GRACE, ARBITRATION,
  ]);
  await pcp.write.configureEscrowOnce([escrow.address], { account: admin.account });
  await pcp.write.faucetMint([renter.account.address], { account: issuer.account });
  await pcp.write.approve([escrow.address, PRICE * 10n], { account: renter.account });
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const configVersion = await escrow.read.configVersion();
  return { operator, treasury, renter, host, signer, pcp, escrow, publicClient, chainId, configVersion };
}
type Env = Awaited<ReturnType<typeof setup>>;

/** Như server: đầu vào lấy từ "snapshot DB" (bookingId ngẫu nhiên, thời điểm theo block). */
async function serverQuote(env: Env, over: { priceUnits?: string; machineKey?: string } = {}) {
  const now = Number(await networkHelpers.time.latest());
  const q = buildQuote({
    bookingId: keccak256(toHex(`booking-${now}-${Math.random()}`)), machineKey: over.machineKey ?? MACHINE_KEY,
    renter: env.renter.account.address, host: env.host.account.address, token: env.pcp.address, treasury: env.treasury.account.address,
    priceUnits: over.priceUnits ?? PRICE.toString(), feeBps: Number(FEE_BPS), durationSeconds: Number(DURATION),
    fundBy: now + 600, activateBy: now + 900, graceSeconds: Number(GRACE), arbitrationSeconds: Number(ARBITRATION),
    policySha256: "ab".repeat(32), configVersion: env.configVersion.toString(),
  });
  const sig = await signQuote(env.signer, q, quoteDomain(env.chainId, env.escrow.address));
  return { q, sig };
}

describe("quote do server ký ↔ RentalEscrow thật", () => {
  it("fund bằng quote server ký được chấp nhận; sự kiện Funded/Activated đọc từ receipt khớp snapshot", async () => {
    const env = await setup();
    const { q, sig } = await serverQuote(env);
    const tx = await env.escrow.write.fund([q, sig], { account: env.renter.account });
    assert.equal(await env.escrow.read.stateOf([q.bookingId]), State.Funded);

    const read = await readEscrowEvents(env.publicClient, { escrow: env.escrow.address, txHash: tx, minConfirmations: 1 });
    assert.equal(read.status, "ok");
    assert.ok(read.status === "ok");
    const funded = read.events.find((e) => e.event === "Funded");
    assert.ok(funded);
    assert.equal(funded.bookingId, q.bookingId.toLowerCase());
    assert.equal(funded.data.priceUnits, PRICE.toString());
    assert.equal(funded.data.feeBps, FEE_BPS.toString());
    assert.equal(funded.data.renter, env.renter.account.address.toLowerCase());
    assert.equal(funded.data.host, env.host.account.address.toLowerCase());
    assert.equal(funded.data.machineKey, machineKeyHash(MACHINE_KEY));

    const act = await env.escrow.write.activate([q.bookingId], { account: env.operator.account });
    const r2 = await readEscrowEvents(env.publicClient, { escrow: env.escrow.address, txHash: act, minConfirmations: 1 });
    assert.ok(r2.status === "ok");
    const a = r2.events.find((e) => e.event === "Activated");
    assert.ok(a);
    assert.equal(BigInt(a.data.endAt) - BigInt(a.data.startedAt), DURATION);
  });

  it("quote bị sửa sau khi ký, hoặc ký bằng khoá khác, bị contract từ chối", async () => {
    const env = await setup();
    const { q, sig } = await serverQuote(env);
    await expectRevert(env.escrow.write.fund([{ ...q, priceUnits: q.priceUnits - 1n }, sig], { account: env.renter.account }), "BadSignature");
    const other = privateKeyToAccount(generatePrivateKey());
    const forged = await signQuote(other, q, quoteDomain(env.chainId, env.escrow.address));
    await expectRevert(env.escrow.write.fund([q, forged], { account: env.renter.account }), "BadSignature");
    const wrongDomain = await signQuote(env.signer, q, quoteDomain(env.chainId + 1, env.escrow.address));
    await expectRevert(env.escrow.write.fund([q, wrongDomain], { account: env.renter.account }), "BadSignature");
    assert.equal(await env.escrow.read.stateOf([q.bookingId]), State.None);
  });

  it("readEscrowEvents: không thấy tx, chưa đủ confirmation, và bỏ qua log của contract khác", async () => {
    const env = await setup();
    const { q, sig } = await serverQuote(env);
    const tx = await env.escrow.write.fund([q, sig], { account: env.renter.account });
    const ghost = keccak256(toHex("khong-co-tx")) as Hex;
    assert.equal((await readEscrowEvents(env.publicClient, { escrow: env.escrow.address, txHash: ghost, minConfirmations: 1 })).status, "not_found");
    assert.equal((await readEscrowEvents(env.publicClient, { escrow: env.escrow.address, txHash: tx, minConfirmations: 5 })).status, "pending");
    await networkHelpers.mine(5);
    assert.equal((await readEscrowEvents(env.publicClient, { escrow: env.escrow.address, txHash: tx, minConfirmations: 5 })).status, "ok");
    // Cùng tx nhưng hỏi theo địa chỉ escrow khác → không có sự kiện nào được chấp nhận
    const none = await readEscrowEvents(env.publicClient, { escrow: env.pcp.address, txHash: tx, minConfirmations: 1 });
    assert.ok(none.status === "ok");
    assert.equal(none.events.filter((e) => e.event === "Funded").length, 0);
  });

  it("scanBookingEvents: quét theo booking, đúng thứ tự, chỉ block đã đủ confirmation, không lẫn booking khác", async () => {
    const env = await setup();
    const a = await serverQuote(env);
    const b = await serverQuote(env, { machineKey: "m-other-machine-02" });
    const fromBlock = await env.publicClient.getBlockNumber();
    await env.escrow.write.fund([a.q, a.sig], { account: env.renter.account });
    await env.escrow.write.fund([b.q, b.sig], { account: env.renter.account });
    await env.escrow.write.activate([a.q.bookingId], { account: env.operator.account });
    await networkHelpers.mine(3);
    const r = await scanBookingEvents(env.publicClient, { escrow: env.escrow.address, bookingId: a.q.bookingId, fromBlock, minConfirmations: 1 });
    assert.deepEqual(r.events.map((e) => e.event), ["Funded", "Activated"]);
    assert.ok(r.events.every((e) => e.bookingId === a.q.bookingId.toLowerCase()));
    // Yêu cầu nhiều confirmation hơn số block đã có → không trả gì (chưa an toàn)
    const none = await scanBookingEvents(env.publicClient, { escrow: env.escrow.address, bookingId: a.q.bookingId, fromBlock, minConfirmations: 50 });
    assert.equal(none.events.length, 0);
  });

  it("operator thật (viem) kích hoạt đúng một lần; reader đọc stateOf/machineOccupied; kích hoạt lần hai và sai vai trò bị contract từ chối", async () => {
    const env = await setup();
    const { q, sig } = await serverQuote(env);
    const reader = makeEscrowReader(env.publicClient as never, env.escrow.address);
    assert.equal(await reader.stateOf(q.bookingId), 0);
    assert.equal(await reader.machineOccupied(machineKeyHash(MACHINE_KEY)), false);
    await env.escrow.write.fund([q, sig], { account: env.renter.account });
    assert.equal(await reader.stateOf(q.bookingId), 1);
    assert.equal(await reader.machineOccupied(machineKeyHash(MACHINE_KEY)), true);

    const wallets = await viem.getWalletClients();
    const operator = makeViemOperator(env.operator as never, env.escrow.address);
    const tx = await operator.activate(q.bookingId);
    const r = await readEscrowEvents(env.publicClient, { escrow: env.escrow.address, txHash: tx, minConfirmations: 1 });
    assert.ok(r.status === "ok" && r.events.some((e) => e.event === "Activated"));
    assert.equal(await reader.stateOf(q.bookingId), 2);
    await expectRevert(operator.activate(q.bookingId), "InvalidState"); // không kích hoạt hai lần
    const stranger = makeViemOperator(wallets[9] as never, env.escrow.address);
    const other = await serverQuote(env, { machineKey: "m-another-machine-3" });
    await env.escrow.write.fund([other.q, other.sig], { account: env.renter.account });
    await expectRevert(stranger.activate(other.q.bookingId), /AccessControl|NotAuthorized|unauthorized/i); // sai vai trò
  });
});

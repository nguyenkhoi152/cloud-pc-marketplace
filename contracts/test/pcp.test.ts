import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, parseEther, toHex, zeroAddress } from "viem";
import { deployAll, expectRevert, networkHelpers, viem, PRICE } from "./helpers.ts";

const fixture = () => networkHelpers.loadFixture(deployAll);

describe("PCP", () => {
  it("18 decimals, cap 1.000.000, không có permit/burn/mint tự do", async () => {
    const { pcp } = await fixture();
    assert.equal(await pcp.read.decimals(), 18);
    assert.equal(await pcp.read.SUPPLY_CAP(), parseEther("1000000"));
    const names: string[] = pcp.abi.filter((x) => x.type === "function").map((x) => x.name);
    for (const banned of ["permit", "burn", "burnFrom", "mint", "transferWithAuthorization"]) {
      assert.ok(!names.includes(banned), `không được có ${banned}`);
    }
  });

  it("configureEscrowOnce: chỉ admin, nonzero, phải là contract, đúng một lần", async () => {
    const e = await fixture();
    const { admin, issuer, stranger, escrow } = e;
    // deployAll đã cấu hình escrow; dựng PCP mới chưa cấu hình để kiểm tra từng bước.
    const pcp = await viem.deployContract("PCP", [admin.account.address, issuer.account.address]);
    await expectRevert(pcp.write.configureEscrowOnce([escrow.address], { account: stranger.account }), "AccessControlUnauthorizedAccount");
    await expectRevert(pcp.write.configureEscrowOnce([zeroAddress], { account: admin.account }), "InvalidEscrow");
    await expectRevert(pcp.write.configureEscrowOnce([stranger.account.address], { account: admin.account }), "InvalidEscrow"); // EOA
    await expectRevert(pcp.write.faucetMint([stranger.account.address], { account: issuer.account }), "EscrowNotConfigured");
    await pcp.write.configureEscrowOnce([escrow.address], { account: admin.account });
    assert.equal((await pcp.read.escrow()).toLowerCase(), escrow.address.toLowerCase());
    await expectRevert(pcp.write.configureEscrowOnce([escrow.address], { account: admin.account }), "EscrowAlreadyConfigured");
  });

  it("faucet: chỉ issuer, mỗi ví một lần, không mint cho escrow/zero", async () => {
    const { issuer, stranger, renter, pcp, escrow } = await fixture();
    await expectRevert(pcp.write.faucetMint([renter.account.address], { account: stranger.account }), "AccessControlUnauthorizedAccount");
    await pcp.write.faucetMint([renter.account.address], { account: issuer.account });
    assert.equal(await pcp.read.balanceOf([renter.account.address]), parseEther("1000"));
    await expectRevert(pcp.write.faucetMint([renter.account.address], { account: issuer.account }), "FaucetAlreadyClaimed");
    await expectRevert(pcp.write.faucetMint([escrow.address], { account: issuer.account }), "InvalidRecipient");
    await expectRevert(pcp.write.faucetMint([zeroAddress], { account: issuer.account }), "InvalidRecipient");
  });

  it("supply cap được token cưỡng chế: 1000 ví nhận hết cap, ví thứ 1001 bị từ chối", async () => {
    const { issuer, pcp } = await fixture();
    for (let i = 0; i < 1000; i++) {
      const to = ("0x" + keccak256(toHex(`wallet-${i}`)).slice(2, 42)) as `0x${string}`;
      await pcp.write.faucetMint([to], { account: issuer.account });
    }
    assert.equal(await pcp.read.totalSupply(), parseEther("1000000"));
    const extra = ("0x" + keccak256(toHex("wallet-extra")).slice(2, 42)) as `0x${string}`;
    await expectRevert(pcp.write.faucetMint([extra], { account: issuer.account }), "CapExceeded");
  });

  it("chặn P2P, nạp tay vào escrow, spender khác dù có allowance, burn", async () => {
    const { renter, renter2, stranger, escrow, pcp, issuer } = await fixture();
    await pcp.write.faucetMint([renter.account.address], { account: issuer.account });
    const a = renter.account.address;
    // P2P
    await expectRevert(pcp.write.transfer([renter2.account.address, 1n], { account: renter.account }), "TransferRestricted");
    // nạp tay vào escrow (caller không phải escrow)
    await expectRevert(pcp.write.transfer([escrow.address, 1n], { account: renter.account }), "TransferRestricted");
    // spender khác có allowance
    await pcp.write.approve([stranger.account.address, PRICE], { account: renter.account });
    await expectRevert(pcp.write.transferFrom([a, renter2.account.address, 1n], { account: stranger.account }), "TransferRestricted");
    await expectRevert(pcp.write.transferFrom([a, escrow.address, 1n], { account: stranger.account }), "TransferRestricted");
    // burn / chuyển tới zero
    await expectRevert(pcp.write.transfer([zeroAddress, 1n], { account: renter.account }), "ERC20InvalidReceiver");
    assert.equal(await pcp.read.balanceOf([a]), parseEther("1000"));
  });
});

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// CHỈ DÙNG CHO TEST. Không bao giờ deploy lên mạng thật.

/// Token thường cho phép mint tự do, có thể bật lỗi khi chuyển từ escrow và hook reentrancy.
contract TestToken is ERC20 {
    address public hookTarget;
    bytes public hookData;
    bool public failTransfers;
    uint256 public feeBpsOnTransfer; // mô phỏng fee-on-transfer

    constructor() ERC20("Test", "TST") {}

    function mint(address to, uint256 v) external { _mint(to, v); }
    function setFail(bool v) external { failTransfers = v; }
    function setFee(uint256 bps) external { feeBpsOnTransfer = bps; }
    function setHook(address target, bytes calldata data) external { hookTarget = target; hookData = data; }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && failTransfers && to != address(this)) revert("transfer failed");
        uint256 fee = (from != address(0) && to != address(0) && feeBpsOnTransfer > 0) ? (value * feeBpsOnTransfer) / 10_000 : 0;
        super._update(from, to, value - fee);
        if (fee > 0) super._update(from, address(0xdead), fee);
        // Hook mô phỏng token có callback: gọi lại escrow trong lúc chuyển.
        if (hookTarget != address(0) && from != address(0)) {
            address t = hookTarget;
            hookTarget = address(0);
            (bool ok, bytes memory ret) = t.call(hookData);
            if (!ok) {
                assembly { revert(add(ret, 32), mload(ret)) }
            }
        }
    }
}

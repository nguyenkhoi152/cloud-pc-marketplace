// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PC Point (PCP) — token thử, KHÔNG có giá trị tiền thật.
/// @notice ERC-20 hạn chế chuyển: chỉ escrow đã cấu hình được là caller của transfer/transferFrom,
///         và một đầu của chuyển khoản phải là escrow. Không permit, không burn, không upgrade.
contract PCP is ERC20, AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    uint256 public constant SUPPLY_CAP = 1_000_000 ether;
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;

    address public escrow;
    mapping(address => bool) public faucetClaimed;

    event TokenConfigured(address indexed escrow);
    event Minted(address indexed to, uint256 amount);

    error EscrowAlreadyConfigured();
    error EscrowNotConfigured();
    error InvalidEscrow();
    error InvalidRecipient();
    error FaucetAlreadyClaimed();
    error CapExceeded();
    error TransferRestricted();

    constructor(address admin, address issuer) ERC20("PC Point (test)", "PCP") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, issuer);
    }

    /// @notice Cấu hình escrow đúng một lần: nonzero và phải là contract.
    function configureEscrowOnce(address escrow_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (escrow != address(0)) revert EscrowAlreadyConfigured();
        if (escrow_ == address(0) || escrow_.code.length == 0) revert InvalidEscrow();
        escrow = escrow_;
        emit TokenConfigured(escrow_);
    }

    /// @notice Faucet demo: 1.000 PCP cho mỗi ví một lần; cap ở chính token.
    function faucetMint(address to) external onlyRole(ISSUER_ROLE) {
        if (escrow == address(0)) revert EscrowNotConfigured();
        if (to == address(0) || to == escrow) revert InvalidRecipient();
        if (faucetClaimed[to]) revert FaucetAlreadyClaimed();
        if (totalSupply() + FAUCET_AMOUNT > SUPPLY_CAP) revert CapExceeded();
        faucetClaimed[to] = true;
        _mint(to, FAUCET_AMOUNT);
        emit Minted(to, FAUCET_AMOUNT);
    }

    /// @dev Điểm cập nhật số dư chung cho transfer/transferFrom/mint/burn.
    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0)) {
            // mint: chỉ có thể đến từ faucetMint
            super._update(from, to, value);
            return;
        }
        // Không burn; chuyển thường chỉ khi caller là escrow và một đầu là escrow.
        address e = escrow;
        if (to == address(0) || e == address(0) || msg.sender != e || (to != e && from != e)) {
            revert TransferRestricted();
        }
        super._update(from, to, value);
    }
}

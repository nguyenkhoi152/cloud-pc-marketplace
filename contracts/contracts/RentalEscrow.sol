// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title RentalEscrow — giữ PCP thử cho thuê máy, pull-payment, không upgrade.
/// @notice Theo docs/CONTRACT_SPEC.md. Không sweep, không đổi beneficiary, không rút principal bởi admin.
contract RentalEscrow is AccessControl, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");
    bytes32 public constant QUOTE_SIGNER_ROLE = keccak256("QUOTE_SIGNER_ROLE");

    uint256 public constant QUOTE_TTL = 600;
    uint256 public constant ACTIVATE_WINDOW = 300;
    uint256 public constant MAX_FEE_BPS = 10_000;

    enum State { None, Funded, Active, Disputed, Settled, Resolved, Refunded }

    struct Quote {
        bytes32 bookingId;
        bytes32 machineKey;
        address renter;
        address host;
        address token;
        uint256 priceUnits;
        uint256 feeBps;
        address treasury;
        uint256 durationSeconds;
        uint256 issuedAt;
        uint256 fundBy;
        uint256 activateBy;
        uint256 graceSeconds;
        uint256 arbitrationSeconds;
        bytes32 policyHash;
        uint256 configVersion;
    }

    struct Booking {
        State state;
        address renter;
        address host;
        address treasury;
        uint256 priceUnits;
        uint256 feeBps;
        bytes32 machineKey;
        uint256 activateBy;
        uint256 graceSeconds;
        uint256 arbitrationSeconds;
        uint256 durationSeconds;
        uint256 startedAt;
        uint256 endAt;
        uint256 resolutionDeadline;
    }

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(bytes32 bookingId,bytes32 machineKey,address renter,address host,address token,uint256 priceUnits,uint256 feeBps,address treasury,uint256 durationSeconds,uint256 issuedAt,uint256 fundBy,uint256 activateBy,uint256 graceSeconds,uint256 arbitrationSeconds,bytes32 policyHash,uint256 configVersion)"
    );

    IERC20 public immutable acceptedToken;
    uint256 public immutable durationSeconds;
    uint256 public immutable graceSeconds;
    uint256 public immutable arbitrationSeconds;

    uint256 public feeBps;
    address public treasury;
    uint256 public configVersion;
    bool public fundingPaused;
    bool public activationPaused;

    mapping(bytes32 => Booking) private _bookings;
    mapping(bytes32 => bool) public machineOccupied;
    mapping(address => uint256) public credit;
    uint256 public lockedPrincipal;
    uint256 public totalCredits;

    event Funded(
        bytes32 indexed bookingId, address indexed renter, address indexed host, bytes32 machineKey,
        address token, uint256 priceUnits, uint256 feeBps, address treasury, uint256 fundBy, uint256 activateBy
    );
    event Activated(bytes32 indexed bookingId, uint256 startedAt, uint256 endAt);
    event Refunded(bytes32 indexed bookingId, address indexed renter, uint256 amount);
    event DisputeOpened(bytes32 indexed bookingId, address indexed by, uint256 resolutionDeadline);
    event Resolved(bytes32 indexed bookingId, uint256 hostGross, uint256 renterRefund);
    event Settled(bytes32 indexed bookingId, uint256 hostGross);
    event CreditWithdrawn(address indexed account, uint256 amount);
    event ConfigUpdated(uint256 feeBps, address treasury, uint256 configVersion);
    event FundingPausedSet(bool paused);
    event ActivationPausedSet(bool paused);

    error InvalidConfig();
    error Paused();
    error NotAuthorized();
    error InvalidState();
    error InvalidQuote();
    error BadSignature();
    error MachineOccupied();
    error BookingUsed();
    error TooEarly();
    error TooLate();
    error InvalidAmount();
    error TransferAmountMismatch();
    error NothingToWithdraw();

    constructor(
        IERC20 token_, address admin, address operator, address arbitrator, address quoteSigner,
        uint256 feeBps_, address treasury_, uint256 durationSeconds_, uint256 graceSeconds_, uint256 arbitrationSeconds_
    ) EIP712("CloudPCRentalEscrow", "1") {
        if (address(token_) == address(0) || admin == address(0) || treasury_ == address(0)) revert InvalidConfig();
        if (feeBps_ > MAX_FEE_BPS || durationSeconds_ == 0 || graceSeconds_ == 0 || arbitrationSeconds_ == 0) revert InvalidConfig();
        acceptedToken = token_;
        durationSeconds = durationSeconds_;
        graceSeconds = graceSeconds_;
        arbitrationSeconds = arbitrationSeconds_;
        feeBps = feeBps_;
        treasury = treasury_;
        configVersion = 1;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (operator != address(0)) _grantRole(OPERATOR_ROLE, operator);
        if (arbitrator != address(0)) _grantRole(ARBITRATOR_ROLE, arbitrator);
        if (quoteSigner != address(0)) _grantRole(QUOTE_SIGNER_ROLE, quoteSigner);
    }

    // ------------------------------------------------------------------ views

    function getBooking(bytes32 id) external view returns (Booking memory) {
        return _bookings[id];
    }

    function stateOf(bytes32 id) external view returns (State) {
        return _bookings[id].state;
    }

    /// @notice Số dư token của escrow luôn >= principal đang khoá + credit chưa rút.
    function isSolvent() external view returns (bool) {
        return acceptedToken.balanceOf(address(this)) >= lockedPrincipal + totalCredits;
    }

    function hashQuote(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q)));
    }

    // ------------------------------------------------------------------ admin (chỉ ảnh hưởng booking tương lai)

    function setConfig(uint256 feeBps_, address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feeBps_ > MAX_FEE_BPS || treasury_ == address(0)) revert InvalidConfig();
        feeBps = feeBps_;
        treasury = treasury_;
        configVersion += 1; // vô hiệu hoá quote chưa fund
        emit ConfigUpdated(feeBps_, treasury_, configVersion);
    }

    function setFundingPaused(bool paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        fundingPaused = paused;
        emit FundingPausedSet(paused);
    }

    function setActivationPaused(bool paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        activationPaused = paused;
        emit ActivationPausedSet(paused);
    }

    // ------------------------------------------------------------------ fund

    function fund(Quote calldata q, bytes calldata signature) external nonReentrant {
        if (fundingPaused) revert Paused();
        if (msg.sender != q.renter || q.renter == q.host || q.host == address(0)) revert InvalidQuote();
        if (q.bookingId == bytes32(0) || q.machineKey == bytes32(0)) revert InvalidQuote();
        if (q.token != address(acceptedToken)) revert InvalidQuote();
        if (q.priceUnits == 0) revert InvalidAmount();
        if (q.feeBps != feeBps || q.treasury != treasury || q.configVersion != configVersion) revert InvalidQuote();
        if (q.durationSeconds != durationSeconds || q.graceSeconds != graceSeconds || q.arbitrationSeconds != arbitrationSeconds) {
            revert InvalidQuote();
        }
        if (q.issuedAt > block.timestamp) revert InvalidQuote();
        if (q.fundBy != q.issuedAt + QUOTE_TTL || q.activateBy != q.fundBy + ACTIVATE_WINDOW) revert InvalidQuote();
        if (block.timestamp >= q.fundBy) revert TooLate();
        if (_bookings[q.bookingId].state != State.None) revert BookingUsed();
        if (machineOccupied[q.machineKey]) revert MachineOccupied();

        address signer = ECDSA.recover(hashQuote(q), signature);
        if (!hasRole(QUOTE_SIGNER_ROLE, signer)) revert BadSignature();

        Booking storage b = _bookings[q.bookingId];
        b.state = State.Funded;
        b.renter = q.renter;
        b.host = q.host;
        b.treasury = q.treasury;
        b.priceUnits = q.priceUnits;
        b.feeBps = q.feeBps;
        b.machineKey = q.machineKey;
        b.activateBy = q.activateBy;
        b.graceSeconds = q.graceSeconds;
        b.arbitrationSeconds = q.arbitrationSeconds;
        b.durationSeconds = q.durationSeconds;
        machineOccupied[q.machineKey] = true;
        lockedPrincipal += q.priceUnits;

        // Token pull cùng transaction; kiểm tra số nhận chính xác (không hỗ trợ fee-on-transfer).
        uint256 before = acceptedToken.balanceOf(address(this));
        acceptedToken.safeTransferFrom(q.renter, address(this), q.priceUnits);
        if (acceptedToken.balanceOf(address(this)) - before != q.priceUnits) revert TransferAmountMismatch();

        emit Funded(q.bookingId, q.renter, q.host, q.machineKey, q.token, q.priceUnits, q.feeBps, q.treasury, q.fundBy, q.activateBy);
    }

    // ------------------------------------------------------------------ trước khi bắt đầu

    function cancelBeforeStart(bytes32 id) external {
        Booking storage b = _funded(id);
        if (msg.sender != b.renter) revert NotAuthorized();
        _finish(id, b, State.Refunded, 0);
    }

    function refundBeforeStart(bytes32 id) external {
        Booking storage b = _funded(id);
        if (msg.sender != b.host && !hasRole(OPERATOR_ROLE, msg.sender)) revert NotAuthorized();
        _finish(id, b, State.Refunded, 0);
    }

    function refundExpired(bytes32 id) external {
        Booking storage b = _funded(id);
        if (block.timestamp < b.activateBy) revert TooEarly();
        _finish(id, b, State.Refunded, 0);
    }

    function activate(bytes32 id) external onlyRole(OPERATOR_ROLE) {
        if (activationPaused) revert Paused();
        Booking storage b = _funded(id);
        if (block.timestamp >= b.activateBy) revert TooLate();
        b.state = State.Active;
        b.startedAt = block.timestamp;
        b.endAt = block.timestamp + b.durationSeconds;
        emit Activated(id, b.startedAt, b.endAt);
    }

    // ------------------------------------------------------------------ trong/sau phiên

    function accept(bytes32 id) external {
        Booking storage b = _bookings[id];
        if (b.state != State.Active) revert InvalidState();
        if (msg.sender != b.renter) revert NotAuthorized();
        _finish(id, b, State.Settled, b.priceUnits);
    }

    function openDispute(bytes32 id) external {
        Booking storage b = _bookings[id];
        if (b.state != State.Active) revert InvalidState();
        if (msg.sender != b.renter && msg.sender != b.host) revert NotAuthorized();
        if (block.timestamp >= b.endAt + b.graceSeconds) revert TooLate();
        b.state = State.Disputed;
        b.resolutionDeadline = block.timestamp + b.arbitrationSeconds;
        emit DisputeOpened(id, msg.sender, b.resolutionDeadline);
    }

    function claimAfterGrace(bytes32 id) external {
        Booking storage b = _bookings[id];
        if (b.state != State.Active) revert InvalidState();
        if (block.timestamp < b.endAt + b.graceSeconds) revert TooEarly();
        _finish(id, b, State.Settled, b.priceUnits);
    }

    function resolve(bytes32 id, uint256 hostGross) external onlyRole(ARBITRATOR_ROLE) {
        Booking storage b = _bookings[id];
        if (b.state != State.Disputed) revert InvalidState();
        if (block.timestamp >= b.resolutionDeadline) revert TooLate();
        if (hostGross > b.priceUnits) revert InvalidAmount();
        _finish(id, b, State.Resolved, hostGross);
    }

    function refundUnresolved(bytes32 id) external {
        Booking storage b = _bookings[id];
        if (b.state != State.Disputed) revert InvalidState();
        if (block.timestamp < b.resolutionDeadline) revert TooEarly();
        _finish(id, b, State.Refunded, 0);
    }

    // ------------------------------------------------------------------ rút (pull payment)

    function withdrawPCP() external nonReentrant {
        uint256 amount = credit[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credit[msg.sender] = 0;
        totalCredits -= amount;
        acceptedToken.safeTransfer(msg.sender, amount); // lỗi -> revert -> credit được khôi phục
        emit CreditWithdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------ nội bộ

    function _funded(bytes32 id) private view returns (Booking storage b) {
        b = _bookings[id];
        if (b.state != State.Funded) revert InvalidState();
    }

    /// @dev Chuyển sang trạng thái terminal, ghi có (không chuyển token), gỡ occupancy đúng một lần.
    function _finish(bytes32 id, Booking storage b, State terminal, uint256 hostGross) private {
        uint256 p = b.priceUnits;
        uint256 fee = (hostGross * b.feeBps) / 10_000;
        b.state = terminal;
        machineOccupied[b.machineKey] = false;
        lockedPrincipal -= p;
        totalCredits += p;
        if (hostGross > 0) {
            credit[b.host] += hostGross - fee;
            if (fee > 0) credit[b.treasury] += fee;
        }
        if (p > hostGross) credit[b.renter] += p - hostGross;

        if (terminal == State.Refunded) emit Refunded(id, b.renter, p);
        else if (terminal == State.Resolved) emit Resolved(id, hostGross, p - hostGross);
        else emit Settled(id, hostGross);
    }
}

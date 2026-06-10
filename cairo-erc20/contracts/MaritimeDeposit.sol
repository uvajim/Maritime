// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IMDT {
    function mint(address to, uint256 amount) external;
    function adminBurn(address from, uint256 amount) external;
    function frozen(address account) external view returns (bool);
}

/// @title Maritime Deposit Gateway
/// @notice Accepts USDC or USDT deposits from users, routes funds to the vault,
///         and instructs the MDTToken contract to mint MDT 1:1 to the depositor.
///         Withdrawals burn MDT and pull stablecoins from the vault back to the user.
///
/// Vault setup (one-time, done by vault owner):
///   usdc.approve(gatewayAddress, type(uint256).max)
///   usdt.approve(gatewayAddress, type(uint256).max)
///
/// Role setup (one-time, after deploy):
///   mdtToken.grantRole(MINTER_ROLE, gatewayAddress)
///   mdtToken.grantRole(BURNER_ROLE, gatewayAddress)
contract MaritimeDeposit is AccessControl {

    // ─── Contract state ───────────────────────────────────────────────────────

    address public immutable owner;
    address public immutable vault;      // holds stablecoins, approves this contract
    address public immutable mdtToken;   // MDTToken ERC-20 contract
    address public immutable USDC;
    address public immutable USDT;

    uint256 public minDepositUSDC;
    uint256 public minDepositUSDT;

    // ─── Events / errors ──────────────────────────────────────────────────────

    event Deposited(
        address indexed user,
        address indexed token,
        uint256 amount,
        bytes32 indexed userId,
        uint256 timestamp
    );

    event Withdrawn(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 timestamp
    );

    event Rescued(address indexed token, uint256 amount);

    error UnsupportedToken(address token);
    error BelowMinimum(uint256 sent, uint256 minimum);
    error InsufficientVaultBalance(address token, uint256 requested, uint256 available);
    error AccountFrozen(address account);
    error TransferFailed();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _owner,
        address _vault,
        address _mdtToken,
        address _usdc,
        address _usdt,
        uint256 _minUSDC,
        uint256 _minUSDT
    ) {
        require(_owner    != address(0), "Zero owner");
        require(_vault    != address(0), "Zero vault");
        require(_mdtToken != address(0), "Zero MDT token");
        require(_usdc     != address(0), "Zero USDC");
        require(_usdt     != address(0), "Zero USDT");

        owner          = _owner;
        vault          = _vault;
        mdtToken       = _mdtToken;
        USDC           = _usdc;
        USDT           = _usdt;
        minDepositUSDC = _minUSDC;
        minDepositUSDT = _minUSDT;

        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
    }

    // ─── Deposit ──────────────────────────────────────────────────────────────

    /// @notice Deposit USDC or USDT.
    ///         Step 1 – transfers `amount` from msg.sender directly to the vault.
    ///         Step 2 – instructs MDTToken to mint `amount` MDT to msg.sender.
    ///         Caller pays all gas.
    function deposit(address token, uint256 amount, bytes32 userId) external {
        if (IMDT(mdtToken).frozen(msg.sender)) revert AccountFrozen(msg.sender);

        uint256 minAmount;
        if      (token == USDC) { minAmount = minDepositUSDC; }
        else if (token == USDT) { minAmount = minDepositUSDT; }
        else                    { revert UnsupportedToken(token); }

        if (amount < minAmount) revert BelowMinimum(amount, minAmount);

        // Step 1: user → vault directly
        bool ok = IERC20(token).transferFrom(msg.sender, vault, amount);
        if (!ok) revert TransferFailed();

        // Step 2: mint MDT 1:1 to caller (requires MINTER_ROLE on MDTToken)
        IMDT(mdtToken).mint(msg.sender, amount);

        emit Deposited(msg.sender, token, amount, userId, block.timestamp);
    }

    // ─── Withdrawal ───────────────────────────────────────────────────────────

    /// @notice Withdraw stablecoins by returning MDT 1:1.
    ///         Burns `amount` MDT from msg.sender (requires BURNER_ROLE on MDTToken),
    ///         then pulls `amount` of `token` from the vault and sends it to msg.sender.
    ///         The vault must have pre-approved this contract.
    ///         Caller pays all gas.
    function withdraw(address token, uint256 amount) external {
        if (token != USDC && token != USDT) revert UnsupportedToken(token);

        uint256 available = IERC20(token).balanceOf(vault);
        if (available < amount) revert InsufficientVaultBalance(token, amount, available);

        // Burn MDT from caller (requires BURNER_ROLE on MDTToken)
        IMDT(mdtToken).adminBurn(msg.sender, amount);

        // Pull stablecoins from vault and send to caller
        bool ok = IERC20(token).transferFrom(vault, msg.sender, amount);
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, token, amount, block.timestamp);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Stablecoins available in the vault for withdrawals.
    function vaultBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(vault);
    }

    /// @notice Token addresses accepted by this gateway.
    function supportedTokens() external view returns (address usdc, address usdt) {
        return (USDC, USDT);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setMinDeposit(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if      (token == USDC) { minDepositUSDC = amount; }
        else if (token == USDT) { minDepositUSDT = amount; }
        else                    { revert UnsupportedToken(token); }
    }

    /// @notice Recover ERC-20 tokens accidentally sent to this contract (not vault funds).
    function rescue(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bool ok = IERC20(token).transfer(owner, amount);
        if (!ok) revert TransferFailed();
        emit Rescued(token, amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Maritime Deposit Token (MDT)
/// @notice Pure ERC-20 token with permissioned minting and burning.
///
///   MINTER_ROLE        — may call mint() and mintTradePayout()
///   BURNER_ROLE        — may call adminBurn()
///   DEFAULT_ADMIN_ROLE — may freeze/unfreeze accounts and rescue tokens
///
/// Granted at deploy-time:
///   DepositGateway → MINTER_ROLE + BURNER_ROLE  (deposit mints, withdraw burns)
///   TradeExecutor  → MINTER_ROLE + BURNER_ROLE  (buy burns, sell mints)
contract MDTToken is AccessControl {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    // ─── ERC-20 state ────────────────────────────────────────────────────────

    string  public constant name     = "Maritime Deposit Token";
    string  public constant symbol   = "MDT";
    uint8   public constant decimals = 6;   // matches USDC / USDT

    uint256 public totalSupply;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool)                        public frozen;

    // ─── Events ──────────────────────────────────────────────────────────────

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Frozen(address indexed account);
    event Unfrozen(address indexed account);
    event Rescued(address indexed token, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error InsufficientBalance();
    error InsufficientAllowance();
    error AccountFrozen(address account);
    error TransferFailed();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _admin) {
        require(_admin != address(0), "Zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MINTER_ROLE, _admin);
        _grantRole(BURNER_ROLE, _admin);
    }

    // ─── ERC-20 ──────────────────────────────────────────────────────────────

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    // ─── Permissioned mint / burn ─────────────────────────────────────────────

    /// @notice Mint MDT. Called by DepositGateway when a user deposits stablecoins.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Mint MDT as a trade payout (equity sell). No vault backing check —
    ///         the payout is backed by burned equity shares, not stablecoins.
    function mintTradePayout(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Burn MDT from any address without requiring token approval.
    ///         Called by DepositGateway on withdrawal and TradeExecutor on buy.
    function adminBurn(address from, uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(from, amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function freeze(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        frozen[account] = true;
        emit Frozen(account);
    }

    function unfreeze(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        frozen[account] = false;
        emit Unfrozen(account);
    }

    /// @notice Recover ERC-20 tokens accidentally sent to this contract.
    function rescue(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        (bool ok,) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", msg.sender, amount)
        );
        if (!ok) revert TransferFailed();
        emit Rescued(token, amount);
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _transfer(address from, address to, uint256 amount) internal {
        if (frozen[from]) revert AccountFrozen(from);
        if (frozen[to])   revert AccountFrozen(to);
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        if (frozen[to]) revert AccountFrozen(to);
        totalSupply   += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        totalSupply     -= amount;
        emit Transfer(from, address(0), amount);
    }
}

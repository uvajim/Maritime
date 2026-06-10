// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./ShareToken.sol";

/// @title EquityVault
/// @notice Factory and registry for per-ticker ERC-20 ShareTokens.
///         On first mint of a new ticker a ShareToken ERC-20 is deployed and
///         stored in tokenForTicker.  Subsequent mints and burns route through
///         that contract.
///
///         MINTER_ROLE         — may call mint / batchMint
///         DEFAULT_ADMIN_ROLE  — may call burnSharesForMDT, freeze, unfreeze, seize,
///                               pause, unpause
contract EquityVault is AccessControl, Pausable {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ─── Registry ─────────────────────────────────────────────────────────────

    mapping(string  => address) public tokenForTicker;   // "AAPL" → ShareToken
    string[]                    public allTickers;        // enumerable list of deployed tickers
    mapping(address => bool)    public frozen;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TickerDeployed(string ticker, address token);
    event SharesMinted(address indexed to,   string ticker, uint256 amount, address token);
    event SharesBurned(address indexed from, string ticker, uint256 amount, address token);
    event AccountFrozen(address indexed account);
    event AccountUnfrozen(address indexed account);
    event SharesSeized(address indexed from, address indexed to, string ticker, uint256 amount, address token);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error TickerEmpty();
    error TickerNotDeployed(string ticker);
    error ArrayLengthMismatch();
    error AccountIsFrozen(address account);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MINTER_ROLE, _admin);
    }

    // ─── Mint ─────────────────────────────────────────────────────────────────

    /// @notice Mint `amount` shares of `ticker` to `to`.
    ///         Deploys a ShareToken ERC-20 on first mint of a new ticker.
    function mint(
        address to,
        string calldata ticker,
        uint256 amount
    ) external onlyRole(MINTER_ROLE) whenNotPaused {
        _checkNotFrozen(to);
        address token = _getOrDeploy(ticker);
        ShareToken(token).mint(to, amount);
        emit SharesMinted(to, ticker, amount, token);
    }

    /// @notice Mint shares for multiple tickers in one transaction.
    function batchMint(
        address to,
        string[] calldata tickers,
        uint256[] calldata amounts
    ) external onlyRole(MINTER_ROLE) whenNotPaused {
        if (tickers.length != amounts.length) revert ArrayLengthMismatch();
        _checkNotFrozen(to);
        for (uint256 i = 0; i < tickers.length; i++) {
            address token = _getOrDeploy(tickers[i]);
            ShareToken(token).mint(to, amounts[i]);
            emit SharesMinted(to, tickers[i], amounts[i], token);
        }
    }

    // ─── Burn ─────────────────────────────────────────────────────────────────

    /// @notice Burn `amount` shares of `ticker` from `from`.
    ///         Called during MDT redemption — caller is responsible for the
    ///         corresponding MDT payout.
    function burnSharesForMDT(
        address from,
        string calldata ticker,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        address token = tokenForTicker[ticker];
        if (token == address(0)) revert TickerNotDeployed(ticker);
        ShareToken(token).burn(from, amount);
        emit SharesBurned(from, ticker, amount, token);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice ERC-20 address for a ticker, or address(0) if never minted.
    function tokenAddressForTicker(string calldata ticker) external view returns (address) {
        return tokenForTicker[ticker];
    }

    /// @notice Balance of a specific ticker for an account.
    function balanceOfTicker(address account, string calldata ticker) external view returns (uint256) {
        address token = tokenForTicker[ticker];
        if (token == address(0)) return 0;
        return ShareToken(token).balanceOf(account);
    }

    /// @notice Total outstanding shares for a ticker across all holders.
    function totalSupplyOf(string calldata ticker) external view returns (uint256) {
        address token = tokenForTicker[ticker];
        if (token == address(0)) return 0;
        return ShareToken(token).totalSupply();
    }

    /// @notice Whether a ticker has ever been minted (i.e. its ERC-20 exists).
    function isRegistered(string calldata ticker) external view returns (bool) {
        return tokenForTicker[ticker] != address(0);
    }

    // ─── Freeze / Seize ───────────────────────────────────────────────────────

    function freeze(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        frozen[account] = true;
        emit AccountFrozen(account);
    }

    function unfreeze(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        frozen[account] = false;
        emit AccountUnfrozen(account);
    }

    /// @notice Forcibly move shares from one address to another (regulatory seizure).
    function seize(
        address from,
        address to,
        string calldata ticker,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address token = tokenForTicker[ticker];
        if (token == address(0)) revert TickerNotDeployed(ticker);
        ShareToken(token).burn(from, amount);
        ShareToken(token).mint(to, amount);
        emit SharesSeized(from, to, ticker, amount, token);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _getOrDeploy(string calldata ticker) internal returns (address) {
        if (bytes(ticker).length == 0) revert TickerEmpty();
        if (tokenForTicker[ticker] == address(0)) {
            ShareToken t = new ShareToken(ticker, address(this));
            tokenForTicker[ticker] = address(t);
            allTickers.push(ticker);
            emit TickerDeployed(ticker, address(t));
        }
        return tokenForTicker[ticker];
    }

    /// @notice Number of distinct tickers that have ever been minted.
    function tickerCount() external view returns (uint256) {
        return allTickers.length;
    }

    function _checkNotFrozen(address account) internal view {
        if (frozen[account]) revert AccountIsFrozen(account);
    }
}

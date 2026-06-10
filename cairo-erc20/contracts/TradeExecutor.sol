// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IMDT {
    function adminBurn(address from, uint256 amount) external;
    function mintTradePayout(address to, uint256 amount) external;
}

interface IEquityVault {
    function mint(address to, string calldata ticker, uint256 amount) external;
    function burnSharesForMDT(address from, string calldata ticker, uint256 amount) external;
}

/// @title TradeExecutor
/// @notice User-submitted trade execution. The backend signs trade parameters
///         (price, shares, expiry) and the user's wallet submits the transaction,
///         paying all gas. The contract holds BURNER_ROLE on MDT and
///         MINTER_ROLE + DEFAULT_ADMIN_ROLE on EquityVault.
contract TradeExecutor is EIP712, Ownable, Pausable {

    bytes32 public constant BUY_TYPEHASH = keccak256(
        "BuyParams(address user,string ticker,uint256 shares,uint256 mdtCost,uint256 nonce,uint256 expiry)"
    );
    bytes32 public constant SELL_TYPEHASH = keccak256(
        "SellParams(address user,string ticker,uint256 shares,uint256 mdtPayout,uint256 nonce,uint256 expiry)"
    );

    struct BuyParams {
        address user;
        string  ticker;
        uint256 shares;
        uint256 mdtCost;
        uint256 nonce;
        uint256 expiry;
    }

    struct SellParams {
        address user;
        string  ticker;
        uint256 shares;
        uint256 mdtPayout;
        uint256 nonce;
        uint256 expiry;
    }

    address public backendSigner;
    address public mdtToken;
    address public equityVault;

    mapping(address => uint256) public nonces;

    event BuyExecuted(address indexed user, string ticker, uint256 shares, uint256 mdtCost);
    event SellExecuted(address indexed user, string ticker, uint256 shares, uint256 mdtPayout);
    event BackendSignerUpdated(address oldSigner, address newSigner);

    error CallerNotUser();
    error InvalidSignature();
    error OfferExpired();
    error InvalidNonce();

    constructor(
        address _backendSigner,
        address _mdtToken,
        address _equityVault,
        address _owner
    ) EIP712("Cairo", "1") Ownable(_owner) {
        backendSigner = _backendSigner;
        mdtToken      = _mdtToken;
        equityVault   = _equityVault;
    }

    /// @notice Execute a backend-authorized buy: burns MDT from user, mints equity shares.
    function executeBuy(BuyParams calldata params, bytes calldata sig) external whenNotPaused {
        if (msg.sender != params.user)                             revert CallerNotUser();
        if (block.timestamp > params.expiry)                       revert OfferExpired();
        if (params.nonce != nonces[params.user])                   revert InvalidNonce();
        if (ECDSA.recover(_hashBuy(params), sig) != backendSigner) revert InvalidSignature();

        nonces[params.user]++;
        IMDT(mdtToken).adminBurn(params.user, params.mdtCost);
        IEquityVault(equityVault).mint(params.user, params.ticker, params.shares);

        emit BuyExecuted(params.user, params.ticker, params.shares, params.mdtCost);
    }

    /// @notice Execute a backend-authorized sell: burns equity shares, mints MDT back to user.
    function executeSell(SellParams calldata params, bytes calldata sig) external whenNotPaused {
        if (msg.sender != params.user)                              revert CallerNotUser();
        if (block.timestamp > params.expiry)                        revert OfferExpired();
        if (params.nonce != nonces[params.user])                    revert InvalidNonce();
        if (ECDSA.recover(_hashSell(params), sig) != backendSigner) revert InvalidSignature();

        nonces[params.user]++;
        IEquityVault(equityVault).burnSharesForMDT(params.user, params.ticker, params.shares);
        IMDT(mdtToken).mintTradePayout(params.user, params.mdtPayout);

        emit SellExecuted(params.user, params.ticker, params.shares, params.mdtPayout);
    }

    function setBackendSigner(address newSigner) external onlyOwner {
        emit BackendSignerUpdated(backendSigner, newSigner);
        backendSigner = newSigner;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _hashBuy(BuyParams calldata params) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            BUY_TYPEHASH,
            params.user,
            keccak256(bytes(params.ticker)),
            params.shares,
            params.mdtCost,
            params.nonce,
            params.expiry
        )));
    }

    function _hashSell(SellParams calldata params) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            SELL_TYPEHASH,
            params.user,
            keccak256(bytes(params.ticker)),
            params.shares,
            params.mdtPayout,
            params.nonce,
            params.expiry
        )));
    }
}

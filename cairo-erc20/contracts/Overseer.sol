// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IMDT {
    function adminBurn(address from, uint256 amount) external;
    function mint(address to, uint256 amount) external;
}

interface IEquityVault {
    function mint(address to, string calldata ticker, uint256 amount) external;
    function burnSharesForMDT(address from, string calldata ticker, uint256 amount) external;
}

/// @title Overseer
/// @notice Backend-authorized brokerage: burns MDT on buy, mints MDT on sell.
///         Equity shares are held in the separate EquityVault ERC-1155.
///         Requires BURNER_ROLE + MINTER_ROLE on the MDT contract and
///         MINTER_ROLE + DEFAULT_ADMIN_ROLE on the EquityVault.
contract Overseer is EIP712, Ownable, Pausable {

    bytes32 public constant BUY_TYPEHASH = keccak256(
        "BuyOffer(address user,string ticker,uint256 shares,uint256 mdtCost,uint256 price,uint256 timestamp,uint256 nonce,uint256 expiry)"
    );

    bytes32 public constant SELL_TYPEHASH = keccak256(
        "SellOffer(address user,string ticker,uint256 shares,uint256 mdtPayout,uint256 price,uint256 timestamp,uint256 nonce,uint256 expiry)"
    );

    struct BuyOffer {
        address user;
        string  ticker;
        uint256 shares;
        uint256 mdtCost;
        uint256 price;
        uint256 timestamp;
        uint256 nonce;
        uint256 expiry;
    }

    struct SellOffer {
        address user;
        string  ticker;
        uint256 shares;
        uint256 mdtPayout;
        uint256 price;
        uint256 timestamp;
        uint256 nonce;
        uint256 expiry;
    }

    address public backendSigner;
    address public mdtToken;
    address public equityVault;

    uint256 public MAX_PRICE_AGE = 30;
    uint256 public TOLERANCE_BPS = 50;

    mapping(address => uint256) public nonces;

    event OfferExecuted(address indexed user, string ticker, uint256 shares, uint256 mdtCost,   uint256 price);
    event RedeemExecuted(address indexed user, string ticker, uint256 shares, uint256 mdtPayout, uint256 price);
    event BackendSignerUpdated(address oldSigner, address newSigner);

    error CallerNotOfferUser();
    error InvalidBackendSignature();
    error PriceReportStale();
    error PriceOutOfTolerance();
    error InvalidNonce();
    error OfferExpired();

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

    function executeBuyOffer(
        BuyOffer calldata offer,
        bytes    calldata sig
    ) external whenNotPaused {
        if (msg.sender != offer.user)                              revert CallerNotOfferUser();
        if (ECDSA.recover(_hashBuy(offer), sig) != backendSigner) revert InvalidBackendSignature();
        if (block.timestamp - offer.timestamp > MAX_PRICE_AGE)    revert PriceReportStale();
        if (!_withinTolerance(offer.mdtCost, offer.price * offer.shares / 1e6, TOLERANCE_BPS))
                                                                   revert PriceOutOfTolerance();
        if (offer.nonce != nonces[offer.user])                    revert InvalidNonce();
        if (block.timestamp > offer.expiry)                       revert OfferExpired();

        nonces[offer.user]++;
        IMDT(mdtToken).adminBurn(offer.user, offer.mdtCost);
        IEquityVault(equityVault).mint(offer.user, offer.ticker, offer.shares);

        emit OfferExecuted(offer.user, offer.ticker, offer.shares, offer.mdtCost, offer.price);
    }

    function executeSellOffer(
        SellOffer calldata offer,
        bytes     calldata sig
    ) external whenNotPaused {
        if (msg.sender != offer.user)                               revert CallerNotOfferUser();
        if (ECDSA.recover(_hashSell(offer), sig) != backendSigner)  revert InvalidBackendSignature();
        if (block.timestamp - offer.timestamp > MAX_PRICE_AGE)     revert PriceReportStale();
        if (!_withinTolerance(offer.mdtPayout, offer.price * offer.shares / 1e6, TOLERANCE_BPS))
                                                                    revert PriceOutOfTolerance();
        if (offer.nonce != nonces[offer.user])                     revert InvalidNonce();
        if (block.timestamp > offer.expiry)                        revert OfferExpired();

        nonces[offer.user]++;
        IEquityVault(equityVault).burnSharesForMDT(offer.user, offer.ticker, offer.shares);
        IMDT(mdtToken).mint(offer.user, offer.mdtPayout);

        emit RedeemExecuted(offer.user, offer.ticker, offer.shares, offer.mdtPayout, offer.price);
    }

    function setBackendSigner(address newSigner) external onlyOwner {
        emit BackendSignerUpdated(backendSigner, newSigner);
        backendSigner = newSigner;
    }

    function setMaxPriceAge(uint256 seconds_) external onlyOwner { MAX_PRICE_AGE = seconds_; }
    function setPriceTolerance(uint256 bps)    external onlyOwner { TOLERANCE_BPS = bps; }
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _hashBuy(BuyOffer calldata offer) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            BUY_TYPEHASH,
            offer.user,
            keccak256(bytes(offer.ticker)),
            offer.shares, offer.mdtCost, offer.price, offer.timestamp, offer.nonce, offer.expiry
        )));
    }

    function _hashSell(SellOffer calldata offer) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            SELL_TYPEHASH,
            offer.user,
            keccak256(bytes(offer.ticker)),
            offer.shares, offer.mdtPayout, offer.price, offer.timestamp, offer.nonce, offer.expiry
        )));
    }

    function _withinTolerance(uint256 actual, uint256 expected, uint256 bps) internal pure returns (bool) {
        if (expected == 0) return actual == 0;
        uint256 diff = actual > expected ? actual - expected : expected - actual;
        return diff * 10_000 <= expected * bps;
    }
}

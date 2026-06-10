import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

const ONE_SHARE = ethers.parseUnits("1", 6);
const TEN_SHARES = ethers.parseUnits("10", 6);

describe("EquityVault", function () {
  let vault: any;
  let admin: any;
  let minter: any;
  let user: any;
  let other: any;

  beforeEach(async () => {
    [admin, minter, user, other] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("EquityVault");
    vault = await Factory.deploy(admin.address, "https://api.maritime.io/tokens/{id}");

    // Grant minter role to minter account
    await vault.connect(admin).grantRole(await vault.MINTER_ROLE(), minter.address);
  });

  // ─── Constructor ──────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      expect(await vault.hasRole(await vault.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
    });

    it("grants MINTER_ROLE to admin", async () => {
      expect(await vault.hasRole(await vault.MINTER_ROLE(), admin.address)).to.be.true;
    });
  });

  // ─── mint ─────────────────────────────────────────────────────────────────

  describe("mint", () => {
    it("mints shares to user and emits SharesMinted", async () => {
      const tokenId = await vault.tokenIdForTicker("AAPL");

      await expect(vault.connect(minter).mint(user.address, "AAPL", ONE_SHARE))
        .to.emit(vault, "SharesMinted")
        .withArgs(user.address, "AAPL", ONE_SHARE, tokenId);

      expect(await vault.balanceOf(user.address, tokenId)).to.equal(ONE_SHARE);
    });

    it("registers ticker on first mint and emits TickerRegistered", async () => {
      const tokenId = await vault.tokenIdForTicker("TSLA");

      expect(await vault.isRegistered("TSLA")).to.be.false;

      await expect(vault.connect(minter).mint(user.address, "TSLA", ONE_SHARE))
        .to.emit(vault, "TickerRegistered")
        .withArgs("TSLA", tokenId);

      expect(await vault.isRegistered("TSLA")).to.be.true;
    });

    it("does not emit TickerRegistered on subsequent mints", async () => {
      await vault.connect(minter).mint(user.address, "AAPL", ONE_SHARE);

      await expect(vault.connect(minter).mint(user.address, "AAPL", ONE_SHARE))
        .to.not.emit(vault, "TickerRegistered");
    });

    it("accumulates balance across multiple mints", async () => {
      const tokenId = await vault.tokenIdForTicker("AAPL");
      await vault.connect(minter).mint(user.address, "AAPL", ONE_SHARE);
      await vault.connect(minter).mint(user.address, "AAPL", ONE_SHARE);
      expect(await vault.balanceOf(user.address, tokenId)).to.equal(ONE_SHARE * 2n);
    });

    it("reverts when ticker is empty", async () => {
      await expect(vault.connect(minter).mint(user.address, "", ONE_SHARE))
        .to.be.revertedWithCustomError(vault, "TickerEmpty");
    });

    it("reverts when caller lacks MINTER_ROLE", async () => {
      await expect(vault.connect(user).mint(user.address, "AAPL", ONE_SHARE))
        .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    });

    it("reverts when paused", async () => {
      await vault.connect(admin).pause();
      await expect(vault.connect(minter).mint(user.address, "AAPL", ONE_SHARE))
        .to.be.revertedWithCustomError(vault, "EnforcedPause");
    });
  });

  // ─── batchMint ────────────────────────────────────────────────────────────

  describe("batchMint", () => {
    it("mints multiple tickers in one transaction", async () => {
      await vault.connect(minter).batchMint(
        user.address,
        ["AAPL", "TSLA", "NVDA"],
        [ONE_SHARE, ONE_SHARE * 2n, ONE_SHARE * 3n]
      );

      expect(await vault.balanceOfTicker(user.address, "AAPL")).to.equal(ONE_SHARE);
      expect(await vault.balanceOfTicker(user.address, "TSLA")).to.equal(ONE_SHARE * 2n);
      expect(await vault.balanceOfTicker(user.address, "NVDA")).to.equal(ONE_SHARE * 3n);
    });

    it("registers all tickers", async () => {
      await vault.connect(minter).batchMint(user.address, ["AAPL", "TSLA"], [ONE_SHARE, ONE_SHARE]);
      expect(await vault.isRegistered("AAPL")).to.be.true;
      expect(await vault.isRegistered("TSLA")).to.be.true;
    });

    it("reverts on array length mismatch", async () => {
      await expect(
        vault.connect(minter).batchMint(user.address, ["AAPL", "TSLA"], [ONE_SHARE])
      ).to.be.revertedWithCustomError(vault, "ArrayLengthMismatch");
    });

    it("reverts when caller lacks MINTER_ROLE", async () => {
      await expect(
        vault.connect(user).batchMint(user.address, ["AAPL"], [ONE_SHARE])
      ).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── burnForMDT ───────────────────────────────────────────────────────────

  describe("burnForMDT", () => {
    beforeEach(async () => {
      await vault.connect(minter).mint(user.address, "AAPL", TEN_SHARES);
    });

    it("burns shares from user and emits SharesBurned", async () => {
      const tokenId = await vault.tokenIdForTicker("AAPL");

      await expect(vault.connect(admin).burnForMDT(user.address, "AAPL", ONE_SHARE))
        .to.emit(vault, "SharesBurned")
        .withArgs(user.address, "AAPL", ONE_SHARE, tokenId);

      expect(await vault.balanceOfTicker(user.address, "AAPL")).to.equal(TEN_SHARES - ONE_SHARE);
    });

    it("reduces totalSupplyOf", async () => {
      await vault.connect(admin).burnForMDT(user.address, "AAPL", ONE_SHARE);
      expect(await vault.totalSupplyOf("AAPL")).to.equal(TEN_SHARES - ONE_SHARE);
    });

    it("reverts when caller lacks DEFAULT_ADMIN_ROLE", async () => {
      await expect(vault.connect(minter).burnForMDT(user.address, "AAPL", ONE_SHARE))
        .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── Views ────────────────────────────────────────────────────────────────

  describe("views", () => {
    it("tokenIdForTicker returns deterministic ID", async () => {
      const expected = BigInt(ethers.keccak256(ethers.toUtf8Bytes("AAPL")));
      expect(await vault.tokenIdForTicker("AAPL")).to.equal(expected);
    });

    it("tickerOf returns ticker for registered token ID", async () => {
      const tokenId = await vault.tokenIdForTicker("AAPL");
      await vault.connect(minter).mint(user.address, "AAPL", ONE_SHARE);
      expect(await vault.tickerOf(tokenId)).to.equal("AAPL");
    });

    it("tickerOf returns empty string for unregistered token ID", async () => {
      const tokenId = await vault.tokenIdForTicker("FAKE");
      expect(await vault.tickerOf(tokenId)).to.equal("");
    });

    it("totalSupplyOf reflects minted and burned shares", async () => {
      await vault.connect(minter).mint(user.address, "AAPL", TEN_SHARES);
      expect(await vault.totalSupplyOf("AAPL")).to.equal(TEN_SHARES);
      await vault.connect(admin).burnForMDT(user.address, "AAPL", ONE_SHARE);
      expect(await vault.totalSupplyOf("AAPL")).to.equal(TEN_SHARES - ONE_SHARE);
    });

    it("balanceOfTicker matches balanceOf by token ID", async () => {
      await vault.connect(minter).mint(user.address, "AAPL", ONE_SHARE);
      const tokenId = await vault.tokenIdForTicker("AAPL");
      expect(await vault.balanceOfTicker(user.address, "AAPL"))
        .to.equal(await vault.balanceOf(user.address, tokenId));
    });
  });

  // ─── freeze / unfreeze ────────────────────────────────────────────────────

  describe("freeze / unfreeze", () => {
    beforeEach(async () => {
      await vault.connect(minter).mint(user.address, "AAPL", TEN_SHARES);
    });

    it("freeze emits AccountFrozen", async () => {
      await expect(vault.connect(admin).freeze(user.address))
        .to.emit(vault, "AccountFrozen")
        .withArgs(user.address);
      expect(await vault.frozen(user.address)).to.be.true;
    });

    it("unfreeze emits AccountUnfrozen", async () => {
      await vault.connect(admin).freeze(user.address);
      await expect(vault.connect(admin).unfreeze(user.address))
        .to.emit(vault, "AccountUnfrozen")
        .withArgs(user.address);
      expect(await vault.frozen(user.address)).to.be.false;
    });

    it("frozen account cannot transfer shares", async () => {
      await vault.connect(admin).freeze(user.address);
      const tokenId = await vault.tokenIdForTicker("AAPL");

      await expect(
        vault.connect(user).safeTransferFrom(user.address, other.address, tokenId, ONE_SHARE, "0x")
      ).to.be.revertedWithCustomError(vault, "AccountIsFrozen");
    });

    it("frozen account cannot receive shares", async () => {
      await vault.connect(minter).mint(other.address, "AAPL", TEN_SHARES);
      await vault.connect(admin).freeze(user.address);
      const tokenId = await vault.tokenIdForTicker("AAPL");

      await expect(
        vault.connect(other).safeTransferFrom(other.address, user.address, tokenId, ONE_SHARE, "0x")
      ).to.be.revertedWithCustomError(vault, "AccountIsFrozen");
    });

    it("minting to frozen address reverts", async () => {
      await vault.connect(admin).freeze(user.address);
      await expect(vault.connect(minter).mint(user.address, "TSLA", ONE_SHARE))
        .to.be.revertedWithCustomError(vault, "AccountIsFrozen");
    });

    it("unfrozen account can transfer again", async () => {
      await vault.connect(admin).freeze(user.address);
      await vault.connect(admin).unfreeze(user.address);
      const tokenId = await vault.tokenIdForTicker("AAPL");

      await vault.connect(user).safeTransferFrom(user.address, other.address, tokenId, ONE_SHARE, "0x");
      expect(await vault.balanceOf(other.address, tokenId)).to.equal(ONE_SHARE);
    });

    it("reverts when non-admin tries to freeze", async () => {
      await expect(vault.connect(user).freeze(other.address))
        .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── seize ────────────────────────────────────────────────────────────────

  describe("seize", () => {
    beforeEach(async () => {
      await vault.connect(minter).mint(user.address, "AAPL", TEN_SHARES);
    });

    it("transfers shares from user to admin and emits SharesSeized", async () => {
      const tokenId = await vault.tokenIdForTicker("AAPL");

      await expect(vault.connect(admin).seize(user.address, other.address, "AAPL", ONE_SHARE))
        .to.emit(vault, "SharesSeized")
        .withArgs(user.address, other.address, "AAPL", ONE_SHARE, tokenId);

      expect(await vault.balanceOfTicker(user.address, "AAPL")).to.equal(TEN_SHARES - ONE_SHARE);
      expect(await vault.balanceOfTicker(other.address, "AAPL")).to.equal(ONE_SHARE);
    });

    it("can seize from a frozen account", async () => {
      await vault.connect(admin).freeze(user.address);
      await vault.connect(admin).seize(user.address, other.address, "AAPL", ONE_SHARE);
      expect(await vault.balanceOfTicker(other.address, "AAPL")).to.equal(ONE_SHARE);
    });

    it("reverts when non-admin tries to seize", async () => {
      await expect(vault.connect(user).seize(user.address, other.address, "AAPL", ONE_SHARE))
        .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── pause / unpause ──────────────────────────────────────────────────────

  describe("pause / unpause", () => {
    it("paused contract blocks mint", async () => {
      await vault.connect(admin).pause();
      await expect(vault.connect(minter).mint(user.address, "AAPL", ONE_SHARE))
        .to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("paused contract blocks transfers", async () => {
      await vault.connect(minter).mint(user.address, "AAPL", TEN_SHARES);
      await vault.connect(admin).pause();
      const tokenId = await vault.tokenIdForTicker("AAPL");

      await expect(
        vault.connect(user).safeTransferFrom(user.address, other.address, tokenId, ONE_SHARE, "0x")
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("unpause restores normal operation", async () => {
      await vault.connect(admin).pause();
      await vault.connect(admin).unpause();
      await vault.connect(minter).mint(user.address, "AAPL", ONE_SHARE);
      expect(await vault.balanceOfTicker(user.address, "AAPL")).to.equal(ONE_SHARE);
    });

    it("reverts when non-admin tries to pause", async () => {
      await expect(vault.connect(user).pause())
        .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── setBaseURI ───────────────────────────────────────────────────────────

  describe("setBaseURI", () => {
    it("admin can update base URI", async () => {
      await vault.connect(admin).setBaseURI("https://new.uri/{id}");
    });

    it("non-admin cannot update base URI", async () => {
      await expect(vault.connect(user).setBaseURI("https://evil.uri/{id}"))
        .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
    });
  });
});

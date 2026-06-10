import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("MaritimeDeposit", function () {
  let contract, usdc, usdt, owner, vault, user;

  beforeEach(async () => {
    [owner, vault, user] = await ethers.getSigners();

    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    usdc = await ERC20Mock.deploy("USD Coin", "USDC", 6);
    usdt = await ERC20Mock.deploy("Tether USD", "USDT", 6);

    await usdc.mint(user.address,  ethers.parseUnits("1000", 6));
    await usdt.mint(user.address,  ethers.parseUnits("1000", 6));
    await usdc.mint(vault.address, ethers.parseUnits("1000", 6));
    await usdt.mint(vault.address, ethers.parseUnits("1000", 6));

    const Factory = await ethers.getContractFactory("MaritimeDeposit");
    contract = await Factory.deploy(
      owner.address,
      vault.address,
      usdc.target,
      usdt.target,
      ethers.parseUnits("1", 6),
      ethers.parseUnits("1", 6)
    );

    // Vault pre-approves the contract to pull stablecoins for withdrawals
    await usdc.connect(vault).approve(contract.target, ethers.MaxUint256);
    await usdt.connect(vault).approve(contract.target, ethers.MaxUint256);
  });

  // ── ERC-20 metadata ──────────────────────────────────────────────────────

  it("has correct ERC-20 metadata", async () => {
    expect(await contract.name()).to.equal("Maritime Deposit Token");
    expect(await contract.symbol()).to.equal("MDT");
    expect(await contract.decimals()).to.equal(6);
  });

  // ── Happy-path deposits ───────────────────────────────────────────────────

  it("sends USDC directly to vault in one transfer and emits Deposited event", async () => {
    const amount = ethers.parseUnits("50", 6);
    const userId = ethers.encodeBytes32String("user-123");

    await usdc.connect(user).approve(contract.target, amount);

    await expect(contract.connect(user).deposit(usdc.target, amount, userId))
      .to.emit(contract, "Deposited")
      .withArgs(user.address, usdc.target, amount, userId, anyValue);

    // Stablecoins go straight to vault — contract balance stays zero
    expect(await usdc.balanceOf(vault.address)).to.equal(
      ethers.parseUnits("1000", 6) + amount
    );
    expect(await usdc.balanceOf(contract.target)).to.equal(0);
  });

  it("mints MDT 1:1 with USDC deposit and credits the caller", async () => {
    const amount = ethers.parseUnits("50", 6);
    const userId = ethers.encodeBytes32String("user-456");

    await usdc.connect(user).approve(contract.target, amount);
    await contract.connect(user).deposit(usdc.target, amount, userId);

    expect(await contract.balanceOf(user.address)).to.equal(amount);
    expect(await contract.totalSupply()).to.equal(amount);
  });

  it("emits ERC-20 Transfer(address(0), user, amount) on mint", async () => {
    const amount = ethers.parseUnits("100", 6);
    const userId = ethers.encodeBytes32String("user-789");

    await usdc.connect(user).approve(contract.target, amount);

    await expect(contract.connect(user).deposit(usdc.target, amount, userId))
      .to.emit(contract, "Transfer")
      .withArgs(ethers.ZeroAddress, user.address, amount);
  });

  it("mints MDT 1:1 with USDT deposit", async () => {
    const amount = ethers.parseUnits("75", 6);
    const userId = ethers.encodeBytes32String("user-usdt");

    await usdt.connect(user).approve(contract.target, amount);
    await contract.connect(user).deposit(usdt.target, amount, userId);

    expect(await contract.balanceOf(user.address)).to.equal(amount);
    expect(await usdt.balanceOf(vault.address)).to.equal(
      ethers.parseUnits("1000", 6) + amount
    );
  });

  it("accumulates MDT across multiple deposits", async () => {
    const first  = ethers.parseUnits("30", 6);
    const second = ethers.parseUnits("20", 6);
    const userId = ethers.encodeBytes32String("user-multi");

    await usdc.connect(user).approve(contract.target, first + second);
    await contract.connect(user).deposit(usdc.target, first,  userId);
    await contract.connect(user).deposit(usdc.target, second, userId);

    expect(await contract.balanceOf(user.address)).to.equal(first + second);
    expect(await contract.totalSupply()).to.equal(first + second);
  });

  // ── MDT transferability ───────────────────────────────────────────────────

  it("allows user to transfer MDT to another address", async () => {
    const [,,, recipient] = await ethers.getSigners();
    const amount  = ethers.parseUnits("50", 6);
    const sendAmt = ethers.parseUnits("20", 6);
    const userId  = ethers.encodeBytes32String("user-transfer");

    await usdc.connect(user).approve(contract.target, amount);
    await contract.connect(user).deposit(usdc.target, amount, userId);

    await contract.connect(user).transfer(recipient.address, sendAmt);

    expect(await contract.balanceOf(user.address)).to.equal(amount - sendAmt);
    expect(await contract.balanceOf(recipient.address)).to.equal(sendAmt);
  });

  // ── Reverts ───────────────────────────────────────────────────────────────

  it("rejects deposits below minimum", async () => {
    const tooLittle = ethers.parseUnits("0.50", 6);
    const userId    = ethers.encodeBytes32String("user-low");
    await usdc.connect(user).approve(contract.target, tooLittle);
    await expect(contract.connect(user).deposit(usdc.target, tooLittle, userId))
      .to.be.revertedWithCustomError(contract, "BelowMinimum");
  });

  it("rejects unsupported tokens", async () => {
    await expect(
      contract.connect(user).deposit(ethers.ZeroAddress, 100, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(contract, "UnsupportedToken");
  });

  it("reverts MDT transfer when balance is insufficient", async () => {
    await expect(
      contract.connect(user).transfer(owner.address, ethers.parseUnits("1", 6))
    ).to.be.revertedWithCustomError(contract, "InsufficientBalance");
  });

  // ── Withdrawal ────────────────────────────────────────────────────────────

  it("moves MDT to contract and returns USDC from vault", async () => {
    const depositAmt  = ethers.parseUnits("50", 6);
    const withdrawAmt = ethers.parseUnits("20", 6);
    const userId      = ethers.encodeBytes32String("user-withdraw");

    await usdc.connect(user).approve(contract.target, depositAmt);
    await contract.connect(user).deposit(usdc.target, depositAmt, userId);

    const usdcBefore = await usdc.balanceOf(user.address);
    await contract.connect(user).withdraw(usdc.target, withdrawAmt);

    // User's MDT decreased, contract's MDT increased, total supply unchanged
    expect(await contract.balanceOf(user.address)).to.equal(depositAmt - withdrawAmt);
    expect(await contract.balanceOf(contract.target)).to.equal(withdrawAmt);
    expect(await contract.totalSupply()).to.equal(depositAmt);
    expect(await usdc.balanceOf(user.address)).to.equal(usdcBefore + withdrawAmt);
  });

  it("moves MDT to contract and returns USDT from vault", async () => {
    const depositAmt  = ethers.parseUnits("50", 6);
    const withdrawAmt = ethers.parseUnits("30", 6);
    const userId      = ethers.encodeBytes32String("user-withdraw-usdt");

    await usdc.connect(user).approve(contract.target, depositAmt);
    await contract.connect(user).deposit(usdc.target, depositAmt, userId);

    const usdtBefore = await usdt.balanceOf(user.address);
    await contract.connect(user).withdraw(usdt.target, withdrawAmt);

    expect(await contract.balanceOf(user.address)).to.equal(depositAmt - withdrawAmt);
    expect(await contract.balanceOf(contract.target)).to.equal(withdrawAmt);
    expect(await contract.totalSupply()).to.equal(depositAmt);
    expect(await usdt.balanceOf(user.address)).to.equal(usdtBefore + withdrawAmt);
  });

  it("emits Withdrawn and Transfer(user → contract) events", async () => {
    const depositAmt  = ethers.parseUnits("50", 6);
    const withdrawAmt = ethers.parseUnits("10", 6);
    const userId      = ethers.encodeBytes32String("user-events-withdraw");

    await usdc.connect(user).approve(contract.target, depositAmt);
    await contract.connect(user).deposit(usdc.target, depositAmt, userId);

    const tx = contract.connect(user).withdraw(usdc.target, withdrawAmt);

    await expect(tx)
      .to.emit(contract, "Withdrawn")
      .withArgs(user.address, usdc.target, withdrawAmt, anyValue);
    await expect(tx)
      .to.emit(contract, "Transfer")
      .withArgs(user.address, contract.target, withdrawAmt);
  });

  it("reverts withdrawal when vault has insufficient balance", async () => {
    const depositAmt  = ethers.parseUnits("50", 6);
    const withdrawAmt = ethers.parseUnits("10", 6);
    const userId      = ethers.encodeBytes32String("user-no-reserve");

    await usdc.connect(user).approve(contract.target, depositAmt);
    await contract.connect(user).deposit(usdc.target, depositAmt, userId);

    // Drain vault so it can't cover the withdrawal
    await usdc.connect(vault).transfer(owner.address, await usdc.balanceOf(vault.address));

    await expect(contract.connect(user).withdraw(usdc.target, withdrawAmt))
      .to.be.revertedWithCustomError(contract, "InsufficientVaultBalance");
  });

  it("reverts withdrawal when user has insufficient MDT", async () => {
    // User has no MDT but vault has funds
    await expect(contract.connect(user).withdraw(usdc.target, ethers.parseUnits("10", 6)))
      .to.be.revertedWithCustomError(contract, "InsufficientBalance");
  });

  it("reverts withdrawal with unsupported token", async () => {
    await expect(contract.connect(user).withdraw(ethers.ZeroAddress, 100))
      .to.be.revertedWithCustomError(contract, "UnsupportedToken");
  });

  it("vaultBalance reflects vault stablecoin holdings", async () => {
    expect(await contract.vaultBalance(usdc.target)).to.equal(
      ethers.parseUnits("1000", 6)
    );
  });

  // ── Rescue: stranded stablecoins ──────────────────────────────────────────

  it("owner can rescue USDC sent directly to the contract", async () => {
    const stranded = ethers.parseUnits("42", 6);
    await usdc.mint(contract.target, stranded);

    expect(await contract.stuckBalance(usdc.target)).to.equal(stranded);

    await contract.connect(owner).rescue(usdc.target, stranded);

    expect(await usdc.balanceOf(owner.address)).to.equal(stranded);
    expect(await contract.stuckBalance(usdc.target)).to.equal(0);
  });

  it("rescue emits the Rescued event", async () => {
    const stranded = ethers.parseUnits("10", 6);
    await usdc.mint(contract.target, stranded);

    await expect(contract.connect(owner).rescue(usdc.target, stranded))
      .to.emit(contract, "Rescued")
      .withArgs(usdc.target, stranded);
  });

  it("non-owner cannot rescue tokens", async () => {
    const stranded = ethers.parseUnits("10", 6);
    await usdc.mint(contract.target, stranded);

    await expect(contract.connect(user).rescue(usdc.target, stranded))
      .to.be.revertedWithCustomError(contract, "NotOwner");
  });

  // ── Rescue: stranded MDT ──────────────────────────────────────────────────

  it("owner can rescue MDT transferred into the contract", async () => {
    const deposit  = ethers.parseUnits("50", 6);
    const stranded = ethers.parseUnits("10", 6);
    const userId   = ethers.encodeBytes32String("user-mdt-rescue");

    await usdc.connect(user).approve(contract.target, deposit);
    await contract.connect(user).deposit(usdc.target, deposit, userId);

    // User accidentally sends MDT to the contract
    await contract.connect(user).transfer(contract.target, stranded);
    expect(await contract.balanceOf(contract.target)).to.equal(stranded);

    await contract.connect(owner).rescue(contract.target, stranded);

    expect(await contract.balanceOf(contract.target)).to.equal(0);
    expect(await contract.balanceOf(owner.address)).to.equal(stranded);
  });

  it("rescue(address(this)) emits both Transfer and Rescued events", async () => {
    const deposit  = ethers.parseUnits("50", 6);
    const stranded = ethers.parseUnits("5", 6);
    const userId   = ethers.encodeBytes32String("user-events");

    await usdc.connect(user).approve(contract.target, deposit);
    await contract.connect(user).deposit(usdc.target, deposit, userId);
    await contract.connect(user).transfer(contract.target, stranded);

    const tx = contract.connect(owner).rescue(contract.target, stranded);

    await expect(tx)
      .to.emit(contract, "Transfer")
      .withArgs(contract.target, owner.address, stranded);
    await expect(tx)
      .to.emit(contract, "Rescued")
      .withArgs(contract.target, stranded);
  });
});

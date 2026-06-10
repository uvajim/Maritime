import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("MaritimeDeposit interaction", function () {
  let contract, usdc, owner, user;

  before(async () => {
    [owner, user] = await ethers.getSigners();

    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    usdc = await ERC20Mock.deploy("USD Coin", "USDC", 6);

    await usdc.mint(user.address, ethers.parseUnits("1000", 6));

    const Factory = await ethers.getContractFactory("MaritimeDeposit");
    contract = await Factory.deploy(
      owner.address,
      usdc.target,
      usdc.target,
      ethers.parseUnits("1", 6),
      ethers.parseUnits("1", 6)
    );
  });

  it("reads supported tokens from the contract", async () => {
    const { usdc: usdcAddr, usdt: usdtAddr } = await contract.supportedTokens();
    console.log("USDC address:", usdcAddr);
    console.log("USDT address:", usdtAddr);
    expect(usdcAddr).to.equal(usdc.target);
  });

  it("writes a deposit transaction and confirms it", async () => {
    const amount = ethers.parseUnits("50", 6);
    const userId = ethers.encodeBytes32String("user-123");

    await usdc.connect(user).approve(contract.target, amount);

    const tx = await contract.connect(user).deposit(usdc.target, amount, userId);
    console.log("Transaction sent! Hash:", tx.hash);

    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt.blockNumber);

    expect(await usdc.balanceOf(owner.address)).to.equal(amount);
  });
});

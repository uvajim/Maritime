import "dotenv/config";
import hre from "hardhat";
import { getStablecoins } from "./addresses.js";

async function main() {
  const network = await hre.network.connect();
  const { ethers } = network;

  const [deployer] = await ethers.getSigners(); // DEPLOYER_PRIVATE_KEY (index 0)
  console.log("Network:", network.networkName);
  console.log("Deploying with:", deployer.address);

  const OWNER_WALLET = process.env.OWNER_WALLET;
  if (!OWNER_WALLET) throw new Error("OWNER_WALLET not set in .env");

  const VAULT_WALLET = process.env.VAULT_WALLET;
  if (!VAULT_WALLET) throw new Error("VAULT_WALLET not set in .env");

  const { USDC, USDT } = getStablecoins(network.networkName);
  const MIN_USDC = ethers.parseUnits("1", 6);
  const MIN_USDT = ethers.parseUnits("1", 6);

  const Factory  = await ethers.getContractFactory("MaritimeDeposit");
  const contract = await Factory.deploy(OWNER_WALLET, VAULT_WALLET, USDC, USDT, MIN_USDC, MIN_USDT);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log("Deployed to:", addr);
  console.log(`\nAdd to .env:\nCONTRACT_ADDRESS=${addr}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
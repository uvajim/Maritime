/**
 * Deploy MDTToken (pure ERC-20) and MaritimeDeposit (DepositGateway).
 *
 * Deployment order:
 *   1. MDTToken          — pure ERC-20 with MINTER/BURNER roles
 *   2. MaritimeDeposit   — DepositGateway; receives MINTER+BURNER roles on MDTToken
 *
 * After deploy, also grant MINTER+BURNER to TradeExecutor if TRADE_EXECUTOR_ADDRESS is set.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-maritime-deposit.ts --network sepolia
 *   npx hardhat run scripts/deploy-maritime-deposit.ts --network mainnet
 */

import "dotenv/config";
import hre from "hardhat";
import { getStablecoins } from "./addresses";

async function main() {
  const network = await hre.network.connect();
  const { ethers } = network;

  const networkName = network.networkName;
  console.log("Network:", networkName);

  const { USDC, USDT } = getStablecoins(networkName);
  console.log("USDC:", USDC);
  console.log("USDT:", USDT);

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const OWNER = process.env.OWNER_WALLET ?? deployer.address;
  const VAULT = process.env.VAULT_WALLET ?? deployer.address;
  const TRADE_EXECUTOR = process.env.TRADE_EXECUTOR_ADDRESS;

  console.log("Owner:", OWNER);
  console.log("Vault:", VAULT);

  // ── 1. Deploy MDTToken ────────────────────────────────────────────────────

  console.log("\nDeploying MDTToken...");
  const MDTFactory = await ethers.getContractFactory("MDTToken");
  const mdt = await MDTFactory.deploy(OWNER);
  await mdt.waitForDeployment();
  const mdtAddress = await mdt.getAddress();
  console.log("MDTToken deployed:", mdtAddress);

  // ── 2. Deploy MaritimeDeposit (DepositGateway) ────────────────────────────

  console.log("\nDeploying MaritimeDeposit (DepositGateway)...");
  const GatewayFactory = await ethers.getContractFactory("MaritimeDeposit");
  const gateway = await GatewayFactory.deploy(
    OWNER,
    VAULT,
    mdtAddress,
    USDC,
    USDT,
    1_000_000n,  // minDepositUSDC: $1.00
    1_000_000n,  // minDepositUSDT: $1.00
  );
  await gateway.waitForDeployment();
  const gatewayAddress = await gateway.getAddress();
  console.log("MaritimeDeposit deployed:", gatewayAddress);

  // ── 3. Grant roles on MDTToken ────────────────────────────────────────────

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));

  // Connect as deployer to grant roles (deployer has DEFAULT_ADMIN_ROLE if OWNER === deployer)
  const mdtAsDeployer = MDTFactory.attach(mdtAddress).connect(deployer) as any;

  console.log("\nGranting MINTER_ROLE + BURNER_ROLE to DepositGateway...");
  await (await mdtAsDeployer.grantRole(MINTER_ROLE, gatewayAddress)).wait();
  await (await mdtAsDeployer.grantRole(BURNER_ROLE, gatewayAddress)).wait();

  if (TRADE_EXECUTOR) {
    console.log("Granting MINTER_ROLE + BURNER_ROLE to TradeExecutor:", TRADE_EXECUTOR);
    await (await mdtAsDeployer.grantRole(MINTER_ROLE, TRADE_EXECUTOR)).wait();
    await (await mdtAsDeployer.grantRole(BURNER_ROLE, TRADE_EXECUTOR)).wait();
  } else {
    console.log("TRADE_EXECUTOR_ADDRESS not set — remember to grant roles manually.");
  }

  // ── 4. Print summary ──────────────────────────────────────────────────────

  console.log("\n── Update .env files ────────────────────────────────────────");
  console.log(`MDT_TOKEN_ADDRESS=${mdtAddress}`);
  console.log(`MARITIME_DEPOSIT_CONTRACT=${gatewayAddress}`);
  console.log("\n── Frontend (.env.local) ─────────────────────────────────────");
  console.log(`NEXT_PUBLIC_MDT_TOKEN_CONTRACT=${mdtAddress}`);
  console.log(`NEXT_PUBLIC_MARITIME_DEPOSIT_CONTRACT=${gatewayAddress}`);
  console.log("\n── Vault setup (run vault-approve.js next) ───────────────────");
  console.log(`Vault wallet (${VAULT}) must approve gateway for USDC + USDT:`);
  console.log(`  USDC.approve(${gatewayAddress}, type(uint256).max)`);
  console.log(`  USDT.approve(${gatewayAddress}, type(uint256).max)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

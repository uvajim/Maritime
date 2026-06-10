import { tradeExecutorContract, equityVaultContract } from "../config";

export async function getNonce(user: string): Promise<bigint> {
  return BigInt(await tradeExecutorContract.nonces(user));
}

export async function getTokenId(ticker: string): Promise<bigint> {
  return BigInt(await equityVaultContract.tokenIdForTicker(ticker));
}

export async function isTickerRegistered(ticker: string): Promise<boolean> {
  return equityVaultContract.isRegistered(ticker);
}

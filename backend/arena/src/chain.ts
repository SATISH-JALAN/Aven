/**
 * Chain access for the Arena (viem). One wallet client per key with viem's nonce manager (no nonce races between
 * concurrent sends), retries with exponential backoff, and typed helpers over @aven/core ABIs.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  maxUint256,
  nonceManager,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  avenHookAbi,
  breakdownToJson,
  mockErc20Abi,
  poolStateSlot,
  poolSwapTestAbi,
  readOracleMark,
  readSlot0,
  type Deployments,
  type PoolKey,
} from "@aven/core";
import type { Breakdown } from "./types.ts";

export async function withRetry<T>(fn: () => Promise<T>, opts: { tries?: number; baseMs?: number; onRetry?: (e: unknown, n: number) => void } = {}): Promise<T> {
  const tries = opts.tries ?? 4;
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i + 1 < tries) {
        opts.onRetry?.(e, i + 1);
        await new Promise((r) => setTimeout(r, (opts.baseMs ?? 250) * 2 ** i));
      }
    }
  }
  throw last;
}

export interface Chain {
  publicClient: PublicClient;
  bot: { account: PrivateKeyAccount; wallet: WalletClient };
  shock: { account: PrivateKeyAccount; wallet: WalletClient };
  d: Deployments;
  keys: { aven: PoolKey; control: PoolKey };
}

export function makeChain(opts: { rpcUrl: string; chainId: number; botPk: Hex; shockPk: Hex; deployments: Deployments; pollingIntervalMs?: number }): Chain {
  const chain = defineChain({
    id: opts.chainId,
    name: opts.chainId === 998 ? "HyperEVM testnet" : `chain ${opts.chainId}`,
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: { default: { http: [opts.rpcUrl] } },
  });
  const transport = http(opts.rpcUrl, { retryCount: 2, timeout: 15_000 });
  // cacheTime 0: the poller asks for the head every POLL_MS (500 ms); viem's default ~4 s cache made it see only about
  // 1 block in 4 (10 bot iterations over 74 blocks in the PLAN 7.2 load test).
  // pollingInterval 250 ms: waitForTransactionReceipt polls at this rate. viem's 4 s default made every bot trade wait
  // up to 4 s for a 1 s block, so a two-pool iteration took 8 s+ (PLAN 7.2 load test).
  const publicClient = createPublicClient({ chain, transport, cacheTime: 0, pollingInterval: opts.pollingIntervalMs ?? 250 }) as PublicClient;
  const mk = (pk: Hex) => {
    const account = privateKeyToAccount(pk, { nonceManager });
    return { account, wallet: createWalletClient({ account, chain, transport, pollingInterval: opts.pollingIntervalMs ?? 250 }) };
  };
  const d = opts.deployments;
  return {
    publicClient,
    bot: mk(opts.botPk),
    shock: mk(opts.shockPk),
    d,
    keys: { aven: d.pools.aven.key as PoolKey, control: d.pools.control.key as PoolKey },
  };
}

export const readOracle = (c: Chain) => readOracleMark(c.publicClient, c.d.config.perpIndex);
export const readPool = (c: Chain, pool: "aven" | "control") => readSlot0(c.publicClient, c.d.poolManager as Address, c.d.pools[pool].id);

export async function readLiquidity(c: Chain, pool: "aven" | "control"): Promise<bigint> {
  const slot = BigInt(poolStateSlot(c.d.pools[pool].id)) + 3n; // StateLibrary.LIQUIDITY_OFFSET
  const word = (await c.publicClient.readContract({
    address: c.d.poolManager as Address,
    abi: [{ type: "function", name: "extsload", stateMutability: "view", inputs: [{ name: "slot", type: "bytes32" }], outputs: [{ name: "", type: "bytes32" }] }],
    functionName: "extsload",
    args: [`0x${slot.toString(16).padStart(64, "0")}` as Hex],
  })) as Hex;
  return BigInt(word) & ((1n << 128n) - 1n);
}

export async function previewFee(c: Chain, zeroForOne: boolean): Promise<Breakdown> {
  const b = await c.publicClient.readContract({
    address: c.d.hook as Address,
    abi: avenHookAbi,
    functionName: "previewFee",
    args: [c.keys.aven, zeroForOne],
  });
  return breakdownToJson({ ...b, reason: Number(b.reason) as 0 | 1 | 2 });
}

export async function hookPoolState(c: Chain) {
  return c.publicClient.readContract({ address: c.d.hook as Address, abi: avenHookAbi, functionName: "poolState", args: [c.d.pools.aven.id] });
}

/**
 * Gas limit for a swap through the Aven pool: estimate + 30% + 30k. eth_estimateGas runs against the latest block. If a
 * swap already happened there, the hook's top-of-block and anchor are already written (cheap path). The real tx is
 * usually the FIRST swap of the next block, where the hook writes both, so a bare estimate runs out of gas and the tx
 * reverts. The PLAN 7.3 load test found this: 12 of 70 bot txs reverted. Every router or wallet integrating Aven needs
 * a margin.
 */
export function withGasMargin(estimate: bigint): bigint {
  return (estimate * 13n) / 10n + 30_000n;
}

/**
 * Mainnet gas guard (pre-mainnet audit, 2026-11-06). The HyperEVM base fee was measured at 0.10-10.8 gwei within 3
 * hours. The Arena trades worthless demo tokens, so its paper profit always beats real gas, and without a cap the bot
 * would keep paying through a spike. With a cap (MAX_GAS_PRICE_GWEI, required on 999), nothing is sent while the next
 * block's base fee (eth_gasPrice) is above it, and every tx carries maxFeePerGas = cap, so a tx can never cost more
 * than gasUsed * cap.
 */
export class GasPriceTooHigh extends Error {
  constructor(
    readonly gasPrice: bigint,
    readonly cap: bigint,
  ) {
    super(`gas price ${Number(gasPrice) / 1e9} gwei is above the cap ${Number(cap) / 1e9} gwei: not sending`);
  }
}

export const gweiToWei = (gwei: number): bigint => BigInt(Math.round(gwei * 1e9));

/** Throws GasPriceTooHigh when a cap is set (capWei > 0) and gasPrice is above it. */
export function checkGasCap(gasPrice: bigint, capWei: bigint): void {
  if (capWei > 0n && gasPrice > capWei) throw new GasPriceTooHigh(gasPrice, capWei);
}

/** Send a contract write with an explicit gas limit = withGasMargin(estimate), and maxFeePerGas = capWei if set. */
export async function writeWithMargin(c: Chain, who: Chain["bot"], request: Parameters<Chain["publicClient"]["estimateContractGas"]>[0], capWei = 0n): Promise<Hex> {
  const estimate = await c.publicClient.estimateContractGas({ ...request, account: who.account } as never);
  return who.wallet.writeContract({
    ...(request as object),
    account: who.account,
    chain: who.wallet.chain,
    gas: withGasMargin(estimate),
    ...(capWei > 0n ? { maxFeePerGas: capWei } : {}),
  } as never);
}

const SWAP_SETTINGS = { takeClaims: false, settleUsingBurn: false } as const;

export function swapArgs(key: PoolKey, zeroForOne: boolean, amountIn: bigint, sqrtPriceLimitX96: bigint) {
  return [key, { zeroForOne, amountSpecified: -amountIn, sqrtPriceLimitX96 }, SWAP_SETTINGS, "0x"] as const;
}

/** eth_call the swap from `who` (no state change). Returns the router's BalanceDelta (int256). */
export async function simulateSwap(c: Chain, who: Chain["bot"], key: PoolKey, zeroForOne: boolean, amountIn: bigint, limit: bigint) {
  const { result, request } = await c.publicClient.simulateContract({
    account: who.account,
    address: c.d.swapRouter as Address,
    abi: poolSwapTestAbi,
    functionName: "swap",
    args: swapArgs(key, zeroForOne, amountIn, limit),
  });
  return { delta: BigInt(result as unknown as bigint), request };
}

/** Approve the swap router for both tokens once (bot and shock wallets hold their own keys). */
export async function ensureApprovals(c: Chain, who: Chain["bot"]): Promise<void> {
  for (const token of [c.d.tokens.base, c.d.tokens.quote] as Address[]) {
    const allowance = (await c.publicClient.readContract({ address: token, abi: mockErc20Abi, functionName: "allowance", args: [who.account.address, c.d.swapRouter as Address] })) as bigint;
    if (allowance > maxUint256 / 2n) continue;
    const hash = await who.wallet.writeContract({ address: token, abi: mockErc20Abi, functionName: "approve", args: [c.d.swapRouter as Address, maxUint256], account: who.account, chain: who.wallet.chain });
    await c.publicClient.waitForTransactionReceipt({ hash });
  }
}

export async function balances(c: Chain, who: Address) {
  const [native, base, quote] = await Promise.all([
    c.publicClient.getBalance({ address: who }),
    c.publicClient.readContract({ address: c.d.tokens.base as Address, abi: mockErc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>,
    c.publicClient.readContract({ address: c.d.tokens.quote as Address, abi: mockErc20Abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>,
  ]);
  return { native, base, quote };
}

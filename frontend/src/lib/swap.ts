"use client";
/**
 * One swap path for the whole app (Trade order panel, Swap page): open-mint demo token → approve → PoolSwapTest.swap,
 * on either pool. Gas gets the same margin the Arena uses (docs/SECURITY.md: the first swap of a block costs more).
 * Your own trades are kept in a small module store so every page shows them, marked "you".
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createWalletClient, custom, decodeEventLog, formatUnits, parseUnits, type Hex } from "viem";
import { avenHookAbi, mockErc20Abi, poolSwapTestAbi } from "@aven/core/abi";
import { useWallet } from "@/components/wallet";
import type { Deployments } from "@/config";
import { useArena } from "@/lib/arena";
import { swapArgs, tokenSide, withGasMargin } from "@/lib/trade-math";
import { appChain, publicClient } from "@/lib/chain";
import type { Direction, PoolName, Trade } from "@/lib/types";

export { feeFor, indicativeOut, tokenSide } from "@/lib/trade-math";

/** mint + approve + swap, with margin. */
export const SWAP_GAS_BUDGET = 420_000n;

/**
 * Per-trade cap in the UI (input token, human units). The demo tokens are open-mint (docs/SECURITY.md C-5); the cap
 * keeps one click from pushing a pool toward the edge of its range (the 40,000 aUSD shock moves it ~190 bp). It is a
 * UI guard only: anyone can still call the router directly.
 */
export const MAX_UI_TRADE: Record<Direction, number> = { sellBase: 5, buyBase: 10_000 };

/** Shown under the trade buttons on mainnet: the tokens are free, the gas is not. */
export const MAINNET_GAS_NOTE = "Mainnet: gas is paid in real HYPE. aETH and aUSD are free demo tokens.";

// ---- your trades (shared across pages) ----
let mine: Trade[] = [];
const subs = new Set<() => void>();
export function addMyTrade(t: Trade) {
  mine = [t, ...mine];
  subs.forEach((f) => f());
}
export function useMyTrades(): Trade[] {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => mine,
    () => mine,
  );
}

export function useBalances(d: Deployments | null, address: Hex | null | undefined, refreshKey: unknown) {
  const [b, setB] = useState<{ base: bigint; quote: bigint; native: bigint; gasPrice: bigint } | null>(null);
  useEffect(() => {
    if (!d || !address || d.tokens.base.length !== 42) return setB(null);
    let alive = true;
    (async () => {
      try {
        const c = publicClient();
        const [base, quote, native, gasPrice] = await Promise.all([
          c.readContract({ address: d.tokens.base, abi: mockErc20Abi, functionName: "balanceOf", args: [address] }),
          c.readContract({ address: d.tokens.quote, abi: mockErc20Abi, functionName: "balanceOf", args: [address] }),
          c.getBalance({ address }),
          c.getGasPrice(),
        ]);
        if (alive) setB({ base, quote, native, gasPrice });
      } catch {
        if (alive) setB(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [d, address, refreshKey]);
  return b;
}

export type SwapStatus = { step: string | null; error: string | null; last: Hex | null };

export function useSwap() {
  const a = useArena();
  const w = useWallet();
  const d = a.deployments;
  const [s, setS] = useState<SwapStatus>({ step: null, error: null, last: null });

  /** Why a swap can't run right now (null = ready). Ordered so the first blocker is the one to fix. */
  const blocker = (amount: number, side: Direction): string | null => {
    if (a.mode !== "LIVE" || !d || d.swapRouter.length !== 42) return "Needs the live deployment";
    if (!w.enabled) return "Wallet connect is not configured";
    if (!w.authenticated || !w.address) return "Connect wallet to trade";
    if (w.wrongChain) return `Switch to ${appChain.name}`;
    if (!(amount > 0)) return "Enter an amount";
    if (amount > MAX_UI_TRADE[side]) return `Max ${MAX_UI_TRADE[side].toLocaleString("en-US")} ${side === "sellBase" ? d.tokens.baseSymbol : d.tokens.quoteSymbol} per trade`;
    return null;
  };

  const execute = useCallback(
    async (pool: PoolName, side: Direction, amount: string, oraclePrice: number): Promise<{ ok: boolean; hash: Hex | null; error: string | null }> => {
      if (!d || !w.getProvider || !w.address) return { ok: false, hash: null, error: "wallet not ready" };
      setS({ step: "Preparing…", error: null, last: null });
      try {
        const provider = await w.getProvider();
        const wallet = createWalletClient({ chain: appChain, transport: custom(provider as never), account: w.address });
        const c = publicClient();
        const t = tokenSide(d, side);
        const value = parseUnits(amount, t.inDec);
        const bal = await c.readContract({ address: t.tokenIn, abi: mockErc20Abi, functionName: "balanceOf", args: [w.address] });
        if (bal < value) {
          setS((p) => ({ ...p, step: `Minting ${t.inSym} (open-mint demo token)…` }));
          await c.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: t.tokenIn, abi: mockErc20Abi, functionName: "mint", args: [w.address, value - bal] }) });
        }
        const allowance = await c.readContract({ address: t.tokenIn, abi: mockErc20Abi, functionName: "allowance", args: [w.address, d.swapRouter] });
        if (allowance < value) {
          setS((p) => ({ ...p, step: "Approving the router…" }));
          await c.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: t.tokenIn, abi: mockErc20Abi, functionName: "approve", args: [d.swapRouter, value] }) });
        }
        setS((p) => ({ ...p, step: `Swapping on the ${pool === "aven" ? "Aven" : "plain"} pool…` }));
        const args = swapArgs(d, pool, side, value);
        const est = await c.estimateContractGas({ address: d.swapRouter, abi: poolSwapTestAbi, functionName: "swap", args, account: w.address });
        const hash = await wallet.writeContract({ address: d.swapRouter, abi: poolSwapTestAbi, functionName: "swap", args, gas: withGasMargin(est) });
        setS((p) => ({ ...p, step: "Waiting for the block…" }));
        const r = await c.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        let feePips = pool === "control" ? d.pools.control.key.fee : 0;
        for (const l of r.logs) {
          try {
            const ev = decodeEventLog({ abi: avenHookAbi, data: l.data, topics: l.topics });
            if (ev.eventName === "FeeComputed") feePips = Number((ev.args as { fee: number }).fee);
          } catch {
            /* not a hook event */
          }
        }
        const inUsd = side === "sellBase" ? Number(formatUnits(value, t.inDec)) * oraclePrice : Number(formatUnits(value, t.inDec));
        addMyTrade({
          id: `you:${hash}`,
          ts: Date.now(),
          block: Number(r.blockNumber),
          pool,
          kind: "retail",
          direction: side,
          amountIn: value.toString(),
          amountOut: "0",
          feePips,
          feeUsd: (inUsd * feePips) / 1e6,
          botProfitUsd: 0,
          lpFeeIncomeUsd: (inUsd * feePips) / 1e6,
          txHash: hash,
        });
        setS({ step: null, error: r.status === "success" ? null : "The swap reverted", last: hash });
        return { ok: r.status === "success", hash, error: r.status === "success" ? null : "The swap reverted" };
      } catch (e) {
        const error = (e as Error).message.split("\n")[0] ?? "Swap failed";
        setS({ step: null, error, last: null });
        return { ok: false, hash: null, error };
      }
    },
    [d, w],
  );

  return { ...s, execute, blocker, wallet: w, deployments: d };
}

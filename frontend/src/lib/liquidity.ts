"use client";
/**
 * Add liquidity to either pool through the deployed PoolModifyLiquidityTest router (deployments.liquidityRouter).
 * You enter the base amount and a range around the current price; the quote amount follows from the usual
 * concentrated-liquidity formulas. Floats are fine here: they only size the position (the router pulls the exact
 * amounts the PoolManager asks for, capped by your approvals). Fee math is never done here.
 */
import { useCallback, useState } from "react";
import { createWalletClient, custom, type Hex } from "viem";
import { mockErc20Abi, poolModifyLiquidityTestAbi } from "@aven/core/abi";
import { useWallet } from "@/components/wallet";
import type { Deployments } from "@/config";
import { appChain, publicClient } from "@/lib/chain";
import { liquidityArgs, liquidityNeeds, withGasMargin, type LiquidityPlan } from "@/lib/trade-math";
import type { PoolName } from "@/lib/types";

export { planLiquidity, type LiquidityPlan } from "@/lib/trade-math";

export function useAddLiquidity(d: Deployments | null) {
  const w = useWallet();
  const [s, setS] = useState<{ step: string | null; error: string | null; last: Hex | null }>({ step: null, error: null, last: null });

  const add = useCallback(
    async (pool: PoolName, plan: LiquidityPlan) => {
      if (!d || !w.getProvider || !w.address) return;
      setS({ step: "Preparing…", error: null, last: null });
      try {
        const wallet = createWalletClient({ chain: appChain, transport: custom((await w.getProvider()) as never), account: w.address });
        const c = publicClient();
        const need = liquidityNeeds(d, plan);
        for (const n of need) {
          if (n.value === 0n) continue;
          const bal = await c.readContract({ address: n.token, abi: mockErc20Abi, functionName: "balanceOf", args: [w.address] });
          if (bal < n.value) {
            setS((p) => ({ ...p, step: `Minting ${n.sym} (open-mint demo token)…` }));
            await c.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: n.token, abi: mockErc20Abi, functionName: "mint", args: [w.address, n.value - bal] }) });
          }
          const allowance = await c.readContract({ address: n.token, abi: mockErc20Abi, functionName: "allowance", args: [w.address, d.liquidityRouter] });
          if (allowance < n.value) {
            setS((p) => ({ ...p, step: `Approving ${n.sym}…` }));
            await c.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: n.token, abi: mockErc20Abi, functionName: "approve", args: [d.liquidityRouter, n.value] }) });
          }
        }
        setS((p) => ({ ...p, step: "Adding liquidity…" }));
        const args = liquidityArgs(d, pool, plan);
        const est = await c.estimateContractGas({ address: d.liquidityRouter, abi: poolModifyLiquidityTestAbi, functionName: "modifyLiquidity", args, account: w.address });
        const hash = await wallet.writeContract({ address: d.liquidityRouter, abi: poolModifyLiquidityTestAbi, functionName: "modifyLiquidity", args, gas: withGasMargin(est) });
        setS((p) => ({ ...p, step: "Waiting for the block…" }));
        const r = await c.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        setS({ step: null, error: r.status === "success" ? null : "Add liquidity reverted", last: hash });
      } catch (e) {
        setS({ step: null, error: (e as Error).message.split("\n")[0] ?? "Add liquidity failed", last: null });
      }
    },
    [d, w],
  );
  return { ...s, add, wallet: w };
}

"use client";
import { useState } from "react";
import { formatUnits } from "viem";
import { Emblem } from "@/components/brand";
import { UsePageMode } from "@/components/shell";
import { TermChip, TxLink } from "@/components/ui";
import { useArena } from "@/lib/arena";
import { num, pipsPct, usd } from "@/lib/format";
import { termsFired } from "@/lib/steps";
import { feeFor, indicativeOut, SWAP_GAS_BUDGET, tokenSide, useBalances, useSwap } from "@/lib/swap";
import type { Direction, PoolName } from "@/lib/types";

export default function SwapPage() {
  const a = useArena();
  const s = useSwap();
  const m = a.math;
  const [side, setSide] = useState<Direction>("sellBase");
  const [amount, setAmount] = useState("");
  const [pool, setPool] = useState<PoolName>("aven");
  const bal = useBalances(s.deployments, s.wallet.address, s.last);

  const t = m ? tokenSide(m, side) : null;
  const amt = Number(amount) || 0;
  const oracle = a.state?.oracle.price ?? 0;
  const quote = (p: PoolName) => {
    const fee = feeFor(a.state, p, side);
    const price = a.state?.pools[p].price ?? 0;
    return { fee, out: fee === null ? 0 : indicativeOut(amt, side, price, fee) };
  };
  const q = { aven: quote("aven"), control: quote("control") };
  const chosen = q[pool];
  const inUsd = side === "sellBase" ? amt * oracle : amt;
  const fp = a.state?.pools.aven.feePreview;
  const breakdown = fp && !("fixedPips" in fp) ? fp[side] : null;
  const inBal = bal && t ? (side === "sellBase" ? bal.base : bal.quote) : null;
  const outBal = bal && t ? (side === "sellBase" ? bal.quote : bal.base) : null;
  const gasOk = bal ? bal.native >= SWAP_GAS_BUDGET * bal.gasPrice : true;
  const blocker = s.blocker(amt) ?? (!gasOk ? "Not enough HYPE for gas" : null);
  const live = a.mode === "LIVE" && a.status === "ok";

  return (
    <div className="relative min-h-[100svh] overflow-hidden px-4 pb-24 pt-32">
      <UsePageMode mode={live ? "LIVE" : a.mode === "RECORDED" ? "RECORDED" : null} />
      <div className="glow-mint pointer-events-none absolute left-1/2 top-24 h-[420px] w-[720px] -translate-x-1/2 opacity-50" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-40 -translate-x-1/2 opacity-[0.04]" aria-hidden>
        <Emblem className="h-[70vh] w-auto text-ink" />
      </div>

      <div className="relative mx-auto w-full max-w-[480px]">
        <h1 className="mb-6 text-center text-[clamp(2rem,4vw,2.8rem)] font-medium tracking-[-0.04em] text-ink">Swap</h1>

        <div className="rounded-[28px] border border-line bg-surface/90 p-2 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur">
          <Leg label="You pay" sym={t?.inSym} balance={inBal !== null && t ? num(Number(formatUnits(inBal, t.inDec)), 4) : null} onMax={inBal !== null && t ? () => setAmount(formatUnits(inBal, t.inDec)) : undefined}>
            <input
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              aria-label="Amount to pay"
              className="num w-full min-w-0 bg-transparent text-[34px] tracking-[-0.03em] text-ink placeholder:text-faint focus:outline-none"
            />
            <p className="num mt-1 text-xs text-muted">{amt ? usd(inUsd) : " "}</p>
          </Leg>
          <div className="relative z-10 -my-3 flex justify-center">
            <button
              onClick={() => setSide((x) => (x === "sellBase" ? "buyBase" : "sellBase"))}
              aria-label="Flip direction"
              className="flex h-10 w-10 items-center justify-center rounded-xl border-4 border-surface bg-raised text-ink transition hover:rotate-180 hover:text-mint"
            >
              ↓
            </button>
          </div>
          <Leg label="You receive" sym={t?.outSym} balance={outBal !== null && t ? num(Number(formatUnits(outBal, t.outDec)), 4) : null}>
            <p className="num truncate text-[34px] tracking-[-0.03em] text-ink">{chosen.out ? num(chosen.out, side === "sellBase" ? 2 : 4) : <span className="text-faint">0</span>}</p>
            <p className="mt-1 text-xs text-muted">≈ before price impact</p>
          </Leg>

          <div className="mt-2 grid grid-cols-2 gap-2 px-1">
            {(["aven", "control"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPool(p)}
                aria-pressed={pool === p}
                className={`rounded-2xl border p-3 text-left transition ${pool === p ? "border-mint/50 bg-raised" : "border-line hover:border-line-strong"}`}
              >
                <span className="flex items-center gap-1.5 text-xs text-ink">
                  <span className="h-2 w-2 rounded-full" style={{ background: p === "aven" ? "var(--color-aven)" : "var(--color-plain)" }} />
                  {p === "aven" ? "Aven pool" : "Plain pool"}
                </span>
                <span className="num mt-1.5 block text-sm text-ink">{q[p].fee === null ? "—" : `${pipsPct(q[p].fee!)} fee`}</span>
                <span className="num block text-[11px] text-muted">{q[p].out ? `${num(q[p].out, side === "sellBase" ? 2 : 4)} ${t?.outSym ?? ""}` : " "}</span>
              </button>
            ))}
          </div>

          {pool === "aven" && breakdown && (
            <div className="mx-1 mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-bg/50 px-3 py-2.5">
              <span className="mr-1 text-[11px] text-muted">Fee set by</span>
              {termsFired(breakdown, m?.params.stressThresholdBps ?? 50).map((x) => (
                <TermChip key={x} term={x} />
              ))}
            </div>
          )}

          <div className="p-1 pt-2">
            {!s.wallet.authenticated && s.wallet.enabled ? (
              <button onClick={s.wallet.login} className="btn btn-primary h-14 w-full rounded-2xl text-[17px]">
                Log in
              </button>
            ) : s.wallet.wrongChain ? (
              <button onClick={() => void s.wallet.switchChain()} className="btn btn-primary h-14 w-full rounded-2xl text-[17px]">
                Switch network
              </button>
            ) : (
              <button onClick={() => void s.execute(pool, side, amount, oracle)} disabled={!!blocker || !!s.step} className="btn btn-primary h-14 w-full rounded-2xl text-[17px] disabled:cursor-not-allowed disabled:opacity-40">
                {s.step ?? blocker ?? "Swap"}
              </button>
            )}
          </div>
        </div>

        {s.error && <p className="mt-3 text-center text-xs text-crit">{s.error}</p>}
        {s.last && (
          <p className="mt-3 text-center text-xs text-ink-2">
            Swapped: <TxLink hash={s.last} />
          </p>
        )}
        <p className="mt-6 text-center text-[11px] text-faint">
          {live ? "Fees: AvenHook.previewFee via the live Arena; plain pool is a static 0.30%." : "Quotes from the recorded Arena run. Swaps need the live deployment."}
        </p>
      </div>
    </div>
  );
}

function Leg({ label, sym, balance, onMax, children }: { label: string; sym?: string; balance: string | null; onMax?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-[22px] bg-raised/70 p-4">
      <p className="text-[13px] text-muted">{label}</p>
      <div className="mt-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <span className="shrink-0 rounded-full border border-line bg-surface px-3.5 py-2 text-[15px] font-medium text-ink">{sym ?? "—"}</span>
      </div>
      {balance !== null && (
        <p className="num mt-1 text-right text-[11px] text-muted">
          Balance {balance}
          {onMax && (
            <button onClick={onMax} className="ml-2 text-mint hover:underline">
              Max
            </button>
          )}
        </p>
      )}
    </div>
  );
}

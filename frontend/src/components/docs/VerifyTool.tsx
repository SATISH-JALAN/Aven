"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Hex } from "viem";
import { Card, MatchBadge, Notice, TxLink } from "@/components/ui";
import { WhatItProves } from "@/components/verify/Proof";
import { useArena } from "@/lib/arena";
import { config } from "@/config";
import { latestFeeComputedTx, verifyKnownInBrowser } from "@/lib/chain";
import { int } from "@/lib/format";
import { gsap } from "@/lib/gsap";

const TX = /^0x[0-9a-fA-F]{64}$/;
/** How many of the newest Aven-pool swaps "Verify recent swaps" checks (2 RPC calls each, paced). */
const MAX_VERIFY = 25;

type AllResult = { count: number; checkA: number; checkB: number; mismatches: Array<{ txHash?: string; onchainFee: number; recomputedFee: number }>; txs: number };

/** The swap verifier (was the /verify page): paste a tx, or verify the newest Aven-pool swaps the Arena knows. */
export function VerifyTool() {
  const a = useArena();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [tx, setTx] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState<AllResult | null>(null);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const d = a.deployments;
  const recorded = a.mode === "RECORDED";
  // A recording from this chain holds real, verifiable txs; one from another chain (e.g. local anvil) doesn't.
  const sameChainRecording = recorded && a.recorded?.chainId === config.chainId;
  const hashes = [...new Set(a.trades.filter((t) => t.pool === "aven").map((t) => t.txHash as Hex))].slice(0, MAX_VERIFY);
  const canVerify = !!d && hashes.length > 0 && (!recorded || sameChainRecording);

  const latest = async () => {
    setErr(null);
    if (recorded && a.recorded) return router.push(`/verify/${a.recorded.highlight.avenArb.txHash}`);
    const fromTape = a.trades.find((t) => t.pool === "aven");
    if (fromTape) return router.push(`/verify/${fromTape.txHash}`);
    if (!d) return setErr("No deployment is known yet, so there is no swap to verify.");
    setBusy(true);
    try {
      const h = await latestFeeComputedTx(d);
      if (h) router.push(`/verify/${h}`);
      else setErr("No FeeComputed event in the last 2,000 blocks.");
    } catch (e) {
      setErr((e as Error).message.split("\n")[0] ?? "RPC error");
    } finally {
      setBusy(false);
    }
  };

  const verifyAll = async () => {
    if (!d || !canVerify) return;
    setErr(null);
    setAll(null);
    setBusy(true);
    setScan({ done: 0, total: hashes.length });
    try {
      const r = await verifyKnownInBrowser(d, hashes, (done, total) => {
        setScan({ done, total });
        gsap.to(bar.current, { width: `${(done * 100) / total}%`, duration: 0.3, ease: "power2.out" });
      });
      setAll(r);
    } catch (e) {
      setErr((e as Error).message.split("\n")[0] ?? "RPC error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="not-prose">

      <Card className="p-3">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!TX.test(tx.trim())) return setErr("A tx hash is 0x followed by 64 hex characters.");
            router.push(`/verify/${tx.trim()}`);
          }}
        >
          <input
            value={tx}
            onChange={(e) => setTx(e.target.value)}
            placeholder="0x… transaction hash"
            spellCheck={false}
            aria-label="Transaction hash"
            className="num h-14 flex-1 rounded-full border border-line bg-bg px-6 text-[15px] text-ink placeholder:text-faint focus:border-mint/60 focus:outline-none"
          />
          <button className="btn btn-primary h-14 px-7">Verify</button>
          <button type="button" onClick={latest} disabled={busy} className="btn btn-ghost h-14 disabled:opacity-50">
            Latest swap
          </button>
        </form>
        {err && (
          <div className="mt-3">
            <Notice tone="error" title={err} />
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="h-card text-ink">Verify recent swaps</p>
            <p className="mt-1 text-sm text-muted">The newest {hashes.length > 0 ? int(hashes.length) : MAX_VERIFY} Aven-pool swaps the Arena knows, recomputed from the chain.</p>
          </div>
          <button
            onClick={verifyAll}
            disabled={busy || !canVerify}
            className="btn btn-ghost disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && scan ? "Scanning…" : "Run all"}
          </button>
        </div>
        {recorded && !sameChainRecording && <p className="mt-3 text-xs text-faint">The recorded run came from another chain, so its swaps can't be checked here.</p>}
        {!d && !recorded && <p className="mt-3 text-xs text-faint">No deployment on this chain yet.</p>}
        {d && (!recorded || sameChainRecording) && hashes.length === 0 && <p className="mt-3 text-xs text-faint">No Aven-pool swaps yet. Paste a tx hash above.</p>}
        <p className="mt-3 text-[11px] text-faint">One swap every 3 s, so the public RPC&apos;s limit (100 requests a minute) isn&apos;t hit. For a full scan, run <code>pnpm verify --all</code> with a dedicated RPC.</p>
        {scan && (
          <div className="mt-5">
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <div ref={bar} className="h-full w-0 rounded-full bg-ink" />
            </div>
            <p className="num mt-2 text-[11px] text-muted">
              {int(scan.done)} of {int(scan.total)} swaps
            </p>
          </div>
        )}
        {all && (
          <div className="mt-6 flex flex-wrap items-center gap-6">
            <p className="num text-5xl tracking-[-0.05em] text-ink">
              {int(all.count - all.mismatches.length)} <span className="text-faint">of</span> {int(all.count)}
            </p>
            <div className="text-xs text-ink-2">
              <p>matched across {int(all.txs)} transactions</p>
              <p className="num text-muted">
                check A {int(all.checkA)}/{int(all.count)} · check B {int(all.checkB)}/{int(all.count)}
              </p>
            </div>
            <MatchBadge ok={all.count > 0 && all.mismatches.length === 0} size="lg" />
            {all.mismatches.length > 0 && (
              <ul className="w-full space-y-1 text-xs">
                {all.mismatches.map((m, i) => (
                  <li key={i} className="flex gap-3 text-ink-2">
                    {m.txHash && <TxLink hash={m.txHash} />} on-chain {m.onchainFee} vs recomputed {m.recomputedFee}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <div className="mt-6">
        <WhatItProves />
      </div>
    </div>
  );
}

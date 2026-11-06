"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { useReveal } from "@/components/motion";
import { UsePageMode } from "@/components/shell";
import { Notice, PageHero, Skeleton, TxLink } from "@/components/ui";
import { Proof, WhatItProves } from "@/components/verify/Proof";
import { config } from "@/config";
import { useArena } from "@/lib/arena";
import { publicClient, verifyTxInBrowser } from "@/lib/chain";
import { int, shortHex } from "@/lib/format";
import type { VerifyResult } from "@aven/core/verify";

const recordedHitOf = (a: { recorded: { highlight: { avenArb: { txHash: string } } } | null }, tx: string) =>
  !!a.recorded && a.recorded.highlight.avenArb.txHash.toLowerCase() === tx.toLowerCase();

type Loaded = { results: VerifyResult[]; source: string; block?: bigint; status?: string };

export default function VerifyTxPage({ params }: { params: Promise<{ tx: string }> }) {
  const { tx } = use(params);
  const a = useArena();
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useReveal(ref, [!!data]);
  const valid = /^0x[0-9a-fA-F]{64}$/.test(tx);
  // Recorded proofs recompute with the recording's config/params; live ones need this chain's real deployment.
  const d = recordedHitOf(a, tx) ? a.math : a.deployments;
  const recordedHit = recordedHitOf(a, tx);

  useEffect(() => {
    if (!valid || a.status === "loading") return;
    let alive = true;
    setErr(null);
    (async () => {
      if (recordedHit && a.recorded) {
        setData({
          results: [a.recorded.highlight.verify],
          source: `recorded run (${a.recorded.recordedAt}) · inputs from its FeeComputed event · recomputed in your browser`,
        });
        return;
      }
      if (!d) throw new Error("No deployment is known for this chain, so the hook address is unknown.");
      const [v, receipt] = await Promise.all([verifyTxInBrowser(tx as Hex, d), publicClient().getTransactionReceipt({ hash: tx as Hex })]);
      if (!alive) return;
      if (!v.results.length) throw new Error("This transaction has no FeeComputed event from the Aven hook. It may be a plain-pool swap or another contract's tx.");
      setData({
        results: v.results,
        source: `${config.chainName} RPC receipt · @aven/core verifyLogs + feeSteps in your browser`,
        block: receipt.blockNumber,
        status: receipt.status,
      });
    })().catch((e: Error) => alive && setErr(e.message.split("\n")[0] ?? "Error"));
    return () => {
      alive = false;
    };
  }, [tx, valid, d, a.status, recordedHit, a.recorded]);

  return (
    <div ref={ref}>
      <UsePageMode mode={recordedHit ? "RECORDED" : "LIVE"} />
      <PageHero eyebrow="Fee proof" title="One swap, step by step.">
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/docs/verify" className="btn btn-ghost btn-sm">
            ← Verify
          </Link>
          <p className="num break-all rounded-full border border-line px-4 py-2 text-xs text-ink-2">
            {valid ? <TxLink hash={tx}>{shortHex(tx, 10)}</TxLink> : shortHex(tx)}
            {data?.block !== undefined && (
              <span className="text-muted">
                {" "}
                · block #{int(data.block)} · {data.status}
              </span>
            )}
          </p>
        </div>
      </PageHero>
      <div className="mx-auto max-w-4xl px-6 pb-10">

      <div>
        {!valid ? (
          <Notice tone="error" title="That is not a transaction hash">
            A tx hash is 0x followed by 64 hex characters.
          </Notice>
        ) : err ? (
          <Notice tone="error" title="Could not verify this transaction">
            {err}
          </Notice>
        ) : !data || !d ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : (
          data.results.map((r, i) => (
            <div key={i} className={i ? "mt-16 border-t border-line pt-16" : ""}>
              {data.results.length > 1 && (
                <p className="mb-4 text-xs text-muted">
                  FeeComputed #{i + 1} of {data.results.length} in this tx
                </p>
              )}
              <Proof result={r} d={d} source={data.source} />
            </div>
          ))
        )}
      </div>
      <div data-reveal className="mt-14">
        <WhatItProves />
      </div>
      </div>
    </div>
  );
}

"use client";
/**
 * Live HyperCore prices on the landing page, read in the browser with eth_call to the same precompiles the hook reads
 * (0x807 oracle, 0x806 mark). Needs no deployment and no Arena service.
 */
import { useEffect, useState } from "react";
import { readOracleMark } from "@aven/core/precompiles";
import { config } from "@/config";
import { publicClient, useBlockNumber } from "@/lib/chain";
import { num } from "@/lib/format";

/** Perp read on the landing page: the deployment's, else the recon-verified ETH index for the chain. */
export function landingPerp(): { index: number; szDecimals: number; coin: string } | null {
  const d = config.deployments;
  if (d) return { index: d.config.perpIndex, szDecimals: d.config.szDecimals, coin: d.tokens.baseSymbol.replace(/^a/, "") };
  if (config.chainId === 998) return { index: 4, szDecimals: 4, coin: "ETH" }; // recon C.6
  if (config.chainId === 999) return { index: 1, szDecimals: 4, coin: "ETH" }; // info API meta, 2026-11-06
  return null;
}

export interface LivePx {
  oracle: number;
  mark: number;
  premiumBps: number;
  ok: boolean;
}

export function useLivePx(intervalMs = 3_000): LivePx | null {
  const [px, setPx] = useState<LivePx | null>(null);
  useEffect(() => {
    const perp = landingPerp();
    if (!perp) return;
    let alive = true;
    const scale = 10 ** (6 - perp.szDecimals);
    const tick = async () => {
      if (document.visibilityState !== "visible") return; // the public RPC limit is per IP, shared by every tab
      const r = await readOracleMark(publicClient(), perp.index);
      if (!alive) return;
      if (!r.readOk) return setPx((p) => (p ? { ...p, ok: false } : null));
      setPx({
        oracle: Number(r.oracleRaw) / scale,
        mark: Number(r.markRaw) / scale,
        premiumBps: Number(((r.markRaw - r.oracleRaw) * 10_000n) / r.oracleRaw),
        ok: true,
      });
    };
    void tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return px;
}

export function LiveTicker({ className = "" }: { className?: string }) {
  const px = useLivePx();
  const rpc = useBlockNumber();
  const perp = landingPerp();
  const cells: Array<[string, string]> = [
    [`${perp?.coin ?? "—"} oracle`, px ? num(px.oracle, 2) : "…"],
    ["Mark", px ? num(px.mark, 2) : "…"],
    ["Premium", px ? `${px.premiumBps > 0 ? "+" : ""}${px.premiumBps} bp` : "…"],
    ["Block", rpc.block ? `#${rpc.block.toLocaleString("en-US")}` : "…"],
  ];
  return (
    <div className={`rounded-3xl border border-line bg-surface/70 p-1.5 backdrop-blur-xl ${className}`} title={`eth_call to 0x807 / 0x806 on ${config.chainName}`}>
      <div className="flex items-center justify-between gap-4 px-3.5 pb-2 pt-2">
        <span className="flex items-center gap-2 text-xs text-ink-2">
          <span className={`h-1.5 w-1.5 rounded-full ${rpc.error ? "bg-crit" : "live-dot bg-mint text-mint"}`} />
          {rpc.error ? "RPC down" : "Live · read in-block"}
        </span>
        <span className="text-[11px] text-faint">HyperCore · {config.chainName}</span>
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {cells.map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-raised/70 px-4 py-3">
            <p className="text-[11px] text-muted">{k}</p>
            <p className="num mt-1 text-[15px] text-ink">{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

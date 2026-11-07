"use client";
/**
 * "Your activity on Aven", shown when a wallet connects. A side drawer (portalled to <body>, outside the
 * ScrollSmoother transform) with the connected wallet's swaps, liquidity and mints read from the chain
 * (useWalletActivity: aETH/aUSD Transfer logs → receipts; cached in localStorage, refilled from the chain).
 *
 * Mounted once (layout). It opens by itself when a wallet connects, once per address per browser session (closing it
 * means "seen"; Disconnect clears that), and from the address chip in the nav at any time.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ActivityList, rowsFor } from "@/components/onchain/Portfolio";
import { ScanBar } from "@/components/onchain/Ledger";
import { useWallet } from "@/components/wallet";
import { useArena } from "@/lib/arena";
import { int, shortHex, usd } from "@/lib/format";
import { useLedger, useWalletActivity } from "@/lib/onchain";

let open = false;
const listeners = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  listeners.forEach((l) => l());
};
/** Open the activity drawer (the nav's address chip calls this). */
export const openWalletActivity = () => setOpen(true);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const seenKey = (a: string) => `aven:activity-seen:${a.toLowerCase()}`;
const shownThisLoad = new Set<string>(); // StrictMode runs effects twice: decide once per page load (MEMORY.md)
/** Forget that this address saw its activity, so the next connect shows it again. */
export function forgetActivitySeen(address: string | null) {
  if (!address) return;
  shownThisLoad.delete(address.toLowerCase());
  try {
    sessionStorage.removeItem(seenKey(address));
  } catch {}
}

export function WalletActivityHost() {
  const w = useWallet();
  const isOpen = useSyncExternalStore(subscribe, () => open, () => false);

  // Auto-open on connect: once per address per session.
  useEffect(() => {
    const a = w.address?.toLowerCase();
    if (!a || shownThisLoad.has(a)) return;
    shownThisLoad.add(a);
    let seen = false;
    try {
      seen = sessionStorage.getItem(seenKey(a)) === "1";
    } catch {}
    if (seen) return;
    try {
      sessionStorage.setItem(seenKey(a), "1");
    } catch {}
    setOpen(true);
  }, [w.address]);

  // Close when the wallet goes away.
  useEffect(() => {
    if (!w.address && open) setOpen(false);
  }, [w.address]);

  if (!isOpen || !w.address || typeof document === "undefined") return null;
  return createPortal(<Drawer address={w.address} onClose={() => setOpen(false)} />, document.body);
}

function Drawer({ address, onClose }: { address: `0x${string}`; onClose: () => void }) {
  const a = useArena();
  const d = a.math;
  const s = useWalletActivity(d, address);
  const ledger = useLedger(d);
  const txs = useMemo(() => s?.items ?? [], [s]);
  const rows = useMemo(() => (d ? rowsFor(txs, ledger?.items ?? [], d, a.state?.oracle.price ?? null) : []), [txs, ledger, d, a.state?.oracle.price]);
  const fees = rows.reduce((t, x) => t + (x.feeUsd ?? 0), 0);
  const aven = rows.filter((x) => x.r.e.pool === "aven").length;
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Your activity on Aven">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto border-l border-line bg-bg p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-faint">Your activity on Aven</p>
            <p className="num mt-1 text-sm text-ink" title={address}>
              {shortHex(address, 6)}
            </p>
          </div>
          <button ref={closeBtn} onClick={onClose} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink" aria-label="Close">
            Esc ✕
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 text-xs">
          <Stat k="Transactions" v={int(txs.length)} />
          <Stat k="Swaps (Aven)" v={`${int(rows.length)} (${int(aven)})`} />
          <Stat k="Fees paid" v={usd(fees)} />
        </div>

        <div className="mt-4">
          <ScanBar s={s} what="your history" />
        </div>
        <p className="mt-2 text-[11px] text-faint">Read from HyperEVM logs in your browser, not from our server. Newest first; older blocks fill in as the scan runs.</p>

        <div className="mt-5 flex-1">{d ? <ActivityList txs={txs} swapRows={rows} d={d} /> : <p className="text-xs text-muted">Waiting for the deployment config…</p>}</div>

        <div className="mt-6 flex items-center justify-between border-t border-line pt-4 text-xs">
          <span className="text-faint">Live mainnet · source: chain</span>
          <Link href="/portfolio" onClick={onClose} className="text-ink underline decoration-line-strong underline-offset-4 hover:text-mint">
            Open full portfolio →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-faint">{k}</p>
      <p className="num mt-1 text-sm text-ink">{v}</p>
    </div>
  );
}

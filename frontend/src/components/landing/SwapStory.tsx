"use client";
/**
 * Product moment: a swap card that morphs through three market states while pinned (01 / 03). The fees are not
 * hard-coded: each state's inputs run through the exact BigInt port of AvenFairValue (@aven/core/fee compute).
 */
import { useMemo, useRef, useState } from "react";
import { compute, defaultParams, reasonName, type Config, type Inputs } from "@aven/core/fee";
import { sqrtPriceFromWad } from "@aven/core/price";
import { Emblem } from "@/components/brand";
import { TermChip } from "@/components/ui";
import { int, num, pipsPct } from "@/lib/format";
import { MOTION_OK, ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";
import { termsFired, type Term } from "@/lib/steps";

const CFG: Config = { perpIndex: 4, szDecimals: 4, baseIsToken0: true, decimals0: 18, decimals1: 6 };
const P = defaultParams();
const ORACLE = 224_002n; // 2,240.02 (testnet ETH, recorded run)
const WAD = 10n ** 18n;
const oracleWad = ORACLE * 10n ** 16n;

function inputs(poolBps: number, markBps: number, anchorBps: number, zeroForOne: boolean): Inputs {
  const pool = sqrtPriceFromWad(CFG, (oracleWad * BigInt(10_000 + poolBps)) / 10_000n);
  const mark = (ORACLE * BigInt(10_000 + markBps)) / 10_000n;
  return { oracleRaw: ORACLE, markRaw: mark, anchorMarkRaw: anchorBps === 0 ? mark : (mark * 10_000n) / BigInt(10_000 + anchorBps), sqrtPriceX96: pool, sqrtPriceTopX96: pool, zeroForOne, readOk: true };
}

const STATES = [
  { k: "01", name: "Calm market", line: "At fair value, everyone pays the base fee.", pool: 0, mark: 0, anchor: 0, tone: "mint" },
  { k: "02", name: "Stale pool", line: "Pool 1.64% off fair. Only the arbitrage side pays the gap.", pool: 164, mark: 0, anchor: 0, tone: "pink" },
  { k: "03", name: "Perp stress", line: "Mark moved 1.2% in a minute. Every swap pays a bit more.", pool: 0, mark: 0, anchor: 120, tone: "warn" },
] as const;

export function SwapStory() {
  const root = useRef<HTMLElement>(null);
  const [i, setI] = useState(0);
  const quotes = useMemo(
    () =>
      STATES.map((s) => {
        const sell = compute(CFG, P, inputs(s.pool, s.mark, s.anchor, true));
        const buy = compute(CFG, P, inputs(s.pool, s.mark, s.anchor, false));
        const j = (b: typeof sell) => ({ fee: b.fee, reason: reasonName(b.reason), arb: b.arb, withPressure: b.withPressure, gapBps: Number(b.gapBps), moveBps: Number(b.moveBps) });
        return { sell: j(sell), buy: j(buy), poolPx: (Number(oracleWad) / 1e18) * (1 + s.pool / 10_000) };
      }),
    [],
  );
  const feeEl = useRef<HTMLSpanElement>(null);
  const shown = useRef({ v: quotes[0]!.sell.fee });

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(`${MOTION_OK} and (min-width: 900px)`, () => {
        const st = ScrollTrigger.create({
          trigger: root.current,
          start: "top top",
          end: "+=220%",
          pin: true,
          scrub: true,
          anticipatePin: 1,
          onUpdate: (self) => setI(Math.min(STATES.length - 1, Math.floor(self.progress * STATES.length * 0.999))),
        });
        gsap.from(root.current!.querySelector("[data-card]"), { y: 80, rotateX: 12, autoAlpha: 0, duration: 1.2, ease: "expo.out", scrollTrigger: { trigger: root.current, start: "top 75%", once: true } });
        return () => st.kill();
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  // Roll the headline fee and pulse the card on every state change.
  useGSAP(
    () => {
      const target = quotes[i]!.sell.fee;
      gsap.to(shown.current, { v: target, duration: 0.9, ease: "expo.out", onUpdate: () => feeEl.current && (feeEl.current.textContent = pipsPct(Math.round(shown.current.v))) });
      gsap.fromTo(root.current!.querySelectorAll("[data-swap-line]"), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.05, ease: "expo.out" });
      gsap.fromTo(root.current!.querySelector("[data-glow]"), { scale: 0.85, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 1.2, ease: "expo.out" });
    },
    { dependencies: [i], scope: root },
  );

  const s = STATES[i]!;
  const q = quotes[i]!;
  const glow = s.tone === "mint" ? "#97fce4" : s.tone === "pink" ? "#ff4fb8" : "#fab219";
  const fired = (b: (typeof q)["sell"]): Term[] => termsFired(b, P.stressThresholdBps);

  return (
    <section ref={root} className="relative flex min-h-[100svh] items-center overflow-hidden">
      <div className="mx-auto grid w-full max-w-7xl items-center gap-14 px-6 py-24 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-[13px] font-medium text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" /> One hook, three markets
          </p>
          <div className="mb-8 flex flex-wrap gap-2" role="tablist" aria-label="Market state">
            {STATES.map((x, k) => (
              <button
                key={x.k}
                role="tab"
                aria-selected={k === i}
                onClick={() => setI(k)}
                className={`rounded-full px-4 py-2 text-sm transition ${k === i ? "bg-ink text-bg" : "border border-line text-muted hover:text-ink"}`}
              >
                {x.name}
              </button>
            ))}
          </div>
          <p data-swap-line className="h-section text-ink">
            {s.name}
          </p>
          <p data-swap-line className="lede mt-5 max-w-sm">
            {s.line}
          </p>
          <p data-swap-line className="mt-10 text-[11px] text-faint">
            Illustrative inputs. Fees from the real fee math (@aven/core compute).
          </p>
        </div>

        <div className="relative [perspective:1200px]">
          <div data-glow className="pointer-events-none absolute -inset-10 rounded-full blur-[90px] transition-colors duration-700" style={{ background: `radial-gradient(circle, ${glow}33 0%, transparent 65%)` }} />
          <div data-card className="relative mx-auto max-w-md rounded-[32px] border border-line-strong bg-surface/90 p-2 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2 text-sm text-ink">
                <Emblem className="h-4 w-auto text-mint" /> Swap
              </span>
              <span className="text-xs text-muted">aETH / aUSD · Aven pool</span>
            </div>
            <div className="rounded-[24px] bg-raised p-5">
              <p className="text-sm text-muted">You sell</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="num text-4xl text-ink">1.00</span>
                <span className="rounded-full border border-line-strong px-3 py-1 text-sm text-ink">aETH</span>
              </div>
            </div>
            <div className="relative z-10 -my-3 flex justify-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border-4 border-surface bg-raised text-ink-2">↓</span>
            </div>
            <div className="rounded-[24px] bg-raised p-5">
              <p className="text-sm text-muted">You receive ≈</p>
              <div className="mt-1 flex items-center justify-between">
                <span data-swap-line className="num text-4xl text-ink">
                  {num(q.poolPx * (1 - q.sell.fee / 1e6), 2)}
                </span>
                <span className="rounded-full border border-line-strong px-3 py-1 text-sm text-ink">aUSD</span>
              </div>
            </div>
            <div className="mt-2 space-y-3 rounded-[24px] border border-line p-5">
              <div className="flex items-end justify-between">
                <span className="text-xs text-muted">LP fee, selling</span>
                <span ref={feeEl} className="num text-4xl tracking-[-0.04em] text-ink">
                  {pipsPct(q.sell.fee)}
                </span>
              </div>
              <div data-swap-line className="flex flex-wrap gap-1">
                {(["base", "gap", "premium", "stress", "fallback"] as Term[]).map((t) => (
                  <TermChip key={t} term={t} active={fired(q.sell).includes(t)} />
                ))}
              </div>
              <div data-swap-line className="flex items-center justify-between border-t border-line pt-3 text-xs">
                <span className="text-muted">Same block, buying instead</span>
                <span className="num text-ink-2">
                  {pipsPct(q.buy.fee)} · {int(q.buy.fee)} pips
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Pool vs fair value</span>
                <span className="num text-ink-2">{q.sell.gapBps ? `+${q.sell.gapBps} bp (computed)` : "at fair"}</span>
              </div>
            </div>
            <div aria-hidden className="mt-2 w-full rounded-[24px] bg-mint py-4 text-center text-base font-semibold text-bg">
              Swap
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export const _testing = { CFG, P, inputs, STATES, WAD };

"use client";
/**
 * Step-by-step fee proof for one FeeComputed event: decoded fields → scaled prices → gap → direction → premium →
 * stress ("velocity" of the mark vs its time-weighted anchor) → each term in pips → value before the clamp → fee →
 * on-chain vs recomputed. A rail draws down the steps as you scroll (DrawSVG, scrubbed).
 */
import { useRef } from "react";
import { MatchBadge, Notice, Src } from "@/components/ui";
import { FV_LINES, FV_PATH, config, type Deployments } from "@/config";
import { int, pipsPct } from "@/lib/format";
import { MOTION_OK, ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";
import { feeSteps, inputsFromRecord } from "@/lib/steps";
import type { VerifyResult } from "@aven/core/verify";

const WAD = 10n ** 18n;
function wadStr(w: bigint, digits = 6): string {
  const whole = w / WAD;
  const frac = (w % WAD).toString().padStart(18, "0").slice(0, digits);
  return `${whole.toLocaleString("en-US")}.${frac}`;
}
const b = (x: bigint) => x.toLocaleString("en-US");

function CodeLink({ line, label = "AvenFairValue.sol" }: { line: number; label?: string }) {
  return (
    <a href={config.sourceUrl(FV_PATH, line)} target="_blank" rel="noreferrer" className="num text-[10px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
      {label}#L{line} ↗
    </a>
  );
}

function Step({ n, title, line, children }: { n: string; title: string; line: number; children: React.ReactNode }) {
  return (
    <div data-step className="relative pl-12">
      <span data-dot className="absolute left-[7px] top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line-strong bg-bg text-[9px] text-muted">
        {n}
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">{title}</p>
        <CodeLink line={line} />
      </div>
      <div className="mt-3 rounded-[20px] border border-line bg-surface/70 p-5 text-xs">{children}</div>
    </div>
  );
}

function Row({ k, v, note }: { k: string; v: React.ReactNode; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line/50 py-1.5 last:border-0">
      <span className="text-muted">{k}</span>
      <span className="num text-right text-ink">
        {v}
        {note && <span className="ml-2 font-sans text-[10px] text-faint">{note}</span>}
      </span>
    </div>
  );
}

export function Proof({ result, d, source }: { result: VerifyResult; d: Deployments; source: string }) {
  const root = useRef<HTMLDivElement>(null);
  const s = feeSteps(d.config, d.params, inputsFromRecord(result.inputs));
  const p = d.params;
  const ok = s.consistent && s.fee === result.onchainFee;
  const fullMatch = ok && (result.swapEventFee === null || result.checkB);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const rail = root.current!.querySelector("[data-rail-fill]");
        gsap.fromTo(rail, { drawSVG: "0%" }, { drawSVG: "100%", ease: "none", scrollTrigger: { trigger: "[data-steps]", start: "top 70%", end: "bottom 70%", scrub: 0.6 } });
        gsap.utils.toArray<HTMLElement>("[data-step]", root.current).forEach((el) => {
          const dot = el.querySelector("[data-dot]");
          gsap.from(el, { autoAlpha: 0, x: 30, duration: 0.9, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 85%", once: true } });
          ScrollTrigger.create({
            trigger: el,
            start: "top 70%",
            onEnter: () => gsap.to(dot, { backgroundColor: "#97fce4", color: "#070908", borderColor: "#97fce4", duration: 0.3 }),
            onLeaveBack: () => gsap.to(dot, { backgroundColor: "#070908", color: "#7c8682", borderColor: "#2b3230", duration: 0.3 }),
          });
        });
        gsap.from("[data-verdict]", { scale: 0.85, autoAlpha: 0, duration: 1, ease: "back.out(1.6)", scrollTrigger: { trigger: "[data-verdict]", start: "top 85%", once: true } });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  const dirLabel = s.sellingBase ? "selling base" : "buying base";
  const side = s.above ? "above" : s.below ? "below" : "exactly at";

  return (
    <div ref={root}>
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        {[
          ["On-chain fee (FeeComputed)", result.onchainFee],
          ["Recomputed here, in TypeScript", s.fee],
          ["PoolManager Swap event", result.swapEventFee],
        ].map(([k, v]) => (
          <div key={k as string} className="panel p-6">
            <p className="num text-4xl tracking-[-0.04em] text-ink">{v === null ? "—" : int(v as number)}</p>
            <p className="mt-2 text-sm text-muted">{k as string} · pips</p>
          </div>
        ))}
      </div>

      <div data-steps className="relative space-y-8">
        <svg className="pointer-events-none absolute left-[15px] top-2 h-[calc(100%-1rem)] w-[2px] overflow-visible" preserveAspectRatio="none" viewBox="0 0 2 100" aria-hidden>
          <line x1="1" y1="0" x2="1" y2="100" stroke="var(--color-line)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <line data-rail-fill x1="1" y1="0" x2="1" y2="100" stroke="var(--color-ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>

        <Step n="1" title="Decoded FeeComputed fields" line={FV_LINES.readPrices}>
          <Row k="poolId" v={<span className="break-all">{result.inputs.poolId}</span>} />
          <Row k="sender (router)" v={result.inputs.sender} />
          <Row k="zeroForOne" v={result.inputs.zeroForOne} note={dirLabel} />
          <Row k="reason" v={result.inputs.reason} />
          <Row k="oracleRaw (0x807)" v={result.inputs.oracleRaw} />
          <Row k="markRaw (0x806)" v={result.inputs.markRaw} />
          <Row k="anchorMarkRaw" v={result.inputs.anchorMarkRaw} note="time-weighted mark before this swap" />
          <Row k="sqrtPriceX96" v={<span className="break-all">{result.inputs.sqrtPriceX96}</span>} />
          <Row k="sqrtPriceTopX96" v={<span className="break-all">{result.inputs.sqrtPriceTopX96}</span>} note="pool price at the block's first swap" />
          <Row k="readOk" v={String(s.readOk)} note="both precompile reads succeeded" />
        </Step>

        {!s.readOk ? (
          <Step n="2" title="Fallback: a price read failed" line={FV_LINES.step2}>
            <p className="text-ink-2">The hook never reverts on a bad read (I1). It charges the fallback fee.</p>
            <Row k="fallbackFee" v={`${p.fallbackFee} pips`} />
          </Step>
        ) : (
          <>
            <Step n="2" title="Scale prices to wad (1e18)" line={FV_LINES.step3}>
              <Row k="oracle" v={wadStr(s.oracleWad)} note={`raw · 10^(12 + szDecimals ${d.config.szDecimals})`} />
              <Row k="pool now" v={wadStr(s.curWad)} note="from sqrtPriceX96, decimals-adjusted" />
              <Row k="pool at top of block" v={wadStr(s.topWad)} />
            </Step>
            <Step n="3" title="Gap to fair value, anchored at the top of the block" line={FV_LINES.step4}>
              <Row k="gap now" v={`${b(s.gapCur)} bp`} />
              <Row k="gap at top of block" v={`${b(s.gapTop)} bp`} />
              <Row k="pool vs oracle" v={side} note={s.topSameSide ? "top of block on the same side → take the larger gap" : "use the current gap"} />
              <Row k="gapBps" v={`${b(s.gapBps)} bp`} note={s.gapTooLarge ? `> maxGapBps ${p.maxGapBps}: treated as a bad read` : `≤ maxGapBps ${p.maxGapBps}`} />
            </Step>
            {s.gapTooLarge ? (
              <Step n="4" title="Gap too large: fallback fee" line={FV_LINES.step4}>
                <Row k="fallbackFee" v={`${p.fallbackFee} pips`} />
              </Step>
            ) : (
              <>
                <Step n="4" title="Direction: does this swap close the gap?" line={FV_LINES.step5}>
                  <Row k="swap side" v={dirLabel} />
                  <Row k="arbitrage direction" v={s.arb ? "yes" : "no"} note={s.arb ? "it moves the pool back toward fair" : "it does not close the gap"} />
                </Step>
                <Step n="5" title="Perp pressure (premium)" line={FV_LINES.step6}>
                  <Row k="premiumBps" v={`${b(s.premiumBps)} bp`} note="(mark − oracle) · 10000 / oracle, truncated" />
                  <Row k="with pressure" v={s.withPressure ? "yes" : "no"} note="trading the same way the perp market leans" />
                </Step>
                <Step n="6" title="Stress: how fast the mark is moving (velocity)" line={FV_LINES.step7}>
                  <Row k="moveBps" v={`${b(s.moveBps)} bp`} note={result.inputs.anchorMarkRaw === "0" ? "no anchor yet" : "|mark − anchor| · 10000 / anchor"} />
                  <Row k="threshold" v={`${p.stressThresholdBps} bp`} />
                </Step>
                <Step n="7" title="Each term in pips, then the clamp" line={FV_LINES.step8}>
                  <Row k="base" v={b(s.terms.base)} />
                  <Row k={`gap · ${p.gapWeight}`} v={b(s.terms.gap)} note={s.arb ? `${b(s.gapBps)} × ${p.gapWeight}` : "not arb → 0"} />
                  <Row k={`premium · ${p.premiumWeight}`} v={b(s.terms.premium)} note={s.withPressure ? undefined : "no pressure → 0"} />
                  <Row k={`stress · ${p.stressWeight}`} v={b(s.terms.stress)} note={s.terms.stress > 0n ? `(${b(s.moveBps)} − ${p.stressThresholdBps}) × ${p.stressWeight}` : "below threshold → 0"} />
                  <Row k="value before the clamp" v={b(s.raw)} />
                  <Row k={`clamp to [${p.minFee}, ${p.maxFee}]`} v={`${int(s.fee)} pips = ${pipsPct(s.fee)}`} note={s.clamp ? `clamped to the ${s.clamp}` : "inside the range"} />
                </Step>
              </>
            )}
          </>
        )}
      </div>

      <div data-verdict className="panel mt-12 flex flex-col items-center gap-4 p-10 text-center">
        <MatchBadge ok={fullMatch} size="lg" />
        <p className="max-w-lg text-sm text-ink-2">
          Check A: the fee recomputed from the logged inputs {ok ? "equals" : "does NOT equal"} the fee the hook emitted ({int(s.fee)} vs {int(result.onchainFee)}).{" "}
          {result.swapEventFee === null
            ? "Check B: no matching Swap event was found."
            : `Check B: the PoolManager charged ${int(result.swapEventFee)} pips ${result.checkB ? "(as expected)" : "(UNEXPECTED)"}.`}
        </p>
        {!s.consistent && <Notice tone="error" title="The walkthrough disagrees with compute(); please report this." />}
        <Src>{source}</Src>
      </div>
    </div>
  );
}

export function WhatItProves() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="panel p-6">
        <p className="text-[15px] font-medium text-ink">✓ What this proves</p>
        <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-2">
          <li>The fee is exactly the published formula applied to the inputs the hook logged (check A).</li>
          <li>The PoolManager charged exactly that fee on the swap (check B, from its own Swap event).</li>
          <li>The TypeScript recompute is an exact BigInt port, matched against 10,000 Solidity vectors.</li>
        </ul>
      </div>
      <div className="panel p-6">
        <p className="text-[15px] font-medium text-ink">⚠ What it doesn&apos;t prove</p>
        <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-ink-2">
          <li>That the logged oracle and mark equal HyperCore&apos;s history: the RPC serves only the latest state. Compare against the info API candles by hand.</li>
          <li>That the parameters are optimal. They are the spec defaults, calibrated, not tuned.</li>
        </ul>
      </div>
    </div>
  );
}

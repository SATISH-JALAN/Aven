"use client";
/**
 * Pinned, scrubbed story in three chapters (01 / 03):
 *   01 the perp market moves (mint line draws)        02 the pool is stale; the gap goes to arbitrage (pink)
 *   03 Aven charges the gap; LPs keep about half of it (mint fills the gap)
 * Pure SVG + GSAP DrawSVG / scrub. On small screens or reduced motion the final frame is shown statically.
 */
import { useRef } from "react";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";

const W = 1200;
const H = 520;
const X0 = 60;
const X1 = W - 60;
const SHOCK = 470;
const ARB = 840;

// Deterministic market walk with a jump at SHOCK.
function marketPoints(): Array<[number, number]> {
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const pts: Array<[number, number]> = [];
  let y = 360;
  for (let x = X0; x <= X1; x += 12) {
    y += r() * 8;
    if (x < SHOCK) y += (360 - y) * 0.15; // calm, mean-reverting
    if (x > SHOCK && x < SHOCK + 150) y -= 13; // sharp rally on the perp market
    if (x >= SHOCK + 150) y += (150 - y) * 0.05 + r() * 4;
    pts.push([x, Math.max(90, Math.min(430, y))]);
  }
  return pts;
}

const MARKET = marketPoints();
const yAt = (x: number) => MARKET.reduce((b, p) => (Math.abs(p[0] - x) < Math.abs(b[0] - x) ? p : b))[1];
const POOL_BEFORE = yAt(SHOCK - 12);
const marketD = MARKET.map(([x, y], i) => `${i ? "L" : "M"}${x},${y.toFixed(1)}`).join("");
// The pool follows only slowly (stale) until the arbitrageur moves it at ARB.
const poolD = `M${X0},${POOL_BEFORE + 6} H${SHOCK} L${ARB},${POOL_BEFORE - 6} L${ARB},${yAt(ARB) + 4} L${X1},${yAt(X1) + 4}`;
const gapSeg = MARKET.filter(([x]) => x >= SHOCK && x <= ARB);
const gapTop = gapSeg.map(([x, y]) => `${x},${y.toFixed(1)}`).join(" ");
const poolLine = (x: number) => POOL_BEFORE + 6 - ((x - SHOCK) / (ARB - SHOCK)) * 12;
const gapD = `${gapTop} ${[...gapSeg].reverse().map(([x]) => `${x},${poolLine(x).toFixed(1)}`).join(" ")}`;
const keptD = `${gapSeg.map(([x, y]) => `${x},${((y + poolLine(x)) / 2).toFixed(1)}`).join(" ")} ${[...gapSeg].reverse().map(([x]) => `${x},${poolLine(x).toFixed(1)}`).join(" ")}`;

const CHAPTERS = [
  { k: "01", t: "The perp market moves first.", s: "Market" },
  { k: "02", t: "Stale pools leak the gap.", s: "Arbitrage" },
  { k: "03", t: "Aven charges it. LPs keep it.", s: "Aven" },
];

export function GapStory() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const mm = gsap.matchMedia();
      mm.add(`${MOTION_OK} and (min-width: 768px)`, () => {
        gsap.set(q("[data-market], [data-pool]"), { drawSVG: "0%" });
        gsap.set(q("[data-gap]"), { autoAlpha: 0 });
        gsap.set(q("[data-kept]"), { autoAlpha: 0, scaleY: 0, transformOrigin: "50% 100%" });
        gsap.set(q("[data-ch]"), { autoAlpha: 0, y: 40 });
        gsap.set(q("[data-ch='0']"), { autoAlpha: 1, y: 0 });
        gsap.set(q("[data-tag]"), { autoAlpha: 0, scale: 0.8 });
        const tl = gsap.timeline({ scrollTrigger: { trigger: root.current, start: "top top", end: "+=260%", scrub: 0.8, pin: true, anticipatePin: 1 } });
        tl.to(q("[data-market]"), { drawSVG: "100%", duration: 1, ease: "none" }, 0)
          .to(q("[data-pool]"), { drawSVG: "100%", duration: 1, ease: "none" }, 0)
          .to(q("[data-tag='shock']"), { autoAlpha: 1, scale: 1, duration: 0.15 }, 0.42)
          .to(q("[data-ch='0']"), { autoAlpha: 0, y: -40, duration: 0.2 }, 1)
          .to(q("[data-ch='1']"), { autoAlpha: 1, y: 0, duration: 0.2 }, 1.05)
          .to(q("[data-gap]"), { autoAlpha: 1, duration: 0.4 }, 1.05)
          .to(q("[data-tag='arb']"), { autoAlpha: 1, scale: 1, duration: 0.2 }, 1.3)
          .to(q("[data-ch='1']"), { autoAlpha: 0, y: -40, duration: 0.2 }, 2)
          .to(q("[data-ch='2']"), { autoAlpha: 1, y: 0, duration: 0.2 }, 2.05)
          .to(q("[data-kept]"), { autoAlpha: 1, scaleY: 1, duration: 0.6, ease: "power2.out" }, 2.05)
          .to(q("[data-tag='kept']"), { autoAlpha: 1, scale: 1, duration: 0.2 }, 2.4)
          .to(q("[data-prog]"), { scaleX: 1, ease: "none", duration: 3 }, 0)
          .to({}, { duration: 0.4 });
        // Chapter counter
        CHAPTERS.forEach((_, i) => tl.to(q(`[data-dot='${i}']`), { color: "var(--color-ink)", duration: 0.1 }, i === 0 ? 0 : i + 0.05));
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative flex min-h-[100svh] items-center overflow-hidden">
      <div className="mx-auto w-full max-w-7xl px-6 py-20">
        <div className="mb-10 flex items-end justify-between gap-6">
          <div className="relative min-h-[150px] flex-1 md:min-h-[130px]">
            {CHAPTERS.map((c, i) => (
              <div key={c.k} data-ch={i} className="md:absolute md:inset-x-0 md:bottom-0 max-md:mb-6">
                <p className="mb-4 inline-flex items-center gap-2 text-[13px] font-medium text-mint">
                  <span className="num text-muted">{c.k}</span> {c.s}
                </p>
                <p className="h-section max-w-5xl text-ink">{c.t}</p>
              </div>
            ))}
          </div>
          <div className="num hidden shrink-0 gap-2 text-sm text-faint md:flex">
            {CHAPTERS.map((c, i) => (
              <span key={c.k} data-dot={i} className="rounded-full border border-line px-3 py-1">
                {c.k}
              </span>
            ))}
          </div>
        </div>

        <div className="panel relative overflow-hidden">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Market price moves; the stale pool lags; the gap goes to arbitrage; Aven charges it as a fee to LPs">
            <defs>
              <linearGradient id="gs-gap" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#ff4fb8" stopOpacity="0.55" />
                <stop offset="1" stopColor="#ff4fb8" stopOpacity="0.12" />
              </linearGradient>
              <linearGradient id="gs-kept" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#97fce4" stopOpacity="0.75" />
                <stop offset="1" stopColor="#97fce4" stopOpacity="0.25" />
              </linearGradient>
            </defs>
            {Array.from({ length: 9 }, (_, i) => (
              <line key={i} x1={X0} x2={X1} y1={80 + i * 45} y2={80 + i * 45} stroke="var(--color-line)" strokeWidth="1" />
            ))}
            <polygon data-gap points={gapD} fill="url(#gs-gap)" />
            <polygon data-kept points={keptD} fill="url(#gs-kept)" />
            <path data-pool d={poolD} fill="none" stroke="var(--color-ink-2)" strokeWidth="2.5" strokeLinejoin="round" />
            <path data-market d={marketD} fill="none" stroke="var(--color-mint)" strokeWidth="2.5" strokeLinejoin="round" />

            <g data-tag="shock" style={{ transformOrigin: `${SHOCK}px ${POOL_BEFORE - 70}px` }}>
              <line x1={SHOCK} x2={SHOCK} y1={60} y2={H - 40} stroke="var(--color-line-strong)" strokeDasharray="3 5" />
              <rect x={SHOCK - 64} y={36} width={128} height={26} rx={13} fill="var(--color-bg)" stroke="var(--color-line-strong)" />
              <text x={SHOCK} y={53} textAnchor="middle" className="fill-[var(--color-ink-2)] text-[12px]">
                perp reprices
              </text>
            </g>
            <g data-tag="arb" style={{ transformOrigin: `${ARB}px 100px` }}>
              <rect x={ARB - 84} y={POOL_BEFORE + 30} width={168} height={28} rx={14} fill="var(--color-bg)" stroke="#ff4fb8" strokeOpacity="0.7" />
              <text x={ARB} y={POOL_BEFORE + 49} textAnchor="middle" className="fill-[#ffb3df] text-[12px]">
                gap → arbitrage
              </text>
            </g>
            <g data-tag="kept" style={{ transformOrigin: `${(SHOCK + ARB) / 2}px 100px` }}>
              <rect x={(SHOCK + ARB) / 2 - 92} y={POOL_BEFORE + 72} width={184} height={28} rx={14} fill="var(--color-mint)" />
              <text x={(SHOCK + ARB) / 2} y={POOL_BEFORE + 91} textAnchor="middle" className="fill-[var(--color-bg)] text-[12px] font-semibold">
                fee → LPs
              </text>
            </g>
            <g className="text-[12px]">
              <circle cx={X0 + 10} cy={H - 24} r={4} fill="var(--color-mint)" />
              <text x={X0 + 22} y={H - 20} className="fill-[var(--color-ink-2)]">
                perp market
              </text>
              <line x1={X0 + 210} x2={X0 + 232} y1={H - 24} y2={H - 24} stroke="var(--color-ink-2)" strokeWidth="2.5" strokeLinecap="round" />
              <text x={X0 + 240} y={H - 20} className="fill-[var(--color-ink-2)]">
                pool price
              </text>
            </g>
          </svg>
          <div className="absolute inset-x-0 bottom-0 h-px bg-line">
            <div data-prog className="h-full origin-left scale-x-0 bg-mint" />
          </div>
        </div>
      </div>
    </section>
  );
}

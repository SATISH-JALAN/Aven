"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Emblem } from "@/components/brand";
import { CountUp } from "@/components/motion";
import { MOTION_OK, ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";
import { POOLS, type ReplayFile } from "@/lib/replay";

/** Section heading used across the landing page: a pill, a short title, an optional one-liner. */
function Head({ pill, title, lede, center = false }: { pill: string; title: React.ReactNode; lede?: string; center?: boolean }) {
  return (
    <div data-head className={`mb-14 ${center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}`}>
      <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-[13px] font-medium text-ink-2">
        <span className="h-1.5 w-1.5 rounded-full bg-mint" /> {pill}
      </p>
      <h2 className="h-section text-ink">{title}</h2>
      {lede && <p className={`lede mt-5 ${center ? "mx-auto" : ""} max-w-lg`}>{lede}</p>}
    </div>
  );
}

function useHeadIn(scope: React.RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.utils.toArray<HTMLElement>("[data-head]", scope.current).forEach((h) => {
          gsap.from(h.children, { y: 40, autoAlpha: 0, duration: 1.1, ease: "expo.out", stagger: 0.08, scrollTrigger: { trigger: h, start: "top 85%", once: true } });
        });
      });
      return () => mm.revert();
    },
    { scope },
  );
}

// ------------------------------------------------------------------------------------------------ built-on strip

const STACK = ["Uniswap v4", "Hyperliquid", "HyperEVM", "HyperCore", "IDynamicFeeHook", "Foundry", "viem", "OpenZeppelin"];

/** Infinite horizontal loop; scroll velocity speeds it up and flips its direction. */
export function Marquee() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const track = root.current!.querySelector("[data-track]") as HTMLElement;
        const loop = gsap.to(track, { xPercent: -50, duration: 40, ease: "none", repeat: -1 });
        const st = ScrollTrigger.create({
          onUpdate: (self) => {
            const v = self.getVelocity() / 300;
            gsap.to(loop, { timeScale: gsap.utils.clamp(-5, 5, self.direction * Math.max(1, Math.abs(v))), duration: 0.25, overwrite: true });
            gsap.to(loop, { timeScale: self.direction, duration: 1.4, delay: 0.3 });
          },
        });
        return () => st.kill();
      });
      return () => mm.revert();
    },
    { scope: root },
  );
  const row = [...STACK, ...STACK];
  return (
    <div ref={root} className="mx-auto max-w-7xl px-6 py-16">
      <p className="mb-8 text-center text-sm text-muted">Built on</p>
      <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_15%,black_85%,transparent)]">
        <div data-track className="flex w-max items-center gap-14 whitespace-nowrap">
          {[...row, ...row].map((s, i) => (
            <span key={i} className="flex items-center gap-14">
              <span className="text-[clamp(1.4rem,2.4vw,2rem)] font-medium tracking-[-0.03em] text-ink-2/70">{s}</span>
              <Emblem className="h-3.5 w-auto text-faint" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ features

/** Blocks stream past; the highlighted one reads oracle, mark and pool price together. */
function BlocksGraphic() {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const tl = gsap.timeline({ repeat: -1 });
        tl.to(ref.current!.querySelector("[data-belt]"), { xPercent: -50, duration: 14, ease: "none" });
        const pulse = gsap.timeline({ repeat: -1, repeatDelay: 0.6 });
        pulse
          .fromTo(ref.current!.querySelectorAll("[data-read]"), { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.5, stagger: 0.12, ease: "back.out(2)" })
          .to(ref.current!.querySelector("[data-ring]"), { scale: 1.5, autoAlpha: 0, duration: 1, ease: "power2.out" }, 0.4)
          .set(ref.current!.querySelector("[data-ring]"), { scale: 1, autoAlpha: 1 })
          .to(ref.current!.querySelectorAll("[data-read]"), { autoAlpha: 0, duration: 0.4, delay: 1.2 });
        const st = ScrollTrigger.create({ trigger: ref.current, start: "top bottom", end: "bottom top", onToggle: (s) => [tl, pulse].forEach((t) => (s.isActive ? t.play() : t.pause())) });
        return () => st.kill();
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  const blocks = Array.from({ length: 16 }, (_, i) => 41_207 + i);
  return (
    <div ref={ref} className="relative flex h-full min-h-[220px] items-center overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_20%,black_80%,transparent)]">
      <div data-belt className="flex w-max gap-3">
        {[...blocks, ...blocks].map((b, i) => (
          <div key={i} className="flex h-24 w-24 shrink-0 flex-col justify-between rounded-2xl border border-line bg-raised/60 p-3">
            <span className="num text-[10px] text-faint">#{b}</span>
            <span className="h-1 w-8 rounded-full bg-line-strong" />
          </div>
        ))}
      </div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative flex h-32 w-32 flex-col items-center justify-center gap-2 rounded-3xl border border-mint/60 bg-bg/90 shadow-[0_0_60px_-10px_rgba(151,252,228,0.45)]">
          <span data-ring className="absolute inset-0 rounded-3xl border border-mint/50" />
          <span className="num text-[10px] text-mint">this block</span>
          {[
            ["oracle", "bg-mint"],
            ["mark", "bg-ink"],
            ["pool", "bg-pink"],
          ].map(([k, c]) => (
            <span key={k} data-read className="flex items-center gap-2 text-[11px] text-ink-2">
              <span className={`h-1.5 w-1.5 rounded-full ${c}`} />
              {k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Two fee bars: the arbitrage side fills, the retail side barely moves. Shape only, no figures. */
function DirectionGraphic() {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const q = gsap.utils.selector(ref);
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.2, paused: true });
        tl.fromTo(q("[data-bar=arb]"), { scaleX: 0.08 }, { scaleX: 1, duration: 1.4, ease: "expo.out" })
          .fromTo(q("[data-bar=retail]"), { scaleX: 0.08 }, { scaleX: 0.14, duration: 1.4, ease: "expo.out" }, 0)
          .fromTo(q("[data-arrow]"), { x: -8, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.6, stagger: 0.1 }, 0)
          .to(q("[data-bar]"), { scaleX: 0.08, duration: 0.8, ease: "power2.inOut" }, "+=1.6");
        const st = ScrollTrigger.create({ trigger: ref.current, start: "top 90%", end: "bottom top", onToggle: (s) => (s.isActive ? tl.play() : tl.pause()) });
        return () => st.kill();
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className="flex h-full min-h-[220px] flex-col justify-center gap-6 px-2">
      {[
        { k: "arb", label: "Closes the gap", cls: "bg-gradient-to-r from-mint/30 to-mint" },
        { k: "retail", label: "Everyone else", cls: "bg-ink-2/60" },
      ].map((r) => (
        <div key={r.k}>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-ink-2">
              <span data-arrow className="text-mint">
                {r.k === "arb" ? "↘" : "↗"}
              </span>
              {r.label}
            </span>
            <span className="text-faint">{r.k === "arb" ? "pays the gap" : "base fee"}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-raised">
            <div data-bar={r.k} className={`h-full origin-left rounded-full ${r.cls}`} style={{ transform: `scaleX(${r.k === "arb" ? 1 : 0.14})` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The mark with crossed-out roles orbiting it. */
function NoKeysGraphic() {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const orbit = gsap.to(ref.current!.querySelector("[data-orbit]"), { rotate: 360, duration: 30, ease: "none", repeat: -1, paused: true });
        const counter = gsap.to(ref.current!.querySelectorAll("[data-tag]"), { rotate: -360, duration: 30, ease: "none", repeat: -1, paused: true });
        const st = ScrollTrigger.create({ trigger: ref.current, start: "top bottom", end: "bottom top", onToggle: (s) => [orbit, counter].forEach((t) => (s.isActive ? t.play() : t.pause())) });
        return () => st.kill();
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  const tags = ["owner", "keeper", "proxy", "admin key", "custody", "relayer"];
  return (
    <div ref={ref} className="relative mx-auto flex aspect-square h-full max-h-[260px] min-h-[220px] items-center justify-center">
      <div className="absolute inset-[18%] rounded-full border border-dashed border-line-strong" />
      <div className="absolute inset-[2%] rounded-full border border-line" />
      <div data-orbit className="absolute inset-0">
        {tags.map((t, i) => {
          const a = (i / tags.length) * Math.PI * 2;
          return (
            <span
              key={t}
              data-tag
              className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-line bg-bg px-2.5 py-1 text-[11px] text-faint line-through decoration-crit/70"
              // Fixed decimals: raw floats serialize differently on the server and in the browser (hydration mismatch).
              style={{ left: `${(50 + Math.cos(a) * 48).toFixed(3)}%`, top: `${(50 + Math.sin(a) * 48).toFixed(3)}%` }}
            >
              {t}
            </span>
          );
        })}
      </div>
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-mint/10 shadow-[0_0_50px_-5px_rgba(151,252,228,0.4)]">
        <Emblem className="h-9 w-auto text-mint" />
      </div>
    </div>
  );
}

/** A hash scrambles, the recompute runs, MATCH lands. */
function VerifyGraphic() {
  const ref = useRef<HTMLDivElement>(null);
  const hash = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const q = gsap.utils.selector(ref);
        const hex = "0123456789abcdef";
        const scramble = { t: 0 };
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.4, paused: true });
        tl.set(q("[data-line]"), { autoAlpha: 0, y: 8 })
          .set(q("[data-ok]"), { autoAlpha: 0, scale: 0.6 })
          .to(scramble, {
            t: 1,
            duration: 1.2,
            ease: "none",
            onUpdate: () => {
              if (hash.current) hash.current.textContent = "0x" + Array.from({ length: 12 }, () => hex[Math.floor(Math.random() * 16)]).join("") + "…";
            },
          })
          .to(q("[data-line]"), { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.25 })
          .to(q("[data-ok]"), { autoAlpha: 1, scale: 1, duration: 0.6, ease: "back.out(2.5)" })
          .to({}, { duration: 1.6 });
        const st = ScrollTrigger.create({ trigger: ref.current, start: "top 90%", end: "bottom top", onToggle: (s) => (s.isActive ? tl.play() : tl.pause()) });
        return () => st.kill();
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className="flex h-full min-h-[220px] flex-col justify-center">
      <div className="num rounded-2xl border border-line bg-bg/80 p-5 text-[12.5px] leading-7">
        <p className="text-ink-2">
          <span className="text-mint">$</span> pnpm verify{" "}
          <span ref={hash} className="text-ink">
            0x3fa1c09be27d…
          </span>
        </p>
        <p data-line className="text-muted">
          → decode FeeComputed
        </p>
        <p data-line className="text-muted">
          → recompute fee in TypeScript
        </p>
        <p data-line className="text-muted">
          → compare with Swap event
        </p>
        <p data-ok className="mt-2 inline-flex items-center gap-2 rounded-full border border-good/60 px-3 py-0.5 font-sans text-xs font-semibold text-[#4cd44c]">
          ✓ MATCH
        </p>
      </div>
    </div>
  );
}

const FEATURES = [
  { t: "Read in the same block.", d: "Oracle, mark and pool price, together.", g: <BlocksGraphic />, span: "lg:col-span-4" },
  { t: "Arbitrage pays.", d: "Only the side closing the gap pays it.", g: <DirectionGraphic />, span: "lg:col-span-2" },
  { t: "Nobody in charge.", d: "No owner, keeper, proxy or custody.", g: <NoKeysGraphic />, span: "lg:col-span-2" },
  { t: "Check any fee.", d: "Every input is logged. Recompute it yourself.", g: <VerifyGraphic />, span: "lg:col-span-4" },
];

export function Features() {
  const ref = useRef<HTMLElement>(null);
  useHeadIn(ref);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from(ref.current!.querySelectorAll("[data-feat]"), { y: 80, autoAlpha: 0, duration: 1.2, ease: "expo.out", stagger: 0.1, scrollTrigger: { trigger: ref.current!.querySelector("[data-grid]"), start: "top 85%", once: true } });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <section ref={ref} className="mx-auto max-w-7xl px-6 py-32">
      <Head pill="Why Aven" title={<>Priced by the market,<br /> not a middleman.</>} />
      <div data-grid className="grid gap-4 lg:grid-cols-6">
        {FEATURES.map((f) => (
          <article key={f.t} data-feat className={`panel panel-hover flex flex-col overflow-hidden p-7 ${f.span}`}>
            <div className="flex-1">{f.g}</div>
            <div className="mt-6">
              <h3 className="h-card text-ink">{f.t}</h3>
              <p className="mt-2 text-[15px] text-muted">{f.d}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ stats

const STATS = [
  { v: 141.25, f: (n: number) => `+$${n.toFixed(0)}`, k: "LP value vs holding", s: "Replay · Oct 29 · live hook" },
  { v: 8700, f: (n: number) => `${Math.round(n).toLocaleString("en-US")}`, k: "pips paid by the arb, vs 3,000 flat", s: "Arena · recorded run" },
  { v: 10000, f: (n: number) => `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`, k: "fee vectors, Solidity ≡ TypeScript", s: "pnpm prove:diff" },
  { v: 0, f: () => "0", k: "owners, keepers or admin keys", s: "AvenHook.sol" },
];

export function Stats() {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from(ref.current!.querySelectorAll("[data-stat]"), { y: 60, autoAlpha: 0, duration: 1.2, ease: "expo.out", stagger: 0.1, scrollTrigger: { trigger: ref.current, start: "top 80%", once: true } });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <section ref={ref} className="mx-auto max-w-7xl px-6 py-16">
      <div className="grid gap-px overflow-hidden rounded-[32px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.k} data-stat className="flex flex-col justify-between gap-12 bg-bg p-8">
            <p className="text-[clamp(2.8rem,4.6vw,4.2rem)] font-medium leading-none tracking-[-0.05em] text-ink">
              <CountUp value={s.v} format={s.f} mono={false} />
            </p>
            <div>
              <p className="text-[15px] text-ink-2">{s.k}</p>
              <p className="mt-1.5 text-[11px] text-faint">{s.s}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ replay teaser

/** A media panel that grows to full width as it scrolls in, with the Oct 29 LP − HODL lines drawing themselves. */
export function ReplayTeaser() {
  const root = useRef<HTMLElement>(null);
  const [f, setF] = useState<ReplayFile | null>(null);
  useEffect(() => {
    fetch("/replay/binance-halt.json")
      .then((r) => (r.ok ? (r.json() as Promise<ReplayFile>) : null))
      .then(setF, () => setF(null));
  }, []);

  const W = 1200;
  const H = 420;
  const paths = (() => {
    if (!f) return [];
    const n = f.series.timestamps.length;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of POOLS)
      for (const v of f.series.pools[p.id].lvrUsd) {
        lo = Math.min(lo, -v);
        hi = Math.max(hi, -v);
      }
    const pad = (hi - lo) * 0.1;
    const y = (v: number) => 30 + (1 - (v - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 60);
    return POOLS.map((p) => ({
      ...p,
      d: f.series.pools[p.id].lvrUsd.map((v, i) => `${i ? "L" : "M"}${((i / (n - 1)) * W).toFixed(1)},${y(-v).toFixed(1)}`).join(""),
      end: -f.series.pools[p.id].lvrUsd[n - 1]!,
      zero: y(0),
    }));
  })();

  useGSAP(
    () => {
      if (!f) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const q = gsap.utils.selector(root);
        gsap.fromTo(q("[data-panel]"), { scale: 0.9 }, { scale: 1, ease: "none", scrollTrigger: { trigger: root.current, start: "top bottom", end: "top 20%", scrub: 0.6 } });
        gsap.fromTo(q("[data-line]"), { drawSVG: "0%" }, { drawSVG: "100%", ease: "none", stagger: 0.08, scrollTrigger: { trigger: root.current, start: "top 60%", end: "center 40%", scrub: 0.8 } });
        gsap.from(q("[data-end]"), { autoAlpha: 0, x: -10, stagger: 0.08, scrollTrigger: { trigger: root.current, start: "center 55%", once: true } });
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [f] },
  );

  return (
    <section ref={root} className="relative px-3 py-24 sm:px-6">
      <div data-panel className="relative mx-auto max-w-[1400px] overflow-hidden rounded-[40px] border border-line bg-[radial-gradient(ellipse_80%_70%_at_50%_0%,#0d2c26,#0a0d0c_70%)] will-change-transform">
        <div className="mx-auto max-w-7xl px-6 py-20 md:px-12">
          <div className="mb-14 flex flex-wrap items-end justify-between gap-8">
            <div>
              <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-bg/50 px-3 py-1.5 text-[13px] font-medium text-ink-2">
                <span className="h-1.5 w-1.5 rounded-full bg-delayed" /> Replay · mainnet data
              </p>
              <p className="h-section text-ink">
                Oct 29. <span className="text-muted">Binance went dark.</span>
              </p>
              <p className="lede mt-5 max-w-sm">Four pools, six hours of real data. Only the fee differs.</p>
            </div>
            <Link href="/replay" className="btn btn-ghost">
              Run the replay <span aria-hidden>→</span>
            </Link>
          </div>
          <svg viewBox={`0 0 ${W + 170} ${H}`} className="w-full overflow-visible" role="img" aria-label="LP value minus holding, Oct 29 replay, four pools">
            {paths[0] && <line x1="0" x2={W} y1={paths[0].zero} y2={paths[0].zero} stroke="var(--color-line-strong)" strokeWidth="1.5" strokeDasharray="2 6" />}
            {paths.map((p) => (
              <path key={p.id} data-line d={p.d} fill="none" stroke={p.color} strokeWidth="2.5" strokeDasharray={p.dashed ? "6 5" : undefined} strokeLinejoin="round" />
            ))}
            {(() => {
              const ends = paths.map((p) => ({ p, y: Number(/,([\d.]+)$/.exec(p.d)?.[1] ?? 0) })).sort((a, b) => a.y - b.y);
              for (let k = 1; k < ends.length; k++) if (ends[k]!.y - ends[k - 1]!.y < 40) ends[k]!.y = ends[k - 1]!.y + 40;
              return ends.map(({ p, y }) => (
                <g key={p.id} data-end>
                  <text x={W + 14} y={y - 2} className="num fill-[var(--color-ink)] text-[18px]">
                    {p.end >= 0 ? "+" : "−"}${Math.abs(p.end).toFixed(0)}
                  </text>
                  <text x={W + 14} y={y + 15} className="fill-[var(--color-muted)] text-[12px]">
                    {p.label}
                  </text>
                </g>
              ));
            })()}
          </svg>
          <p className="mt-6 text-[11px] text-faint">LP value minus holding · Replay.t.sol over Hyperliquid mainnet candles · $ at the oracle proxy</p>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ explore

const ROWS = [
  { href: "/trade", n: "01", t: "Trade", d: "Live perp market. Every fee shown before you sign." },
  { href: "/pool", n: "02", t: "Pool", d: "Who earns: LPs or the arbitrage bot." },
  { href: "/replay", n: "03", t: "Replay", d: "Real history, four fee models." },
  { href: "/docs", n: "04", t: "Docs", d: "How it works, integrate it, verify any fee." },
];

export function BigRows() {
  const ref = useRef<HTMLElement>(null);
  useHeadIn(ref);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.from(ref.current!.querySelectorAll("[data-row]"), { y: 40, autoAlpha: 0, duration: 1, ease: "expo.out", stagger: 0.08, scrollTrigger: { trigger: ref.current!.querySelector("[data-rows]"), start: "top 85%", once: true } });
        ref.current!.querySelectorAll<HTMLElement>("[data-row]").forEach((row) => {
          const fill = row.querySelector("[data-fill]");
          const arrow = row.querySelector("[data-arrow]");
          const enter = () => {
            gsap.to(fill, { scaleY: 1, duration: 0.5, ease: "expo.out" });
            gsap.to(arrow, { rotate: -45, duration: 0.5, ease: "expo.out" });
          };
          const leave = () => {
            gsap.to(fill, { scaleY: 0, duration: 0.5, ease: "expo.out" });
            gsap.to(arrow, { rotate: 0, duration: 0.5, ease: "expo.out" });
          };
          row.addEventListener("pointerenter", enter);
          row.addEventListener("pointerleave", leave);
        });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <section ref={ref} className="mx-auto max-w-7xl px-6 py-24">
      <Head pill="Explore" title="See it for yourself." />
      <div data-rows className="border-t border-line">
        {ROWS.map((r) => (
          <Link key={r.href} href={r.href} data-row className="group relative grid grid-cols-[3rem_1fr_auto] items-center gap-6 overflow-hidden border-b border-line py-8 md:grid-cols-[4rem_1fr_1fr_auto]">
            <span data-fill className="pointer-events-none absolute inset-0 origin-bottom scale-y-0 bg-mint" />
            <span className="num relative text-sm text-faint transition-colors duration-300 group-hover:text-bg">{r.n}</span>
            <span className="relative text-[clamp(2.2rem,4.6vw,4rem)] font-medium leading-none tracking-[-0.05em] text-ink transition-colors duration-300 group-hover:text-bg">{r.t}</span>
            <span className="relative hidden text-[15px] text-muted transition-colors duration-300 group-hover:text-bg md:block">{r.d}</span>
            <span data-arrow className="relative flex h-12 w-12 items-center justify-center rounded-full border border-line-strong text-lg text-ink transition-colors duration-300 group-hover:border-bg group-hover:text-bg">
              →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

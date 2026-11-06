"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { FV_PATH, config } from "@/config";
import { useArena } from "@/lib/arena";
import { useBlockNumber } from "@/lib/chain";
import { MOTION_OK, ScrollSmoother, ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";
import { shortHex } from "@/lib/format";
import { EMBLEM_VIEWBOX, LENS_REST, Logo, Wordmark, lobePath } from "./brand";
import { markReady, onReady } from "./landing/Preloader";
import { Magnetic } from "./motion";
import { CopyButton, ModeBadge, type Mode } from "./ui";
import { WalletButton } from "./wallet";

// ------------------------------------------------------------------------------------------------ page mode

const ModeCtx = createContext<{ mode: Mode | null; set: (m: Mode | null) => void }>({ mode: null, set: () => {} });

export function PageModeProvider({ children }: { children: ReactNode }) {
  const [mode, set] = useState<Mode | null>(null);
  return <ModeCtx.Provider value={{ mode, set }}>{children}</ModeCtx.Provider>;
}

/** A page declares its data mode; the nav badge shows it. */
export function UsePageMode({ mode }: { mode: Mode | null }) {
  const { set } = useContext(ModeCtx);
  useEffect(() => {
    set(mode);
    return () => set(null);
  }, [mode, set]);
  return null;
}

/** Pages other than the landing page have no preloader: they are "ready" at once. */
export function ReadyOutsideLanding() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== "/") markReady();
  }, [pathname]);
  return null;
}

// ------------------------------------------------------------------------------------------------ nav

const LINKS = [
  { href: "/trade", label: "Trade" },
  { href: "/swap", label: "Swap" },
  { href: "/pool", label: "Pool" },
  { href: "/replay", label: "Replay" },
  { href: "/docs", label: "Docs" },
];

/** App-style pages: native scroll (sticky panels need it), no marketing footer. */
export const isAppRoute = (path: string | null) => !!path && /^\/(trade|docs)(\/|$)/.test(path);

export function NetStatus({ compact = false }: { compact?: boolean }) {
  const rpc = useBlockNumber();
  return (
    <span className={`flex items-center gap-2 text-xs ${rpc.error ? "text-crit" : "text-ink-2"}`} title={rpc.error ? `RPC error: ${rpc.error}` : `${config.chainName} · ${config.rpcUrl}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${rpc.error ? "bg-crit" : rpc.block ? "live-dot bg-mint text-mint" : "bg-faint"}`} />
      <span className="num">{rpc.error ? "RPC down" : rpc.block ? `#${rpc.block.toLocaleString("en-US")}` : "…"}</span>
      {!compact && <span className="text-faint">{config.chainName}</span>}
    </span>
  );
}

export function Nav() {
  const pathname = usePathname();
  const { mode } = useContext(ModeCtx);
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  useGSAP(
    () => {
      const st = ScrollTrigger.create({ start: 0, end: "max", onUpdate: (self) => setScrolled(self.scroll() > 24) });
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        // Built only once the page is ready (after the landing preloader; at once elsewhere). fromTo + clearProps so a
        // re-created or interrupted element can never be left at its hidden start state.
        let intro: gsap.core.Tween | null = null;
        const off = onReady(() => {
          intro = gsap.fromTo(
            ref.current!.querySelectorAll("[data-nav-in]"),
            { y: -16, autoAlpha: 0 },
            { y: 0, autoAlpha: 1, duration: 0.9, ease: "expo.out", stagger: 0.05, clearProps: "transform,opacity,visibility" },
          );
        });
        const hide = ScrollTrigger.create({
          start: 0,
          end: "max",
          onUpdate: (self) => {
            const down = self.direction === 1 && self.scroll() > 320;
            gsap.to(ref.current, { yPercent: down ? -110 : 0, duration: 0.45, ease: "power3.out", overwrite: "auto" });
          },
        });
        return () => {
          hide.kill();
          off();
          intro?.kill();
          gsap.set(ref.current!.querySelectorAll("[data-nav-in]"), { clearProps: "transform,opacity,visibility" });
        };
      });
      return () => {
        st.kill();
        mm.revert();
      };
    },
    { scope: ref },
  );

  return (
    <header ref={ref} className="fixed inset-x-0 top-0 z-50">
      <div className={`border-b transition-colors duration-300 ${scrolled || open ? "border-line bg-bg/80 backdrop-blur-xl" : "border-transparent"}`}>
        <nav className="mx-auto flex h-[72px] max-w-7xl items-center gap-8 px-6">
          <Link data-nav-in href="/" aria-label="Aven home" className="text-ink transition hover:text-mint">
            <Logo />
          </Link>
          <ul data-nav-in className="hidden items-center gap-1 lg:flex">
            {LINKS.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <li key={l.href}>
                  <Link href={l.href} className={`rounded-full px-3.5 py-2 text-[15px] transition ${active ? "text-ink" : "text-muted hover:text-ink"}`}>
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="ml-auto flex items-center gap-3">
            <div data-nav-in className="hidden items-center gap-3 md:flex">
              {mode && <ModeBadge mode={mode} />}
              <span className="rounded-full border border-line px-3 py-1.5">
                <NetStatus compact />
              </span>
            </div>
            <div data-nav-in className="hidden sm:block">
              <WalletButton />
            </div>
            <Link data-nav-in href="/trade" className="btn btn-primary btn-sm hidden sm:inline-flex">
              Start trading
            </Link>
            <button
              data-nav-in
              className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 rounded-full border border-line lg:hidden"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <span className={`h-px w-4 bg-ink transition ${open ? "translate-y-[3.5px] rotate-45" : ""}`} />
              <span className={`h-px w-4 bg-ink transition ${open ? "-translate-y-[3.5px] -rotate-45" : ""}`} />
            </button>
          </div>
        </nav>
        {open && (
          <div className="mx-auto max-w-7xl px-6 pb-8 lg:hidden">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="block border-b border-line py-4 text-3xl font-medium tracking-[-0.04em] text-ink">
                {l.label}
              </Link>
            ))}
            <div className="flex items-center justify-between pt-6">
              <NetStatus />
              <WalletButton />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

/** Global "RPC down" banner (fixed, below the nav). */
export function RpcBanner() {
  const rpc = useBlockNumber();
  if (!rpc.error) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-[80px] z-40 mx-auto w-fit rounded-full border border-crit/40 bg-bg/90 px-4 py-1.5 text-xs text-[#f08a8a] backdrop-blur">
      ✕ RPC down. Showing the last data{rpc.block ? ` (block #${rpc.block.toLocaleString("en-US")})` : ""}. Retrying every {config.pollMs / 1000}s.
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ footer

function ContractChip({ label, value }: { label: string; value?: string | null }) {
  const href = value && config.explorer && value.length === 42 ? `${config.explorer}/address/${value}` : null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-raised/60 px-4 py-3">
      <span className="text-xs text-muted">{label}</span>
      {value ? (
        <span className="flex items-center gap-2">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className="num text-xs text-ink-2 hover:text-ink">
              {shortHex(value, 5)} ↗
            </a>
          ) : (
            <span className="num text-xs text-ink-2" title={value}>
              {shortHex(value, 5)}
            </span>
          )}
          <CopyButton value={value} />
        </span>
      ) : (
        <span className="text-xs text-faint">pending deploy</span>
      )}
    </div>
  );
}

const COLS = [
  {
    h: "Product",
    links: [
      ["Trade", "/trade"],
      ["Swap", "/swap"],
      ["Pool", "/pool"],
      ["Replay", "/replay"],
    ],
  },
  {
    h: "Developers",
    links: [
      ["Docs", "/docs"],
      ["Build a hook", "/docs/build"],
      ["Verify a swap", "/docs/verify"],
      ["AvenFairValue.sol", config.sourceUrl(FV_PATH)],
      ["GitHub", config.repoUrl],
    ],
  },
  {
    h: "Project",
    links: [
      ["Demo video", config.videoUrl || ""],
      ["Feedback", config.feedbackUrl],
      ["Security", config.sourceUrl("docs/SECURITY.md")],
      ["Proofs", config.sourceUrl("docs/PROOFS.md")],
    ],
  },
];

/** The emblem in the footer CTA: its lens opens as the panel scrolls into view. */
function OpeningEmblem() {
  const ref = useRef<SVGSVGElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const [t, b] = el.querySelectorAll("path");
      const lens = { h: LENS_REST };
      const draw = () => {
        t?.setAttribute("d", lobePath("top", lens.h));
        b?.setAttribute("d", lobePath("bottom", lens.h));
      };
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(lens, { h: 30 }, { h: 190, ease: "none", onUpdate: draw, scrollTrigger: { trigger: el, start: "top bottom", end: "bottom 40%", scrub: 1 } });
        gsap.to(el, { rotate: 8, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 1 } });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <svg ref={ref} viewBox={EMBLEM_VIEWBOX} className="h-full w-auto" aria-hidden>
      <defs>
        <linearGradient id="ft-lobe" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#97fce4" stopOpacity="0.9" />
          <stop offset="1" stopColor="#97fce4" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <path d={lobePath("top")} fill="url(#ft-lobe)" />
      <path d={lobePath("bottom")} fill="url(#ft-lobe)" />
    </svg>
  );
}

export function Footer() {
  const { deployments: d } = useArena();
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      if (!ref.current) return; // not rendered on app routes
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const q = gsap.utils.selector(ref);
        gsap.fromTo(q("[data-wm] [data-letter]"), { drawSVG: "0%" }, { drawSVG: "100%", ease: "none", stagger: 0.08, scrollTrigger: { trigger: q("[data-wm]")[0], start: "top bottom", end: "bottom bottom", scrub: 0.8 } });
        gsap.from(q("[data-cta-line]"), { yPercent: 110, duration: 1.2, ease: "expo.out", stagger: 0.08, scrollTrigger: { trigger: q("[data-cta]")[0], start: "top 75%", once: true } });
        gsap.from(q("[data-cta]"), { y: 60, scale: 0.97, autoAlpha: 0, duration: 1.2, ease: "expo.out", scrollTrigger: { trigger: q("[data-cta]")[0], start: "top 90%", once: true } });
        gsap.from(q("[data-col]"), { y: 30, autoAlpha: 0, duration: 1, ease: "expo.out", stagger: 0.06, scrollTrigger: { trigger: q("[data-cols]")[0], start: "top 90%", once: true } });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  if (isAppRoute(pathname)) return null;

  return (
    <footer ref={ref} className="relative mt-32 overflow-hidden">
      {/* CTA */}
      <div className="mx-auto max-w-7xl px-6">
        <div data-cta className="relative overflow-hidden rounded-[40px] border border-line bg-[radial-gradient(ellipse_70%_90%_at_85%_50%,#0f3a31_0%,#0b1311_55%,#0a0d0c_100%)] px-8 py-16 md:px-16 md:py-24">
          <div className="dot-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:linear-gradient(90deg,transparent,black)]" aria-hidden />
          <div className="pointer-events-none absolute -right-10 top-1/2 hidden h-[130%] -translate-y-1/2 md:block">
            <OpeningEmblem />
          </div>
          <div className="relative max-w-2xl">
            <p className="h-section text-ink">
              <span className="block overflow-hidden pb-1">
                <span data-cta-line className="block">
                  Trade the gap.
                </span>
              </span>
              <span className="block overflow-hidden pb-1">
                <span data-cta-line className="block text-mint">
                  LPs keep it.
                </span>
              </span>
            </p>
            <p className="lede mt-6 max-w-md">Live perp prices, priced into every swap.</p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Magnetic>
                <Link href="/trade" className="btn btn-primary">
                  Start trading <span aria-hidden>→</span>
                </Link>
              </Magnetic>
              <Link href="/docs" className="btn btn-ghost">
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Links */}
      <div className="mx-auto max-w-7xl px-6">
        <div data-cols className="grid gap-12 pt-24 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div data-col>
            <Logo className="text-ink" />
            <p className="mt-5 max-w-[16rem] text-[15px] leading-relaxed text-ink-2">The fee that reads the market.</p>
            <div className="mt-6 inline-flex rounded-full border border-line px-3.5 py-2">
              <NetStatus />
            </div>
          </div>
          {COLS.map((c) => (
            <div key={c.h} data-col>
              <p className="mb-5 text-sm text-muted">{c.h}</p>
              <ul className="space-y-3.5">
                {c.links.map(([label, href]) => (
                  <li key={label}>
                    {!href ? (
                      <span className="text-[15px] text-faint">{label} · soon</span>
                    ) : href.startsWith("/") ? (
                      <Link href={href} className="text-[15px] text-ink transition hover:text-mint">
                        {label}
                      </Link>
                    ) : (
                      <a href={href} target="_blank" rel="noreferrer" className="text-[15px] text-ink transition hover:text-mint">
                        {label} <span className="text-faint">↗</span>
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <details className="group mt-16 rounded-3xl border border-line">
          <summary className="flex items-center justify-between gap-4 px-6 py-4 text-sm text-ink-2 transition hover:text-ink">
            <span>
              Contracts <span className="text-faint">· {config.chainName} ({config.chainId})</span>
            </span>
            <span data-chev className="text-lg leading-none transition-transform duration-300">
              +
            </span>
          </summary>
          <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
            <ContractChip label="AvenHook" value={d?.hook} />
            <ContractChip label="PoolManager" value={d?.poolManager} />
            <ContractChip label="Hooked pool" value={d?.pools.aven.id} />
            <ContractChip label="Control pool" value={d?.pools.control.id} />
            <ContractChip label={`Mock ${d?.tokens.baseSymbol ?? "base"}`} value={d?.tokens.base} />
            <ContractChip label={`Mock ${d?.tokens.quoteSymbol ?? "quote"}`} value={d?.tokens.quote} />
          </div>
          <p className="px-6 pb-5 text-xs text-faint">
            Quoting is built into AvenHook (getFee / previewFee). {!config.explorer && "No explorer covers this chain; tx links open Verify."} $ values use the HyperCore oracle.
          </p>
        </details>
      </div>

      <div data-wm className="mx-auto mt-20 max-w-7xl px-6">
        <Wordmark className="h-auto w-full text-line-strong" strokeWidth={2.5} />
      </div>

      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-faint">
        <span>© 2026 Aven · MIT · ETHGlobal Mumbai · Uniswap track</span>
        <button
          onClick={() => {
            const s = ScrollSmoother.get();
            if (s) s.scrollTo(0, true);
            else window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="rounded-full border border-line px-4 py-2 text-ink-2 transition hover:border-mint hover:text-mint"
        >
          Back to top ↑
        </button>
      </div>
    </footer>
  );
}

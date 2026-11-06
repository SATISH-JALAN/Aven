"use client";
/**
 * Landing hero. After the preloader, dust assembles into the mark (particles), the headline rises line by line and the
 * live ticker slides in. Pinned scroll: the lens opens (the gap), then the mark dissolves into a flowing market stream
 * while the copy leaves and the next line ("Markets move. Pools don't.") arrives.
 */
import Link from "next/link";
import { useRef, useState } from "react";
import { Emblem } from "@/components/brand";
import { Magnetic } from "@/components/motion";
import { MOTION_OK, SplitText, gsap, useGSAP } from "@/lib/gsap";
import { LiveTicker } from "./LiveTicker";
import { ParticleField, type FieldState } from "./ParticleField";
import { onReady } from "./Preloader";

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const field = useRef<FieldState>({ form: 0, lens: 0, stream: 0, offsetX: 0 });
  const [webgl, setWebgl] = useState<boolean | null>(null);

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const mm = gsap.matchMedia();
      mm.add({ motion: MOTION_OK, desktop: "(min-width: 1024px)" }, (ctx) => {
        const { motion, desktop } = ctx.conditions as { motion: boolean; desktop: boolean };
        field.current.offsetX = desktop ? 1.3 : 0;
        if (!motion) {
          Object.assign(field.current, { form: 1, lens: 0, stream: 0 });
          gsap.set(q("[data-split], [data-hero-in]"), { autoAlpha: 1 });
          return;
        }
        const split = SplitText.create(q("[data-hero-title]"), { type: "lines,words", mask: "lines" });
        gsap.set(q("[data-split]"), { autoAlpha: 1 });
        q("[data-split]").forEach((el) => el.setAttribute("data-split-managed", ""));
        gsap.set(split.words, { yPercent: 115 });
        gsap.set(q("[data-hero-in]"), { autoAlpha: 0, y: 24 });

        const intro = gsap.timeline({ paused: true, defaults: { ease: "expo.out" } });
        intro
          .to(field.current, { form: 1, duration: 2.6, ease: "power3.inOut" }, 0)
          .to(split.words, { yPercent: 0, duration: 1.3, stagger: 0.06 }, 0.45)
          .to(q("[data-hero-in]"), { autoAlpha: 1, y: 0, duration: 1.1, stagger: 0.1 }, 0.9);
        const off = onReady(() => intro.play());

        const scroll = gsap.timeline({ scrollTrigger: { trigger: root.current, start: "top top", end: "+=150%", scrub: 1, pin: true, anticipatePin: 1 } });
        scroll
          .to(field.current, { lens: 1, duration: 0.45, ease: "power1.inOut" }, 0)
          .to(q("[data-hero-copy]"), { autoAlpha: 0, y: -80, duration: 0.4, ease: "power1.in" }, 0.05)
          .to(q("[data-hero-foot]"), { autoAlpha: 0, y: 40, duration: 0.25 }, 0)
          .to(field.current, { stream: 1, offsetX: 0, duration: 0.55, ease: "power1.inOut" }, 0.4)
          .fromTo(q("[data-hero-next] [data-w]"), { yPercent: 110 }, { yPercent: 0, duration: 0.3, stagger: 0.05, ease: "power2.out" }, 0.62)
          .fromTo(q("[data-hero-next]"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.1 }, 0.6);

        return () => {
          off();
          split.revert();
        };
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative h-[100svh] min-h-[680px] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_60%_at_72%_48%,#0d2c26_0%,transparent_70%)]" />
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_50%_60%_at_70%_50%,black,transparent)]" />
      <ParticleField state={field} onReady={setWebgl} />
      {webgl === false && (
        <div className="pointer-events-none absolute inset-y-0 right-[8vw] flex items-center opacity-90 max-lg:inset-x-0 max-lg:justify-center max-lg:opacity-20">
          <Emblem className="h-[48vh] w-auto text-ink" />
        </div>
      )}

      <div className="relative mx-auto flex h-full max-w-7xl flex-col px-6">
        <div className="flex min-h-0 flex-1 flex-col justify-center pt-24">
        <div data-hero-copy className="max-w-3xl">
          <Link
            data-hero-in
            href="/trade"
            className="group mb-10 inline-flex items-center gap-3 rounded-full border border-line bg-surface/70 py-1.5 pl-1.5 pr-4 text-[13px] text-ink-2 backdrop-blur transition hover:border-line-strong hover:text-ink"
          >
            <span className="rounded-full bg-mint/15 px-2.5 py-0.5 font-medium text-mint">New</span>
            Uniswap v4 hook on HyperEVM
            <span className="text-muted transition group-hover:translate-x-0.5">→</span>
          </Link>
          <h1 data-hero-title data-split="" className="h-hero text-ink">
            The fee that <span className="text-mint">reads</span>
            <br /> the market.
          </h1>
          <p data-hero-in className="lede mt-8 max-w-md">
            Every swap priced from Hyperliquid&apos;s perp market, in the same block. No keeper. No owner.
          </p>
          <div data-hero-in className="mt-10 flex flex-wrap items-center gap-3">
            <Magnetic>
              <Link href="/trade" className="btn btn-primary">
                Start trading <span aria-hidden>→</span>
              </Link>
            </Magnetic>
            <Link href="/replay" className="btn btn-ghost">
              Replay Oct 29
            </Link>
          </div>
        </div>

        </div>

        <div data-hero-foot className="flex items-end justify-between gap-6 pb-8 pt-10">
          <div data-hero-in className="w-full max-w-xl">
            <LiveTicker />
          </div>
          <div data-hero-in className="hidden flex-col items-center gap-3 text-[11px] text-muted md:flex">
            <span className="relative h-12 w-px overflow-hidden bg-line">
              <span className="absolute inset-x-0 top-0 h-1/2 animate-[scrollhint_1.8s_ease-in-out_infinite] bg-mint" />
            </span>
            Scroll
          </div>
        </div>

        <div data-hero-next className="pointer-events-none absolute inset-x-6 top-[38%] isolate text-center opacity-0">
          <div className="absolute left-1/2 top-1/2 -z-10 h-[320%] w-[min(1200px,100%)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse_50%_50%_at_center,rgba(7,9,8,0.92),rgba(7,9,8,0.7)_50%,transparent)]" aria-hidden />
          <p className="h-section text-ink">
            <span className="inline-block overflow-hidden pb-2 align-bottom">
              <span data-w className="inline-block">
                Markets move.
              </span>
            </span>{" "}
            <span className="inline-block overflow-hidden pb-2 align-bottom">
              <span data-w className="inline-block text-mint">
                Pools don&apos;t.
              </span>
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

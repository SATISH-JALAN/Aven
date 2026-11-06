"use client";
/**
 * Motion primitives, all GSAP:
 * - <Smoother/>: ScrollSmoother, created before any page ScrollTrigger (it is the first sibling inside #smooth-content,
 *   so React runs its layout effect before the page's). Off for reduced motion; touch keeps native scroll.
 * - useReveal(scope): ScrollTrigger.batch fade-up for every [data-reveal] in scope, re-run when `deps` change.
 * - <SplitReveal>: SplitText line-mask reveal for headings, on scroll or immediately.
 * - <CountUp>: tweens a number to its new value (and from 0 when it first scrolls into view).
 * - <Magnetic>: pointer-follow for primary buttons (quickTo).
 */
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { MOTION_OK, ScrollSmoother, ScrollTrigger, SplitText, gsap, useGSAP } from "@/lib/gsap";

export function Smoother() {
  const pathname = usePathname();
  // App-style pages (Trade, Docs) scroll natively: ScrollSmoother transforms the content, which breaks sticky panels.
  const app = /^\/(trade|docs)(\/|$)/.test(pathname ?? "");
  useGSAP(() => {
    if (app) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const s = ScrollSmoother.create({ wrapper: "#smooth-wrapper", content: "#smooth-content", smooth: 1.1, effects: true, smoothTouch: false, normalizeScroll: false });
      return () => s.kill();
    });
    return () => mm.revert();
  }, { dependencies: [app], revertOnUpdate: true });
  // New route: back to the top and recompute every trigger once the new page has laid out.
  useEffect(() => {
    ScrollSmoother.get()?.scrollTo(0, false);
    window.scrollTo(0, 0);
    const id = requestAnimationFrame(() => ScrollTrigger.refresh());
    // Safety net: anything marked for reveal that no animation picked up is shown after a moment, never left hidden.
    const t = setTimeout(() => {
      document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-reveal-managed]), [data-split]:not([data-split-managed])").forEach((el) => {
        el.style.opacity = "1";
        el.style.visibility = "visible";
      });
    }, 1500);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(t);
    };
  }, [pathname]);
  return null;
}

/** Scroll-into-view stagger for [data-reveal] children of `scope`. `data-reveal="left|right|scale"` picks the move. */
export function useReveal(scope: React.RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const els = gsap.utils.toArray<HTMLElement>("[data-reveal]:not([data-revealed])", scope.current);
        if (!els.length) return;
        els.forEach((el) => {
          el.setAttribute("data-reveal-managed", "");
          const kind = el.dataset.reveal;
          gsap.set(el, {
            autoAlpha: 0,
            y: kind === "left" || kind === "right" ? 0 : 36,
            x: kind === "left" ? -48 : kind === "right" ? 48 : 0,
            scale: kind === "scale" ? 0.94 : 1,
            filter: "blur(6px)",
          });
        });
        ScrollTrigger.batch(els, {
          start: "top 88%",
          once: true,
          onEnter: (batch) => {
            batch.forEach((el) => (el as HTMLElement).setAttribute("data-revealed", ""));
            gsap.to(batch, { autoAlpha: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)", duration: 1, ease: "expo.out", stagger: 0.08, overwrite: true });
          },
        });
      });
      return () => mm.revert();
    },
    { scope, dependencies: deps, revertOnUpdate: false },
  );
}

export function Reveal({ children, className = "", deps = [] }: { children: ReactNode; className?: string; deps?: unknown[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, deps);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

export function SplitReveal({
  children,
  as: Tag = "h2",
  className = "",
  immediate = false,
  delay = 0,
}: {
  children: ReactNode;
  as?: "h1" | "h2" | "h3" | "p";
  className?: string;
  immediate?: boolean;
  delay?: number;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        if (!ref.current) return;
        ref.current.setAttribute("data-split-managed", "");
        const split = SplitText.create(ref.current, { type: "lines,words", mask: "lines", linesClass: "split-line" });
        gsap.set(ref.current, { autoAlpha: 1 });
        const tween = gsap.from(split.words, {
          yPercent: 110,
          rotate: 3,
          duration: 1.1,
          ease: "expo.out",
          stagger: 0.035,
          delay,
          ...(immediate ? {} : { scrollTrigger: { trigger: ref.current, start: "top 85%", once: true } }),
        });
        return () => {
          tween.kill();
          split.revert();
        };
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return (
    <Tag ref={ref as never} className={className} data-split="">
      {children}
    </Tag>
  );
}

export function CountUp({ value, format, className = "", mono = true }: { value: number; format: (n: number) => string; className?: string; mono?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef({ v: 0 });
  const seen = useRef(false);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const run = () => {
        if (reduce) {
          shown.current.v = value;
          el.textContent = format(value);
          return;
        }
        gsap.to(shown.current, {
          v: value,
          duration: 1.4,
          ease: "expo.out",
          overwrite: true,
          onUpdate: () => {
            el.textContent = format(shown.current.v);
          },
        });
      };
      if (seen.current) run();
      else {
        el.textContent = format(0);
        ScrollTrigger.create({
          trigger: el,
          start: "top 92%",
          once: true,
          onEnter: () => {
            seen.current = true;
            run();
          },
        });
      }
    },
    { dependencies: [value], scope: ref },
  );
  return (
    <span ref={ref} className={`${mono ? "num " : ""}${className}`}>
      {format(value)}
    </span>
  );
}

export function Magnetic({ children, strength = 0.25 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el || window.matchMedia("(prefers-reduced-motion: reduce), (pointer: coarse)").matches) return;
      const xTo = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3" });
      const yTo = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3" });
      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * strength);
        yTo((e.clientY - (r.top + r.height / 2)) * strength);
      };
      const leave = () => {
        xTo(0);
        yTo(0);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
      return () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
      };
    },
    { scope: ref },
  );
  return (
    <span ref={ref} className="inline-block will-change-transform">
      {children}
    </span>
  );
}

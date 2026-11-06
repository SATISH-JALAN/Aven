"use client";
/**
 * Intro (once per session; skipped for reduced motion): the mark's outline draws itself while a counter runs
 * 000 → 100, the lobes fill, then the screen splits along the lens line — top half up, bottom half down — like the
 * emblem opening. Fires `aven:ready` when done (or immediately if skipped) so the hero can start.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lobePath } from "@/components/brand";
import { config } from "@/config";
import { gsap } from "@/lib/gsap";

declare global {
  interface Window {
    __avenReady?: boolean;
  }
}

export function markReady() {
  window.__avenReady = true;
  window.dispatchEvent(new Event("aven:ready"));
}

export function onReady(cb: () => void): () => void {
  if (window.__avenReady) {
    cb();
    return () => {};
  }
  window.addEventListener("aven:ready", cb, { once: true });
  return () => window.removeEventListener("aven:ready", cb);
}

// Decided once per page load (React StrictMode runs effects twice in dev; the second run must not skip the intro).
let decision: "play" | "skip" | null = null;

export function Preloader() {
  const root = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Layout effect: runs before the hero (a later sibling) subscribes, so the ready flag is reset first.
  useLayoutEffect(() => {
    setMounted(true);
    if (decision === null) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      decision = reduce || sessionStorage.getItem("aven-intro") ? "skip" : "play";
      if (decision === "play") sessionStorage.setItem("aven-intro", "1");
    }
    if (decision === "skip") {
      setShow(false);
      markReady();
      return;
    }
    window.__avenReady = false;
    return undefined;
  }, []);

  useLayoutEffect(() => {
    if (!mounted || !show || !root.current) return;
    const q = gsap.utils.selector(root);
    const count = { v: 0 };
    const num = q("[data-count]")[0] as HTMLElement | undefined;
    document.documentElement.style.overflow = "hidden";
    const tl = gsap.timeline({
      defaults: { ease: "power3.inOut" },
      onComplete: () => {
        document.documentElement.style.overflow = "";
        decision = "skip"; // coming back to the landing page later in this session: no intro
        setShow(false);
      },
    });
    tl.set(q("[data-outline], [data-ring]"), { drawSVG: "0%" })
      .to(q("[data-outline]"), { drawSVG: "100%", duration: 1.3, stagger: 0.12 }, 0)
      .to(count, { v: 100, duration: 1.5, ease: "power2.inOut", onUpdate: () => num && (num.textContent = String(Math.round(count.v)).padStart(3, "0")) }, 0)
      .to(q("[data-ring]"), { drawSVG: "100%", duration: 1.5, ease: "power2.inOut" }, 0)
      .to(q("[data-fill]"), { opacity: 1, duration: 0.4 }, 1.25)
      .to(q("[data-lobe-top]"), { y: -26, duration: 0.5, ease: "power2.in" }, 1.6)
      .to(q("[data-lobe-bot]"), { y: 26, duration: 0.5, ease: "power2.in" }, 1.6)
      .to(q("[data-meta]"), { autoAlpha: 0, duration: 0.3 }, 1.6)
      .add(() => markReady(), 1.85)
      .to(q("[data-half=top]"), { yPercent: -100, duration: 0.95, ease: "expo.inOut" }, 1.85)
      .to(q("[data-half=bottom]"), { yPercent: 100, duration: 0.95, ease: "expo.inOut" }, 1.85)
      .to(q("[data-center]"), { autoAlpha: 0, scale: 0.9, duration: 0.5 }, 1.85);
    return () => {
      tl.kill();
      document.documentElement.style.overflow = "";
    };
  }, [mounted, show]);

  if (!show || !mounted) return null;
  // Portalled to <body>: a fixed overlay inside the ScrollSmoother content (a transformed parent) wouldn't be fixed.
  return createPortal(
    <div ref={root} className="fixed inset-0 z-[100]" aria-hidden>
      <div data-half="top" className="absolute inset-x-0 top-0 h-1/2 bg-bg" />
      <div data-half="bottom" className="absolute inset-x-0 bottom-0 h-1/2 bg-bg" />
      <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-mint/50 to-transparent" />
      <div data-center className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="relative h-40 w-40">
          <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full -rotate-90">
            <circle cx="60" cy="60" r="58" fill="none" stroke="var(--color-line)" strokeWidth="0.6" />
            <circle data-ring cx="60" cy="60" r="58" fill="none" stroke="var(--color-mint)" strokeWidth="0.8" />
          </svg>
          <svg viewBox={`-60 -60 770 820`} className="absolute inset-[22%] h-[56%] w-[56%] overflow-visible">
            <g data-lobe-top>
              <path data-fill d={lobePath("top")} fill="var(--color-ink)" opacity="0" />
              <path data-outline d={lobePath("top")} fill="none" stroke="var(--color-mint)" strokeWidth="10" />
            </g>
            <g data-lobe-bot>
              <path data-fill d={lobePath("bottom")} fill="var(--color-ink)" opacity="0" />
              <path data-outline d={lobePath("bottom")} fill="none" stroke="var(--color-mint)" strokeWidth="10" />
            </g>
          </svg>
        </div>
        <p data-meta className="mt-8 text-sm text-ink-2">Aven · perp-aware fees</p>
      </div>
      <p data-meta className="absolute bottom-7 left-7 text-xs text-faint">
        {config.chainName} · chain {config.chainId}
      </p>
      <p data-meta className="num absolute bottom-6 right-7 text-sm text-mint">
        <span data-count>000</span>
      </p>
    </div>,
    document.body,
  );
}

"use client";
/**
 * GSAP setup, registered once on the client. Every plugin used here ships in the free `gsap` package (3.13+).
 * Motion respects prefers-reduced-motion: components build their timelines inside `gsap.matchMedia()` with the
 * `motionOK` condition, and fall back to instant states otherwise.
 */
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

let registered = false;
if (typeof window !== "undefined" && !registered) {
  gsap.registerPlugin(useGSAP, ScrollTrigger, ScrollSmoother, SplitText, DrawSVGPlugin, MorphSVGPlugin);
  gsap.defaults({ ease: "power3.out", duration: 0.8 });
  registered = true;
  // Dev only: expose gsap for debugging timelines from the console (e.g. gsap.ticker.lagSmoothing(0)).
  if (process.env.NODE_ENV !== "production") (window as unknown as { gsap: typeof gsap }).gsap = gsap;
}

export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
export const REDUCED = "(prefers-reduced-motion: reduce)";

export { gsap, useGSAP, ScrollTrigger, ScrollSmoother, SplitText, DrawSVGPlugin, MorphSVGPlugin };

"use client";
/** Route enter transition: a short fade, GSAP. Re-mounts on every navigation (App Router template). */
import { useRef, type ReactNode } from "react";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";

export default function Template({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(ref.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.7, ease: "power2.out" }); // opacity only: a transform here would offset pinned ScrollTriggers
      });
      return () => mm.revert();
    },
    { scope: ref },
  );
  return <div ref={ref}>{children}</div>;
}

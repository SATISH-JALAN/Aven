/**
 * The Aven mark, rebuilt as vector geometry from frontend/public/*Emblem.png: two opposing lobes that meet at two
 * points and leave a lens of negative space between them. In the app the lens is the price gap: when the pool sits at
 * fair value it is the resting logo; a stale pool opens it wider (see LiveEmblem).
 *
 * ViewBox 650 × 700. The lobes touch at (145, 350) and (605, 350). `h` is the lens half-height (100 = the logo).
 */
import type { SVGProps } from "react";

export const EMBLEM_VIEWBOX = "0 0 650 700";
export const LENS_REST = 100;

const r = (n: number) => Math.round(n * 10) / 10;

export function lobePath(which: "top" | "bottom", h = LENS_REST): string {
  const f = (y: number) => (which === "top" ? y : 700 - y);
  const y1 = r(f(350 - h * 0.7));
  const y2 = r(f(350 - h));
  const y3 = r(f(350 - h * 0.6));
  return [
    `M0,${f(0)} H415`,
    `C530,${f(0)} 650,${f(95)} 650,${f(220)}`,
    `C650,${f(270)} 635,${f(305)} 605,350`,
    `C545,${y1} 470,${y2} 385,${y2}`,
    `C290,${y2} 210,${y3} 145,350`,
    `C55,${f(255)} 0,${f(135)} 0,${f(0)} Z`,
  ].join(" ");
}

export function Emblem({ h = LENS_REST, title = "Aven", ...props }: { h?: number; title?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox={EMBLEM_VIEWBOX} role="img" aria-label={title} {...props}>
      <path data-lobe="top" d={lobePath("top", h)} fill="currentColor" />
      <path data-lobe="bottom" d={lobePath("bottom", h)} fill="currentColor" />
    </svg>
  );
}

/** Stroke-built wordmark matching the logo: crossbar-less Λ, V, an E whose middle bar floats free of the spine, N. */
export function Wordmark({ strokeWidth = 9, ...props }: { strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="-6 -4 412 112" role="img" aria-label="AVEN" fill="none" stroke="currentColor" strokeWidth={strokeWidth} {...props}>
      <path data-letter d="M3,104 L45,4 L87,104" strokeLinejoin="miter" />
      <path data-letter d="M108,4 L150,104 L192,4" strokeLinejoin="miter" />
      <path data-letter d="M284,8 H228 Q218,8 218,18 V86 Q218,96 228,96 H284" strokeLinecap="butt" />
      <path data-letter d="M236,52 H274" strokeLinecap="butt" />
      <path data-letter d="M312,104 V12 Q312,3 319,9 L388,93 Q396,101 396,91 V4" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Emblem className="h-6 w-auto" />
      <Wordmark className="h-[15px] w-auto" />
    </span>
  );
}

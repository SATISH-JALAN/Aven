# frontend/

The Next.js (App Router) web app, package `@aven/web` (spec name: `apps/web`). Pages: landing `/`, Trade `/trade`, Swap `/swap`, Pool `/pool`, Replay `/replay`, Docs `/docs/*` (incl. the verify tool at `/docs/verify`) and the tx proof `/verify/[tx]`. Old `/arena`, `/how`, `/build` and `/verify` links redirect. Check the trade, swap and liquidity paths end to end on a local chain with `pnpm --filter @aven/arena check:frontend`. Features: [../docs/spec/FRONTEND.md](../docs/spec/FRONTEND.md); backend API it calls: [../docs/spec/API.md](../docs/spec/API.md); code flow: [../docs/FLOW.md](../docs/FLOW.md) §9.

## Run

```bash
pnpm install                                 # at the repo root
cp frontend/.env.example frontend/.env.local # optional; defaults work
pnpm --filter @aven/web dev                  # http://localhost:3000
pnpm --filter @aven/web test                 # vitest: fee walkthrough ≡ compute(), recorded fee 8,700, formats
pnpm --filter @aven/web build                # production build (Turbopack)
pnpm --filter @aven/web sync:deployments     # copy contracts/deployments/<chainId>.json into src/config/
```

## Data modes (badge in the nav)

| Mode | When | Data |
|---|---|---|
| **LIVE** | `NEXT_PUBLIC_ARENA_API` answers `/health` | Arena REST + `/stream` SSE (polling fallback); chain reads via `NEXT_PUBLIC_RPC` |
| **RECORDED** | no Arena URL, it's unreachable, or `NEXT_PUBLIC_MODE=recorded` | `public/arena-fallback.json`. Its addresses are never shown as this chain's unless its `chainId` matches |
| **REPLAY** | `/replay` | `public/replay/<scenario>.json` (from `backend/scripts/replay-to-web.ts`) |

Verify recomputes fees **in the browser** with the exact BigInt port (`@aven/core/fee`, `@aven/core/verify`) from the RPC receipt; it doesn't need the Arena service.

## Design

- **Mark.** `src/components/brand.tsx` rebuilds the emblem from `public/*Emblem.png` as two SVG lobes, plus a stroke wordmark. The lens between the lobes is parametric (`lobePath(which, h)`): it opens with the live price gap (Aven pool card), and on scroll in the hero.
- **Motion.** GSAP (`src/lib/gsap.ts`): ScrollSmoother, ScrollTrigger (pinned and scrubbed sections), SplitText, DrawSVG, quickTo (cursor, magnetic buttons). All motion is built inside `gsap.matchMedia()` and switches off for `prefers-reduced-motion`.
- **Landing graphics.** `components/landing/ParticleField.tsx` is a three.js point cloud sampled from the emblem. GSAP tweens its states (assemble, lens opens, market stream), and there's a static SVG fallback without WebGL. The preloader plays once per session.
- **Palette.** Near-black with a HyperCore green. Mint `#97fce4` and pink `#ff4fb8` are UI accents only. Type: Instrument Serif / Michroma / Manrope / JetBrains Mono.
- **Colour.** Monochrome ink; colour only for meaning. Chart series were validated with the dataviz palette checker against the dark surface (see `globals.css`).
- **Connect wallet.** Privy (`NEXT_PUBLIC_PRIVY_APP_ID`), wallet connections only (no email sign-in). Without an app id the button reads "Wallet off" and the rest works.
- **Config.** One file: `src/config.ts` (chain, RPC, explorer, addresses, source-line links).

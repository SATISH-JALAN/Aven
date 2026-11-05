<!-- INTERIM STAND-IN for Appendix B6 -->
> **Interim stand-in.** Appendix B6 of `docs/planning/aven-claude-code-prompts.md` was not in the repo at bootstrap. The text below is copied verbatim from `docs/planning/perp-aware-pools-handoff.md` (§9 Frontend). Replace this whole file with Appendix B6 verbatim once the prompts file is added.

## 9. Frontend (two pages, phone-ready)

**Arena (demo page)**
- Two pool cards side by side (stacked on phone): Plain vs Perp-Aware. Each: pool price, fair value (oracle), gap.
- Live counters per pool: bot profit, LP fee income, trade count. Big number between them: "LPs kept $X more."
- Buttons: "Shock both pools", "Start bot" (demo wallet on testnet).
- Trade tape: each bot trade with pool, size, fee breakdown, tx link; tap → verify result.
- Small "try it yourself" swap panel with live fee preview for both directions.

**Replay**
- Scenario picker (Oct 29 Binance halt, calm day, second volatile day) → Run → four LP-value lines animate.
- Results table; shareable link + QR code so judges rerun on their phones.

**Visual direction:** dark terminal ground, sans text, monospaced numbers; teal = normal, amber = stress; every number labelled with its source; "live testnet" or "replay" badge on every view.

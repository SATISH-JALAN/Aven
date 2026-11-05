<!-- INTERIM STAND-IN for Appendix B5 -->
> **Interim stand-in.** Appendix B5 of `docs/planning/aven-claude-code-prompts.md` was not in the repo at bootstrap. The text below is copied verbatim from `docs/planning/perp-aware-pools-handoff.md` (§8 Replay engine and Market data). Replace this whole file with Appendix B5 verbatim once the prompts file is added.

**Replay engine**
- Headline: **Oct 29, 2026** around the Binance halt (from 20:05 UTC). Plus a calm day and one more volatile day.
- Four pools from the same state: fixed 0.05%, fixed 0.30%, hook on 60s-delayed price, hook on live price.
- Each minute: set `MockHyperCore` prices; arb agent trades to fair when profitable; seeded retail agent does small random swaps (reproducible).
- Output: CSV of LP value vs holding per pool per step.
- Oracle approximation: mark adjusted by recorded premium/funding. State the method on the slide.

**Market data:** Hyperliquid info API `candleSnapshot` (1m) + funding history, paged (max ~5,000 candles per response). Save the Oct 29 window as raw CSV early; third-party historical providers are the fallback.

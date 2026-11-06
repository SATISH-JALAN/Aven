"""Render the README diagrams as hand-built SVG, in a light and a dark theme.

    python docs/diagrams/render.py

Standard library only. Writes docs/diagrams/<name>-light.svg and <name>-dark.svg; the README picks one with
<picture> and prefers-color-scheme. Every number drawn here comes from docs/PROOFS.md or
backend/data/replay/README.md: update those first, then re-render.
"""

from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent

SANS = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"

THEMES = {
    "light": dict(
        bg="#ffffff", frame="#d0d7de", text="#1f2328", muted="#59636e", faint="#8c959f", shadow="0.10",
        card="#ffffff", cardLine="#d0d7de", chip="#f6f8fa", chipLine="#d8dee4", line="#8c959f",
        evmFill="#f0fdfa", evmLine="#99f6e4", evm="#0d9488", evmText="#0f766e",
        coreFill="#fffbeb", coreLine="#fde68a", core="#d97706", coreText="#b45309",
        offFill="#f6f8fa", offLine="#d0d7de", off="#57606a",
        uni="#ff007a", uniFill="#fff0f7", uniText="#c2185b",
        user="#6366f1", userFill="#eef2ff", userText="#4338ca",
        red="#dc2626", redFill="#fef2f2", redText="#b91c1c",
        green="#16a34a", greenFill="#f0fdf4", greenText="#15803d",
        barMuted="#afb8c1",
    ),
    "dark": dict(
        bg="#0d1117", frame="#30363d", text="#e6edf3", muted="#9198a1", faint="#6e7681", shadow="0.55",
        card="#151b23", cardLine="#30363d", chip="#1c2330", chipLine="#3d444d", line="#6e7681",
        evmFill="#0a1f1d", evmLine="#134e4a", evm="#2dd4bf", evmText="#5eead4",
        coreFill="#1d170b", coreLine="#5c3d0e", core="#fbbf24", coreText="#fcd34d",
        offFill="#10151c", offLine="#30363d", off="#8b949e",
        uni="#ff4fa3", uniFill="#2b0f1e", uniText="#ff8cc6",
        user="#818cf8", userFill="#161936", userText="#a5b4fc",
        red="#f87171", redFill="#2a1215", redText="#fca5a5",
        green="#4ade80", greenFill="#0e2215", greenText="#86efac",
        barMuted="#545d68",
    ),
}


def tw(s: str, size: float, mono: bool = False) -> float:
    """Rough text width, for sizing chips."""
    return len(s) * size * (0.61 if mono else 0.55)


class Svg:
    def __init__(self, w: int, h: int, t: dict, title: str, desc: str):
        self.w, self.h, self.t, self.parts = w, h, t, []
        self.title, self.desc = title, desc
        self.markers: set[str] = set()

    # ---- primitives ------------------------------------------------------------------------------------------
    def add(self, s: str) -> None:
        self.parts.append(s)

    def rect(self, x, y, w, h, rx=12, fill="none", stroke="none", sw=1.0, dash=None, shadow=False, opacity=None):
        extra = f' stroke-dasharray="{dash}"' if dash else ""
        extra += ' filter="url(#shadow)"' if shadow else ""
        extra += f' fill-opacity="{opacity}"' if opacity else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" '
                 f'stroke-width="{sw}"{extra}/>')

    def text(self, x, y, s, size=13, color=None, weight=400, anchor="start", mono=False, ls=None, italic=False):
        color = color or self.t["text"]
        fam = MONO if mono else SANS
        extra = f' letter-spacing="{ls}"' if ls else ""
        extra += ' font-style="italic"' if italic else ""
        self.add(f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" '
                 f'fill="{color}" text-anchor="{anchor}"{extra}>{escape(s)}</text>')

    def marker(self, color: str) -> str:
        mid = "m" + color.lstrip("#")
        self.markers.add(color)
        return mid

    def path(self, d, color, sw=1.6, dash=None, flow=False, arrow=True, start_arrow=False):
        cls = ' class="flow"' if flow else ""
        extra = f' stroke-dasharray="{dash}"' if dash and not flow else ""
        m = self.marker(color)
        extra += f' marker-end="url(#{m})"' if arrow else ""
        extra += f' marker-start="url(#{m})"' if start_arrow else ""
        self.add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" '
                 f'stroke-linejoin="round"{extra}{cls}/>')

    def badge(self, cx, cy, n, color, r=11):
        self.add(f'<circle cx="{cx}" cy="{cy}" r="{r + 3}" fill="{self.t["bg"]}"/>')
        self.add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}"/>')
        self.text(cx, cy + 4.3, str(n), size=12, color="#ffffff", weight=700, anchor="middle")

    def chip(self, x, y, s, fill=None, stroke=None, color=None, size=11.5, mono=False, h=24, w=None, weight=600):
        w = w or tw(s, size, mono) + 22
        self.rect(x, y, w, h, rx=h / 2, fill=fill or self.t["chip"], stroke=stroke or self.t["chipLine"])
        self.text(x + w / 2, y + h / 2 + size * 0.36, s, size=size, color=color or self.t["muted"], weight=weight,
                  anchor="middle", mono=mono)
        return w

    # ---- composites ------------------------------------------------------------------------------------------
    def card(self, x, y, w, h, title, lines=(), accent=None, fill=None, stroke=None, tag=None, tag_color=None,
             dashed=False, title_size=15, line_size=12.5, mono_lines=(), title_color=None, gap=19, top=27):
        t = self.t
        self.rect(x, y, w, h, rx=12, fill=fill or t["card"], stroke=stroke or t["cardLine"],
                  dash="5 4" if dashed else None, shadow=not dashed)
        tx = x + 18
        if accent:
            self.rect(x + 10, y + 13, 3.5, h - 26, rx=1.75, fill=accent)
            tx = x + 24
        self.text(tx, y + top, title, size=title_size, weight=700, color=title_color or t["text"])
        if tag:
            self.text(x + w - 14, y + top, tag, size=12, weight=600, mono=True, anchor="end",
                      color=tag_color or t["muted"])
        for i, s in enumerate(lines):
            self.text(tx, y + top + 6 + gap * (i + 1) - 4, s, size=line_size, color=t["muted"], mono=i in mono_lines)

    def group(self, x, y, w, h, label, fill, stroke, color, chip=None, rx=18):
        self.rect(x, y, w, h, rx=rx, fill=fill, stroke=stroke, sw=1.2)
        self.text(x + 24, y + 30, label, size=12, weight=800, color=color, ls=1.4)
        if chip:
            self.chip(x + 24 + tw(label, 12) * 1.18 + 14, y + 13, chip, size=11, color=color, fill=self.t["bg"],
                      stroke=stroke, h=24)

    def header(self, title, subtitle):
        self.text(48, 60, title, size=26, weight=800)
        self.text(48, 88, subtitle, size=14, color=self.t["muted"])

    def legend(self, x, y, items):
        """items: (label, color, kind) with kind in {'flow', 'solid', 'dash'}; drawn right to left from x."""
        cx = x
        for label, color, kind in reversed(items):
            cx -= tw(label, 12) + 10
            self.text(cx, y + 4, label, size=12, color=self.t["muted"])
            cx -= 36
            self.path(f"M{cx} {y} L{cx + 28} {y}", color, sw=2.2 if kind == "flow" else 1.6,
                      dash="5 4" if kind == "dash" else None, flow=kind == "flow", arrow=False)
            cx -= 22

    # ---- output ----------------------------------------------------------------------------------------------
    def render(self) -> str:
        t = self.t
        markers = "".join(
            f'<marker id="m{c.lstrip("#")}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7.5" '
            f'markerHeight="7.5" orient="auto-start-reverse"><path d="M0,0.8 L9.2,5 L0,9.2 z" fill="{c}"/></marker>'
            for c in sorted(self.markers)
        )
        head = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
            f'viewBox="0 0 {self.w} {self.h}" role="img" aria-labelledby="t d">'
            f'<title id="t">{escape(self.title)}</title><desc id="d">{escape(self.desc)}</desc>'
            f'<defs>{markers}<filter id="shadow" x="-10%" y="-10%" width="120%" height="140%">'
            f'<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="{t["shadow"]}"/>'
            f'</filter></defs>'
            '<style>.flow{stroke-dasharray:7 6;animation:flow 1.1s linear infinite}'
            '@keyframes flow{to{stroke-dashoffset:-13}}'
            '@media (prefers-reduced-motion:reduce){.flow{animation:none}}</style>'
            f'<rect x="0.5" y="0.5" width="{self.w - 1}" height="{self.h - 1}" rx="20" fill="{t["bg"]}" '
            f'stroke="{t["frame"]}"/>'
        )
        return head + "".join(self.parts) + "</svg>\n"


# ================================================================================================================
# 1. System architecture
# ================================================================================================================
def architecture(t: dict) -> Svg:
    s = Svg(1280, 830, t, "Aven system architecture",
            "Swaps enter the Uniswap v4 PoolManager, which calls AvenHook; AvenHook uses the AvenFairValue library, "
            "which reads HyperCore's oracle and mark price precompiles in the same block and returns an override "
            "fee. Off-chain services only trade, quote and verify.")
    s.header("Aven · system architecture",
             "One path sets every fee: PoolManager → AvenHook → AvenFairValue → HyperCore. "
             "Everything off-chain is a client that can trade, quote and verify, never set a fee.")
    s.legend(1232, 56, [("fee path", t["uni"], "flow"), ("transactions", t["line"], "solid"),
                        ("read-only calls", t["line"], "dash")])

    # --- users ---
    s.text(48, 152, "USERS", size=12, weight=800, color=t["userText"], ls=1.4)
    s.card(48, 168, 200, 68, "Swappers & routers", ["any v4 router or wallet"], accent=t["user"])
    s.card(48, 252, 200, 68, "Liquidity providers", ["earn every override fee"], accent=t["user"])
    s.card(48, 336, 200, 68, "Hook builders", ["import AvenFairValue"], accent=t["user"])

    # --- HyperEVM ---
    s.group(300, 128, 500, 420, "HYPEREVM", t["evmFill"], t["evmLine"], t["evmText"], chip="mainnet 999 · Cancun")
    s.card(324, 168, 452, 128, "Uniswap v4 PoolManager", ["Uniswap canonical · 0x12D4…6B1F"], accent=t["uni"])
    # pools
    s.rect(340, 232, 204, 50, rx=10, fill=t["evmFill"], stroke=t["evmLine"])
    s.text(354, 252, "Aven pool", size=13, weight=700, color=t["evmText"])
    s.text(354, 270, "dynamic fee · 0x800000", size=11.5, mono=True, color=t["muted"])
    s.rect(556, 232, 204, 50, rx=10, fill=t["chip"], stroke=t["chipLine"])
    s.text(570, 252, "Control pool", size=13, weight=700, color=t["muted"])
    s.text(570, 270, "fixed 0.30% · no hook", size=11.5, mono=True, color=t["muted"])
    s.card(324, 340, 206, 84, "AvenHook", ["init + swap hooks only", "addr bits 0x2080 · no owner"],
           accent=t["evm"], line_size=12)
    s.card(570, 340, 206, 84, "AvenFairValue", ["integer-only fee library", "internal → inlined"],
           accent=t["evm"], line_size=12)
    # fee-path strip
    s.rect(324, 448, 452, 80, rx=12, fill=t["uniFill"], stroke=t["uni"], sw=0.8, opacity=None)
    s.text(340, 470, "THE ONLY PATH THAT SETS A FEE", size=11, weight=800, color=t["uniText"], ls=1.2)
    x = 348
    for n, label in [(1, "swap"), (2, "beforeSwap"), (3, "compute"), (4, "read oracle + mark")]:
        s.badge(x, 491, n, t["uni"], r=8)
        s.text(x + 13, 495.5, label, size=12, color=t["text"])
        x += 13 + tw(label, 12) + 26
    s.badge(348, 513, 5, t["uni"], r=8)
    s.text(361, 517.5, "fee | 0x400000 → LPs", size=12, mono=True, color=t["text"])
    s.text(530, 517.5, "· FeeComputed emits every input", size=12, color=t["muted"])

    # --- HyperCore ---
    s.group(900, 128, 332, 420, "HYPERCORE", t["coreFill"], t["coreLine"], t["coreText"],
            chip="same HyperBFT consensus")
    s.card(920, 168, 292, 88, "Oracle price", ["fair value · validator median", "of 8 CEX spot venues, ~3 s"],
           accent=t["core"], tag="0x…0807", tag_color=t["coreText"])
    s.card(920, 272, 292, 88, "Mark price", ["perp pressure + stress signal", "HL book + CEX perp mids, blended"],
           accent=t["core"], tag="0x…0806", tag_color=t["coreText"])
    s.card(920, 376, 292, 72, "perpAssetInfo", ["deploy-time: coin ETH, szDecimals 4"], accent=t["core"],
           tag="0x…080a", tag_color=t["coreText"], title_size=14)
    for i, line in enumerate(["Values match HyperCore state when the",
                              "EVM block is built: no relay, no signer.",
                              "Every swap in a block sees the same prices."]):
        s.text(924, 476 + 19 * i, line, size=12.5, color=t["coreText"])

    # --- off-chain ---
    s.group(48, 590, 1184, 210, "OFF-CHAIN", t["offFill"], t["offLine"], t["off"],
            chip="no privileged entry point")
    s.card(72, 634, 164, 142, "Web app", ["Trade · Swap · Pool", "Replay · Docs · Verify", "Next.js 16"],
           fill=t["offFill"])
    s.card(280, 634, 320, 142, "Arena service", ["Node · viem · Hono"], accent=t["off"])
    for (cx, cy, label) in [(304, 690, "block poller · POLL_MS"), (452, 690, "arb bot"),
                            (304, 728, "shock wallet"), (452, 728, "HTTP + SSE API")]:
        s.chip(cx, cy, label, w=136, h=28, size=11.5, color=t["text"], weight=500)
    s.card(624, 634, 234, 142, "@aven/core", ["fee.ts · exact BigInt port", "verify CLI · checks A + B",
                                              "ABIs generated from forge"], accent=t["off"])
    s.card(882, 634, 170, 142, "Replay engine", ["Foundry · 4 pools", "real AvenHook", "mock precompiles"],
           accent=t["off"])
    s.card(1076, 634, 132, 142, "Hyperliquid", ["info API", "mainnet candles", "+ funding"], dashed=True,
           fill=t["offFill"])

    # --- edges: fee path ---
    s.path("M248 202 L320 202", t["uni"], sw=2.4, flow=True)
    s.badge(284, 202, 1, t["uni"])
    s.path("M480 296 L480 336", t["uni"], sw=2.4, flow=True)
    s.badge(480, 317, 2, t["uni"])
    s.path("M530 382 L566 382", t["uni"], sw=2.4, flow=True)
    s.badge(548, 362, 3, t["uni"])
    s.path("M776 372 C 848 372, 848 212, 916 212", t["uni"], sw=2.4, flow=True)
    s.path("M776 392 C 848 392, 848 316, 916 316", t["uni"], sw=2.4, flow=True)
    s.badge(848, 300, 4, t["uni"])
    s.text(850, 432, "staticcall", size=11.5, anchor="middle", color=t["uniText"], weight=600)
    s.text(850, 447, "30k gas cap", size=11.5, anchor="middle", color=t["uniText"], weight=600)
    s.text(850, 462, "never reverts", size=11.5, anchor="middle", color=t["uniText"], weight=600)
    s.path("M372 340 L372 300", t["uni"], sw=2.4, flow=True)
    s.badge(372, 319, 5, t["uni"])
    # other edges
    s.path("M248 286 C 286 286, 286 266, 320 266", t["line"])
    s.path("M248 370 C 282 370, 284 436, 316 436 L 663 436 Q 673 436 673 428", t["user"], dash="5 4")
    s.path("M236 705 L276 705", t["line"])
    s.text(256, 697, "SSE", size=10.5, anchor="middle", color=t["muted"])
    s.path("M400 634 L400 552", t["line"])
    s.text(392, 576, "arb + shock swaps", size=12, anchor="end", color=t["muted"])
    s.path("M500 634 L500 552", t["line"], dash="5 4")
    s.text(508, 576, "eth_call: previewFee, slot0", size=12, color=t["muted"])
    s.path("M720 548 L720 630", t["evm"], dash="5 4")
    s.text(728, 576, "FeeComputed + Swap logs", size=12, color=t["evmText"])
    s.path("M1052 705 L1072 705", t["line"], dash="5 4")
    return s


# ================================================================================================================
# 2. Inside beforeSwap
# ================================================================================================================
def fee_pipeline(t: dict) -> Svg:
    s = Svg(1280, 760, t, "Inside AvenHook.beforeSwap",
            "Steps of one beforeSwap call: read pool price and top-of-block, read oracle and mark with a gas cap, "
            "fall back on a bad read, compute gap, direction, premium and stress, clamp, persist, emit, return the "
            "fee with the override flag.")
    s.header("Inside beforeSwap · how one fee is computed",
             "Integer-only, never reverts on a bad read, identical in Solidity and TypeScript. "
             "Defaults shown: base 0.05%, cap 1%, fallback 0.30%.")

    # row 1
    s.card(48, 128, 250, 100, "PoolManager calls", ["AvenHook.beforeSwap", "onlyPoolManager · same block,",
                                                    "same oracle and mark"], accent=t["uni"], mono_lines=(0,),
           gap=18)
    s.badge(48, 128, 1, t["uni"])
    s.card(330, 128, 272, 100, "Pool price + top of block",
           ["getSlot0 via extsload", "first swap of the block stores", "sqrtPriceTop for the whole block"],
           accent=t["evm"], gap=18)
    s.badge(330, 128, 2, t["uni"])
    s.card(634, 128, 300, 100, "Read HyperCore",
           ["staticcall 0x807 oracle · 0x806 mark", "exactly 30,000 gas each", "≤ 32-byte copy · never reverts"],
           accent=t["core"], gap=18)
    s.badge(634, 128, 3, t["uni"])
    # decision
    cx, cy = 1010, 178
    s.add(f'<polygon points="{cx},{cy - 50} {cx + 50},{cy} {cx},{cy + 50} {cx - 50},{cy}" fill="{t["card"]}" '
          f'stroke="{t["core"]}" stroke-width="1.6" filter="url(#shadow)"/>')
    s.text(cx, cy - 2, "both reads", size=12, anchor="middle", weight=700)
    s.text(cx, cy + 14, "ok?", size=12, anchor="middle", weight=700)
    s.path("M298 178 L326 178", t["uni"], sw=2.2, flow=True)
    s.path("M602 178 L630 178", t["uni"], sw=2.2, flow=True)
    s.path("M934 178 L956 178", t["uni"], sw=2.2, flow=True)

    # fallback column
    s.rect(1084, 128, 148, 412, rx=16, fill=t["redFill"], stroke=t["red"], sw=0.9, dash="5 4")
    s.text(1158, 154, "FALLBACK", size=11, weight=800, color=t["redText"], anchor="middle", ls=1.3)
    s.text(1158, 170, "never reverts (I1)", size=11.5, color=t["redText"], anchor="middle")
    for y, reason, why in [(186, "READ_FAILED", "revert · empty · zero"), (390, "GAP_TOO_LARGE", "gap > 2,000 bp")]:
        s.rect(1098, y, 120, 96, rx=10, fill=t["card"], stroke=t["red"], sw=1)
        s.text(1158, y + 26, "3,000 pips", size=14, weight=800, anchor="middle", color=t["redText"])
        s.text(1158, y + 46, reason, size=11, anchor="middle", mono=True, color=t["text"])
        s.text(1158, y + 66, why, size=11, anchor="middle", color=t["muted"])
        if y == 186:
            s.text(1158, y + 82, "> uint64 · gas burn", size=11, anchor="middle", color=t["muted"])
    s.path("M1060 178 L1080 178 L1080 214 L1094 214", t["red"], sw=1.8)
    s.text(1070, 168, "no", size=12, weight=700, anchor="middle", color=t["redText"])
    s.path("M1010 228 L1010 266", t["green"], sw=2.2, flow=True)
    s.text(1020, 252, "yes", size=12, weight=700, color=t["greenText"])

    # compute
    s.group(48, 270, 1012, 270, "COMPUTE", t["evmFill"], t["evmLine"], t["evmText"],
            chip="AvenFairValue.compute · pure · mirrored by fee.ts")
    cards = [
        ("Fair-value gap", ["pool price vs oracle, in wad", "max(current, top-of-block)", "when both sit on one side"],
         "gap bp"),
        ("Direction", ["does this swap close", "the gap? (arbitrage)", "if yes: + gap × 50 pips"], "arb"),
        ("Perp premium", ["(mark − oracle) / oracle", "trading with the pressure?", "if yes: + |premium| × 50"],
         "with pressure"),
        ("Mark stress", ["mark vs time-weighted", "anchor, τ = 60 s", "above 50 bp: + (move−50) × 20"], "stress"),
    ]
    for i, (title, lines, _) in enumerate(cards):
        x = 72 + i * 250
        s.card(x, 316, 214, 132, title, lines, accent=t["evm"], gap=19)
        if i:
            s.add(f'<circle cx="{x - 18}" cy="382" r="13" fill="{t["bg"]}" stroke="{t["evmLine"]}"/>')
            s.text(x - 18, 387.5, "+", size=17, weight=800, anchor="middle", color=t["evmText"])
    s.path("M286 448 L286 470 L1072 470 L1072 438 L1094 438", t["red"], sw=1.4, dash="4 4")
    s.text(296, 466, "gap > 2,000 bp", size=11, color=t["redText"])
    s.rect(72, 486, 964, 40, rx=10, fill=t["card"], stroke=t["evm"], sw=1.2)
    s.text(554, 511, "fee = clamp( 500 + gap term + premium term + stress term ,  500 ,  10,000 )  pips",
           size=14, mono=True, anchor="middle", weight=600, color=t["evmText"])
    s.badge(48, 270, 4, t["uni"])

    # output bar
    s.path("M554 540 L554 584", t["uni"], sw=2.2, flow=True)
    s.path("M1158 540 L1158 584", t["red"], sw=1.8)
    s.rect(48, 588, 1184, 132, rx=16, fill=t["greenFill"], stroke=t["green"], sw=1)
    segs = [
        (5, "Persist 2 storage slots", ["top-of-block price · mark anchor", "anchor moves only on good reads (I9)"]),
        (6, "emit FeeComputed", ["fee, reason, oracle, mark, anchor,", "both prices → pnpm verify (I8)"]),
        (7, "return fee | 0x400000", ["override flag on every path (I3)", "ZERO_DELTA · hook holds no tokens (I4)"]),
    ]
    for i, (n, title, lines) in enumerate(segs):
        x = 72 + i * 392
        s.card(x, 608, 360, 92, title, lines, accent=t["green"], gap=18,
               title_color=t["greenText"] if n == 7 else None)
        s.badge(x, 608, n, t["uni"])
        if i:
            s.path(f"M{x - 28} 654 L{x - 6} 654", t["green"], sw=2)
    return s


# ================================================================================================================
# 3. Proofs
# ================================================================================================================
def proofs(t: dict) -> Svg:
    s = Svg(1280, 720, t, "How every Aven fee is proven",
            "Three checks: Solidity and TypeScript agree on 10,000 fee vectors and 2,000 anchor vectors; every live "
            "FeeComputed event is recomputed and cross-checked against the PoolManager Swap fee; and the Foundry "
            "suite covers unit, fuzz, integration, invariant and load tests.")
    s.header("Aven · how every fee is proven",
             "Three independent checks. The fee math and the hook rules were also mutation-tested: we broke the "
             "code on purpose and watched the matching test go red.")

    def lane(y, h, label, result):
        s.rect(48, y, 1184, h, rx=18, fill=t["offFill"], stroke=t["offLine"], sw=1.2)
        s.text(72, y + 30, label, size=12, weight=800, color=t["off"], ls=1.4)
        w = tw(result, 12.5) + 30
        s.chip(1208 - w, y + 12, result, fill=t["greenFill"], stroke=t["green"], color=t["greenText"], size=12.5,
               h=28, w=w, weight=700)

    # lane 1
    lane(124, 168, "SAME MATH, TWO LANGUAGES", "I7 · 10,000 / 10,000 + 2,000 / 2,000 exact")
    l1 = [(72, 250, "AvenFairValue.compute", ["Solidity · FullMath.mulDiv", "contracts/src"], t["evm"]),
          (370, 270, "GenVectors.t.sol", ["fixed seed · 9 coverage classes", "GEN_VECTORS=1"], t["off"]),
          (688, 240, "Vectors (JSON)", ["10,000 fee · 2,000 anchor", "backend/data/vectors"], t["off"]),
          (976, 232, "fee.ts (BigInt)", ["differential.test.ts", "every Breakdown field"], t["evm"])]
    for x, w, title, lines, acc in l1:
        s.card(x, 176, w, 92, title, lines, accent=acc, mono_lines=(1,) if title != "Vectors (JSON)" else (1,),
               gap=19)
    for x0, x1 in [(322, 366), (640, 684), (928, 972)]:
        s.path(f"M{x0} 222 L{x1} 222", t["line"], sw=1.8)

    # lane 2
    lane(312, 210, "EVERY LIVE FEE, RE-DERIVED", "I8 · local 2/2 · burst 280/280 · RPC faults 348/348")
    s.card(72, 370, 190, 128, "Swap tx", ["any router · any wallet", "Arena bot or shock"], accent=t["uni"])
    s.card(306, 364, 272, 62, "FeeComputed", ["every input the fee used"], accent=t["evm"], gap=17, top=25)
    s.card(306, 442, 272, 62, "PoolManager Swap", ["the fee actually charged"], accent=t["uni"], gap=17, top=25)
    s.card(622, 364, 268, 140, "pnpm verify <tx>", ["rebuild Inputs from the event", "recompute with fee.ts",
                                                    "--all: ≤ 50-block log chunks", "also: GET /verify/:tx"],
           accent=t["evm"], gap=19)
    s.path("M262 420 C 284 420, 284 395, 302 395", t["line"], sw=1.8)
    s.path("M262 448 C 284 448, 284 473, 302 473", t["line"], sw=1.8)
    s.path("M578 395 C 600 395, 600 420, 618 420", t["evm"], sw=1.8)
    s.path("M578 473 C 600 473, 600 448, 618 448", t["evm"], sw=1.8)
    s.chip(936, 372, "check A · recomputed == event fee", w=272, h=32, size=12.5, color=t["text"], weight=500)
    s.chip(936, 414, "check B · Swap.fee == event fee", w=272, h=32, size=12.5, color=t["text"], weight=500)
    s.chip(936, 458, "MATCH", w=272, h=36, size=15, fill=t["greenFill"], stroke=t["green"], color=t["greenText"],
           weight=800)
    s.path("M890 434 L930 434", t["line"], sw=1.8)

    # lane 3
    lane(542, 158, "CONTRACT TEST SUITE · forge test", "90 passed · 0 failed")
    items = [("Unit + fuzz", ["34 tests · 1,000 runs", "fixed seed"]),
             ("v4 integration", ["real PoolManager", "both token orders"]),
             ("9 named tests", ["split swap · dust · sandwich", "bad reads · wrong pool"]),
             ("Invariants", ["I1 I2 I3 I4 I9", "64 runs × 64 calls"]),
             ("Load · LOAD=1", ["2,318 swaps / 250 blocks", "broken reads · 0 reverts"])]
    for i, (title, lines) in enumerate(items):
        s.card(72 + i * 230, 592, 214, 88, title, lines, accent=t["evm"], gap=19)
    return s


# ================================================================================================================
# 4. Replay
# ================================================================================================================
def replay(t: dict) -> Svg:
    s = Svg(1280, 690, t, "Aven replay on real Hyperliquid history",
            "Pipeline from the Hyperliquid mainnet info API through a Foundry replay of four pools to the web export, "
            "and the result: LP value minus HODL per pool for the Oct 29 2026 Binance halt and a calm day.")
    s.header("Aven · replay on real Hyperliquid history",
             "Same HYPE price path, same seeded retail flow, four pools. Spec-default parameters, nothing tuned.")

    steps = [(48, 214, "Hyperliquid info API", ["mainnet · HYPE perp", "candles 5m + funding"], t["core"]),
             (294, 238, "fetch-market-data.ts", ["→ normalized.csv", "oracle ≈ close / (1 + premium)"], t["off"]),
             (564, 316, "Replay.t.sol · Foundry", ["local PoolManager, mocks at 0x806/807", "each 5m step: arb agent,",
                                                   "seeded retail, collect LP fees"], t["evm"]),
             (912, 150, "CSV + summary", ["per pool, per step"], t["off"]),
             (1094, 138, "Replay page", ["public/replay/*.json"], t["off"])]
    for x, w, title, lines, acc in steps:
        s.card(x, 128, w, 112, title, lines, accent=acc, gap=19)
    for x0, x1 in [(262, 290), (532, 560), (880, 908), (1062, 1090)]:
        s.path(f"M{x0} 184 L{x1} 184", t["line"], sw=1.8)
    # pools
    pools = [("fixed 0.05%", t["barMuted"]), ("fixed 0.30%", t["barMuted"]), ("Aven · 60 s lag", t["evmLine"]),
             ("Aven · live", t["evm"])]
    x = 564
    for name, col in pools:
        w = tw(name, 12) + 34
        s.rect(x, 256, w, 28, rx=14, fill=t["chip"], stroke=t["chipLine"])
        s.add(f'<circle cx="{x + 14}" cy="270" r="5" fill="{col}"/>')
        s.text(x + 24, 274.5, name, size=12, color=t["text"])
        x += w + 8
    s.text(560, 304, "four pools · identical liquidity, range and start price", size=12, color=t["muted"])

    data = [("Oct 29 2026 · Binance halt", "18:00–24:00 UTC", [-318.18, 6.77, 114.47, 141.25]),
            ("Oct 25 2026 · calm day", "06:00–12:00 UTC", [64.52, 317.49, 323.39, 323.14])]
    names = ["fixed 0.05%", "fixed 0.30%", "Aven · 60 s lag", "Aven · live"]
    for p, (title, sub, vals) in enumerate(data):
        px = 48 + p * 604
        s.rect(px, 328, 580, 330, rx=18, fill=t["offFill"], stroke=t["offLine"], sw=1.2)
        s.text(px + 24, 360, title, size=16, weight=800)
        s.text(px + 24, 381, sub + " · LP value − HODL, USD", size=12.5, color=t["muted"])
        zero, scale = px + 300, 190 / 330
        s.add(f'<line x1="{zero}" y1="404" x2="{zero}" y2="604" stroke="{t["line"]}" stroke-width="1.2"/>')
        s.text(zero, 624, "$0", size=11.5, anchor="middle", color=t["muted"])
        for i, (name, v) in enumerate(zip(names, vals)):
            y = 416 + i * 46
            col = pools[i][1] if v >= 0 else t["red"]
            s.text(px + 24, y + 20, name, size=13, weight=700 if i == 3 else 500,
                   color=t["evmText"] if i >= 2 else t["text"])
            w = max(abs(v) * scale, 2)
            bx = zero if v >= 0 else zero - w
            s.rect(round(bx, 1), y + 3, round(w, 1), 26, rx=6, fill=col)
            label = f"{'+' if v >= 0 else '−'}${abs(v):,.2f}"
            if v >= 0:
                s.text(zero + w + 8, y + 21, label, size=13, weight=700, mono=True,
                       color=t["evmText"] if i >= 2 else t["muted"])
            else:
                s.text(bx + 10, y + 21, label, size=13, weight=700, mono=True, color="#ffffff")
        note = ("Live Aven beats the 60 s-delayed one: the edge is read speed." if p == 0 else
                "Aven ≈ fixed 0.30%, while ordinary flow pays only the 0.05% base fee.")
        s.text(px + 24, 646, note, size=12.5, color=t["muted"], italic=True)
    return s


# The Aven logo: emblem lobes from frontend/src/app/icon.svg, wordmark strokes from
# frontend/src/components/brand.tsx (Wordmark), on a transparent background.
LOGO_INK = {"light": "#09090a", "dark": "#f0efec"}


def logo(theme: str) -> str:
    ink = LOGO_INK[theme]
    lobes = [
        "M0,0 H415 C530,0 650,95 650,220 C650,270 635,305 605,350 C545,280 470,250 385,250 "
        "C290,250 210,290 145,350 C55,255 0,135 0,0 Z",
        "M0,700 H415 C530,700 650,605 650,480 C650,430 635,395 605,350 C545,420 470,450 385,450 "
        "C290,450 210,410 145,350 C55,445 0,565 0,700 Z",
    ]
    letters = [
        ('M3,104 L45,4 L87,104', 'stroke-linejoin="miter"'),
        ('M108,4 L150,104 L192,4', 'stroke-linejoin="miter"'),
        ('M284,8 H228 Q218,8 218,18 V86 Q218,96 228,96 H284', ''),
        ('M236,52 H274', ''),
        ('M312,104 V12 Q312,3 319,9 L388,93 Q396,101 396,91 V4', 'stroke-linejoin="round"'),
    ]
    emblem = "".join(f'<path d="{d}"/>' for d in lobes)
    word = "".join(f'<path d="{d}" {extra}/>' for d, extra in letters)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 488 132" width="488" height="132" '
        'role="img" aria-label="Aven">'
        f'<g fill="{ink}" transform="scale(0.1714)">{emblem}</g>'
        f'<g fill="none" stroke="{ink}" stroke-width="12.5" transform="translate(156 18) scale(0.78)">{word}</g>'
        '</svg>\n'
    )


def main() -> None:
    for name, fn in [("architecture", architecture), ("fee-pipeline", fee_pipeline), ("proofs", proofs),
                     ("replay", replay)]:
        for theme, t in THEMES.items():
            path = OUT / f"{name}-{theme}.svg"
            path.write_text(fn(t).render(), encoding="utf-8")
            print(f"wrote {path.relative_to(OUT.parent.parent)}")
    for theme in LOGO_INK:
        path = OUT / f"logo-{theme}.svg"
        path.write_text(logo(theme), encoding="utf-8")
        print(f"wrote {path.relative_to(OUT.parent.parent)}")


if __name__ == "__main__":
    main()

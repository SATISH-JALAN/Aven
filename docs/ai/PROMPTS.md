# AI prompt log

Every prompt given to the AI coding assistant (Claude Code), verbatim, in order. Timestamps are UTC.

---

## #0 — 2026-11-05T15:45:54Z — P0 Bootstrap

> Sent in the same message as #1.

```text
P0 — Bootstrap the repo and ground rules
You are building "Aven" for ETHGlobal Mumbai 2026 (Uniswap track). The full spec is in docs/planning/aven-claude-code-prompts.md (Part B appendices). Read Part B fully before doing anything.

Tasks:
1. Create a pnpm monorepo with this layout (Appendix B1): contracts/ (Foundry), packages/core/, services/arena/, apps/web/, data/raw/, data/replay/, docs/spec/, docs/planning/, docs/ai/.
2. Copy Part B appendices into separate spec files: docs/spec/ARCHITECTURE.md (B1), docs/spec/FEE_SPEC.md (B2), docs/spec/CONTRACTS.md (B3), docs/spec/API.md (B4), docs/spec/DATA.md (B5), docs/spec/FRONTEND.md (B6), docs/spec/TOOLS.md (B7). Copy verbatim.
3. Write CLAUDE.md at the repo root with:
   - one-paragraph product summary
   - the invariants from B2 and B3 (never revert swaps on a bad read; fee clamped or exactly fallback; no owner, no setters, no custody; same math in Solidity and TS; gas-capped precompile calls)
   - hard rules: no perp hedging, no CoreWriter calls, no custody, no admin keys, no extra sponsor integrations, never hard-code demo numbers in live views, never guess external APIs (record findings in docs/recon.md)
   - workflow: small commits after each passing step, conventional commit messages, run tests before committing
   - AI attribution: append every user prompt verbatim to docs/ai/PROMPTS.md with a timestamp, and keep docs/ai/ATTRIBUTION.md listing which files AI wrote or helped with
4. Create docs/ai/PROMPTS.md (append this prompt as entry #0), docs/ai/ATTRIBUTION.md (empty table: file | written by | notes), docs/recon.md (empty template with headings from P1).
5. Root files: .gitignore (node_modules, out, cache, broadcast with secrets, .env*), .env.example with placeholders only (DEPLOYER_PK, BOT_PK, SHOCK_PK, HYPEREVM_RPC=https://rpc.hyperliquid-testnet.xyz/evm, HL_INFO_API=https://api.hyperliquid-testnet.xyz/info, ARENA_ADMIN_TOKEN, NEXT_PUBLIC_ARENA_API), LICENSE (MIT), a short README stub.
6. If docs/planning/ has a pre-event handoff file, add a line at its top: "Written before kickoff; ideas and specs only, no code."

Do not write any contract or app code yet. Commit: "chore: bootstrap Aven monorepo, specs and AI attribution".

Gate: tree matches B1, spec files exist, CLAUDE.md exists, nothing secret committed.
```

---

## #1 — 2026-11-05T15:45:54Z — P1 Recon

> Sent in the same message as #0.

```text
P1 — Recon: verify every external fact before coding
Read CLAUDE.md and docs/spec/*. Before any code, verify these facts and write each answer, with the source (file path in installed deps, doc URL, or RPC output), into docs/recon.md. Do not guess. If something can't be verified, mark it UNVERIFIED and propose a fallback.

1. Uniswap v4: install the latest stable v4-core and v4-periphery into contracts/lib (forge install, pin to a tag). Record:
   - the exact import path of BaseHook (v4-periphery or OpenZeppelin uniswap-hooks) and the override signature of _beforeSwap and _beforeInitialize in that version
   - where SwapParams is defined in this version
   - LPFeeLibrary.DYNAMIC_FEE_FLAG and OVERRIDE_FEE_FLAG names and values
   - the test helpers available (Deployers, PoolSwapTest, PoolModifyLiquidityTest, HookMiner) and their paths
2. HyperCore precompiles: find Hyperliquid's L1Read.sol (official docs "Interacting with HyperCore") and record for markPx and oraclePx: address, calldata encoding (expected abi.encode(uint32 index)), return type (expected uint64), and the scaling rule (expected perps: human = raw / 10^(6 - szDecimals)). Also install hyper-evm-lib if available and note its read helpers.
3. HyperEVM testnet (chain 998, rpc https://rpc.hyperliquid-testnet.xyz/evm):
   - eth_chainId, latest block, gas price
   - is there a deployed Uniswap v4 PoolManager? search Uniswap's deployments/docs; if none found, record "deploy our own"
   - is the CREATE2 deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C deployed (eth_getCode)?
   - block types: small 1s/3M gas, big 1min/30M gas; how to switch (evmUserModify usingBigBlocks) and the requirement that the sender is a HyperCore user
   - a HyperEVM testnet block explorer URL
4. Hyperliquid testnet info API (POST https://api.hyperliquid-testnet.xyz/info {"type":"meta"}): the perp index and szDecimals for HYPE (index = position in universe). Then eth_call the oraclePx and markPx precompiles on testnet with that index and convert to human price. Compare with the info API price. Record both. Do the same lookup on mainnet (https://api.hyperliquid.xyz/info) for the replay.
5. Write a tiny Foundry test that does NOT run on a fork and confirms the mocks plan: precompiles can't be executed in local tests, so we etch a mock at 0x0000000000000000000000000000000000000806 and ...0807.

Output: docs/recon.md filled in, plus a "Decisions" section: which BaseHook to use, whether we deploy our own PoolManager, how we deploy the hook (CREATE2 deployer or our own), the HYPE perp index for testnet and mainnet. Commit: "docs: recon of v4, HyperCore precompiles and HyperEVM testnet".

Gate: you can read the HYPE oracle and mark price from the testnet precompile and they match the info API after scaling. If not, stop and fix before P2.
```

---

## #2 — 2026-11-05T17:02:13Z — Read architecture

```text
i have put product description and technical architecture in docs/description read it properly so know everything about the project
```

# DEPLOYMENTS.md — how to run Aven live

Two ways to run the unchanged contracts against live Hyperliquid prices:

- **§A Live mode (the demo path):** a local chain with live Hyperliquid mainnet prices. It needs no keys and no HYPE.
- **§B HyperEVM testnet (chain 998):** blocked, because nobody on the team could get testnet HYPE (2026-11-06). The runbook is kept for when HYPE is available.

## A. Live mode: local chain + live Hyperliquid prices

Decided by Sayan on 2026-11-06 (MEMORY.md). The contracts, deploy scripts, Arena and verifier are unchanged; only the chain is different.

### What runs (`pnpm live`, `backend/arena/scripts/live-local.ts`)

1. **The live price:** one read of Hyperliquid mainnet's info API (`metaAndAssetCtxs`) for **ETH, perp index 1, `szDecimals` 4**. The index was checked against `meta` on 2026-11-06. The script stops if index 1 isn't ETH with `szDecimals` 4.
2. **The chain:** anvil, chain 31337, 1-second blocks (HyperEVM's small-block rhythm), listening on 127.0.0.1:8545 only.
   - `MockHyperCorePx` (the same ABI as the precompiles, recon C) is placed at `0x806` (mark), `0x807` (oracle) and `0x80a` (perpAssetInfo).
   - The five deploy scripts run **unchanged** with `PERP_INDEX=1`, `EXPECT_COIN=ETH`. The pools open at the live oracle price.
3. **The price relay** (`backend/scripts/src/priceRelay.ts`), every second:
   - reads `oraclePx` and `markPx` from the API;
   - converts them to the precompile's raw integer, `px × 10^(6 − szDecimals)`, so ×100 for ETH (`pxToRaw` in `@aven/core`; integer-only; refuses any value it can't represent exactly);
   - writes both into the mocks' storage between blocks with `anvil_setStorageAt`. There's no transaction, so oracle and mark change together and never mid-block, like the real precompiles.

   It writes only when a value changes and logs every write to `relay.jsonl`.
4. **Stale prices:** if the API gives no good answer for 15 s (`RELAY_STALE_MS`), the relay makes both price reads revert, so the hook charges its **fallback fee** (`READ_FAILED`, I1). The first good answer writes fresh prices first, then turns reads back on.
5. **The Arena service:**
   - the bot is anvil account 1 and the shock wallet is account 2, both derived at runtime;
   - `backend/.env` is **not** read, because it holds testnet settings;
   - the default trade caps are `MAX_TRADE_BASE` 100 and `MAX_TRADE_QUOTE` 250,000, the sizes the e2e test proved for these pools.
6. **The public read-only RPC** on port 8546 (`backend/scripts/src/readOnlyRpc.ts`). It forwards only `eth_*` reads and refuses every send and every `anvil_*`/`evm_*`/`debug_*` method. **Never expose 8545:** anyone could rewrite the "oracle", or sign as our wallets with anvil's public test keys.

### Same as HyperEVM, and what differs

| Same as HyperEVM | Different |
|---|---|
| `AvenFairValue` and `AvenHook` bytecode | The chain is local anvil 31337, not HyperEVM, so there's no public transaction history |
| Uniswap's PoolManager build (byte-identical to HyperEVM mainnet) | The precompiles are a contract the relay feeds. The prices are Hyperliquid's real oracle and mark (recon C.3: precompile = info API after scaling), but up to ~1–2 s behind; the real `0x807` gives the same block's HyperCore state |
| All five deploy scripts, the fee maths, the Arena, the verifier | A precompile read costs the mock's gas (more than the real ≤ 3.1k) |

### Run it

```bash
pnpm install
pnpm live                        # wait for "[live] READY", then Ctrl+C to stop
```

The READY banner prints:
- the Arena API (`http://127.0.0.1:8787`);
- the read-only RPC (`http://127.0.0.1:8546`);
- the admin token: random unless you set `ARENA_ADMIN_TOKEN`;
- the run folder `backend/data/arena/live/<run>/` (gitignored), which holds `31337.json` (a snapshot of the deployment), `relay.jsonl` and `trades.jsonl`.

Each run is a **fresh chain**.

Settings, all optional:

| Variable | Default | What it sets |
|---|---|---|
| `ARENA_PORT` | 8787 | Arena API port |
| `ARENA_ADMIN_TOKEN` | random, printed | token for the admin POSTs |
| `ARENA_CORS_ORIGINS` | `http://localhost:3000` | frontend origins allowed by the Arena and the read-only RPC |
| `LIVE_PUBLIC_RPC_PORT` | 8546 | read-only RPC port |
| `LIVE_HOST` | 127.0.0.1 | address the Arena and read-only RPC listen on; use 0.0.0.0 on a VM. Anvil always stays on 127.0.0.1 |
| `LIVE_RPC_PORT` | 8545 | anvil's private port |
| `HL_INFO_API_MAINNET` | `https://api.hyperliquid.xyz/info` | price source |
| `LIVE_PERP_INDEX`, `LIVE_COIN`, `LIVE_SZ_DECIMALS` | 1, ETH, 4 | which perp |
| `RELAY_MS`, `RELAY_STALE_MS` | 1000, 15000 | relay rhythm and stale limit |

The Arena knobs (`MAX_TRADE_*`, `SHOCK_*`, `MIN_NATIVE_BALANCE`, `POLL_MS`, `POST_RATE_LIMIT_PER_MIN`) work as usual.

**Stop with Ctrl+C.** On Windows, closing the terminal leaves anvil running. The next `pnpm live` then refuses to start, names the busy port, and tells you how to stop it.

**While live mode runs, don't run** `local:once`, `demo:local` or the e2e tests. They rewrite `contracts/deployments/31337.json`. The live run uses its own snapshot, but a plain `pnpm verify` would read the wrong file.

### Let the frontend and judges reach it

The frontend needs `NEXT_PUBLIC_ARENA_API`, `NEXT_PUBLIC_RPC` (the **read-only** RPC) and `NEXT_PUBLIC_CHAIN_ID=31337`. Put its origin in `ARENA_CORS_ORIGINS`. Then pick one:

- **Laptop plus tunnel:** `cloudflared tunnel --url http://localhost:8787` for the Arena, and a second tunnel to `http://localhost:8546` for the RPC.
- **Small VM:** `LIVE_HOST=0.0.0.0 pnpm live`. Open only 8787 and 8546 in the firewall.

### Prove it

- **`pnpm live:check`** (while the run is live; it takes the newest run unless given a folder):
  - check A: every `FeeComputed` equals the formula over its inputs;
  - check B: the PoolManager charged exactly that fee;
  - **source:** every oracle/mark pair the hook used is a pair the relay wrote from the API, in effect at that block, and every `READ_FAILED` happened while the relay had switched reads off.

  It exits with code 1 on any mismatch.
- **One transaction:** `CHAIN_ID=31337 DEPLOYMENTS_DIR=<run folder> pnpm verify <tx>`.
- **The recording:** `pnpm live:record` runs the scripted demo once on live prices, writes `frontend/public/arena-fallback.json` (badge "Recorded run", with the price source written out), and exits.

### Measured on 2026-11-06

- **First live run:**
  - `0x807`/`0x806` tracked the API within one relay tick in 4 samples (e.g. chain 223,930 = API 2239.3);
  - the read-only RPC refused `anvil_setStorageAt` and `eth_sendRawTransaction`;
  - `pnpm demo`: shock 157 bp, **Aven arb fee 8,450 vs 3,000 pips, LPs kept $55.16 more**, verify MATCH;
  - `pnpm live:check`: A 4/4, B 4/4, source 4/4, PASS. A copy of `relay.jsonl` with one price altered → FAIL, naming both affected transactions.
- **Recording** (`pnpm live:record`): shock 157 bp, Aven arb fee 8,450 vs 3,000, LPs kept $55.14 more, verify MATCH.

**Badge for live mode: "Live prices · local chain".** Never "Live testnet".

## B. HyperEVM testnet (chain 998): blocked, no testnet HYPE

Exact commands to deploy Aven on HyperEVM testnet (chain 998), in order (ARCHITECTURE §11.3). Every step was proven end to end on a local chain (`pnpm --filter @aven/scripts local:once`: the same five scripts with mock precompiles). **Only Sayan runs this**, because it needs funded keys. As of 2026-11-06 the faucets gave no testnet HYPE, so live mode (§A) is the demo path.

Live asset: **testnet ETH, perp index 4, szDecimals 4** (MEMORY.md). The tokens are `aETH` (18 dec) and `aUSD` (6 dec).

### B.0 Prerequisites

1. `contracts/.env` (copied from `contracts/.env.example`; never commit it):
   ```
   DEPLOYER_PK=0x...        # deployer key
   BOT_ADDRESS=0x...        # Arena bot wallet (its key goes in backend/.env as BOT_PK)
   SHOCK_ADDRESS=0x...      # shock wallet     (its key goes in backend/.env as SHOCK_PK)
   HYPEREVM_RPC=https://rpc.hyperliquid-testnet.xyz/evm
   ```
2. **The deployer needs testnet HYPE on HyperEVM for gas.** UNVERIFIED in recon: the standard route is a HyperCore → HyperEVM transfer of HYPE. See https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/hypercore-less-than-greater-than-hyperevm-transfers. Check with `cast balance <deployer> --rpc-url $HYPEREVM_RPC`. The bot and shock wallets need a little HYPE too (they send swaps).
3. **The deployer must be a HyperCore user** (recon B.6), i.e. hold a Core asset:
   - the faucet https://app.hyperliquid-testnet.xyz/drip gives 1,000 mock USDC, but **only to an address that has deposited on mainnet**;
   - otherwise, from any wallet with testnet USDC on Core, `usdSend` some to the deployer (Python SDK `Exchange(...).usd_transfer(amount, "<deployer>")`).

   Check (returns `1` when it's a Core user, via precompile 0x810):
   ```
   cast call 0x0000000000000000000000000000000000000810 $(cast abi-encode "f(address)" <deployer>) --rpc-url $HYPEREVM_RPC
   ```
4. Python SDK for the big-block switch: `pip install hyperliquid-python-sdk`.
5. Foundry (`~/.foundry/bin`), pnpm, and `pnpm install` at the repo root.

### B.1 Big blocks ON (the PoolManager is ~24 KB and doesn't fit a 3M-gas small block)

```bash
cd contracts && set -a && . ./.env && set +a
python - <<'EOF'
import os
from eth_account import Account
from hyperliquid.exchange import Exchange
from hyperliquid.utils import constants
w = Account.from_key(os.environ["DEPLOYER_PK"])
print(Exchange(w, constants.TESTNET_API_URL).use_big_blocks(True))
EOF
```

This signs `{"type":"evmUserModify","usingBigBlocks":true}` as an L1 action and posts it to `https://api.hyperliquid-testnet.xyz/exchange` (SDK `exchange.py:1127`). Check it took effect:

```bash
curl -s -X POST -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_usingBigBlocks\",\"params\":[\"$(cast wallet address $DEPLOYER_PK)\"]}" $HYPEREVM_RPC
# -> "result":true
```

### B.2 Build the canonical PoolManager artifact, then deploy core

```bash
FOUNDRY_PROFILE=v4core forge build lib/v4-core/src/PoolManager.sol      # byte-identical to Uniswap's HyperEVM mainnet build
forge script script/DeployCore.s.sol:DeployCore --rpc-url $HYPEREVM_RPC --broadcast --slow
```

Expect a big block (up to ~1 min). The receipt's block `gasLimit` should be 30,000,000.

### B.3 Big blocks OFF

Run the same Python with `use_big_blocks(False)`. Check `eth_usingBigBlocks` → `false`. Everything else fits small 1 s blocks.

### B.4 Tokens, hook, pools, smoke

```bash
forge script script/DeployTokens.s.sol:DeployTokens --rpc-url $HYPEREVM_RPC --broadcast --slow
forge script script/DeployAven.s.sol:DeployAven     --rpc-url $HYPEREVM_RPC --broadcast --slow   # checks perpAssetInfo(4).coin == "ETH", mines the 0x2080 salt
forge script script/CreatePools.s.sol:CreatePools   --rpc-url $HYPEREVM_RPC --broadcast --slow   # pools at the live oracle price; writes deployments/998.json
forge script script/Smoke.s.sol:Smoke               --rpc-url $HYPEREVM_RPC --broadcast --slow
```

### B.5 Verify and record

```bash
cd .. && pnpm verify <aven smoke tx hash>     # must print MATCH on checks A and B (verify CLI: PLAN 6.1)
```

Smoke tx hashes are in `contracts/broadcast/Smoke.s.sol/998/run-latest.json`.

Then:
- commit `contracts/deployments/998.json`;
- fill in the table below;
- update docs/MEMORY.md.

### Deployed (chain 998)

There is no HyperEVM testnet explorer (MEMORY.md 2026-11-06). Tx links point to the frontend's `/tx/<hash>` page once it's deployed.

| What | Address / tx |
|---|---|
| PoolManager | _pending_ |
| PoolSwapTest / PoolModifyLiquidityTest | _pending_ |
| aETH / aUSD | _pending_ |
| AvenHook | _pending_ |
| Aven pool id / control pool id | _pending_ |
| Smoke swaps (verify MATCH) | _pending_ |

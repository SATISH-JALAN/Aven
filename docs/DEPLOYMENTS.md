# DEPLOYMENTS.md — mainnet (999) and testnet (998) runbooks

- **§M HyperEVM mainnet (999)** is the deploy path (Sayan, 2026-11-06). It was rehearsed on a fork of mainnet and audited (SECURITY.md §6), and is **not deployed yet**.
- **§T HyperEVM testnet (998)** is kept for reference. Nobody could get testnet HYPE.

**Only Sayan runs a deploy:** it needs the funded keys.

## M. HyperEVM mainnet (999)

### M.1 What's different from testnet

Facts are from recon §E, checked 2026-11-06.

| | Mainnet (999) |
|---|---|
| PoolManager | **Uniswap's canonical `0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F`**, reused, not deployed. `DeployCore` defaults `POOL_MANAGER` to it on chain 999. It's identical to our build; owner = Uniswap governance; protocol fee controller = none |
| Big blocks / HyperCore-user step | **Not needed.** The largest tx is the hook at 2.1M gas, under the 3M small block |
| Perp | **ETH, index 1, `szDecimals` 4**: `PERP_INDEX=1`, `EXPECT_COIN=ETH` |
| Routers | our `PoolSwapTest` + `PoolModifyLiquidityTest` (1.35M + 1.28M gas) |
| Tokens | `aETH`/`aUSD` demo tokens: worthless, open mint (SECURITY.md §6.2 C-5) |
| Block speed | 1 s small blocks (3M gas, p50 37% full); base fee 0.127–0.133 gwei |
| **RPC** | **A dedicated HyperEVM RPC endpoint is required.** The public `rpc.hyperliquid.xyz/evm` allows 100 requests/min per IP, and the Arena makes 118/min idle and ~1,900/min active (SECURITY.md §6.4). Use the public endpoint only for one-off reads |
| Scripts | precompile reads go through `vm.rpc` on a live chain (`AvenScript._precompileCall`). A direct read gets no data in forge's simulation and would have broken `DeployAven` (audit fix) |

### M.2 HYPE budget

Gas was measured on a mainnet fork against Uniswap's real PoolManager (recon §E.5). Swaps are priced at the worst observed case (the first swap on a fresh pool). HYPE = gas × gas price × 1.3 (30% margin), and HYPE = $78.46 (2026-11-06).

| Wallet | What it pays for | Gas | HYPE at 0.133 gwei (+30%) | HYPE at a 10× spike (+30%) |
|---|---|---|---|---|
| **DEPLOYER** | 2 routers, 2 tokens, 6 mints + 4 approvals, hook, 2 pool inits, 2 liquidity positions, 4 smoke swaps | 8,115,614 | 0.00140 | 0.0140 |
| **BOT** | 2 approvals + **200 bot swaps** (100 Aven at 200,067 + 100 control at 136,928) | 33,792,474 | 0.00584 | 0.0584 |
| **SHOCK** | 2 approvals + **10 shocks** (each 1 Aven + 1 control swap) | 3,462,924 | 0.00060 | 0.0060 |
| **Total gas** | | **45,371,012** | **0.00784 ≈ $0.62** | **0.0785 ≈ $6.15** |
| Bot auto-pause floor (`MIN_NATIVE_BALANCE`, stays in the wallet) | | | 0.01 ≈ $0.78 | 0.01 |

**Recommended funding:**

| Wallet | Amount |
|---|---|
| DEPLOYER | **0.02 HYPE** |
| BOT | **0.08 HYPE** |
| SHOCK | **0.01 HYPE** |
| **Total** | **0.11 HYPE ≈ $8.60** |

That covers the whole plan **even at 10× today's gas price**. At today's price, 0.08 HYPE pays for about 2,000 bot swaps.

**Buy about $10–15 of HYPE (≈ 0.13–0.19 HYPE).** That's dollars, not 5–10 HYPE: 5–10 HYPE would be $390–785, about 50× more than needed. Guides cite a ~$10 minimum order on Hyperliquid (UNVERIFIED).

For reference, deploying our own PoolManager instead would add 5,266,090 gas at the 0.1 gwei big-block price, about 0.0007 HYPE. Not needed.

### M.3 Getting HYPE onto HyperEVM

UNVERIFIED steps are marked; check them in the Hyperliquid app.

1. Deposit USDC to Hyperliquid **from the deployer address** (Arbitrum bridge). Guides cite a 5 USDC minimum (UNVERIFIED).
2. Buy HYPE on the HYPE/USDC spot market (~$10–15).
3. Move HYPE from HyperCore spot to HyperEVM by sending it to **`0x2222222222222222222222222222222222222222`**. It arrives at the same address on HyperEVM. **Only HYPE goes to 0x2222**; other tokens sent there can be lost. Hyperliquid's docs say this direction costs a small HYPE gas fee on HyperCore.
4. On HyperEVM, send 0.08 HYPE to BOT and 0.01 HYPE to SHOCK (21,000 gas each).
5. Check each wallet with `cast balance <address> --ether --rpc-url <RPC>`.

### M.4 Runbook

```bash
cd contracts
# contracts/.env (never commit): DEPLOYER_PK, BOT_ADDRESS, SHOCK_ADDRESS, HYPEREVM_RPC=<dedicated mainnet RPC>
set -a && . ./.env && set +a
export PERP_INDEX=1 EXPECT_COIN=ETH
cast chain-id --rpc-url $HYPEREVM_RPC                                     # must print 999
cast call 0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F "protocolFeeController()(address)" --rpc-url $HYPEREVM_RPC   # expect 0x0
forge build
forge script script/DeployCore.s.sol:DeployCore     --rpc-url $HYPEREVM_RPC --broadcast --slow   # logs "PoolManager reused"
forge script script/DeployTokens.s.sol:DeployTokens --rpc-url $HYPEREVM_RPC --broadcast --slow
forge script script/DeployAven.s.sol:DeployAven     --rpc-url $HYPEREVM_RPC --broadcast --slow   # perpAssetInfo(1) must be ETH
forge script script/CreatePools.s.sol:CreatePools   --rpc-url $HYPEREVM_RPC --broadcast --slow   # pools at the live oracle
forge script script/Smoke.s.sol:Smoke               --rpc-url $HYPEREVM_RPC --broadcast --slow --gas-estimate-multiplier 200
cd .. && CHAIN_ID=999 HYPEREVM_RPC=<RPC> pnpm verify <each Aven smoke tx>   # MATCH on A and B
```

- **Dry-run first:** each command without `--broadcast` simulates against live mainnet and spends nothing. `DeployCore` and `DeployTokens` simulate standalone. The later scripts need the earlier ones' addresses, so they can only be simulated after those are broadcast.
- **Why `--gas-estimate-multiplier 200` on Smoke:** forge's simulation can't run the precompiles, so inside it the hook takes its cheaper fallback path. The real swap reads real prices and costs a little more. The extra gas limit is reserved, not spent.
- **Arena on mainnet:** set these in `backend/.env`:
  - `CHAIN_ID=999`;
  - `HYPEREVM_RPC=<dedicated RPC>`;
  - `BOT_PK`/`SHOCK_PK` (fresh hot wallets);
  - `NATIVE_USD=<HYPE price>` (the config refuses 0 on 999);
  - `ARENA_ADMIN_TOKEN=$(openssl rand -hex 24)` (≥ 24 characters on 999);
  - `ARENA_TRUST_PROXY=1` only behind cloudflared;
  - `MAX_TRADE_BASE=100`, `MAX_TRADE_QUOTE=250000`, `MIN_NATIVE_BALANCE=0.01`.

  Then run `pnpm --filter @aven/arena start`.
- **After the deploy:**
  - commit `contracts/deployments/999.json`;
  - fill in the table below;
  - update MEMORY.md;
  - remove `DEPLOYER_PK` from `contracts/.env`.

### M.5 Deployed (chain 999)

| What | Address / tx |
|---|---|
| PoolManager | `0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F` (Uniswap, reused) |
| PoolSwapTest / PoolModifyLiquidityTest | _pending_ |
| aETH / aUSD | _pending_ |
| AvenHook | _pending_ |
| Aven pool id / control pool id | _pending_ |
| Smoke swaps (verify MATCH) | _pending_ |

## T. HyperEVM testnet (998): kept for reference

Exact commands to deploy Aven on HyperEVM testnet (chain 998), in order (ARCHITECTURE §11.3). Every step has already been proven end to end on a local chain (`pnpm --filter @aven/scripts local:once`: same five scripts, mock precompiles). **Only Sayan runs this**: it needs the funded keys. Blocked as of 2026-11-06: no testnet HYPE could be obtained.

Live asset: **testnet ETH, perp index 4, szDecimals 4** (MEMORY.md). The tokens are `aETH` (18 dec) and `aUSD` (6 dec).

### T.0 Prerequisites

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

### T.1 Big blocks ON (the PoolManager is ~24 KB and doesn't fit a 3M-gas small block)

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

### T.2 Build the canonical PoolManager artifact, then deploy core

```bash
FOUNDRY_PROFILE=v4core forge build lib/v4-core/src/PoolManager.sol      # byte-identical to Uniswap's HyperEVM mainnet build
forge script script/DeployCore.s.sol:DeployCore --rpc-url $HYPEREVM_RPC --broadcast --slow
```

Expect a big block (up to ~1 min). The receipt's block `gasLimit` should be 30,000,000.

### T.3 Big blocks OFF

Run the same Python with `use_big_blocks(False)`. Check `eth_usingBigBlocks` → `false`. Everything else fits small 1 s blocks.

### T.4 Tokens, hook, pools, smoke

```bash
forge script script/DeployTokens.s.sol:DeployTokens --rpc-url $HYPEREVM_RPC --broadcast --slow
forge script script/DeployAven.s.sol:DeployAven     --rpc-url $HYPEREVM_RPC --broadcast --slow   # checks perpAssetInfo(4).coin == "ETH", mines the 0x2080 salt
forge script script/CreatePools.s.sol:CreatePools   --rpc-url $HYPEREVM_RPC --broadcast --slow   # pools at the live oracle price; writes deployments/998.json
forge script script/Smoke.s.sol:Smoke               --rpc-url $HYPEREVM_RPC --broadcast --slow
```

### T.5 Verify and record

```bash
cd .. && pnpm verify <aven smoke tx hash>     # must print MATCH on checks A and B (verify CLI: PLAN 6.1)
```

Smoke tx hashes are in `contracts/broadcast/Smoke.s.sol/998/run-latest.json`.

Then:
- commit `contracts/deployments/998.json`;
- fill in the table below;
- update docs/MEMORY.md.

### T.6 Deployed (chain 998)

There is no HyperEVM testnet explorer (MEMORY.md 2026-11-06). Tx links point to the frontend's `/tx/<hash>` page once it's deployed.

| What | Address / tx |
|---|---|
| PoolManager | _pending_ |
| PoolSwapTest / PoolModifyLiquidityTest | _pending_ |
| aETH / aUSD | _pending_ |
| AvenHook | _pending_ |
| Aven pool id / control pool id | _pending_ |
| Smoke swaps (verify MATCH) | _pending_ |

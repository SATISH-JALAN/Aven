# DEPLOYMENTS.md — mainnet (999) and testnet (998) runbooks

- **§M HyperEVM mainnet (999)** is the deploy path (Sayan, 2026-11-06). It was rehearsed on a fork of mainnet and audited (SECURITY.md §6), and was **deployed on 2026-11-06** (§M.5).
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
| Block speed and gas | 1 s small blocks (3M gas). **The base fee is volatile:** over 3 h on 2026-11-06 it ranged 0.10–10.8 gwei (p50 0.37, p75 1.1, p90 3.5), with blocks 98–99% full at peaks. Every tx is therefore capped at **2 gwei** (forge `--with-gas-price`; Arena `MAX_GAS_PRICE_GWEI`) |
| **RPC** | **A dedicated HyperEVM RPC endpoint is required.** The public `rpc.hyperliquid.xyz/evm` allows 100 requests/min per IP, and the Arena makes 118/min idle and ~1,900/min active (SECURITY.md §6.4). Use the public endpoint only for one-off reads |
| Scripts | precompile reads go through `vm.rpc` on a live chain (`AvenScript._precompileCall`). A direct read gets no data in forge's simulation and would have broken `DeployAven` (audit fix) |

### M.2 HYPE budget

Gas comes from the mainnet fork against Uniswap's real PoolManager (recon §E.5). Swaps are priced at the worst observed case (the first swap on a fresh pool). The gas price comes from 79 small-block samples over 3 h (recon §E.1). **Every tx is capped at 2 gwei**, so the right-hand column is the most this plan can ever cost. HYPE = $77.86 (2026-11-06 16:00 UTC).

| Wallet | What it pays for | Gas | Calm (0.12 gwei) | Median (0.37) | Busy (1.1) | **Cap (2 gwei) = max** |
|---|---|---|---|---|---|---|
| **DEPLOYER** | 2 routers, 2 tokens, 6 mints + 4 approvals, hook, 2 pool inits, 2 liquidity positions, 4 smoke swaps | 8,115,614 | 0.0010 | 0.0030 | 0.0091 | **0.0162** |
| **BOT** | 2 approvals + **200 bot swaps** (100 Aven + 100 control) | 33,792,474 | 0.0041 | 0.0123 | 0.0377 | **0.0676** |
| **SHOCK** | 2 approvals + **10 shocks** (each 1 Aven + 1 control swap) | 3,462,924 | 0.0004 | 0.0013 | 0.0039 | **0.0069** |
| **Total** | | **45,371,012** | **0.0055 ($0.43)** | **0.0166 ($1.29)** | **0.0506 ($3.94)** | **0.0907 ($7.07)** |

Other costs:
- **Moving HYPE from Core to HyperEVM:** 200k gas at the next block's base fee, paid in HYPE on Core (official docs). That's ≤ 0.0004 HYPE at 2 gwei.
- **Upfront balance:** a tx needs gas limit × max fee available when it's sent. The largest is the hook deploy, 2.75M × 2 gwei = 0.0055 HYPE.
- **The bot's auto-pause floor** (`MIN_NATIVE_BALANCE` 0.01 HYPE) stays in its wallet.

**Fund the wallets with:**

| Wallet | Amount |
|---|---|
| DEPLOYER | **0.03 HYPE** |
| BOT | **0.10 HYPE** |
| SHOCK | **0.02 HYPE** |
| **Total** | **0.15 HYPE ≈ $11.70** |

That covers the whole plan at the 2-gwei cap, plus the bot's floor and a re-run of the smoke step.

**One account (Sayan's setup, 2026-11-06).** Deployer, bot and shock can be the same account; it needs the sum: **~0.10 HYPE** for the full plan at the cap, ~0.027 at median gas.
- It holds **0.0176 HYPE** on HyperEVM (MetaMask screenshot). That's already enough for the **whole deploy** even at the 2-gwei cap (max 0.0162).
- After the deploy, the bot auto-pauses at 0.01 HYPE. What's left runs roughly 60 bot swaps at median gas, or 20 at 1 gwei.
- For the full 200-swap / 10-shock test, top up about **0.08 HYPE (~$6–7)**.

**Buy about $20 of HYPE (≈ 0.26 HYPE)**, which is above Hyperliquid's spot minimum order (next section), and keep the rest as buffer. That's **dollars, not 5–10 HYPE** (5–10 HYPE would be $390–780).

### M.3 From USDC in MetaMask to HYPE on HyperEVM (official route)

Each fact below is quoted from Hyperliquid's official docs (recon §E.6).

1. **Prepare MetaMask.**
   - Have the USDC **on Arbitrum**, plus a little **ETH on Arbitrum** for the deposit's gas ("USDC and ETH (gas to deposit) on Arbitrum").
   - USDC on another chain: the app's deposit address also accepts USDC from Ethereum, Base or Polygon, or bridge to Arbitrum first.
2. **Deposit at least 5 USDC.** Open https://app.hyperliquid.xyz/trade, connect MetaMask, click **Deposit** and enter **≥ $20–25** of USDC. Official: *"The minimum deposit amount is 5 USDC. If you send an amount less than this, it will not be credited and be lost forever."* Deposits are credited in under a minute.
3. **Buy HYPE on spot (HYPE/USDC).**
   - Minimum order is **10 of the quote token**, so 10 USDC (official `MinTradeSpotNtl`). Buy ~$20.
   - Base-tier taker fee: **0.070%**, about $0.014 on $20.
4. **Move HYPE to HyperEVM.** In **Balances**, click **"Transfer to/from EVM"** (or **"EVM <-> Core Transfer"** on Portfolio).
   - HYPE arrives as the **native gas token** on HyperEVM, at the account that sent it.
   - It costs 200k gas in HYPE on Core.
   - **Only HYPE** may go to the system address `0x2222…2222`; other tokens sent there are lost.
5. **Add HyperEVM to MetaMask:**
   - chain ID **999**;
   - RPC `https://rpc.hyperliquid.xyz/evm`;
   - symbol **HYPE**;
   - explorer `https://hyperevmscan.io/`.

   Known MetaMask issue on HyperEVM (official FAQ): "Invalid transaction envelope type … 0x2". The docs suggest another wallet such as **Rabby** if it happens.
6. **Choose the accounts.**
   - **One account works (tested on a local chain, 2026-11-06):** one key as bot and shock at the same time sent 35 txs with 0 reverted, contiguous nonces, 12 shock swaps + 21 bot arbs, and 21/21 fees verified on A and B.
     - Set `DEPLOYER_PK` = `BOT_PK` = `SHOCK_PK` = that key.
     - Set `BOT_ADDRESS` = `SHOCK_ADDRESS` = its address.
     - **Risk:** that key then sits in plain text in `contracts/.env` and `backend/.env`, so anything else in that account (e.g. USDC) is exposed if those files leak. Keep only what the demo needs in it.
   - Three accounts (deployer / bot / shock, 0.03 / 0.10 / 0.02 HYPE) isolate the risk further. It's optional.
   - Never put a key that holds savings into `.env`.
7. **Swapping inside MetaMask is fine *if* the result is native HYPE on HyperEVM.**
   - The Hyperliquid app (steps 2–4) is the officially documented route, not the only one.
   - With MetaMask **Swap**, before confirming check that the **destination network is HyperEVM** and the token is **HYPE** with the verified badge. Afterwards it should show under *Network: HyperEVM* like the existing 0.0176 HYPE.
   - Wrong results: a token named HYPE on Arbitrum/Base/Ethereum, or **WHYPE** (wrapped). Those aren't gas on chain 999; WHYPE would first need unwrapping.
   - The quote shows MetaMask's own fee; on a ~$7 swap it's cents.
8. **Check:** `cast balance <address> --ether --rpc-url https://rpc.hyperliquid.xyz/evm` for each wallet.

### M.4 Runbook

```bash
cd contracts
# contracts/.env (never commit): DEPLOYER_PK, BOT_ADDRESS, SHOCK_ADDRESS, HYPEREVM_RPC=<dedicated mainnet RPC>
set -a && . ./.env && set +a
export PERP_INDEX=1 EXPECT_COIN=ETH
cast chain-id --rpc-url $HYPEREVM_RPC                                     # must print 999
cast call 0x0000000000000000000000000000000000000807 0x0000000000000000000000000000000000000000000000000000000000000001 --rpc-url $HYPEREVM_RPC  # must be > 0: your RPC serves the oracle precompile
export FEES="--with-gas-price 2gwei --priority-gas-price 0"             # cap: no tx pays more than 2 gwei/gas
cast gas-price --rpc-url $HYPEREVM_RPC                                    # wait until it's below 2000000000 (2 gwei) before each script
cast call 0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F "protocolFeeController()(address)" --rpc-url $HYPEREVM_RPC   # expect 0x0
forge build
forge script script/DeployCore.s.sol:DeployCore     --rpc-url $HYPEREVM_RPC --broadcast --slow $FEES   # logs "PoolManager reused"
forge script script/DeployTokens.s.sol:DeployTokens --rpc-url $HYPEREVM_RPC --broadcast --slow $FEES
forge script script/DeployAven.s.sol:DeployAven     --rpc-url $HYPEREVM_RPC --broadcast --slow $FEES   # perpAssetInfo(1) must be ETH
forge script script/CreatePools.s.sol:CreatePools   --rpc-url $HYPEREVM_RPC --broadcast --slow $FEES   # pools at the live oracle
forge script script/Smoke.s.sol:Smoke               --rpc-url $HYPEREVM_RPC --broadcast --slow $FEES --gas-estimate-multiplier 200
cd .. && CHAIN_ID=999 HYPEREVM_RPC=<RPC> pnpm verify <each Aven smoke tx>   # MATCH on A and B
```

- **Dry-run first:** each command without `--broadcast` simulates against live mainnet and spends nothing. `DeployCore` and `DeployTokens` simulate standalone. The later scripts need the earlier ones' addresses, so they can only be simulated after those are broadcast.
- **Why `$FEES`:** forge sets `maxFeePerGas` = 2 gwei and a 0 tip, so no deploy tx ever pays more than gasUsed × 2 gwei. If the base fee is above the cap, the tx waits in the mempool rather than overpaying. Run each script when `cast gas-price` shows < 2 gwei.
- **Why `--gas-estimate-multiplier 200` on Smoke:** forge's simulation can't run the precompiles, so inside it the hook takes its cheaper fallback path. The real swap reads real prices and costs a little more. The extra gas limit is reserved, not spent.
- **Arena on mainnet:** set these in `backend/.env`:
  - `CHAIN_ID=999`;
  - `HYPEREVM_RPC=<dedicated RPC>`;
  - `BOT_PK`/`SHOCK_PK` (separate hot wallets, or the **same key** for a one-account setup, as tested in §M.3);
  - `NATIVE_USD=<HYPE price>` (the config refuses 0 on 999);
  - `ARENA_ADMIN_TOKEN=$(openssl rand -hex 24)` (≥ 24 characters on 999);
  - `ARENA_TRUST_PROXY=1` only behind cloudflared;
  - `MAX_GAS_PRICE_GWEI=2` (required on 999: above it the bot waits and shocks are refused; every tx carries maxFeePerGas = the cap);
  - `MAX_TRADE_BASE=100`, `MAX_TRADE_QUOTE=250000`, `MIN_NATIVE_BALANCE=0.01`.

  Then run `pnpm --filter @aven/arena start`.
- **After the deploy:**
  - commit `contracts/deployments/999.json`;
  - fill in the table below;
  - update MEMORY.md;
  - remove `DEPLOYER_PK` from `contracts/.env`.

### M.5 Deployed (chain 999) — 2026-11-06, block 50,557,638

**23 transactions, all succeeded; total cost 0.001044 HYPE (~$0.08)** at 0.10–0.18 gwei. Deployer = bot = shock = `0x4412A5313aFd9b6f447EcE820Ce55a30A20034Ee` (one account). Record: `contracts/deployments/999.json`.

| What | Address / tx |
|---|---|
| PoolManager (Uniswap, **reused**) | [`0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F`](https://hyperevmscan.io/address/0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F) |
| PoolSwapTest | [`0xFe6baCe2E548fD06735A4242BBD46A3c842E02B1`](https://hyperevmscan.io/address/0xFe6baCe2E548fD06735A4242BBD46A3c842E02B1) (tx [`0x54a2dac3…`](https://hyperevmscan.io/tx/0x54a2dac3276f554d8e71880a507fc67d86c1fc24cddf647e74920cfbe6735329)) |
| PoolModifyLiquidityTest | [`0x4da494CB3f82c3d01c2D720BB23B38E505141A5b`](https://hyperevmscan.io/address/0x4da494CB3f82c3d01c2D720BB23B38E505141A5b) (tx [`0x247e62d3…`](https://hyperevmscan.io/tx/0x247e62d306f3a8f4dcada47a9bd6cdedc9a6c03ae008e3b9a08fc352eef030d7)) |
| aETH (18 dec) / aUSD (6 dec) | [`0xD4a26168e47acc1b514aF23Fb5a360d171745756`](https://hyperevmscan.io/address/0xD4a26168e47acc1b514aF23Fb5a360d171745756) / [`0xFC91A98c4bDbF5b20a2Da89e514C66295051efd6`](https://hyperevmscan.io/address/0xFC91A98c4bDbF5b20a2Da89e514C66295051efd6) |
| **AvenHook** | [`0xfdd13cA6D7FcF4Ca710Bc8C77546592F42CF6080`](https://hyperevmscan.io/address/0xfdd13cA6D7FcF4Ca710Bc8C77546592F42CF6080) (salt `0x7b9d`, tx [`0x9f676a77…`](https://hyperevmscan.io/tx/0x9f676a77fc3ff4e49da4f1d6f99b4449d8ecbf83c16bf82365a0a045f62ed8fe)) |
| Aven pool id (dynamic fee, hook) | `0x659c1cbd66a079592fd333ec44f76b4878aabfe5d9c17b7a14faaabbe7e0d1df` (init tx [`0xbc5a67aa…`](https://hyperevmscan.io/tx/0xbc5a67aab105bc658d5c492f3429b1c851a40ffe32240dab1c5e9b14b490d1fc)) |
| Control pool id (static 0.30%) | `0x4bf2e188c58f409792aae72afe12c7d025ce093d4ca92d8a100a810d8b1681b6` (init tx [`0x2bbe4045…`](https://hyperevmscan.io/tx/0x2bbe4045f4d3430defe470968e2c37bf2c6c4d056d329997313178646891edd6)) |
| **Smoke swaps on Aven (verify MATCH A + B)** | [`0x7b28ee95…`](https://hyperevmscan.io/tx/0x7b28ee95600b0f2967542ec98b43f52435edab12a9ee6acf43e6c1306f337eed): fee 700 pips · [`0x2dd33f42…`](https://hyperevmscan.io/tx/0x2dd33f423c553cf4abd89af9ea725690039fb1105e883071a6c931bcea57f3a9): fee 500 pips |
| Smoke swaps on control | [`0x32f4e1d0…`](https://hyperevmscan.io/tx/0x32f4e1d086ce2c88b4619071f9f8d0c2bec8f785f2f36b9bbc19b5cf204020e6) · [`0xbdafa2d6…`](https://hyperevmscan.io/tx/0xbdafa2d6701422bfc582475d262d4872cd5b1ef12e743c9fffb4cb64d8409ff8) |

Checks after the deploy, all on mainnet:

- **Routers:** both point at Uniswap's PoolManager (`manager()`).
- **Tokens:** symbols and decimals are correct, 1,400 aETH / 7,000,000 aUSD were minted to the account, and both routers have max allowance.
- **Hook:**
  - live code is byte-identical to the audited build (9,337 B, 35 immutables masked);
  - address bits are `0x2080`;
  - `config()` = (perp 1, szDecimals 4, baseIsToken0, 18, 6); `params()` = the §6.2 defaults; `poolManager()` = Uniswap's.
- **Pools:**
  - both at sqrtPrice 3742639779956839250570048 (tick −199216): $2,231.50 vs the oracle's $2,231.53 (−0.13 bp);
  - Aven LP fee 0 (dynamic), control 3000, protocol fee 0;
  - hook `poolState(aven).initialized` = true.
- **Smoke:**
  - the Aven swaps read the **real** HyperCore oracle/mark in-block (oracle 223100 / mark 223052, reason OK, gap 2 bp, premium −2 bp);
  - `pnpm verify` gives MATCH on A and B (on-chain = recomputed = Swap event);
  - Aven swap gas 190,521 / 174,097 (the real precompile is cheaper than the mock).
- **Gas margin:** the hook deploy was sent with `--gas-estimate-multiplier 120` (limit 2.69M, used 2,111,487) so it fits small blocks.

The deploy key was removed from `contracts/.env` afterwards.

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

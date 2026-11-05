# DEPLOYMENTS.md — HyperEVM testnet runbook

Exact commands to deploy Aven on HyperEVM testnet (chain 998), in order (ARCHITECTURE §11.3). Every step has already been proven end to end on a local chain (`pnpm --filter @aven/scripts local:once`: same five scripts, mock precompiles). **Only Sayan runs this**: it needs the funded keys.

Live asset: **testnet ETH, perp index 4, szDecimals 4** (MEMORY.md). The tokens are `aETH` (18 dec) and `aUSD` (6 dec).

## 0. Prerequisites

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

## 1. Big blocks ON (the PoolManager is ~24 KB and doesn't fit a 3M-gas small block)

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

## 2. Build the canonical PoolManager artifact, then deploy core

```bash
FOUNDRY_PROFILE=v4core forge build lib/v4-core/src/PoolManager.sol      # byte-identical to Uniswap's HyperEVM mainnet build
forge script script/DeployCore.s.sol:DeployCore --rpc-url $HYPEREVM_RPC --broadcast --slow
```

Expect a big block (up to ~1 min). The receipt's block `gasLimit` should be 30,000,000.

## 3. Big blocks OFF

Run the same Python with `use_big_blocks(False)`. Check `eth_usingBigBlocks` → `false`. Everything else fits small 1 s blocks.

## 4. Tokens, hook, pools, smoke

```bash
forge script script/DeployTokens.s.sol:DeployTokens --rpc-url $HYPEREVM_RPC --broadcast --slow
forge script script/DeployAven.s.sol:DeployAven     --rpc-url $HYPEREVM_RPC --broadcast --slow   # checks perpAssetInfo(4).coin == "ETH", mines the 0x2080 salt
forge script script/CreatePools.s.sol:CreatePools   --rpc-url $HYPEREVM_RPC --broadcast --slow   # pools at the live oracle price; writes deployments/998.json
forge script script/Smoke.s.sol:Smoke               --rpc-url $HYPEREVM_RPC --broadcast --slow
```

## 5. Verify and record

```bash
cd .. && pnpm verify <aven smoke tx hash>     # must print MATCH on checks A and B (verify CLI: PLAN 6.1)
```

Smoke tx hashes are in `contracts/broadcast/Smoke.s.sol/998/run-latest.json`.

Then:
- commit `contracts/deployments/998.json`;
- fill in the table below;
- update docs/MEMORY.md.

## Deployed (chain 998)

There is no HyperEVM testnet explorer (MEMORY.md 2026-11-06). Tx links point to the frontend's `/tx/<hash>` page once it's deployed.

| What | Address / tx |
|---|---|
| PoolManager | _pending_ |
| PoolSwapTest / PoolModifyLiquidityTest | _pending_ |
| aETH / aUSD | _pending_ |
| AvenHook | _pending_ |
| Aven pool id / control pool id | _pending_ |
| Smoke swaps (verify MATCH) | _pending_ |

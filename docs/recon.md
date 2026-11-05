# Recon: external facts, verified

Every fact below has a source: a file path in installed deps (relative to `contracts/lib/`), a doc URL, or RPC/API output. Anything not verified is marked **UNVERIFIED** with a fallback.
Recon run: 2026-11-05, ~15:45–16:30 UTC. Foundry 1.8.4, solc 0.8.26.

## 1. Uniswap v4

### Versions installed

| Lib | Pin | Why |
|---|---|---|
| `v4-core` | commit `d153b048868a60c2403a3ef5b2301bb247884d46` (`v4.0.0-19`, npm 1.0.2 + CI-only commits) | **Not the `v4.0.0` tag.** `v4.0.0` is v4-core's only git tag, but it defines `SwapParams` inside `IPoolManager`, and OZ `BaseHook` v1.2.1 imports it from `src/types/PoolOperation.sol`, so the tag does not compile with it. `git diff v4.0.0 d153b048 -- src/` shows a pure refactor: the param structs moved to `types/PoolOperation.sol`, with the same fields and the same `PoolManager` logic. This is the exact commit OZ uniswap-hooks v1.2.1 pins. |
| `v4-periphery` | commit `7ebd04b161745b75ed0c24ba2df3bc7c25f65606` | v4-periphery has **no git tags** (`git ls-remote --tags` returns 0). `main` (`c6e4754`) **removed `BaseHook` and `HookMiner` from `src/utils`** in #510 ("remove hooks and move to hook repo"). `7ebd04b` is the commit OZ v1.2.1 pins and still has `src/utils/HookMiner.sol`. |
| `uniswap-hooks` (OpenZeppelin) | tag `v1.2.1` (`acbd604c`) | Latest non-RC tag (`v1.3.0-rc.0` exists, not stable). |
| `hyper-evm-lib` | tag `v1.1` (`b7bda146`) | Latest tag. |
| `forge-std` | tag `v1.17.0` | Latest tag. |

Pins are recorded in `contracts/foundry.lock` and the git submodule SHAs. Remappings are in `contracts/remappings.txt`.

### BaseHook: import path and override signatures

- **Use:** `import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";`. The remapping `@openzeppelin/uniswap-hooks/=lib/uniswap-hooks/src/` is from `uniswap-hooks/README.md:24`. The file is `uniswap-hooks/src/base/BaseHook.sol`.
- Constructor: `constructor(IPoolManager _poolManager)`. It calls `_validateHookAddress(this)`, so the address flags must already match `getHookPermissions()` at deploy (`BaseHook.sol:49-52`).
- `function getHookPermissions() public pure virtual returns (Hooks.Permissions memory permissions);` (`BaseHook.sol:69`)
- `function _beforeInitialize(address, PoolKey calldata, uint160) internal virtual returns (bytes4)` (`BaseHook.sol:93`)
- `function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata) internal virtual returns (bytes4, BeforeSwapDelta, uint24)` (`BaseHook.sol:237-240`)
- Not chosen: `uniswap-hooks/src/fee/BaseOverrideFee.sol`. It uses **`afterInitialize`** (not `beforeInitialize` as our spec requires) and wraps `_getFee`. We subclass `BaseHook` directly to control the fallback path and the `FeeComputed` event.

### SwapParams location

- `struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }` at file level in `v4-core/src/types/PoolOperation.sol:19`.
- Import: `import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";`
- (In the `v4.0.0` tag it was `IPoolManager.SwapParams`, `v4-core/src/interfaces/IPoolManager.sol:146`. Not used.)

### LPFeeLibrary flags

From `v4-core/src/libraries/LPFeeLibrary.sol:15-25`:

| Name | Value |
|---|---|
| `LPFeeLibrary.DYNAMIC_FEE_FLAG` | `0x800000` (pass as `PoolKey.fee` to create a dynamic-fee pool) |
| `LPFeeLibrary.OVERRIDE_FEE_FLAG` | `0x400000` (OR into the fee returned by `beforeSwap`) |
| `LPFeeLibrary.REMOVE_OVERRIDE_MASK` | `0xBFFFFF` |
| `LPFeeLibrary.MAX_LP_FEE` | `1000000` (fees are in hundredths of a bip: 500 = 0.05%, 3000 = 0.30%, 10000 = 1.00%) |

Hook flag bits (`v4-core/src/libraries/Hooks.sol:29,38`): `BEFORE_INITIALIZE_FLAG = 1 << 13`, `BEFORE_SWAP_FLAG = 1 << 7`.

### Test helpers (Deployers, PoolSwapTest, PoolModifyLiquidityTest, HookMiner)

| Helper | File | Import |
|---|---|---|
| `Deployers` | `v4-core/test/utils/Deployers.sol` | `@uniswap/v4-core/test/utils/Deployers.sol` |
| `PoolSwapTest` | `v4-core/src/test/PoolSwapTest.sol` | `@uniswap/v4-core/src/test/PoolSwapTest.sol` |
| `PoolModifyLiquidityTest` | `v4-core/src/test/PoolModifyLiquidityTest.sol` | `@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol` |
| `HookMiner` | `v4-periphery/src/utils/HookMiner.sol` | `@uniswap/v4-periphery/src/utils/HookMiner.sol` |

`HookMiner.find(address deployer, uint160 flags, bytes memory creationCode, bytes memory constructorArgs) internal view returns (address, bytes32)` (`HookMiner.sol:23`).
All imports above are compile-checked by `contracts/test/recon/V4Imports.t.sol` (passes).

## 2. HyperCore precompiles

### L1Read.sol source

- Official docs, "Interacting with HyperCore" (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore) **attach** `L1Read.sol` as an unlabeled file embed. There's no stable URL, so I didn't fetch it from there.
- The same file ships in `hyper-evm-lib/test/utils/L1Read.sol`. Constants are at lines 115–138; `MARK_PX_PRECOMPILE_ADDRESS` is at line 122 and `ORACLE_PX_PRECOMPILE_ADDRESS` at line 123.

### markPx

- Address: `0x0000000000000000000000000000000000000806` (`L1Read.sol:122`)
- Calldata: `abi.encode(uint32 perpIndex)`, 32 bytes, no selector (`hyper-evm-lib/src/PrecompileLib.sol:211-215`)
- Return: `abi.decode(result, (uint64))`, 32 bytes (`PrecompileLib.sol:214`). Confirmed on testnet: 32-byte return (§4).

### oraclePx

- Address: `0x0000000000000000000000000000000000000807` (`L1Read.sol:123`)
- Calldata: `abi.encode(uint32 perpIndex)`. Return: `uint64` (`PrecompileLib.sol:217-221`)
- The docs' own example calls `0x…0807` with `0x…0003` for "the third perp oracle price on testnet".

### Scaling rule

- **Perps: human price = raw / 10^(6 − szDecimals).** Quote from the docs: "divide the returned price by `10^(6 - szDecimals)` for perps" (Interacting with HyperCore page).
- Cross-checked: `PrecompileLib.normalizedMarkPx = markPx * 10**szDecimals` gives "a fixed-point integer with 6 decimals" (`PrecompileLib.sol:154-158`), which is the same rule.
- Confirmed live: matches the info API to 0.0 bps after scaling (§4).
- On-chain `szDecimals` is available from `perpAssetInfo` precompile `0x…080a` (`L1Read.sol:126`). For testnet index 135 it returns `("HYPE", marginTableId 10, szDecimals 2, maxLeverage 10, onlyIsolated true)` (`cast call`, see §4).

### Gas

- Docs: "Precompiles have a gas cost of `2000 + 65 * (input_len + output_len)`". Note: input **plus** output; the handoff said output only. Also: "Precompiles called on invalid inputs such as invalid assets or vault address will return an error and consume all gas passed into the precompile call frame."
- **Measured on testnet** (state-override probe contract, `eth_call` at latest, 2026-11-05):

  | Call | Cap | Result | Gas used by the `staticcall` frame |
  |---|---|---|---|
  | markPx(135) | 100,000 | ok, 32 bytes | 3,693 |
  | oraclePx(135) | 100,000 | ok, 32 bytes | 3,693 |
  | oraclePx(99999) (invalid) | 100,000 | fail, 0 bytes | 100,512 (whole cap burned) |
  | oraclePx(99999) (invalid) | 20,000 | fail, 0 bytes | 20,512 (whole cap burned) |
  | oraclePx(135) | 3,000 | fail (OOG) | 3,512 |

  So: the cap must be > ~3.2k, and every unit of the cap is lost on a bad index. **Use a 10,000-gas cap per read** (about 2.7× headroom). Worst case is 2 × 10k burned per swap.
- Locally (no fork) the precompile addresses have no code: `staticcall` returns `success = true` with **0 bytes**. Readers must check `ret.length == 32`, not just `success` (test `test_noPrecompileLocally`).

### hyper-evm-lib

- Installed: `contracts/lib/hyper-evm-lib` @ v1.1. Read helpers in `src/PrecompileLib.sol`: `markPx(uint32)`, `oraclePx(uint32)`, `spotPx(uint64)`, `normalizedMarkPx(uint32)`, `normalizedOraclePx(uint32)`, `perpAssetInfo(uint32)`, plus balance and position reads. Address constants are in `src/common/HLConstants.sol`.
- **Do not call these from the hook:** they `revert` on failure (`PrecompileLib__MarkPxPrecompileFailed`, etc.) and forward **all** gas (no cap). That breaks invariants 1 and 5. `HyperFairValue` implements its own gas-capped, non-reverting reads and may import only the address constants.

## 3. HyperEVM testnet

### Chain id, latest block, gas price

RPC `https://rpc.hyperliquid-testnet.xyz/evm`, 2026-11-05 ~15:45 UTC:
- `eth_chainId` → `0x3e6` = **998**
- `eth_blockNumber` → `0x41a27d5` = 68,822,997. Latest block: number 68,822,998, timestamp 1793893659, **gasLimit 3,000,000** (a small block), gasUsed 224,182
- `eth_gasPrice` → `0x5f5e100` = **0.1 gwei** (baseFeePerGas 100,000,000)

### Uniswap v4 PoolManager on testnet

- Uniswap's official deployments page (https://developers.uniswap.org/docs/protocols/v4/deployments) lists **HyperEVM: 999** (mainnet): PoolManager `0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F`, PositionManager `0x0d7Ab5B3db668128Aff6F70C4eBC71D7d4DA9bf9`, Quoter `0x108Bfe38532C98f8Cd8D7Ab49c9dDAa3675a1c5e`, StateView `0x1656326235cb9E34Cb58CaDe53AE30789AB32A1A`, Universal Router 2.1.2 `0xeD270A1Bcdc63cf1356D695e7f40961d4819d6bF`, Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`. Its testnet section lists only Unichain Sepolia, Sepolia, Base Sepolia, Arbitrum Sepolia and interop-alpha. **There is no HyperEVM testnet.**
- `cast codesize` on 998: `0x12D4…6B1F` → **0**; the Ethereum PoolManager `0x000000000004444c5dc75cb358380d2e3de08a90` → 0. On 999, `0x12D4…6B1F` → 24,009 bytes.
- Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` **is deployed on 998** (9,152 bytes).
- **Result: deploy our own PoolManager on 998.**

### CREATE2 deployer (0x4e59b44847b379578588920cA78FbF26c0B4956C)

- `eth_getCode` on 998 → `0x7fffff…6014600cf3` (the standard deterministic-deployment-proxy runtime). **Deployed.**

### Small vs big blocks

Source: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/dual-block-architecture
- Small: "Fast block duration is set to 1 seconds with a 3M gas limit." Big: "Slow block duration is set to 1 minute with a 30M gas limit." The observed testnet block had `gasLimit 3,000,000`, which is consistent.
- Switch: send the HyperCore action `{"type": "evmUserModify", "usingBigBlocks": true}`. It is set per HyperCore user; unset it to go back to small blocks.
- Requirement: "Like any action, this requires an existing Core user to send." An address becomes a Core user by receiving a Core asset (e.g. USDC on Core).
- JSON-RPC `bigBlockGasPrice` estimates the next big block's base fee.
- **UNVERIFIED:** the page doesn't explicitly say testnet behaves the same. Fallback: try it on testnet with the deployer, and check the receipt's block gasLimit is 30M.
- Implication: PoolManager runtime is ~24 KB (24,009 bytes on 999). At 200 gas/byte that's ≈ 4.8M gas of code deposit alone, above the 3M small-block limit, so **the PoolManager deploy needs big blocks**. The hook's size is unknown until it's built.

### Block explorer

- **UNVERIFIED.** Chainlink's HyperEVM testnet guide (https://docs.chain.link/ccip/tools-resources/network-specific/hyperevm-testnet-rpc) names `https://testnet.purrsec.com/`, but it returned **404** to `curl` on 2026-11-05 (root and `/block/<n>`). `testnet.hyperevmscan.io` didn't resolve. Routescan's API says "chain not supported" for 998. Hyperliquid's own HyperEVM docs list no explorer.
- `https://app.hyperliquid-testnet.xyz/explorer` (HyperCore explorer) returns 200. Whether it shows HyperEVM txs is unverified.
- Fallback: the web app links each tx to its own receipt view (read from the RPC). README tx links point to purrsec if it works in a browser, else to the receipt JSON. Re-check purrsec in a browser.

## 4. HYPE perp index and live prices

Method: `POST /info {"type":"meta"}` (index = position in `universe`), plus `{"type":"metaAndAssetCtxs"}` for prices. Precompiles were read with `eth_call` **at the same block** (`eth_blockNumber` taken right after the API call), using `data = abi.encode(uint32 index)`. Reproduce one read with `cast call --rpc-url $HYPEREVM_RPC 0x0000000000000000000000000000000000000806 $(cast abi-encode "f(uint32)" 135)`.

### Testnet

- `{"type":"meta"}` → HYPE at **index 135**, `szDecimals 2`, `maxLeverage 10`, `onlyIsolated true`, `marginMode strictIsolated`. Universe size 213.
- Block 68,823,620:

  | | Precompile raw | Scaled (÷10^4) | Info API | Diff |
  |---|---|---|---|---|
  | markPx(135) | 826,000 | 82.6000 | 82.6 | 0.0 bps |
  | oraclePx(135) | 71,575,500 | 7157.5500 | 7157.55 | 0.0 bps |

- **Gate passed:** precompile = info API after scaling.
- ⚠️ **Testnet HYPE market data is degenerate.** Oracle ≈ 7,157 vs mark ≈ 82.6, a premium of **−9,885 bps**. `midPx` is null (no book). Mainnet HYPE is ≈ 78. A later probe read oracle 6,807.10 and mark 81.20, so the oracle is drifting, not tracking the mark. A hook on testnet HYPE would see an absurd premium, and any pool seeded near either price would trip the sanity limit against the other.
- Other testnet perps at the same block are sane (precompile = API in every case):

  | Perp | Index | szDec | Mark | Oracle | Premium | midPx |
  |---|---|---|---|---|---|---|
  | SOL | 0 | 2 | 90.4183 | 90.0100 | +45 bps | 90.48 |
  | BTC | 3 | 5 | 76156.0 | 75947.1 | +28 bps | 76142.0 |
  | ETH | 4 | 4 | 2267.5 | 2250.8 | +74 bps | 2267.3 |

### Mainnet

- `{"type":"metaAndAssetCtxs"}` on `https://api.hyperliquid.xyz/info` → HYPE at **index 159**, `szDecimals 2`, `maxLeverage 10`. Universe size 235.
- Block 50,464,782 (RPC `https://rpc.hyperliquid.xyz/evm`): markPx raw 783,030 → **78.3030** (API 78.302, 0.1 bps); oraclePx raw 782,650 → **78.2650** (API 78.254, 1.4 bps; the oracle updates every 3s). Premium +5 bps.
- Also: BTC index 0 (szDec 5), ETH index 1 (szDec 4).

## 5. Mock plan (local tests)

- `contracts/test/recon/PrecompileMockPlan.t.sol` (no fork, passes):
  - `test_noPrecompileLocally`: `0x…0806` and `0x…0807` have no code locally, and `staticcall` returns `success` with 0 bytes.
  - `test_etchedMockReturnsScaledPrices`: `vm.etch` a mock at both addresses. Fed the recorded testnet raws (826,000 and 71,575,500), it decodes and scales to 82.60 and 7157.55.
  - `test_gasCapContainsBurnAll`: a mock that burns all gas, called with a 30k cap, fails and the caller keeps running.
- Plan: the production `MockHyperCore` (P2) is etched at `0x…0806` / `0x…0807` with `setPrices(oracle, mark)`. It takes `abi.encode(uint32)` and returns `abi.encode(uint64)`, the same ABI as the real precompiles.
- `forge test --match-path "test/recon/*"`: 7 passed, 0 failed.

## Decisions

1. **BaseHook:** OpenZeppelin `uniswap-hooks` v1.2.1, `@openzeppelin/uniswap-hooks/base/BaseHook.sol`. Override `getHookPermissions`, `_beforeInitialize` and `_beforeSwap`; don't use `BaseOverrideFee` (it's built on `afterInitialize`). Pin v4-core and v4-periphery to the commits OZ v1.2.1 pins (see §1) so there's one consistent v4 type set.
2. **PoolManager:** **deploy our own** on 998 (none exists). Build from the pinned v4-core `PoolManager` (same logic as v4.0.0). It needs **big blocks**, so the deployer must first become a HyperCore user (receive testnet USDC on Core), then send `evmUserModify {usingBigBlocks: true}`.
3. **Hook deployment:** use the existing **CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C`** on 998. Mine the salt with `HookMiner.find(0x4e59…956C, BEFORE_INITIALIZE_FLAG | BEFORE_SWAP_FLAG, creationCode, abi.encode(poolManager, …))`; `forge script` routes `new Hook{salt: s}(…)` through that deployer. No custom factory.
4. **HYPE perp index:** **testnet 135**, **mainnet 159** (both `szDecimals 2`). The replay uses mainnet 159.
5. **Precompile read gas cap:** 10,000 per read. Check `success && ret.length == 32 && raw != 0`; anything else uses the fallback fee.
6. **⚠️ Needs confirmation: Arena asset on testnet.** Testnet HYPE's oracle (≈7,157) is ~87× its mark (≈82.6), so the live hook would sit on fallback or max fees. Proposed: run the live Arena on **testnet ETH (index 4, szDec 4)**, or BTC (index 3, szDec 5), with mock tokens named accordingly. Keep HYPE for the mainnet-data replay. `perpIndex` and `szDecimals` are constructor immutables, so this only changes the deploy script. Alternative: keep HYPE and add a mark-vs-oracle sanity bound (e.g. |premium| > 2,000 bps → fallback). That is a FEE_SPEC change, so it needs sign-off either way.

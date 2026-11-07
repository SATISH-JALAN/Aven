# Recon: external facts, confirmed

Scope: P1 of `docs/planning/aven-claude-code-prompts.md`. It confirms the facts in `docs/spec/ARCHITECTURE.md` §2, §3 and §11 against our **installed** versions and the **live** chain.

Every line below has evidence: a file path and line (relative to `contracts/lib/` unless stated), a doc URL, or RPC/API output. Anything not confirmed is marked **UNVERIFIED** with a fallback.

Run: 2026-11-05, 15:45–17:55 UTC. Foundry 1.8.4, solc 0.8.26, Windows / Git Bash.

---

## A. Dependencies and toolchain (`contracts/`)

### A.1 Pins

| Lib | Pin | Evidence and reason |
|---|---|---|
| `Uniswap/v4-core` | `d153b048868a60c2403a3ef5b2301bb247884d46` (`v4.0.0-19`, npm `1.0.2`) | `v4.0.0` is v4-core's only tag, but it predates `src/types/PoolOperation.sol`: there `SwapParams` lives in `IPoolManager`, and OZ `BaseHook` doesn't compile against it. `git diff v4.0.0 d153b048 -- src/` is a pure refactor (param structs moved; same `PoolManager` logic). `git diff d153b048 bea7f6d -- src/` is **empty**: `bea7f6d` is today's `main`, the commit ARCHITECTURE §2/§15 cites, and only CI commits differ. `d153b048` is the exact v4-core commit pinned by OZ uniswap-hooks. |
| `Uniswap/v4-periphery` | `c6e4754dab11bd38c6f08ac51c3c868569e93d64` (`main`; the repo has **no tags**: `git ls-remote --tags` returns 0) | Matches ARCHITECTURE §15 (`c6e4754`). `BaseHook` was removed in #510 ("remove hooks and move to hook repo"), and `HookMiner` now lives at `test/shared/HookMiner.sol`. Periphery `main` pins v4-core `59d3ecf`; `git diff 59d3ecf d153b048 -- src/` is empty, so it agrees with our v4-core. |
| `OpenZeppelin/uniswap-hooks` | tag `v1.3.0-rc.0` (`b5f10574f943911635754dd76ed6ce95858b7d93`, 2026-10-07) | The prompt asks for v1.3.x and the architecture says "v1.3.0". `git ls-remote --tags` shows **no final `v1.3.0`**; `v1.3.0-rc.0` is the only v1.3.x tag. Its `package.json` says `"version": "1.3.0"` and the `BaseHook.sol` header says "last updated v1.3.0". It pins the same v4-core (`d153b048`) and v4-periphery (`7ebd04b`) as `v1.2.1`. **It is a release candidate**; if `v1.3.0` ships during the event, re-pin. |
| `foundry-rs/forge-std` | tag `v1.17.0` (`f3dae6e6`) | Latest tag. |
| `hyperliquid-dev/hyper-evm-lib` (tests only) | tag `v1.1` (`b7bda146`) | Latest tag. ARCHITECTURE §15 read `4eb7ab0` (HEAD); the `PrecompileLib` facts used below hold at `v1.1`. |

Pins are recorded in `contracts/foundry.lock` and the git submodule SHAs (`git submodule status`). No `forge init` template contracts were created; the Foundry layout (`src/ test/ script/ foundry.toml`) was written by hand.

### A.2 `foundry.toml` and remappings

- `[profile.default]`: `solc_version = "0.8.26"`, `evm_version = "cancun"`, `optimizer_runs = 200`, `via_ir = false` (§11.2). `fs_permissions` gives read-write on `../backend/data` (was `../data` before the 2026-11-06 restructure) and `./deployments`, and read on `./out-v4core`.
- `[rpc_endpoints]`: `hyperevm_testnet = https://rpc.hyperliquid-testnet.xyz/evm`, `hyperevm_mainnet = https://rpc.hyperliquid.xyz/evm`.
- `[profile.v4core]`: the PoolManager build (A.5).
- `contracts/remappings.txt`: `@uniswap/v4-core/=lib/v4-core/`, `@uniswap/v4-periphery/=lib/v4-periphery/`, `@openzeppelin/uniswap-hooks/=lib/uniswap-hooks/`, `forge-std/=lib/forge-std/src/`. Plus the transitive ones the libs need: `@openzeppelin/contracts/`, `solmate/`, `permit2/`, `hyper-evm-lib/`.

### A.3 Facts confirmed in installed sources

| Fact | Evidence |
|---|---|
| BaseHook import: `@openzeppelin/uniswap-hooks/src/base/BaseHook.sol` | file `uniswap-hooks/src/base/BaseHook.sol`; compiles in `test/recon/Recon.t.sol` |
| `constructor(IPoolManager _poolManager)` calls `_validateHookAddress(this)` → `Hooks.validateHookPermissions(hook, getHookPermissions())`, so a wrong address reverts at deploy | `BaseHook.sol:61-63`, `:100-101` |
| `function _beforeInitialize(address, PoolKey calldata, uint160) internal virtual returns (bytes4)` | `BaseHook.sol:119` |
| `function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata) internal virtual returns (bytes4, BeforeSwapDelta, uint24)` | `BaseHook.sol:263-266` |
| `getHookPermissions() public pure virtual returns (Hooks.Permissions memory)` | `BaseHook.sol:95` |
| New in v1.3: `modifier onlyValidPools(IHooks hooks)` reverts `InvalidPool()` unless `hooks == this`. Usable for `getFee` / `previewFee`, which take a caller-supplied `PoolKey`. | `BaseHook.sol:83` |
| `struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }` (file-level) | `v4-core/src/types/PoolOperation.sol:19` |
| `DYNAMIC_FEE_FLAG = 0x800000`, `OVERRIDE_FEE_FLAG = 0x400000`, `MAX_LP_FEE = 1000000` | `v4-core/src/libraries/LPFeeLibrary.sol:15,19,25`; asserted in `test_feeFlags` |
| Dynamic pools start at LP fee 0: `if (self.isDynamicFee()) return 0;` in `getInitialLPFee` | `LPFeeLibrary.sol:51-53` |
| `BEFORE_INITIALIZE_FLAG = 1 << 13`, `BEFORE_SWAP_FLAG = 1 << 7` (OR = `0x2080`) | `v4-core/src/libraries/Hooks.sol:29,38`; asserted in `test_hookFlagBits` |
| `Hooks.beforeSwap` reads the returned fee **only for dynamic-fee pools**: `if (key.fee.isDynamicFee()) lpFeeOverride = result.parseFee();` | `Hooks.sol:263` |
| `PoolManager.swap` passes it through: `(amountToSwap, beforeSwapDelta, lpFeeOverride) = key.hooks.beforeSwap(...)` → `lpFeeOverride: lpFeeOverride` | `v4-core/src/PoolManager.sol:201-202,214` |
| `Pool.swap` uses it **only when the override flag is set**: `params.lpFeeOverride.isOverride() ? params.lpFeeOverride.removeOverrideFlagAndValidate() : …` | `v4-core/src/libraries/Pool.sol:303-304`; `isOverride` at `LPFeeLibrary.sol:61`; `removeOverrideFlagAndValidate` at `:75` |
| ⇒ Without the flag, a dynamic pool swaps at its stored LP fee, which is 0 (ARCHITECTURE §2.3; invariant I3) | the three rows above |
| HookMiner: `@uniswap/v4-periphery/test/shared/HookMiner.sol`; `find(address deployer, uint160 flags, bytes memory creationCode, bytes memory constructorArgs) internal view returns (address, bytes32)`; `FLAG_MASK = Hooks.ALL_HOOK_MASK`; `MAX_LOOP = 160_444` (a 14-bit match needs ~16k tries on average) | `v4-periphery/test/shared/HookMiner.sol:10,14,23`. The remapping works directly, so no vendored copy is needed. It's MIT (`:1`). |
| `LiquidityAmounts` (for replay LP accounting) | `v4-periphery/src/libraries/LiquidityAmounts.sol` |
| `Deployers` | `v4-core/test/utils/Deployers.sol`: `deployFreshManagerAndRouters` `:91`, `deployMintAndApprove2Currencies` `:109`, `initPool` `:153,162`, `initPoolAndAddLiquidity` `:175`, `swap` `:214` |
| `PoolSwapTest.swap(PoolKey, SwapParams, TestSettings, bytes)` | `v4-core/src/test/PoolSwapTest.sol:35` |
| `PoolModifyLiquidityTest.modifyLiquidity(PoolKey, ModifyLiquidityParams, bytes)` | `v4-core/src/test/PoolModifyLiquidityTest.sol:33,41` |

### A.4 `IDynamicFeeHook`

- Copied verbatim into `contracts/src/interfaces/IDynamicFeeHook.sol` from `Uniswap/v4-hooks-public@c45509f3cafb044219dcd08faff5b68370ac61d6:src/interfaces/IDynamicFeeHook.sol` (the commit ARCHITECTURE §15 cites).
- Upstream is **MIT**: the file's SPDX header, the repo `LICENSE` ("Copyright (c) 2026 Universal Navigation Inc."), and GitHub API `license.spdx_id = MIT`. The header keeps the copyright and the source link.
- `getFee(PoolKey calldata key) external view returns (uint24 feeE6ZeroForOne, uint24 feeE6OneForZero)` and `error PoolNotInitialized(PoolId poolId)` match §2.5.

### A.5 PoolManager build

| Build | PoolManager runtime | Result |
|---|---|---|
| Default profile (`via_ir = false`, runs 200) | **19,766 B** | fits; used by tests |
| v4-core profile (`via_ir = true`, runs 44,444,444, `bytecode_hash = "none"`) via `FOUNDRY_PROFILE=v4core forge build --sizes lib/v4-core/src/PoolManager.sol` | **24,009 B** (initcode 24,194 B; margin 567 B under 24,576) | fits |
| Uniswap's PoolManager on HyperEVM mainnet `0x12D4…6B1F` (`cast codesize`) | **24,009 B** | — |

- **Byte-identical check:** our `out-v4core` `deployedBytecode` vs `cast code` of the mainnet PoolManager. Same length, and **0 differing bytes** outside the single 32-byte immutable at offset 13,606 (`NoDelegateCall.original`, which on mainnet holds its own address `0x12d4…6b1f`). Our deployed PoolManager will be the canonical Uniswap build.
- Tried `additional_compiler_profiles` + `compilation_restrictions` on `PoolManager.sol`. It works and gives 24,050 B (default `bytecode_hash`), but **every file that imports PoolManager** (`Deployers`, `PoolSwapTest`, all integration tests) then also compiles under via-IR/44M runs. That makes a cold build ~47s instead of ~9s, and tests would run a via-IR copy of `AvenHook` rather than the runs-200 artifact we deploy. Rejected; see Decisions.

---

## B. HyperEVM testnet (chain 998)

### B.1 Chain basics

| Check | Result (2026-11-05) |
|---|---|
| `eth_chainId` / `cast chain-id` | `0x3e6` = **998** |
| latest block | 68,830,576, ts 1793901113, **gasLimit 3,000,000** (small block), `baseFeePerGas` **100,000,000 wei (0.1 gwei)** |
| `eth_gasPrice` | 0.1–0.112 gwei |
| `eth_maxPriorityFeePerGas` | `0x0` (docs: "always returns zero") |
| `eth_bigBlockGasPrice` | `0x5f5e100` (0.1 gwei). `bigBlockGasPrice` without the `eth_` prefix → "Method not found". |

### B.2 No websocket on the official RPC (we poll)

- `wss://rpc.hyperliquid-testnet.xyz/evm` (`cast block-number`) → `HTTP error: 405 Method Not Allowed`.
- HTTPS with `Upgrade: websocket` headers → **HTTP 405**.
- `eth_subscribe` over HTTP → `-32601 Method not found`.
- The JSON-RPC docs page (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/json-rpc) doesn't list websockets. ARCHITECTURE §3.1 says the same. **Confirmed: poll `eth_blockNumber`.**

### B.3 RPC limits that affect P4/P6/P9 (from the JSON-RPC docs, plus probes)

- `eth_call`, `eth_estimateGas`, `eth_getBalance`, `eth_getCode`, `eth_getStorageAt` and `eth_getTransactionCount` work **only against the latest block**: "Requests that require historical state are not supported". So the verifier can't re-read past precompile values; it must use the `FeeComputed` event inputs (as §7.3 already plans).
- `eth_getLogs`: the docs say "limited to four topics and a 50-block query range". Probe from block 68,830,000: 50, 51 and 52-block ranges succeeded; 101 blocks → `-32008 Response is too big (max 1048576)`; 1,001 blocks → `-32005 rate limited`. **`verify --all` should scan in ≤ 50-block chunks filtered by hook address + `FeeComputed` topic.**
- Rate limits: "IP based rate limits are the same as the API server" (same page).
- **Mainnet (999) public RPC `eth_getLogs`, probed 2026-11-06 ~22:55–23:40 UTC, read-only.**
  - Filtered by address (+ topics), 50, 51, 200 and **500**-block ranges were served; 999 and 1,000 blocks were refused (`-32005`). That was within seconds of other calls, so it may be the throttle rather than a range limit: UNVERIFIED.
  - A full scan of our pools since the deploy block (address [PoolManager, hook], topic0 [Swap, ModifyLiquidity, FeeComputed], topic1 [both pool ids]) was **throttled**. After a few quick calls, every query was refused with `-32005 "Request exceeds defined limit"` / `"rate limited"`, **even 15-block ranges**, until ~25 s had passed. The refusals came about every 1,875 blocks scanned.
  - Effective throughput was ~30 blocks/s (≈17k blocks in ~590 s with calls 1.3 s apart). After three scans, even `eth_blockNumber` was refused for a while.
  - Consequences for the frontend (`src/lib/onchain.ts`): 500-block chunks, calls 2.5 s apart, exponential back-off (5 → 60 s) on a throttle, and the chunk shrinks only on a "response too big" (`-32008`). It scans newest-first and caches in localStorage.

### B.4 CREATE2 deployer

`eth_getCode 0x4e59b44847b379578588920cA78FbF26c0B4956C` on 998 → `0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3`, the standard deterministic-deployment-proxy runtime. **Deployed.**

### B.5 Uniswap v4 on 998

- Uniswap's deployments page (https://developers.uniswap.org/docs/protocols/v4/deployments, fetched via `/llms.mdx/docs/protocols/v4/deployments`) lists **HyperEVM: 999 only**. Its addresses match ARCHITECTURE §2.6 (PoolManager `0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F`, etc.). The testnet section lists Unichain Sepolia, Sepolia, Base Sepolia, Arbitrum Sepolia and interop-alpha-0/1, with **no HyperEVM testnet**.
- `cast codesize` on 998: `0x12D4…6B1F` → **0**; `0x000000000004444c5dc75cb358380d2e3de08a90` → **0**.
- Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` **does** exist on 998 (9,152 B).
- **Result: deploy our own** PoolManager + `PoolSwapTest` + `PoolModifyLiquidityTest`.

### B.6 Big blocks: exact steps

Sources: the dual-block docs (https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/dual-block-architecture), the JSON-RPC docs, the testnet faucet docs (https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet), and the official Python SDK `hyperliquid-dex/hyperliquid-python-sdk@2fdb18f` (`hyperliquid/exchange.py`, `utils/signing.py`, `utils/constants.py`).

- Small blocks: "1 seconds with a 3M gas limit". Big blocks: "1 minute with a 30M gas limit". The PoolManager deploy (24 KB → ≈ 4.8M gas of code deposit alone) is above the 3M small-block limit, so it **needs big blocks**.
- **Requirement:** "Like any action, this requires an existing Core user to send". An address becomes a Core user by receiving a Core asset such as USDC.
  - Check it on-chain with precompile `0x…0810` (coreUserExists, `L1Read.sol:133`), input `abi.encode(address)`: `0x0…01` → `1`, and the CREATE2 proxy → `0`.
  - Or check it via the info API.
- **Getting testnet USDC onto Core:**
  - The faucet https://app.hyperliquid-testnet.xyz/drip gives 1,000 mock USDC, but **only to an address that has deposited on mainnet** ("you need to have deposited on mainnet with the same address").
  - If the deployer key has never deposited on mainnet: from any wallet that has testnet USDC, send it on Core with `usdSend` (SDK `Exchange.usd_transfer(amount, destination)`, `exchange.py:579`) to the deployer address.
- **Switch on**, as the deployer, against testnet. `Exchange(wallet, constants.TESTNET_API_URL).use_big_blocks(True)` (`exchange.py:1127`) builds `{"type":"evmUserModify","usingBigBlocks":true}`, signs it as an **L1 action** (`sign_l1_action(..., is_mainnet = False)`, `signing.py:240`; phantom agent), and POSTs `{action, nonce, signature, vaultAddress: null, expiresAfter}` to `https://api.hyperliquid-testnet.xyz/exchange` (`exchange.py:101-110`; `constants.py:2`).
- **Check:** JSON-RPC `eth_usingBigBlocks(address)` → `true` (it returned `false` for the proxy on 998, so the method exists on testnet). After the deploy, the receipt's block `gasLimit` should be 30,000,000.
- **Switch off** after the deploy: `use_big_blocks(False)` (same action with `false`), because the docs say the flag "must be unset to return to small blocks". Then `eth_usingBigBlocks` → `false`.
- **UNVERIFIED** until we run it: that the action works on testnet with the signing above. The SDK code paths are confirmed, but no tx has been sent. Fallback: run it once early (P5 step 0). If testnet rejects it, deploy the PoolManager on a local anvil for tests only, and ask the team before changing the testnet plan.

### B.7 Testnet block explorer

**UNVERIFIED: no testnet explorer that shows HyperEVM txs and logs was found.**

- Hyperliquid "HyperEVM tools" (https://hyperliquid.gitbook.io/hyperliquid-docs/builder-tools/hyperevm-tools) lists Blockscout `www.hyperscan.com`, Etherscan `hyperevmscan.io`, Hyperscan `hyperscan.com` and Owlscan `owlscan.org`, without network labels.
- I probed with a real testnet tx `0xf86cde09…43509`:
  - `hyperscan.com` and `www.hyperscan.com` Blockscout API → 404 (mainnet only).
  - `testnet.hyperscan.com`, `testnet.hyperevmscan.io`, `owlscan.org`, `testnet.owlscan.org` → no DNS / no response.
  - `testnet.purrsec.com/tx/…` → 404. Chainlink's testnet guide names purrsec, but it may be a JS app; check in a browser.
  - Etherscan v2 `chainlist` → HyperEVM **999 only**; `chainid=998` → "unsupported chainid".
  - Routescan → "chain not supported".
- **Fallback:**
  - `deployments/998.json` `explorer` points to our own web route `/tx/<hash>`, which renders the receipt and decoded logs from the RPC.
  - `pnpm verify <tx>` prints everything from the RPC.
  - README tx links use that route. If purrsec works in a browser, use it instead.

---

## C. HyperCore reads

### C.1 HYPE perp index and szDecimals (`POST /info {"type":"meta"}`, index = position in `universe`)

| Network | Time (UTC) | Universe size | HYPE index | szDecimals | Other fields |
|---|---|---|---|---|---|
| testnet | 2026-11-05T17:54:30Z | 213 | **135** | **2** | maxLeverage 10, marginTableId 10, onlyIsolated true, marginMode strictIsolated |
| mainnet | 2026-11-05T17:54:47Z | 235 | **159** | **2** | maxLeverage 10, marginTableId 52 |

### C.2 `perpAssetInfo` (`0x…080a`, input `abi.encode(uint32)`)

- **Return encoding is `abi.encode(PerpAssetInfo)`, one dynamic struct** (leading `0x20` offset). It is **not** five flat values, and a flat `abi.decode(…, (string,uint32,uint8,uint8,bool))` reverts (seen in `test_forkRead_testnetHype` before the fix). The struct layout is `{string coin; uint32 marginTableId; uint8 szDecimals; uint8 maxLeverage; bool onlyIsolated}` (`hyper-evm-lib/src/PrecompileLib.sol:340`, `test/utils/L1Read.sol:41`).
- testnet `perpAssetInfo(135)` → `{coin "HYPE", marginTableId 10, szDecimals 2, maxLeverage 10, onlyIsolated true}`: **coin == "HYPE" ✓, szDecimals matches meta ✓.**
- mainnet `perpAssetInfo(159)` → `{coin "HYPE", marginTableId 52, szDecimals 2, maxLeverage 10, onlyIsolated false}`: ✓ ✓.

### C.3 Prices: precompile vs info API (scaling `raw / 10^(6 − szDecimals)` = raw / 10^4)

Each round: `metaAndAssetCtxs` + `allMids` first, then `eth_call` 0x806/0x807 at `latest`, about 1 s apart.

| Net | Round | API time | EVM block (block ts) | markPx raw → px | API markPx | Δ | oraclePx raw → px | API oraclePx | Δ | allMids |
|---|---|---|---|---|---|---|---|---|---|---|
| testnet | 1 | 17:54:31.635Z | 68,830,740 (17:54:34Z) | 789,260 → 78.9260 | 78.926 | 0.00 bp | 71,637,000 → 7163.7000 | 7163.7 | 0.00 bp | 78.926 |
| testnet | 2 | 17:54:37.428Z | 68,830,746 (17:54:40Z) | 789,260 → 78.9260 | 78.926 | 0.00 bp | 71,637,000 → 7163.7000 | 7163.7 | 0.00 bp | 78.926 |
| mainnet | 1 | 17:54:48.035Z | 50,471,916 (17:54:51Z) | 778,210 → 77.8210 | 77.809 | 1.54 bp | 778,089 → 77.8089 | 77.7885 | 2.62 bp | 77.8205 |
| mainnet | 2 | 17:54:53.809Z | 50,471,921 (17:54:56Z) | 778,390 → 77.8390 | 77.846 | 0.90 bp | 778,220 → 77.8220 | 77.822 | 0.00 bp | 77.8515 |

**Gate: PASS.** The testnet precompiles equal the info API exactly after scaling. The mainnet gaps of ≤ 2.6 bp come from the 1–3 s between the API read and the EVM read (the oracle updates about every 3 s). The scaling rule is also stated in the docs ("divide the returned price by `10^(6 - szDecimals)` for perps", https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/interacting-with-hypercore) and matches hyper-evm-lib `normalizedMarkPx = markPx * 10**szDecimals` (`PrecompileLib.sol:154-158`).

The cross-check runs in Foundry too: `FORK_READ=1 forge test --match-test test_forkRead` reads the live testnet precompiles via `vm.rpc`, and passes.

### C.4 ⚠️ Testnet HYPE market is degenerate (ARCHITECTURE §10.3 "thin or odd")

- Testnet HYPE oracle ≈ **7,163.70** vs mark ≈ **78.93**, a premium of **−9,890 bp**. `allMids` HYPE equals the mark exactly, and the earlier `metaAndAssetCtxs` had `midPx: null` (no book). Mainnet HYPE ≈ 77.8.
- Under §6.3 with default params, every **base-selling** swap is `withPressure` (premium < 0): 500 + 9,890 × 50 → clamped to **10,000 pips (1.00%)**, whatever the gap. Buys pay 500 + the gap term.
- A pool initialised at the oracle (§11.3 step I) would price aHYPE at ~7,164 aUSD.
- The demo story (the arb pays the gap; the shock pays near base) would be distorted for sells.
- Same check for other testnet perps, earlier the same day: SOL (idx 0) +45 bp, BTC (idx 3) +28 bp, ETH (idx 4) +74 bp. All are sane and have books.

### C.6 Testnet ETH (chosen Arena asset)

`POST /info {"type":"meta"}` at 2026-11-05T21:37:13Z → ETH at **index 4**, `szDecimals` **4**, maxLeverage 25, marginTableId 53. `perpAssetInfo(4)` (0x80a) → `{coin "ETH", marginTableId 53, szDecimals 4, maxLeverage 25, onlyIsolated false}`, which matches meta.

Scaling is raw / 10^(6−4) = raw / 100, so the price resolution is $0.01 ≈ 0.04 bp at ~$2,240.

| Time (UTC) | markPx raw → px | API mark | oraclePx raw → px | API oracle | API midPx | premium |
|---|---|---|---|---|---|---|
| 21:37:16 | 224,839 → 2248.39 | 2248.39 | 224,002 → 2240.02 | 2240.02 | 2249.05 | +37 bp |
| 21:37:24 | 224,828 → 2248.28 | 2248.28 | 223,990 → 2239.90 | 2239.9 | 2249.05 | +37 bp |
| 21:37:33 | 224,650 → 2246.50 | 2246.95 | 223,803 → 2238.03 | 2238.56 | 2249.05 | +37 bp |
| 21:37:52 | 224,690 → 2246.90 | 2246.9 | 223,802 → 2238.02 | 2238.02 | 2247.45 | +39 bp |
| 21:38:00 | 224,620 → 2246.20 | 2246.53 | 223,730 → 2237.30 | 2237.97 | 2246.85 | +39 bp |

Precompile = API exactly when the two reads land in the same oracle update. The 21:37:33 and 21:38:00 gaps (≤ 3 bp) are reads straddling an update.

The market is sane and has a live book. **Note for the demo:** the testnet premium (+37–39 bp) is larger than mainnet's (single digits). Under §6.3, swaps that **buy** base pay an extra ≈ 37 × 50 = 1,850 pips (with pressure); swaps that sell base don't.

### C.7 Browser market data and mempool (Trade page)

Checked 2026-11-06T18:48Z with `curl` and `origin: http://localhost:3000`:
- `POST https://api.hyperliquid-testnet.xyz/info` with `{"type":"l2Book","coin":"ETH"}` and `{"type":"metaAndAssetCtxs"}`: HTTP 200 with **`access-control-allow-origin: *`**, so the browser calls it directly (`frontend/src/lib/hl.ts`). `candleSnapshot` for ETH **1m** returns candles (`{t,T,s,i,o,c,h,l,v,n}`).
- HyperEVM testnet RPC: **no mempool view.** `txpool_status` and `txpool_content` return `-32601 Method not found`, and `eth_getBlockByNumber("pending")` returns `null`. The app shows only the pending state of the user's own transactions.
- **Hyperliquid info API weights** (docs, "Rate limits and user limits", checked 2026-11-07): "REST requests share an aggregated weight limit of 1200 per minute" per IP; `l2Book` and `allMids` weight 2; "All other documented info requests have weight 20" (incl. `metaAndAssetCtxs`); `candleSnapshot` 20 plus extra weight per 60 items returned. The Trade page's first polling (two `metaAndAssetCtxs` polls at 3 s, candles at 4 s) came to ~1,610/min, over the limit; now ~445/min measured (11 ctx + 7 candle + 25 book requests in 60 s).

### C.8 Hosting the Arena URL and the frontend (checked 2026-11-07)

- **Cloudflare Quick Tunnels** (`cloudflared tunnel --url …`, trycloudflare.com), from Cloudflare's trycloudflare page: "Quick Tunnels do not support Server-Sent Events (SSE)." · "Each Quick Tunnel supports up to 200 in-flight requests. Additional requests return a `429` response." · "The hostname changes each time you create a Quick Tunnel." · "Quick Tunnels have no uptime guarantee." · "You do not need a Cloudflare account or domain." The page states no price. **Consequence:** behind a quick tunnel the Arena's `/stream` won't work; the frontend falls back to polling `/state` (it does this on any stream error).
- **Named Cloudflare Tunnels:** "Available on all plans" (developers.cloudflare.com/tunnel). A public hostname maps to a local service (`app.example.com` → `http://localhost:8080`). **UNVERIFIED:** whether a hostname needs your own domain on Cloudflare (the pages fetched don't say; assume yes).
- **Vercel Hobby:** "The Hobby plan is **free**" and "restricts users to non-commercial, personal use only" (vercel.com/docs/plans/hobby). **UNVERIFIED:** pnpm 12.9.1 (`packageManager`) on Vercel's build image.

### C.5 Precompile gas

| Measurement (testnet, `oraclePx(135)`) | Value |
|---|---|
| `eth_estimateGas {to: 0x…0807, data: abi.encode(uint32 135)}` | **24,591** (= 21,000 intrinsic + 140 calldata + 3,451) |
| Smallest `staticcall` gas cap that succeeds (binary search with a state-overridden probe contract via `eth_call`) | **3,112** |
| Gas used by the caller's `staticcall` frame with cap 100k (cap + CALL overhead) | 3,693 |
| Invalid index 99,999 with cap 30,000 | fails; frame used **30,512**, so the **whole cap is burned** (confirms "consume all gas passed into the precompile call frame") |
| Doc formula `2000 + 65 × (input_len + output_len)` = 2000 + 65 × 64 | 6,160 |

- **The formula is NOT confirmed as the exact charge.** The measured charge (≤ 3,112) is about half of it. Treat the formula as an upper bound.
- Consequences:
  - `precompileGas = 30,000` (§6.2) gives ~9.6× headroom.
  - The `precompileGas ≥ 10,000` constructor rule is safe.
  - The §6.7 estimate of ~17k for two reads is conservative; the measured cost is ~7.4k including CALL overhead. Re-measure in P11.
- Locally (no fork) the precompile addresses have no code: `staticcall` returns `success = true` with **0 bytes** (`test_noPrecompileLocally`). The `readOk` rule "return ≥ 32 bytes and value > 0" (§6.3 Step 1) is what catches this.

---

## D. Mock plan: `contracts/test/recon/Recon.t.sol`

`forge test --match-path "test/recon/*"` → **7 passed, 1 skipped** (offline). With `FORK_READ=1` → **8 passed** (testnet HYPE markRaw 789,260, oracleRaw 71,566,000).

| Test | Proves |
|---|---|
| `test_feeFlags`, `test_hookFlagBits`, `test_swapParamsShape`, `test_pathsResolve` | every constant and import path in A.3 compiles and has the recorded value (BaseHook, PoolOperation, LPFeeLibrary, Hooks, PoolManager, Deployers, PoolSwapTest, PoolModifyLiquidityTest, HookMiner `test/shared`, LiquidityAmounts, our IDynamicFeeHook) |
| `test_noPrecompileLocally` | no code at 0x806/0x807 offline; staticcall succeeds with 0 bytes |
| `test_etchedStubReturnsScaledPrices` | `vm.etch` a stub at 0x806 and 0x807 (`abi.encode(uint32)` → `abi.encode(uint64)`) returns recorded raws that scale to 82.60 / 7157.55 |
| `test_gasCapContainsBurnAll` | a stub that burns all gas costs the caller only the cap; the caller continues |
| `test_forkRead_testnetHype` (skipped unless `FORK_READ=1`) | live `vm.rpc("hyperevm_testnet","eth_call",…)` to 0x80a/0x806/0x807: coin "HYPE", szDecimals 2, 32-byte non-zero prices (RealL1Read pattern, §3.5) |

---

## E. HyperEVM mainnet (999), checked 2026-11-06 (pre-mainnet audit)

All reads below are read-only (`eth_*` calls and info-API reads); nothing was signed or sent. RPC: `https://rpc.hyperliquid.xyz/evm`; API: `https://api.hyperliquid.xyz/info`.

### E.1 Blocks: speed and partitions (120 consecutive blocks from 50,541,339)

| Item | Value |
|---|---|
| Block time | **1 s** (p50, p90 and max all 1 s) |
| Block gas limits | 118 × **3,000,000** (small) + 2 × 30,000,000 (big) |
| Small-block fill | p50 37.2 %, p90 64.0 %, max 99.2 % |
| `eth_gasPrice` (next small block), ~13:00 UTC | 124,975,686 – 133,004,821 wei (0.125–0.133 gwei); at 15:44 UTC 192,553,889 wei (0.19 gwei) and the base fee near 1 gwei (see below) |
| `eth_bigBlockGasPrice` | 100,000,000 wei (0.1 gwei) |
| Base fee, **79 small-block samples over 2.9 h** (block headers, every 135th block, 2026-11-06 ~13:00–16:00 UTC) | min 0.100, p25 0.122, **p50 0.365**, p75 1.116, p90 3.506, **max 10.771 gwei**; hourly median 0.133 → 0.563 → 1.116 gwei. Blocks 98–99% full at the peak |
| ⚠️ Correction | An earlier version said "flat over 1,024 blocks". That was wrong: this RPC's `eth_feeHistory` returns **only 5 blocks** whatever count you ask for (checked with 0x14, 0x100 and 0x400). Sample block headers instead |

An Aven swap (~167k gas on the fork, E.5) uses ~5.6 % of a small block. `eth_maxPriorityFeePerGas` = 0.

### E.6 Funding route: official Hyperliquid docs (fetched 2026-11-06)

- **Deposit:**
  - "The minimum deposit amount is 5 USDC. If you send an amount less than this, it will not be credited and be lost forever."
  - "…credited to the account that sent it in less than 1 minute."
  - "CCTP is the preferred method…"; "The legacy bridge is deprecated."
  - Sources: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/bridge2 and …/hypercore/usdc.md.
- **What a wallet needs:** "USDC and ETH (gas to deposit) on Arbitrum". The deposit address also takes "USDC on Arbitrum/Ethereum/Base/Polygon". Source: …/onboarding/how-to-start-trading.
- **Spot minimum:** error `MinTradeSpotNtl`: "Order must have minimum value of 10 {quote_token}." Source: …/for-developers/api/error-responses.
- **Spot fee, tier 0:** taker 0.070%, maker 0.040%. Source: …/trading/fees.
- **Core → EVM:**
  - "…clicking the 'Transfer to/from EVM' button on the Balances table…"
  - "HYPE is received on the EVM side … as the native gas token"
  - "A transfer from HyperCore to HyperEVM costs 200k gas at the base gas price of the next HyperEVM block" (paid in HYPE on Core)
  - The tokens are credited to "the sender of the sendAsset action".
  - "…this only works for HYPE; sending other assets will lead to them being lost."
  - Sources: …/hyperevm/hypercore-less-than-greater-than-hyperevm-transfers and …/onboarding/how-to-use-the-hyperevm.
- **MetaMask network:** chain 999, RPC `https://rpc.hyperliquid.xyz/evm`, symbol HYPE, explorers https://hyperevmscan.io/ and https://www.hyperscan.com/.
- **MetaMask FAQ:** "Invalid transaction envelope type: specified type '0x2'…" — "a known issue with MetaMask; you can try a different wallet like Rabby". Source: …/support/faq/hyperevm-issues/gas-problem-on-evm.
- **forge flags** (local `forge script --help`): `--with-gas-price` = "max fee per gas for EIP1559 transactions"; `--priority-gas-price` = max priority fee.

### E.2 Uniswap v4 on 999

- PoolManager `0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F`: 24,009 B of code. **Identical to our `out-v4core` build** once the immutable is masked (A.5 method).
- `owner()` = `0x2D09D0C2F82c59B19B3C65a48CE2c550Bf0921f9` (Uniswap governance).
- `protocolFeeController()` = `0x0`, so no protocol fee can be set today. Governance could set a controller later. That wouldn't change the hook; verify check B would then need the protocol share.
- CREATE2 proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C`: present, with the same runtime as on 998 (B.4).
- **Consequence:** on 999 the deploy reuses Uniswap's PoolManager. `DeployCore` defaults `POOL_MANAGER` to it on chain 999, so no big blocks and no HyperCore-user step are needed.

### E.3 Perps and precompiles on 999

- `perpAssetInfo(1)` = `{coin: "ETH", marginTableId: 55, szDecimals: 4, maxLeverage: 25, onlyIsolated: false}`.
- `perpAssetInfo(159)` = `{coin: "HYPE", marginTableId: 52, szDecimals: 2, maxLeverage: 10, onlyIsolated: false}`.
- 0x807/0x806 vs `metaAndAssetCtxs`, 3 rounds about 2.5 s apart: ETH oracle and mark **0.00 bp** every round (e.g. 2237.74 = 2237.74). HYPE oracle 0.00 bp; mark 0.00 / 0.00 / −0.13 bp (read timing). Scaling `raw / 10^(6 − szDecimals)` confirmed on mainnet.
- `eth_estimateGas` of a 0x807 call: 24,591 gas, so the precompile execution costs ~3,451 gas (minus 21,000 intrinsic and 140 calldata). That's under `precompileGas` = 30,000.

### E.4 Public RPC limits (official docs + probes)

- Docs, rate-limits page: "Maximum of 100 EVM JSON-RPC requests per minute for `rpc.hyperliquid.xyz/evm`", per IP. https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits
- Docs, JSON-RPC page: `eth_call`, `eth_estimateGas`, `eth_getBalance`, `eth_getCode`, `eth_getStorageAt` and `eth_getTransactionCount` serve the latest block only, and "Requests that require historical state are not supported … on the default RPC implementation". The docs don't list `eth_sendRawTransaction`.
- Probes:
  - `eth_sendRawTransaction("0x00")` → `-32602 failed to decode signed transaction`, so the method **is** served;
  - `eth_estimateGas` works;
  - `eth_getCode`/`eth_getStorageAt` at head−100 returned data on the day, but that's not guaranteed.
- **Consequence:** the Arena makes more than 100 requests per minute (measured in SECURITY.md §6), so it needs a **dedicated HyperEVM RPC endpoint** on mainnet. The public one is fine for one-off reads.

### E.5 Mainnet fork rehearsal (anvil `--fork-url` 999 at block 50,541,674)

The precompiles don't exist in anvil, so `MockHyperCorePx` was placed there and loaded with the **real** mainnet ETH oracle/mark (raw 223,843 / 223,781). Then the five deploy scripts ran unchanged (`PERP_INDEX=1`, `EXPECT_COIN=ETH`):
- `DeployCore` **reused** Uniswap's PoolManager;
- all 23 transactions succeeded;
- both Aven smoke swaps verified (A and B MATCH against the canonical PoolManager).

| Step | gasUsed |
|---|---|
| PoolSwapTest / PoolModifyLiquidityTest | 1,349,983 / 1,282,555 |
| MockERC20 × 2 | 747,765 each |
| 6 mints + 4 approvals | 527,438 |
| AvenHook via CREATE2 | 2,111,463 |
| pool inits (Aven / control) | 79,726 / 51,803 |
| liquidity (2 positions) | 296,944 + 262,516 |
| 4 smoke swaps | 200,067 + 136,640 + 184,021 + 136,928 |
| **Deployer total** | **8,115,614** |

The full app ran on the same fork as chain 999 (Arena with `NATIVE_USD` 78.46, then `pnpm demo`):
- shock 164 bp;
- **Aven arb fee 8,800 vs 3,000 pips; LPs kept $64.05 more**;
- verify MATCH; `verify --all` A 4/4, B 4/4.

Per-swap gas there: Aven 166,889 / 167,021 (gas limit with margin ~250k), control 119,563 / 119,928.

## Decisions

1. **BaseHook source:** OpenZeppelin `uniswap-hooks` **`v1.3.0-rc.0`**, imported as `@openzeppelin/uniswap-hooks/src/base/BaseHook.sol`. It's the only v1.3.x tag (no final 1.3.0 exists yet); it pins the same v4-core/periphery as stable v1.2.1, and it adds `onlyValidPools`. Re-pin to `v1.3.0` if it ships. Subclass `BaseHook` directly; `BaseOverrideFee` uses `afterInitialize`, not our `beforeInitialize`.
2. **PoolManager:** **deploy our own** on 998; none exists (B.5).
3. **Hook deployer:** the existing **CREATE2 proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C`** (B.4). Mine with `HookMiner.find(0x4e59…956C, 0x2080, type(AvenHook).creationCode, abi.encode(poolManager, cfg, params, base, quote))`; `forge script` routes `new AvenHook{salt: s}(…)` through the proxy. No custom factory.
4. **PoolManager build approach:** a **separate build** with `[profile.v4core]` (via_ir, runs 44,444,444, `bytecode_hash = "none"`): `FOUNDRY_PROFILE=v4core forge build lib/v4-core/src/PoolManager.sol` → `out-v4core/`. `DeployCore.s.sol` deploys it from that artifact (`vm.getCode("out-v4core/PoolManager.sol/PoolManager.json")`). The result is **byte-identical to Uniswap's HyperEVM mainnet PoolManager** (24,009 B). Tests and our contracts stay on the fast default profile, so tests exercise the exact AvenHook bytecode we deploy. Tests use a default-profile PoolManager (19,766 B), built from the same source with only different optimizer settings.
5. **HYPE perpIndex + szDecimals:** testnet **135 / 2**; mainnet **159 / 2** (C.1, confirmed on-chain by `perpAssetInfo` in C.2). The replay uses mainnet data.
6. **Gas cap:** keep `Params.precompileGas = 30,000` (§6.2); measured charge ≤ 3,112 (C.5).
7. **Polling:** no websockets (B.2). Block poller via `eth_blockNumber`; `eth_getLogs` in ≤ 50-block chunks (B.3).
8. **Live Arena asset: testnet ETH (perp index 4, szDecimals 4). Decided by Sayan, 2026-11-06.** This replaces testnet HYPE, whose oracle is ~91× its mark (C.4). Evidence is in C.6. Mock tokens become `aETH` (18 dec) / `aUSD` (6 dec), and the §11.3 step G check becomes `coin == "ETH"`. The replay keeps HYPE on mainnet data (index 159), as §7.4/§7.5 specify.
9. **Explorer: none. Decided 2026-11-06.** Sayan confirmed `testnet.purrsec.com` doesn't work in a browser either, and B.7 found no other testnet explorer. Tx and log links point to our own frontend route `/tx/<hash>` (receipt + decoded `FeeComputed`/`Swap` from the RPC), plus `pnpm verify <tx>`. `deployments/998.json` `explorer` is set to that route's base URL when the frontend is deployed.

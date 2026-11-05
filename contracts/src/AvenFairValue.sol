// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @title AvenFairValue
/// @notice Perp-aware fair-value fee for Uniswap v4 hooks on HyperEVM. Reads HyperCore's oracle and mark price in the
/// same block (gas-capped, never reverting) and turns them into a clamped, direction-specific LP fee.
/// @dev Implements docs/spec/ARCHITECTURE.md §6.2-§6.4. All functions are `internal`, so the library is inlined into
/// the importing hook. All math is integer: unsigned division floors, signed division truncates toward zero, and
/// `mulDiv` is v4-core FullMath (512-bit, floor). The TypeScript port in backend/core/src/fee.ts must match exactly.
library AvenFairValue {
    /// @notice HyperCore mark price precompile: input abi.encode(uint32 perpIndex), output abi.encode(uint64) (§3.2).
    address internal constant MARK_PX = 0x0000000000000000000000000000000000000806;
    /// @notice HyperCore oracle price precompile: same encoding as MARK_PX (§3.2).
    address internal constant ORACLE_PX = 0x0000000000000000000000000000000000000807;
    uint256 internal constant Q96 = 2 ** 96;

    /// @notice Bound for `Params.maxFee` (§6.2): far below the 1e6 exact-output revert limit (§2.3).
    uint24 internal constant MAX_FEE_CAP = 100_000;
    /// @notice Minimum gas forwarded to each precompile call (§6.2). Measured charge is <= 3,112 (recon C.5).
    uint32 internal constant MIN_PRECOMPILE_GAS = 10_000;
    /// @notice Maximum ERC20 decimals accepted in `Config`. Not in §6.2; added so `poolWad` can never overflow on the
    /// swap path (it uses 10^(18 + decimals)). See docs/MEMORY.md "spec additions".
    uint8 internal constant MAX_TOKEN_DECIMALS = 18;

    error InvalidParams();

    /// @notice Pool and asset configuration, fixed per hook (§6.2).
    struct Config {
        uint32 perpIndex; // HyperCore perp index of the base asset
        uint8 szDecimals; // HyperCore szDecimals for that perp (<= 6)
        bool baseIsToken0; // base token is currency0 of the PoolKey
        uint8 decimals0; // ERC20 decimals of currency0
        uint8 decimals1; // ERC20 decimals of currency1
    }

    /// @notice Fee parameters, fixed per hook (§6.2). Fees in pips (1e6 = 100%).
    struct Params {
        uint24 baseFee; // calm fee
        uint24 minFee; // floor
        uint24 maxFee; // ceiling
        uint24 fallbackFee; // charged on a bad read
        uint32 gapWeight; // pips per bp of gap, arb direction only
        uint32 premiumWeight; // pips per bp of |premium|, with-pressure only
        uint32 stressThresholdBps; // mark move that counts as stress
        uint32 stressWeight; // pips per bp above threshold
        uint32 stressTauSec; // time constant of the mark anchor
        uint32 maxGapBps; // above this the read is treated as bad
        uint32 precompileGas; // gas forwarded to each precompile call
    }

    /// @notice Everything the fee depends on; every field is emitted in FeeComputed (§6.2, §8.1).
    struct Inputs {
        uint64 oracleRaw;
        uint64 markRaw;
        uint64 anchorMarkRaw; // mark anchor BEFORE this swap's update (0 = none)
        uint160 sqrtPriceX96; // pool price before the swap
        uint160 sqrtPriceTopX96; // pool price at top of this block
        bool zeroForOne;
        bool readOk;
    }

    enum Reason {
        OK,
        READ_FAILED,
        GAP_TOO_LARGE
    }

    /// @notice The fee and every intermediate signal (§6.2).
    struct Breakdown {
        uint24 fee;
        Reason reason;
        uint256 gapBps;
        int256 premiumBps;
        uint256 moveBps;
        bool arb;
        bool withPressure;
    }

    // ------------------------------------------------------------------------------------------------ §6.2 defaults

    /// @notice The §6.2 default parameters.
    function defaultParams() internal pure returns (Params memory) {
        return Params({
            baseFee: 500,
            minFee: 500,
            maxFee: 10_000,
            fallbackFee: 3_000,
            gapWeight: 50,
            premiumWeight: 50,
            stressThresholdBps: 50,
            stressWeight: 20,
            stressTauSec: 60,
            maxGapBps: 2_000,
            precompileGas: 30_000
        });
    }

    /// @notice Reverts `InvalidParams` unless every §6.2 constructor rule on Config/Params holds:
    /// minFee <= baseFee <= maxFee; minFee <= fallbackFee <= maxFee; maxFee <= 100_000; stressTauSec > 0;
    /// maxGapBps > 0; precompileGas >= 10_000; szDecimals <= 6; plus decimals0/decimals1 <= 18 (see MAX_TOKEN_DECIMALS).
    /// @dev Currency rules (currency0 < currency1, distinct, not native, baseIsToken0 consistency) need the currencies,
    /// so AvenHook's constructor checks them (§6.2, §6.5).
    function validateParams(Config memory cfg, Params memory p) internal pure {
        if (p.minFee > p.baseFee || p.baseFee > p.maxFee) revert InvalidParams();
        if (p.minFee > p.fallbackFee || p.fallbackFee > p.maxFee) revert InvalidParams();
        if (p.maxFee > MAX_FEE_CAP) revert InvalidParams();
        if (p.stressTauSec == 0) revert InvalidParams();
        if (p.maxGapBps == 0) revert InvalidParams();
        if (p.precompileGas < MIN_PRECOMPILE_GAS) revert InvalidParams();
        if (cfg.szDecimals > 6) revert InvalidParams();
        if (cfg.decimals0 > MAX_TOKEN_DECIMALS || cfg.decimals1 > MAX_TOKEN_DECIMALS) revert InvalidParams();
    }

    // ------------------------------------------------------------------------------------------------ §6.3 Step 1

    /// @notice Reads oracle and mark for `perpIndex` (§6.3 Step 1). Never reverts.
    /// @dev Each staticcall forwards exactly `gasCap` (subject to the EVM 63/64 rule). `readOk` is true iff both calls
    /// succeed, each returns >= 32 bytes, and both values are > 0 and fit in uint64 (a larger word is not a valid
    /// uint64 and is treated as a failed read rather than reverting in abi.decode).
    function readPrices(uint32 perpIndex, uint256 gasCap)
        internal
        view
        returns (bool readOk, uint64 oracleRaw, uint64 markRaw)
    {
        bool okO;
        bool okM;
        (okO, oracleRaw) = _readPx(ORACLE_PX, perpIndex, gasCap);
        (okM, markRaw) = _readPx(MARK_PX, perpIndex, gasCap);
        readOk = okO && okM;
        if (!readOk) {
            oracleRaw = okO ? oracleRaw : 0;
            markRaw = okM ? markRaw : 0;
        }
    }

    /// @dev One gas-capped staticcall. Copies at most 32 bytes of return data, so a large return can't cost the caller.
    function _readPx(address precompile, uint32 perpIndex, uint256 gasCap) private view returns (bool ok, uint64 px) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, perpIndex) // abi.encode(uint32): one right-aligned word
            let success := staticcall(gasCap, precompile, ptr, 0x20, ptr, 0x20)
            if and(success, gt(returndatasize(), 0x1f)) {
                let w := mload(ptr)
                if and(gt(w, 0), lt(w, 0x10000000000000000)) {
                    ok := 1
                    px := w
                }
            }
        }
    }

    // ------------------------------------------------------------------------------------------------ §6.3 Step 3

    /// @notice Oracle price in wad (1e18): raw * 10^(12 + szDecimals) == raw * 1e18 / 10^(6 - szDecimals) (§6.3 Step 3).
    function oracleWad(Config memory cfg, uint64 raw) internal pure returns (uint256) {
        return uint256(raw) * 10 ** (12 + uint256(cfg.szDecimals));
    }

    /// @notice Base token price in quote token, decimals-adjusted, in wad (§6.3 Step 3). Exact mulDiv order per spec.
    function poolWad(Config memory cfg, uint160 sqrtPriceX96) internal pure returns (uint256) {
        uint256 sp = uint256(sqrtPriceX96);
        if (cfg.baseIsToken0) {
            uint256 pX96 = FullMath.mulDiv(sp, sp, Q96);
            return FullMath.mulDiv(pX96, 10 ** (18 + uint256(cfg.decimals0)), 10 ** uint256(cfg.decimals1) * Q96);
        } else {
            uint256 a = FullMath.mulDiv(10 ** (18 + uint256(cfg.decimals1)), Q96, sp);
            return FullMath.mulDiv(a, Q96, sp * 10 ** uint256(cfg.decimals0));
        }
    }

    // ------------------------------------------------------------------------------------------------ §6.3 Steps 2-8

    /// @notice The fee for one swap direction given all inputs (§6.3 Steps 2-8). Pure.
    /// @dev Never reverts for inputs within: sqrtPriceX96/sqrtPriceTopX96 in [MIN_SQRT_PRICE, MAX_SQRT_PRICE] when
    /// readOk, and Config/Params that pass validateParams.
    function compute(Config memory cfg, Params memory p, Inputs memory inp) internal pure returns (Breakdown memory b) {
        // Step 2 — fallback on bad read.
        if (!inp.readOk) {
            b.fee = p.fallbackFee;
            b.reason = Reason.READ_FAILED;
            return b;
        }

        // Step 3 — prices in wad.
        uint256 oWad = oracleWad(cfg, inp.oracleRaw);
        uint256 curWad = poolWad(cfg, inp.sqrtPriceX96);
        uint256 topWad = poolWad(cfg, inp.sqrtPriceTopX96);

        // Step 4 — gap with top-of-block anchor.
        uint256 gapCur = FullMath.mulDiv(_absDiff(curWad, oWad), 10_000, oWad);
        uint256 gapTop = FullMath.mulDiv(_absDiff(topWad, oWad), 10_000, oWad);
        bool above = curWad > oWad;
        bool below = curWad < oWad;
        bool topSameSide = (above && topWad > oWad) || (below && topWad < oWad);
        b.gapBps = topSameSide ? (gapCur > gapTop ? gapCur : gapTop) : gapCur;
        if (b.gapBps > p.maxGapBps) {
            b.fee = p.fallbackFee;
            b.reason = Reason.GAP_TOO_LARGE;
            return b;
        }

        // Step 5 — direction.
        bool sellingBase = cfg.baseIsToken0 ? inp.zeroForOne : !inp.zeroForOne;
        b.arb = (above && sellingBase) || (below && !sellingBase);

        // Step 6 — perp pressure (raw values share scaling, so it cancels).
        b.premiumBps =
            (int256(uint256(inp.markRaw)) - int256(uint256(inp.oracleRaw))) * 10_000 / int256(uint256(inp.oracleRaw));
        b.withPressure = (b.premiumBps > 0 && !sellingBase) || (b.premiumBps < 0 && sellingBase);

        // Step 7 — stress against the time-weighted mark anchor.
        if (inp.anchorMarkRaw != 0) {
            b.moveBps = _absDiff(inp.markRaw, inp.anchorMarkRaw) * 10_000 / uint256(inp.anchorMarkRaw);
        }

        // Step 8 — combine and clamp (uint256).
        uint256 raw = p.baseFee;
        if (b.arb) raw += b.gapBps * p.gapWeight;
        if (b.withPressure) raw += _abs(b.premiumBps) * p.premiumWeight;
        if (b.moveBps > p.stressThresholdBps) raw += (b.moveBps - p.stressThresholdBps) * p.stressWeight;
        if (raw < p.minFee) raw = p.minFee;
        if (raw > p.maxFee) raw = p.maxFee;
        // casting to 'uint24' is safe because raw was just clamped to maxFee <= 100_000 (validateParams)
        // forge-lint: disable-next-line(unsafe-typecast)
        b.fee = uint24(raw);
        b.reason = Reason.OK;
    }

    // ------------------------------------------------------------------------------------------------ §6.4 step 5

    /// @notice Time-weighted mark anchor update (§6.4 step 5). Call only when both reads succeeded (I9).
    /// @dev If no anchor yet (anchorTime == 0) or dt >= tau: snap to mark. Else move by (mark - anchor) * dt / tau
    /// (signed, truncating toward zero). Requires nowTs >= anchorTime (block.timestamp is monotonic).
    function advanceAnchor(uint64 anchorMark, uint40 anchorTime, uint64 markRaw, uint40 nowTs, uint32 tau)
        internal
        pure
        returns (uint64 newMark, uint40 newTime)
    {
        uint256 dt = uint256(nowTs) - uint256(anchorTime);
        if (anchorTime == 0 || dt >= tau) {
            newMark = markRaw;
        } else {
            int256 a = int256(uint256(anchorMark));
            // casting to 'uint64' is safe because the result lies between anchorMark and markRaw, both uint64 (fuzzed)
            // forge-lint: disable-next-line(unsafe-typecast)
            newMark = uint64(uint256(a + (int256(uint256(markRaw)) - a) * int256(dt) / int256(uint256(tau))));
        }
        newTime = nowTs;
    }

    // ------------------------------------------------------------------------------------------------ helpers

    function _absDiff(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    function _abs(int256 x) private pure returns (uint256) {
        // casting to 'uint256' is safe because x >= 0 or -x > 0; |premiumBps| < 2^64 * 1e4, so -x never overflows
        // forge-lint: disable-next-line(unsafe-typecast)
        return x >= 0 ? uint256(x) : uint256(-x);
    }
}

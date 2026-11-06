// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {AvenFairValue as FV} from "src/AvenFairValue.sol";
import {AvenHook} from "src/AvenHook.sol";
import {MockHyperCorePx} from "test/mocks/MockHyperCorePx.sol";
import {PriceMath} from "test/utils/PriceMath.sol";

/// @notice Offline replay engine (PLAN 5.2, ARCHITECTURE §7.4). Four pools with identical liquidity, range and start:
/// fixed05 (0.05%), fixed30 (0.30%), avenDelayed (AvenHook on perp index 1 = price lagged ~60 s), avenLive (AvenHook on
/// perp index 0 = current price). Each step: warp/roll, set mock prices, an arb agent (same algorithm as the Arena bot,
/// profit measured at the TRUE oracle, unprofitable trades reverted) and a seeded retail agent (same sequence on every
/// pool), then poke the LP position to collect fees. Outputs a CSV row per pool per step and a summary JSON.
/// Real scenarios run with REPLAY_INPUT=<json> (`pnpm replay <scenario>`); the sanity tests always run.
contract ReplayTest is Deployers {
    using StateLibrary for *;
    using BalanceDeltaLibrary for BalanceDelta;

    address constant MARK_PX = 0x0000000000000000000000000000000000000806;
    address constant ORACLE_PX = 0x0000000000000000000000000000000000000807;
    int24 constant SPACING = 60;
    uint256 constant RETAIL_SEED = 0x52455441494c; // "RETAIL"
    string[4] NAMES = ["fixed05", "fixed30", "avenDelayed", "avenLive"];

    struct PoolRun {
        PoolKey key;
        PoolId id;
        address hook; // 0 for fixed pools
        uint256 arbTrades;
        uint256 retailTrades;
        uint256 fees0;
        uint256 fees1;
        uint24 lastArbFee;
        uint8 lastArbReason;
        uint256 expectedRetailFeeValue; // independent check: sum of retail input value x quoted fee (wad USD)
    }

    struct Opts {
        bool arb;
        bool retail;
        string csvPath; // "" = don't write
        string summaryPath;
        string scenario;
        string interval;
        uint256 lagSec;
    }

    struct Result {
        int256 lpValue; // wad USD
        int256 hodlValue;
        int256 feesValue;
        uint256 arbTrades;
        uint256 retailTrades;
    }

    MockHyperCorePx oracleMock;
    MockHyperCorePx markMock;
    MockERC20 baseTok;
    MockERC20 quoteTok;
    FV.Config cfg; // perpIndex 0 (live); the delayed hook uses perpIndex 1
    PoolRun[4] pools;
    int24 lower;
    int24 upper;
    uint128 liq;
    uint256 hodl0;
    uint256 hodl1;

    // ------------------------------------------------------------------------------------------------ setup

    function _init(uint64 oracleRaw0, uint8 szDecimals) internal {
        vm.roll(1_000);
        deployFreshManagerAndRouters();
        vm.etch(ORACLE_PX, address(new MockHyperCorePx()).code);
        vm.etch(MARK_PX, address(new MockHyperCorePx()).code);
        oracleMock = MockHyperCorePx(ORACLE_PX);
        markMock = MockHyperCorePx(MARK_PX);

        baseTok = new MockERC20("Aven HYPE", "aHYPE", 18);
        quoteTok = new MockERC20("Aven USD", "aUSD", 6);
        for (uint256 i; i < 2; i++) {
            MockERC20 t = i == 0 ? baseTok : quoteTok;
            t.mint(address(this), 1e40);
            t.approve(address(swapRouter), type(uint256).max);
            t.approve(address(modifyLiquidityRouter), type(uint256).max);
        }
        bool base0 = address(baseTok) < address(quoteTok);
        (currency0, currency1) = base0
            ? (Currency.wrap(address(baseTok)), Currency.wrap(address(quoteTok)))
            : (Currency.wrap(address(quoteTok)), Currency.wrap(address(baseTok)));
        cfg = FV.Config({
            perpIndex: 0,
            szDecimals: szDecimals,
            baseIsToken0: base0,
            decimals0: base0 ? 18 : 6,
            decimals1: base0 ? 6 : 18
        });

        uint160 sp = PriceMath.sqrtPriceFromWad(cfg, FV.oracleWad(cfg, oracleRaw0));
        int24 tick = TickMath.getTickAtSqrtPrice(sp);
        lower = _floor(tick - 6932); // ~ x0.5
        upper = _floor(tick + 4055) + SPACING; // ~ x1.5
        // 1,000 base of liquidity on the base side, identical in every pool
        liq = base0
            ? LiquidityAmounts.getLiquidityForAmount0(sp, TickMath.getSqrtPriceAtTick(upper), 1_000e18)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(lower), sp, 1_000e18);

        FV.Config memory cfgLag = cfg;
        cfgLag.perpIndex = 1;
        address hookLag = _hookAt(cfgLag, 0x1111);
        address hookLive = _hookAt(cfg, 0x2222);
        uint24[4] memory fees = [uint24(500), 3000, LPFeeLibrary.DYNAMIC_FEE_FLAG, LPFeeLibrary.DYNAMIC_FEE_FLAG];
        address[4] memory hooks = [address(0), address(0), hookLag, hookLive];
        for (uint256 i; i < 4; i++) {
            PoolKey memory k = PoolKey(currency0, currency1, fees[i], SPACING, IHooks(hooks[i]));
            manager.initialize(k, sp);
            modifyLiquidityRouter.modifyLiquidity(k, ModifyLiquidityParams(lower, upper, int256(uint256(liq)), 0), "");
            pools[i].key = k;
            pools[i].id = k.toId();
            pools[i].hook = hooks[i];
        }
        (hodl0, hodl1) = _principal(sp);
    }

    function _hookAt(FV.Config memory c, uint160 salt) internal returns (address at) {
        at = address(uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG) | (salt << 144));
        (Currency b, Currency q) = c.baseIsToken0 ? (currency0, currency1) : (currency1, currency0);
        deployCodeTo("AvenHook.sol:AvenHook", abi.encode(manager, c, FV.defaultParams(), b, q), at);
    }

    function _floor(int24 t) internal pure returns (int24) {
        int24 c = t / SPACING;
        if (t < 0 && t % SPACING != 0) c--;
        return c * SPACING;
    }

    // ------------------------------------------------------------------------------------------------ engine

    function _run(
        uint256[] memory ts,
        uint256[] memory oRaw,
        uint256[] memory mRaw,
        uint256[] memory oLag,
        uint256[] memory mLag,
        Opts memory o
    ) internal returns (Result[4] memory res) {
        vm.pauseGasMetering();
        if (bytes(o.csvPath).length > 0) {
            vm.writeFile(
                o.csvPath,
                "step,timestamp,pool,poolPrice,oracle,mark,feePips,reason,lpValueUsd,hodlValueUsd,lvrUsd,lvrPct,feesCumUsd,arbTrades,retailTrades\n"
            );
        }
        for (uint256 k; k < ts.length; k++) {
            vm.warp(ts[k]);
            vm.roll(block.number + 1);
            oracleMock.set(0, uint64(oRaw[k]));
            markMock.set(0, uint64(mRaw[k]));
            oracleMock.set(1, uint64(oLag[k]));
            markMock.set(1, uint64(mLag[k]));
            uint256 r = uint256(keccak256(abi.encode(RETAIL_SEED, k)));
            for (uint256 i; i < 4; i++) {
                pools[i].lastArbFee = 0;
                pools[i].lastArbReason = 255;
                if (o.arb) _arb(i, uint64(oRaw[k]));
                if (o.retail) _retail(i, r, uint64(oRaw[k]));
                _poke(i);
                if (bytes(o.csvPath).length > 0) _row(o.csvPath, k, ts[k], i, uint64(oRaw[k]), uint64(mRaw[k]));
            }
        }
        uint64 lastO = uint64(oRaw[oRaw.length - 1]);
        for (uint256 i; i < 4; i++) {
            res[i] = _result(i, lastO);
        }
        if (bytes(o.summaryPath).length > 0) _summary(o, res, ts.length);
        vm.resumeGasMetering();
    }

    /// Same algorithm as the Arena bot (§7.2): direction from the TRUE oracle, fee quoted from the pool (fixed or
    /// previewFee), trade exact-input toward p*; keep only trades profitable at the true oracle.
    function _arb(uint256 i, uint64 oracleRaw) internal {
        PoolRun storage p = pools[i];
        uint160 sp = _sqrt(p.id);
        uint256 oW = FV.oracleWad(cfg, oracleRaw);
        uint256 pW = FV.poolWad(cfg, sp);
        uint256 gap = FullMath.mulDiv(pW > oW ? pW - oW : oW - pW, 10_000, oW);
        if (gap == 0) return; // |gap| < 1 bp
        bool sell = pW > oW;
        bool zeroForOne = sell ? cfg.baseIsToken0 : !cfg.baseIsToken0;
        uint24 fee;
        uint8 reason;
        if (p.hook == address(0)) {
            fee = p.key.fee;
        } else {
            FV.Breakdown memory b = AvenHook(p.hook).previewFee(p.key, zeroForOne);
            fee = b.fee;
            reason = uint8(b.reason);
        }
        uint256 pStar = sell ? FullMath.mulDiv(oW, 1e6, 1e6 - fee) : FullMath.mulDiv(oW, 1e6 - fee, 1e6);
        if (sell ? pW <= pStar : pW >= pStar) return;
        uint160 limit = PriceMath.sqrtPriceFromWad(cfg, pStar);
        if (zeroForOne ? limit >= sp : limit <= sp) return;
        uint256 snap = vm.snapshotState();
        BalanceDelta d = swapRouter.swap(
            p.key, SwapParams(zeroForOne, -int256(1e30), limit), PoolSwapTest.TestSettings(false, false), ""
        );
        if (_valueDelta(d, oW) <= 0) {
            vm.revertToState(snap);
            return;
        }
        p.arbTrades++;
        p.lastArbFee = fee;
        p.lastArbReason = reason;
    }

    /// Seeded retail flow: identical on every pool. ~2/3 of steps, $100..$3,000, random direction.
    function _retail(uint256 i, uint256 r, uint64 oracleRaw) internal {
        if (r % 3 == 0) return;
        bool buyBase = (r >> 8) & 1 == 1;
        uint256 usd = 100 + ((r >> 16) % 2_901);
        uint256 amountIn = buyBase ? usd * 1e6 : FullMath.mulDiv(usd * 1e18, 1e18, FV.oracleWad(cfg, oracleRaw));
        bool zeroForOne = buyBase ? !cfg.baseIsToken0 : cfg.baseIsToken0;
        uint24 fee = pools[i].hook == address(0)
            ? pools[i].key.fee
            : AvenHook(pools[i].hook).previewFee(pools[i].key, zeroForOne).fee;
        uint256 inValue = buyBase ? amountIn * 1e12 : FullMath.mulDiv(amountIn, FV.oracleWad(cfg, oracleRaw), 1e18);
        pools[i].expectedRetailFeeValue += inValue * fee / 1e6;
        swapRouter.swap(
            pools[i].key,
            SwapParams(
                zeroForOne, -int256(amountIn), zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        pools[i].retailTrades++;
    }

    /// Collect fees by poking the position (liquidityDelta 0); the returned delta is the fees paid out.
    function _poke(uint256 i) internal {
        BalanceDelta d =
            modifyLiquidityRouter.modifyLiquidity(pools[i].key, ModifyLiquidityParams(lower, upper, 0, 0), "");
        pools[i].fees0 += uint256(int256(d.amount0()));
        pools[i].fees1 += uint256(int256(d.amount1()));
    }

    // ------------------------------------------------------------------------------------------------ accounting

    function _sqrt(PoolId id) internal view returns (uint160 sp) {
        (sp,,,) = manager.getSlot0(id);
    }

    /// Token amounts of the LP position at price `sp` (round down).
    function _principal(uint160 sp) internal view returns (uint256 a0, uint256 a1) {
        uint160 sa = TickMath.getSqrtPriceAtTick(lower);
        uint160 sb = TickMath.getSqrtPriceAtTick(upper);
        uint160 s = sp < sa ? sa : sp > sb ? sb : sp;
        a0 = SqrtPriceMath.getAmount0Delta(s, sb, liq, false);
        a1 = SqrtPriceMath.getAmount1Delta(sa, s, liq, false);
    }

    /// USD (wad) of token amounts at the base price `oW` (quote = $1).
    function _value(uint256 a0, uint256 a1, uint256 oW) internal view returns (int256) {
        (uint256 b, uint256 q) = cfg.baseIsToken0 ? (a0, a1) : (a1, a0);
        return int256(FullMath.mulDiv(b, oW, 1e18) + q * 1e12);
    }

    function _valueDelta(BalanceDelta d, uint256 oW) internal view returns (int256) {
        (int256 b, int256 q) =
            cfg.baseIsToken0 ? (int256(d.amount0()), int256(d.amount1())) : (int256(d.amount1()), int256(d.amount0()));
        return b * int256(oW) / 1e18 + q * 1e12;
    }

    function _result(uint256 i, uint64 oracleRaw) internal view returns (Result memory r) {
        uint256 oW = FV.oracleWad(cfg, oracleRaw);
        (uint256 a0, uint256 a1) = _principal(_sqrt(pools[i].id));
        r.feesValue = _value(pools[i].fees0, pools[i].fees1, oW);
        r.lpValue = _value(a0, a1, oW) + r.feesValue;
        r.hodlValue = _value(hodl0, hodl1, oW);
        r.arbTrades = pools[i].arbTrades;
        r.retailTrades = pools[i].retailTrades;
    }

    // ------------------------------------------------------------------------------------------------ output

    function _row(string memory path, uint256 k, uint256 t, uint256 i, uint64 oRaw, uint64 mRaw) internal {
        Result memory r = _result(i, oRaw);
        int256 lvr = r.hodlValue - r.lpValue;
        uint256 scale = 10 ** (6 - cfg.szDecimals);
        string memory a = string.concat(
            vm.toString(k),
            ",",
            vm.toString(t),
            ",",
            NAMES[i],
            ",",
            _fmt(int256(FV.poolWad(cfg, _sqrt(pools[i].id))), 18, 6),
            ","
        );
        string memory b = string.concat(
            _fmt(int256(uint256(oRaw)) * 1e18 / int256(scale), 18, 6),
            ",",
            _fmt(int256(uint256(mRaw)) * 1e18 / int256(scale), 18, 6),
            ","
        );
        string memory c = string.concat(
            vm.toString(pools[i].lastArbFee),
            ",",
            _reasonName(pools[i].lastArbReason, pools[i].hook != address(0)),
            ",",
            _fmt(r.lpValue, 18, 4),
            ",",
            _fmt(r.hodlValue, 18, 4),
            ","
        );
        string memory d = string.concat(
            _fmt(lvr, 18, 4),
            ",",
            _fmt(lvr * 1e18 * 100 / r.hodlValue, 18, 6),
            ",",
            _fmt(r.feesValue, 18, 4),
            ",",
            vm.toString(r.arbTrades),
            ",",
            vm.toString(r.retailTrades)
        );
        vm.writeLine(path, string.concat(a, b, c, d));
    }

    function _reasonName(uint8 r, bool isAven) internal pure returns (string memory) {
        if (r == 255) return "-"; // no arb trade this step
        if (!isAven) return "FIXED";
        return r == 0 ? "OK" : r == 1 ? "READ_FAILED" : "GAP_TOO_LARGE";
    }

    function _summary(Opts memory o, Result[4] memory res, uint256 steps) internal {
        string memory poolsJ;
        for (uint256 i; i < 4; i++) {
            string memory k = NAMES[i];
            int256 lvr = res[i].hodlValue - res[i].lpValue;
            vm.serializeString(k, "lpValueUsd", _fmt(res[i].lpValue, 18, 4));
            vm.serializeString(k, "hodlValueUsd", _fmt(res[i].hodlValue, 18, 4));
            vm.serializeString(k, "lvrUsd", _fmt(lvr, 18, 4));
            vm.serializeString(k, "lvrPct", _fmt(lvr * 1e18 * 100 / res[i].hodlValue, 18, 6));
            vm.serializeString(k, "feesEarnedUsd", _fmt(res[i].feesValue, 18, 4));
            vm.serializeUint(k, "arbTrades", res[i].arbTrades);
            string memory pj = vm.serializeUint(k, "retailTrades", res[i].retailTrades);
            poolsJ = vm.serializeString("pools", k, pj);
        }
        FV.Params memory p = FV.defaultParams();
        vm.serializeUint("params", "baseFee", p.baseFee);
        vm.serializeUint("params", "maxFee", p.maxFee);
        vm.serializeUint("params", "fallbackFee", p.fallbackFee);
        vm.serializeUint("params", "gapWeight", p.gapWeight);
        vm.serializeUint("params", "premiumWeight", p.premiumWeight);
        vm.serializeUint("params", "stressThresholdBps", p.stressThresholdBps);
        vm.serializeUint("params", "stressWeight", p.stressWeight);
        vm.serializeUint("params", "stressTauSec", p.stressTauSec);
        string memory paramsJ = vm.serializeUint("params", "maxGapBps", p.maxGapBps);
        vm.serializeString("summary", "scenario", o.scenario);
        vm.serializeString("summary", "interval", o.interval);
        vm.serializeUint("summary", "steps", steps);
        vm.serializeUint("summary", "lagSec", o.lagSec);
        vm.serializeString(
            "summary",
            "liquidity",
            "identical per pool: 1,000 base on the base side, range ~-50%/+50% around the start price"
        );
        vm.serializeString(
            "summary",
            "method",
            "Each step: warp to the candle, set mock oracle = oracleProxy and mark = candle close (perp 0); perp 1 = the same "
            "values ~lagSec earlier, linearly interpolated between candles (1m data not served). Arb agent = Arena bot algorithm, "
            "profit at the true oracle, unprofitable trades reverted. Seeded retail agent, same sequence on every pool. LP value = "
            "position principal + collected fees at the oracle; HODL = initial tokens at the oracle; LVR = HODL - LP value."
        );
        vm.serializeString(
            "summary",
            "limits",
            "oracleProxy = markClose / (1 + hourly funding premium) approximates the historical oracle; candle close approximates "
            "the mark; 5m steps; one arb per pool per step; parameters are the spec defaults, not tuned."
        );
        vm.serializeString("summary", "params", paramsJ);
        string memory out = vm.serializeString("summary", "pools", poolsJ);
        vm.writeJson(out, o.summaryPath);
    }

    /// Fixed-point decimal string of a signed integer with `dec` decimals, shown to `show` decimals (truncated).
    function _fmt(int256 x, uint256 dec, uint256 show) internal pure returns (string memory) {
        bool neg = x < 0;
        uint256 u = uint256(neg ? -x : x);
        uint256 unit = 10 ** dec;
        string memory s = vm.toString(u / unit);
        if (show > 0) {
            uint256 frac = (u % unit) / 10 ** (dec - show);
            string memory f = vm.toString(frac);
            while (bytes(f).length < show) f = string.concat("0", f);
            s = string.concat(s, ".", f);
        }
        return neg ? string.concat("-", s) : s;
    }

    // ------------------------------------------------------------------------------------------------ tests

    /// Real scenario: REPLAY_INPUT=<backend/data/replay/<id>.input.json>. Skipped unless set (`pnpm replay <id>`).
    function test_replay_scenario() public {
        string memory inPath = vm.envOr("REPLAY_INPUT", string(""));
        if (bytes(inPath).length == 0) vm.skip(true);
        string memory j = vm.readFile(inPath);
        uint256[] memory ts = vm.parseJsonUintArray(j, ".ts");
        uint256[] memory oRaw = vm.parseJsonUintArray(j, ".oracle");
        _init(uint64(oRaw[0]), uint8(vm.parseJsonUint(j, ".szDecimals")));
        Opts memory o = Opts({
            arb: true,
            retail: true,
            csvPath: vm.envString("REPLAY_CSV"),
            summaryPath: vm.envString("REPLAY_SUMMARY"),
            scenario: vm.parseJsonString(j, ".scenario"),
            interval: vm.parseJsonString(j, ".interval"),
            lagSec: vm.parseJsonUint(j, ".lagSec")
        });
        Result[4] memory r = _run(
            ts,
            oRaw,
            vm.parseJsonUintArray(j, ".mark"),
            vm.parseJsonUintArray(j, ".oracleLag"),
            vm.parseJsonUintArray(j, ".markLag"),
            o
        );
        for (uint256 i; i < 4; i++) {
            emit log_named_int(string.concat(NAMES[i], " LP value - HODL (wad USD)"), r[i].lpValue - r[i].hodlValue);
        }
    }

    function _flat(uint256 n, uint256 px) internal pure returns (uint256[] memory ts, uint256[] memory v) {
        ts = new uint256[](n);
        v = new uint256[](n);
        for (uint256 k; k < n; k++) {
            ts[k] = 1_800_000_000 + k * 300;
            v[k] = px;
        }
    }

    /// Sanity (P8): zero price movement and no retail -> nobody trades, every pool's LP value equals HODL.
    function test_sanity_flatNoRetail_zeroLvr() public {
        (uint256[] memory ts, uint256[] memory v) = _flat(20, 940_000);
        _init(940_000, 2);
        Opts memory o = Opts(true, false, "", "", "flat", "5m", 60);
        Result[4] memory r = _run(ts, v, v, v, v, o);
        for (uint256 i; i < 4; i++) {
            assertEq(r[i].arbTrades, 0);
            assertEq(r[i].feesValue, 0);
            int256 lvr = r[i].hodlValue - r[i].lpValue;
            assertLe(lvr < 0 ? -lvr : lvr, 1e12, "flat market must give LVR ~ 0 (rounding only)");
        }
    }

    /// Sanity (P8): zero price movement, retail on -> pools differ only by fees; identical retail flow, so the 0.30%
    /// pool earns 6x the 0.05% pool's fees, and the arb only undoes retail pushes.
    function test_sanity_flatWithRetail_differOnlyByFees() public {
        (uint256[] memory ts, uint256[] memory v) = _flat(40, 940_000);
        _init(940_000, 2);
        Opts memory o = Opts(false, true, "", "", "flat", "5m", 60);
        Result[4] memory r = _run(ts, v, v, v, v, o);
        assertEq(r[0].retailTrades, r[1].retailTrades);
        for (uint256 i; i < 4; i++) {
            // both tokens collected fees (retail trades both directions) ...
            assertGt(pools[i].fees0, 0, "no token0 fees collected");
            assertGt(pools[i].fees1, 0, "no token1 fees collected");
            // ... and the collected value equals the independently expected fees (v4 rounds fee growth down)
            uint256 expected = pools[i].expectedRetailFeeValue;
            assertLe(uint256(r[i].feesValue), expected + 1e12);
            assertApproxEqRel(uint256(r[i].feesValue), expected, 1e14, "collected fees != expected retail fees (0.01%)");
        }
        assertGt(r[1].feesValue, r[0].feesValue * 5);
        assertLt(r[1].feesValue, r[0].feesValue * 7);
        // both Aven pools see the same (flat) price, so they behave identically
        assertEq(r[2].feesValue, r[3].feesValue);
        assertEq(r[2].lpValue, r[3].lpValue);
    }
}

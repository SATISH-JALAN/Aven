// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AvenFairValue as FV} from "src/AvenFairValue.sol";
import {MockHyperCorePx} from "test/mocks/MockHyperCorePx.sol";

/// @dev External wrappers so tests can use vm.expectRevert and call the internal library functions.
contract FVHarness {
    function defaultParams() external pure returns (FV.Params memory) {
        return FV.defaultParams();
    }

    function validateParams(FV.Config memory c, FV.Params memory p) external pure {
        FV.validateParams(c, p);
    }

    function readPrices(uint32 idx, uint256 gasCap) external view returns (bool, uint64, uint64) {
        return FV.readPrices(idx, gasCap);
    }

    function oracleWad(FV.Config memory c, uint64 raw) external pure returns (uint256) {
        return FV.oracleWad(c, raw);
    }

    function poolWad(FV.Config memory c, uint160 sp) external pure returns (uint256) {
        return FV.poolWad(c, sp);
    }

    function compute(FV.Config memory c, FV.Params memory p, FV.Inputs memory i)
        external
        pure
        returns (FV.Breakdown memory)
    {
        return FV.compute(c, p, i);
    }

    function advanceAnchor(uint64 m, uint40 t, uint64 mark, uint40 nowTs, uint32 tau)
        external
        pure
        returns (uint64, uint40)
    {
        return FV.advanceAnchor(m, t, mark, nowTs, tau);
    }
}

/// @notice Unit + fuzz tests for AvenFairValue (ARCHITECTURE §6.2-§6.4, PLAN 1.1).
contract AvenFairValueTest is Test {
    FVHarness h;
    uint160 constant Q96 = uint160(2 ** 96);
    address constant MARK = 0x0000000000000000000000000000000000000806;
    address constant ORACLE = 0x0000000000000000000000000000000000000807;

    function setUp() public {
        h = new FVHarness();
    }

    // ---------------------------------------------------------------- helpers

    /// szDecimals 0 (raw 1_000_000 == price 1.0), both tokens 18 decimals.
    function _cfg(bool baseIsToken0) internal pure returns (FV.Config memory) {
        return FV.Config({perpIndex: 0, szDecimals: 0, baseIsToken0: baseIsToken0, decimals0: 18, decimals1: 18});
    }

    function _inp(uint64 oracle, uint64 mark, uint64 anchor, uint160 sp, uint160 top, bool zeroForOne)
        internal
        pure
        returns (FV.Inputs memory)
    {
        return FV.Inputs({
            oracleRaw: oracle,
            markRaw: mark,
            anchorMarkRaw: anchor,
            sqrtPriceX96: sp,
            sqrtPriceTopX96: top,
            zeroForOne: zeroForOne,
            readOk: true
        });
    }

    /// Inverse of poolWad (used by tests and, later, CreatePools): sqrtPriceX96 for a wad price.
    function _sqrtFromWad(FV.Config memory c, uint256 wad) internal pure returns (uint160) {
        uint256 q192 = uint256(2 ** 192);
        uint256 x = c.baseIsToken0
            ? FullMath.mulDiv(wad * 10 ** uint256(c.decimals1), q192, 10 ** (18 + uint256(c.decimals0)))
            : FullMath.mulDiv(10 ** (18 + uint256(c.decimals1)), q192, wad * 10 ** uint256(c.decimals0));
        return uint160(Math.sqrt(x));
    }

    function _etch(address at) internal returns (MockHyperCorePx m) {
        vm.etch(at, address(new MockHyperCorePx()).code);
        m = MockHyperCorePx(at);
    }

    // ---------------------------------------------------------------- §6.2 defaults + validation

    function test_defaultParams() public view {
        FV.Params memory p = h.defaultParams();
        assertEq(p.baseFee, 500);
        assertEq(p.minFee, 500);
        assertEq(p.maxFee, 10_000);
        assertEq(p.fallbackFee, 3_000);
        assertEq(p.gapWeight, 50);
        assertEq(p.premiumWeight, 50);
        assertEq(p.stressThresholdBps, 50);
        assertEq(p.stressWeight, 20);
        assertEq(p.stressTauSec, 60);
        assertEq(p.maxGapBps, 2_000);
        assertEq(p.precompileGas, 30_000);
        h.validateParams(_cfg(true), p); // defaults are valid
    }

    function _expectInvalid(FV.Config memory c, FV.Params memory p) internal {
        vm.expectRevert(FV.InvalidParams.selector);
        h.validateParams(c, p);
    }

    function test_validateParams_eachRuleRejects() public {
        FV.Config memory c = _cfg(true);
        FV.Params memory p;

        p = h.defaultParams();
        p.minFee = 600; // minFee > baseFee
        _expectInvalid(c, p);
        p = h.defaultParams();
        p.baseFee = 10_001; // baseFee > maxFee
        _expectInvalid(c, p);
        p = h.defaultParams();
        p.fallbackFee = 400; // fallbackFee < minFee
        _expectInvalid(c, p);
        p = h.defaultParams();
        p.fallbackFee = 10_001; // fallbackFee > maxFee
        _expectInvalid(c, p);
        p = h.defaultParams();
        p.maxFee = 100_001; // maxFee > 100_000
        p.fallbackFee = 3_000;
        _expectInvalid(c, p);
        p = h.defaultParams();
        p.stressTauSec = 0;
        _expectInvalid(c, p);
        p = h.defaultParams();
        p.maxGapBps = 0;
        _expectInvalid(c, p);
        p = h.defaultParams();
        p.precompileGas = 9_999;
        _expectInvalid(c, p);

        p = h.defaultParams();
        c.szDecimals = 7;
        _expectInvalid(c, p);
        c = _cfg(true);
        c.decimals0 = 19;
        _expectInvalid(c, p);
        c = _cfg(true);
        c.decimals1 = 19;
        _expectInvalid(c, p);
    }

    function test_validateParams_boundariesAccepted() public view {
        FV.Config memory c = _cfg(false);
        c.szDecimals = 6;
        c.decimals0 = 18;
        c.decimals1 = 0;
        FV.Params memory p = h.defaultParams();
        p.maxFee = 100_000;
        p.precompileGas = 10_000;
        p.minFee = 500;
        p.baseFee = 500;
        p.fallbackFee = 500; // == minFee is allowed
        h.validateParams(c, p);
        p.fallbackFee = 100_000; // == maxFee is allowed
        h.validateParams(c, p);
    }

    // ---------------------------------------------------------------- §6.3 Step 1: reads

    function test_readPrices_ok() public {
        _etch(ORACLE).set(4, 224_002);
        _etch(MARK).set(4, 224_839);
        (bool ok, uint64 o, uint64 m) = h.readPrices(4, 30_000);
        assertTrue(ok);
        assertEq(o, 224_002);
        assertEq(m, 224_839);
    }

    function test_readPrices_noCodeLocally_isFailedRead() public view {
        (bool ok, uint64 o, uint64 m) = h.readPrices(4, 30_000);
        assertFalse(ok);
        assertEq(o, 0);
        assertEq(m, 0);
    }

    function test_readPrices_failureModes() public {
        MockHyperCorePx o = _etch(ORACLE);
        MockHyperCorePx m = _etch(MARK);
        o.set(4, 100);
        m.set(4, 100);

        m.setFail(true); // revert
        (bool ok,,) = h.readPrices(4, 30_000);
        assertFalse(ok);
        m.setFail(false);

        m.setEmpty(true); // 0 bytes
        (ok,,) = h.readPrices(4, 30_000);
        assertFalse(ok);
        m.setEmpty(false);

        m.setOverflow(true); // word > uint64 max: failed read, NOT a revert
        (ok,,) = h.readPrices(4, 30_000);
        assertFalse(ok);
        m.setOverflow(false);

        m.set(4, 0); // zero price
        (ok,,) = h.readPrices(4, 30_000);
        assertFalse(ok);
        m.set(4, 100);

        o.setFail(true); // one side only
        (bool ok2, uint64 oRaw, uint64 mRaw) = h.readPrices(4, 30_000);
        assertFalse(ok2);
        assertEq(oRaw, 0);
        assertEq(mRaw, 100); // the good side is still reported
    }

    /// A precompile that burns gas costs the caller exactly the cap more than a normal read, never "all gas".
    function test_readPrices_burnIsCapped() public {
        MockHyperCorePx o = _etch(ORACLE);
        _etch(MARK).set(4, 100);
        o.set(4, 100);
        uint256 g = gasleft();
        (bool okNormal,,) = h.readPrices(4, 30_000);
        uint256 usedNormal = g - gasleft();
        assertTrue(okNormal);

        o.setBurn(true);
        g = gasleft();
        (bool ok,,) = h.readPrices(4, 30_000);
        uint256 used = g - gasleft();
        assertFalse(ok);
        assertLe(used, usedNormal + 30_000); // bounded by the cap
        assertGt(used, 30_000); // and the cap really was consumed
    }

    // ---------------------------------------------------------------- §6.3 Step 3: scaling

    function test_oracleWad_scaling() public view {
        FV.Config memory c = _cfg(true);
        c.szDecimals = 0;
        assertEq(h.oracleWad(c, 1_000_000), 1e18); // 1.0
        c.szDecimals = 2;
        assertEq(h.oracleWad(c, 785_950), 78.595e18); // HYPE-like 78.5950
        c.szDecimals = 4;
        assertEq(h.oracleWad(c, 224_002), 2240.02e18); // testnet ETH 2240.02 (recon C.6)
        c.szDecimals = 5;
        assertEq(h.oracleWad(c, 759_471), 75947.1e18); // BTC-like 75947.1
    }

    function test_poolWad_atQ96_isOneBothOrders() public view {
        assertEq(h.poolWad(_cfg(true), Q96), 1e18);
        assertEq(h.poolWad(_cfg(false), Q96), 1e18);
    }

    function test_poolWad_roundTrip_base18_quote6() public view {
        // aETH (18 dec) = token0 = base; aUSD (6 dec) = token1 = quote.
        FV.Config memory c = FV.Config({perpIndex: 4, szDecimals: 4, baseIsToken0: true, decimals0: 18, decimals1: 6});
        uint256 want = h.oracleWad(c, 224_002);
        uint256 got = h.poolWad(c, _sqrtFromWad(c, want));
        assertApproxEqRel(got, want, 1e14); // within 1 bp
    }

    function test_poolWad_roundTrip_base18_asToken1_quote6() public view {
        // aUSD (6 dec) = token0 = quote; aETH (18 dec) = token1 = base.
        FV.Config memory c = FV.Config({perpIndex: 4, szDecimals: 4, baseIsToken0: false, decimals0: 6, decimals1: 18});
        uint256 want = h.oracleWad(c, 224_002);
        uint256 got = h.poolWad(c, _sqrtFromWad(c, want));
        assertApproxEqRel(got, want, 1e14);
    }

    // ---------------------------------------------------------------- §6.3 worked example

    /// Pool 1.50% above oracle, mark 0.20% below oracle, mark moved 0.30% vs anchor (base = token0).
    /// Numbers: pool price 1.0 (sqrtP = Q96); oracle raw 985,221 -> gap floor(14,779e4/985,221) = 150 bp;
    /// mark 983,250 -> premium trunc(-19,710,000/985,221) = -20 bp; anchor 980,309 -> move floor(29,410,000/980,309) = 30.
    function test_workedExample_sellerPays9000_buyerPays500() public view {
        FV.Params memory p = h.defaultParams();
        FV.Breakdown memory s = h.compute(_cfg(true), p, _inp(985_221, 983_250, 980_309, Q96, Q96, true));
        assertEq(s.gapBps, 150);
        assertEq(s.premiumBps, -20);
        assertEq(s.moveBps, 30);
        assertTrue(s.arb);
        assertTrue(s.withPressure);
        assertEq(s.fee, 9_000); // 500 + 150*50 + 20*50 + 0
        assertEq(uint8(s.reason), uint8(FV.Reason.OK));

        FV.Breakdown memory b = h.compute(_cfg(true), p, _inp(985_221, 983_250, 980_309, Q96, Q96, false));
        assertFalse(b.arb);
        assertFalse(b.withPressure);
        assertEq(b.fee, 500);
    }

    // ---------------------------------------------------------------- each signal alone

    function test_signalAlone_gap() public view {
        FV.Breakdown memory b = h.compute(_cfg(true), h.defaultParams(), _inp(985_221, 985_221, 0, Q96, Q96, true));
        assertEq(b.premiumBps, 0);
        assertEq(b.moveBps, 0);
        assertEq(b.fee, 500 + 150 * 50);
    }

    function test_signalAlone_premium() public view {
        // Pool exactly at fair (1.0), mark +0.20%.
        FV.Breakdown memory buy =
            h.compute(_cfg(true), h.defaultParams(), _inp(1_000_000, 1_002_000, 0, Q96, Q96, false));
        assertEq(buy.gapBps, 0);
        assertFalse(buy.arb);
        assertEq(buy.premiumBps, 20);
        assertTrue(buy.withPressure); // buying base with positive premium
        assertEq(buy.fee, 500 + 20 * 50);
        FV.Breakdown memory sell =
            h.compute(_cfg(true), h.defaultParams(), _inp(1_000_000, 1_002_000, 0, Q96, Q96, true));
        assertFalse(sell.withPressure);
        assertEq(sell.fee, 500);
    }

    function test_signalAlone_stress() public view {
        // At fair, no premium, mark moved 0.80% vs anchor: floor(7,937e4 / 992,063) = 80 -> (80 - 50) * 20 = 600.
        FV.Breakdown memory b =
            h.compute(_cfg(true), h.defaultParams(), _inp(1_000_000, 1_000_000, 992_063, Q96, Q96, true));
        assertEq(b.moveBps, 80);
        assertEq(b.fee, 500 + 30 * 20);
    }

    function test_stressThreshold_exactIsNotStress() public view {
        // move exactly 50 bp -> no stress; 51 -> 20 pips.
        FV.Breakdown memory b =
            h.compute(_cfg(true), h.defaultParams(), _inp(1_000_000, 1_005_000, 1_000_000, Q96, Q96, true));
        assertEq(b.moveBps, 50);
        assertEq(b.fee, 500);
        b = h.compute(_cfg(true), h.defaultParams(), _inp(1_000_000, 1_005_100, 1_000_000, Q96, Q96, true));
        assertEq(b.moveBps, 51);
        assertEq(b.fee, 500 + 20);
    }

    // ---------------------------------------------------------------- §6.3 Step 5 direction matrix

    /// For both token orders: pool above fair -> selling base is arb; pool below fair -> buying base is arb.
    function test_directionMatrix() public view {
        FV.Params memory p = h.defaultParams();
        for (uint256 order; order < 2; order++) {
            bool base0 = order == 0;
            FV.Config memory c = _cfg(base0);
            // pool (1.0) ABOVE fair: oracle 0.985221
            bool sellZ = base0; // zeroForOne value that sells base
            FV.Breakdown memory aboveSell = h.compute(c, p, _inp(985_221, 985_221, 0, Q96, Q96, sellZ));
            FV.Breakdown memory aboveBuy = h.compute(c, p, _inp(985_221, 985_221, 0, Q96, Q96, !sellZ));
            assertTrue(aboveSell.arb);
            assertFalse(aboveBuy.arb);
            assertEq(aboveSell.fee, 500 + aboveSell.gapBps * 50);
            assertEq(aboveBuy.fee, 500);
            // pool (1.0) BELOW fair: oracle 1.015
            FV.Breakdown memory belowSell = h.compute(c, p, _inp(1_015_000, 1_015_000, 0, Q96, Q96, sellZ));
            FV.Breakdown memory belowBuy = h.compute(c, p, _inp(1_015_000, 1_015_000, 0, Q96, Q96, !sellZ));
            assertFalse(belowSell.arb);
            assertTrue(belowBuy.arb);
            assertEq(belowBuy.gapBps, 147); // floor(150e14 * 1e4 / 1.015e18)
            assertEq(belowBuy.fee, 500 + 147 * 50);
            assertEq(belowSell.fee, 500);
        }
    }

    // ---------------------------------------------------------------- §6.3 Step 4 top-of-block anchor

    function test_topOfBlock_sameSide_usesMax() public view {
        uint160 top = uint160(uint256(Q96) * 10_005 / 10_000); // price ~1.001: further above fair, fee stays under the cap
        FV.Breakdown memory b = h.compute(_cfg(true), h.defaultParams(), _inp(985_221, 985_221, 0, Q96, top, true));
        uint256 oWad = h.oracleWad(_cfg(true), 985_221);
        uint256 gapTop = FullMath.mulDiv(h.poolWad(_cfg(true), top) - oWad, 10_000, oWad);
        assertGt(gapTop, 150);
        assertEq(b.gapBps, gapTop);
        assertLt(500 + gapTop * 50, 10_000);
        assertEq(b.fee, 500 + gapTop * 50);
    }

    function test_topOfBlock_oppositeSide_usesCurrent() public view {
        uint160 top = uint160(uint256(Q96) * 970 / 1000); // price ~0.941, below fair
        FV.Breakdown memory b = h.compute(_cfg(true), h.defaultParams(), _inp(985_221, 985_221, 0, Q96, top, true));
        assertEq(b.gapBps, 150);
    }

    function test_topOfBlock_sameSideSmallerTop_usesCurrent() public view {
        uint160 top = uint160(uint256(Q96) * 9995 / 10000); // still above fair but closer
        FV.Breakdown memory b = h.compute(_cfg(true), h.defaultParams(), _inp(985_221, 985_221, 0, Q96, top, true));
        assertEq(b.gapBps, 150);
    }

    function test_atFair_noArbEitherWay() public view {
        uint160 top = uint160(uint256(Q96) * 1015 / 1000); // top far away must not matter at fair
        for (uint256 d; d < 2; d++) {
            FV.Breakdown memory b =
                h.compute(_cfg(true), h.defaultParams(), _inp(1_000_000, 1_000_000, 0, Q96, top, d == 0));
            assertEq(b.gapBps, 0);
            assertFalse(b.arb);
            assertEq(b.fee, 500);
        }
    }

    // ---------------------------------------------------------------- clamps and fallbacks

    function test_clampAtCeiling() public view {
        // gap ~990 bp, arb: 500 + 990*50 > 10,000 -> 10,000.
        FV.Breakdown memory b = h.compute(_cfg(true), h.defaultParams(), _inp(910_000, 910_000, 0, Q96, Q96, true));
        assertGt(b.gapBps, 900);
        assertEq(b.fee, 10_000);
        assertEq(uint8(b.reason), uint8(FV.Reason.OK));
    }

    function test_neverBelowFloor() public view {
        FV.Params memory p = h.defaultParams();
        p.minFee = 100;
        p.baseFee = 100;
        FV.Breakdown memory b = h.compute(_cfg(true), p, _inp(1_000_000, 1_000_000, 0, Q96, Q96, true));
        assertEq(b.fee, 100);
    }

    function test_readFailed_fallback() public view {
        FV.Inputs memory i = _inp(985_221, 983_250, 980_309, Q96, Q96, true);
        i.readOk = false;
        FV.Breakdown memory b = h.compute(_cfg(true), h.defaultParams(), i);
        assertEq(b.fee, 3_000);
        assertEq(uint8(b.reason), uint8(FV.Reason.READ_FAILED));
        assertEq(b.gapBps, 0);
        assertEq(b.premiumBps, 0);
        assertEq(b.moveBps, 0);
        assertFalse(b.arb);
        assertFalse(b.withPressure);
    }

    function test_gapTooLarge_fallback_reportsGap() public view {
        // pool 1.0 vs oracle 0.80 -> gap 2500 bp > 2000.
        FV.Breakdown memory b = h.compute(_cfg(true), h.defaultParams(), _inp(800_000, 800_000, 0, Q96, Q96, true));
        assertEq(b.gapBps, 2_500);
        assertEq(b.fee, 3_000);
        assertEq(uint8(b.reason), uint8(FV.Reason.GAP_TOO_LARGE));
        assertFalse(b.arb);
    }

    function test_gapEqualToMax_isOk() public view {
        FV.Params memory p = h.defaultParams();
        p.maxGapBps = 150;
        FV.Breakdown memory b = h.compute(_cfg(true), p, _inp(985_221, 985_221, 0, Q96, Q96, true));
        assertEq(uint8(b.reason), uint8(FV.Reason.OK));
        p.maxGapBps = 149;
        b = h.compute(_cfg(true), p, _inp(985_221, 985_221, 0, Q96, Q96, true));
        assertEq(uint8(b.reason), uint8(FV.Reason.GAP_TOO_LARGE));
    }

    // ---------------------------------------------------------------- §6.4 anchor

    function test_anchor_firstUpdateSnaps() public view {
        (uint64 m, uint40 t) = h.advanceAnchor(0, 0, 1_234, 1_000, 60);
        assertEq(m, 1_234);
        assertEq(t, 1_000);
    }

    function test_anchor_dtZeroUnchanged() public view {
        (uint64 m, uint40 t) = h.advanceAnchor(1_000, 500, 9_999, 500, 60);
        assertEq(m, 1_000);
        assertEq(t, 500);
    }

    function test_anchor_dtAtLeastTauSnaps() public view {
        (uint64 m,) = h.advanceAnchor(1_000, 500, 1_600, 560, 60);
        assertEq(m, 1_600);
        (m,) = h.advanceAnchor(1_000, 500, 1_600, 10_000, 60);
        assertEq(m, 1_600);
    }

    function test_anchor_partialMovesProportionally() public view {
        (uint64 m, uint40 t) = h.advanceAnchor(1_000, 500, 1_600, 530, 60); // up: 1000 + 600*30/60
        assertEq(m, 1_300);
        assertEq(t, 530);
        (m,) = h.advanceAnchor(1_600, 500, 1_000, 520, 60); // down: 1600 - 600*20/60
        assertEq(m, 1_400);
    }

    function test_anchor_truncatesTowardZero() public view {
        // (99 - 100) * 30 / 60 = -0.5 -> 0 (toward zero), not -1 (floor).
        (uint64 m,) = h.advanceAnchor(100, 500, 99, 530, 60);
        assertEq(m, 100);
        // (101 - 100) * 30 / 60 = 0.5 -> 0.
        (m,) = h.advanceAnchor(100, 500, 101, 530, 60);
        assertEq(m, 100);
    }

    // ---------------------------------------------------------------- fuzz

    /// Fuzz bounds (documented): szDecimals 0..6, token decimals 0..18, any valid Params (fees <= 100_000,
    /// weights/thresholds any uint32, tau >= 1, maxGap >= 1), prices 1..2^64-1, anchor 0..2^64-1,
    /// sqrt prices within [MIN_SQRT_PRICE, MAX_SQRT_PRICE). Asserts: never reverts; I2.
    struct FuzzCfg {
        uint8 sz;
        uint8 d0;
        uint8 d1;
        bool base0;
    }

    struct FuzzIn {
        uint64 oracle;
        uint64 mark;
        uint64 anchor;
        uint160 sp;
        uint160 top;
        bool zeroForOne;
        bool readOk;
    }

    function _fuzzCfg(FuzzCfg memory x) internal pure returns (FV.Config memory) {
        return FV.Config({
            perpIndex: 0,
            szDecimals: uint8(bound(x.sz, 0, 6)),
            baseIsToken0: x.base0,
            decimals0: uint8(bound(x.d0, 0, 18)),
            decimals1: uint8(bound(x.d1, 0, 18))
        });
    }

    /// Sort four fees into minFee <= {baseFee, fallbackFee} <= maxFee, all <= 100_000.
    function _fuzzParams(uint24[4] memory fees, uint32[7] memory w) internal pure returns (FV.Params memory p) {
        uint256[4] memory f;
        for (uint256 i; i < 4; i++) {
            f[i] = bound(fees[i], 0, 100_000);
        }
        for (uint256 i; i < 4; i++) {
            for (uint256 j = i + 1; j < 4; j++) {
                if (f[j] < f[i]) (f[i], f[j]) = (f[j], f[i]);
            }
        }
        p.minFee = uint24(f[0]);
        p.baseFee = uint24(f[1]);
        p.fallbackFee = uint24(f[2]);
        p.maxFee = uint24(f[3]);
        p.gapWeight = w[0];
        p.premiumWeight = w[1];
        p.stressThresholdBps = w[2];
        p.stressWeight = w[3];
        p.stressTauSec = uint32(bound(w[4], 1, type(uint32).max));
        p.maxGapBps = uint32(bound(w[5], 1, type(uint32).max));
        p.precompileGas = uint32(bound(w[6], 10_000, type(uint32).max));
    }

    function _fuzzIn(FuzzIn memory x) internal pure returns (FV.Inputs memory) {
        return FV.Inputs({
            oracleRaw: uint64(bound(x.oracle, 1, type(uint64).max)),
            markRaw: uint64(bound(x.mark, 1, type(uint64).max)),
            anchorMarkRaw: x.anchor,
            sqrtPriceX96: uint160(bound(x.sp, TickMath.MIN_SQRT_PRICE, TickMath.MAX_SQRT_PRICE - 1)),
            sqrtPriceTopX96: uint160(bound(x.top, TickMath.MIN_SQRT_PRICE, TickMath.MAX_SQRT_PRICE - 1)),
            zeroForOne: x.zeroForOne,
            readOk: x.readOk
        });
    }

    /// Fuzz bounds (documented): szDecimals 0..6, token decimals 0..18, any valid Params (fees <= 100_000,
    /// weights/thresholds any uint32, tau >= 1, maxGap >= 1, gas >= 10_000), prices 1..2^64-1, anchor 0..2^64-1,
    /// sqrt prices within [MIN_SQRT_PRICE, MAX_SQRT_PRICE). Asserts: never reverts; I2.
    function testFuzz_compute_neverRevertsAndI2(
        FuzzCfg memory xc,
        uint24[4] memory fees,
        uint32[7] memory w,
        FuzzIn memory xi
    ) public view {
        FV.Config memory c = _fuzzCfg(xc);
        FV.Params memory p = _fuzzParams(fees, w);
        h.validateParams(c, p);
        FV.Breakdown memory b = h.compute(c, p, _fuzzIn(xi)); // must not revert
        if (b.reason == FV.Reason.OK) {
            assertGe(b.fee, p.minFee);
            assertLe(b.fee, p.maxFee);
        } else {
            assertEq(b.fee, p.fallbackFee);
        }
        if (!xi.readOk) assertEq(uint8(b.reason), uint8(FV.Reason.READ_FAILED));
    }

    /// Default params over realistic ETH-like ranges: I2 holds and arb never pays less than the reverse direction.
    function testFuzz_defaults_arbPaysAtLeastReverse(uint64 oracle, uint64 mark, uint64 anchor, uint160 sp)
        public
        view
    {
        FV.Config memory c = FV.Config({perpIndex: 4, szDecimals: 4, baseIsToken0: true, decimals0: 18, decimals1: 6});
        FV.Params memory p = h.defaultParams();
        oracle = uint64(bound(oracle, 100_000, 400_000)); // $1,000 .. $4,000
        mark = uint64(bound(mark, oracle * 99 / 100, oracle * 101 / 100));
        anchor = uint64(bound(anchor, 0, 400_000));
        uint256 want = h.oracleWad(c, oracle);
        uint160 fair = _sqrtFromWad(c, want);
        sp = uint160(bound(sp, uint256(fair) * 95 / 100, uint256(fair) * 105 / 100));
        FV.Breakdown memory s = h.compute(c, p, _inp(oracle, mark, anchor, sp, sp, true));
        FV.Breakdown memory b = h.compute(c, p, _inp(oracle, mark, anchor, sp, sp, false));
        for (uint256 k; k < 2; k++) {
            FV.Breakdown memory x = k == 0 ? s : b;
            if (x.reason == FV.Reason.OK) {
                assertGe(x.fee, p.minFee);
                assertLe(x.fee, p.maxFee);
            } else {
                assertEq(x.fee, p.fallbackFee);
            }
        }
        if (s.reason == FV.Reason.OK && s.arb && s.premiumBps == 0) assertGe(s.fee, b.fee);
        if (b.reason == FV.Reason.OK && b.arb && b.premiumBps == 0) assertGe(b.fee, s.fee);
    }

    /// Anchor: never reverts for now >= anchorTime, result is between anchor and mark (or snaps to mark).
    function testFuzz_advanceAnchor_bounded(uint64 a, uint40 t, uint64 mark, uint40 nowTs, uint32 tau) public view {
        tau = uint32(bound(tau, 1, type(uint32).max));
        nowTs = uint40(bound(nowTs, t, type(uint40).max));
        (uint64 m, uint40 nt) = h.advanceAnchor(a, t, mark, nowTs, tau);
        assertEq(nt, nowTs);
        if (t == 0 || uint256(nowTs) - t >= tau) {
            assertEq(m, mark);
        } else {
            uint64 lo = a < mark ? a : mark;
            uint64 hi = a < mark ? mark : a;
            assertGe(m, lo);
            assertLe(m, hi);
        }
    }
}

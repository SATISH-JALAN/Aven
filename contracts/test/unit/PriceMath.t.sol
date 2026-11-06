// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {AvenFairValue as FV} from "src/AvenFairValue.sol";
import {PriceMath} from "test/utils/PriceMath.sol";

/// @notice CreatePools initialises pools at sqrtPriceFromWad(oracleWad); P5 requires poolWad(sqrtP) within 1 bp of
/// oracleWad for both token orders (PLAN 3.1).
contract PriceMathTest is Test {
    function _check(FV.Config memory c, uint64 raw) internal pure {
        uint256 want = FV.oracleWad(c, raw);
        uint160 sp = PriceMath.sqrtPriceFromWad(c, want);
        assertGt(sp, TickMath.MIN_SQRT_PRICE);
        assertLt(sp, TickMath.MAX_SQRT_PRICE);
        uint256 got = FV.poolWad(c, sp);
        uint256 diff = got > want ? got - want : want - got;
        assertLe(diff * 10_000, want, "initial pool price not within 1 bp of the oracle");
    }

    /// Testnet-ETH-like: szDecimals 4, $10 .. $100,000, both token orders, 18/6 and 6/18 decimals.
    function testFuzz_initialPriceWithin1bp_ethLike(uint64 raw, bool base0) public pure {
        raw = uint64(bound(raw, 1_000, 10_000_000));
        FV.Config memory c = base0
            ? FV.Config({perpIndex: 4, szDecimals: 4, baseIsToken0: true, decimals0: 18, decimals1: 6})
            : FV.Config({perpIndex: 4, szDecimals: 4, baseIsToken0: false, decimals0: 6, decimals1: 18});
        _check(c, raw);
    }

    /// Any szDecimals, equal 18/18 decimals, broad price range.
    function testFuzz_initialPriceWithin1bp_generic(uint64 raw, uint8 sz, bool base0) public pure {
        sz = uint8(bound(sz, 0, 6));
        raw = uint64(bound(raw, 100, 1e12));
        _check(FV.Config({perpIndex: 0, szDecimals: sz, baseIsToken0: base0, decimals0: 18, decimals1: 18}), raw);
    }

    function test_initialPrice_testnetEthSample() public pure {
        _check(FV.Config({perpIndex: 4, szDecimals: 4, baseIsToken0: true, decimals0: 18, decimals1: 6}), 224_002);
        _check(FV.Config({perpIndex: 4, szDecimals: 4, baseIsToken0: false, decimals0: 6, decimals1: 18}), 224_002);
    }
}

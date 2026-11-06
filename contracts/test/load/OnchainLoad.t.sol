// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {AvenFairValue as FV} from "src/AvenFairValue.sol";
import {AvenTestBase} from "test/utils/AvenTestBase.sol";

/// @notice PLAN 7.1 on-chain load (Foundry part). BLOCKS blocks with 1..MAX_PER_BLOCK Aven swaps each (both directions,
/// exact-in and exact-out, mixed sizes), a price/premium move every block and a burst of broken reads (revert, burn,
/// empty, overflow) on ~15% of blocks. Checks every swap (no revert, I2, I3) and every block (one top-of-block price,
/// one anchor per timestamp) and records the per-swap gas distribution and per-block hook gas vs the 3M small block.
/// Runs only with LOAD=1 (`pnpm loadtest:onchain`); writes backend/data/load/onchain.json.
contract OnchainLoadTest is AvenTestBase {
    uint256 constant BLOCKS = 250;
    uint256 constant MAX_PER_BLOCK = 16;
    uint256 constant SMALL_BLOCK_GAS = 3_000_000;

    uint256[] swapGas;
    uint256[] blockGas;
    uint256 swaps;
    uint256 reverts;
    uint256 feeViolations;
    uint256 zeroFee;
    uint256 topViolations;
    uint256 anchorViolations;
    uint256 fallbacks;
    uint256 brokenSwaps;
    uint256 maxPerBlockSeen;

    function setUp() public {
        _setUpAven(true);
    }

    function _rand(uint256 a, uint256 b) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(0x4c4f4144, a, b)));
    }

    function test_onchainLoad() public {
        if (!vm.envOr("LOAD", false)) vm.skip(true);
        vm.pauseGasMetering(); // harness bookkeeping is unmetered; each swap resumes metering (see _doSwap)
        for (uint256 blk; blk < BLOCKS; blk++) {
            nextBlock(1 + _rand(blk, 0) % 3);
            // market move: oracle +-4% around the start, mark +-0.8% around the oracle
            uint256 r = _rand(blk, 1);
            uint64 o = uint64(uint256(ORACLE0) * (9_600 + r % 801) / 10_000);
            uint64 m = uint64(uint256(o) * (9_920 + (r >> 16) % 161) / 10_000);
            setOracle(o);
            setMark(m);
            bool broken = (r >> 32) % 100 < 15;
            uint256 mode = (r >> 40) % 4;
            _setBroken(broken, mode, (r >> 48) & 1 == 1);
            uint256 n = 1 + (r >> 56) % MAX_PER_BLOCK;
            if (n > maxPerBlockSeen) maxPerBlockSeen = n;
            uint256 gasThisBlock;
            uint160 top;
            uint64 anchorSeen;
            for (uint256 i; i < n; i++) {
                (bool ok, uint256 g, SwapLog memory s) = _oneSwap(_rand(blk, 100 + i));
                if (!ok) continue;
                gasThisBlock += g;
                if (broken) brokenSwaps++;
                // FeeComputed.anchorMarkRaw is the anchor BEFORE this swap's update (section 6.4). The first swap of a block reports
                // the previous anchor and advances it (dt > 0); every later swap in the same block/timestamp has dt = 0, so all
                // of them must report the same, already-advanced anchor.
                if (i == 0) {
                    top = s.sqrtPriceTopX96;
                } else {
                    if (s.sqrtPriceTopX96 != top) topViolations++; // one top-of-block price per block
                    if (i == 1) anchorSeen = s.anchorMarkRaw;
                    else if (s.anchorMarkRaw != anchorSeen) anchorViolations++;
                }
            }
            blockGas.push(gasThisBlock);
        }
        _setBroken(false, 0, false);
        vm.resumeGasMetering();
        _report();
        assertEq(reverts, 0, "a swap reverted under load");
        assertEq(feeViolations, 0, "I2 violated under load");
        assertEq(zeroFee, 0, "I3 violated under load");
        assertEq(topViolations, 0, "top-of-block changed within a block");
        assertEq(anchorViolations, 0, "anchor moved again within one timestamp (dt = 0)");
    }

    function _oneSwap(uint256 r) internal returns (bool ok, uint256 g, SwapLog memory s) {
        vm.recordLogs();
        (ok, g) = _doSwap(r);
        if (!ok) {
            reverts++;
            return (false, 0, s);
        }
        swaps++;
        swapGas.push(g);
        s = _check(vm.getRecordedLogs());
    }

    /// One random swap: direction, exact-in/exact-out and size from `r`. Returns the gas used by the router call.
    function _doSwap(uint256 r) internal returns (bool ok, uint256 g) {
        bool sellBase = r & 1 == 1;
        bool exactOut = (r >> 1) % 4 == 0;
        bool zeroForOne = sellBase ? cfg.baseIsToken0 : !cfg.baseIsToken0;
        uint256 amount = (exactOut ? !sellBase : sellBase) ? 1e14 + (r >> 8) % 0.05e18 : 1e15 + (r >> 8) % 100e18;
        SwapParams memory sp = SwapParams(
            zeroForOne, exactOut ? int256(amount) : -int256(amount), zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        );
        // Metering must be ON during the swap: with it paused, a mock that burns "all gas" would loop forever.
        vm.resumeGasMetering();
        uint256 g0 = gasleft();
        try swapRouter.swap(avenKey, sp, PoolSwapTest.TestSettings(false, false), ZERO_BYTES) {
            g = g0 - gasleft();
            ok = true;
        } catch {}
        vm.pauseGasMetering();
    }

    /// I2 / I3 on one swap's logs.
    function _check(Vm.Log[] memory logs) internal returns (SwapLog memory s) {
        for (uint256 k; k < logs.length; k++) {
            if (logs[k].topics[0] == FEE_TOPIC) {
                FeeData memory f = abi.decode(logs[k].data, (FeeData));
                s.fee = f.fee;
                s.reason = f.reason;
                s.sqrtPriceTopX96 = f.sqrtPriceTopX96;
                s.anchorMarkRaw = f.anchorMarkRaw;
            } else if (logs[k].topics[0] == SWAP_TOPIC) {
                (,,,,, s.swapEventFee) = abi.decode(logs[k].data, (int128, int128, uint160, uint128, int24, uint24));
            }
        }
        if (s.swapEventFee == 0) zeroFee++;
        if (s.swapEventFee != s.fee) feeViolations++;
        if (s.reason == uint8(FV.Reason.OK)) {
            if (s.fee < prm.minFee || s.fee > prm.maxFee) feeViolations++;
        } else {
            fallbacks++;
            if (s.fee != prm.fallbackFee) feeViolations++;
        }
    }

    function _setBroken(bool on, uint256 mode, bool onOracle) internal {
        oracleMock.setFail(false);
        oracleMock.setBurn(false);
        oracleMock.setEmpty(false);
        oracleMock.setOverflow(false);
        markMock.setFail(false);
        markMock.setBurn(false);
        markMock.setEmpty(false);
        markMock.setOverflow(false);
        if (!on) return;
        if (onOracle) {
            if (mode == 0) oracleMock.setFail(true);
            else if (mode == 1) oracleMock.setBurn(true);
            else if (mode == 2) oracleMock.setEmpty(true);
            else oracleMock.setOverflow(true);
        } else {
            if (mode == 0) markMock.setFail(true);
            else if (mode == 1) markMock.setBurn(true);
            else if (mode == 2) markMock.setEmpty(true);
            else markMock.setOverflow(true);
        }
    }

    function _pct(uint256[] memory xs, uint256 p) internal pure returns (uint256) {
        // insertion sort is fine at this size (unmetered)
        for (uint256 i = 1; i < xs.length; i++) {
            uint256 v = xs[i];
            uint256 j = i;
            while (j > 0 && xs[j - 1] > v) {
                xs[j] = xs[j - 1];
                j--;
            }
            xs[j] = v;
        }
        return xs[(xs.length - 1) * p / 100];
    }

    function _report() internal {
        uint256[] memory sg = swapGas;
        uint256[] memory bg = blockGas;
        uint256 p50 = _pct(sg, 50);
        uint256 p95 = _pct(sg, 95);
        uint256 smax = sg[sg.length - 1];
        uint256 bmax = _pct(bg, 100);
        uint256 b95 = _pct(bg, 95);
        console2.log("swaps", swaps, "blocks", BLOCKS);
        console2.log("swap gas p50 / p95 / max", p50, p95, smax);
        console2.log("block total gas of the Aven swaps p95 / max", b95, bmax);
        console2.log("fallback swaps", fallbacks, "under broken reads", brokenSwaps);
        string memory o = "onchain";
        vm.serializeUint(o, "blocks", BLOCKS);
        vm.serializeUint(o, "swaps", swaps);
        vm.serializeUint(o, "maxSwapsPerBlock", maxPerBlockSeen);
        vm.serializeUint(o, "reverts", reverts);
        vm.serializeUint(o, "feeViolations", feeViolations);
        vm.serializeUint(o, "zeroFeeSwaps", zeroFee);
        vm.serializeUint(o, "topOfBlockViolations", topViolations);
        vm.serializeUint(o, "anchorViolations", anchorViolations);
        vm.serializeUint(o, "fallbackSwaps", fallbacks);
        vm.serializeUint(o, "swapsUnderBrokenReads", brokenSwaps);
        vm.serializeUint(o, "swapGasP50", p50);
        vm.serializeUint(o, "swapGasP95", p95);
        vm.serializeUint(o, "swapGasMax", smax);
        vm.serializeUint(o, "blockGasP95", b95);
        vm.serializeUint(o, "blockGasMax", bmax);
        string memory j = vm.serializeUint(o, "smallBlockGasLimit", SMALL_BLOCK_GAS);
        vm.createDir("../backend/data/load", true);
        vm.writeJson(j, "../backend/data/load/onchain.json");
    }
}

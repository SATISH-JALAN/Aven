// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {AvenFairValue as FV} from "src/AvenFairValue.sol";
import {PriceMath} from "test/utils/PriceMath.sol";

/// @notice Differential-proof vector generator (PLAN 2.3, I7). Writes inputs + Solidity outputs to
/// backend/data/vectors/{fee,anchor}-vectors.json (format: docs/spec/DATA.md). backend/core/test/differential.test.ts
/// recomputes every vector with the TypeScript port and requires exact equality.
/// Runs only with GEN_VECTORS=1 (via `pnpm prove:diff`) so normal `forge test` stays fast. Fixed seed: reproducible.
contract GenVectors is Test {
    uint256 constant SEED = 0x4156454e; // "AVEN"
    uint256 constant N_FEE = 10_000;
    uint256 constant N_ANCHOR = 2_000;
    string constant DIR = "../backend/data/vectors/";

    uint256 internal _nonce;

    function _rand() internal returns (uint256) {
        return uint256(keccak256(abi.encode(SEED, _nonce++)));
    }

    function _r(uint256 lo, uint256 hi) internal returns (uint256) {
        return bound(_rand(), lo, hi);
    }

    function _coin() internal returns (bool) {
        return _rand() & 1 == 1;
    }

    // ------------------------------------------------------------------------------------------------ fee vectors

    function test_genFeeVectors() public {
        if (!vm.envOr("GEN_VECTORS", false)) vm.skip(true);
        vm.pauseGasMetering();
        vm.createDir(DIR, true);
        string memory path = string.concat(DIR, "fee-vectors.json");
        vm.writeFile(path, "[\n");
        uint256[9] memory perClass;
        for (uint256 i; i < N_FEE; i++) {
            uint256 cls = i % 9;
            perClass[cls]++;
            (FV.Config memory c, FV.Params memory p, FV.Inputs memory inp) = _feeCase(cls);
            FV.Breakdown memory b = FV.compute(c, p, inp);
            vm.writeLine(path, string.concat(_feeJson(c, p, inp, b), i + 1 < N_FEE ? "," : ""));
        }
        vm.writeLine(path, "]");
        for (uint256 k; k < 9; k++) {
            emit log_named_uint(string.concat("fee vectors in class ", vm.toString(k)), perClass[k]);
        }
    }

    /// Nine coverage classes (documented in docs/PROOFS.md once P9 lands).
    function _feeCase(uint256 cls) internal returns (FV.Config memory c, FV.Params memory p, FV.Inputs memory inp) {
        p = FV.defaultParams();
        if (cls == 0) return _fullRandom();
        // Realistic testnet-ETH-like base (classes 1..8): szDecimals 4, decimals 18/6, 6/18 or 18/18.
        c = _ethCfg();
        inp.oracleRaw = uint64(_r(100_000, 400_000));
        inp.markRaw = uint64(_r(uint256(inp.oracleRaw) * 99 / 100, uint256(inp.oracleRaw) * 101 / 100));
        inp.anchorMarkRaw =
            _coin() ? 0 : uint64(_r(uint256(inp.oracleRaw) * 97 / 100, uint256(inp.oracleRaw) * 103 / 100));
        uint256 fair = PriceMath.sqrtPriceFromWad(c, FV.oracleWad(c, inp.oracleRaw));
        inp.sqrtPriceX96 = uint160(_r(fair * 97 / 100, fair * 103 / 100));
        inp.sqrtPriceTopX96 = uint160(_r(fair * 97 / 100, fair * 103 / 100));
        inp.zeroForOne = _coin();
        inp.readOk = true;

        if (cls == 2) {
            // top-of-block forced to the SAME side as current, further from fair
            bool above = FV.poolWad(c, inp.sqrtPriceX96) > FV.oracleWad(c, inp.oracleRaw);
            inp.sqrtPriceTopX96 =
                uint160(above ? _r(fair * 103 / 100, fair * 106 / 100) : _r(fair * 94 / 100, fair * 97 / 100));
        } else if (cls == 3) {
            // top-of-block on the OPPOSITE side
            bool above = FV.poolWad(c, inp.sqrtPriceX96) > FV.oracleWad(c, inp.oracleRaw);
            inp.sqrtPriceTopX96 =
                uint160(above ? _r(fair * 94 / 100, fair * 99 / 100) : _r(fair * 101 / 100, fair * 106 / 100));
        } else if (cls == 4) {
            // exact thresholds +-1: maxGapBps around the actual gap, stress threshold around the actual move
            FV.Breakdown memory pre = FV.compute(c, p, inp);
            uint256 k = _r(0, 2);
            if (pre.gapBps > 1) p.maxGapBps = uint32(pre.gapBps + k - 1); // gap-1, gap, gap+1
            if (inp.anchorMarkRaw == 0) {
                inp.anchorMarkRaw = uint64(_r(uint256(inp.oracleRaw) * 98 / 100, uint256(inp.oracleRaw) * 102 / 100));
            }
            FV.Breakdown memory pre2 = FV.compute(c, p, inp);
            if (pre2.moveBps > 1) p.stressThresholdBps = uint32(pre2.moveBps + _r(0, 2) - 1);
            if (_coin()) inp.markRaw = inp.oracleRaw; // premium exactly 0
        } else if (cls == 5) {
            // clamp edges: tiny maxFee and/or huge weights so the floor/ceiling binds
            p.maxFee = uint24(_r(500, 2_000));
            p.fallbackFee = uint24(_r(500, p.maxFee));
            p.gapWeight = uint32(_r(50, 100_000));
            p.premiumWeight = uint32(_r(50, 100_000));
            p.stressWeight = uint32(_r(20, 100_000));
        } else if (cls == 6) {
            inp.readOk = false; // READ_FAILED (inputs still logged)
            if (_coin()) inp.oracleRaw = 0;
            if (_coin()) inp.markRaw = 0;
        } else if (cls == 7) {
            // GAP_TOO_LARGE: pool 25%..300% away from fair
            inp.sqrtPriceX96 = uint160(_coin() ? _r(fair * 112 / 100, fair * 2) : _r(fair / 2, fair * 87 / 100));
        } else if (cls == 8) {
            // exactly at fair (szDecimals 0, equal decimals, sqrtP = Q96 => pool price 1.0 == oracle 1_000_000)
            c = FV.Config({perpIndex: 0, szDecimals: 0, baseIsToken0: _coin(), decimals0: 18, decimals1: 18});
            inp.oracleRaw = 1_000_000;
            inp.markRaw = uint64(_r(990_000, 1_010_000));
            inp.sqrtPriceX96 = uint160(FV.Q96);
            inp.sqrtPriceTopX96 = uint160(_r(FV.Q96 * 95 / 100, FV.Q96 * 105 / 100));
        }
        // cls 1: realistic as built above.
    }

    function _ethCfg() internal returns (FV.Config memory c) {
        uint256 d = _r(0, 2);
        c.perpIndex = 4;
        c.szDecimals = 4;
        if (d == 0) (c.baseIsToken0, c.decimals0, c.decimals1) = (true, 18, 6); // aETH token0, aUSD token1
        else if (d == 1) (c.baseIsToken0, c.decimals0, c.decimals1) = (false, 6, 18); // aUSD token0, aETH token1
        else (c.baseIsToken0, c.decimals0, c.decimals1) = (_coin(), 18, 18);
    }

    function _fullRandom() internal returns (FV.Config memory c, FV.Params memory p, FV.Inputs memory inp) {
        c = FV.Config({
            perpIndex: uint32(_rand()),
            szDecimals: uint8(_r(0, 6)),
            baseIsToken0: _coin(),
            decimals0: uint8(_r(0, 18)),
            decimals1: uint8(_r(0, 18))
        });
        uint256[4] memory f = [_r(0, 100_000), _r(0, 100_000), _r(0, 100_000), _r(0, 100_000)];
        for (uint256 i; i < 4; i++) {
            for (uint256 j = i + 1; j < 4; j++) {
                if (f[j] < f[i]) (f[i], f[j]) = (f[j], f[i]);
            }
        }
        p = FV.Params({
            minFee: uint24(f[0]),
            baseFee: uint24(f[1]),
            fallbackFee: uint24(f[2]),
            maxFee: uint24(f[3]),
            gapWeight: uint32(_rand()),
            premiumWeight: uint32(_rand()),
            stressThresholdBps: uint32(_rand()),
            stressWeight: uint32(_rand()),
            stressTauSec: uint32(_r(1, type(uint32).max)),
            maxGapBps: uint32(_r(1, type(uint32).max)),
            precompileGas: uint32(_r(10_000, type(uint32).max))
        });
        inp = FV.Inputs({
            oracleRaw: uint64(_r(1, type(uint64).max)),
            markRaw: uint64(_r(1, type(uint64).max)),
            anchorMarkRaw: _coin() ? 0 : uint64(_rand()),
            sqrtPriceX96: uint160(_r(TickMath.MIN_SQRT_PRICE, TickMath.MAX_SQRT_PRICE - 1)),
            sqrtPriceTopX96: uint160(_r(TickMath.MIN_SQRT_PRICE, TickMath.MAX_SQRT_PRICE - 1)),
            zeroForOne: _coin(),
            readOk: _r(0, 9) != 0
        });
    }

    function _feeJson(FV.Config memory c, FV.Params memory p, FV.Inputs memory i, FV.Breakdown memory b)
        internal
        pure
        returns (string memory)
    {
        string memory cfgJ = string.concat(
            '{"perpIndex":',
            vm.toString(c.perpIndex),
            ',"szDecimals":',
            vm.toString(c.szDecimals),
            ',"baseIsToken0":',
            vm.toString(c.baseIsToken0),
            ',"decimals0":',
            vm.toString(c.decimals0),
            ',"decimals1":',
            vm.toString(c.decimals1),
            "}"
        );
        string memory pJ = string.concat(
            string.concat(
                '{"baseFee":',
                vm.toString(p.baseFee),
                ',"minFee":',
                vm.toString(p.minFee),
                ',"maxFee":',
                vm.toString(p.maxFee),
                ',"fallbackFee":',
                vm.toString(p.fallbackFee),
                ',"gapWeight":',
                vm.toString(p.gapWeight),
                ',"premiumWeight":',
                vm.toString(p.premiumWeight)
            ),
            string.concat(
                ',"stressThresholdBps":',
                vm.toString(p.stressThresholdBps),
                ',"stressWeight":',
                vm.toString(p.stressWeight),
                ',"stressTauSec":',
                vm.toString(p.stressTauSec),
                ',"maxGapBps":',
                vm.toString(p.maxGapBps),
                ',"precompileGas":',
                vm.toString(p.precompileGas),
                "}"
            )
        );
        string memory inJ = string.concat(
            string.concat('{"cfg":', cfgJ, ',"params":', pJ, ',"oracleRaw":"', vm.toString(i.oracleRaw)),
            string.concat('","markRaw":"', vm.toString(i.markRaw), '","anchorMarkRaw":"', vm.toString(i.anchorMarkRaw)),
            string.concat(
                '","sqrtPriceX96":"',
                vm.toString(i.sqrtPriceX96),
                '","sqrtPriceTopX96":"',
                vm.toString(i.sqrtPriceTopX96)
            ),
            string.concat('","zeroForOne":', vm.toString(i.zeroForOne), ',"readOk":', vm.toString(i.readOk), "}")
        );
        string memory outJ = string.concat(
            string.concat('{"fee":', vm.toString(b.fee), ',"reason":', vm.toString(uint8(b.reason))),
            string.concat(',"gapBps":"', vm.toString(b.gapBps), '","premiumBps":"', vm.toString(b.premiumBps)),
            string.concat('","moveBps":"', vm.toString(b.moveBps), '","arb":', vm.toString(b.arb)),
            string.concat(',"withPressure":', vm.toString(b.withPressure), "}")
        );
        return string.concat('{"inputs":', inJ, ',"expected":', outJ, "}");
    }

    // ------------------------------------------------------------------------------------------------ anchor vectors

    function test_genAnchorVectors() public {
        if (!vm.envOr("GEN_VECTORS", false)) vm.skip(true);
        vm.pauseGasMetering();
        vm.createDir(DIR, true);
        string memory path = string.concat(DIR, "anchor-vectors.json");
        vm.writeFile(path, "[\n");
        for (uint256 i; i < N_ANCHOR; i++) {
            vm.writeLine(path, string.concat(_anchorJson(i), i + 1 < N_ANCHOR ? "," : ""));
        }
        vm.writeLine(path, "]");
    }

    /// One anchor vector. Edge kinds by i % 4: dt = 0, dt = tau - 1, dt = tau, random; anchorTime = 0 every 5th.
    function _anchorJson(uint256 i) internal returns (string memory) {
        uint64 a = uint64(_rand());
        uint40 t = i % 5 == 0 ? 0 : uint40(_r(1, type(uint40).max / 2));
        uint64 m = uint64(_rand());
        uint32 tau = uint32(_r(1, i % 3 == 0 ? 120 : type(uint32).max));
        uint256 kind = i % 4;
        uint256 dt = kind == 0 ? 0 : kind == 1 ? tau - 1 : kind == 2 ? tau : _r(0, uint256(tau) * 2);
        uint40 nowTs = uint40(uint256(t) + dt);
        (uint64 nm, uint40 nt) = FV.advanceAnchor(a, t, m, nowTs, tau);
        return string.concat(
            string.concat('{"inputs":{"anchorMark":"', vm.toString(a), '","anchorTime":"', vm.toString(t)),
            string.concat(
                '","markRaw":"', vm.toString(m), '","now":"', vm.toString(nowTs), '","tau":"', vm.toString(tau)
            ),
            string.concat('"},"expected":{"mark":"', vm.toString(nm), '","time":"', vm.toString(nt), '"}}')
        );
    }
}

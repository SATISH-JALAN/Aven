// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {AvenFairValue as FV} from "../src/AvenFairValue.sol";
import {AvenHook} from "../src/AvenHook.sol";
import {PriceMath} from "../test/utils/PriceMath.sol";
import {AvenScript} from "./base/AvenScript.sol";

/// @notice Steps 4-5 of §11.3: initialise the Aven pool (fee 0x800000, hook) and the control pool (fee 3000, no hook)
/// at the live oracle price, add IDENTICAL liquidity to both, and write contracts/deployments/<chainId>.json (§8.3).
contract CreatePools is AvenScript {
    int24 internal constant TICK_SPACING = 60;

    function run() external {
        Wip memory w = _loadWip();
        AvenHook hook = AvenHook(w.hook);
        FV.Config memory cfg = hook.config();
        (uint160 sqrtP, uint64 oracleRaw) = _initialPrice(cfg);
        (PoolKey memory avenKey, PoolKey memory controlKey) = _keys(w, cfg);
        ModifyLiquidityParams memory mlp = _liquidity(cfg, sqrtP);

        vm.startBroadcast(_deployerKey());
        IPoolManager(w.poolManager).initialize(avenKey, sqrtP);
        IPoolManager(w.poolManager).initialize(controlKey, sqrtP);
        PoolModifyLiquidityTest(w.liquidityRouter).modifyLiquidity(avenKey, mlp, "");
        PoolModifyLiquidityTest(w.liquidityRouter).modifyLiquidity(controlKey, mlp, "");
        vm.stopBroadcast();

        _writeDeployments(w, avenKey, controlKey, cfg, hook.params());
        console2.log("oracleRaw", oracleRaw);
        console2.log("liquidity per pool", uint256(mlp.liquidityDelta));
        console2.log("wrote", _finalPath());
    }

    /// Pool price = live oracle price (within 1 bp after sqrt rounding).
    function _initialPrice(FV.Config memory cfg) internal view returns (uint160 sqrtP, uint64 oracleRaw) {
        bool ok;
        (ok, oracleRaw,) = FV.readPrices(cfg.perpIndex, 30_000);
        require(ok, "oracle/mark read failed");
        uint256 want = FV.oracleWad(cfg, oracleRaw);
        sqrtP = PriceMath.sqrtPriceFromWad(cfg, want);
        require(sqrtP > TickMath.MIN_SQRT_PRICE && sqrtP < TickMath.MAX_SQRT_PRICE, "sqrtP out of range");
        uint256 got = FV.poolWad(cfg, sqrtP);
        require((got > want ? got - want : want - got) * 10_000 <= want, "initial price not within 1 bp of oracle");
    }

    function _keys(Wip memory w, FV.Config memory cfg)
        internal
        pure
        returns (PoolKey memory avenKey, PoolKey memory controlKey)
    {
        (Currency c0, Currency c1) = cfg.baseIsToken0
            ? (Currency.wrap(w.base), Currency.wrap(w.quote))
            : (Currency.wrap(w.quote), Currency.wrap(w.base));
        avenKey = PoolKey(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, TICK_SPACING, IHooks(w.hook));
        controlKey = PoolKey(c0, c1, 3000, TICK_SPACING, IHooks(address(0)));
    }

    /// Range ~-50%/+50% around the price, rounded to the tick spacing (6932 ticks ~ x0.5, 4055 ~ x1.5). The position is
    /// sized from the BASE amount only (LIQ_BASE, default 400 base; ~1.43M quote at $2,240), and the same liquidity goes
    /// into both pools. For base = token0 the base side of an in-range position spans [P, upper]; for base = token1,
    /// [lower, P].
    function _liquidity(FV.Config memory cfg, uint160 sqrtP) internal view returns (ModifyLiquidityParams memory mlp) {
        int24 tick = TickMath.getTickAtSqrtPrice(sqrtP);
        mlp.tickLower = _floorTick(tick - 6932);
        mlp.tickUpper = _floorTick(tick + 4055) + TICK_SPACING;
        uint256 baseAmt = vm.envOr("LIQ_BASE", uint256(400) * 10 ** (cfg.baseIsToken0 ? cfg.decimals0 : cfg.decimals1));
        uint128 liq = cfg.baseIsToken0
            ? LiquidityAmounts.getLiquidityForAmount0(sqrtP, TickMath.getSqrtPriceAtTick(mlp.tickUpper), baseAmt)
            : LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(mlp.tickLower), sqrtP, baseAmt);
        require(liq > 0, "zero liquidity");
        mlp.liquidityDelta = int256(uint256(liq));
    }

    function _floorTick(int24 t) internal pure returns (int24) {
        int24 c = t / TICK_SPACING;
        if (t < 0 && t % TICK_SPACING != 0) c--;
        return c * TICK_SPACING;
    }

    // ------------------------------------------------------------------------------------------------ §8.3 writer

    function _keyJson(string memory name, PoolKey memory k) internal returns (string memory) {
        vm.serializeAddress(name, "currency0", Currency.unwrap(k.currency0));
        vm.serializeAddress(name, "currency1", Currency.unwrap(k.currency1));
        vm.serializeUint(name, "fee", k.fee);
        vm.serializeInt(name, "tickSpacing", k.tickSpacing);
        return vm.serializeAddress(name, "hooks", address(k.hooks));
    }

    function _poolJson(string memory name, PoolKey memory k) internal returns (string memory) {
        string memory kj = _keyJson(string.concat(name, "Key"), k);
        vm.serializeBytes32(name, "id", PoolId.unwrap(k.toId()));
        return vm.serializeString(name, "key", kj);
    }

    function _writeDeployments(
        Wip memory w,
        PoolKey memory avenKey,
        PoolKey memory controlKey,
        FV.Config memory c,
        FV.Params memory p
    ) internal {
        vm.serializeString("pools", "aven", _poolJson("aven", avenKey));
        string memory pools = vm.serializeString("pools", "control", _poolJson("control", controlKey));

        vm.serializeAddress("tokens", "base", w.base);
        vm.serializeAddress("tokens", "quote", w.quote);
        vm.serializeString("tokens", "baseSymbol", w.baseSymbol);
        string memory tokens = vm.serializeString("tokens", "quoteSymbol", w.quoteSymbol);

        vm.serializeUint("config", "perpIndex", c.perpIndex);
        vm.serializeUint("config", "szDecimals", c.szDecimals);
        vm.serializeBool("config", "baseIsToken0", c.baseIsToken0);
        vm.serializeUint("config", "decimals0", c.decimals0);
        string memory config = vm.serializeUint("config", "decimals1", c.decimals1);

        vm.serializeUint("params", "baseFee", p.baseFee);
        vm.serializeUint("params", "minFee", p.minFee);
        vm.serializeUint("params", "maxFee", p.maxFee);
        vm.serializeUint("params", "fallbackFee", p.fallbackFee);
        vm.serializeUint("params", "gapWeight", p.gapWeight);
        vm.serializeUint("params", "premiumWeight", p.premiumWeight);
        vm.serializeUint("params", "stressThresholdBps", p.stressThresholdBps);
        vm.serializeUint("params", "stressWeight", p.stressWeight);
        vm.serializeUint("params", "stressTauSec", p.stressTauSec);
        vm.serializeUint("params", "maxGapBps", p.maxGapBps);
        string memory params = vm.serializeUint("params", "precompileGas", p.precompileGas);

        string memory d = "deployments";
        vm.serializeUint(d, "chainId", block.chainid);
        vm.serializeUint(d, "deployedAtBlock", w.deployedAtBlock);
        vm.serializeString(d, "explorer", vm.envOr("EXPLORER", string("")));
        vm.serializeString(d, "tokens", tokens);
        vm.serializeAddress(d, "poolManager", w.poolManager);
        vm.serializeAddress(d, "swapRouter", w.swapRouter);
        vm.serializeAddress(d, "liquidityRouter", w.liquidityRouter);
        vm.serializeAddress(d, "hook", w.hook);
        vm.serializeBytes32(d, "hookSalt", w.hookSalt);
        vm.serializeString(d, "pools", pools);
        vm.serializeString(d, "config", config);
        string memory out = vm.serializeString(d, "params", params);
        vm.writeJson(out, _finalPath());
    }
}

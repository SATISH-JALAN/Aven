// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Script.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {AvenFairValue as FV} from "../src/AvenFairValue.sol";
import {AvenHook} from "../src/AvenHook.sol";
import {AvenScript} from "./base/AvenScript.sol";

/// @notice Step 6 of §11.3: one small exact-input swap in each direction on both pools, printing the Aven fee preview.
/// Then: `pnpm verify <txHash>` (backend/core) must report MATCH on checks A and B for the Aven swaps.
contract Smoke is AvenScript {
    function run() external {
        Wip memory w = _loadWip();
        AvenHook hook = AvenHook(w.hook);
        FV.Config memory cfg = hook.config();
        (Currency c0, Currency c1) = cfg.baseIsToken0
            ? (Currency.wrap(w.base), Currency.wrap(w.quote))
            : (Currency.wrap(w.quote), Currency.wrap(w.base));
        PoolKey memory avenKey = PoolKey(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(w.hook));
        PoolKey memory controlKey = PoolKey(c0, c1, 3000, 60, IHooks(address(0)));
        uint256 baseIn = vm.envOr("SMOKE_BASE_IN", uint256(0.01e18)); // 0.01 aETH
        uint256 quoteIn = vm.envOr("SMOKE_QUOTE_IN", uint256(20e6)); // 20 aUSD
        bool sellBase = cfg.baseIsToken0; // zeroForOne that sells base

        for (uint256 d; d < 2; d++) {
            bool zeroForOne = d == 0 ? sellBase : !sellBase;
            uint256 amountIn = zeroForOne == sellBase ? baseIn : quoteIn;
            FV.Breakdown memory pv = hook.previewFee(avenKey, zeroForOne);
            console2.log(zeroForOne == sellBase ? "sell base: aven previewFee" : "buy base:  aven previewFee", pv.fee);
            vm.startBroadcast(_deployerKey());
            _swap(w.swapRouter, avenKey, zeroForOne, amountIn);
            _swap(w.swapRouter, controlKey, zeroForOne, amountIn);
            vm.stopBroadcast();
        }
        console2.log("smoke swaps sent; verify the Aven txs with: pnpm verify <txHash>");
    }

    function _swap(address router, PoolKey memory key, bool zeroForOne, uint256 amountIn) internal {
        PoolSwapTest(router)
            .swap(
                key,
                SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: -int256(amountIn),
                    sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                ""
            );
    }
}

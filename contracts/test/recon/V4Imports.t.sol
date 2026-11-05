// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
// Recon item 1: these exact import paths must compile with contracts/remappings.txt.
import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

contract V4ImportsTest is Test {
    function test_feeFlags() public pure {
        assertEq(LPFeeLibrary.DYNAMIC_FEE_FLAG, 0x800000);
        assertEq(LPFeeLibrary.OVERRIDE_FEE_FLAG, 0x400000);
        assertEq(LPFeeLibrary.MAX_LP_FEE, 1_000_000);
    }

    function test_hookFlagBits() public pure {
        assertEq(Hooks.BEFORE_INITIALIZE_FLAG, 1 << 13);
        assertEq(Hooks.BEFORE_SWAP_FLAG, 1 << 7);
    }

    function test_swapParamsShape() public pure {
        SwapParams memory p = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        assertTrue(p.zeroForOne);
    }

    function test_typesReferenced() public pure {
        // Referencing the types forces them to resolve and compile.
        assertGt(type(PoolSwapTest).creationCode.length, 0);
        assertGt(type(PoolModifyLiquidityTest).creationCode.length, 0);
        bytes4 sel = BaseHook.beforeSwap.selector;
        assertTrue(sel != bytes4(0));
        assertEq(HookMiner.FLAG_MASK, Hooks.ALL_HOOK_MASK);
        assertTrue(address(Deployers(payable(address(0)))) == address(0));
    }
}

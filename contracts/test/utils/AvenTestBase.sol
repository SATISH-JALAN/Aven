// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {Vm} from "forge-std/Vm.sol";
import {AvenFairValue as FV} from "../../src/AvenFairValue.sol";
import {AvenHook} from "../../src/AvenHook.sol";
import {IAvenHook} from "../../src/interfaces/IAvenHook.sol";
import {MockHyperCorePx} from "../mocks/MockHyperCorePx.sol";
import {PriceMath} from "./PriceMath.sol";

/// @notice Shared setup for hook tests (PLAN 1.2): real v4 PoolManager + routers (Deployers), MockHyperCorePx etched at
/// 0x0806/0x0807, AvenHook placed at an address whose low 14 bits are 0x2080, and an Aven pool (dynamic fee + hook)
/// next to a control pool (fixed 3000, no hook) with identical liquidity at the oracle price. Testnet-ETH-like
/// config: perp 4, szDecimals 4, oracle 2240.02 (recon C.6); both mock tokens have 18 decimals.
abstract contract AvenTestBase is Deployers {
    using StateLibrary for *;

    address internal constant MARK_PX = 0x0000000000000000000000000000000000000806;
    address internal constant ORACLE_PX = 0x0000000000000000000000000000000000000807;
    uint32 internal constant PERP = 4;
    uint64 internal constant ORACLE0 = 224_002; // 2240.02 with szDecimals 4
    uint128 internal constant LIQ = 1_000e18;
    int24 internal constant SPACING = 60;
    bytes32 internal constant SWAP_TOPIC =
        keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    bytes32 internal constant FEE_TOPIC =
        keccak256("FeeComputed(bytes32,address,uint24,uint8,bool,uint64,uint64,uint64,uint160,uint160)");

    MockHyperCorePx internal oracleMock;
    MockHyperCorePx internal markMock;
    AvenHook internal hook;
    FV.Config internal cfg;
    FV.Params internal prm;
    Currency internal base;
    Currency internal quote;
    PoolKey internal avenKey;
    PoolKey internal controlKey;
    PoolId internal avenId;
    PoolId internal controlId;

    /// Everything an external invariant handler needs.
    struct Ctx {
        IPoolManager manager;
        PoolSwapTest router;
        AvenHook hook;
        MockHyperCorePx oracleMock;
        MockHyperCorePx markMock;
        PoolKey key;
        bool base0;
        uint32 perp;
        uint64 px0;
    }

    /// Decoded FeeComputed + matching PoolManager Swap for one swap.
    struct SwapLog {
        uint24 fee;
        uint8 reason;
        bool zeroForOne;
        uint64 oracleRaw;
        uint64 markRaw;
        uint64 anchorMarkRaw;
        uint160 sqrtPriceX96;
        uint160 sqrtPriceTopX96;
        uint24 swapEventFee;
        bool hasFeeComputed;
    }

    function _setUpAven(bool baseIsToken0) internal {
        vm.roll(100);
        vm.warp(1_800_000_000);
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        vm.etch(ORACLE_PX, address(new MockHyperCorePx()).code);
        vm.etch(MARK_PX, address(new MockHyperCorePx()).code);
        oracleMock = MockHyperCorePx(ORACLE_PX);
        markMock = MockHyperCorePx(MARK_PX);
        setOracle(ORACLE0);
        setMark(ORACLE0);

        cfg = FV.Config({perpIndex: PERP, szDecimals: 4, baseIsToken0: baseIsToken0, decimals0: 18, decimals1: 18});
        prm = FV.defaultParams();
        (base, quote) = baseIsToken0 ? (currency0, currency1) : (currency1, currency0);
        hook = _deployHook(cfg, prm, base, quote, 0x4444);

        uint160 sqrtP = fairSqrtPrice(ORACLE0);
        (avenKey, avenId) =
            initPool(currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, SPACING, sqrtP);
        (controlKey, controlId) = initPool(currency0, currency1, IHooks(address(0)), 3000, SPACING, sqrtP);
        _addLiquidity(avenKey, sqrtP);
        _addLiquidity(controlKey, sqrtP);
    }

    /// Deploys AvenHook at an address with exactly the 0x2080 permission bits (salt varies the high bits).
    function _deployHook(FV.Config memory c, FV.Params memory p, Currency b, Currency q, uint160 salt)
        internal
        returns (AvenHook h)
    {
        address at = address(uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG) | (salt << 144));
        deployCodeTo("AvenHook.sol:AvenHook", abi.encode(manager, c, p, b, q), at);
        h = AvenHook(at);
    }

    function _addLiquidity(PoolKey memory k, uint160 sqrtP) internal {
        int24 tick = TickMath.getTickAtSqrtPrice(sqrtP);
        int24 lower = ((tick - 6_000) / SPACING) * SPACING;
        int24 upper = ((tick + 6_000) / SPACING) * SPACING;
        modifyLiquidityRouter.modifyLiquidity(
            k,
            ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(LIQ)), salt: 0}),
            ZERO_BYTES
        );
    }

    // ---------------------------------------------------------------- prices

    function setOracle(uint64 raw) internal {
        oracleMock.set(PERP, raw);
    }

    function setMark(uint64 raw) internal {
        markMock.set(PERP, raw);
    }

    function fairSqrtPrice(uint64 oracleRaw) internal view returns (uint160) {
        return PriceMath.sqrtPriceFromWad(cfg, FV.oracleWad(cfg, oracleRaw));
    }

    function sqrtPrice(PoolId id) internal view returns (uint160 sp) {
        (sp,,,) = manager.getSlot0(id);
    }

    // ---------------------------------------------------------------- swaps

    /// zeroForOne that SELLS the base token (base0 ? true : false).
    function sellBaseDir() internal view returns (bool) {
        return cfg.baseIsToken0;
    }

    /// Exact-input swap of `amountIn` (wei of the input token) with no price limit.
    function swapExactIn(PoolKey memory k, bool zeroForOne, uint256 amountIn) internal returns (BalanceDelta) {
        return swapRouter.swap(
            k,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ZERO_BYTES
        );
    }

    /// Swap and return the decoded FeeComputed (if any) and the PoolManager Swap fee.
    function swapLogged(PoolKey memory k, bool zeroForOne, uint256 amountIn) internal returns (SwapLog memory s) {
        vm.recordLogs();
        swapExactIn(k, zeroForOne, amountIn);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == FEE_TOPIC && logs[i].emitter == address(k.hooks)) {
                _copyFee(s, abi.decode(logs[i].data, (FeeData)));
            } else if (logs[i].topics[0] == SWAP_TOPIC && logs[i].emitter == address(manager)) {
                (,,,,, s.swapEventFee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
            }
        }
    }

    /// FeeComputed's non-indexed fields; all static, so the struct ABI equals the event data tuple.
    struct FeeData {
        uint24 fee;
        uint8 reason;
        bool zeroForOne;
        uint64 oracleRaw;
        uint64 markRaw;
        uint64 anchorMarkRaw;
        uint160 sqrtPriceX96;
        uint160 sqrtPriceTopX96;
    }

    function _copyFee(SwapLog memory s, FeeData memory f) private pure {
        s.hasFeeComputed = true;
        s.fee = f.fee;
        s.reason = f.reason;
        s.zeroForOne = f.zeroForOne;
        s.oracleRaw = f.oracleRaw;
        s.markRaw = f.markRaw;
        s.anchorMarkRaw = f.anchorMarkRaw;
        s.sqrtPriceX96 = f.sqrtPriceX96;
        s.sqrtPriceTopX96 = f.sqrtPriceTopX96;
    }

    /// Move to the next block (and `secs` later) so top-of-block and the anchor advance as on chain.
    function nextBlock(uint256 secs) internal {
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + secs);
    }

    /// Rebuild FV.Inputs from a SwapLog (what the off-chain verifier does, §7.3).
    function inputsOf(SwapLog memory s) internal pure returns (FV.Inputs memory) {
        return FV.Inputs({
            oracleRaw: s.oracleRaw,
            markRaw: s.markRaw,
            anchorMarkRaw: s.anchorMarkRaw,
            sqrtPriceX96: s.sqrtPriceX96,
            sqrtPriceTopX96: s.sqrtPriceTopX96,
            zeroForOne: s.zeroForOne,
            readOk: s.reason != uint8(FV.Reason.READ_FAILED)
        });
    }

    function poolStateOf(PoolId id) internal view returns (IAvenHook.PoolState memory) {
        return hook.poolState(id);
    }
}

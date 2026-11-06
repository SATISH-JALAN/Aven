// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {AvenFairValue as FV} from "src/AvenFairValue.sol";
import {AvenHook} from "src/AvenHook.sol";
import {IAvenHook} from "src/interfaces/IAvenHook.sol";
import {MockHyperCorePx} from "test/mocks/MockHyperCorePx.sol";
import {AvenTestBase} from "test/utils/AvenTestBase.sol";

/// @notice Random actions against the Aven pool. Every swap is checked on the spot; violations are counted and the
/// invariants assert the counters stay 0. Swap reverts are caught (never bubble), so fail_on_revert stays meaningful.
contract AvenHandler is Test {
    bytes32 constant SWAP_TOPIC = keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    bytes32 constant FEE_TOPIC =
        keccak256("FeeComputed(bytes32,address,uint24,uint8,bool,uint64,uint64,uint64,uint160,uint160)");

    IPoolManager immutable manager;
    PoolSwapTest immutable router;
    AvenHook immutable hook;
    MockHyperCorePx immutable oracleMock;
    MockHyperCorePx immutable markMock;
    PoolKey key;
    PoolId id;
    bool immutable base0;
    uint32 immutable perp;
    uint64 immutable px0;

    bool public readsBroken;
    // ghost counters
    uint256 public swaps;
    uint256 public fallbackSwaps;
    uint256 public brokenReadSwaps;
    uint256 public unexpectedReverts; // I1
    uint256 public feeViolations; // I2
    uint256 public zeroFeeSwaps; // I3
    uint256 public stateViolations; // I9
    bytes public lastRevert;

    constructor(AvenTestBase.Ctx memory c) {
        manager = c.manager;
        router = c.router;
        hook = c.hook;
        oracleMock = c.oracleMock;
        markMock = c.markMock;
        key = c.key;
        id = c.key.toId();
        base0 = c.base0;
        perp = c.perp;
        px0 = c.px0;
        for (uint256 i; i < 2; i++) {
            MockERC20 t = MockERC20(Currency.unwrap(i == 0 ? c.key.currency0 : c.key.currency1));
            t.mint(address(this), 1e30);
            t.approve(address(c.router), type(uint256).max);
        }
    }

    // ------------------------------------------------------------------------------------------------ actions

    function swap(uint256 amount, bool sellBase, bool exactOut) external {
        bool zeroForOne = sellBase ? base0 : !base0;
        // Sizes vs the pool's ~21 base of virtual depth: up to ~0.5% price impact per swap, so the pool mostly stays within
        // maxGapBps of the oracle (exercising the clamped OK path) while drift still reaches the fallback path at times.
        bool baseSide = exactOut ? !sellBase : sellBase; // which token the amount is denominated in
        amount = baseSide ? bound(amount, 1e12, 0.05e18) : bound(amount, 1e12, 100e18);
        IAvenHook.PoolState memory s0 = hook.poolState(id);
        uint256 blockBefore = block.number;
        bool brokenNow = readsBroken;

        vm.recordLogs();
        try router.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: exactOut ? int256(amount) : -int256(amount),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        ) {}
        catch (bytes memory err) {
            unexpectedReverts++; // I1: no swap may revert (reads never revert; sizes stay in range)
            lastRevert = err;
            return;
        }
        swaps++;
        if (brokenNow) brokenReadSwaps++;
        (bool found, uint24 fee, uint8 reason, uint24 swapFee) = _decode(vm.getRecordedLogs());
        if (!found) {
            feeViolations++;
            return;
        }
        FV.Params memory p = hook.params();
        if (swapFee == 0) zeroFeeSwaps++; // I3: a dynamic pool's stored fee is 0, so 0 here means no override flag
        if (swapFee != fee) feeViolations++;
        if (reason == uint8(FV.Reason.OK)) {
            if (fee < p.minFee || fee > p.maxFee) feeViolations++; // I2
        } else {
            fallbackSwaps++;
            if (fee != p.fallbackFee) feeViolations++; // I2
        }
        if (brokenNow && reason != uint8(FV.Reason.READ_FAILED)) feeViolations++;

        // I9: top-of-block only on the first swap of a block; anchor only on good reads
        IAvenHook.PoolState memory s1 = hook.poolState(id);
        if (s0.topBlock == blockBefore && s1.sqrtPriceTopX96 != s0.sqrtPriceTopX96) stateViolations++;
        if (s1.topBlock != blockBefore) stateViolations++;
        if (brokenNow && (s1.anchorMark != s0.anchorMark || s1.anchorTime != s0.anchorTime)) stateViolations++;
    }

    /// Market moves: oracle +-6% around the start, mark within +-1% of the oracle.
    function movePrice(uint256 oracleBps, uint256 premiumBps, bool up, bool premUp) external {
        oracleBps = bound(oracleBps, 0, 600);
        premiumBps = bound(premiumBps, 0, 100);
        uint64 o =
            uint64(up ? uint256(px0) * (10_000 + oracleBps) / 10_000 : uint256(px0) * (10_000 - oracleBps) / 10_000);
        uint64 m =
            uint64(premUp ? uint256(o) * (10_000 + premiumBps) / 10_000 : uint256(o) * (10_000 - premiumBps) / 10_000);
        oracleMock.set(perp, o);
        markMock.set(perp, m);
    }

    /// Precompile failure injection: off, revert, burn all gas, empty return, >uint64 word; on oracle or mark.
    function setFailure(uint8 mode, bool onOracle) external {
        for (uint256 i; i < 2; i++) {
            MockHyperCorePx mk = i == 0 ? oracleMock : markMock;
            mk.setFail(false);
            mk.setBurn(false);
            mk.setEmpty(false);
            mk.setOverflow(false);
        }
        mode = uint8(bound(mode, 0, 8)); // 0-4: reads healthy (more likely), 5-8: one of the four failure modes
        readsBroken = mode > 4;
        if (!readsBroken) return;
        mode -= 4;
        MockHyperCorePx t = onOracle ? oracleMock : markMock;
        if (mode == 1) t.setFail(true);
        else if (mode == 2) t.setBurn(true);
        else if (mode == 3) t.setEmpty(true);
        else t.setOverflow(true);
    }

    function nextBlock(uint256 secs) external {
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + bound(secs, 0, 120));
    }

    // ------------------------------------------------------------------------------------------------ helpers

    function _decode(Vm.Log[] memory logs)
        internal
        view
        returns (bool found, uint24 fee, uint8 reason, uint24 swapFee)
    {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == FEE_TOPIC) {
                (fee, reason) = abi.decode(logs[i].data, (uint24, uint8));
                found = true;
            } else if (logs[i].emitter == address(manager) && logs[i].topics[0] == SWAP_TOPIC) {
                (,,,,, swapFee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
            }
        }
    }
}

/// @notice Invariant suite (ARCHITECTURE §6.6, §9; PLAN 6.2): I1, I2, I3, I4, I9 under random swaps (both directions,
/// exact-in and exact-out), price moves, precompile failures/burns/empty/oversized returns and block/time advances.
/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract AvenInvariantTest is StdInvariant, AvenTestBase {
    AvenHandler handler;

    function setUp() public {
        _setUpAven(true);
        handler = new AvenHandler(
            Ctx({
                manager: manager,
                router: swapRouter,
                hook: hook,
                oracleMock: oracleMock,
                markMock: markMock,
                key: avenKey,
                base0: cfg.baseIsToken0,
                perp: PERP,
                px0: ORACLE0
            })
        );
        bytes4[] memory sel = new bytes4[](4);
        sel[0] = AvenHandler.swap.selector;
        sel[1] = AvenHandler.movePrice.selector;
        sel[2] = AvenHandler.setFailure.selector;
        sel[3] = AvenHandler.nextBlock.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
        targetContract(address(handler));
    }

    function invariant_I1_noSwapRevertsFromReads() public view {
        assertEq(handler.unexpectedReverts(), 0, string(handler.lastRevert()));
    }

    function invariant_I2_feeClampedOrFallback() public view {
        assertEq(handler.feeViolations(), 0);
    }

    function invariant_I3_overrideFlagEverySwap() public view {
        assertEq(handler.zeroFeeSwaps(), 0);
    }

    function invariant_I4_hookHoldsNoTokens() public view {
        assertEq(currency0.balanceOf(address(hook)), 0);
        assertEq(currency1.balanceOf(address(hook)), 0);
    }

    function invariant_I9_anchorOnlyOnGoodReads() public view {
        assertEq(handler.stateViolations(), 0);
    }

    /// Campaign counters (log only: asserting here would also fail on Foundry's replayed/shrunk short sequences).
    function afterInvariant() public view {
        console2.log("swaps", handler.swaps(), "under broken reads", handler.brokenReadSwaps());
        console2.log("fallback-fee swaps", handler.fallbackSwaps());
    }

    /// Non-vacuity, deterministic: the handler really swaps on both paths and its checks see them.
    function test_handlerExercisesHealthyAndBrokenReads() public {
        handler.swap(0.01e18, true, false); // healthy read, sell base exact-in
        handler.swap(20e18, false, false); // healthy, buy base exact-in
        handler.swap(0.01e18, false, true); // healthy, exact-out
        handler.movePrice(150, 30, true, false);
        handler.nextBlock(10);
        handler.swap(0.01e18, true, false);
        for (uint8 mode = 5; mode <= 8; mode++) {
            handler.setFailure(mode, mode % 2 == 0); // revert / burn / empty / overflow, oracle or mark
            handler.swap(0.01e18, true, false);
            handler.nextBlock(5);
        }
        handler.setFailure(0, true);
        handler.swap(0.01e18, false, false);
        assertEq(handler.swaps(), 9);
        assertEq(handler.brokenReadSwaps(), 4);
        assertEq(handler.fallbackSwaps(), 4);
        assertEq(handler.unexpectedReverts(), 0);
        assertEq(handler.feeViolations(), 0);
        assertEq(handler.zeroFeeSwaps(), 0);
        assertEq(handler.stateViolations(), 0);
    }
}

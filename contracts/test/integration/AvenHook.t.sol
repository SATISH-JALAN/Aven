// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {IDynamicFeeHook} from "src/interfaces/IDynamicFeeHook.sol";
import {AvenFairValue as FV} from "src/AvenFairValue.sol";
import {AvenHook} from "src/AvenHook.sol";
import {IAvenHook} from "src/interfaces/IAvenHook.sol";
import {AvenTestBase} from "test/utils/AvenTestBase.sol";

/// @notice AvenHook against a real v4 PoolManager (ARCHITECTURE §9, PLAN 1.4). Base = token0 here; the subclass at
/// the bottom re-runs every test with base = token1.
contract AvenHookTest is AvenTestBase {
    using StateLibrary for *;

    uint256 constant ONE = 1e18;

    function setUp() public virtual {
        _setUpAven(true);
    }

    // ---------------------------------------------------------------- helpers

    /// Market moves so the pool is `bps` ABOVE fair (oracle and mark both lowered; premium 0).
    function _poolAboveFair(uint256 bps) internal returns (uint64 o) {
        o = uint64(uint256(ORACLE0) * 10_000 / (10_000 + bps));
        setOracle(o);
        setMark(o);
    }

    function _sell(PoolKey memory k, uint256 baseAmt) internal returns (SwapLog memory) {
        return swapLogged(k, sellBaseDir(), baseAmt);
    }

    function _buy(PoolKey memory k, uint256 quoteAmt) internal returns (SwapLog memory) {
        return swapLogged(k, !sellBaseDir(), quoteAmt);
    }

    function _recompute(SwapLog memory s) internal view returns (FV.Breakdown memory) {
        return FV.compute(cfg, prm, inputsOf(s));
    }

    function _wrapped(bytes4 hookSelector, bytes memory reason) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            address(hook),
            hookSelector,
            reason,
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }

    // ================================================================ §9 required named tests

    /// Splitting an arb into many swaps in one block doesn't lower its fee: every split pays the top-of-block gap.
    function test_splitSwapSameBlock_paysTopOfBlockGap() public {
        _poolAboveFair(180);
        SwapLog memory first = _sell(avenKey, 0.05e18);
        assertEq(first.reason, uint8(FV.Reason.OK));
        assertGt(first.fee, prm.baseFee);
        SwapLog memory last;
        for (uint256 i; i < 3; i++) {
            last = _sell(avenKey, 0.05e18);
            assertEq(last.fee, first.fee, "split swap paid less than the top-of-block gap");
            assertEq(last.sqrtPriceTopX96, first.sqrtPriceTopX96);
        }
        // Without the anchor, the last split would have paid only its current gap.
        FV.Inputs memory noAnchor = inputsOf(last);
        noAnchor.sqrtPriceTopX96 = last.sqrtPriceX96;
        assertLt(FV.compute(cfg, prm, noAnchor).fee, first.fee);
        // In the next block the anchor resets to the (now closer) price, so the fee is lower.
        nextBlock(1);
        SwapLog memory nb = _sell(avenKey, 0.05e18);
        assertLt(nb.fee, first.fee);
    }

    /// A dust swap can't erase the stress fee: the time-weighted anchor ignores swaps in the same second.
    function test_dustSwap_doesNotResetStress() public {
        _sell(avenKey, 1e9); // sets the anchor to the current mark
        uint64 m0 = poolStateOf(avenId).anchorMark;
        assertEq(m0, ORACLE0);

        nextBlock(10);
        uint64 m1 = uint64(uint256(m0) * 102 / 100); // mark +2% (oracle too, so premium stays 0)
        setMark(m1);
        setOracle(m1);
        SwapLog memory dustA = _sell(avenKey, 1e9); // selling is not arb (pool is below fair)
        SwapLog memory dustB = _sell(avenKey, 1e9); // same second
        SwapLog memory real = _sell(avenKey, 0.01e18); // same second

        assertEq(dustA.anchorMarkRaw, m0);
        uint64 a1 = uint64(uint256(m0) + (uint256(m1) - m0) * 10 / 60);
        assertEq(dustB.anchorMarkRaw, a1, "anchor moves by dt/tau, not to the mark");
        assertEq(real.anchorMarkRaw, a1, "same-second dust must not move the anchor");
        FV.Breakdown memory b = _recompute(real);
        assertFalse(b.arb);
        assertGt(b.moveBps, prm.stressThresholdBps + 100);
        assertEq(real.fee, prm.baseFee + (b.moveBps - prm.stressThresholdBps) * prm.stressWeight);
    }

    /// A reverting precompile never reverts the swap; it charges the fallback fee (I1).
    function test_precompileRevert_chargesFallback() public {
        oracleMock.setFail(true);
        SwapLog memory s = _sell(avenKey, 0.01e18);
        assertEq(s.reason, uint8(FV.Reason.READ_FAILED));
        assertEq(s.fee, prm.fallbackFee);
        assertEq(s.swapEventFee, prm.fallbackFee);
        oracleMock.setFail(false);
        markMock.setEmpty(true);
        s = _sell(avenKey, 0.01e18);
        assertEq(s.reason, uint8(FV.Reason.READ_FAILED));
        assertEq(s.swapEventFee, prm.fallbackFee);
    }

    /// A precompile that burns all forwarded gas costs the swap at most `precompileGas` extra; the swap succeeds.
    function test_precompileBurnsGas_capped() public {
        uint256 snap = vm.snapshotState();
        uint256 g = gasleft();
        swapExactIn(avenKey, sellBaseDir(), 0.01e18);
        uint256 normal = g - gasleft();
        vm.revertToState(snap);

        oracleMock.setBurn(true);
        g = gasleft();
        SwapLog memory s = _sell(avenKey, 0.01e18);
        uint256 burned = g - gasleft();
        assertEq(s.reason, uint8(FV.Reason.READ_FAILED));
        assertEq(s.swapEventFee, prm.fallbackFee);
        assertLe(burned, normal + prm.precompileGas + 20_000); // + log recording overhead in swapLogged
        emit log_named_uint("swap gas, normal read", normal);
        emit log_named_uint("swap gas, oracle burns its cap", burned);
    }

    function test_wrongPair_cannotInitialize() public {
        MockERC20 other = deployTokens(1, 2 ** 128)[0];
        (Currency c0, Currency c1) = Currency.unwrap(base) < address(other)
            ? (base, Currency.wrap(address(other)))
            : (Currency.wrap(address(other)), base);
        PoolKey memory k = PoolKey(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(hook)));
        vm.expectRevert(
            _wrapped(IHooks.beforeInitialize.selector, abi.encodeWithSelector(IAvenHook.WrongCurrencies.selector))
        );
        manager.initialize(k, SQRT_PRICE_1_1);
    }

    function test_staticFeePool_cannotInitialize() public {
        PoolKey memory k = PoolKey(currency0, currency1, 3000, 10, IHooks(address(hook)));
        vm.expectRevert(
            _wrapped(IHooks.beforeInitialize.selector, abi.encodeWithSelector(IAvenHook.MustUseDynamicFee.selector))
        );
        manager.initialize(k, SQRT_PRICE_1_1);
    }

    /// previewFee (and getFee) equal what beforeSwap then charges, in both directions, in a non-trivial state (I6).
    function test_previewEqualsCharged_bothDirections() public {
        _sell(avenKey, 1e9); // anchor
        nextBlock(20);
        uint64 o = _poolAboveFair(150);
        setMark(uint64(uint256(o) * 1003 / 1000)); // premium +30 bp
        for (uint256 d; d < 2; d++) {
            bool zeroForOne = d == 0;
            uint256 snap = vm.snapshotState();
            FV.Breakdown memory pv = hook.previewFee(avenKey, zeroForOne);
            (uint24 f01, uint24 f10) = hook.getFee(avenKey);
            SwapLog memory s = swapLogged(avenKey, zeroForOne, zeroForOne == sellBaseDir() ? 0.01e18 : 20e18);
            assertEq(s.fee, pv.fee, "charged != previewFee");
            assertEq(s.swapEventFee, pv.fee, "PoolManager fee != previewFee");
            assertEq(zeroForOne ? f01 : f10, pv.fee, "getFee != previewFee");
            assertEq(s.reason, uint8(pv.reason));
            vm.revertToState(snap);
        }
    }

    /// Every beforeSwap return carries the override flag: the PoolManager fee is never the stored 0 (I3).
    function test_overrideFlagAlwaysSet() public {
        (,,, uint24 storedLpFee) = manager.getSlot0(avenId);
        assertEq(storedLpFee, 0, "dynamic pool starts at LP fee 0");
        uint256 snap = vm.snapshotState();

        SwapLog memory ok = _sell(avenKey, 0.01e18); // normal
        assertEq(ok.reason, uint8(FV.Reason.OK));
        assertEq(ok.swapEventFee, ok.fee);
        assertGt(ok.swapEventFee, 0);
        vm.revertToState(snap);

        oracleMock.setFail(true); // read failed
        SwapLog memory rf = _sell(avenKey, 0.01e18);
        assertEq(rf.swapEventFee, prm.fallbackFee);
        vm.revertToState(snap);

        _poolAboveFair(2_600); // gap too large
        SwapLog memory gt = _sell(avenKey, 0.01e18);
        assertEq(gt.reason, uint8(FV.Reason.GAP_TOO_LARGE));
        assertEq(gt.swapEventFee, prm.fallbackFee);

        (,,, storedLpFee) = manager.getSlot0(avenId);
        assertEq(storedLpFee, 0, "fee was never persisted; every swap used the override");
    }

    /// Sandwich: the back leg closes a gap the attacker opened, so it is classified arb and pays the gap fee.
    function test_sandwichBackLeg_paysGapFee() public {
        SwapLog memory front = _buy(avenKey, 150e18); // attacker buys base: pool at fair, not arb
        assertEq(front.fee, prm.baseFee);
        SwapLog memory victim = _buy(avenKey, 60e18); // victim buys base
        assertEq(victim.fee, prm.baseFee);
        FV.Breakdown memory back = hook.previewFee(avenKey, sellBaseDir());
        assertTrue(back.arb);
        assertGt(back.gapBps, 0);
        SwapLog memory backLeg = _sell(avenKey, 0.1e18); // attacker sells base back
        assertEq(backLeg.fee, back.fee);
        uint256 expected = prm.baseFee + back.gapBps * prm.gapWeight;
        if (expected > prm.maxFee) expected = prm.maxFee; // §6.3 Step 8 clamp
        assertEq(backLeg.fee, expected);
        assertGt(backLeg.fee, prm.baseFee);
    }

    // ================================================================ more P3 checks

    function test_arbDirectionPaysMoreThanReverse() public {
        _poolAboveFair(120);
        (uint24 f01, uint24 f10) = hook.getFee(avenKey);
        (uint24 sellFee, uint24 buyFee) = sellBaseDir() ? (f01, f10) : (f10, f01);
        assertGt(sellFee, buyFee);
        assertEq(buyFee, prm.baseFee);
    }

    function test_getFeeEqualsPreviewFee() public {
        _poolAboveFair(90);
        setMark(uint64(uint256(ORACLE0) * 995 / 1000));
        (uint24 f01, uint24 f10) = hook.getFee(avenKey);
        assertEq(f01, hook.previewFee(avenKey, true).fee);
        assertEq(f10, hook.previewFee(avenKey, false).fee);
    }

    function test_unknownPool_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IDynamicFeeHook.PoolNotInitialized.selector, controlId));
        hook.getFee(controlKey);
        vm.expectRevert(abi.encodeWithSelector(IDynamicFeeHook.PoolNotInitialized.selector, controlId));
        hook.previewFee(controlKey, true);
    }

    function test_controlPool_fixedFeeNoHook() public {
        SwapLog memory s = _sell(controlKey, 0.01e18);
        assertFalse(s.hasFeeComputed);
        assertEq(s.swapEventFee, 3000);
    }

    /// Recomputing from the FeeComputed fields alone reproduces the charged fee (I8), for OK and both fallbacks.
    function test_feeComputedIsRecomputable() public {
        _sell(avenKey, 1e9);
        nextBlock(30);
        _poolAboveFair(160);
        setMark(uint64(uint256(ORACLE0) * 1004 / 1000));
        SwapLog memory a = _sell(avenKey, 0.02e18);
        SwapLog memory b = _buy(avenKey, 30e18);
        markMock.setFail(true);
        SwapLog memory c = _sell(avenKey, 0.01e18);
        markMock.setFail(false);
        _poolAboveFair(2_500);
        SwapLog memory d = _sell(avenKey, 0.01e18);
        SwapLog[4] memory all = [a, b, c, d];
        for (uint256 i; i < 4; i++) {
            FV.Breakdown memory r = _recompute(all[i]);
            assertEq(r.fee, all[i].fee);
            assertEq(uint8(r.reason), all[i].reason);
            assertEq(all[i].swapEventFee, all[i].fee);
        }
    }

    /// I9: top-of-block is set only by the first swap of a block; the anchor changes only when both reads succeed.
    function test_topOfBlockAndAnchorUpdateRules() public {
        uint160 p0 = sqrtPrice(avenId);
        _sell(avenKey, 0.05e18);
        IAvenHook.PoolState memory s1 = poolStateOf(avenId);
        assertEq(s1.topBlock, block.number);
        assertEq(s1.sqrtPriceTopX96, p0);
        _sell(avenKey, 0.05e18); // same block
        assertEq(poolStateOf(avenId).sqrtPriceTopX96, p0, "top changed on a later swap in the same block");

        nextBlock(15);
        uint160 p1 = sqrtPrice(avenId);
        setMark(ORACLE0 + 500);
        oracleMock.setFail(true);
        _sell(avenKey, 0.01e18);
        IAvenHook.PoolState memory s2 = poolStateOf(avenId);
        assertEq(s2.sqrtPriceTopX96, p1, "top-of-block still advances on a failed read");
        assertEq(s2.anchorMark, s1.anchorMark, "anchor moved on a failed read");
        assertEq(s2.anchorTime, s1.anchorTime);
    }

    /// I4: the hook never holds tokens.
    function test_hookHoldsNoTokens() public {
        _poolAboveFair(100);
        _sell(avenKey, 0.1e18);
        _buy(avenKey, 300e18);
        assertEq(currency0.balanceOf(address(hook)), 0);
        assertEq(currency1.balanceOf(address(hook)), 0);
    }

    function test_views() public view {
        FV.Config memory c = hook.config();
        assertEq(c.perpIndex, PERP);
        assertEq(c.szDecimals, 4);
        assertEq(c.baseIsToken0, cfg.baseIsToken0);
        FV.Params memory p = hook.params();
        assertEq(p.baseFee, 500);
        assertEq(p.precompileGas, 30_000);
        assertEq(Currency.unwrap(hook.baseCurrency()), Currency.unwrap(base));
        assertEq(Currency.unwrap(hook.quoteCurrency()), Currency.unwrap(quote));
        assertTrue(poolStateOf(avenId).initialized);
        Hooks.Permissions memory perms = hook.getHookPermissions();
        assertTrue(perms.beforeInitialize && perms.beforeSwap);
        assertFalse(perms.afterSwap || perms.beforeSwapReturnDelta || perms.afterInitialize);
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, 0x2080);
    }

    /// Constructor validation, deployed through a mined CREATE2 salt (the real deployment path, recon decision 3).
    function test_constructor_rejectsBadConfig() public {
        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        FV.Config memory bad = cfg;
        bad.baseIsToken0 = !cfg.baseIsToken0; // inconsistent with the currencies
        _expectCtorRevert(flags, abi.encode(manager, bad, prm, base, quote));
        _expectCtorRevert(flags, abi.encode(manager, cfg, prm, base, base)); // same currency
        _expectCtorRevert(flags, abi.encode(manager, cfg, prm, Currency.wrap(address(0)), quote)); // native
        FV.Params memory badP = prm;
        badP.precompileGas = 1_000;
        _expectCtorRevert(flags, abi.encode(manager, cfg, badP, base, quote)); // invalid params
    }

    function _expectCtorRevert(uint160 flags, bytes memory args) internal {
        (, bytes32 salt) = HookMiner.find(address(this), flags, type(AvenHook).creationCode, args);
        vm.expectRevert(IAvenHook.InvalidParams.selector);
        this.deployRaw(abi.encodePacked(type(AvenHook).creationCode, args), salt);
    }

    /// CREATE2 from this contract (the HookMiner deployer), bubbling up constructor revert data. It must be an external
    /// call: vm.expectRevert does not enforce against an inline-assembly CREATE2 in the test's own frame.
    function deployRaw(bytes memory initCode, bytes32 salt) external returns (address a) {
        assembly {
            a := create2(0, add(initCode, 0x20), mload(initCode), salt)
            if iszero(a) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
    }

    /// Positive control for the path above: valid args deploy at exactly the mined address with the 0x2080 bits.
    function test_constructor_minedDeploySucceeds() public {
        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory args = abi.encode(manager, cfg, prm, base, quote);
        (address want, bytes32 salt) = HookMiner.find(address(this), flags, type(AvenHook).creationCode, args);
        address got = this.deployRaw(abi.encodePacked(type(AvenHook).creationCode, args), salt);
        assertEq(got, want);
        assertEq(uint160(got) & Hooks.ALL_HOOK_MASK, flags);
        assertGt(got.code.length, 0);
    }

    /// beforeSwap alone, called exactly as the PoolManager calls it (§6.7): first swap of a pool (cold storage) and a
    /// later swap in a new block (warm, non-zero slots). Uses snapshots so pool state is untouched.
    function test_gas_beforeSwapDirect() public {
        SwapParams memory sp = SwapParams({
            zeroForOne: sellBaseDir(),
            amountSpecified: -0.01e18,
            sqrtPriceLimitX96: sellBaseDir() ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });
        uint256 snap = vm.snapshotState();
        vm.prank(address(manager));
        uint256 g = gasleft();
        hook.beforeSwap(address(swapRouter), avenKey, sp, ZERO_BYTES);
        uint256 cold = g - gasleft();
        vm.revertToState(snap);
        _sell(avenKey, 1e9); // a first swap initialises the hook's state
        nextBlock(5);
        vm.prank(address(manager));
        g = gasleft();
        hook.beforeSwap(address(swapRouter), avenKey, sp, ZERO_BYTES);
        uint256 warm = g - gasleft();
        emit log_named_uint("beforeSwap gas (first swap, cold)", cold);
        emit log_named_uint("beforeSwap gas (later block, warm)", warm);
        // Ceiling only: this direct call also pays the test harness's external call + ABI decoding. The section 6.7 number is
        // the in-swap overhead from test_gas_beforeSwapOverhead (~47k with the mock precompile).
        assertLt(cold, 100_000);
        assertLt(warm, 100_000);
    }

    /// Logs the hook's beforeSwap overhead (Aven swap minus identical control swap), for §6.7 / P11.
    function test_gas_beforeSwapOverhead() public {
        _sell(avenKey, 1e9); // warm the hook's storage like a live pool
        _sell(controlKey, 1e9);
        nextBlock(5);
        uint256 g = gasleft();
        swapExactIn(controlKey, sellBaseDir(), 0.01e18);
        uint256 control = g - gasleft();
        g = gasleft();
        swapExactIn(avenKey, sellBaseDir(), 0.01e18);
        uint256 aven = g - gasleft();
        emit log_named_uint("control swap gas", control);
        emit log_named_uint("aven swap gas", aven);
        emit log_named_uint("hook overhead gas", aven - control);
        assertLt(aven - control, 60_000); // §6.7 estimate ~35-45k; must stay far under the 3M small block
    }
}

/// Same suite with the base token as currency1 (exercises the other poolWad branch and direction mapping).
contract AvenHookBaseToken1Test is AvenHookTest {
    function setUp() public override {
        _setUpAven(false);
    }
}

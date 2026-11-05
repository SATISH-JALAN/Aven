// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {AvenFairValue as FV} from "./AvenFairValue.sol";
import {IAvenHook} from "./interfaces/IAvenHook.sol";

/// @title AvenHook
/// @notice Reference Uniswap v4 hook for AvenFairValue: before every swap it reads HyperCore's oracle and mark price
/// in-block and charges a clamped, direction-specific override fee that accrues to LPs.
/// @dev docs/spec/ARCHITECTURE.md §6.4-§6.5. One instance per (perp, base token, quote token). Permissions:
/// beforeInitialize + beforeSwap only (address low bits 0x2080). No owner, setters, proxy, receive or token handling;
/// everything is immutable. A price read can never revert a swap (I1); every return sets the override flag (I3).
contract AvenHook is BaseHook, IAvenHook {
    using StateLibrary for IPoolManager;

    // Config (§6.2), unpacked into immutables.
    uint32 internal immutable _perpIndex;
    uint8 internal immutable _szDecimals;
    bool internal immutable _baseIsToken0;
    uint8 internal immutable _decimals0;
    uint8 internal immutable _decimals1;
    // Params (§6.2), unpacked into immutables.
    uint24 internal immutable _baseFee;
    uint24 internal immutable _minFee;
    uint24 internal immutable _maxFee;
    uint24 internal immutable _fallbackFee;
    uint32 internal immutable _gapWeight;
    uint32 internal immutable _premiumWeight;
    uint32 internal immutable _stressThresholdBps;
    uint32 internal immutable _stressWeight;
    uint32 internal immutable _stressTauSec;
    uint32 internal immutable _maxGapBps;
    uint32 internal immutable _precompileGas;

    /// @notice The only currency pair this hook prices (§6.5: stops attaching the hook to an unrelated pair).
    Currency public immutable baseCurrency;
    Currency public immutable quoteCurrency;

    mapping(PoolId => PoolState) internal _state;

    /// @dev Reverts InvalidParams unless AvenFairValue.validateParams passes and the currencies are distinct,
    /// non-native, and consistent with cfg.baseIsToken0 (§6.2).
    constructor(IPoolManager poolManager_, FV.Config memory cfg, FV.Params memory p, Currency base, Currency quote)
        BaseHook(poolManager_)
    {
        FV.validateParams(cfg, p);
        if (Currency.unwrap(base) == Currency.unwrap(quote)) revert InvalidParams();
        if (base.isAddressZero() || quote.isAddressZero()) revert InvalidParams();
        if (cfg.baseIsToken0 != (Currency.unwrap(base) < Currency.unwrap(quote))) revert InvalidParams();

        _perpIndex = cfg.perpIndex;
        _szDecimals = cfg.szDecimals;
        _baseIsToken0 = cfg.baseIsToken0;
        _decimals0 = cfg.decimals0;
        _decimals1 = cfg.decimals1;
        _baseFee = p.baseFee;
        _minFee = p.minFee;
        _maxFee = p.maxFee;
        _fallbackFee = p.fallbackFee;
        _gapWeight = p.gapWeight;
        _premiumWeight = p.premiumWeight;
        _stressThresholdBps = p.stressThresholdBps;
        _stressWeight = p.stressWeight;
        _stressTauSec = p.stressTauSec;
        _maxGapBps = p.maxGapBps;
        _precompileGas = p.precompileGas;
        baseCurrency = base;
        quoteCurrency = quote;
    }

    /// @notice beforeInitialize + beforeSwap only (§6.5).
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ------------------------------------------------------------------------------------------------ hooks

    /// @dev §6.5: only dynamic-fee pools of exactly {base, quote} may use this hook (I10).
    function _beforeInitialize(address, PoolKey calldata key, uint160) internal override returns (bytes4) {
        if (key.fee != LPFeeLibrary.DYNAMIC_FEE_FLAG) revert MustUseDynamicFee();
        (Currency c0, Currency c1) = _sorted();
        if (
            Currency.unwrap(key.currency0) != Currency.unwrap(c0)
                || Currency.unwrap(key.currency1) != Currency.unwrap(c1)
        ) {
            revert WrongCurrencies();
        }
        _state[key.toId()].initialized = true;
        return IHooks.beforeInitialize.selector;
    }

    /// @dev §6.4: _load -> persist -> emit FeeComputed -> return fee | OVERRIDE_FEE_FLAG (always, I3).
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata swapParams, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        (PoolState memory s, FV.Inputs memory inp) = _load(id);
        inp.zeroForOne = swapParams.zeroForOne;
        FV.Breakdown memory b = FV.compute(_config(), _params(), inp);
        _state[id] = s;
        // The only external calls before this are STATICCALLs (precompile reads) and extsload (getSlot0): no state
        // change or reentrancy is possible, and _beforeSwap is onlyPoolManager.
        // forge-lint: disable-start(reentrancy-events)
        emit FeeComputed(
            id,
            sender,
            b.fee,
            uint8(b.reason),
            inp.zeroForOne,
            inp.oracleRaw,
            inp.markRaw,
            inp.anchorMarkRaw,
            inp.sqrtPriceX96,
            inp.sqrtPriceTopX96
        );
        // forge-lint: disable-end(reentrancy-events)
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, b.fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    // ------------------------------------------------------------------------------------------------ views

    /// @inheritdoc IAvenHook
    function previewFee(PoolKey calldata key, bool zeroForOne) external view returns (FV.Breakdown memory) {
        PoolId id = _requireInitialized(key);
        (, FV.Inputs memory inp) = _load(id);
        inp.zeroForOne = zeroForOne;
        return FV.compute(_config(), _params(), inp);
    }

    /// @notice Uniswap IDynamicFeeHook: the LP fee each direction would pay this block. Size-independent.
    /// @dev Reads the precompiles once and computes both directions from the same inputs (== two previewFee calls).
    function getFee(PoolKey calldata key) external view returns (uint24 feeE6ZeroForOne, uint24 feeE6OneForZero) {
        PoolId id = _requireInitialized(key);
        (, FV.Inputs memory inp) = _load(id);
        FV.Config memory c = _config();
        FV.Params memory p = _params();
        inp.zeroForOne = true;
        feeE6ZeroForOne = FV.compute(c, p, inp).fee;
        inp.zeroForOne = false;
        feeE6OneForZero = FV.compute(c, p, inp).fee;
    }

    function poolState(PoolId id) external view returns (PoolState memory) {
        return _state[id];
    }

    function config() external view returns (FV.Config memory) {
        return _config();
    }

    function params() external view returns (FV.Params memory) {
        return _params();
    }

    // ------------------------------------------------------------------------------------------------ internals

    /// @dev §6.4 _load, computed in memory without writing: advance top-of-block, read prices, record the anchor the
    /// fee uses (before this swap's update), then advance the anchor only if both reads succeeded (I9).
    function _load(PoolId id) internal view returns (PoolState memory s, FV.Inputs memory inp) {
        s = _state[id];
        (uint160 sqrtP,,,) = poolManager.getSlot0(id);
        if (block.number > s.topBlock) {
            // casting to 'uint64' is safe because block numbers stay far below 2^64
            // forge-lint: disable-next-line(unsafe-typecast)
            s.topBlock = uint64(block.number);
            s.sqrtPriceTopX96 = sqrtP;
        }
        (bool ok, uint64 oracleRaw, uint64 markRaw) = FV.readPrices(_perpIndex, _precompileGas);
        inp.oracleRaw = oracleRaw;
        inp.markRaw = markRaw;
        inp.anchorMarkRaw = s.anchorMark;
        inp.sqrtPriceX96 = sqrtP;
        inp.sqrtPriceTopX96 = s.sqrtPriceTopX96;
        inp.readOk = ok;
        if (ok) {
            (s.anchorMark, s.anchorTime) =
            // casting to 'uint40' is safe because timestamps stay below 2^40 until the year 36812
            // forge-lint: disable-next-line(unsafe-typecast)
            FV.advanceAnchor(s.anchorMark, s.anchorTime, markRaw, uint40(block.timestamp), _stressTauSec);
        }
    }

    function _requireInitialized(PoolKey calldata key) internal view returns (PoolId id) {
        id = key.toId();
        if (!_state[id].initialized) revert PoolNotInitialized(id);
    }

    function _sorted() internal view returns (Currency c0, Currency c1) {
        (c0, c1) = _baseIsToken0 ? (baseCurrency, quoteCurrency) : (quoteCurrency, baseCurrency);
    }

    function _config() internal view returns (FV.Config memory) {
        return FV.Config({
            perpIndex: _perpIndex,
            szDecimals: _szDecimals,
            baseIsToken0: _baseIsToken0,
            decimals0: _decimals0,
            decimals1: _decimals1
        });
    }

    function _params() internal view returns (FV.Params memory) {
        return FV.Params({
            baseFee: _baseFee,
            minFee: _minFee,
            maxFee: _maxFee,
            fallbackFee: _fallbackFee,
            gapWeight: _gapWeight,
            premiumWeight: _premiumWeight,
            stressThresholdBps: _stressThresholdBps,
            stressWeight: _stressWeight,
            stressTauSec: _stressTauSec,
            maxGapBps: _maxGapBps,
            precompileGas: _precompileGas
        });
    }
}

// SPDX-License-Identifier: MIT
// Copied verbatim from Uniswap/v4-hooks-public (MIT License, Copyright (c) 2026 Universal Navigation Inc.)
// Source: https://github.com/Uniswap/v4-hooks-public/blob/c45509f3cafb044219dcd08faff5b68370ac61d6/src/interfaces/IDynamicFeeHook.sol
// Kept as a local copy so Aven does not depend on v4-hooks-public (ARCHITECTURE §2.5, §6.1).
pragma solidity ^0.8.0;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

/// @title IDynamicFeeHook
interface IDynamicFeeHook {
    /// @notice Thrown when an operation targets a pool that has no fee configuration, i.e. was
    ///         never initialized through the hook.
    /// @param poolId The id of the uninitialized pool
    error PoolNotInitialized(PoolId poolId);

    /// @notice The LP fee a swap would be charged this block, per direction.
    /// @dev The returned fee MUST be size-independent: it does not depend on the swap amount.
    ///      A hook whose fee depends on swap size MUST revert here instead of returning a misleading value
    /// @param key The PoolKey of the pool
    /// @return feeE6ZeroForOne The fee for a zeroForOne swap this block
    /// @return feeE6OneForZero The fee for a oneForZero swap this block
    function getFee(PoolKey calldata key) external view returns (uint24 feeE6ZeroForOne, uint24 feeE6OneForZero);
}

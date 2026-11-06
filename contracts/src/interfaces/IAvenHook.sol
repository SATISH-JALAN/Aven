// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IDynamicFeeHook} from "src/interfaces/IDynamicFeeHook.sol";
import {AvenFairValue} from "src/AvenFairValue.sol";

/// @title IAvenHook
/// @notice Aven's hook interface (docs/spec/ARCHITECTURE.md §6.5, §8.1). Extends Uniswap's IDynamicFeeHook, so
/// anything that quotes Uniswap's dynamic-fee hooks via getFee(key) can quote Aven.
interface IAvenHook is IDynamicFeeHook {
    /// @notice Per-pool state, two storage slots (§6.4).
    struct PoolState {
        uint64 topBlock; // block.number of the stored top-of-block price
        uint160 sqrtPriceTopX96; // pool price at the first swap of topBlock      (slot 1: 224 bits)
        uint64 anchorMark; // time-weighted mark anchor (raw)
        uint40 anchorTime; // block.timestamp of last anchor update          (slot 2: 104 bits)
        bool initialized; // set in beforeInitialize
    }

    /// @notice Every input needed to recompute `fee` off-chain (§8.1, I8). Field order is part of the ABI.
    event FeeComputed(
        PoolId indexed poolId,
        address indexed sender,
        uint24 fee,
        uint8 reason,
        bool zeroForOne,
        uint64 oracleRaw,
        uint64 markRaw,
        uint64 anchorMarkRaw,
        uint160 sqrtPriceX96,
        uint160 sqrtPriceTopX96
    );

    error MustUseDynamicFee();
    error WrongCurrencies();
    error InvalidParams();

    /// @notice Full breakdown of the fee a swap in `zeroForOne` direction would pay now (same as beforeSwap, I6).
    function previewFee(PoolKey calldata key, bool zeroForOne) external view returns (AvenFairValue.Breakdown memory);

    function poolState(PoolId id) external view returns (PoolState memory);

    function config() external view returns (AvenFairValue.Config memory);

    function params() external view returns (AvenFairValue.Params memory);
}

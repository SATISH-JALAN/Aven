// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AvenFairValue as FV} from "src/AvenFairValue.sol";

/// @notice Inverse of AvenFairValue.poolWad: the sqrtPriceX96 at which the pool's base price equals `wad`.
/// Used by tests and by CreatePools.s.sol to initialise pools at the oracle price (PLAN 3.1).
library PriceMath {
    function sqrtPriceFromWad(FV.Config memory c, uint256 wad) internal pure returns (uint160) {
        uint256 q192 = uint256(2 ** 192);
        uint256 x = c.baseIsToken0
            ? FullMath.mulDiv(wad * 10 ** uint256(c.decimals1), q192, 10 ** (18 + uint256(c.decimals0)))
            : FullMath.mulDiv(10 ** (18 + uint256(c.decimals1)), q192, wad * 10 ** uint256(c.decimals0));
        // casting to 'uint160' is safe because sqrt of a < 2^256 value is < 2^128
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint160(Math.sqrt(x));
    }
}

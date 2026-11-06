// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {AvenFairValue as FV} from "src/AvenFairValue.sol";
import {AvenHook} from "src/AvenHook.sol";
import {AvenScript} from "script/base/AvenScript.sol";

/// @notice Step 3 of §11.3: check the perp via perpAssetInfo (0x80a), derive Config from the tokens, mine a CREATE2 salt
/// for permission bits 0x2080 against the CREATE2 proxy (recon decision 3) and deploy AvenHook with defaultParams.
/// Live asset (MEMORY.md 2026-11-06): testnet ETH, perp 4, szDecimals 4. Override with PERP_INDEX / EXPECT_COIN.
contract DeployAven is AvenScript {
    struct PerpAssetInfo {
        string coin;
        uint32 marginTableId;
        uint8 szDecimals;
        uint8 maxLeverage;
        bool onlyIsolated;
    }

    address internal constant PERP_ASSET_INFO = 0x000000000000000000000000000000000000080a;

    function run() external {
        Wip memory w = _loadWip();
        uint32 perpIndex = uint32(vm.envOr("PERP_INDEX", uint256(4)));
        PerpAssetInfo memory info = _checkPerp(perpIndex, vm.envOr("EXPECT_COIN", string("ETH")));
        FV.Config memory cfg = _config(w, perpIndex, info.szDecimals);
        (address hook, bytes32 salt) = _deploy(w, cfg, FV.defaultParams());
        w.hook = hook;
        w.hookSalt = salt;
        w.perpIndex = perpIndex;
        w.szDecimals = info.szDecimals;
        _saveWip(w);
        console2.log("AvenHook", hook);
        console2.logBytes32(salt);
    }

    /// perpAssetInfo returns ONE struct (recon C.2); require the expected coin.
    function _checkPerp(uint32 perpIndex, string memory expectCoin) internal returns (PerpAssetInfo memory info) {
        (bool ok, bytes memory ret) = _precompileCall(PERP_ASSET_INFO, abi.encode(perpIndex)); // live chain: via the node
        require(ok && ret.length > 0, "perpAssetInfo read failed");
        info = abi.decode(ret, (PerpAssetInfo));
        require(keccak256(bytes(info.coin)) == keccak256(bytes(expectCoin)), "perpAssetInfo coin mismatch");
        console2.log("perp", perpIndex, info.coin);
        console2.log("szDecimals", info.szDecimals);
    }

    function _config(Wip memory w, uint32 perpIndex, uint8 szDecimals) internal view returns (FV.Config memory cfg) {
        bool baseIsToken0 = w.base < w.quote;
        (address c0, address c1) = baseIsToken0 ? (w.base, w.quote) : (w.quote, w.base);
        cfg = FV.Config({
            perpIndex: perpIndex,
            szDecimals: szDecimals,
            baseIsToken0: baseIsToken0,
            decimals0: MockERC20(c0).decimals(),
            decimals1: MockERC20(c1).decimals()
        });
    }

    /// Mine a salt against the CREATE2 proxy for bits 0x2080, deploy through it, and check the address.
    function _deploy(Wip memory w, FV.Config memory cfg, FV.Params memory p)
        internal
        returns (address hook, bytes32 salt)
    {
        bytes memory args =
            abi.encode(IPoolManager(w.poolManager), cfg, p, Currency.wrap(w.base), Currency.wrap(w.quote));
        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        address mined;
        (mined, salt) = HookMiner.find(CREATE2_DEPLOYER, flags, type(AvenHook).creationCode, args);
        vm.startBroadcast(_deployerKey());
        hook = address(
            new AvenHook{salt: salt}(IPoolManager(w.poolManager), cfg, p, Currency.wrap(w.base), Currency.wrap(w.quote))
        );
        vm.stopBroadcast();
        require(hook == mined, "hook address != mined address");
        require(uint160(hook) & Hooks.ALL_HOOK_MASK == flags, "hook permission bits");
    }
}

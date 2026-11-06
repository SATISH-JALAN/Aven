// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {AvenScript} from "script/base/AvenScript.sol";

/// @notice Step 1 of §11.3: Uniswap v4 PoolManager + test routers (none exist on HyperEVM testnet, recon B.5).
///
/// The PoolManager comes from the separate v4-core-profile build, so it is byte-identical to Uniswap's canonical
/// HyperEVM mainnet PoolManager (recon A.5). Build it first:
///     FOUNDRY_PROFILE=v4core forge build lib/v4-core/src/PoolManager.sol
///
/// ON HYPEREVM TESTNET (chain 998) the PoolManager (~24 KB, ~4.8M gas of code deposit) does not fit a 3M-gas small
/// block. Before running this script, switch the deployer to big blocks (recon B.6; docs/DEPLOYMENTS.md):
///     1. make the deployer a HyperCore user (it must hold a Core asset, e.g. receive testnet USDC on Core);
///     2. send {"type":"evmUserModify","usingBigBlocks":true} signed by the deployer to
///        https://api.hyperliquid-testnet.xyz/exchange (Python SDK: Exchange(...).use_big_blocks(True));
///     3. check `eth_usingBigBlocks(<deployer>)` returns true.
/// After this script, switch back with use_big_blocks(False) so the rest deploys in fast small blocks.
///
/// initialOwner = address(0): nobody can ever set a protocol fee on this PoolManager (no admin keys; keeps verify
/// check B exact). Override with PM_OWNER only if you know why.
///
/// ON HYPEREVM MAINNET (chain 999) Uniswap's canonical PoolManager already exists and is byte-identical to our build
/// apart from its NoDelegateCall immutable (recon D). The script REUSES it (no big blocks, no HyperCore-user step):
/// POOL_MANAGER defaults to it on 999 and can be set on any chain to reuse another existing PoolManager.
contract DeployCore is AvenScript {
    address internal constant UNISWAP_POOL_MANAGER_999 = 0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F;

    function run() external {
        address owner = vm.envOr("PM_OWNER", address(0));
        address existing = vm.envOr("POOL_MANAGER", block.chainid == 999 ? UNISWAP_POOL_MANAGER_999 : address(0));

        uint256 key = _deployerKey();
        vm.startBroadcast(key);
        uint256 atBlock = block.number;
        address pm;
        if (existing != address(0)) {
            require(existing.code.length > 0, "POOL_MANAGER has no code on this chain");
            pm = existing;
        } else {
            bytes memory initCode = abi.encodePacked(vm.getCode("out-v4core/PoolManager.sol/PoolManager.json"), abi.encode(owner));
            assembly {
                pm := create(0, add(initCode, 0x20), mload(initCode))
            }
            require(pm != address(0), "PoolManager deploy failed (big blocks on? see header)");
        }
        PoolSwapTest swapRouter = new PoolSwapTest(IPoolManager(pm));
        PoolModifyLiquidityTest liqRouter = new PoolModifyLiquidityTest(IPoolManager(pm));
        vm.stopBroadcast();

        Wip memory w;
        w.deployedAtBlock = atBlock;
        w.poolManager = pm;
        w.swapRouter = address(swapRouter);
        w.liquidityRouter = address(liqRouter);
        _saveWip(w);

        console2.log("PoolManager           ", pm);
        console2.log("PoolSwapTest          ", address(swapRouter));
        console2.log("PoolModifyLiquidityTest", address(liqRouter));
        if (existing != address(0)) console2.log("PoolManager reused (existing, not deployed)");
        else console2.log("PoolManager owner     ", owner);
        console2.log("wrote", _wipPath());
        if (block.chainid == 998) {
            console2.log("NEXT: switch big blocks OFF: Exchange(...).use_big_blocks(False)  (docs/DEPLOYMENTS.md)");
        }
    }
}

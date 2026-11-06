// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";

/// @notice Shared plumbing for the deploy scripts (PLAN 3.1, ARCHITECTURE §11.3). State between the five scripts is
/// kept in contracts/deployments/<chainId>.wip.json (gitignored). CreatePools writes the final, schema-exact
/// contracts/deployments/<chainId>.json (§8.3). Keys come from contracts/.env and are never printed.
abstract contract AvenScript is Script {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    struct Wip {
        uint256 deployedAtBlock;
        address poolManager;
        address swapRouter;
        address liquidityRouter;
        address base;
        address quote;
        string baseSymbol;
        string quoteSymbol;
        address hook;
        bytes32 hookSalt;
        uint256 perpIndex;
        uint256 szDecimals;
    }

    function _deployerKey() internal view returns (uint256) {
        return vm.envUint("DEPLOYER_PK");
    }

    function _wipPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".wip.json");
    }

    function _finalPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
    }

    function _loadWip() internal view returns (Wip memory w) {
        string memory j = vm.readFile(_wipPath());
        w.deployedAtBlock = vm.parseJsonUint(j, ".deployedAtBlock");
        w.poolManager = vm.parseJsonAddress(j, ".poolManager");
        w.swapRouter = vm.parseJsonAddress(j, ".swapRouter");
        w.liquidityRouter = vm.parseJsonAddress(j, ".liquidityRouter");
        w.base = vm.parseJsonAddress(j, ".base");
        w.quote = vm.parseJsonAddress(j, ".quote");
        w.baseSymbol = vm.parseJsonString(j, ".baseSymbol");
        w.quoteSymbol = vm.parseJsonString(j, ".quoteSymbol");
        w.hook = vm.parseJsonAddress(j, ".hook");
        w.hookSalt = vm.parseJsonBytes32(j, ".hookSalt");
        w.perpIndex = vm.parseJsonUint(j, ".perpIndex");
        w.szDecimals = vm.parseJsonUint(j, ".szDecimals");
    }

    function _saveWip(Wip memory w) internal {
        string memory o = "wip";
        vm.serializeUint(o, "deployedAtBlock", w.deployedAtBlock);
        vm.serializeAddress(o, "poolManager", w.poolManager);
        vm.serializeAddress(o, "swapRouter", w.swapRouter);
        vm.serializeAddress(o, "liquidityRouter", w.liquidityRouter);
        vm.serializeAddress(o, "base", w.base);
        vm.serializeAddress(o, "quote", w.quote);
        vm.serializeString(o, "baseSymbol", w.baseSymbol);
        vm.serializeString(o, "quoteSymbol", w.quoteSymbol);
        vm.serializeAddress(o, "hook", w.hook);
        vm.serializeBytes32(o, "hookSalt", w.hookSalt);
        vm.serializeUint(o, "perpIndex", w.perpIndex);
        string memory j = vm.serializeUint(o, "szDecimals", w.szDecimals);
        vm.createDir(string.concat(vm.projectRoot(), "/deployments"), true);
        vm.writeJson(j, _wipPath());
    }

    // ------------------------------------------------------------------------------------------------ precompile reads

    /// @notice Read a HyperCore precompile from a script. On a real HyperEVM chain the precompile addresses have NO code
    /// (eth_getCode = 0x, recon §E). Forge simulates every script in its own EVM first, where a staticcall to them
    /// "succeeds" with 0 bytes, so a direct read breaks the deploy before anything is broadcast (found by the pre-mainnet
    /// audit, 2026-11-06). There, ask the node instead (vm.rpc eth_call: the real precompile answers). Where code
    /// exists (the local chain or a fork with MockHyperCorePx etched), staticcall it as before.
    function _precompileCall(address precompile, bytes memory data) internal returns (bool ok, bytes memory ret) {
        if (precompile.code.length > 0) return precompile.staticcall(data);
        string memory params =
            string.concat('[{"to":"', vm.toString(precompile), '","data":"', vm.toString(data), '"},"latest"]');
        ret = vm.rpc("eth_call", params);
        ok = true;
    }

    /// @notice Oracle (0x807) and mark (0x806) for `perpIndex`, with AvenFairValue's readOk rule: both answer at least
    /// 32 bytes, and each value is > 0 and fits in uint64.
    function _readOracleMark(uint32 perpIndex) internal returns (bool readOk, uint64 oracleRaw, uint64 markRaw) {
        bool okO;
        bool okM;
        (okO, oracleRaw) = _readPx(0x0000000000000000000000000000000000000807, perpIndex);
        (okM, markRaw) = _readPx(0x0000000000000000000000000000000000000806, perpIndex);
        readOk = okO && okM;
    }

    function _readPx(address precompile, uint32 perpIndex) private returns (bool ok, uint64 px) {
        (bool success, bytes memory ret) = _precompileCall(precompile, abi.encode(perpIndex));
        if (!success || ret.length < 32) return (false, 0);
        uint256 w = abi.decode(ret, (uint256));
        if (w == 0 || w > type(uint64).max) return (false, 0);
        // casting to 'uint64' is safe because w <= type(uint64).max was just checked
        // forge-lint: disable-next-line(unsafe-typecast)
        return (true, uint64(w));
    }
}

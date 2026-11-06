// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
// Recon §A: these exact import paths must compile with contracts/remappings.txt.
import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IDynamicFeeHook} from "src/interfaces/IDynamicFeeHook.sol";

/// @dev Test-only stub for a HyperCore price precompile (0x0806 markPx / 0x0807 oraclePx).
/// Same ABI as the real precompile (docs/recon.md §C): input abi.encode(uint32), output abi.encode(uint64).
/// The production mock is MockHyperCorePx (P3); this stub only proves the etch plan.
contract PxPrecompileStub {
    mapping(uint32 => uint64) public px;
    bool public burnAll;

    function setPx(uint32 index, uint64 raw) external {
        px[index] = raw;
    }

    function setBurnAll(bool on) external {
        burnAll = on;
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        if (burnAll) {
            while (true) {} // "invalid input consumes all gas passed into the precompile call frame"
        }
        return abi.encode(px[abi.decode(data, (uint32))]);
    }
}

/// @notice P1 recon checks. Offline by default; `FORK_READ=1 forge test --match-test test_forkRead` also reads the
/// real testnet precompiles over `vm.rpc` (the hyper-evm-lib RealL1Read pattern, ARCHITECTURE §3.5).
contract ReconTest is Test {
    address constant MARK_PX = 0x0000000000000000000000000000000000000806;
    address constant ORACLE_PX = 0x0000000000000000000000000000000000000807;
    address constant PERP_ASSET_INFO = 0x000000000000000000000000000000000000080a;
    uint32 constant HYPE_TESTNET = 135; // docs/recon.md §C
    uint8 constant HYPE_SZ_DECIMALS = 2;
    uint256 constant GAS_CAP = 30_000; // Params.precompileGas default (ARCHITECTURE §6.2)

    /// Layout per hyper-evm-lib src/PrecompileLib.sol:340 and test/utils/L1Read.sol:41.
    struct PerpAssetInfo {
        string coin;
        uint32 marginTableId;
        uint8 szDecimals;
        uint8 maxLeverage;
        bool onlyIsolated;
    }

    // ---------------------------------------------------------------- §A constants and paths

    function test_feeFlags() public pure {
        assertEq(LPFeeLibrary.DYNAMIC_FEE_FLAG, 0x800000);
        assertEq(LPFeeLibrary.OVERRIDE_FEE_FLAG, 0x400000);
        assertEq(LPFeeLibrary.MAX_LP_FEE, 1_000_000);
    }

    function test_hookFlagBits() public pure {
        assertEq(Hooks.BEFORE_INITIALIZE_FLAG, 1 << 13);
        assertEq(Hooks.BEFORE_SWAP_FLAG, 1 << 7);
        assertEq(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG, 0x2080);
        assertEq(HookMiner.FLAG_MASK, Hooks.ALL_HOOK_MASK);
    }

    function test_swapParamsShape() public pure {
        SwapParams memory p = SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1});
        assertTrue(p.zeroForOne);
        assertLt(p.amountSpecified, 0); // negative = exact input (ARCHITECTURE §2.2)
    }

    function test_pathsResolve() public pure {
        assertGt(type(PoolManager).creationCode.length, 0);
        assertGt(type(PoolSwapTest).creationCode.length, 0);
        assertGt(type(PoolModifyLiquidityTest).creationCode.length, 0);
        assertTrue(BaseHook.beforeSwap.selector != bytes4(0));
        assertTrue(IDynamicFeeHook.getFee.selector != bytes4(0));
        assertTrue(address(Deployers(payable(address(0)))) == address(0));
        assertEq(LiquidityAmounts.getLiquidityForAmount0(2 ** 96, 2 ** 97, 0), 0);
    }

    // ---------------------------------------------------------------- §D mock plan (offline)

    /// No precompile exists locally: staticcall "succeeds" with 0 bytes, so readers must check the length.
    function test_noPrecompileLocally() public view {
        assertEq(MARK_PX.code.length, 0);
        assertEq(ORACLE_PX.code.length, 0);
        (bool ok, bytes memory ret) = MARK_PX.staticcall{gas: GAS_CAP}(abi.encode(HYPE_TESTNET));
        assertTrue(ok);
        assertEq(ret.length, 0);
    }

    /// A stub etched at 0x0806/0x0807 returns recorded testnet raws; raw / 10^(6 - szDecimals) gives the human price.
    function test_etchedStubReturnsScaledPrices() public {
        _etch(MARK_PX);
        _etch(ORACLE_PX);
        PxPrecompileStub(MARK_PX).setPx(HYPE_TESTNET, 826_000); // live testnet raw, docs/recon.md §C
        PxPrecompileStub(ORACLE_PX).setPx(HYPE_TESTNET, 71_575_500);

        uint64 mark = _read(MARK_PX, HYPE_TESTNET);
        uint64 oracle = _read(ORACLE_PX, HYPE_TESTNET);
        assertEq(mark, 826_000);
        assertEq(oracle, 71_575_500);
        uint256 scale = 10 ** (6 - HYPE_SZ_DECIMALS);
        assertEq(uint256(mark) * 100 / scale, 8_260); // 82.60
        assertEq(uint256(oracle) * 100 / scale, 715_755); // 7157.55
    }

    /// A precompile that burns all gas only burns the capped amount; the caller keeps running.
    function test_gasCapContainsBurnAll() public {
        _etch(ORACLE_PX);
        PxPrecompileStub(ORACLE_PX).setBurnAll(true);
        uint256 before = gasleft();
        (bool ok,) = ORACLE_PX.staticcall{gas: GAS_CAP}(abi.encode(HYPE_TESTNET));
        uint256 used = before - gasleft();
        assertFalse(ok);
        assertLt(used, GAS_CAP + 5_000);
    }

    // ---------------------------------------------------------------- optional fork read (FORK_READ=1)

    /// Reads the real testnet precompiles via eth_call and checks encoding, decoding, coin and szDecimals.
    function test_forkRead_testnetHype() public {
        if (!vm.envOr("FORK_READ", false)) vm.skip(true);

        // Returned as ONE dynamic struct (leading 0x20 offset), not five flat values (docs/recon.md §C).
        bytes memory info = _rpcCall(PERP_ASSET_INFO, abi.encode(HYPE_TESTNET));
        PerpAssetInfo memory a = abi.decode(info, (PerpAssetInfo));
        assertEq(a.coin, "HYPE");
        assertEq(a.szDecimals, HYPE_SZ_DECIMALS);

        bytes memory m = _rpcCall(MARK_PX, abi.encode(HYPE_TESTNET));
        bytes memory o = _rpcCall(ORACLE_PX, abi.encode(HYPE_TESTNET));
        assertEq(m.length, 32);
        assertEq(o.length, 32);
        uint64 markRaw = abi.decode(m, (uint64));
        uint64 oracleRaw = abi.decode(o, (uint64));
        assertGt(markRaw, 0);
        assertGt(oracleRaw, 0);
        emit log_named_uint("testnet HYPE markRaw", markRaw);
        emit log_named_uint("testnet HYPE oracleRaw", oracleRaw);
    }

    // ---------------------------------------------------------------- helpers

    function _etch(address at) internal {
        vm.etch(at, address(new PxPrecompileStub()).code);
    }

    function _read(address at, uint32 index) internal view returns (uint64) {
        (bool ok, bytes memory ret) = at.staticcall{gas: GAS_CAP}(abi.encode(index));
        require(ok && ret.length >= 32, "bad read");
        return abi.decode(ret, (uint64));
    }

    function _rpcCall(address to, bytes memory data) internal returns (bytes memory) {
        string memory params =
            string.concat('[{"to":"', vm.toString(to), '","data":"', vm.toString(data), '"},"latest"]');
        return vm.rpc("hyperevm_testnet", "eth_call", params);
    }
}

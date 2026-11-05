// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

/// @dev Test-only stand-in for a HyperCore price precompile (0x0806 markPx / 0x0807 oraclePx).
/// Real precompiles take abi.encode(uint32 perpIndex) and return abi.encode(uint64 rawPx)
/// (docs/recon.md §2). The fallback mirrors that ABI.
contract PxPrecompileMock {
    mapping(uint32 => uint64) public px;
    bool public burnAll; // simulate "invalid input consumes all gas forwarded"

    function setPx(uint32 index, uint64 raw) external {
        px[index] = raw;
    }

    function setBurnAll(bool on) external {
        burnAll = on;
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        if (burnAll) {
            while (true) {} // burns every unit of gas forwarded to this frame
        }
        uint32 index = abi.decode(data, (uint32));
        return abi.encode(px[index]);
    }
}

/// @notice Recon item 5: precompiles don't exist in a local (non-fork) EVM, so tests etch a mock
/// at 0x…0806 / 0x…0807. This test pins the facts the mock plan depends on.
contract PrecompileMockPlanTest is Test {
    address constant MARK_PX = 0x0000000000000000000000000000000000000806;
    address constant ORACLE_PX = 0x0000000000000000000000000000000000000807;
    uint32 constant HYPE_TESTNET = 135;
    uint8 constant HYPE_SZ_DECIMALS = 2;
    uint256 constant READ_GAS_CAP = 30_000; // testnet estimate for a markPx eth_call was 24,591 incl. 21k intrinsic

    /// Without a mock, the address has no code: a staticcall "succeeds" but returns 0 bytes.
    /// So a reader MUST check returndata length, not just `success`.
    function test_noPrecompileLocally() public view {
        assertEq(MARK_PX.code.length, 0);
        assertEq(ORACLE_PX.code.length, 0);
        (bool ok, bytes memory ret) = MARK_PX.staticcall{gas: READ_GAS_CAP}(abi.encode(HYPE_TESTNET));
        assertTrue(ok);
        assertEq(ret.length, 0);
    }

    /// Etched mock returns the recorded testnet raw values; scaling raw / 10^(6 - szDecimals) gives human px.
    function test_etchedMockReturnsScaledPrices() public {
        _etch(MARK_PX);
        _etch(ORACLE_PX);
        // Raw values read from the real testnet precompiles at block 68823620 (docs/recon.md §4).
        PxPrecompileMock(MARK_PX).setPx(HYPE_TESTNET, 826_000);
        PxPrecompileMock(ORACLE_PX).setPx(HYPE_TESTNET, 71_575_500);

        uint64 mark = _read(MARK_PX, HYPE_TESTNET);
        uint64 oracle = _read(ORACLE_PX, HYPE_TESTNET);
        assertEq(mark, 826_000);
        assertEq(oracle, 71_575_500);

        uint256 scale = 10 ** (6 - HYPE_SZ_DECIMALS);
        assertEq(uint256(mark) * 1e2 / scale, 8_260); // 82.60
        assertEq(uint256(oracle) * 1e2 / scale, 715_755); // 7157.55
    }

    /// A misbehaving precompile that burns all gas only burns the capped amount; the caller keeps running.
    function test_gasCapContainsBurnAll() public {
        _etch(ORACLE_PX);
        PxPrecompileMock(ORACLE_PX).setBurnAll(true);
        uint256 before = gasleft();
        (bool ok,) = ORACLE_PX.staticcall{gas: READ_GAS_CAP}(abi.encode(HYPE_TESTNET));
        uint256 used = before - gasleft();
        assertFalse(ok);
        assertLt(used, READ_GAS_CAP + 5_000);
    }

    function _etch(address at) internal {
        vm.etch(at, address(new PxPrecompileMock()).code);
    }

    function _read(address at, uint32 index) internal view returns (uint64) {
        (bool ok, bytes memory ret) = at.staticcall{gas: READ_GAS_CAP}(abi.encode(index));
        require(ok && ret.length == 32, "bad read");
        return abi.decode(ret, (uint64));
    }
}

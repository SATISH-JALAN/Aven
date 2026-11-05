// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title MockHyperCorePx
/// @notice Test-only stand-in for a HyperCore read precompile, etched at 0x…0806 (mark), 0x…0807 (oracle) or
/// 0x…080a (perpAssetInfo) with vm.etch / anvil_setCode. Same ABI as the real precompiles (docs/recon.md §C):
/// price mode: input abi.encode(uint32 index) -> abi.encode(uint64 price[index]);
/// info mode:  input abi.encode(uint32 index) -> abi.encode(PerpAssetInfo) (ONE struct, recon C.2).
/// Failure injection: setFail (revert), setBurn (loop until the forwarded gas runs out), setEmpty (return no data),
/// setOverflow (return a word > uint64 max).
contract MockHyperCorePx {
    struct PerpAssetInfo {
        string coin;
        uint32 marginTableId;
        uint8 szDecimals;
        uint8 maxLeverage;
        bool onlyIsolated;
    }

    mapping(uint32 => uint64) public price;
    mapping(uint32 => PerpAssetInfo) internal _info;
    bool public infoMode;
    bool public fail;
    bool public burn;
    bool public empty;
    bool public overflow;

    function set(uint32 index, uint64 px) external {
        price[index] = px;
    }

    function setInfo(uint32 index, string calldata coin, uint8 szDecimals) external {
        infoMode = true;
        _info[index] = PerpAssetInfo(coin, 0, szDecimals, 10, false);
    }

    function setFail(bool on) external {
        fail = on;
    }

    function setBurn(bool on) external {
        burn = on;
    }

    function setEmpty(bool on) external {
        empty = on;
    }

    /// @notice Return a word that does not fit in uint64 (must be treated as a failed read, not a revert).
    function setOverflow(bool on) external {
        overflow = on;
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        if (fail) revert("MockHyperCorePx: fail");
        if (burn) {
            while (true) {} // "consume all gas passed into the precompile call frame" (recon C.5)
        }
        if (empty) return "";
        if (overflow) return abi.encode(type(uint256).max);
        uint32 index = uint32(uint256(bytes32(data[:32])));
        if (infoMode) return abi.encode(_info[index]);
        return abi.encode(price[index]);
    }
}

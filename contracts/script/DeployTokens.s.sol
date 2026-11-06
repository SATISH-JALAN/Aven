// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/Script.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {AvenScript} from "script/base/AvenScript.sol";

/// @notice Step 2 of §11.3: demo tokens aETH (18 dec, base: tracks the testnet ETH perp) and aUSD (6 dec, quote),
/// minted to the deployer (liquidity), the bot and the shock wallet; deployer approves both routers.
/// The bot and shock wallets approve the routers themselves from the Arena service (it holds their keys).
/// Demo-only tokens: solmate MockERC20 has an open mint (fine on testnet; never use for value).
contract DeployTokens is AvenScript {
    function run() external {
        Wip memory w = _loadWip();
        address bot = vm.envAddress("BOT_ADDRESS");
        address shock = vm.envAddress("SHOCK_ADDRESS");
        uint256 baseLiq = vm.envOr("MINT_BASE_DEPLOYER", uint256(1_000e18));
        uint256 quoteLiq = vm.envOr("MINT_QUOTE_DEPLOYER", uint256(5_000_000e6));
        uint256 baseWallet = vm.envOr("MINT_BASE_WALLET", uint256(200e18));
        uint256 quoteWallet = vm.envOr("MINT_QUOTE_WALLET", uint256(1_000_000e6));

        uint256 key = _deployerKey();
        address deployer = vm.addr(key);
        vm.startBroadcast(key);
        MockERC20 base = new MockERC20("Aven ETH", "aETH", 18);
        MockERC20 quote = new MockERC20("Aven USD", "aUSD", 6);
        base.mint(deployer, baseLiq);
        quote.mint(deployer, quoteLiq);
        base.mint(bot, baseWallet);
        quote.mint(bot, quoteWallet);
        base.mint(shock, baseWallet);
        quote.mint(shock, quoteWallet);
        base.approve(w.liquidityRouter, type(uint256).max);
        quote.approve(w.liquidityRouter, type(uint256).max);
        base.approve(w.swapRouter, type(uint256).max);
        quote.approve(w.swapRouter, type(uint256).max);
        vm.stopBroadcast();

        w.base = address(base);
        w.quote = address(quote);
        w.baseSymbol = "aETH";
        w.quoteSymbol = "aUSD";
        _saveWip(w);
        console2.log("aETH (base) ", address(base));
        console2.log("aUSD (quote)", address(quote));
    }
}

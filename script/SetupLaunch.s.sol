// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IIDPunksItems, IIDPunksAvatars} from "../src/IIDPunksAvatars.sol";

/// After the CAW NFT launches: sets the CAW NAME contract (once, cannot be changed) and opens the launch gift.
///   AVATARS, ITEMS   deployed addresses
///   CAW_NAMES        CawNamesV2 address on the same chain
///   LAUNCH_DAYS      how many days the free launch gift stays open (default 30); every item of data/items.json
contract SetupLaunch is Script {
    function run() external {
        IIDPunksAvatars avatars = IIDPunksAvatars(vm.envAddress("AVATARS"));
        IIDPunksItems items = IIDPunksItems(vm.envAddress("ITEMS"));
        address caw = vm.envAddress("CAW_NAMES");
        uint256 days_ = vm.envOr("LAUNCH_DAYS", uint256(30));
        uint256[] memory ids = abi.decode(vm.parseJson(vm.readFile("data/items.json"), "$[*].id"), (uint256[]));
        require(caw.code.length > 0, "CAW_NAMES has no code on this chain");

        vm.startBroadcast();
        avatars.setCawNames(caw);
        items.setLaunch(ids, block.timestamp + days_ * 1 days);
        vm.stopBroadcast();
        console.log("CAW NAMEs set:", caw);
        console.log("launch gift until (unix):", block.timestamp + days_ * 1 days);
    }
}

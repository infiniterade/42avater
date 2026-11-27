// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IIDPunksRenderer, IIDPunksItems, IIDPunksAvatars} from "../src/IIDPunksAvatars.sol";

/// Deploys the three contracts, writes the parts data once and adds every special item of data/items.json.
/// The CAW NAME address and the launch gift are set later with SetupLaunch.s.sol (after the CAW NFT launches).
///   AVATAR_SIGNER  address of the maker backend that signs mints (required)
///   MAX_SUPPLY     cap on avatars (default 1,000,000; CAW NAMEs also limit it: one avatar each)
///   forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast --account <keystore name>
contract Deploy is Script {
    function run() external returns (IIDPunksRenderer renderer, IIDPunksItems items, IIDPunksAvatars avatars) {
        address signer = vm.envAddress("AVATAR_SIGNER");
        uint256 maxSupply = vm.envOr("MAX_SUPPLY", uint256(1_000_000));
        string memory ij = vm.readFile("data/items.json");
        uint256[] memory ids = abi.decode(vm.parseJson(ij, "$[*].id"), (uint256[]));

        vm.startBroadcast();
        renderer = new IIDPunksRenderer();
        renderer.setData(vm.readFileBinary("data/parts.bin"), vm.readFileBinary("data/strings.bin"));
        items = new IIDPunksItems(renderer);
        avatars = new IIDPunksAvatars(renderer, items, signer, maxSupply);
        items.setAvatars(address(avatars));
        for (uint256 i = 0; i < ids.length; i++) {
            string memory k = string.concat("[", vm.toString(i), "]");
            uint256 id = items.addItem(
                vm.parseJsonBytes(ij, string.concat(k, ".data")), vm.parseJsonString(ij, string.concat(k, ".name")), 0, 0
            );
            require(id == ids[i], "item ids must follow data/items.json");
        }
        vm.stopBroadcast();

        console.log("IIDPunksRenderer:", address(renderer));
        console.log("IIDPunksItems:   ", address(items));
        console.log("IIDPunksAvatars: ", address(avatars));
        console.log("special items:   ", ids.length);
    }
}

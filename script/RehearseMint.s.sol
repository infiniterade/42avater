// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IIDPunksItems, IIDPunksAvatars} from "../src/IIDPunksAvatars.sol";

/// Rehearsal only (local chain or a test chain): the signer key signs like the maker backend would, then the
/// CAW NAME owner mints the avatar of data/vectors.json case CASE, claims the launch gift and equips its items.
///   AVATARS, ITEMS, CAW_ID, CASE, SIGNER_KEY (test key only), and --private-key/--account for the minter
contract RehearseMint is Script {
    function run() external {
        IIDPunksAvatars avatars = IIDPunksAvatars(vm.envAddress("AVATARS"));
        IIDPunksItems items = IIDPunksItems(vm.envAddress("ITEMS"));
        uint256 cawId = vm.envUint("CAW_ID");
        string memory c = string.concat(".cases[", vm.toString(vm.envUint("CASE")), "]");
        string memory vec = vm.readFile("data/vectors.json");
        bytes memory rec = vm.parseJsonBytes(vec, string.concat(c, ".record"));
        uint256 deadline = block.timestamp + 1 hours;

        vm.startBroadcast();
        address minter = msg.sender;
        vm.stopBroadcast();
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Mint(address to,uint256 cawId,bytes32 recordHash,uint256 deadline)"),
                minter,
                cawId,
                keccak256(rec),
                deadline
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("IIDPunksAvatars"),
                keccak256("1"),
                block.chainid,
                address(avatars)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(vm.envUint("SIGNER_KEY"), keccak256(abi.encodePacked("\x19\x01", domain, structHash)));

        vm.startBroadcast();
        uint256 id = avatars.mint(cawId, rec, deadline, abi.encodePacked(r, s, v));
        items.claimLaunch(id);
        for (uint256 slot = 0; slot < 6; slot++) {
            uint256 itemId = vm.parseJsonUint(vec, string.concat(c, ".itemIds[", vm.toString(slot), "]"));
            if (itemId != 0) avatars.equip(id, itemId);
        }
        vm.stopBroadcast();
        console.log("minted avatar:", id);
    }
}

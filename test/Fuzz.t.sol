// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IIDPunksRenderer} from "../src/IIDPunksAvatars.sol";

/// Whatever bytes a record or an item is made of: either validation refuses it, or drawing it works.
/// A panic (array out of bounds, overflow) would mean a hole in validation.
contract FuzzTest is Test {
    IIDPunksRenderer renderer;
    bytes[] goodRecs;

    function setUp() public {
        renderer = new IIDPunksRenderer();
        renderer.setData(vm.readFileBinary("data/parts.bin"), vm.readFileBinary("data/strings.bin"));
        string memory vec = vm.readFile("data/vectors.json");
        for (uint256 i = 0; i < 4; i++) goodRecs.push(vm.parseJsonBytes(vec, string.concat(".cases[", vm.toString(i), "].record")));
    }

    function _drawsIfValid(bytes memory rec, bytes[] memory items) internal view {
        try renderer.validate(rec) {
            renderer.svgOf(rec, items);                        // must not revert once validated
        } catch (bytes memory err) {
            assertTrue(err.length < 4 || bytes4(err) != bytes4(keccak256("Panic(uint256)")), "panic in validate");
        }
    }

    /// Random bytes as a record.
    function testFuzz_RandomRecord(bytes calldata rec) public view {
        _drawsIfValid(rec, new bytes[](6));
    }

    /// A real record with a few bytes changed.
    function testFuzz_MutatedRecord(uint8 which, uint8 pos, uint8 val, uint8 pos2, uint8 val2) public view {
        bytes memory rec = bytes.concat(goodRecs[which % goodRecs.length]);
        rec[pos % rec.length] = bytes1(val);
        rec[pos2 % rec.length] = bytes1(val2);
        _drawsIfValid(rec, new bytes[](6));
    }

    /// Random bytes as an item, worn by a real avatar.
    function testFuzz_RandomItem(bytes calldata it, uint8 which) public view {
        try renderer.validateItem(it) {
            renderer.itemSvg(it);
            bytes[] memory items = new bytes[](6);
            items[uint8(it[0])] = it;
            renderer.svgOf(goodRecs[which % goodRecs.length], items);
        } catch (bytes memory err) {
            assertTrue(err.length < 4 || bytes4(err) != bytes4(keccak256("Panic(uint256)")), "panic in validateItem");
        }
    }

    /// A structurally plausible item: right header, random runs.
    function testFuzz_ShapedItem(uint8 slot, uint8 n, bytes calldata body, uint8 which) public view {
        slot = slot % 6;
        n = uint8(bound(n, 1, 12));
        bytes memory it = abi.encodePacked(slot, n);
        for (uint256 i = 0; i < n; i++) it = bytes.concat(it, abi.encodePacked(uint8(i % 2), uint8(i * 37), uint8(i * 91), uint8(i * 13)));
        it = bytes.concat(it, body);
        try renderer.validateItem(it) {
            renderer.itemSvg(it);
            bytes[] memory items = new bytes[](6);
            items[slot] = it;
            renderer.svgOf(goodRecs[which % goodRecs.length], items);
        } catch (bytes memory err) {
            assertTrue(err.length < 4 || bytes4(err) != bytes4(keccak256("Panic(uint256)")), "panic in validateItem");
        }
    }
}

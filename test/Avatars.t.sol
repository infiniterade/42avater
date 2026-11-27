// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IIDPunksRenderer, IIDPunksItems, IIDPunksAvatars} from "../src/IIDPunksAvatars.sol";

/// Stand-in for CawNamesV2 (also an OpenZeppelin ERC721): only ownerOf matters to the avatars.
contract MockCawNames is ERC721 {
    constructor() ERC721("CAW NAME", "CAWNAME") {}
    function mintTo(address to, uint256 id) external { _mint(to, id); }
    function exists(uint256 id) external view returns (bool) { return _ownerOf(id) != address(0); }
}

contract AvatarsTest is Test {
    IIDPunksRenderer renderer;
    IIDPunksItems items;
    IIDPunksAvatars avatars;
    MockCawNames caw;
    uint256 constant SIGNER_PK = 0xA11CE;
    address signer;
    address alice = address(0xA11);
    address bob = address(0xB0B);
    string vec;
    uint256 constant N = 60;
    uint256 constant ITEMS = 11;
    uint256 constant SLOTS = 6;

    function setUp() public {
        signer = vm.addr(SIGNER_PK);
        renderer = new IIDPunksRenderer();
        renderer.setData(vm.readFileBinary("data/parts.bin"), vm.readFileBinary("data/strings.bin"));
        items = new IIDPunksItems(renderer);
        avatars = new IIDPunksAvatars(renderer, items, signer, 100000);
        items.setAvatars(address(avatars));
        caw = new MockCawNames();
        avatars.setCawNames(address(caw));
        string memory ij = vm.readFile("data/items.json");
        for (uint256 i = 0; i < ITEMS; i++) {
            string memory k = string.concat("[", vm.toString(i), "]");
            items.addItem(vm.parseJsonBytes(ij, string.concat(k, ".data")), vm.parseJsonString(ij, string.concat(k, ".name")), 0, 0);
        }
        vec = vm.readFile("data/vectors.json");
    }

    // ---------------- helpers ----------------
    function _c(uint256 i, string memory f) internal pure returns (string memory) {
        return string.concat(".cases[", vm.toString(i), "].", f);
    }

    function _rec(uint256 i) internal view returns (bytes memory) { return vm.parseJsonBytes(vec, _c(i, "record")); }

    function _items(uint256 i) internal view returns (bytes[] memory its) {
        its = new bytes[](SLOTS);
        for (uint256 s = 0; s < SLOTS; s++) its[s] = vm.parseJsonBytes(vec, _c(i, string.concat("items[", vm.toString(s), "]")));
    }

    function _names(uint256 i) internal view returns (string[] memory nm) {
        nm = new string[](SLOTS);
        for (uint256 s = 0; s < SLOTS; s++) nm[s] = vm.parseJsonString(vec, _c(i, string.concat("names[", vm.toString(s), "]")));
    }

    function _sig(address to, uint256 cawId, bytes memory rec, uint256 deadline, IIDPunksAvatars a)
        internal view returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Mint(address to,uint256 cawId,bytes32 recordHash,uint256 deadline)"), to, cawId, keccak256(rec), deadline));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("IIDPunksAvatars"), keccak256("1"), block.chainid, address(a)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _mint(address who, uint256 cawId, uint256 i) internal returns (uint256) {
        if (!caw.exists(cawId)) caw.mintTo(who, cawId);
        bytes memory rec = _rec(i);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(who, cawId, rec, dl, avatars);
        vm.prank(who);
        return avatars.mint(cawId, rec, dl, sig);
    }

    // ---------------- picture: contract == engine (JS) ----------------
    function test_RenderMatchesEngine_allCases() public view {
        bytes[] memory none = new bytes[](SLOTS);
        for (uint256 i = 0; i < N; i++) {
            bytes memory rec = _rec(i);
            renderer.validate(rec);
            assertEq(renderer.svgOf(rec, _items(i)), vm.parseJsonString(vec, _c(i, "svg")), string.concat("svg ", vm.toString(i)));
            assertEq(renderer.lookHash(rec), vm.parseJsonBytes32(vec, _c(i, "lookHash")), string.concat("look ", vm.toString(i)));
            // without items the picture must be the minted one; lookHash ignores items
            if (i < 30) assertEq(renderer.svgOf(rec, none), vm.parseJsonString(vec, _c(i, "svg")));
        }
    }

    function test_Attributes() public view {
        string memory a = renderer.attributesOf(_rec(0), new string[](SLOTS));
        assertEq(a, string.concat("[", vm.parseJsonString(vec, _c(0, "attrs")), "]"));
    }

    // ---------------- mint with CAW NAME ----------------
    function test_CollectionNames() public {
        assertEq(avatars.name(), "42gAvaterMaker");
        assertEq(avatars.symbol(), "42AM");
        assertEq(items.name(), "42AM_SpecialItems");
        assertEq(items.symbol(), "42AMSI");
        assertEq(avatars.NAME(), "42gAvaterMaker");
    }

    function test_Mint() public {
        uint256 id = _mint(alice, 7, 0);
        assertEq(id, 1);
        assertEq(avatars.ownerOf(1), alice);
        assertEq(avatars.avatarOfCaw(7), 1);
        assertEq(avatars.cawOfAvatar(1), 7);
        assertEq(avatars.recordOf(1), _rec(0));
        assertTrue(avatars.lookTaken(renderer.lookHash(_rec(0))));
    }

    function test_RevertWhenNotCawOwner() public {
        caw.mintTo(alice, 7);
        bytes memory rec = _rec(0);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(bob, 7, rec, dl, avatars);
        vm.prank(bob);
        vm.expectRevert(bytes("not CAW NAME owner"));
        avatars.mint(7, rec, dl, sig);
    }

    function test_RevertWhenCawUsedTwice_evenAfterSale() public {
        _mint(alice, 7, 0);
        bytes memory rec = _rec(1);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(alice, 7, rec, dl, avatars);
        vm.prank(alice);
        vm.expectRevert(bytes("CAW NAME already used"));
        avatars.mint(7, rec, dl, sig);
        // the CAW NAME is sold: the new owner cannot mint with it either
        vm.prank(alice);
        caw.transferFrom(alice, bob, 7);
        sig = _sig(bob, 7, rec, dl, avatars);
        vm.prank(bob);
        vm.expectRevert(bytes("CAW NAME already used"));
        avatars.mint(7, rec, dl, sig);
    }

    /// ERC721Enumerable: the "My avatars" screen finds every avatar of a wallet with avatarsOf().
    function test_AvatarsOf() public {
        _mint(alice, 7, 0);
        caw.mintTo(alice, 8);
        _mint(alice, 8, 1);
        caw.mintTo(bob, 9);
        _mint(bob, 9, 2);
        uint256[] memory a = avatars.avatarsOf(alice);
        assertEq(a.length, 2);
        assertEq(a[0], 1);
        assertEq(a[1], 2);
        assertEq(avatars.totalSupply(), 3);
        assertEq(avatars.tokenByIndex(2), 3);
        vm.prank(alice);
        avatars.transferFrom(alice, bob, 1);
        a = avatars.avatarsOf(alice);
        assertEq(a.length, 1);
        assertEq(a[0], 2);
        uint256[] memory b = avatars.avatarsOf(bob);
        assertEq(b.length, 2);
        assertEq(avatars.avatarsOf(address(0xdead)).length, 0);
        assertTrue(avatars.supportsInterface(0x780e9d63)); // ERC721Enumerable
    }

    function test_TwoCawNamesTwoAvatars() public {
        _mint(alice, 7, 0);
        caw.mintTo(alice, 8);
        _mint(alice, 8, 1);
        assertEq(avatars.balanceOf(alice), 2);
    }

    function test_RevertWhenSameLook() public {
        _mint(alice, 7, 0);
        caw.mintTo(bob, 8);
        bytes memory rec = _rec(0);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(bob, 8, rec, dl, avatars);
        vm.prank(bob);
        vm.expectRevert(bytes("look taken"));
        avatars.mint(8, rec, dl, sig);
    }

    function test_RevertWhenBadSignature() public {
        caw.mintTo(alice, 7);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(alice, 7, _rec(1), dl, avatars);    // signed another design
        vm.prank(alice);
        vm.expectRevert(bytes("bad signature"));
        avatars.mint(7, _rec(0), dl, sig);
    }

    function test_RevertWhenExpired() public {
        caw.mintTo(alice, 7);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(alice, 7, _rec(0), dl, avatars);
        vm.warp(dl + 1);
        vm.prank(alice);
        vm.expectRevert(bytes("expired"));
        avatars.mint(7, _rec(0), dl, sig);
    }

    function test_MintClosedUntilCawNamesSet_andSetOnlyOnce() public {
        IIDPunksAvatars fresh = new IIDPunksAvatars(renderer, items, signer, 100);
        caw.mintTo(alice, 7);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(alice, 7, _rec(0), dl, fresh);
        vm.prank(alice);
        vm.expectRevert(bytes("CAW NAME not set yet"));
        fresh.mint(7, _rec(0), dl, sig);
        assertEq(fresh.owner(), address(this));
        fresh.setCawNames(address(caw));
        assertEq(fresh.owner(), address(0));                   // no admin after setup
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        fresh.setCawNames(address(0xdead));
        assertEq(fresh.cawNames(), address(caw));
        vm.prank(alice);
        fresh.mint(7, _rec(0), dl, sig);
        assertEq(fresh.ownerOf(1), alice);
    }

    function test_RevertWhenRecordOutOfRange() public {
        caw.mintTo(alice, 7);
        bytes memory rec = _rec(0);
        rec[0] = bytes1(uint8(250));                                // no such sprite
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(alice, 7, rec, dl, avatars);
        vm.prank(alice);
        vm.expectRevert(bytes("layer"));
        avatars.mint(7, rec, dl, sig);
    }

    // ---------------- special items ----------------
    function _launch() internal {
        uint256[] memory ids = new uint256[](ITEMS);
        for (uint256 i = 0; i < ITEMS; i++) ids[i] = i + 1;
        items.setLaunch(ids, block.timestamp + 7 days);
    }

    function test_LaunchGift_oncePerAvatar() public {
        _launch();
        uint256 a = _mint(alice, 7, 0);
        vm.prank(alice);
        items.claimLaunch(a);
        for (uint256 i = 1; i <= ITEMS; i++) assertEq(items.balanceOf(alice, i), 1);
        vm.prank(alice);
        vm.expectRevert(bytes("already claimed"));
        items.claimLaunch(a);
        // someone who does not own the avatar
        vm.prank(bob);
        vm.expectRevert(bytes("not avatar owner"));
        items.claimLaunch(a);
        // the avatar is sold: the buyer cannot claim it again
        vm.prank(alice);
        avatars.transferFrom(alice, bob, a);
        vm.prank(bob);
        vm.expectRevert(bytes("already claimed"));
        items.claimLaunch(a);
        // a second avatar (second CAW NAME) gets its own gift
        caw.mintTo(alice, 8);
        uint256 b = _mint(alice, 8, 1);
        vm.prank(alice);
        items.claimLaunch(b);
        assertEq(items.balanceOf(alice, 1), 2);
    }

    function test_LaunchGift_closedAfterEnd() public {
        _launch();
        uint256 a = _mint(alice, 7, 0);
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        vm.expectRevert(bytes("launch gift closed"));
        items.claimLaunch(a);
    }

    function test_BuyItem() public {
        items.setSale(3, 0.01 ether, true);
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(bytes("price"));
        items.buy{value: 0.005 ether}(3, 1);
        vm.prank(bob);
        items.buy{value: 0.02 ether}(3, 2);
        assertEq(items.balanceOf(bob, 3), 2);
        vm.expectRevert(bytes("not on sale"));
        items.buy(4, 1);
    }

    function test_AddItem_rejectsBrokenDesign() public {
        vm.expectRevert(bytes("slot"));
        items.addItem(hex"0601", "bad", 0, 0);
        vm.expectRevert(bytes("run"));
        items.addItem(hex"0001" hex"00FF0000" hex"00160301", "bad", 0, 0);   // x 22 + len 3 > 24
        vm.prank(bob);
        vm.expectRevert();
        items.addItem(hex"0001" hex"00FF0000" hex"00000101", "x", 0, 0);   // only the owner
    }

    function test_EquipUnequip_recordNeverChanges() public {
        _launch();
        uint256 a = _mint(alice, 7, 0);
        vm.prank(alice);
        items.claimLaunch(a);
        bytes memory rec = avatars.recordOf(a);
        string memory plain = avatars.tokenURI(a);
        assertEq(avatars.dressedTokenURI(a), plain);

        vm.prank(alice);
        avatars.equip(a, 1);                                   // Wizard Hat
        assertEq(items.balanceOf(alice, 1), 0);
        assertEq(items.balanceOf(address(avatars), 1), 1);
        assertEq(avatars.equippedOf(a)[0], 1);
        assertTrue(keccak256(bytes(avatars.dressedTokenURI(a))) != keccak256(bytes(plain)));
        assertEq(avatars.tokenURI(a), plain);                  // marketplaces always see the avatar alone

        vm.prank(alice);
        avatars.equip(a, 2);                                   // Party Hat replaces it; Wizard Hat comes back
        assertEq(items.balanceOf(alice, 1), 1);
        assertEq(items.balanceOf(alice, 2), 0);
        assertEq(avatars.equippedOf(a)[0], 2);

        vm.prank(alice);
        avatars.unequip(a, 0);
        assertEq(items.balanceOf(alice, 2), 1);
        assertEq(avatars.recordOf(a), rec);
        assertEq(avatars.dressedTokenURI(a), plain);           // back to the minted picture

        vm.prank(bob);
        vm.expectRevert(bytes("not owner"));
        avatars.equip(a, 3);
    }

    function test_RevertEquipWithoutItem() public {
        uint256 a = _mint(alice, 7, 0);
        vm.prank(alice);
        vm.expectRevert();                                     // ERC1155InsufficientBalance
        avatars.equip(a, 3);
    }

    /// Items are never sold with the avatar: a transfer sends everything it wears back to the seller.
    function test_ItemsReturnToSellerOnTransfer() public {
        _launch();
        uint256 a = _mint(alice, 7, 0);
        vm.prank(alice);
        items.claimLaunch(a);
        string memory plain = avatars.tokenURI(a);
        vm.startPrank(alice);
        avatars.equip(a, 9);                                   // Sunset background
        avatars.equip(a, 1);                                   // Wizard Hat
        avatars.transferFrom(alice, bob, a);
        vm.stopPrank();
        assertEq(items.balanceOf(alice, 9), 1);
        assertEq(items.balanceOf(alice, 1), 1);
        assertEq(items.balanceOf(bob, 9), 0);
        assertEq(items.balanceOf(address(avatars), 9), 0);
        uint256[6] memory eq = avatars.equippedOf(a);
        for (uint256 s = 0; s < 6; s++) assertEq(eq[s], 0);
        assertEq(avatars.tokenURI(a), plain);
        assertEq(avatars.dressedTokenURI(a), plain);           // the buyer gets exactly what the market showed
        vm.prank(bob);
        vm.expectRevert(bytes("empty slot"));
        avatars.unequip(a, 4);
        // the seller can put the items on another avatar or sell them on their own
        vm.prank(alice);
        items.safeTransferFrom(alice, bob, 9, 1, "");
        assertEq(items.balanceOf(bob, 9), 1);
    }

    /// Full tokenURI with items equals the renderer fed with the engine's item blobs.
    function test_TokenURIWithItems_matchesEngine() public {
        _launch();
        for (uint256 i = 30; i < 40; i++) {
            uint256 cawId = 100 + i;
            uint256 a = _mint(alice, cawId, i);
            vm.prank(alice);
            items.claimLaunch(a);
            for (uint256 s = 0; s < SLOTS; s++) {
                uint256 itemId = vm.parseJsonUint(vec, _c(i, string.concat("itemIds[", vm.toString(s), "]")));
                if (itemId != 0) { vm.prank(alice); avatars.equip(a, itemId); }
            }
            string memory expected = renderer.tokenURI(a, _rec(i), _items(i), _names(i), avatars.NAME(), avatars.DESCRIPTION());
            assertEq(avatars.dressedTokenURI(a), expected);
            assertEq(avatars.tokenURI(a), renderer.tokenURI(a, _rec(i), new bytes[](SLOTS), new string[](SLOTS), avatars.NAME(), avatars.DESCRIPTION()));
            assertEq(renderer.svgOf(_rec(i), _items(i)), vm.parseJsonString(vec, _c(i, "svg")));
        }
    }

    /// Rainbow Hair Dye (item 11, slot 5): recolors the hair only; off again = minted picture.
    function test_HairDye() public {
        _launch();
        // case 0 is a Male; find a case whose hair is visible: compare plain vs dyed picture
        uint256 a = _mint(alice, 7, 0);
        vm.prank(alice);
        items.claimLaunch(a);
        assertEq(items.slotOf(11), 5);
        string memory plain = avatars.tokenURI(a);
        vm.prank(alice);
        avatars.equip(a, 11);
        assertEq(avatars.equippedOf(a)[5], 11);
        bytes[] memory its = new bytes[](SLOTS);
        its[5] = items.dataOf(11);
        string[] memory nm = new string[](SLOTS);
        nm[5] = "Rainbow Hair Dye";
        assertEq(avatars.dressedTokenURI(a), renderer.tokenURI(a, _rec(0), its, nm, avatars.NAME(), avatars.DESCRIPTION()));
        vm.prank(alice);
        avatars.unequip(a, 5);
        assertEq(avatars.dressedTokenURI(a), plain);
        // the item drawn alone shows its bands
        string memory sw = renderer.itemSvg(items.dataOf(11));
        assertGt(bytes(sw).length, 100);
        // a hair color item must have no pixels and an even number of colors
        vm.expectRevert(bytes("hair color"));
        items.addItem(hex"0503" hex"00FF0000" hex"0000FF00" hex"000000FF", "bad", 0, 0);
    }

    // ---------------- gas ----------------
    function test_Gas() public {
        _launch();
        uint256 g = gasleft();
        IIDPunksRenderer r2 = new IIDPunksRenderer();
        r2.setData(vm.readFileBinary("data/parts.bin"), vm.readFileBinary("data/strings.bin"));
        console.log("deploy renderer + setData gas:", g - gasleft());

        caw.mintTo(alice, 7);
        bytes memory rec = _rec(0);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(alice, 7, rec, dl, avatars);
        vm.prank(alice);
        g = gasleft();
        uint256 a = avatars.mint(7, rec, dl, sig);
        console.log("mint gas:", g - gasleft());

        vm.prank(alice);
        g = gasleft();
        items.claimLaunch(a);
        console.log("claimLaunch (11 items) gas:", g - gasleft());

        vm.prank(alice);
        g = gasleft();
        avatars.equip(a, 10);
        console.log("equip gas:", g - gasleft());

        uint256 worst;
        for (uint256 i = 0; i < N; i++) {
            bytes memory r = _rec(i);
            bytes[] memory its = _items(i);
            g = gasleft();
            renderer.svgOf(r, its);
            uint256 used = g - gasleft();
            if (used > worst) worst = used;
        }
        console.log("svgOf worst gas (60 cases):", worst);
        g = gasleft();
        avatars.dressedTokenURI(a);
        console.log("dressedTokenURI with background gas:", g - gasleft());
        vm.startPrank(alice);
        avatars.equip(a, 1);
        avatars.equip(a, 4);
        avatars.equip(a, 7);
        g = gasleft();
        avatars.transferFrom(alice, bob, a);
        console.log("transfer wearing 4 items gas:", g - gasleft());
        vm.stopPrank();
    }
}

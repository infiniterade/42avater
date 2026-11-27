// SPDX-License-Identifier: MIT
// Not audited by a third party. Compile with viaIR (solc 0.8.30, cancun). OpenZeppelin v5.
// The renderer mirrors onchain.js renderFromBytes(), which is tested against generate_punks.py and engine.js.
//
// Model: the avatar (all parts chosen at mint) is fixed forever. Special items (ERC-1155) can be bought later and
// equipped one per slot (hat / eyes / mouth / neck / bg / hair color). An equipped item hides the original part of its slot on the
// picture only; the avatar's record is never written again. Unequip and the minted picture comes back.
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// Store bytes as contract code (cheap to write once, cheap to read).
library SSTORE2 {
    function write(bytes memory data) internal returns (address p) {
        // PUSH4 len DUP1 PUSH1 0x0E PUSH1 0 CODECOPY PUSH1 0 RETURN | 0x00 | data
        bytes memory code = abi.encodePacked(hex"63", uint32(data.length + 1), hex"80600E6000396000F3", hex"00", data);
        assembly { p := create(0, add(code, 32), mload(code)) }
        require(p != address(0), "SSTORE2: write failed");
    }

    function read(address p) internal view returns (bytes memory data) {
        uint256 size = p.code.length - 1;
        data = new bytes(size);
        assembly { extcodecopy(p, add(data, 32), 1, size) }
    }
}

/// Composes SVG + JSON from the parts data, a token record and the equipped special items.
/// Parts data can be written exactly once; after that nothing here can change.
contract IIDPunksRenderer {
    address public immutable deployer;
    address public parts;      // byte layout: see onchain.js
    address public strs;       // string table for attributes
    uint256 public spriteCount;
    uint256 public colorCount;
    uint256 public stringCount;

    uint256 private constant C_ERASE = 1;
    uint256 private constant C_OUTLINE = 2;
    uint256 private constant C_S = 3;
    uint256 private constant C_s = 4;
    uint256 private constant C_H = 6;
    uint256 private constant C_j = 7;
    uint256 private constant C_i = 8;
    uint256 private constant C_K = 9;
    uint256 private constant C_k = 10;
    uint256 private constant ITEM_BASE = 64;  // item pixel code = 64 + slot * 12 + color (1..11)
    uint256 private constant REC_PAL = 14;    // record: 13 layers | flags | 21 palette ids | attr count | attrs
    uint256 private constant REC_ATTR = 35;
    uint256 public constant SLOTS = 6;        // 0 hat, 1 eyes, 2 mouth, 3 neck, 4 bg, 5 hair color
    bytes16 private constant HEX = "0123456789ABCDEF";

    struct Layout {
        uint256 n; uint256 fixOff; uint256 varOff; uint256 noOff; uint256 clipOff; uint256 skiOff;
        uint256 catOff; uint256 offOff; uint256 runOff;
    }

    constructor() { deployer = msg.sender; }

    function setData(bytes calldata partsData, bytes calldata stringData) external {
        require(msg.sender == deployer && parts == address(0), "locked");
        parts = SSTORE2.write(partsData);
        strs = SSTORE2.write(stringData);
        spriteCount = _u16c(partsData, 0);
        colorCount = uint8(partsData[2]);
        stringCount = _u16c(stringData, 0);
    }

    // ---------------- validation ----------------
    /// Range checks for a token record (design rules are checked by the mint signer).
    function validate(bytes calldata rec) external view {
        require(parts != address(0), "no data");
        require(rec.length >= REC_ATTR + 1, "short");
        uint256 cnt = uint8(rec[REC_ATTR]);
        require(rec.length == REC_ATTR + 1 + cnt * 3, "length");
        bool ended;
        for (uint256 l = 0; l < 13; l++) {
            uint256 id = uint8(rec[l]);
            if (id == 0xff) { ended = true; continue; }
            require(!ended && id < spriteCount, "layer");
        }
        require(uint8(rec[0]) != 0xff, "empty");
        for (uint256 v = 0; v < 21; v++) require(uint8(rec[REC_PAL + v]) < colorCount, "color");
        for (uint256 a = REC_ATTR + 1; a < rec.length; a++) require(uint8(rec[a]) < stringCount, "attr");
    }

    /// Format check for a special item blob: slot | n colors | n*(flags,r,g,b) | runs (y,x,len,color)
    /// Hair color items (slot 5) have no runs: n = 2k colors, k band colors then k highlights.
    function validateItem(bytes calldata it) external pure {
        require(it.length >= 2 && uint8(it[0]) < SLOTS, "slot");
        uint256 n = uint8(it[1]);
        if (uint8(it[0]) == 5) {
            require(n >= 2 && n <= 24 && n % 2 == 0 && it.length == 2 + n * 4, "hair color");
            return;
        }
        require(n >= 1 && n <= 11, "colors");
        uint256 o = 2 + n * 4;
        require(it.length > o && (it.length - o) % 4 == 0, "runs");
        for (; o < it.length; o += 4) {
            uint256 x = uint8(it[o + 1]);
            uint256 len = uint8(it[o + 2]);
            uint256 c = uint8(it[o + 3]);
            require(uint8(it[o]) < 24 && len > 0 && x + len <= 24 && c >= 1 && c <= n, "run");
        }
    }

    /// Identity of the minted picture (no items): hash of the color of every pixel.
    function lookHash(bytes calldata rec) external view returns (bytes32) {
        return keccak256(abi.encodePacked(_colors(SSTORE2.read(parts), rec, new bytes[](SLOTS))));
    }

    // ---------------- token URI ----------------
    function tokenURI(
        uint256 tokenId,
        bytes calldata rec,
        bytes[] calldata items,
        string[] calldata itemNames,
        string calldata name,
        string calldata description
    ) external view returns (string memory) {
        string memory svg = svgOf(rec, items);
        bytes memory json = abi.encodePacked(
            '{"name":"', name, " #", Strings.toString(tokenId),
            '","description":"', description,
            '","image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)),
            '","attributes":', attributesOf(rec, itemNames), "}"
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    function attributesOf(bytes calldata rec, string[] calldata itemNames) public view returns (string memory) {
        bytes memory S = SSTORE2.read(strs);
        uint256 cnt = uint8(rec[REC_ATTR]);
        bytes memory out = "[";
        for (uint256 i = 0; i < cnt; i++) {
            uint256 o = REC_ATTR + 1 + i * 3;
            uint256 pre = uint8(rec[o + 1]);
            out = abi.encodePacked(
                out, i == 0 ? bytes("") : bytes(","), '{"trait_type":"', _str(S, uint8(rec[o])), '","value":"',
                pre == 0 ? bytes("") : abi.encodePacked(_str(S, pre), " "), _str(S, uint8(rec[o + 2])), '"}'
            );
        }
        string[6] memory slotNames = [string("Special Hat"), "Special Eyes", "Special Mouth", "Special Neck", "Background", "Hair Color"];
        for (uint256 s = 0; s < itemNames.length && s < SLOTS; s++) {
            if (bytes(itemNames[s]).length == 0) continue;
            out = abi.encodePacked(out, ',{"trait_type":"', slotNames[s], '","value":"', itemNames[s], '"}');
        }
        return string(abi.encodePacked(out, "]"));
    }

    /// The picture of a token. items[slot] = item blob, or empty bytes for none.
    function svgOf(bytes calldata rec, bytes[] calldata items) public view returns (string memory) {
        bytes[] memory its = new bytes[](SLOTS);
        for (uint256 s = 0; s < items.length && s < SLOTS; s++) its[s] = items[s];
        return _svg(_colors(SSTORE2.read(parts), rec, its));
    }

    /// A special item drawn alone (for the item's own ERC-1155 metadata).
    function itemSvg(bytes calldata item) external view returns (string memory) {
        if (uint8(item[0]) == 5) {                         // hair color: show its bands, 2 rows each
            uint256[] memory bands = new uint256[](576);
            uint256 k = uint8(item[1]) / 2;
            for (uint256 p = 0; p < 576; p++) bands[p] = _itemRgb(item, ((p / 24) >> 1) % k + 1) + 1;
            return _svg(bands);
        }
        bytes[] memory its = new bytes[](SLOTS);
        its[uint8(item[0])] = item;
        bytes memory rec = new bytes(REC_ATTR + 1);
        for (uint256 l = 0; l < 13; l++) rec[l] = bytes1(0xff);   // no avatar layers
        return _svg(_colors(SSTORE2.read(parts), rec, its));
    }

    // ---------------- picture ----------------
    function _layout(bytes memory P) private pure returns (Layout memory L) {
        L.n = _u16(P, 0);
        L.fixOff = 3 + uint256(uint8(P[2])) * 3;
        L.varOff = L.fixOff + 64;
        L.noOff = L.varOff + 64;
        L.clipOff = L.noOff + 8;
        L.skiOff = L.clipOff + ((L.n + 7) >> 3);
        L.catOff = L.skiOff + ((L.n + 7) >> 3);
        L.offOff = L.catOff + L.n;
        L.runOff = L.offOff + (L.n + 1) * 2;
    }

    function _svg(uint256[] memory cols) private pure returns (string memory) {
        // worst case: 576 one-pixel rects of 57 bytes + header and footer = 32,927 bytes
        bytes memory buf = new bytes(33024);
        uint256 n = _put(buf, 0, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges">');
        for (uint256 y = 0; y < 24; y++) {
            uint256 x = 0;
            while (x < 24) {
                uint256 c = cols[y * 24 + x];
                if (c == 0) { x++; continue; }
                uint256 e = x + 1;
                while (e < 24 && cols[y * 24 + e] == c) e++;
                n = _rect(buf, n, x, y, e - x, c - 1);
                x = e;
            }
        }
        n = _put(buf, n, "</svg>");
        assembly { mstore(buf, n) }
        return string(buf);
    }

    function _rect(bytes memory buf, uint256 n, uint256 x, uint256 y, uint256 w, uint256 rgb)
        private pure returns (uint256)
    {
        n = _put(buf, n, '<rect x="');
        n = _num(buf, n, x);
        n = _put(buf, n, '" y="');
        n = _num(buf, n, y);
        n = _put(buf, n, '" width="');
        n = _num(buf, n, w);
        n = _put(buf, n, '" height="1" fill="#');
        for (uint256 k = 0; k < 6; k++) buf[n++] = HEX[(rgb >> (20 - k * 4)) & 15];
        return _put(buf, n, '"/>');
    }

    /// 576 entries: rgb + 1, 0 = transparent
    function _colors(bytes memory P, bytes memory rec, bytes[] memory items) private pure returns (uint256[] memory cols) {
        Layout memory L = _layout(P);
        bytes memory px = _pixels(P, L, rec, items);
        cols = new uint256[](576);
        if (items[4].length > 0) _drawBg(items[4], cols);
        bytes memory dye = items[5];                      // hair color item (no pixels of its own)
        for (uint256 p = 0; p < 576; p++) {
            uint256 c = uint8(px[p]);
            if (c == 0) continue;
            if (dye.length > 0 && (c == C_H || c == C_j || c == C_i)) {
                uint256 k = uint8(dye[1]) / 2;
                cols[p] = _itemRgb(dye, ((p / 24) >> 1) % k + (c == C_i ? k : 0) + 1) + 1;
            } else if (c >= ITEM_BASE) {
                uint256 sl = (c - ITEM_BASE) / 12;
                cols[p] = _itemRgb(items[sl], (c - ITEM_BASE) % 12) + 1;
            } else {
                uint256 v = uint8(P[L.varOff + c]);
                uint256 id = v != 0xff ? uint8(rec[REC_PAL + v]) : uint8(P[L.fixOff + c]);
                uint256 o = 3 + id * 3;
                cols[p] = ((uint256(uint8(P[o])) << 16) | (uint256(uint8(P[o + 1])) << 8) | uint8(P[o + 2])) + 1;
            }
        }
    }

    function _drawBg(bytes memory it, uint256[] memory cols) private pure {
        uint256 n = uint8(it[1]);
        for (uint256 o = 2 + n * 4; o < it.length; o += 4) {
            uint256 p = uint256(uint8(it[o])) * 24 + uint8(it[o + 1]);
            uint256 rgb = _itemRgb(it, uint8(it[o + 3])) + 1;
            for (uint256 k = 0; k < uint8(it[o + 2]); k++) cols[p + k] = rgb;
        }
    }

    function _itemRgb(bytes memory it, uint256 c) private pure returns (uint256) {
        uint256 o = 2 + (c - 1) * 4;
        return (uint256(uint8(it[o + 1])) << 16) | (uint256(uint8(it[o + 2])) << 8) | uint8(it[o + 3]);
    }

    function _pixels(bytes memory P, Layout memory L, bytes memory rec, bytes[] memory items)
        private pure returns (bytes memory out)
    {
        // categories hidden by equipped items: hat -> head(1) + hair accessory(2), eyes -> 3, mouth -> 4, neck -> 5
        uint256 hide;
        if (items[0].length > 0) hide |= (1 << 1) | (1 << 2);
        if (items[1].length > 0) hide |= 1 << 3;
        if (items[2].length > 0) hide |= 1 << 4;
        if (items[3].length > 0) hide |= 1 << 5;

        bytes memory g = new bytes(576);
        bool nohair = (uint8(rec[13]) & 1) == 1;
        for (uint256 l = 0; l < 13; l++) {
            uint256 id = uint8(rec[l]);
            if (id == 0xff) break;
            if (((hide >> uint8(P[L.catOff + id])) & 1) == 1) continue;
            if (_bit(P, L.skiOff, id)) _skiMask(g);
            else _drawLayer(P, L, g, id, nohair);
        }
        // special items on top: neck, mouth, eyes, hat
        for (uint256 k = 0; k < 4; k++) {
            uint256 sl = 3 - k;
            if (items[sl].length > 0) _drawItem(g, items[sl], sl);
        }
        // outline: an empty pixel next to a solid one becomes outline
        out = new bytes(576);
        for (uint256 p = 0; p < 576; p++) out[p] = g[p];
        for (uint256 p = 0; p < 576; p++) {
            if (uint8(g[p]) != 0) continue;
            uint256 x = p % 24;
            if ((x < 23 && _solid(P, L.noOff, g, items, p + 1)) || (x > 0 && _solid(P, L.noOff, g, items, p - 1))
                || (p < 552 && _solid(P, L.noOff, g, items, p + 24)) || (p >= 24 && _solid(P, L.noOff, g, items, p - 24))) {
                out[p] = bytes1(uint8(C_OUTLINE));
            }
        }
    }

    function _drawItem(bytes memory g, bytes memory it, uint256 sl) private pure {
        uint256 n = uint8(it[1]);
        for (uint256 o = 2 + n * 4; o < it.length; o += 4) {
            uint256 p = uint256(uint8(it[o])) * 24 + uint8(it[o + 1]);
            bytes1 code = bytes1(uint8(ITEM_BASE + sl * 12 + uint8(it[o + 3])));
            for (uint256 k = 0; k < uint8(it[o + 2]); k++) g[p + k] = code;
        }
    }

    function _drawLayer(bytes memory P, Layout memory L, bytes memory g, uint256 id, bool nohair) private pure {
        bool clip = _bit(P, L.clipOff, id);
        uint256 rEnd = _u16(P, L.offOff + id * 2 + 2);
        for (uint256 r = _u16(P, L.offOff + id * 2); r < rEnd; r++) {
            uint256 o = L.runOff + r * 4;
            uint256 c = uint8(P[o + 3]);
            if (nohair && (c == C_H || c == C_i || c == C_j)) continue;
            uint256 p = uint256(uint8(P[o])) * 24 + uint8(P[o + 1]);
            uint256 pEnd = p + uint8(P[o + 2]);
            for (; p < pEnd; p++) {
                if (clip && uint8(g[p]) == 0) continue;
                g[p] = c == C_ERASE ? bytes1(0) : bytes1(uint8(c));
            }
        }
    }

    // ski mask: every skin pixel becomes hat color, except the eye and mouth holes
    function _skiMask(bytes memory g) private pure {
        for (uint256 y = 5; y < 24; y++) {
            for (uint256 x = 0; x < 24; x++) {
                bool hole = (y >= 11 && y <= 13 && x >= 9 && x <= 16) || (y == 17 && x >= 12 && x <= 16);
                uint256 v = uint8(g[y * 24 + x]);
                if ((v == C_S || v == C_s) && !hole) g[y * 24 + x] = bytes1(uint8(C_K));
            }
        }
        if (uint8(g[7 * 24 + 10]) == C_K) g[7 * 24 + 10] = bytes1(uint8(C_k));
        if (uint8(g[7 * 24 + 13]) == C_K) g[7 * 24 + 13] = bytes1(uint8(C_k));
    }

    // ---------------- helpers ----------------
    function _solid(bytes memory P, uint256 noOff, bytes memory g, bytes[] memory items, uint256 q)
        private pure returns (bool)
    {
        uint256 c = uint8(g[q]);
        if (c == 0) return false;
        if (c >= ITEM_BASE) {
            bytes memory it = items[(c - ITEM_BASE) / 12];
            return (uint8(it[2 + ((c - ITEM_BASE) % 12 - 1) * 4]) & 1) == 0;   // flags bit0 = no outline
        }
        return !_bit(P, noOff, c);
    }

    function _bit(bytes memory b, uint256 base, uint256 i) private pure returns (bool) {
        return ((uint8(b[base + (i >> 3)]) >> (i & 7)) & 1) == 1;
    }

    function _u16c(bytes calldata b, uint256 i) private pure returns (uint256) {
        return (uint256(uint8(b[i])) << 8) | uint8(b[i + 1]);
    }

    function _u16(bytes memory b, uint256 i) private pure returns (uint256) {
        return (uint256(uint8(b[i])) << 8) | uint8(b[i + 1]);
    }

    function _str(bytes memory S, uint256 i) private pure returns (bytes memory s) {
        uint256 cnt = _u16(S, 0);
        uint256 base = 2 + (cnt + 1) * 2;
        uint256 a = _u16(S, 2 + i * 2);
        uint256 b = _u16(S, 4 + i * 2);
        s = new bytes(b - a);
        for (uint256 k = 0; k < b - a; k++) s[k] = S[base + a + k];
    }

    function _put(bytes memory buf, uint256 n, bytes memory s) private pure returns (uint256) {
        for (uint256 k = 0; k < s.length; k++) buf[n + k] = s[k];
        return n + s.length;
    }

    function _num(bytes memory buf, uint256 n, uint256 v) private pure returns (uint256) {
        if (v >= 10) buf[n++] = bytes1(uint8(48 + v / 10));
        buf[n++] = bytes1(uint8(48 + v % 10));
        return n;
    }
}

/// Special items (ERC-1155). New designs can be added later; a design can never be changed once added.
contract IIDPunksItems is ERC1155, Ownable2Step {
    struct Item { uint8 slot; address data; string name; uint256 price; uint256 maxSupply; uint256 minted; bool onSale; }

    IIDPunksRenderer public immutable renderer;
    address public avatars;                       // the only contract that can lock / release items for equipping
    uint256 public itemCount;
    mapping(uint256 => Item) public items;

    // Launch gift: every avatar can claim ONE launch item of its owner's choice for free, once, until launchEnd.
    uint256 public launchEnd;                         // unix time; 0 = no launch gift
    uint256[] private _launchItems;
    mapping(uint256 => bool) public isLaunchItem;
    mapping(uint256 => bool) public launchClaimed;    // avatar tokenId => already claimed

    event ItemAdded(uint256 indexed id, uint8 slot, string name);
    event LaunchClaimed(uint256 indexed avatarId, address indexed to, uint256 itemId);

    /// Collection name and symbol shown by marketplaces and wallets (fixed at deploy).
    string public constant name = "42AM_SpecialItems";
    string public constant symbol = "42AMSI";

    constructor(IIDPunksRenderer r) ERC1155("") Ownable(msg.sender) { renderer = r; }

    function setAvatars(address a) external onlyOwner {
        require(avatars == address(0), "already set");
        avatars = a;
    }

    /// Add a new design (art is immutable once added). maxSupply 0 = unlimited.
    function addItem(bytes calldata data, string calldata name, uint256 price, uint256 maxSupply)
        external onlyOwner returns (uint256 id)
    {
        renderer.validateItem(data);
        _checkName(name);
        id = ++itemCount;
        items[id] = Item(uint8(data[0]), SSTORE2.write(data), name, price, maxSupply, 0, false);
        emit ItemAdded(id, uint8(data[0]), name);
    }

    /// Item names go into JSON metadata as they are: 1-64 bytes, no quote, backslash or control characters.
    function _checkName(string calldata name) private pure {
        bytes calldata b = bytes(name);
        require(b.length >= 1 && b.length <= 64, "name");
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            require(c >= 0x20 && c != 0x22 && c != 0x5C && c != 0x7F, "name");
        }
    }

    function setSale(uint256 id, uint256 price, bool onSale) external onlyOwner {
        require(id >= 1 && id <= itemCount, "no item");
        items[id].price = price;
        items[id].onSale = onSale;
    }

    /// Set which items are in the launch gift and until when it can be claimed.
    function setLaunch(uint256[] calldata ids, uint256 end) external onlyOwner {
        for (uint256 i = 0; i < _launchItems.length; i++) isLaunchItem[_launchItems[i]] = false;
        for (uint256 i = 0; i < ids.length; i++) {
            require(ids[i] >= 1 && ids[i] <= itemCount, "no item");
            isLaunchItem[ids[i]] = true;
        }
        _launchItems = ids;
        launchEnd = end;
    }

    function launchItems() external view returns (uint256[] memory) { return _launchItems; }

    /// Free launch gift: one launch item of your choice per avatar. Only the avatar's owner can claim, once per avatar.
    function claimLaunch(uint256 avatarId, uint256 itemId) external {
        require(block.timestamp <= launchEnd, "launch gift closed");
        require(isLaunchItem[itemId], "not a launch item");
        require(IERC721(avatars).ownerOf(avatarId) == msg.sender, "not avatar owner");
        require(!launchClaimed[avatarId], "already claimed");
        launchClaimed[avatarId] = true;
        Item storage it = items[itemId];
        require(it.maxSupply == 0 || it.minted < it.maxSupply, "sold out");
        it.minted += 1;
        _mint(msg.sender, itemId, 1, "");
        emit LaunchClaimed(avatarId, msg.sender, itemId);
    }

    function buy(uint256 id, uint256 amount) external payable {
        Item storage it = items[id];
        require(it.onSale, "not on sale");
        require(amount > 0 && msg.value == it.price * amount, "price");   // exact amount: nothing is kept by mistake
        require(it.maxSupply == 0 || it.minted + amount <= it.maxSupply, "sold out");
        it.minted += amount;
        _mint(msg.sender, id, amount, "");
    }

    /// Called by the avatar contract when an item is equipped (from = owner, to = avatars) or released.
    function moveForEquip(address from, address to, uint256 id) external {
        require(msg.sender == avatars, "only avatars");
        uint256[] memory ids = new uint256[](1);
        uint256[] memory values = new uint256[](1);
        ids[0] = id;
        values[0] = 1;
        _update(from, to, ids, values);
    }

    function slotOf(uint256 id) external view returns (uint8) { return items[id].slot; }
    function nameOf(uint256 id) external view returns (string memory) { return items[id].name; }
    function dataOf(uint256 id) external view returns (bytes memory) { return SSTORE2.read(items[id].data); }

    function uri(uint256 id) public view override returns (string memory) {
        Item storage it = items[id];
        require(it.data != address(0), "no item");
        string[6] memory slotNames = [string("Hat"), "Eyes", "Mouth", "Neck", "Background", "Hair Color"];
        bytes memory json = abi.encodePacked(
            '{"name":"', it.name, '","description":"Special item for 42gAvaterMaker avatars.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(renderer.itemSvg(SSTORE2.read(it.data)))),
            '","attributes":[{"trait_type":"Slot","value":"', slotNames[it.slot], '"}]}'
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    function withdraw() external onlyOwner {
        (bool ok,) = payable(owner()).call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }
}

/// The avatar NFT. The record written at mint is never changed. Special items are equipped on top.
/// No admin after setup: minting is free forever, the signer is fixed at deploy, and setCawNames() (the only
/// owner action) gives up ownership in the same call. Nobody can change minted avatars or how they are drawn.
contract IIDPunksAvatars is ERC721Enumerable, Ownable, EIP712 {
    event Equipped(uint256 indexed tokenId, uint8 indexed slot, uint256 itemId);

    IIDPunksRenderer public immutable renderer;
    IIDPunksItems public immutable itemsContract;
    /// CAW NAME (username NFT) contract on this chain (42 Chain). Ownership is checked on-chain at every mint.
    /// Set exactly once with setCawNames() after the CAW NFT launches; minting is closed until then.
    address public cawNames;
    bool public cawConfigured;
    event CawNamesSet(address cawNames);
    mapping(uint256 => uint256) public avatarOfCaw;      // CAW NAME tokenId => avatar id (0 = not used yet)
    mapping(uint256 => uint256) public cawOfAvatar;      // avatar id => CAW NAME tokenId it was minted with
    address public immutable signer;   // the maker backend that checks the design rules at mint (fixed forever)
    uint256 public immutable maxSupply;
    uint256 private _lastId;                             // ids count up from 1 (totalSupply() comes from ERC721Enumerable)
    string public constant NAME = "42gAvaterMaker";
    string public constant DESCRIPTION =
        "Pixel avatars for 42GRAM, made from IID Punks parts. One per CAW NAME. Fully on-chain.";

    mapping(uint256 => bytes) private _record;
    mapping(bytes32 => bool) public lookTaken;            // a minted picture exists only once
    mapping(uint256 => uint256[6]) private _equipped;     // tokenId => item id per slot (0 = none)

    bytes32 private constant MINT_TYPEHASH =
        keccak256("Mint(address to,uint256 cawId,bytes32 recordHash,uint256 deadline)");

    event MintedWithCaw(uint256 indexed avatarId, uint256 indexed cawId, address indexed to);

    constructor(IIDPunksRenderer r, IIDPunksItems it, address signer_, uint256 maxSupply_)
        ERC721("42gAvaterMaker", "42AM") Ownable(msg.sender) EIP712("IIDPunksAvatars", "1")
    {
        renderer = r;
        itemsContract = it;
        require(signer_ != address(0), "signer");
        signer = signer_;
        maxSupply = maxSupply_;
    }

    /// One-time setting, after the CAW NFT launches. Must be a contract on this chain (address(0) is refused).
    /// This is the last owner action: ownership is given up in the same call, so the contract has no admin after it.
    function setCawNames(address a) external onlyOwner {
        require(!cawConfigured, "already set");
        require(a != address(0) && a.code.length > 0, "CAW NAME contract");
        cawNames = a;
        cawConfigured = true;
        emit CawNamesSet(a);
        _transferOwnership(address(0));
    }

    /// One avatar per CAW NAME. The caller must own the CAW NAME; each CAW NAME can be used only once, forever
    /// (selling the CAW NAME afterwards does not give the new owner another avatar).
    function mint(uint256 cawId, bytes calldata record, uint256 deadline, bytes calldata sig)
        external returns (uint256 id)
    {
        require(cawConfigured, "CAW NAME not set yet");
        require(block.timestamp <= deadline, "expired");
        require(totalSupply() < maxSupply, "sold out");
        require(avatarOfCaw[cawId] == 0, "CAW NAME already used");
        require(IERC721(cawNames).ownerOf(cawId) == msg.sender, "not CAW NAME owner");
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(MINT_TYPEHASH, msg.sender, cawId, keccak256(record), deadline))
        );
        require(ECDSA.recover(digest, sig) == signer, "bad signature");
        renderer.validate(record);
        bytes32 look = renderer.lookHash(record);
        require(!lookTaken[look], "look taken");
        lookTaken[look] = true;
        id = ++_lastId;
        _record[id] = record;
        avatarOfCaw[cawId] = id;
        cawOfAvatar[id] = cawId;
        _safeMint(msg.sender, id);
        emit MintedWithCaw(id, cawId, msg.sender);
    }

    /// Equip a special item you own. If the slot already has an item, that item comes back to you.
    function equip(uint256 tokenId, uint256 itemId) external {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        require(itemId >= 1 && itemId <= itemsContract.itemCount(), "no item");
        uint8 slot = itemsContract.slotOf(itemId);
        itemsContract.moveForEquip(msg.sender, address(this), itemId);          // reverts if you do not own it
        uint256 old = _equipped[tokenId][slot];
        if (old != 0) itemsContract.moveForEquip(address(this), msg.sender, old);
        _equipped[tokenId][slot] = itemId;
        emit Equipped(tokenId, slot, itemId);
    }

    /// Take an item off. It goes back to the avatar's current owner.
    function unequip(uint256 tokenId, uint8 slot) external {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        uint256 old = _equipped[tokenId][slot];
        require(old != 0, "empty slot");
        _equipped[tokenId][slot] = 0;
        itemsContract.moveForEquip(address(this), msg.sender, old);
        emit Equipped(tokenId, slot, 0);
    }

    function equippedOf(uint256 tokenId) external view returns (uint256[6] memory) { return _equipped[tokenId]; }

    /// Every avatar an address holds, in one call (for the "My avatars" screen).
    function avatarsOf(address holder) external view returns (uint256[] memory ids) {
        ids = new uint256[](balanceOf(holder));
        for (uint256 i = 0; i < ids.length; i++) ids[i] = tokenOfOwnerByIndex(holder, i);
    }

    function recordOf(uint256 id) external view returns (bytes memory) {
        _requireOwned(id);
        return _record[id];
    }

    /// What marketplaces and wallets show: the minted avatar alone, never the special items.
    /// Equipped items go back to the seller on every transfer, so this is exactly what a buyer gets.
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return renderer.tokenURI(id, _record[id], new bytes[](6), new string[](6), NAME, DESCRIPTION);
    }

    /// The avatar wearing its special items (for 42GRAM and the maker).
    function dressedTokenURI(uint256 id) external view returns (string memory) {
        _requireOwned(id);
        bytes[] memory blobs = new bytes[](6);
        string[] memory names = new string[](6);
        for (uint256 s = 0; s < 6; s++) {
            uint256 it = _equipped[id][s];
            if (it != 0) {
                blobs[s] = itemsContract.dataOf(it);
                names[s] = itemsContract.nameOf(it);
            }
        }
        return renderer.tokenURI(id, _record[id], blobs, names, NAME, DESCRIPTION);
    }

    /// Items are never sold together with an avatar: on any transfer, everything it wears goes back to the
    /// previous owner (so nobody can take items off between a sale and its settlement).
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != from) {
            for (uint8 s = 0; s < 6; s++) {
                uint256 it = _equipped[tokenId][s];
                if (it != 0) {
                    _equipped[tokenId][s] = 0;
                    itemsContract.moveForEquip(address(this), from, it);
                    emit Equipped(tokenId, s, 0);
                }
            }
        }
    }
}

// On-chain data format for IID Punks avatars + a JS mirror of the Solidity renderer.
//
// PARTS blob (written once by the owner, read by the renderer):
//   u16 N sprites | u8 C colors | C*3 rgb | 64 fixedColor[code] (0xFF = per-token) | 64 varSlot[code] (0xFF = fixed)
//   | 8 noOutline bitmap (by code) | ceil(N/8) clip bitmap | ceil(N/8) skimask bitmap | N category (0 base, 1 head, 2 hair acc,
//   3 eyes, 4 mouth, 5 neck: hidden by a special item) | (N+1)*u16 run offsets | runs (y,x,len,code)
// ITEM blob (one per special item, added later, never changed):
//   u8 slot (0 hat 1 eyes 2 mouth 3 neck 4 bg 5 hair color) | u8 n colors | n * (flags bit0 = no outline, r, g, b) | runs (y,x,len,color 1..n)
//   hair color items have no runs: n = 2k colors = k band colors then k highlights; hair pixels on row y use band (y/2) % k
// TOKEN record (stored once at mint, never changed):
//   13 layer ids (0xFF = empty) | u8 flags (bit0 = no hair) | 21 palette color ids | u8 attr count | count * (traitType, prefix, name) string ids
(function (root) {
  const E = root.PunkEngine;
  const ALPHABET = "\0_OSsfHjiKkaGwLIvlmBduEQqWPbMgYRrnezVTchpDyZXJAUNFtx"; // code = index
  const VAR = "SsfHiKkaGwLIvlmBduEQq".split("");                         // 21 per-token palette slots (j = H)
  const code = ch => { const i = ALPHABET.indexOf(ch); if (i < 1) throw new Error("no code for " + ch); return i; };

  function buildParts() {
    const P = E.P;
    const names = Object.keys(P.sprites).sort();
    const id = Object.fromEntries(names.map((n, i) => [n, i]));
    // every color that can ever appear: FIXED + all values of the per-token slots
    const colors = [];
    const cid = h => { h = h.toUpperCase(); let i = colors.indexOf(h); if (i < 0) { colors.push(h); i = colors.length - 1; } return i; };
    for (const ch in P.FIXED) code(ch), cid(P.FIXED[ch]);
    const skins = [...Object.values(P.SKINS), ...Object.values(P.CAT_FUR), ...Object.values(P.TYPE_SKIN),
      ...P.CAT_PATTERNS.filter(c => c[2]).map(c => c[2]), ...P.DOG_BREEDS.flatMap(b => b[4].map(c => c[1]))];
    for (const [a, b] of skins) { cid(a); cid(b); cid(E.darker(b, 0.68)); }
    for (const [, h] of P.HAIR_COLORS) { cid(h); cid(E.lighter(h)); }
    for (const [, h] of P.HAT_COLORS) { cid(h); cid(E.darker(h)); }
    for (const [, h] of P.LENS_COLORS) { cid(h); cid(E.lighter(h, 0.55)); }
    for (const t of [P.LIP_COLORS, P.LASER_COLORS, P.METALS, P.BEARD_OPTS, P.SHADOW_COLORS, P.IRIS_COLORS]) for (const x of t) cid(x[1]);
    for (const [, [a, b]] of P.CAT_EYES) { cid(a); cid(b); }
    P.CAT_PATTERNS.forEach(c => { if (c[3]) cid(c[3]); if (c[4]) c[4][1].forEach(cid); });
    P.DOG_BREEDS.forEach(b => { [b[5], b[6], b[7]].forEach(h => h && cid(h)); });
    ["#22252B", "#FFFFFF", "#C8C8C8", "#3A3A3A"].forEach(cid);
    const fixedColor = new Array(64).fill(0xff), varSlot = new Array(64).fill(0xff);
    for (let c = 1; c < ALPHABET.length; c++) {
      const ch = ALPHABET[c];
      const v = VAR.indexOf(ch === "j" ? "H" : ch);
      if (v >= 0) varSlot[c] = v; else if (P.FIXED[ch]) fixedColor[c] = cid(P.FIXED[ch]);
    }
    const noOut = new Array(8).fill(0);
    for (const ch of P.NO_OUTLINE) { const c = code(ch); noOut[c >> 3] |= 1 << (c & 7); }
    const bm = () => new Array(Math.ceil(names.length / 8)).fill(0);
    const clip = bm(), ski = bm();
    names.forEach((n, i) => {
      if (P.CLIP_LAYERS.includes(n)) clip[i >> 3] |= 1 << (i & 7);
      if (n.startsWith("skimask")) ski[i >> 3] |= 1 << (i & 7);
    });
    const runs = [], offs = [0];
    for (const n of names) {
      const g = P.sprites[n];
      for (let y = 0; y < 24; y++) {
        let x = 0;
        while (x < 24) {
          const ch = g[y][x];
          if (ch === ".") { x++; continue; }
          let e = x; while (e < 24 && g[y][e] === ch) e++;
          runs.push(y, x, e - x, code(ch)); x = e;
        }
      }
      offs.push(runs.length / 4);
    }
    const CATN = { head: 1, hacc: 2, eyes: 3, mouth: 4, neck: 5 };
    const cat = names.map(n => CATN[E.categoryOf(n)] || 0);
    return { names, id, colors, cid, fixedColor, varSlot, noOut, clip, ski, cat, offs, runs };
  }

  function partsBytes(pt) {
    const b = [];
    const u16 = v => b.push(v >> 8, v & 255);
    u16(pt.names.length);
    if (pt.colors.length > 255) throw new Error("too many colors");
    b.push(pt.colors.length);
    for (const h of pt.colors) { const [r, g, bl] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); b.push(r, g, bl); }
    b.push(...pt.fixedColor, ...pt.varSlot, ...pt.noOut, ...pt.clip, ...pt.ski, ...pt.cat);
    for (const o of pt.offs) u16(o);
    b.push(...pt.runs);
    return Uint8Array.from(b);
  }

  // string table for metadata attributes
  function buildStrings() {
    const P = E.P, set = new Set(["Type", "Skin", "Fur", "Breed", "Eye Color", "Face Shape", "Nose", "Expression", "Face",
      "Facial Hair", "Mouth", "Neck", "Ear", "Eyes", "Head", "Hair Accessory", "Gear", ...E.TYPES]);
    const add = t => t.forEach(x => x[1] && set.add(x[1]));
    [P.HEAD, P.EYES, P.MOUTH, P.SKULL_MOUTH, P.DOG_MOUTH, P.FACIAL, P.FACE, P.EAR, P.NECK, P.HAIR_ACC, P.GEAR,
      P.FACE_SHAPES_M, P.FACE_SHAPES_F, P.NOSES, P.EXPRESSIONS].forEach(add);
    [P.HAIR_COLORS, P.HAT_COLORS, P.LENS_COLORS, P.LIP_COLORS, P.LASER_COLORS, P.SHADOW_COLORS, P.METALS, P.IRIS_COLORS,
      P.CAT_EYES, P.BEARD_OPTS].forEach(t => t.forEach(x => set.add(x[0])));
    P.SKIN_NAMES.forEach(n => set.add(n)); P.CAT_FUR_NAMES.forEach(n => set.add(n));
    P.CAT_PATTERNS.forEach(c => set.add(c[1]));
    P.DOG_BREEDS.forEach(b => { set.add(b[1]); b[4].forEach(c => c[0] && set.add(c[0])); });
    const list = ["", ...[...set].sort()];
    if (list.length > 256) throw new Error("too many strings: " + list.length);
    return list;
  }
  function stringsBytes(list) {
    const enc = new TextEncoder(), parts = list.map(s => enc.encode(s));
    const b = [list.length >> 8, list.length & 255];
    let o = 0; for (const p of parts) { b.push(o >> 8, o & 255); o += p.length; } b.push(o >> 8, o & 255);
    for (const p of parts) b.push(...p);
    return Uint8Array.from(b);
  }

  // attribute value -> (prefix, name) ; e.g. "Red Peak Spike" -> ("Red", "Peak Spike"), "Golden Labrador" -> ("Golden","Labrador")
  function splitAttr(strs, v) {
    if (strs.includes(v)) return [0, strs.indexOf(v)];
    const sp = v.indexOf(" ");
    // try the longest known name that the value ends with
    for (let i = sp; i >= 0 && i < v.length; i = v.indexOf(" ", i + 1)) {
      const pre = v.slice(0, i), name = v.slice(i + 1);
      if (strs.includes(pre) && strs.includes(name)) return [strs.indexOf(pre), strs.indexOf(name)];
    }
    throw new Error("cannot encode attribute " + v);
  }

  function tokenRecord(pt, strs, sel) {
    const b = E.build(E.canonical(sel));
    const rc = b.recipe;
    const layers = rc.layers.map(n => { if (!(n in pt.id)) throw new Error("unknown sprite " + n); return pt.id[n]; });
    if (layers.length > 13) throw new Error("too many layers");
    const pal = E.palette(rc);
    if (b.baseLayers > 7 || b.baseAttrs > 7) throw new Error("base too long");
    // flags: bit0 no hair | bits1-3 base layer count | bits4-6 base attribute count
    const rec = [...layers, ...new Array(13 - layers.length).fill(0xff), (rc.nohair ? 1 : 0) | (b.baseLayers << 1) | (b.baseAttrs << 4)];
    for (const ch of VAR) { const i = pt.colors.indexOf(String(pal[ch]).toUpperCase()); if (i < 0) throw new Error("color not in table " + ch + pal[ch]); rec.push(i); }
    rec.push(b.attrs.length);
    for (const [k, v] of b.attrs) rec.push(strs.indexOf(k), ...splitAttr(strs, v));
    return { bytes: Uint8Array.from(rec), attrs: b.attrs, recipe: rc };
  }

  // palette slots that belong to the base: S s f I v u d Q q
  const BASE_PAL = ["S", "s", "f", "I", "v", "u", "d", "Q", "q"].map(c => VAR.indexOf(c));
  // mirror of IIDPunksRenderer.requireSameBase()
  function sameBaseBytes(a, b) {
    if (a[13] !== b[13]) return false;
    const nl = (a[13] >> 1) & 7, na = (a[13] >> 4) & 7;
    for (let i = 0; i < nl; i++) if (a[i] !== b[i]) return false;
    for (const v of BASE_PAL) if (a[14 + v] !== b[14 + v]) return false;
    for (let i = 0; i < na * 3; i++) if (a[36 + i] !== b[36 + i]) return false;
    return true;
  }
  // mirror of IIDPunksRenderer.lookHash(): identity of the picture (colors of all 576 pixels)
  const lookKey = (parts, rec) => JSON.stringify(renderFromBytes(parts, rec));

  const SLOT_ID = { hat: 0, eyes: 1, mouth: 2, neck: 3, bg: 4, hair: 5 };
  const SLOT_HIDES = [[1, 2], [3], [4], [5], [], []];      // categories hidden by each slot
  function itemBytes(it) {
    if (it.slot === "hair") {
      const cols = [...it.bands, ...it.highlights];
      if (it.bands.length !== it.highlights.length || cols.length > 24) throw new Error("bad hair color item");
      return Uint8Array.from([5, cols.length, ...cols.flatMap(h => [0, ...[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))])]);
    }
    const chars = Object.keys(it.pal);
    if (chars.length > 11) throw new Error("max 11 colors per item");
    const b = [SLOT_ID[it.slot], chars.length];
    for (const ch of chars) {
      const v = Array.isArray(it.pal[ch]) ? it.pal[ch] : [it.pal[ch]];
      b.push(v[1] === "noOutline" ? 1 : 0, ...[1, 3, 5].map(i => parseInt(v[0].slice(i, i + 2), 16)));
    }
    for (let y = 0; y < 24; y++) {
      const r = it.rows[y] || ""; let x = 0;
      while (x < Math.min(24, r.length)) {
        if (r[x] === ".") { x++; continue; }
        let e = x; while (e < Math.min(24, r.length) && r[e] === r[x]) e++;
        b.push(y, x, e - x, chars.indexOf(r[x]) + 1); x = e;
      }
    }
    return Uint8Array.from(b);
  }

  // ---- JS mirror of the Solidity renderer, reading only the byte blobs ----
  // items: array of 5 item blobs or null, indexed by slot id (hat, eyes, mouth, neck, bg)
  function renderFromBytes(parts, rec, items = []) {
    const u16 = i => (parts[i] << 8) | parts[i + 1];
    const N = u16(0), C = parts[2];
    const colOff = 3, fixOff = colOff + C * 3, varOff = fixOff + 64, noOff = varOff + 64;
    const bmLen = (N + 7) >> 3, clipOff = noOff + 8, skiOff = clipOff + bmLen, catOff = skiOff + bmLen, offOff = catOff + N, runOff = offOff + (N + 1) * 2;
    let hideMask = 0;
    for (let sl = 0; sl < 4; sl++) if (items[sl]) for (const c of SLOT_HIDES[sl]) hideMask |= 1 << c;
    const bit = (base, i) => (parts[base + (i >> 3)] >> (i & 7)) & 1;
    const cS = 3, cs = 4, cH = 6, cj = 7, ci = 8, cK = 9, ck = 10, cO = 2, cErase = 1;
    const g = new Uint8Array(576);
    const nohair = rec[13] & 1;
    for (let l = 0; l < 13; l++) {
      const id = rec[l]; if (id === 0xff) break;
      if ((hideMask >> parts[catOff + id]) & 1) continue;
      if (bit(skiOff, id)) {
        for (let y = 5; y < 24; y++) for (let x = 0; x < 24; x++) {
          const hole = (y >= 11 && y <= 13 && x >= 9 && x <= 16) || (y === 17 && x >= 12 && x <= 16);
          const p = y * 24 + x; if ((g[p] === cS || g[p] === cs) && !hole) g[p] = cK;
        }
        for (const x of [10, 13]) if (g[7 * 24 + x] === cK) g[7 * 24 + x] = ck;
        continue;
      }
      const clip = bit(clipOff, id);
      for (let r = u16(offOff + id * 2); r < u16(offOff + id * 2 + 2); r++) {
        const o = runOff + r * 4, y = parts[o], x0 = parts[o + 1], len = parts[o + 2], c = parts[o + 3];
        if (nohair && (c === cH || c === ci || c === cj)) continue;
        for (let x = x0; x < x0 + len; x++) {
          const p = y * 24 + x;
          if (clip && g[p] === 0) continue;
          g[p] = c === cErase ? 0 : c;
        }
      }
    }
    // special items on top, codes 64 + slot*12 + color (draw order: neck, mouth, eyes, hat)
    const itemRuns = (blob, fn) => { const n = blob[1]; for (let o = 2 + n * 4; o < blob.length; o += 4) fn(blob[o], blob[o + 1], blob[o + 2], blob[o + 3]); };
    for (const sl of [3, 2, 1, 0]) {
      const blob = items[sl]; if (!blob) continue;
      itemRuns(blob, (y, x0, len, c) => { for (let x = x0; x < x0 + len; x++) g[y * 24 + x] = 64 + sl * 12 + c; });
    }
    const solid = c => {
      if (!c) return false;
      if (c >= 64) { const sl = ((c - 64) / 12) | 0, ci = (c - 64) % 12; return (items[sl][2 + (ci - 1) * 4] & 1) === 0; }
      return !bit(noOff, c);
    };
    const out = Uint8Array.from(g);
    for (let p = 0; p < 576; p++) {
      if (g[p]) continue;
      const y = (p / 24) | 0, x = p % 24;
      const nb = [x < 23 ? p + 1 : -1, x > 0 ? p - 1 : -1, y < 23 ? p + 24 : -1, y > 0 ? p - 24 : -1];
      for (const q of nb) if (q >= 0 && solid(g[q])) { out[p] = cO; break; }
    }
    // background item behind everything
    const bgc = new Array(576).fill(null);
    if (items[4]) itemRuns(items[4], (y, x0, len, c) => { for (let x = x0; x < x0 + len; x++) bgc[y * 24 + x] = c; });
    const hex = (a, o) => "#" + [a[o], a[o + 1], a[o + 2]].map(n => n.toString(16).toUpperCase().padStart(2, "0")).join("");
    // codes -> color ids -> hex
    return Array.from({ length: 24 }, (_, y) => Array.from({ length: 24 }, (_, x) => {
      const c = out[y * 24 + x];
      if (!c) { const b = bgc[y * 24 + x]; return b ? hex(items[4], 2 + (b - 1) * 4 + 1) : null; }
      if (c >= 64) { const sl = ((c - 64) / 12) | 0, ci = (c - 64) % 12; return hex(items[sl], 2 + (ci - 1) * 4 + 1); }
      if (items[5] && (c === cH || c === cj || c === ci)) {         // hair color item
        const k = items[5][1] / 2, b = ((y >> 1) % k) + (c === ci ? k : 0);
        return hex(items[5], 2 + b * 4 + 1);
      }
      const v = parts[varOff + c];
      const ci2 = v !== 0xff ? rec[14 + v] : parts[fixOff + c];
      const o = colOff + ci2 * 3;
      return "#" + [parts[o], parts[o + 1], parts[o + 2]].map(n => n.toString(16).toUpperCase().padStart(2, "0")).join("");
    }));
  }

  // Same value as IIDPunksRenderer.lookHash(): keccak256(abi.encodePacked(uint256[576] rgb+1, 0 = transparent))
  function lookHashOfGrid(grid) {
    const b = new Uint8Array(576 * 32);
    grid.flat().forEach((c, i) => {
      if (!c) return;
      const v = parseInt(c.slice(1), 16) + 1;
      // rgb + 1 can reach 0x1000000 (white), so it needs 4 bytes
      b[i * 32 + 28] = (v >>> 24) & 255; b[i * 32 + 29] = (v >>> 16) & 255; b[i * 32 + 30] = (v >>> 8) & 255; b[i * 32 + 31] = v & 255;
    });
    return root.keccak256(b);
  }

  root.PunkOnchain = { lookHashOfGrid, ALPHABET, VAR, buildParts, partsBytes, buildStrings, stringsBytes, tokenRecord, renderFromBytes, sameBaseBytes, lookKey, BASE_PAL, itemBytes, SLOT_ID };
})(typeof window !== "undefined" ? window : globalThis);

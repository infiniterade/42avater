// IID Punks avatar engine: JS port of generate_punks.py roll()/render() rules.
// Selection (what the user picks) -> recipe (layers + colors) -> 24x24 pixel grid -> SVG.
(function (root) {
  let P = null, S = null, CAT = {};
  const ITEM_HIDES = { hat: ["head", "hacc"], eyes: ["eyes"], mouth: ["mouth"], neck: ["neck"], bg: [], hair: [] };
  const ITEM_ORDER = ["neck", "mouth", "eyes", "hat"];          // drawing order of special items (bg goes behind)
  const itemPal = (it, ch) => { const v = it.pal[ch]; return Array.isArray(v) ? v : [v]; };
  const W = 24;
  const TYPES = ["Male", "Female", "Gold", "Ghost", "Skeleton", "Robot", "Cat", "Dog"];

  function init(parts) {
    P = parts;
    S = {};
    for (const k in P.sprites) S[k] = P.sprites[k].map(r => [...r].map(c => (c === "." ? null : c)));
    P.BEARD_OPTS = P.BEARD_COLORS.map(b => [b[0], b[1]]);
    const orange = P.HAIR_COLORS.find(h => h[0] === "Orange");
    P.BEARD_OPTS.push([orange[0], orange[1]]);
    P.SKIN_NAMES = Object.keys(P.SKINS);
    // which original layers a special item hides while it is equipped
    CAT = {};
    const put = (n, c) => { if (!n) return; CAT[n] = c; if (S[n + "_f"]) CAT[n + "_f"] = c; };
    P.HEAD.forEach(h => put(h[0], "head"));
    P.HAIR_ACC.forEach(h => put(h[0], "hacc"));
    P.EYES.forEach(h => put(h[0], "eyes"));
    [...P.MOUTH, ...P.SKULL_MOUTH, ...P.DOG_MOUTH].forEach(h => put(h[0], "mouth"));
    for (const n in S) if (/^dog_(tongue|bone)_/.test(n)) CAT[n] = "mouth";
    P.NECK.forEach(h => put(h[0], "neck"));
    P.CAT_FUR_NAMES = Object.keys(P.CAT_FUR);
  }

  // ---------- color helpers (exact ports of the Python truncation) ----------
  const hexc = h => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const hx = n => n.toString(16).toUpperCase().padStart(2, "0");
  const darker = (h, f = 0.72) => "#" + hexc(h).map(v => hx(Math.trunc(v * f))).join("");
  const lighter = (h, f = 0.38) => "#" + hexc(h).map(v => hx(Math.trunc(v + (255 - v) * f))).join("");

  // ---------- which options are available for the current selection ----------
  const col = sel => (sel.type === "Female" ? 3 : 2);
  const has = (t, sel) => t.map((x, i) => [x, i]).filter(([x]) => x[col(sel)] > 0);
  const isHuman = sel => sel.type === "Male" || sel.type === "Female";
  const humanlike = sel => isHuman(sel) || sel.type === "Gold";
  const sexF = sel => sel.type === "Female";
  const breed = sel => P.DOG_BREEDS[sel.dogBreed || 0];
  const catPat = sel => P.CAT_PATTERNS[sel.catPattern || 0];
  const headItem = sel => P.HEAD[sel.head || 0];
  const NONE_ONLY = [[[null, null, 1, 1, null], 0]];

  function accFits(acc, hair) {
    const g = S[hair];
    const isHair = (y, x) => ["H", "i", "j"].includes(g[y][x]);
    if (acc === "hairclip") return [13, 14, 15].every(x => isHair(8, x));
    if (acc === "flower") return [9, 10, 11].every(y => isHair(y, 6));
    return true;
  }

  // returns {slot: [[item, index], ...]} ; an empty list means the slot is not used for this selection
  function options(sel) {
    const o = {};
    const hl = humanlike(sel);
    // head
    if (sel.type === "Robot") o.head = P.HEAD.map((h, i) => [h, i]).filter(([h]) => !h[0] || P.ROBOT_HEAD.includes(h[0]));
    else if (sel.type === "Dog") o.head = breed(sel)[2] === "pointy" ? NONE_ONLY
      : P.HEAD.map((h, i) => [h, i]).filter(([h]) => !h[0] || P.DOG_HEAD.includes(h[0]));
    else if (sel.type === "Cat") o.head = NONE_ONLY;
    else if (isHuman(sel)) o.head = has(P.HEAD, sel);
    else o.head = has(P.HEAD, sel).filter(([h]) => h[0] !== "skimask");
    const head = headItem(sel);
    // eyes
    o.eyes = sel.type === "Robot" ? NONE_ONLY : has(P.EYES, sel);
    // mouth (table depends on type)
    if (hl) {
      o.mouth = has(P.MOUTH, sel);
      if (head[0] === "skimask") o.mouth = o.mouth.filter(([m]) => P.MASK_OK_MOUTHS.includes(m[0]));
    } else if (sel.type === "Skeleton") o.mouth = has(P.SKULL_MOUTH, sel);
    else if (sel.type === "Dog") o.mouth = has(P.DOG_MOUTH, sel).filter(([m]) => !(["cigar", "pipe"].includes(m[0]) && breed(sel)[3] === "short"));
    else o.mouth = [];
    const mouth = mouthItem(sel);
    o.facial = hl && !sexF(sel) && !["mask", "gasmask"].includes(mouth[0]) && !P.HIDES_FACE.includes(head[0]) ? has(P.FACIAL, sel) : [];
    o.face = hl && !P.HIDES_FACE.includes(head[0]) ? has(P.FACE, sel) : [];
    o.gear = hl && (head[0] === null || head[4] === "hair") && !P.NO_MIC.includes(mouth[0]) ? has(P.GEAR, sel) : [];
    const gear = P.GEAR[sel.gear || 0];
    o.ear = hl && !P.HIDES_EAR.includes(head[0]) && gear[0] === null ? has(P.EAR, sel) : [];
    o.hacc = isHuman(sel) && P.HAIR_ACC_OK.includes(head[0])
      ? has(P.HAIR_ACC, sel).filter(([a]) => a[0] === null || accFits(a[0], head[0])) : [];
    const facial = P.FACIAL[sel.facial || 0];
    o.neck = !P.HIDES_NECK.includes(head[0]) && !P.BIG_BEARDS.includes(facial[0]) ? has(P.NECK, sel) : [];
    if (hl) {
      o.shape = has(sexF(sel) ? P.FACE_SHAPES_F : P.FACE_SHAPES_M, sel);
      o.nose = P.FACE[sel.face || 0][0] === "clownnose" ? [[P.NOSES[0], 0]] : has(P.NOSES, sel);
      o.expr = has(P.EXPRESSIONS, sel);
      if (P.EYES[sel.eyes || 0][0] === "angry") o.expr = o.expr.filter(([e]) => P.ANGRY_OK.includes(e[0]));
    } else { o.shape = []; o.nose = []; o.expr = []; }
    return o;
  }

  function mouthItem(sel) {
    if (humanlike(sel)) return P.MOUTH[sel.mouth || 0];
    if (sel.type === "Skeleton") return P.SKULL_MOUTH[sel.mouth || 0];
    if (sel.type === "Dog") return P.DOG_MOUTH[sel.mouth || 0];
    return [null, null, 0, 0, null];
  }

  // keep every slot inside the allowed options (fixed-point, because rules depend on each other)
  function normalize(sel) {
    sel = { ...sel };
    for (let pass = 0; pass < 6; pass++) {
      const o = options(sel);
      let changed = false;
      for (const k of ["head", "eyes", "mouth", "facial", "face", "gear", "ear", "hacc", "neck", "shape", "nose", "expr"]) {
        const list = o[k];
        const cur = sel[k] || 0;
        const ok = list.length ? list.some(([, i]) => i === cur) : cur === 0;
        if (!ok) {
          const none = list.find(([x]) => x[0] === null || x[0] === "" || x[0] === "base" || x[0] === "base_f");
          sel[k] = list.length ? (none ? none[1] : list[0][1]) : 0;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return sel;
  }

  // ---------- selection -> recipe + attributes (mirrors roll()) ----------
  function build(sel) {
    sel = normalize(sel);
    const t = sel.type, human = isHuman(sel), hl = humanlike(sel), f = sexF(sel);
    const attrs = [["Type", t]];
    const layers = [f ? "base_f" : "base"];
    const hair = P.HAIR_COLORS[sel.hairColor || 0], hat = P.HAT_COLORS[sel.hatColor || 0];
    const lens = P.LENS_COLORS[sel.lensColor || 0], lips = P.LIP_COLORS[sel.lipColor || 0];
    const shadow = P.SHADOW_COLORS[sel.shadowColor || 0], laser = P.LASER_COLORS[sel.laserColor || 0];
    const metal = P.METALS[sel.metal || 0], beard = P.BEARD_OPTS[sel.beardColor || 0];
    let skin, catEye = null, mark = null, earC = null, dogIris = null, whisk = null;
    if (human) {
      const n = P.SKIN_NAMES[sel.skin || 0]; skin = P.SKINS[n]; attrs.push(["Skin", n]);
    } else if (t === "Cat") {
      const pat = catPat(sel);
      let name = null;
      if (pat[2] === null) { name = P.CAT_FUR_NAMES[sel.catFur || 0]; skin = P.CAT_FUR[name]; attrs.push(["Fur", `${name} ${pat[1]}`]); }
      else { skin = pat[2]; attrs.push(["Fur", pat[1]]); }
      mark = pat[3];
      catEye = pat[4] ? pat[4] : P.CAT_EYES[sel.catEye || 0];
      attrs.push(["Eye Color", catEye[0]]);
      layers.push(pat[0]);
      whisk = pat[1] === "Siamese" || (pat[2] === null && name === "Black") ? "#C8C8C8" : "#3A3A3A";
    } else if (t === "Dog") {
      const b = breed(sel);
      const [cname, sk] = b[4][Math.min(sel.dogColor || 0, b[4].length - 1)];
      skin = sk;
      attrs.push(["Breed", cname ? `${cname} ${b[1]}` : b[1]]);
      mark = b[5]; earC = b[6] || sk[1]; dogIris = b[7];
      layers.push(b[0]);
      whisk = b[1] === "Pug" || cname === "Black" ? "#C8C8C8" : "#3A3A3A";
    } else skin = P.TYPE_SKIN[t];
    if (!human && t !== "Cat" && t !== "Dog") layers.push(P.TYPE_SPRITE[t]);

    const head = headItem(sel), eyes = P.EYES[sel.eyes || 0];
    let mouth = mouthItem(sel);
    if (t === "Dog" && ["tongue", "bone"].includes(mouth[0])) mouth = [`dog_${mouth[0]}_${breed(sel)[3]}`, ...mouth.slice(1)];
    const facial = P.FACIAL[sel.facial || 0], face = P.FACE[sel.face || 0], gear = P.GEAR[sel.gear || 0];
    const ear = P.EAR[sel.ear || 0], hacc = P.HAIR_ACC[sel.hacc || 0], neck = P.NECK[sel.neck || 0];

    let iris = null;
    if (hl) {
      const shape = (f ? P.FACE_SHAPES_F : P.FACE_SHAPES_M)[sel.shape || 0];
      layers[0] = shape[0];
      if (shape[1]) attrs.push(["Face Shape", shape[1]]);
      const nose = P.NOSES[sel.nose || 0];
      if (nose[1]) attrs.push(["Nose", nose[1]]);
      const expr = P.EXPRESSIONS[sel.expr || 0];
      if (expr[1]) attrs.push(["Expression", expr[1]]);
      iris = P.IRIS_COLORS[sel.iris || 0];
      if (iris[0] !== "Dark") attrs.push(["Eye Color", iris[0]]);
      layers.push((f ? "eyes_f" : "eyes") + expr[0]);
      if (nose[0]) layers.push(nose[0]);
    }
    const baseLayers = layers.length, baseAttrs = attrs.length;
    const label = it => {
      const c = it[4];
      const m = { hair: hair[0], beard: beard[0], hat: hat[0], lens: lens[0], lips: lips[0], shadow: shadow[0], laser: laser[0], metal: metal[0] };
      return m[c] ? `${m[c]} ${it[1]}` : it[1];
    };
    for (const [slot, it] of [["Face", face], ["Facial Hair", facial], ["Mouth", mouth], ["Neck", neck], ["Ear", ear],
      ["Eyes", eyes], ["Head", head], ["Hair Accessory", hacc], ["Gear", gear]]) {
      if (it[0]) {
        const fv = it[0] + "_f";
        layers.push(f && S[fv] && !["base", "eyes"].includes(it[0]) ? fv : it[0]);
        attrs.push([slot, label(it)]);
      }
    }
    const recipe = {
      layers, skin, hair: hair[1], hat: hat[1], accent: hat[0] === "White" ? "#22252B" : "#FFFFFF",
      lens: lens[1], lips: lips[1], shadow: shadow[1], nohair: t === "Robot" || t === "Dog",
      cat_eye: catEye ? catEye[1] : null, iris: iris ? iris[1] : dogIris, mark, ear: earC,
      laser: laser[1], metal: metal[1], beard: beard[1], whisk,
    };
    return { sel, attrs, recipe, baseLayers, baseAttrs };
  }

  // ---------- recipe -> 24x24 grid of palette letters, then colors (mirrors render()) ----------
  // items: equipped special items (any order, one per slot). Item pixels are "@slot:char" tokens.
  function compose(rc, items = []) {
    const clipSet = new Set(P.CLIP_LAYERS), noOut = new Set(P.NO_OUTLINE);
    const g = Array.from({ length: W }, () => Array(W).fill(null));
    const bySlot = Object.fromEntries(items.map(it => [it.slot, it]));
    const hidden = new Set(items.flatMap(it => ITEM_HIDES[it.slot]));
    for (const name of rc.layers) {
      if (hidden.has(CAT[name])) continue;
      if (name.startsWith("skimask")) {
        for (let y = 5; y < W; y++) for (let x = 0; x < W; x++) {
          const hole = (y >= 11 && y <= 13 && x >= 9 && x <= 16) || (y === 17 && x >= 12 && x <= 16);
          if ((g[y][x] === "S" || g[y][x] === "s") && !hole) g[y][x] = "K";
        }
        for (const x of [10, 13]) if (g[7][x] === "K") g[7][x] = "k";
        continue;
      }
      const s = S[name], clip = clipSet.has(name);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const c = s[y][x];
        if (rc.nohair && (c === "H" || c === "i" || c === "j")) continue;
        if (clip && g[y][x] === null) continue;
        if (c === "_") g[y][x] = null; else if (c) g[y][x] = c;
      }
    }
    for (const slot of ITEM_ORDER) {
      const it = bySlot[slot]; if (!it) continue;
      for (const y in it.rows) [...it.rows[y]].forEach((ch, x) => { if (ch !== "." && x < W) g[+y][x] = `@${slot}:${ch}`; });
    }
    const solid = c => {
      if (c === null) return false;
      if (c[0] === "@") { const [sl, ch] = c.slice(1).split(":"); return itemPal(bySlot[sl], ch)[1] !== "noOutline"; }
      return !noOut.has(c);
    };
    const out = g.map(r => r.slice());
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (g[y][x] !== null) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < W && solid(g[ny][nx])) { out[y][x] = "O"; break; }
      }
    }
    return out;
  }

  function palette(rc) {
    const pal = { ...P.FIXED };
    [pal.S, pal.s] = rc.skin;
    pal.f = darker(rc.skin[1], 0.68);
    pal.H = pal.j = rc.hair; pal.i = lighter(rc.hair);
    pal.K = rc.hat; pal.k = darker(rc.hat); pal.a = rc.accent;
    pal.G = rc.lens; pal.w = lighter(rc.lens, 0.55);
    pal.L = rc.lips;
    if (rc.iris) pal.I = rc.iris;
    if (rc.mark) pal.v = rc.mark;
    if (rc.laser) pal.l = rc.laser;
    if (rc.metal) pal.m = rc.metal;
    pal.B = rc.beard || rc.hair;
    if (rc.whisk) pal.d = rc.whisk;
    if (rc.ear) pal.u = rc.ear;
    pal.E = rc.shadow;
    if (rc.cat_eye) [pal.Q, pal.q] = rc.cat_eye;
    return pal;
  }

  function render(rc, items = []) {
    const out = compose(rc, items), pal = palette(rc);
    const bySlot = Object.fromEntries(items.map(it => [it.slot, it]));
    const bg = bySlot.bg, dye = bySlot.hair;
    return out.map((r, y) => r.map((c, x) => {
      if (c && c[0] === "@") { const [sl, ch] = c.slice(1).split(":"); return itemPal(bySlot[sl], ch)[0].toUpperCase(); }
      // hair color item: hair pixels take the item's band colors, 2 rows per band (highlights from the second half)
      if (c && dye && (c === "H" || c === "j" || c === "i")) {
        const k = (y >> 1) % dye.bands.length;
        return (c === "i" ? dye.highlights[k] : dye.bands[k]).toUpperCase();
      }
      if (c) return pal[c].toUpperCase();
      if (bg) { const ch = (bg.rows[y] || "")[x]; if (ch && ch !== ".") return itemPal(bg, ch)[0].toUpperCase(); }
      return null;
    }));
  }

  // ---------- grid -> SVG (one rect per same-color run in a row) ----------
  function toSVG(grid, bg) {
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges">`;
    if (bg) s += `<rect width="24" height="24" fill="${bg}"/>`;
    for (let y = 0; y < W; y++) {
      let x = 0;
      while (x < W) {
        const c = grid[y][x];
        if (!c) { x++; continue; }
        let e = x; while (e < W && grid[y][e] === c) e++;
        s += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${c}"/>`;
        x = e;
      }
    }
    return s + "</svg>";
  }

  // ---------- DNA: one byte per slot, packed into a uint256 (hex) ----------
  const DNA_SLOTS = ["type", "skin", "catPattern", "catFur", "catEye", "dogBreed", "dogColor", "shape", "nose", "expr", "iris",
    "head", "hairColor", "hatColor", "eyes", "lensColor", "laserColor", "shadowColor", "mouth", "lipColor",
    "facial", "beardColor", "face", "ear", "metal", "neck", "hacc", "gear"];
  // zero out choices that do not change the picture, so the same look always has the same DNA
  function canonical(sel) {
    const b = build(sel);
    const used = new Set(compose(b.recipe).flat().filter(Boolean));
    const s = { ...b.sel };
    const t = s.type;
    if (!isHuman(s)) s.skin = 0;
    if (t !== "Cat") { s.catPattern = 0; s.catFur = 0; s.catEye = 0; }
    else { const p = catPat(s); if (p[2] !== null) s.catFur = 0; if (p[4]) s.catEye = 0; }
    if (t !== "Dog") { s.dogBreed = 0; s.dogColor = 0; } else if (breed(s)[4].length === 1) s.dogColor = 0;
    if (!humanlike(s)) s.iris = 0;
    const need = (k, chars) => { if (!chars.some(c => used.has(c))) s[k] = 0; };
    need("hairColor", ["H", "i", "j"]); need("hatColor", ["K", "k", "a"]); need("lensColor", ["G", "w"]);
    need("laserColor", ["l"]); need("shadowColor", ["E"]); need("lipColor", ["L"]); need("metal", ["m"]);
    need("beardColor", ["B"]);
    return s;
  }
  function encode(sel) {
    const s = canonical(sel);
    const v = DNA_SLOTS.map(k => (k === "type" ? TYPES.indexOf(s.type) : s[k] || 0));
    return "0x" + v.map(n => n.toString(16).padStart(2, "0")).join("").padEnd(64, "0");
  }
  function decode(hex) {
    const h = hex.replace(/^0x/, "");
    const s = {};
    DNA_SLOTS.forEach((k, i) => { const n = parseInt(h.slice(i * 2, i * 2 + 2), 16); s[k] = k === "type" ? TYPES[n] : n; });
    return s;
  }

  // random pick using the original rarity weights (only among allowed options)
  function randomize(rng = Math.random, type) {
    const wpick = (list, c) => {
      const tot = list.reduce((a, [x]) => a + x[c], 0); let r = rng() * tot;
      for (const [x, i] of list) { r -= x[c]; if (r < 0) return i; } return list[list.length - 1][1];
    };
    const wc = arr => { const tot = arr.reduce((a, x) => a + x[2], 0); let r = rng() * tot; for (let i = 0; i < arr.length; i++) { r -= arr[i][2]; if (r < 0) return i; } return 0; };
    const sel = { type: type || TYPES[Math.floor(rng() * TYPES.length)] };
    sel.skin = Math.floor(rng() * 5); sel.catPattern = wc(P.CAT_PATTERNS.map(c => [0, 0, c[5]]));
    sel.catFur = Math.floor(rng() * 4); sel.catEye = wc(P.CAT_EYES.map(c => [0, 0, c[2]]));
    sel.dogBreed = wc(P.DOG_BREEDS.map(b => [0, 0, b[8]])); sel.dogColor = Math.floor(rng() * 3);
    for (const k of ["hairColor", "hatColor", "lensColor", "laserColor", "shadowColor", "lipColor", "metal", "iris"]) {
      const t = { hairColor: P.HAIR_COLORS, hatColor: P.HAT_COLORS, lensColor: P.LENS_COLORS, laserColor: P.LASER_COLORS,
        shadowColor: P.SHADOW_COLORS, lipColor: P.LIP_COLORS, metal: P.METALS, iris: P.IRIS_COLORS }[k];
      sel[k] = wc(t);
    }
    const hn = P.HAIR_COLORS[sel.hairColor][0];
    sel.beardColor = P.NATURAL_HAIR.includes(hn) ? P.BEARD_OPTS.findIndex(b => b[0] === hn) : wc(P.BEARD_COLORS);
    let cur = normalize(sel);
    const c = cur.type === "Female" ? 3 : 2;
    for (const k of ["head", "eyes", "mouth", "facial", "face", "gear", "ear", "hacc", "neck", "shape", "nose", "expr"]) {
      const list = options(cur)[k];
      if (list.length) cur[k] = wpick(list, c);
      cur = normalize(cur);
    }
    return cur;
  }

  // ---------- partial restyle: base (who you are) is fixed, outfit can change ----------
  const BASE_KEYS = ["type", "skin", "catPattern", "catFur", "catEye", "dogBreed", "dogColor", "shape", "nose", "expr", "iris"];
  const OUTFIT_SLOTS = ["head", "eyes", "mouth", "facial", "face", "ear", "neck", "hacc", "gear"];
  const baseOf = sel => { const c = canonical(sel); return Object.fromEntries(BASE_KEYS.map(k => [k, c[k] || 0])); };
  const sameBase = (a, b) => JSON.stringify(baseOf(a)) === JSON.stringify(baseOf(b));
  // an outfit choice is allowed only if the rules do not have to touch the base to make it fit
  const keepsBase = (sel, k, v) => sameBase(sel, normalize({ ...sel, [k]: v }));
  function randomizeOutfit(rng, sel) {
    for (let t = 0; t < 50; t++) {
      const r = randomize(rng, sel.type);
      const cand = normalize({ ...r, ...Object.fromEntries(BASE_KEYS.map(k => [k, sel[k] || 0])) });
      if (sameBase(cand, sel)) return cand;
    }
    return sel;
  }

  root.PunkEngine = { ITEM_HIDES, ITEM_ORDER, categoryOf: n => CAT[n], BASE_KEYS, OUTFIT_SLOTS, baseOf, sameBase, keepsBase, randomizeOutfit, init, options, normalize, build, compose, palette, render, toSVG, encode, decode, canonical, randomize,
    TYPES, DNA_SLOTS, darker, lighter, get P() { return P; } };
})(typeof window !== "undefined" ? window : globalThis);

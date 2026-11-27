// Special items for 42gAvaterMaker: bought later and equipped on top of a fixed avatar.
// One item per slot: hat / eyes / mouth / neck / bg.  Each item has its own palette.
//   pal: { char: "#RRGGBB" }  or  { char: ["#RRGGBB", "noOutline"] }   rows: { y: "24 chars" } ('.' = empty)
// price / supply: null = not decided yet.  LAUNCH_GIFT: at launch, every avatar can claim any ONE item for free (limited time)
(function (root) {
  const ITEMS = [
    { id: 1, slot: "hat", name: "Wizard Hat", ja: "魔法使いの帽子", price: null, supply: null,
      pal: { P: "#6B3FB5", Y: "#F2C230", b: "#4A2A80" },
      rows: { 2: "............PY", 3: "...........PPP", 4: "..........PPYPP", 5: ".........PPPPPPP",
              6: "........PPPPPYPPP", 7: ".....bbbbbbbbbbbbbbbb" } },
    { id: 2, slot: "hat", name: "Party Hat", ja: "パーティーハット", price: null, supply: null,
      pal: { W: "#FFFFFF", R: "#FF5FB0", Y: "#2FD4E6" },
      rows: { 2: "...........WW", 3: "...........RY", 4: "..........RYRY", 5: ".........YRYRYR",
              6: "........RYRYRYRY", 7: ".......YYYYYYYYYY" } },
    { id: 3, slot: "eyes", name: "Heart Glasses", ja: "ハートのメガネ", price: null, supply: null,
      pal: { R: "#FF4FA3", w: "#FFD1E8", d: "#1B1B1B" },
      rows: { 11: ".......RR.RR.RR.RR", 12: "......dRwRRRdRwRRR", 13: "........RRR...RRR", 14: ".........R.....R" } },
    { id: 4, slot: "eyes", name: "Rainbow Visor", ja: "レインボーバイザー", price: null, supply: null,
      pal: { d: "#1B1B1B", R: "#E0302F", O: "#F07A1E", Y: "#F2C230", G: "#3CCB4A", B: "#2F7BFF", V: "#8E4DE0" },
      rows: { 12: "......dRROOYYGGBBV", 13: ".......RROOYYGGBBV" } },
    { id: 5, slot: "mouth", name: "Bubble Gum", ja: "風船ガム", price: null, supply: null,
      pal: { p: "#FF8FC8", w: "#FFFFFF", M: "#5A2E1E" },
      rows: { 15: "...............ppp", 16: "..............ppwpp", 17: ".............Mppppp", 18: "..............ppppp", 19: "...............ppp" } },
    { id: 6, slot: "mouth", name: "Rose", ja: "くわえたバラ", price: null, supply: null,
      pal: { G: "#3CA84A", R: "#D9283A", M: "#5A2E1E" },
      rows: { 16: "...................RR", 17: ".............MMGGGGRRRR", 18: "................GG.RRR" } },
    { id: 7, slot: "neck", name: "Gold Medal", ja: "金メダル", price: null, supply: null,
      // ribbon (blue / red) from under the jaw down to a 5-pixel gold medal at the bottom
      pal: { B: "#2F7BFF", R: "#E0302F", Y: "#F2C230", y: "#FFF4B0", o: "#C8961E" },
      rows: { 21: ".......R......RB", 22: "........BRYYYRB", 23: ".........oYyYo" } },
    { id: 8, slot: "neck", name: "Knit Scarf", ja: "ニットのマフラー", price: null, supply: null,
      pal: { S: "#E0302F", s: "#F4F4F4" },
      rows: { 21: "........SSSSSS", 22: ".......SsSsSsSS", 23: ".......SSSS.SS" } },
    { id: 9, slot: "bg", name: "Sunset", ja: "夕焼け", price: null, supply: null,
      pal: { a: "#3B2A6B", b: "#7A3F8F", c: "#D4568A", d: "#F08A5D", e: "#F7C46C", s: "#FFE9A8" },
      rows: Object.fromEntries([...Array(24)].map((_, y) => {
        const c = y < 5 ? "a" : y < 10 ? "b" : y < 14 ? "c" : y < 18 ? "d" : "e";
        let r = c.repeat(24);
        if (y >= 17 && y <= 21) {            // a low sun on the left
          const w = [3, 5, 5, 5, 3][y - 17], x0 = [2, 1, 1, 1, 2][y - 17];
          r = r.slice(0, x0) + "s".repeat(w) + r.slice(x0 + w);
        }
        return [y, r];
      })) },
    { id: 10, slot: "bg", name: "Night Sky", ja: "星空", price: null, supply: null,
      pal: { n: "#142042", t: "#FFF3B0", m: "#F2E6B8" },
      rows: Object.fromEntries([...Array(24)].map((_, y) => {
        let r = "n".repeat(24).split("");
        const stars = [[1, 3], [2, 19], [4, 10], [6, 1], [7, 22], [9, 4], [13, 21], [15, 2], [18, 23], [20, 18], [22, 5]];
        for (const [sy, sx] of stars) if (sy === y) r[sx] = "t";
        const moon = { 2: [3, 4, 5], 3: [2, 3, 4], 4: [2, 3], 5: [2, 3, 4], 6: [3, 4, 5] };   // crescent, top left
        for (const x of moon[y] || []) r[x] = "m";
        return [y, r.join("")];
      })) },
    // hair color: recolors the avatar's own hair, 2 rows per band (no pixels of its own)
    { id: 11, slot: "hair", name: "Rainbow Hair Dye", ja: "レインボーヘアカラー", price: null, supply: null,
      bands: ["#E0302F", "#F07A1E", "#F2C230", "#3CCB4A", "#2F7BFF", "#8E4DE0"],
      highlights: ["#EB7E7E", "#F5AC73", "#F6D97E", "#86DE8E", "#7EADFF", "#B890EB"] },
  ];
  const SLOTS = ["hat", "eyes", "mouth", "neck", "bg", "hair"];
  const SLOT_JA = { hat: "帽子", eyes: "メガネ", mouth: "口元", neck: "首", bg: "背景", hair: "髪色" };
  const LAUNCH_GIFT = true;
  root.SpecialItems = { ITEMS, SLOTS, SLOT_JA, LAUNCH_GIFT };
})(typeof window !== "undefined" ? window : globalThis);

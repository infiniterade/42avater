// Writes everything the contracts and the Solidity tests read, from the JS engine:
//   data/parts.bin    IIDPunksRenderer.setData() parts
//   data/strings.bin  IIDPunksRenderer.setData() attribute strings
//   data/items.json   IIDPunksItems.addItem() data for each special item
//   data/vectors.json test vectors: record + item blobs -> the SVG and lookHash the engine expects
// node tools/make_data.js           write the files
// node tools/make_data.js --check   fail if the committed files differ (CI)
const fs = require("fs"), path = require("path");
require("./engine.js"); require("./keccak.js"); require("./onchain.js"); require("./special_items.js");
const E = globalThis.PunkEngine, O = globalThis.PunkOnchain, SI = globalThis.SpecialItems;
E.init(require("./parts.json"));
const pt = O.buildParts(), strs = O.buildStrings();
const hex = b => "0x" + Buffer.from(b).toString("hex");

const items = SI.ITEMS.map(it => ({ id: it.id, slot: it.slot, name: it.name, ja: it.ja, price: it.price,
  maxSupply: it.supply, data: hex(O.itemBytes(it)) }));

let seed = 42; const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const cases = [];
for (let i = 0; i < 60; i++) {
  let sel = E.randomize(rng, E.TYPES[i % E.TYPES.length]);
  // every 6th case: a long hairstyle, so hair color items show plenty of hair
  if (i % 6 === 0 && (sel.type === "Male" || sel.type === "Female")) {
    const long = E.P.HEAD.findIndex(h => h[0] === (sel.type === "Female" ? "straight" : "messy"));
    sel = E.normalize({ ...sel, head: long >= 0 ? long : sel.head });
  }
  const r = O.tokenRecord(pt, strs, sel);
  // the second half wear items; every item is used at least once
  const worn = [];
  if (i >= 30) {
    for (const slot of SI.SLOTS) {
      if (slot === "hat" && E.options(sel).head.length <= 1) continue;
      const forced = (i - 30) < SI.ITEMS.length && SI.ITEMS[i - 30].slot === slot;
      if (rng() < 0.6 || forced) {
        const list = SI.ITEMS.filter(it => it.slot === slot);
        worn.push(forced ? SI.ITEMS[i - 30] : list[Math.floor(rng() * list.length)]);
      }
    }
  }
  const bySlot = sl => worn.find(x => x.slot === sl);
  cases.push({
    record: hex(r.bytes),
    items: SI.SLOTS.map(sl => (bySlot(sl) ? hex(O.itemBytes(bySlot(sl))) : "0x")),
    names: SI.SLOTS.map(sl => (bySlot(sl) ? bySlot(sl).name : "")),
    itemIds: SI.SLOTS.map(sl => (bySlot(sl) ? bySlot(sl).id : 0)),
    svg: E.toSVG(E.render(r.recipe, worn)),
    lookHash: O.lookHashOfGrid(E.render(r.recipe)),
    attrs: r.attrs.map(([k, v]) => `{"trait_type":"${k}","value":"${v}"}`).join(","),
  });
}

const out = {
  "parts.bin": Buffer.from(O.partsBytes(pt)),
  "strings.bin": Buffer.from(O.stringsBytes(strs)),
  "items.json": Buffer.from(JSON.stringify(items, null, 1) + "\n"),
  "vectors.json": Buffer.from(JSON.stringify({ count: cases.length, cases }) + "\n"),
};
const dir = path.join(__dirname, "..", "data");
const check = process.argv.includes("--check");
let bad = 0;
for (const [name, buf] of Object.entries(out)) {
  const file = path.join(dir, name);
  if (check) {
    const same = fs.existsSync(file) && Buffer.compare(fs.readFileSync(file), buf) === 0;
    console.log(`${same ? "ok  " : "DIFF"} data/${name}`);
    if (!same) bad++;
  } else { fs.writeFileSync(file, buf); console.log(`wrote data/${name} (${buf.length} bytes)`); }
}
if (bad) { console.error("data/ is out of date: run node tools/make_data.js"); process.exit(1); }

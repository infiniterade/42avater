// Special items: the byte renderer (same steps as the contract) must match the engine with any set of
// equipped items, the record never changes, and without items the picture is exactly the minted one.
require("./engine.js"); require("./keccak.js"); require("./onchain.js"); require("./special_items.js");
const E = globalThis.PunkEngine, O = globalThis.PunkOnchain, SI = globalThis.SpecialItems;
E.init(require("./parts.json"));
const pt = O.buildParts(), parts = O.partsBytes(pt), strs = O.buildStrings();
const blobs = Object.fromEntries(SI.ITEMS.map(it => [it.id, O.itemBytes(it)]));
let seed = 3; const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const n = Number(process.argv[2] || 6000);
let bad = 0, plainBad = 0;
for (let i = 0; i < n; i++) {
  const r = O.tokenRecord(pt, strs, E.randomize(rng));
  const items = SI.SLOTS.filter(() => rng() < 0.5).map(slot => {
    const c = SI.ITEMS.filter(it => it.slot === slot); return c[Math.floor(rng() * c.length)];
  });
  const arr = []; for (const it of items) arr[O.SLOT_ID[it.slot]] = blobs[it.id];
  if (JSON.stringify(E.render(r.recipe, items)) !== JSON.stringify(O.renderFromBytes(parts, r.bytes, arr))) bad++;
  if (JSON.stringify(O.renderFromBytes(parts, r.bytes, [])) !== JSON.stringify(E.render(r.recipe))) plainBad++;
}
console.log(`${n} avatars with random items: mismatches=${bad}, no-item mismatches=${plainBad}`);
if (bad || plainBad) process.exit(1);

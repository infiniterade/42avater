// The byte format the contract reads: random avatars -> token record -> the byte renderer (same steps as
// IIDPunksRenderer) must draw exactly what the engine draws. Also: one picture = one DNA.
require("./engine.js"); require("./keccak.js"); require("./onchain.js");
const E = globalThis.PunkEngine, O = globalThis.PunkOnchain;
E.init(require("./parts.json"));
const pt = O.buildParts(), parts = O.partsBytes(pt), strs = O.buildStrings();
let seed = 1; const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const n = Number(process.argv[2] || 20000);
let bad = 0, maxRec = 0;
for (let i = 0; i < n; i++) {
  const r = O.tokenRecord(pt, strs, E.randomize(rng));
  maxRec = Math.max(maxRec, r.bytes.length);
  if (JSON.stringify(E.render(r.recipe)) !== JSON.stringify(O.renderFromBytes(parts, r.bytes))) bad++;
}
console.log(`${n} avatars: byte-renderer mismatches=${bad}, parts ${parts.length} bytes, max record ${maxRec} bytes`);
if (bad || maxRec > 13 + 1 + 21 + 1 + 16 * 3) process.exit(1);

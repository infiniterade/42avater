// keccak256 used by the maker for lookHash: known Ethereum values.
require("./keccak.js");
const k = globalThis.keccak256;
const cases = [["", "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"],
  ["abc", "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"]];
let bad = 0;
for (const [i, o] of cases) if (k(i) !== o) bad++;
if (k("transfer(address,uint256)").slice(0, 10) !== "0xa9059cbb") bad++;
// multi-block: SHA3-256 uses the same permutation with 0x06 padding; compare with node:crypto
const crypto = require("crypto"), fs = require("fs");
const src = fs.readFileSync(require.resolve("./keccak.js"), "utf8")
  .replace("msg[bytes.length] ^= 0x01", "msg[bytes.length] ^= 0x06").replace("root.keccak256 = keccak256", "root.sha3t = keccak256");
new Function("globalThis", src.replace("typeof window !== \"undefined\" ? window : globalThis", "globalThis"))(globalThis);
for (const len of [135, 136, 137, 272, 1000, 18432]) {
  const b = crypto.randomBytes(len);
  if (globalThis.sha3t(new Uint8Array(b)) !== "0x" + crypto.createHash("sha3-256").update(b).digest("hex")) bad++;
}
console.log(bad ? `keccak: ${bad} failures` : "keccak: ok");
if (bad) process.exit(1);

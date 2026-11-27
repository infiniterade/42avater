// Builds the one-file maker page: maker/dist/index.html (parts data and scripts inlined).
const fs = require("fs"), path = require("path");
const t = p => path.join(__dirname, "..", "tools", p);
let h = fs.readFileSync(path.join(__dirname, "maker.template.html"), "utf8");
const rep = (k, v) => { h = h.split(k).join(v.replace(/<\/script/gi, "<\\/script")); };
rep("/*PARTS*/", "const PARTS=" + fs.readFileSync(t("parts.json"), "utf8") + ";");
rep("/*ENGINE*/", fs.readFileSync(t("engine.js"), "utf8"));
rep("/*KECCAK*/", fs.readFileSync(t("keccak.js"), "utf8"));
rep("/*ONCHAIN*/", fs.readFileSync(t("onchain.js"), "utf8"));
rep("/*ITEMS*/", fs.readFileSync(t("special_items.js"), "utf8"));
// Optional: --chain <file.json> fills in the chain settings ({ "rpc": "...", "avatars": "0x..." }), --out <file> writes elsewhere.
// The published page leaves them empty ("available once the contract is live").
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (arg("--chain")) {
  const c = JSON.parse(fs.readFileSync(arg("--chain"), "utf8"));
  if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(c.rpc) || !/^0x[0-9a-fA-F]{40}$/.test(c.avatars)) throw new Error("bad chain settings");
  rep('{ rpc: "", avatars: "" }', JSON.stringify({ rpc: c.rpc, avatars: c.avatars }));
}
const out = arg("--out") || path.join(__dirname, "dist", "index.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, h);
console.log(path.relative(process.cwd(), out), h.length, "bytes");

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
// Cloudflare Pages (https://42avater.pages.dev): set MAKER_CHAIN_RPC and MAKER_CHAIN_AVATARS as environment variables
// once the production contracts are live; until then the page says "available once the contract is live".
// MAKER_CHAIN_ITEMS (the items contract) and MAKER_SIGNER_URL (the signing server, signer/) are optional but should be set
// in production: the items address is then fixed in the page, and minting is switched on.
const env = k => (process.env[k] || "").trim();
const envChain = env("MAKER_CHAIN_RPC") && env("MAKER_CHAIN_AVATARS")
  ? { rpc: env("MAKER_CHAIN_RPC"), avatars: env("MAKER_CHAIN_AVATARS"), items: env("MAKER_CHAIN_ITEMS"), signer: env("MAKER_SIGNER_URL") } : null;
let chainCfg = {};
if (arg("--chain") || envChain) {
  const c = envChain || JSON.parse(fs.readFileSync(arg("--chain"), "utf8"));
  chainCfg = c;
  const local = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/;
  const url = u => /^https:\/\//.test(u) || local.test(u);
  const addr = a => /^0x[0-9a-fA-F]{40}$/.test(a);
  if (!url(c.rpc) || !addr(c.avatars) || (c.items && !addr(c.items)) || (c.signer && !url(c.signer))) throw new Error("bad chain settings");
  rep('{ rpc: "", avatars: "", items: "", signer: "" }',
    JSON.stringify({ rpc: c.rpc, avatars: c.avatars, items: c.items || "", signer: (c.signer || "").replace(/\/$/, "") }));
}
// Test hooks (window.__makerTest: point the page at a local chain) exist only in --test builds.
if (!process.argv.includes("--test")) {
  rep("window.__makerTest?.chain || ", "");
  rep("window.__makerTest?.genesis || ", "");
  if (h.includes("__makerTest")) throw new Error("test hook left in the page");
}
// Fonts: subsets of DotGothic16 and Noto Sans JP (SIL OFL 1.1) made by tools/make_fonts.py, inlined so the page
// loads nothing from other sites (no Google Fonts). Every character on the page must be in the subsets.
if (process.argv.includes("--no-fonts")) rep("/*FONTS*/", "");
else {
  const fdir = path.join(__dirname, "fonts");
  const face = (fam, file, w) => `@font-face{font-family:"${fam}";font-style:normal;font-weight:${w};font-display:swap;` +
    `src:url(data:font/woff;base64,${fs.readFileSync(path.join(fdir, file)).toString("base64")}) format("woff")}`;
  rep("/*FONTS*/", face("DotGothic16", "dotgothic16.woff", 400) + face("Noto Sans JP", "notosansjp-400.woff", 400) +
    face("Noto Sans JP", "notosansjp-700.woff", 700));
  const have = new Set(fs.readFileSync(path.join(fdir, "charset.txt"), "utf8"));
  const page = h.replace(/url\(data:font\/woff;base64,[^)]*\)/g, "");
  const missing = [...new Set(page)].filter(c => c.codePointAt(0) > 126 && !have.has(c) && !/\p{Extended_Pictographic}|[\u2190-\u21ff\u2014\u2026]/u.test(c));
  if (missing.length) {
    const msg = "characters not in the fonts (run python3 tools/make_fonts.py): " + missing.join("");
    if (process.argv.includes("--strict")) throw new Error(msg);
    console.warn("warning: " + msg);
  }
}
const out = arg("--out") || path.join(__dirname, "dist", "index.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, h);
// security headers for Cloudflare Pages (only next to the default output)
// The page may only talk to its own chain RPC and signing server (Content-Security-Policy connect-src).
if (!arg("--out")) {
  const origins = [chainCfg.rpc, chainCfg.signer].filter(Boolean).map(u => new URL(u).origin);
  const connect = [...new Set(origins)].join(" ") || "'none'";
  fs.writeFileSync(path.join(path.dirname(out), "_headers"),
    fs.readFileSync(path.join(__dirname, "_headers"), "utf8").replace("__CONNECT__", connect));
}
console.log(path.relative(process.cwd(), out), h.length, "bytes");

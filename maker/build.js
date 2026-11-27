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
const envChain = process.env.MAKER_CHAIN_RPC && process.env.MAKER_CHAIN_AVATARS
  ? { rpc: process.env.MAKER_CHAIN_RPC.trim(), avatars: process.env.MAKER_CHAIN_AVATARS.trim() } : null;
if (arg("--chain") || envChain) {
  const c = envChain || JSON.parse(fs.readFileSync(arg("--chain"), "utf8"));
  if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(c.rpc) || !/^0x[0-9a-fA-F]{40}$/.test(c.avatars)) throw new Error("bad chain settings");
  rep('{ rpc: "", avatars: "" }', JSON.stringify({ rpc: c.rpc, avatars: c.avatars }));
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
if (!arg("--out")) fs.copyFileSync(path.join(__dirname, "_headers"), path.join(path.dirname(out), "_headers"));
console.log(path.relative(process.cwd(), out), h.length, "bytes");

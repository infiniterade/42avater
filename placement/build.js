// Builds placement/dist/avatars-placement.html: one file with the compiled contracts (forge build first),
// the parts data and the engine. Open it in a browser with MetaMask.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const t = p => path.join(root, "tools", p);
const bc = n => JSON.parse(fs.readFileSync(path.join(root, "out", "IIDPunksAvatars.sol", n + ".json"), "utf8")).bytecode.object;
let h = fs.readFileSync(path.join(__dirname, "placement.template.html"), "utf8");
const rep = (k, v) => { if (!h.includes(k)) throw new Error("missing " + k); h = h.split(k).join(v.replace(/<\/script/gi, "<\\/script")); };
rep("/*PARTS*/", "const PARTS=" + fs.readFileSync(t("parts.json"), "utf8") + ";");
rep("/*ENGINE*/", fs.readFileSync(t("engine.js"), "utf8"));
rep("/*KECCAK*/", fs.readFileSync(t("keccak.js"), "utf8"));
rep("/*ONCHAIN*/", fs.readFileSync(t("onchain.js"), "utf8"));
rep("/*ITEMS*/", fs.readFileSync(t("special_items.js"), "utf8"));
rep("/*DEPLOY*/", "const DEPLOY = " + JSON.stringify({
  renderer: bc("IIDPunksRenderer"), items: bc("IIDPunksItems"), avatars: bc("IIDPunksAvatars") }) + ";");
fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "dist", "avatars-placement.html"), h);
console.log("placement/dist/avatars-placement.html", h.length, "bytes");

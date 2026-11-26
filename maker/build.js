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
fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "dist", "index.html"), h);
console.log("maker/dist/index.html", h.length, "bytes");

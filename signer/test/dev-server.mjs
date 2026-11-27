// Runs the signer on this computer for rehearsals and end-to-end tests (not for production):
//   SIGNER_KEY=0x… RPC_URL=http://127.0.0.1:8545 AVATARS=0x… ALLOWED_ORIGINS=http://localhost:8080 node test/dev-server.mjs
// The key comes only from the environment. Reservations are kept in memory (node:sqlite).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ethers } from "ethers";
import "../../tools/keccak.js";
import "../../tools/engine.js";
import "../../tools/onchain.js";
import { createSigner, handleRequest } from "../src/core.mjs";

const E = globalThis.PunkEngine, O = globalThis.PunkOnchain;
E.init(JSON.parse(readFileSync(new URL("../../tools/parts.json", import.meta.url))));
const PT = O.buildParts(), STRS = O.buildStrings(), PB = O.partsBytes(PT);
const env = { CHAIN_ID: process.env.CHAIN_ID || "421018", AVATARS: process.env.AVATARS, GENESIS: process.env.GENESIS || "",
  SIGNER_KEY: process.env.SIGNER_KEY, SIGNATURE_TTL: process.env.SIGNATURE_TTL || "900", ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "" };
const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
const db = { prepare: q => ({ bind: (...a) => ({ run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...a).changes) } }) }) }) };
let id = 1;
const rpc = async (method, params) => {
  const r = await (await fetch(process.env.RPC_URL, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }) })).json();
  if (r.error) throw new Error("rpc: " + r.error.message);
  return r.result;
};
const signer = createSigner({ E, O, PT, STRS, PB, keccak256: globalThis.keccak256, ethers, rpc, db }, env);
const port = Number(process.env.PORT || 8787);
createServer(async (req, res) => {
  const body = ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : await new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); });
  const r = await handleRequest(new Request("http://127.0.0.1:" + port + req.url, { method: req.method, headers: req.headers, body }), env, async () => signer);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(await r.text());
}).listen(port, "127.0.0.1", () => console.log("signer", signer.address, "on http://127.0.0.1:" + port));

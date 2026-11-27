// Cloudflare Worker entry for the 42gAvaterMaker mint signer (see core.mjs and README.md).
import { ethers } from "ethers";
import parts from "../../tools/parts.json";
import "../../tools/keccak.js";
import "../../tools/engine.js";
import "../../tools/onchain.js";
import { createSigner, handleRequest } from "./core.mjs";

const E = globalThis.PunkEngine, O = globalThis.PunkOnchain;
E.init(parts);
const PT = O.buildParts(), STRS = O.buildStrings(), PB = O.partsBytes(PT);

let signer = null, signerEnv = null;
function getSigner(env) {
  if (signer && signerEnv === env) return signer;
  let id = 1;
  const rpc = async (method, params) => {
    const r = await fetch(env.RPC_URL, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }) });
    const j = await r.json();
    if (j.error) throw new Error("rpc: " + (j.error.message || "error"));
    return j.result;
  };
  signer = createSigner({ E, O, PT, STRS, PB, keccak256: globalThis.keccak256, ethers, rpc, db: env.DB }, env);
  signerEnv = env;
  return signer;
}

export default {
  fetch: (request, env) => handleRequest(request, env, async () => getSigner(env)),
};

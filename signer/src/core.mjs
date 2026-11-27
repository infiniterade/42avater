// 42gAvaterMaker mint signer: the checks and the signature, independent of Cloudflare (tested with Node).
//
// POST /sign  { to, cawId, dna, time, proof }
//   to     the wallet that will send mint() (the signature is only valid for msg.sender == to)
//   cawId  the CAW NAME token id (decimal string)
//   dna    the design, as the maker's DNA (0x + 64 hex)
//   time   unix seconds when the request was made
//   proof  personal_sign by `to` of requestMessage({ to, cawId, dna, time }): only the wallet owner can ask
// -> { record, deadline, signature, look }  — pass to mint(cawId, record, deadline, signature)
//
// Before signing it checks: the design follows the IID Punks rules (the record is rebuilt here, never taken from the
// caller), `to` owns the CAW NAME, the CAW NAME has not minted, the picture is not minted, minting is open, and this
// server's key is the contract's signer. The look is then reserved for `to` until the signature expires, so nobody
// else gets a signature for the same picture meanwhile (no design sniping from the mempool).

export const requestMessage = ({ to, cawId, dna, time }) =>
  `42gAvaterMaker mint request\nAddress: ${to}\nCAW NAME: ${cawId}\nDesign: ${dna}\nTime: ${time}`;

const MAX_AGE = 600, MAX_SKEW = 120;          // a request proof is good for 10 minutes (2 minutes of clock skew)

export class SignerError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new SignerError(status, code, message); };

/**
 * deps: { E, O, PT, STRS, PB, keccak256, ethers, rpc(method, params) -> result, db (D1-like), now() -> unix seconds }
 * env:  { CHAIN_ID, AVATARS, GENESIS, SIGNER_KEY, SIGNATURE_TTL }
 */
export function createSigner(deps, env) {
  const { E, O, PT, STRS, PB, keccak256, ethers, rpc, db } = deps;
  const now = deps.now || (() => Math.floor(Date.now() / 1000));
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.AVATARS || "")) throw new Error("AVATARS is not set");
  if (!env.SIGNER_KEY) throw new Error("SIGNER_KEY is not set");
  const wallet = new ethers.Wallet(env.SIGNER_KEY);
  const chainId = Number(env.CHAIN_ID);
  const ttl = Math.min(Math.max(Number(env.SIGNATURE_TTL || 900), 60), 3600);
  const AV = env.AVATARS;

  const word = v => BigInt(v).toString(16).padStart(64, "0");
  const call = async (to, sig, args = "") => rpc("eth_call", [{ to, data: keccak256(sig).slice(0, 10) + args }, "latest"]);
  const asBool = r => BigInt(r) !== 0n;
  const asAddr = r => ethers.getAddress("0x" + String(r).slice(-40));

  let checkedChain = false;
  async function checkChain() {
    if (checkedChain) return;
    const [id, g] = await Promise.all([rpc("eth_chainId", []), rpc("eth_getBlockByNumber", ["0x0", false])]);
    if (Number(id) !== chainId) fail(503, "wrong_chain", "The RPC is not on the configured chain.");
    if (env.GENESIS && (!g || String(g.hash).toLowerCase() !== env.GENESIS.toLowerCase()))
      fail(503, "wrong_chain", "The RPC's first block is not 42 Chain's.");
    checkedChain = true;
  }

  // The design must be exactly what the maker's engine produces for it (the rules are applied by normalize()).
  function designOf(dna) {
    if (!/^0x[0-9a-f]{64}$/.test(dna)) fail(400, "bad_design", "The design code is not valid.");
    // Anything the engine can't take apart, rebuild and draw is refused (no part of it may throw later).
    try {
      const sel = E.normalize(E.decode(dna));
      if (sel && sel.type && E.encode(sel) === dna) {
        const grid = E.render(E.build(sel).recipe);
        const record = O.tokenRecord(PT, STRS, sel).bytes;
        const look = O.lookHashOfGrid(O.renderFromBytes(PB, record, []));
        if (look === O.lookHashOfGrid(grid)) return { record, look };
      }
    } catch { /* falls through */ }
    fail(400, "bad_design", "The design does not follow the rules.");
  }

  async function reserve(look, holder, caw, expires) {
    const t = now();
    await db.prepare("DELETE FROM reservations WHERE expires < ?").bind(t).run();
    const r = await db.prepare(
      `INSERT INTO reservations (look, holder, caw, expires) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(look) DO UPDATE SET holder = excluded.holder, caw = excluded.caw, expires = excluded.expires
       WHERE reservations.holder = excluded.holder OR reservations.expires < ?5`).bind(look, holder, caw, expires, t).run();
    if (!r.meta || r.meta.changes !== 1) fail(409, "reserved", "Someone else is minting this exact look right now. Try again later or change a part.");
    // one look at a time per CAW NAME
    await db.prepare("DELETE FROM reservations WHERE caw = ?1 AND look <> ?2").bind(caw, look).run();
  }

  return {
    address: wallet.address,
    async sign(body) {
      if (!body || typeof body !== "object") fail(400, "bad_request", "Bad request.");
      const { to, cawId, dna, time, proof } = body;
      if (typeof to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(to)) fail(400, "bad_request", "Bad address.");
      // canonical decimal only ("7", not "07"): the reservation is kept per CAW NAME
      if (typeof cawId !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(cawId) || BigInt(cawId) >= 2n ** 256n) fail(400, "bad_request", "Bad CAW NAME id.");
      if (typeof dna !== "string") fail(400, "bad_request", "Bad design.");
      if (!Number.isSafeInteger(time)) fail(400, "bad_request", "Bad time.");
      if (typeof proof !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(proof)) fail(400, "bad_request", "Bad proof.");
      const t = now();
      if (time < t - MAX_AGE || time > t + MAX_SKEW) fail(401, "stale_request", "The request is too old. Please try again.");
      let who;
      try { who = ethers.verifyMessage(requestMessage({ to, cawId, dna, time }), proof); } catch { who = ""; }
      if (who.toLowerCase() !== to.toLowerCase()) fail(401, "bad_proof", "The request was not signed by this wallet.");

      const { record, look } = designOf(dna);

      await checkChain();
      const caw = BigInt(cawId);
      const [closed, signer, configured, cawNames, used, taken, supply, max] = await Promise.all([
        call(AV, "mintingClosed()"), call(AV, "signer()"), call(AV, "cawConfigured()"), call(AV, "cawNames()"),
        call(AV, "avatarOfCaw(uint256)", word(caw)), call(AV, "lookTaken(bytes32)", look.slice(2)),
        call(AV, "totalSupply()"), call(AV, "maxSupply()")]);
      if (asBool(closed)) fail(409, "minting_closed", "Minting is closed.");
      if (BigInt(supply) >= BigInt(max)) fail(409, "sold_out", "All avatars have been minted.");
      if (asAddr(signer) !== wallet.address) fail(503, "signer_mismatch", "This server's key is not the contract's signer.");
      if (!asBool(configured)) fail(409, "not_open", "Minting has not opened yet.");
      if (BigInt(used) !== 0n) fail(409, "caw_used", "This CAW NAME has already minted an avatar.");
      if (asBool(taken)) fail(409, "look_taken", "This look has already been minted.");
      let owner;
      try { owner = asAddr(await call(asAddr(cawNames), "ownerOf(uint256)", word(caw))); } catch { fail(403, "not_caw_owner", "This CAW NAME does not exist."); }
      if (owner.toLowerCase() !== to.toLowerCase()) fail(403, "not_caw_owner", "This wallet does not own the CAW NAME.");

      const deadline = t + ttl;
      await reserve(look, to.toLowerCase(), cawId, deadline);
      const recordHex = ethers.hexlify(record);
      const signature = await wallet.signTypedData(
        { name: "IIDPunksAvatars", version: "1", chainId, verifyingContract: AV },
        { Mint: [{ name: "to", type: "address" }, { name: "cawId", type: "uint256" }, { name: "recordHash", type: "bytes32" }, { name: "deadline", type: "uint256" }] },
        { to, cawId, recordHash: ethers.keccak256(recordHex), deadline });
      return { record: recordHex, deadline, signature, look };
    },
  };
}

/** HTTP wrapper: CORS for the allowed pages, JSON in and out, small bodies only. */
export async function handleRequest(request, env, getSigner) {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const cors = allowed.includes(origin)
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "vary": "origin" }
    : {};
  const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    if (request.method === "GET" && url.pathname === "/") {
      const s = await getSigner();
      return json(200, { service: "42avater-signer", signer: s.address, avatars: env.AVATARS, chainId: Number(env.CHAIN_ID) });
    }
    if (request.method !== "POST" || url.pathname !== "/sign") return json(404, { error: "not_found" });
    const text = await request.text();
    if (text.length > 2000) return json(413, { error: "too_large" });
    let body;
    try { body = JSON.parse(text); } catch { return json(400, { error: "bad_request", message: "Bad JSON." }); }
    const s = await getSigner();
    return json(200, await s.sign(body));
  } catch (e) {
    if (e instanceof SignerError) return json(e.status, { error: e.code, message: e.message });
    console.error(e && e.stack || e);
    return json(500, { error: "internal", message: "Something went wrong. Please try again." });
  }
}

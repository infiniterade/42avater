// node --test test/  — the signer's checks against a fake chain and an in-memory SQLite (same SQL as D1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ethers } from "ethers";
import "../../tools/keccak.js";
import "../../tools/engine.js";
import "../../tools/onchain.js";
import { createSigner, handleRequest, requestMessage } from "../src/core.mjs";

const E = globalThis.PunkEngine, O = globalThis.PunkOnchain;
E.init(JSON.parse(readFileSync(new URL("../../tools/parts.json", import.meta.url))));
const PT = O.buildParts(), STRS = O.buildStrings(), PB = O.partsBytes(PT);
const keccak256 = globalThis.keccak256;

const SIGNER = new ethers.Wallet("0x" + "11".repeat(32));
const ALICE = new ethers.Wallet("0x" + "22".repeat(32));
const BOB = new ethers.Wallet("0x" + "33".repeat(32));
const AV = "0x00000000000000000000000000000000000000a1", CAW = "0x00000000000000000000000000000000000000c1";
const GENESIS = "0x" + "ab".repeat(32);
const env = { CHAIN_ID: "421018", AVATARS: AV, GENESIS, SIGNER_KEY: SIGNER.privateKey, SIGNATURE_TTL: "900", ALLOWED_ORIGINS: "https://42avater.pages.dev" };

// D1-like adapter over node:sqlite
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return { prepare: sql => ({ bind: (...a) => ({ run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...a).changes) } }) }) }), raw: db };
}

// fake 42 Chain: the avatar contract and the CAW NAME contract, answering eth_call by selector
function chain() {
  const st = { closed: false, signer: SIGNER.address, configured: true, used: {}, taken: new Set(), supply: 0, max: 100000,
    owner: { 7: ALICE.address, 8: BOB.address, 9: ALICE.address } };
  const sel = s => keccak256(s).slice(0, 10);
  const w = v => "0x" + BigInt(v).toString(16).padStart(64, "0");
  const a = x => "0x" + x.slice(2).toLowerCase().padStart(64, "0");
  const rpc = async (method, params) => {
    if (method === "eth_chainId") return "0x66c9a";
    if (method === "eth_getBlockByNumber") return { hash: GENESIS };
    const { to, data } = params[0], s = data.slice(0, 10), arg = data.slice(10);
    if (to === AV) {
      if (s === sel("mintingClosed()")) return w(st.closed ? 1 : 0);
      if (s === sel("signer()")) return a(st.signer);
      if (s === sel("cawConfigured()")) return w(st.configured ? 1 : 0);
      if (s === sel("cawNames()")) return a(CAW);
      if (s === sel("avatarOfCaw(uint256)")) return w(st.used[BigInt("0x" + arg)] || 0);
      if (s === sel("lookTaken(bytes32)")) return w(st.taken.has("0x" + arg) ? 1 : 0);
      if (s === sel("totalSupply()")) return w(st.supply);
      if (s === sel("maxSupply()")) return w(st.max);
    }
    if (to.toLowerCase() === CAW && s === sel("ownerOf(uint256)")) {
      const o = st.owner[Number(BigInt("0x" + arg))];
      if (!o) throw new Error("execution reverted");
      return a(o);
    }
    throw new Error("unexpected call " + to + " " + s);
  };
  return { st, rpc };
}

let clock = 1_800_000_000;
function setup() {
  const c = chain(), db = d1();
  const s = createSigner({ E, O, PT, STRS, PB, keccak256, ethers, rpc: c.rpc, db, now: () => clock }, env);
  return { s, c, db };
}
const dnaOf = seed => { let x = seed; const rng = () => ((x = (x * 48271) % 2147483647) / 2147483647); return E.encode(E.randomize(rng)); };
async function req(wallet, cawId, dna, opts = {}) {
  const time = opts.time ?? clock;
  const to = opts.to ?? wallet.address;
  const proof = await wallet.signMessage(requestMessage({ to, cawId, dna, time }));
  return { to, cawId, dna, time, proof };
}
const rejects = async (p, code) => { await assert.rejects(p, e => { assert.equal(e.code, code); return true; }); };

test("a valid request gets a signature the contract would accept", async () => {
  const { s } = setup();
  const dna = dnaOf(1);
  const r = await s.sign(await req(ALICE, "7", dna));
  const rec = O.tokenRecord(PT, STRS, E.normalize(E.decode(dna))).bytes;
  assert.equal(r.record, ethers.hexlify(rec));
  assert.equal(r.deadline, clock + 900);
  const digest = ethers.TypedDataEncoder.hash(
    { name: "IIDPunksAvatars", version: "1", chainId: 421018, verifyingContract: AV },
    { Mint: [{ name: "to", type: "address" }, { name: "cawId", type: "uint256" }, { name: "recordHash", type: "bytes32" }, { name: "deadline", type: "uint256" }] },
    { to: ALICE.address, cawId: 7, recordHash: ethers.keccak256(r.record), deadline: r.deadline });
  assert.equal(ethers.recoverAddress(digest, r.signature), SIGNER.address);
  assert.equal(r.look, O.lookHashOfGrid(O.renderFromBytes(PB, rec, [])));
});

test("only the wallet itself can ask (personal_sign proof), and only recently", async () => {
  const { s } = setup();
  const dna = dnaOf(2);
  await rejects(s.sign(await req(BOB, "7", dna, { to: ALICE.address })), "bad_proof");     // Bob asks for Alice
  const r = await req(ALICE, "7", dna);
  await rejects(s.sign({ ...r, cawId: "9" }), "bad_proof");                                // fields changed after signing
  await rejects(s.sign(await req(ALICE, "7", dna, { time: clock - 601 })), "stale_request");
  await rejects(s.sign(await req(ALICE, "7", dna, { time: clock + 121 })), "stale_request");
  await rejects(s.sign({ ...r, proof: "0x1234" }), "bad_request");
});

test("only designs that follow the rules", async () => {
  const { s } = setup();
  await rejects(s.sign(await req(ALICE, "7", "0x" + "ff".repeat(32))), "bad_design");
  await rejects(s.sign(await req(ALICE, "7", "0x1234")), "bad_design");
  const good = dnaOf(3);
  const tweaked = good.slice(0, 2) + "00" + good.slice(4, 6) + "ff" + good.slice(8);       // a non-canonical variant
  if (tweaked !== good) await rejects(s.sign(await req(ALICE, "7", tweaked)), "bad_design");
});

test("the CAW NAME must be yours and unused; the look unminted; minting open", async () => {
  const { s, c } = setup();
  const dna = dnaOf(4);
  await rejects(s.sign(await req(ALICE, "8", dna)), "not_caw_owner");                      // Bob's CAW NAME
  await rejects(s.sign(await req(ALICE, "999", dna)), "not_caw_owner");                    // does not exist
  c.st.used[7n] = 5;
  await rejects(s.sign(await req(ALICE, "7", dna)), "caw_used");
  delete c.st.used[7n];
  const look = O.lookHashOfGrid(O.renderFromBytes(PB, O.tokenRecord(PT, STRS, E.normalize(E.decode(dna))).bytes, []));
  c.st.taken.add(look);
  await rejects(s.sign(await req(ALICE, "7", dna)), "look_taken");
  c.st.taken.clear();
  c.st.closed = true;
  await rejects(s.sign(await req(ALICE, "7", dna)), "minting_closed");
  c.st.closed = false;
  c.st.signer = BOB.address;
  await rejects(s.sign(await req(ALICE, "7", dna)), "signer_mismatch");
});

test("design sniping: a look handed to one wallet is not signed for another until it expires", async () => {
  const { s } = setup();
  const dna = dnaOf(5);
  await s.sign(await req(ALICE, "7", dna));
  await rejects(s.sign(await req(BOB, "8", dna)), "reserved");
  const again = await s.sign(await req(ALICE, "7", dna));                                  // Alice can ask again
  assert.ok(again.signature);
  clock += 901;                                                                            // Alice's signature expired
  const r = await s.sign(await req(BOB, "8", dna));
  assert.ok(r.signature);
  clock += 1000;
});

test("one look at a time per CAW NAME: switching designs frees the old look", async () => {
  const { s } = setup();
  const a = dnaOf(6), b = dnaOf(7);
  await s.sign(await req(ALICE, "7", a));
  await rejects(s.sign(await req(BOB, "8", a)), "reserved");
  await s.sign(await req(ALICE, "7", b));                                                  // Alice changed her mind
  assert.ok((await s.sign(await req(BOB, "8", a))).signature);
  clock += 1000;
});

test("HTTP: CORS only for the maker page, small JSON bodies, 404 elsewhere", async () => {
  const { s } = setup();
  const get = async () => s;
  const post = (body, origin = "https://42avater.pages.dev") => handleRequest(new Request("https://x.workers.dev/sign",
    { method: "POST", headers: { origin, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), env, get);
  let r = await post(await req(ALICE, "7", dnaOf(8)));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://42avater.pages.dev");
  assert.ok((await r.json()).signature);
  r = await post(await req(ALICE, "7", dnaOf(9)), "https://evil.example");
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  assert.equal((await post("{")).status, 400);
  assert.equal((await post("x".repeat(3000))).status, 413);
  r = await handleRequest(new Request("https://x.workers.dev/sign", { method: "OPTIONS", headers: { origin: "https://42avater.pages.dev" } }), env, get);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  r = await handleRequest(new Request("https://x.workers.dev/other"), env, get);
  assert.equal(r.status, 404);
  r = await handleRequest(new Request("https://x.workers.dev/"), env, get);
  assert.equal((await r.json()).signer, SIGNER.address);
  const bad = await post({ to: "nope" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "bad_request");
  clock += 1000;
});

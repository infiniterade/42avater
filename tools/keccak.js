// keccak256 (Ethereum's hash) in plain JS, 32-bit lanes. Used to compute the same lookHash as the contract.
(function (root) {
  const RC = ["0000000000000001", "0000000000008082", "800000000000808A", "8000000080008000", "000000000000808B",
    "0000000080000001", "8000000080008081", "8000000000008009", "000000000000008A", "0000000000000088",
    "0000000080008009", "000000008000000A", "000000008000808B", "800000000000008B", "8000000000008089",
    "8000000000008003", "8000000000008002", "8000000000000080", "000000000000800A", "800000008000000A",
    "8000000080008081", "8000000000008080", "0000000080000001", "8000000080008008"];
  const RCH = RC.map(h => parseInt(h.slice(0, 8), 16) >>> 0), RCL = RC.map(h => parseInt(h.slice(8), 16) >>> 0);
  const ROT = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
  const PI = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];

  // s: Uint32Array(50); lane i = (lo s[2i], hi s[2i+1])
  function f(s) {
    const C = new Uint32Array(10), B = new Uint32Array(10);
    for (let r = 0; r < 24; r++) {
      for (let x = 0; x < 5; x++) {
        C[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40];
        C[2 * x + 1] = s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41];
      }
      for (let x = 0; x < 5; x++) {
        const a = (x + 1) % 5, b = (x + 4) % 5;
        const lo = C[2 * b] ^ ((C[2 * a] << 1) | (C[2 * a + 1] >>> 31));
        const hi = C[2 * b + 1] ^ ((C[2 * a + 1] << 1) | (C[2 * a] >>> 31));
        for (let y = 0; y < 25; y += 5) { s[2 * (x + y)] ^= lo; s[2 * (x + y) + 1] ^= hi; }
      }
      let lo = s[2], hi = s[3];
      for (let t = 0; t < 24; t++) {
        const j = PI[t], slo = s[2 * j], shi = s[2 * j + 1];
        let n = ROT[t], l = lo, h = hi;
        if (n >= 32) { const tmp = l; l = h; h = tmp; n -= 32; }
        if (n) { const nl = (l << n) | (h >>> (32 - n)), nh = (h << n) | (l >>> (32 - n)); l = nl; h = nh; }
        s[2 * j] = l; s[2 * j + 1] = h;
        lo = slo; hi = shi;
      }
      for (let y = 0; y < 25; y += 5) {
        for (let x = 0; x < 10; x++) B[x] = s[2 * y + x];
        for (let x = 0; x < 5; x++) {
          const a = 2 * ((x + 1) % 5), b = 2 * ((x + 2) % 5);
          s[2 * (y + x)] = B[2 * x] ^ (~B[a] & B[b]);
          s[2 * (y + x) + 1] = B[2 * x + 1] ^ (~B[a + 1] & B[b + 1]);
        }
      }
      s[0] ^= RCL[r]; s[1] ^= RCH[r];
    }
  }

  function keccak256(bytes) {
    if (typeof bytes === "string") bytes = new TextEncoder().encode(bytes);
    const rate = 136, s = new Uint32Array(50);
    const padLen = rate - (bytes.length % rate);
    const msg = new Uint8Array(bytes.length + padLen);
    msg.set(bytes); msg[bytes.length] ^= 0x01; msg[msg.length - 1] ^= 0x80;
    for (let o = 0; o < msg.length; o += rate) {
      for (let i = 0; i < rate / 4; i++) s[i] ^= msg[o + 4 * i] | (msg[o + 4 * i + 1] << 8) | (msg[o + 4 * i + 2] << 16) | (msg[o + 4 * i + 3] << 24);
      f(s);
    }
    let hex = "";
    for (let i = 0; i < 8; i++) for (let k = 0; k < 4; k++) hex += ((s[i] >>> (8 * k)) & 255).toString(16).padStart(2, "0");
    return "0x" + hex;
  }
  root.keccak256 = keccak256;
})(typeof window !== "undefined" ? window : globalThis);

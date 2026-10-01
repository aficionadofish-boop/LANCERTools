// Seeded random numbers that reproduce Python's exactly, so a map drawn here matches the one the
// Python tools drew from the same seed:
//   PyRandom  = random.Random(seed)            (MT19937: random, uniform, randint, choice)
//   NpRandom  = numpy.random.default_rng(seed) (SeedSequence + PCG64: random, uniform, normal)

import { KI, WI, FI, NOR_R, NOR_INV_R } from "./ziggurat.js?v=0f282507bd";

// --- random.Random: MT19937 -------------------------------------------------------------------

export class PyRandom {
  constructor(seed = 0) {
    this.mt = new Uint32Array(624);
    this.i = 624;
    let n = BigInt(Math.abs(seed));
    const key = [];
    do { key.push(Number(n & 0xffffffffn)); n >>= 32n; } while (n > 0n);
    this.initByArray(key);
  }

  initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, p) + i) >>> 0;
    }
  }

  initByArray(key) {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1, j = 0;
    for (let k = Math.max(624, key.length); k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1566083941)) - i) >>> 0;
      i++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
    }
    mt[0] = 0x80000000;
    this.i = 624;
  }

  uint32() {
    const mt = this.mt;
    if (this.i >= 624) {
      for (let k = 0; k < 624; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.i = 0;
    }
    let y = mt[this.i++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random() {
    const a = this.uint32() >>> 5, b = this.uint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  uniform(a, b) { return a + (b - a) * this.random(); }

  getrandbits(k) { return this.uint32() >>> (32 - k); }      // k <= 32

  randbelow(n) {
    const k = 32 - Math.clz32(n);                              // n.bit_length()
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  randint(a, b) { return a + this.randbelow(b - a + 1); }

  choice(seq) { return seq[this.randbelow(seq.length)]; }

  shuffle(x) {                                                // in place, as random.shuffle
    for (let i = x.length - 1; i > 0; i--) { const j = this.randbelow(i + 1); [x[i], x[j]] = [x[j], x[i]]; }
    return x;
  }
}

// --- numpy.random.default_rng: SeedSequence + PCG64 --------------------------------------------

const INIT_A = 0x43b0d7e5, MULT_A = 0x931e8875, INIT_B = 0x8b51f9dd, MULT_B = 0x58f38ded;
const MIX_MULT_L = 0xca01f9dd, MIX_MULT_R = 0x4973f715;

function seedSequenceState(seed, nWords32) {
  const entropy = [];
  let n = BigInt(seed);
  do { entropy.push(Number(n & 0xffffffffn)); n >>= 32n; } while (n > 0n);
  let hc = INIT_A;
  const hashmix = (v) => {
    v = (v ^ hc) >>> 0;
    hc = Math.imul(hc, MULT_A) >>> 0;
    v = Math.imul(v, hc) >>> 0;
    return (v ^ (v >>> 16)) >>> 0;
  };
  const mix = (x, y) => {
    let r = (Math.imul(MIX_MULT_L, x) - Math.imul(MIX_MULT_R, y)) >>> 0;
    return (r ^ (r >>> 16)) >>> 0;
  };
  const pool = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) pool[i] = hashmix(i < entropy.length ? entropy[i] : 0);
  for (let s = 0; s < 4; s++)
    for (let d = 0; d < 4; d++)
      if (s !== d) pool[d] = mix(pool[d], hashmix(pool[s]));
  for (let s = 4; s < entropy.length; s++)
    for (let d = 0; d < 4; d++) pool[d] = mix(pool[d], hashmix(entropy[s]));
  const out = [];
  let hb = INIT_B;
  for (let i = 0; i < nWords32; i++) {
    let v = (pool[i % 4] ^ hb) >>> 0;
    hb = Math.imul(hb, MULT_B) >>> 0;
    v = Math.imul(v, hb) >>> 0;
    out.push((v ^ (v >>> 16)) >>> 0);
  }
  return out;
}

const M128 = (1n << 128n) - 1n;
const PCG_MULT = (2549297995355413924n << 64n) + 4865540595714422341n;
const limbs = (v) => Array.from({ length: 8 }, (_, i) => Number((v >> BigInt(16 * i)) & 0xffffn));
const MULT16 = limbs(PCG_MULT);

// PCG64 (XSL-RR 128/64) on 16-bit limbs: the 128-bit state step without BigInt, fast enough for a
// normal per pixel. Seeding (once) uses BigInt.
export class NpRandom {
  constructor(seed = 0) {
    const w = seedSequenceState(seed, 8);
    const u64 = (k) => BigInt(w[2 * k]) | (BigInt(w[2 * k + 1]) << 32n);
    const initstate = (u64(0) << 64n) | u64(1);
    const initseq = (u64(2) << 64n) | u64(3);
    const inc = ((initseq << 1n) | 1n) & M128;
    let state = (inc) & M128;                                 // srandom: state = 0; step
    state = (state + initstate) & M128;
    state = (state * PCG_MULT + inc) & M128;
    this.s = limbs(state);
    this.inc = limbs(inc);
    this.lo = 0; this.hi = 0;                                 // the last output, as 32-bit halves
  }

  next() {                                                    // step, then output -> this.hi, this.lo
    const s = this.s, m = MULT16, c = this.inc, n = new Array(8);
    let carry = 0;
    for (let k = 0; k < 8; k++) {
      let acc = c[k] + carry;
      for (let i = 0; i <= k; i++) acc += s[i] * m[k - i];
      n[k] = acc % 65536;
      carry = Math.floor(acc / 65536);
    }
    this.s = n;
    const xl = ((n[0] | (n[1] << 16)) ^ (n[4] | (n[5] << 16))) >>> 0;
    const xh = ((n[2] | (n[3] << 16)) ^ (n[6] | (n[7] << 16))) >>> 0;
    const rot = n[7] >>> 10;
    if (rot === 0) { this.lo = xl; this.hi = xh; }
    else if (rot < 32) { this.lo = ((xl >>> rot) | (xh << (32 - rot))) >>> 0; this.hi = ((xh >>> rot) | (xl << (32 - rot))) >>> 0; }
    else if (rot === 32) { this.lo = xh; this.hi = xl; }
    else { const r = rot - 32; this.lo = ((xh >>> r) | (xl << (32 - r))) >>> 0; this.hi = ((xl >>> r) | (xh << (32 - r))) >>> 0; }
  }

  random() { this.next(); return (this.hi * 2097152 + (this.lo >>> 11)) / 9007199254740992; }

  uniform(a, b) { return a + (b - a) * this.random(); }

  randomArray(n) {                                            // rng.random(n), C order
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = this.random();
    return out;
  }

  // numpy's random_standard_normal (ziggurat), so Gaussian grain matches too
  standardNormal() {
    for (;;) {
      this.next();
      const lo = this.lo, hi = this.hi;
      const idx = lo & 0xff, sign = (lo >>> 8) & 1;
      const rabs = (hi & 0x1fffffff) * 8388608 + (lo >>> 9);  // bits 9..60
      let x = rabs * WI[idx];
      if (sign) x = -x;
      if (rabs < KI[idx]) return x;
      if (idx === 0) {
        for (;;) {
          const xx = -NOR_INV_R * Math.log1p(-this.random());
          const yy = -Math.log1p(-this.random());
          if (yy + yy > xx * xx) return (Math.floor(rabs / 256) & 1) ? -(NOR_R + xx) : NOR_R + xx;
        }
      } else if ((FI[idx - 1] - FI[idx]) * this.random() + FI[idx] < Math.exp(-0.5 * x * x)) return x;
    }
  }

  normal(mu = 0, sigma = 1) { return mu + sigma * this.standardNormal(); }
}

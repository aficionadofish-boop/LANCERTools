// Overgrown Jungle tokens (names start jg_): the growth and the ship's remains for the Overgrown Jungle
// map style. Lit height fields seen from the south like the Depot set (project(), groundShadow), with the
// map's own ferns and leaves (styles/jungle.js) for foliage, so tokens and floor match.
//
// Each part of a token is a height function; the field is their maximum, and paint() asks which part
// is on top at a pixel to colour it. The strange growths come glowing and plain (_plain): the glowing
// ones mark emissive pixels while painting and get a halo and light spill afterwards.

import { PyRandom } from "../rng.js?v=88bb8aa766";
import { newImage, Draw, alphaComposite, gaussianBlur } from "../raster.js?v=88bb8aa766";
import { geometry } from "../maps/geometry.js?v=88bb8aa766";
import { layerFor, centroid, row2, row3, fine, fill, project } from "./depot.js?v=88bb8aa766";
import { withShadow } from "./kit.js?v=88bb8aa766";
import { groundShadow } from "./shadow.js?v=88bb8aa766";
import { fern, broadLeaf, leafPts, lit, tint } from "../maps/styles/jungle.js?v=88bb8aa766";

const T = Math.trunc;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const A = (c, a = 255) => [...c.map((v) => Math.max(0, Math.min(255, T(v)))), a];

const BARK = [70, 58, 46], BARK_DARK = [34, 27, 21], MOSS = [58, 82, 38], MOSS_DARK = [34, 52, 26];
const WOOD = [128, 98, 64], SOIL = [52, 40, 28];
const STEEL = [84, 90, 94], STEEL_DARK = [44, 48, 52], RUST = [104, 62, 36], OLIVE = [78, 82, 62];
const GLOW = { teal: [70, 255, 215], violet: [185, 105, 255], lime: [175, 255, 95] };

// --- noise -----------------------------------------------------------------------------------------------

function hashN(i, j, s) {
  let h = Math.imul(i ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(j + 0x27d4eb2f + s * 7919, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
function vn(x, y, s) {                                                  // value noise, smooth, 0..1
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hashN(i, j, s), b = hashN(i + 1, j, s), c = hashN(i, j + 1, s), d = hashN(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, sc, s) => 0.6 * vn(x / sc, y / sc, s) + 0.3 * vn(x / sc * 2.1, y / sc * 2.1, s + 1) + 0.1 * vn(x / sc * 4.3, y / sc * 4.3, s + 2);

const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const MOSS_LIGHT = [96, 120, 54];

// how much a top surface faces up (1 flat, toward 0 steep), from a part's height function
function upness(f, x, y) {
  const gx = f(x + 1, y) - f(x - 1, y), gy = f(x, y + 1) - f(x, y - 1);
  return 1 / (1 + (gx * gx + gy * gy) * 0.25);
}

// Moss over a base colour: soft-edged patches where the noise allows, thickest on what faces up, its own
// colour mottled and speckled. cover: about how much of a flat top it takes (0..1).
function moss(base, x, y, up, cell, seed, cover = 0.4) {
  const n = fbm(x, y, cell * 0.14, seed), a = smooth((n - (0.95 - cover) + up * 0.1) / 0.07) * (0.25 + 0.75 * up);
  if (a <= 0.01) return base;
  const sp = hashN(Math.floor(x * 1.4), Math.floor(y * 1.4), seed + 5) - 0.5;
  const t = clamp(0.25 + 0.65 * fbm(x, y, cell * 0.045, seed + 3) + sp * 0.4);
  return mix(base, mix(MOSS_DARK, MOSS_LIGHT, t), a * 0.92);
}

// Bark: broad plates split by narrow dark wavy furrows that run along u (lines of equal v)
function bark(u, v, cell, seed, base = BARK, pitch = 0.05) {
  const wv = v / (cell * pitch) + (fbm(u, v * 0.4, cell * 0.22, seed) - 0.5) * 4;
  const f = Math.abs(Math.sin(wv * Math.PI)), plate = smooth(f / 0.45);
  const tone = 0.78 + 0.4 * fbm(u * 0.5, v, cell * 0.07, seed + 1) + (hashN(Math.floor(u * 0.7), Math.floor(v * 1.3), seed + 2) - 0.5) * 0.1;
  return mix(BARK_DARK.map((c) => c * 0.6), base.map((c) => c * tone), plate);
}

// rust running down a wall from its top: streaks long in height, short across
const rustStreak = (x, hgt, cell, seed) => smooth((fbm(x, hgt * 0.15, cell * 0.035, seed) - 0.56) / 0.08);

// alpha factors the painters write (token pixels, as projected); applied after project()
function fader(w, h, k) {
  const m = new Float32Array(w * h).fill(1);
  m.mark = (x, y, hgt, v) => {
    const X = Math.round(x), Y = Math.round(y - hgt * k);
    if (X >= 0 && Y >= 0 && X < w && Y < h) { const q = Y * w + X; if (v < m[q]) m[q] = v; }
  };
  m.apply = (img) => { for (let p = 0; p < m.length; p++) if (m[p] < 1) img.data[p * 4 + 3] = Math.round(img.data[p * 4 + 3] * m[p]); return img; };
  return m;
}

// --- parts: height functions --------------------------------------------------------------------------------

// a cylinder lying on the ground from (x0, y0) to (x1, y1), radius R, its underside at height b
function lying(x0, y0, x1, y1, R, b = 0, rfn = null) {
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
  return (x, y) => {
    const t = clamp(((x - x0) * dx + (y - y0) * dy) / L2), px = x0 + dx * t, py = y0 + dy * t, d = Math.hypot(x - px, y - py);
    const r = rfn ? R * rfn(t, x, y) : R;
    return d < r ? b + r * 0.3 + r * 1.1 * Math.sqrt(1 - (d / r) ** 2) : 0;
  };
}
// a rounded dome (half ellipsoid) standing on height b
const dome = (cx, cy, rx, ry, H, b = 0) => (x, y) => {
  const q = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
  return q < 1 ? b + H * Math.sqrt(1 - q) : 0;
};
// a box with softened top edges
const slab = (x0, y0, x1, y1, H, bev = 2) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return 0;
  const e = Math.min(x - x0, x1 - x, y - y0, y1 - y);
  return H - (e < bev ? bev - e : 0);
};

// the field from the parts, and which part tops a pixel
function build(w, h, parts) {
  const z = fine(w, h);
  fill(z, w, h, (x, y) => { let m = 0; for (const f of parts) { const v = f(x, y); if (v > m) m = v; } return m; });
  return z;
}
function owner(parts, x, y) {
  let m = 0, k = -1;
  for (let i = 0; i < parts.length; i++) { const v = parts[i](x, y); if (v > m) { m = v; k = i; } }
  return [k, m];
}

// --- glow -------------------------------------------------------------------------------------------------

// an emissive map the painters write into (token pixels, as projected)
function emitter(w, h, k = 1) {
  const m = { teal: newImage("L", w, h), violet: newImage("L", w, h), lime: newImage("L", w, h) };
  m.mark = (hue, x, y, hgt, v = 255) => {
    const X = Math.round(x), Y = Math.round(y - hgt * k);
    if (X >= 0 && Y >= 0 && X < w && Y < h) { const q = Y * w + X; if (v > m[hue].data[q]) m[hue].data[q] = v; }
  };
  return m;
}
// a coloured halo under the object, light spilled onto it, the emissive pixels themselves bright
function applyGlow(img, em, cell, strength = 1) {
  let out = img;
  for (const hue of ["teal", "violet", "lime"]) {
    const src = em[hue];
    if (!src.data.some((v) => v)) continue;
    const near = gaussianBlur(src, cell * 0.05), far = gaussianBlur(src, cell * 0.16), rgb = GLOW[hue];
    const halo = newImage("RGBA", img.w, img.h);
    for (let p = 0; p < src.data.length; p++) {
      const a = Math.min(255, (far.data[p] * 0.9 + near.data[p] * 0.6) * strength);
      if (!a) continue;
      halo.data[p * 4] = rgb[0]; halo.data[p * 4 + 1] = rgb[1]; halo.data[p * 4 + 2] = rgb[2]; halo.data[p * 4 + 3] = a * 0.55;
    }
    out = alphaComposite(halo, out);
    for (let p = 0; p < src.data.length; p++) {
      const f = (src.data[p] * 0.8 + near.data[p] * 0.7 + far.data[p] * 0.3) / 255 * strength;
      if (!f || !out.data[p * 4 + 3]) continue;
      for (let c = 0; c < 3; c++) out.data[p * 4 + c] = Math.min(255, out.data[p * 4 + c] + rgb[c] * f * 0.6);
    }
  }
  return out;
}

// --- foliage from the map style ---------------------------------------------------------------------------

// a few ferns and leaves around a base, under the object (own soft shadow), as on the jungle floor
function plantsAround(w, h, cell, spots, seed, { ferns = true, scale = 1 } = {}) {
  const lay = newImage("RGBA", w, h), d = new Draw(lay), sd = new Draw(newImage("L", w, h)), r = new PyRandom(seed);
  for (const [x, y, n] of spots)
    for (let i = 0; i < n; i++) {
      const a = r.uniform(0, 2 * Math.PI), len = cell * r.uniform(0.18, 0.34) * scale, base = mix([20, 40, 22], [38, 68, 34], r.random());
      if (ferns && r.random() < 0.6) fern(d, sd, x, y, a, len, r.uniform(-0.4, 0.4), base, 0);
      else broadLeaf(d, sd, x, y, a, len * 0.8, len * 0.38, base, 0);
    }
  return withShadow(lay, cell, 0.03, 0.04, 0.03, 0.55);
}

// vines across an object: dark stems with small leaves, only where the object is drawn
function vines(img, cell, seed, n, { col = [26, 40, 20], leaf = [44, 70, 34] } = {}) {
  const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), r = new PyRandom(seed);
  for (let i = 0; i < n; i++) {
    let x = r.uniform(0, w), y = r.uniform(0, h), a = r.uniform(0, 2 * Math.PI), da = 0;
    const pts = [[x, y]], L = cell * r.uniform(0.4, 1.1);
    for (let s = 0; s < L; s += cell * 0.04) {
      da = da * 0.8 + r.uniform(-0.25, 0.25); a += da; x += Math.cos(a) * cell * 0.04; y += Math.sin(a) * cell * 0.04; pts.push([x, y]);
      if (r.random() < 0.3) d.polygon(leafPts(x, y, a + (r.random() < 0.5 ? 1 : -1) * r.uniform(0.6, 1.2), cell * r.uniform(0.04, 0.08), cell * 0.03), A(leaf));
    }
    d.line(pts, A(col), Math.max(2, Math.round(cell * 0.014)));
  }
  for (let p = 0; p < w * h; p++) if (img.data[p * 4 + 3] < 128) over.data[p * 4 + 3] = 0;
  return alphaComposite(img, over);
}

const hexFp = (cell, size) => {
  const [sx, sy, hw] = geometry(cell);
  return size === 3 ? [[0, 0], [sx, 0], [-sx, 0], [hw, -sy], [-hw, -sy], [hw, sy], [-hw, sy]] : size === 2 ? [[0, 0], [-hw, sy], [hw, sy]] : [[0, 0]];
};

// --- trees ---------------------------------------------------------------------------------------------------

// A giant trunk rising out of sight: a fluted column of furrowed bark climbing from the floor and fading
// into the dark above, buttress roots snaking out with moss on their backs, ferns at the foot.
function tokenTree(cell, size, seed) {
  const [lay, , cs] = layerFor(cell, hexFp(cell, size)), { w, h } = lay, r = new PyRandom(810 + seed);
  const [gx, gy] = centroid(cs), R = cell * [0, 0.19, 0.33, 0.5][size];
  const cx = gx + r.uniform(-0.04, 0.04) * cell, cy = gy + cell * [0, 0.2, 0.3, 0.42][size], ph = r.uniform(0, 6.3);
  const H = cy - R * 0.9 - 2, fl = 6 + size * 2;                                          // up to the canvas top
  const trunkR = (a) => R * (1 + 0.06 * Math.sin(fl * a + ph) + 0.03 * Math.sin(13 * a + ph * 2));
  const trunk = (x, y) => { const dx = x - cx, dy = y - cy; return Math.hypot(dx, dy) < trunkR(Math.atan2(dy, dx)) ? H : 0; };
  const roots = [], n = 4 + size + r.randint(0, 2), a0 = r.uniform(0, 6.3);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * 2 * Math.PI + r.uniform(-0.25, 0.25), L = R * r.uniform(1.0, 1.6), bend = r.uniform(-0.6, 0.6), pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8, an = a + bend * t * t, rr = R * 0.75 + L * t; pts.push([cx + Math.cos(an) * rr, cy + Math.sin(an) * rr * 0.9, t]); }
    roots.push({ pts, L, wid: R * r.uniform(0.28, 0.4), Hr: R * r.uniform(0.7, 1.0) });
  }
  const rootAt = (rt, x, y) => {                                         // [height, along, across] of a root ridge
    let best = 0, along = 0, across = 0;
    for (let k = 0; k < 8; k++) {
      const [ax, ay, ta] = rt.pts[k], [bx, by, tb] = rt.pts[k + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2), sx = x - ax - dx * t, sy = y - ay - dy * t, d = Math.hypot(sx, sy), tt = ta + (tb - ta) * t;
      const hw = rt.wid * (1 - tt * 0.7);
      if (d < hw) { const v = rt.Hr * (1 - tt) ** 1.6 * Math.sqrt(1 - (d / hw) ** 2) + 1; if (v > best) { best = v; along = tt * rt.L; across = (sx * dy - sy * dx) / Math.sqrt(L2); } }
    }
    return [best, along, across];
  };
  const parts = [trunk, ...roots.map((rt) => (x, y) => rootAt(rt, x, y)[0])], z = build(w, h, parts), fade = fader(w, h, 1), S = 820 + seed;
  let obj = project(w, h, z, (x, y, hgt, wall) => {
    const [k] = owner(parts, x, y);
    if (k === 0) {
      if (!wall) return null;                                            // the top is lost in the dark
      const a = Math.atan2(y - cy, x - cx), up = hgt / H;
      fade.mark(x, y, hgt, 1 - smooth((up - 0.35) / 0.6));
      let c = bark(hgt, a * R, cell, S, BARK, 0.04);
      if (hgt < R * 0.7) c = moss(c, x * 1.3, hgt * 2, 0.5, cell, S + 7, 0.3);           // moss round the foot
      return c.map((v) => v * (1 - 0.6 * smooth(up / 0.8)));
    }
    const [, along, across] = rootAt(roots[k - 1], x, y);
    const c = bark(along, across, cell, S + k, BARK, 0.035);
    return wall ? c : moss(c, x, y, upness(parts[k], x, y), cell, S + 11, 0.42);
  }, { gloss: 0.05 });
  obj = groundShadow(fade.apply(obj), cell);
  const spots = [];
  for (let i = 0; i < 2 + size * 2; i++) { const a = r.uniform(0.3, 2.8); spots.push([cx + Math.cos(a) * R * 1.3, cy + Math.sin(a) * R * 0.9, 2]); }
  return alphaComposite(plantsAround(w, h, cell, spots, 830 + seed), obj);
}

// --- logs ------------------------------------------------------------------------------------------------------

// A fallen, rotting log: bark plates and furrows running its length, knots, soft moss along the top,
// stacked bracket fungus on its flank, a splintered west end and a hollow east end showing its rings.
function tokenLog(cell, n, seed) {
  const fp = n === 3 ? row3(cell) : row2(cell), [lay, , cs] = layerFor(cell, fp), { w, h } = lay, r = new PyRandom(840 + seed);
  const [gx, gy] = centroid(cs), L = cell * (n - 0.2), R = cell * (n === 3 ? 0.22 : 0.19), bend = r.uniform(-0.07, 0.07) * cell;
  const x0 = gx - L / 2, x1 = gx + L / 2, cy = gy + R * 0.4;
  const axisY = (x) => cy + bend * Math.sin(Math.PI * (x - x0) / L);
  const rad = (t) => R * (1 + 0.05 * Math.sin(t * 19 + seed) + 0.03 * Math.sin(t * 47));
  const splinter = (y) => cell * 0.1 * hashN(Math.floor(y / (cell * 0.03)), 0, 841 + seed);       // how far each splinter reaches
  const prof = (x, y) => {                                              // [height, t, d/R] of the body
    if (x < x0 || x > x1) return [0, 0, 0];
    const t = (x - x0) / L, rr = rad(t), d = y - axisY(x);
    if (Math.abs(d) >= rr || x < x0 + cell * 0.1 - splinter(y)) return [0, t, 0];
    return [rr * 0.3 + rr * 1.1 * Math.sqrt(1 - (d / rr) ** 2), t, d / rr];
  };
  const hole = (x, y) => { const e = (x - (x1 - R * 0.45)) / (R * 0.45), d = (y - axisY(x)) / (R * 0.62); return e * e + d * d < 1; };
  const body = (x, y) => { const [v] = prof(x, y); return v && hole(x, y) ? v - R * 0.9 : v; };
  const knots = [];
  for (let i = 0; i < n + 1; i++) knots.push([r.uniform(x0 + L * 0.15, x1 - L * 0.25), r.uniform(-0.5, 0.2) * R, R * r.uniform(0.08, 0.14)]);
  const shelves = [];
  for (let i = 0; i < 2; i++) {
    const x = r.uniform(x0 + L * 0.2, x1 - L * 0.3);
    for (let j = 0; j < 3; j++) shelves.push([x + r.uniform(-0.6, 0.6) * R * 0.5, R * (0.32 - j * 0.07), R * (0.25 + j * 0.2)]);   // stacked, smaller up the flank
  }
  const parts = [body, ...shelves.map(([sx, s, off]) => (px, py) => {
    const yc = axisY(sx) + R * 0.55 - off * 0.5, q = ((px - sx) / s) ** 2 + ((py - yc) / (s * 0.6)) ** 2;
    return q < 1 && py > yc - s * 0.2 ? R * 0.6 + off + s * 0.25 * Math.sqrt(1 - q) : 0;
  })];
  const z = build(w, h, parts), S = 850 + seed;
  let obj = project(w, h, z, (x, y, hgt, wall) => {
    const [k] = owner(parts, x, y);
    if (k > 0) {                                                         // zoned bracket: cream rim, rings of tan to umber
      const [sx, s, off] = shelves[k - 1], yc = axisY(sx) + R * 0.55 - off * 0.5, q = Math.hypot((x - sx) / s, (y - yc) / (s * 0.6));
      if (wall) return [92, 70, 46];
      return mix(mix([226, 206, 160], [120, 84, 50], smooth((1 - q) * 1.6)), [72, 50, 32], 0.25 * (0.5 + 0.5 * Math.sin(q * 24)));
    }
    const [, t, dn] = prof(x, y);
    if (!wall && hole(x, y)) {                                           // the hollow: dark inside, rings at the rim
      const e = Math.hypot((x - (x1 - R * 0.45)) / (R * 0.45), (y - axisY(x)) / (R * 0.62));
      if (e < 0.8) return mix([14, 10, 8], [44, 32, 22], e);
      return mix([150, 116, 78], [96, 70, 46], 0.5 + 0.5 * Math.sin(e * 60));
    }
    if (x < x0 + cell * 0.12) return mix([170, 136, 92], [110, 82, 54], hashN(Math.floor(y / (cell * 0.03)), 1, 843 + seed));   // pale splinters
    for (const [kx, ky, kr] of knots) {                                  // knots: a dark eye in rings of swirled bark
      const dk = Math.hypot((x - kx) / 1.6, (wall ? R : y - axisY(x)) - ky) / kr;
      if (dk < 1) return dk < 0.45 ? [30, 22, 16] : mix([96, 74, 52], BARK_DARK, 0.5 + 0.5 * Math.sin(dk * 14));
    }
    const c = bark(x, wall ? hgt * 1.6 : dn * R * 1.6, cell, S, BARK, 0.04);
    return wall ? c : moss(c, x, y, Math.max(0, 1 - Math.abs(dn) * 1.3), cell, S + 7, 0.45);
  }, { gloss: 0.04, k: 0.6 });
  obj = groundShadow(obj, cell);
  return alphaComposite(plantsAround(w, h, cell, [[x0 + R * 0.5, cy + R * 0.3, 2], [x1 - R * 0.3, cy + R * 0.2, 1], [gx, cy + R * 1.1, 1]], 860 + seed), obj);
}

// --- thickets ------------------------------------------------------------------------------------------------

// A dense bush: hundreds of leaves on a dome, each lit by the dome's slope where it sits, drawn from the
// edge inward so the crown overlaps the skirt.
function tokenThicket(cell, size, seed) {
  const [lay, d, cs] = layerFor(cell, hexFp(cell, size)), { w, h } = lay, r = new PyRandom(870 + seed);
  const [cx, cy] = centroid(cs), R = cell * [0, 0.44, 0.82, 1.2][size], sd = new Draw(newImage("L", w, h));
  const blobs = [];
  for (let i = 0; i < 2 + size * 2; i++) { const a = r.uniform(0, 6.3), rr = R * r.uniform(0, 0.5); blobs.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, R * r.uniform(0.5, 0.7)]); }
  const hgt = (x, y) => { let m = 0; for (const [bx, by, br] of blobs) { const q = ((x - bx) ** 2 + (y - by) ** 2) / (br * br); if (q < 1) m = Math.max(m, Math.sqrt(1 - q)); } return m; };
  const leaves = [], N = Math.round(150 * size * size);
  for (let i = 0; i < N; i++) {
    const a = r.uniform(0, 6.3), rr = R * Math.sqrt(r.random()) * 0.92, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    const z = hgt(x, y);
    if (z <= 0.02) continue;
    const e = 3, gxv = hgt(x + e, y) - hgt(x - e, y), gyv = hgt(x, y + e) - hgt(x, y - e);
    leaves.push([z, x, y, Math.atan2(y - cy, x - cx) + r.uniform(-0.7, 0.7), cell * r.uniform(0.11, 0.2), r.random(), clamp(0.55 - (gxv + gyv) * 6)]);
  }
  leaves.sort((p, q) => p[0] - q[0]);
  for (const [z, x, y, a, len, tone, l] of leaves) {
    const base = mix([18, 36, 20], [40, 72, 36], tone).map((v) => v * (0.55 + 0.45 * z) * (0.7 + l * 0.7));
    broadLeaf(d, sd, x, y - z * cell * 0.25, a, len, len * 0.5, base, 0);
  }
  return withShadow(lay, cell, 0.07, 0.1, 0.06, 0.6);
}

// --- fungus ---------------------------------------------------------------------------------------------------

// Giant mushroom caps in a cluster. glow: dark teal/violet caps with glowing spots and rims; plain: tan,
// rust and cream caps with pale spots.
function tokenFungus(cell, size, seed, glow) {
  const [lay, , cs] = layerFor(cell, hexFp(cell, size)), { w, h } = lay, r = new PyRandom(880 + seed);
  const [gx, gy] = centroid(cs), caps = [], k = size === 1 ? r.randint(3, 4) : r.randint(4, 6);
  for (let i = 0; i < k; i++) {
    const big = i === 0, R = cell * (big ? [0, 0.3, 0.5][size] : r.uniform(0.1, 0.2) * (size === 2 ? 1.4 : 1));
    const a = r.uniform(0, 6.3), off = big ? 0 : cell * r.uniform(0.2, 0.35) * size;
    caps.push({ x: gx + Math.cos(a) * off, y: gy + Math.sin(a) * off * 0.8 + cell * 0.1, R, S: R * r.uniform(0.45, 0.75), H: R * r.uniform(0.35, 0.55), hue: r.choice(["teal", "violet", "teal"]), tone: r.random() });
  }
  const parts = caps.map((c) => dome(c.x, c.y, c.R, c.R * 0.9, c.H, c.S));
  const em = emitter(w, h, 0.55), z = build(w, h, parts);
  let obj = project(w, h, z, (x, y, hgt, wall) => {
    const [i] = owner(parts, x, y), c = caps[i], dx = x - c.x, dy = y - c.y, rr = Math.hypot(dx / c.R, dy / (c.R * 0.9));
    if (wall && hgt < c.S) {                                             // under the cap: the stem only
      if (Math.abs(dx) > c.R * 0.28) return null;
      return glow ? [70, 84, 90] : [196, 186, 160];
    }
    const spot = vn(x / (c.R * 0.22), y / (c.R * 0.22), 890 + i) > 0.78 && rr < 0.85;
    if (glow) {
      const body = c.hue === "teal" ? [20, 58, 60] : [52, 26, 74];
      if (spot || rr > 0.9) { em.mark(c.hue, x, y, hgt, spot ? 255 : 150); return mix(body, GLOW[c.hue], 0.6); }
      return mix(body, body.map((v) => v * 1.5), 1 - rr);
    }
    const body = mix([112, 72, 42], [138, 108, 74], c.tone);
    if (spot) return [178, 168, 148];
    return mix(body.map((v) => v * 0.7), body, 1 - rr * 0.6);
  }, { gloss: glow ? 0.25 : 0.15, k: 0.55 });
  obj = groundShadow(obj, cell);
  if (glow) obj = applyGlow(obj, em, cell, 0.9);
  return alphaComposite(plantsAround(w, h, cell, [[gx, gy + cell * 0.2, 2]], 895 + seed, { scale: 0.8 }), obj);
}

// --- pods --------------------------------------------------------------------------------------------------------

// A cluster of swollen seed pods on a knotted root mass. glow: translucent violet/teal with glowing cores
// and dark veins; plain: waxy green-yellow seed pods.
function tokenPods(cell, seed, glow) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, r = new PyRandom(900 + seed), [gx, gy] = cs[0];
  const pods = [], k = r.randint(4, 7), hue = r.choice(["violet", "teal"]);
  for (let i = 0; i < k; i++) {
    const a = r.uniform(0, 6.3), off = cell * r.uniform(0, 0.24), R = cell * r.uniform(0.09, 0.16);
    pods.push({ x: gx + Math.cos(a) * off, y: gy + Math.sin(a) * off * 0.85 + cell * 0.08, R, ang: a, H: R * r.uniform(1.2, 1.7) });
  }
  const parts = [dome(gx, gy + cell * 0.08, cell * 0.32, cell * 0.27, cell * 0.06)];
  for (const p of pods) parts.push(dome(p.x, p.y, p.R * 1.25, p.R, p.H, cell * 0.03));
  const em = emitter(w, h), z = build(w, h, parts);
  let obj = project(w, h, z, (x, y, hgt, wall) => {
    const [i] = owner(parts, x, y);
    if (i === 0) return mix([30, 24, 18], [58, 46, 32], fbm(x, y, cell * 0.04, 901));   // the root mass
    const p = pods[i - 1], rr = Math.hypot((x - p.x) / (p.R * 1.25), (y - p.y) / p.R), core = clamp(1 - rr * 1.2);
    const vein = Math.abs(vn(x / (cell * 0.03), y / (cell * 0.03), 902 + i) - 0.5) < 0.05;
    if (glow) {
      const body = hue === "violet" ? [70, 34, 92] : [24, 76, 72];
      if (vein) return body.map((v) => v * 0.5);
      if (core > 0.2 && !wall) em.mark(hue, x, y, hgt, 255 * core);
      return mix(body, GLOW[hue], core * 0.7);
    }
    if (vein) return [70, 82, 30];
    return mix([110, 132, 52], [196, 200, 104], core * 0.8);
  }, { gloss: 0.4 });
  obj = groundShadow(obj, cell);
  if (glow) obj = applyGlow(obj, em, cell, 1);
  return obj;
}

// --- flowers ------------------------------------------------------------------------------------------------------

// A giant flower, open, seen from above: thick petals curling up at the tips round a dark maw with a ring
// of stamens. glow: violet petals with glowing veins and edges, glowing stamen tips; plain: a rafflesia,
// brick red with pale warts.
function tokenFlower(cell, size, seed, glow) {
  const [lay, , cs] = layerFor(cell, hexFp(cell, size)), { w, h } = lay, r = new PyRandom(920 + seed);
  const [cx0, cy0] = centroid(cs), P = cell * [0, 0.42, 0.78][size], cx = cx0, cy = cy0 + P * 0.12, n = glow ? 6 : 5, a0 = r.uniform(0, 6.3);
  const maw = P * 0.3, Hp = P * 0.22;
  const petal = (x, y) => {
    const dx = x - cx, dy = (y - cy) / 0.9, rr = Math.hypot(dx, dy);
    if (rr < maw * 0.9 || rr > P) return 0;
    const a = Math.atan2(dy, dx) - a0, s = (n * a) / (2 * Math.PI), f = s - Math.round(s);   // -0.5..0.5 across a petal
    const t = (rr - maw) / (P - maw), half = 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.1)) + 0.06;
    if (Math.abs(f) > half) return 0;
    return P * 0.06 + Hp * (0.3 + 0.7 * t * t) * (1 - (f / half) ** 2 * 0.5);
  };
  const rim = (x, y) => { const rr = Math.hypot(x - cx, (y - cy) / 0.9); return rr < maw * 1.05 && rr > maw * 0.72 ? P * 0.16 : 0; };
  const stamens = [];
  for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.3 + r.uniform(-0.2, 0.2), rr = maw * r.uniform(0.25, 0.55); stamens.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9]); }
  const parts = [petal, rim, ...stamens.map(([x, y]) => dome(x, y, P * 0.035, P * 0.035, P * 0.05, P * 0.1))];
  const em = emitter(w, h), z = build(w, h, parts), hue = r.choice(["violet", "teal"]);
  let obj = project(w, h, z, (x, y, hgt, wall) => {
    const [i] = owner(parts, x, y), rr = Math.hypot(x - cx, (y - cy) / 0.9);
    if (i < 0) return [10, 6, 6];
    if (i >= 2) { if (glow) { em.mark("lime", x, y, hgt); return [200, 255, 150]; } return [220, 200, 150]; }
    if (i === 1) return glow ? [40, 20, 46] : [96, 40, 34];
    const a = Math.atan2((y - cy) / 0.9, x - cx) - a0, s = (n * a) / (2 * Math.PI), f = Math.abs(s - Math.round(s)), t = (rr - maw) / (P - maw);
    if (glow) {
      const body = hue === "violet" ? [72, 30, 96] : [24, 70, 74];
      const vein = Math.abs(Math.sin(f * 40 + t * 3)) < 0.12 || f > 0.36 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.1));
      if (vein && !wall) { em.mark(hue, x, y, hgt, 170); return mix(body, GLOW[hue], 0.55); }
      return mix(body.map((v) => v * 0.6), body, t);
    }
    const wart = vn(x / (P * 0.07), y / (P * 0.07), 921) > 0.72 && t > 0.15;
    if (wart && !wall) return [218, 196, 170];
    return mix([96, 30, 22], [168, 58, 40], 0.4 + t * 0.6);
  }, { gloss: 0.18 });
  obj = groundShadow(obj, cell);
  if (glow) obj = applyGlow(obj, em, cell, 0.8);
  return obj;
}

// --- the ship's remains --------------------------------------------------------------------------------------------

// A wrecked mech lying face down, half swallowed: armoured torso with panel seams and a faded unit stripe,
// the head with its cracked visor, a gun arm with its barrel, a shoulder plate, a foot; edges worn to bare
// steel, rust running down the sides, moss on the tops, a root or two grown over it.
function tokenWreck(cell, size, seed) {
  const [lay, , cs] = layerFor(cell, hexFp(cell, size)), { w, h } = lay, r = new PyRandom(940 + seed);
  const [gx, gy0] = centroid(cs), s = cell * (size === 2 ? 1.55 : 0.95), gy = gy0 + s * 0.08;
  const hull = [
    slab(gx - s * 0.24, gy - s * 0.15, gx + s * 0.18, gy + s * 0.2, s * 0.2, s * 0.03),                 // 0 torso
    slab(gx - s * 0.1, gy - s * 0.33, gx + s * 0.06, gy - s * 0.14, s * 0.24, s * 0.035),               // 1 head
    lying(gx + s * 0.15, gy - s * 0.06, gx + s * 0.34, gy + s * 0.12, s * 0.075),                        // 2 forearm
    lying(gx + s * 0.34, gy + s * 0.12, gx + s * 0.47, gy + s * 0.25, s * 0.033, s * 0.03),              // 3 barrel
    dome(gx - s * 0.27, gy - s * 0.1, s * 0.13, s * 0.11, s * 0.09, s * 0.13),                          // 4 shoulder plate
    slab(gx - s * 0.2, gy + s * 0.22, gx - s * 0.04, gy + s * 0.34, s * 0.09, s * 0.02),                // 5 a foot
  ];
  const parts = [...hull], nRoots = 1;
  for (let i = 0; i < nRoots; i++) {
    const a = r.uniform(0.25, 0.5), L = s * 0.95, ox = r.uniform(-0.08, 0.08) * s;
    const ax = gx + ox - Math.cos(a) * L / 2, ay = gy - Math.sin(a) * L / 2, bx = gx + ox + Math.cos(a) * L / 2, by = gy + Math.sin(a) * L / 2;
    parts.push((x, y) => { const f = lying(ax, ay, bx, by, s * 0.05)(x, y); if (!f) return 0; let m = 0; for (const p of hull) m = Math.max(m, p(x, y)); return f + m * 0.9; });
  }
  const z = build(w, h, parts), S = 950 + seed, ARMOUR = [104, 110, 96], PLATE = [118, 122, 112];
  let obj = project(w, h, z, (x, y, hgt, wall) => {
    const [i] = owner(parts, x, y);
    if (i >= hull.length) return bark(x + y, (x - y) * 0.7, cell, S + i, BARK, 0.03);
    let c = i === 1 || i === 4 ? PLATE : i === 3 ? [58, 60, 62] : ARMOUR;
    if (i === 1 && wall && hgt > s * 0.1 && hgt < s * 0.19) {             // the visor: dark glass, a crack, a glint
      const crack = Math.abs(x - gx + s * 0.02 - (hgt - s * 0.14) * 0.8) < 1.2 || Math.abs((x - gx) * 0.5 + hgt - s * 0.16) < 0.9;
      return crack ? [150, 170, 176] : Math.abs(hgt - s * 0.17) < 1 ? [90, 110, 120] : [18, 24, 28];
    }
    if (i === 3 && !wall && x > gx + s * 0.45) return [12, 12, 12];                          // the muzzle
    if (!wall) {
      const up = upness(parts[i], x, y);
      if (up < 0.55 && i !== 3) c = mix(c, [158, 162, 158], 0.7);                            // edges worn to bare steel
      if (i === 0) {
        const px = (x - gx) / (s * 0.14), py = (y - gy) / (s * 0.12);
        if (Math.abs(px - Math.round(px)) < 0.04 || Math.abs(py - Math.round(py)) < 0.05) c = c.map((v) => v * 0.55);   // panel seams
        if (Math.abs((x - gx) + (y - gy) * 0.7 + s * 0.04) < s * 0.035) c = mix(c, [176, 150, 64], 0.75);           // faded unit stripe
      }
      return moss(c, x, y, up, cell, S + 3, 0.32);
    }
    return mix(c.map((v) => v * 0.85), RUST, 0.7 * rustStreak(x, hgt, cell, S + 5));
  }, { gloss: 0.12, k: 0.8 });
  obj = groundShadow(obj, cell);
  obj = vines(obj, cell, 955 + seed, size + 1);
  return alphaComposite(plantsAround(w, h, cell, [[gx - s * 0.3, gy + s * 0.28, 2], [gx + s * 0.28, gy - s * 0.22, 1], [gx + s * 0.08, gy + s * 0.32, 1]], 956 + seed), obj);
}

// A burst hydroponic planter from the old garden: a steel trough with a stencilled bed number, soil
// heaped in it, one wall split open and soil spilled out, plants growing from it.
function tokenPlanter(cell, n, seed) {
  const fp = n === 2 ? row2(cell) : [[0, 0]], [lay, , cs] = layerFor(cell, fp), { w, h } = lay, r = new PyRandom(960 + seed);
  const [gx, gy] = centroid(cs), hw = cell * (n === 2 ? 0.9 : 0.38), hh = cell * 0.26, H = cell * 0.2, t = cell * 0.035, cy = gy + cell * 0.1;
  const breakX = gx + r.uniform(-0.5, 0.5) * hw, bw = cell * 0.14, broken = (x, y) => y > cy + hh - t - 1 && Math.abs(x - breakX) < bw;
  const wall = (x, y) => (x < gx - hw || x > gx + hw || y < cy - hh || y > cy + hh) ? 0 : broken(x, y) ? 0 : (x < gx - hw + t || x > gx + hw - t || y < cy - hh + t || y > cy + hh - t) ? H : 0;
  const soil = (x, y) => {
    if (x > gx - hw && x < gx + hw && y > cy - hh && y < cy + hh) return H * 0.72 + fbm(x, y, cell * 0.08, 961) * H * 0.2;
    const d = Math.hypot((x - breakX) / (bw * 1.6), (y - cy - hh) / (cell * 0.16));          // the spill
    return y > cy + hh - 2 && d < 1 ? H * 0.5 * (1 - d) + 1 : 0;
  };
  const parts = [wall, soil], z = build(w, h, parts);
  let obj = project(w, h, z, (x, y, hgt, isWall) => {
    const [i] = owner(parts, x, y);
    if (i === 1) return mix([30, 22, 16], SOIL, fbm(x, y, cell * 0.04, 962));
    const rust = fbm(x, y, cell * 0.06, 963) > 0.58, base = [96, 112, 108];
    if (isWall && Math.abs(hgt - H * 0.5) < H * 0.12) return [168, 150, 60];       // a faded yellow band round the trough
    return rust ? mix(base, RUST, 0.65) : base;
  }, { gloss: 0.12 });
  const d = new Draw(obj), label = n === 2 ? "HYDRO BED 07" : "BED 12", fs = T(cell * 0.075);   // stencil on the south face
  d.text([gx - hw + cell * 0.08 + (breakX < gx ? hw : 0), cy + hh - H + fs * 0.4], label, fs, [34, 38, 36, 230], { family: "stencil" });
  obj = groundShadow(obj, cell);
  const plants = plantsAround(w, h, cell, [[gx - hw * 0.4, cy - H * 0.7, 2], [gx + hw * 0.4, cy - H * 0.7, 2], [breakX, cy + hh + cell * 0.05, 2]], 965 + seed);
  return alphaComposite(obj, plants);
}

// A steel cargo crate (or two) from the old garden's stores, gone green: a raised frame round the lid, a
// latch, SEED STOCK stencilled on top, corrugated sides with corner posts, rust running down, moss on top,
// vines over it.
function tokenCrate(cell, seed) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, [gx, gy] = cs[0], two = seed % 2 === 1;
  const boxes = (two ? [[-0.42, -0.28, 0.04, 0.1, 0.3], [-0.02, -0.04, 0.4, 0.3, 0.22]] : [[-0.38, -0.26, 0.38, 0.26, 0.32]])
    .map(([a, b, c, e, hh]) => [gx + a * cell, gy + b * cell + cell * 0.08, gx + c * cell, gy + e * cell + cell * 0.08, hh * cell]);
  const fr = cell * 0.045;
  const parts = boxes.map(([x0, y0, x1, y1, H]) => (x, y) => {
    const v = slab(x0, y0, x1, y1, H, 2)(x, y);
    if (!v) return 0;
    const e = Math.min(x - x0, x1 - x, y - y0, y1 - y);
    return e < fr ? v : v - 2;                                           // the lid sits a little below its frame
  });
  const z = build(w, h, parts), S = 970 + seed, k = 0.85;
  let obj = project(w, h, z, (x, y, hgt, wall) => {
    const [i] = owner(parts, x, y), [x0, y0, x1, y1, H] = boxes[i], base = i ? [98, 94, 66] : [72, 90, 98];
    if (wall) {
      const post = x - x0 < fr || x1 - x < fr;
      const rib = post ? 1.15 : 0.9 + 0.12 * Math.cos(((x - x0) / (cell * 0.055)) * 2 * Math.PI);
      return mix(base.map((v) => v * rib), RUST, 0.75 * rustStreak(x, H - hgt, cell, S + i));
    }
    const e = Math.min(x - x0, x1 - x, y - y0, y1 - y);
    let c = e < fr ? base.map((v) => v * 1.18) : base;                    // the frame
    if (Math.abs(e - fr) < 1) c = c.map((v) => v * 0.6);
    if (Math.abs(x - (x0 + x1) / 2) < cell * 0.035 && y > y1 - fr * 1.6) c = [60, 62, 64];          // the latch
    return moss(c, x, y, e < fr ? 0.6 : 1, cell, S + 9, 0.3);
  }, { gloss: 0.1, k });
  const d = new Draw(obj), [x0, y0, x1, , H] = boxes[0], fs = T(cell * (two ? 0.06 : 0.075));
  d.text([x0 + cell * 0.07, y0 - H * k + cell * 0.08], "SEED STOCK", fs, [26, 30, 30, 170], { family: "stencil" });
  obj = groundShadow(obj, cell);
  obj = vines(obj, cell, 975 + seed, 3);
  return alphaComposite(plantsAround(w, h, cell, [[gx - cell * 0.32, gy + cell * 0.36, 2], [gx + cell * 0.34, gy - cell * 0.12, 1]], 976 + seed), obj);
}

// A slab of fallen wall plating, two hexes long, lying tilted on its debris: panel seams and rivets, a
// torn east edge, moss and vines over it
function tokenSlab(cell, seed) {
  const [lay, , cs] = layerFor(cell, row2(cell)), { w, h } = lay, r = new PyRandom(980 + seed), [gx, gy] = centroid(cs);
  const x0 = gx - cell * 0.9, x1 = gx + cell * 0.85, y0 = gy - cell * 0.28, y1 = gy + cell * 0.3;
  const torn = (y) => x1 - cell * 0.12 * (0.5 + 0.5 * Math.sin(y * 0.3 + seed) * Math.sin(y * 0.11));
  const plate = (x, y) => (x < x0 || x > torn(y) || y < y0 || y > y1) ? 0 : cell * (0.06 + 0.22 * (y1 - y) / (y1 - y0)) + 2;
  const parts = [plate], z = build(w, h, parts);
  let obj = project(w, h, z, (x, y, hgt, wall) => {
    if (wall) return STEEL_DARK;
    const px = (x - x0) / (cell * 0.58), py = (y - y0) / (cell * 0.29);
    if (Math.abs(px - Math.round(px)) < 0.02 || Math.abs(py - Math.round(py)) < 0.035) return STEEL_DARK;
    const rv = Math.abs(px - Math.round(px)) < 0.06 && Math.abs((py * 3) - Math.round(py * 3)) < 0.12;
    if (rv) return [120, 126, 130];
    return moss(mix(STEEL, RUST, 0.5 * smooth((fbm(x, y, cell * 0.06, 982) - 0.58) / 0.1)), x, y, 1, cell, 981 + seed, 0.35);
  }, { gloss: 0.1 });
  obj = groundShadow(obj, cell);
  obj = vines(obj, cell, 985 + seed, 5);
  return alphaComposite(plantsAround(w, h, cell, [[x0 + cell * 0.1, y1, 2], [gx + cell * 0.3, y1 + cell * 0.05, 1]], 986 + seed), obj);
}

// A big pipe lying along the floor, two or three hexes: bolted flanges, a hazard band, a burst in the
// middle with its metal torn outward, roots wrapped over it, moss in patches on top.
function tokenPipe(cell, n, seed) {
  const fp = n === 3 ? row3(cell) : row2(cell), [lay, , cs] = layerFor(cell, fp), { w, h } = lay, r = new PyRandom(990 + seed);
  const [gx, gy] = centroid(cs), L = cell * (n - 0.1), R = cell * 0.19, x0 = gx - L / 2, x1 = gx + L / 2, cy = gy + R * 0.5;
  const burst = gx + r.uniform(-0.2, 0.2) * cell, flanges = [], fw = cell * 0.04;
  for (let x = x0 + cell * 0.45; x < x1 - cell * 0.2; x += cell * 0.9) flanges.push(x);
  const onFlange = (x) => flanges.some((f) => Math.abs(x - f) < fw);
  const holeQ = (x, y) => Math.hypot((x - burst) / (R * 0.62), (y - cy + R * 0.1) / (R * 0.5));
  const pipe = (x, y) => {
    if (x < x0 || x > x1) return 0;
    const rr = R * (onFlange(x) ? 1.14 : 1), d = Math.abs(y - cy);
    if (d >= rr) return 0;
    const top = rr * 0.3 + rr * 1.1 * Math.sqrt(1 - (d / rr) ** 2), q = holeQ(x, y);
    if (q < 0.8) return R * 0.7;                                         // the hole
    if (q < 1.15) return top + R * 0.12 * (1 - Math.abs(q - 0.95) / 0.2) * (0.6 + 0.4 * Math.sin(Math.atan2(y - cy, x - burst) * 7));   // torn petals
    return top;
  };
  const parts = [pipe], roots = [];
  for (let i = 0; i < n; i++) {
    const x = r.uniform(x0 + cell * 0.3, x1 - cell * 0.3), a = r.uniform(-0.45, 0.45) + Math.PI / 2, L2 = R * 3.0;
    const ax = x - Math.cos(a) * L2 / 2, ay = cy - Math.sin(a) * L2 / 2, bx = x + Math.cos(a) * L2 / 2, by = cy + Math.sin(a) * L2 / 2;
    if (Math.abs(x - burst) < R) continue;
    roots.push([ax, ay, bx, by]);
    parts.push((px, py) => { const f = lying(ax, ay, bx, by, cell * 0.045)(px, py); return f ? f + pipe(px, py) * 0.9 : 0; });
  }
  const z = build(w, h, parts), S = 991 + seed;
  let obj = project(w, h, z, (x, y, hgt, wall) => {
    const [i] = owner(parts, x, y);
    if (i > 0) { const [ax, ay, bx, by] = roots[i - 1], ln = Math.hypot(bx - ax, by - ay); return bark(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ln, ((x - ax) * (by - ay) - (y - ay) * (bx - ax)) / ln, cell, S + i, BARK, 0.025); }
    const q = holeQ(x, y);
    if (!wall && q < 0.8) return mix([10, 10, 12], [40, 40, 42], q);
    if (!wall && q < 1.15) return [150, 152, 146];                       // the torn metal, bright at the tear
    const v = wall ? 1 : Math.abs(y - cy) / R;
    const shade = 0.5 + 0.5 * Math.cos(v * 1.4);
    let c = mix([68, 72, 68], [116, 120, 112], shade);
    if (onFlange(x)) {
      c = mix([58, 62, 60], [96, 100, 96], shade);
      const bolt = Math.abs(((wall ? hgt : y) / (cell * 0.05)) % 1 - 0.5) < 0.18 && Math.abs(x - flanges.find((f) => Math.abs(x - f) < fw)) < fw * 0.4;
      if (bolt) c = [150, 150, 144];
    }
    const hx = x - (x0 + cell * 0.18);
    if (hx > 0 && hx < cell * 0.14) c = mix(c, ((hx + (wall ? hgt : y)) / (cell * 0.05)) % 2 < 1 ? [196, 156, 44] : [26, 24, 22], 0.75);   // hazard band
    if (wall) return mix(c, RUST, 0.7 * rustStreak(x, hgt, cell, S + 2));
    return moss(c, x, y, Math.max(0, 1 - v * 1.4), cell, S + 4, 0.3);
  }, { gloss: 0.3, k: 0.6 });
  obj = groundShadow(obj, cell);
  return alphaComposite(plantsAround(w, h, cell, [[x0 + R, cy + R, 1], [x1 - R, cy + R * 0.5, 2], [burst + R, cy + R * 1.3, 1]], 996 + seed), obj);
}

export const TOKENS = {
  jg_tree_v1: (c) => tokenTree(c, 1, 0),
  jg_tree_v2: (c) => tokenTree(c, 1, 1),
  jg_tree_size2: (c) => tokenTree(c, 2, 2),
  jg_tree_size3: (c) => tokenTree(c, 3, 3),
  jg_log_2hex: (c) => tokenLog(c, 2, 0),
  jg_log_3hex: (c) => tokenLog(c, 3, 1),
  jg_thicket_v1: (c) => tokenThicket(c, 1, 0),
  jg_thicket_v2: (c) => tokenThicket(c, 1, 1),
  jg_thicket_size2: (c) => tokenThicket(c, 2, 2),
  jg_fungus_v1: (c) => tokenFungus(c, 1, 0, true),
  jg_fungus_size2: (c) => tokenFungus(c, 2, 1, true),
  jg_fungus_plain_v1: (c) => tokenFungus(c, 1, 2, false),
  jg_fungus_plain_size2: (c) => tokenFungus(c, 2, 3, false),
  jg_pods_v1: (c) => tokenPods(c, 0, true),
  jg_pods_v2: (c) => tokenPods(c, 1, true),
  jg_pods_plain_v1: (c) => tokenPods(c, 2, false),
  jg_flower_v1: (c) => tokenFlower(c, 1, 0, true),
  jg_flower_size2: (c) => tokenFlower(c, 2, 1, true),
  jg_flower_plain_v1: (c) => tokenFlower(c, 1, 2, false),
  jg_flower_plain_size2: (c) => tokenFlower(c, 2, 3, false),
  jg_wreck_v1: (c) => tokenWreck(c, 1, 0),
  jg_wreck_size2: (c) => tokenWreck(c, 2, 1),
  jg_planter_v1: (c) => tokenPlanter(c, 1, 0),
  jg_planter_2hex: (c) => tokenPlanter(c, 2, 1),
  jg_crate_v1: (c) => tokenCrate(c, 0),
  jg_crate_v2: (c) => tokenCrate(c, 1),
  jg_slab_2hex: (c) => tokenSlab(c, 0),
  jg_pipe_2hex: (c) => tokenPipe(c, 2, 0),
  jg_pipe_3hex: (c) => tokenPipe(c, 3, 1),
};

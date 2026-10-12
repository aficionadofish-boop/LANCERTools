// Overgrown Jungle: a closed-canopy jungle floor grown wild inside a ship, seen from above. Near-black
// loam and leaf litter, roots, two tiers of ferns and broad leaves with their shadows, mutant pods, and
// bioluminescence (fungus, veins along the roots, spores) glowing through the canopy shade. The ground
// is fully buried: no deck shows.
//
// Decals: tracks -> a trampled trail (the growth flattened, mud showing); floor_hatch -> a glowing
// pool; blast/scorch -> burnt growth.
// "obstruction" terrain (outside the play area) -> the ship's bulkhead, smothered in moss and vines
// that spill over its edge.
//
// Every layer has its own random stream, so a slider changes only its own layer.

import { PyRandom } from "../../rng.js?v=88bb8aa766";
import { newImage, Draw, alphaComposite, gaussianBlur, u8 } from "../../raster.js?v=88bb8aa766";
import { centre, imageSize } from "../geometry.js?v=88bb8aa766";
import { ZONE_SETTINGS, withDefaults, keeper, extras, drawAllZones } from "../common.js?v=88bb8aa766";
import { wallMask } from "./tunnel.js?v=88bb8aa766";

const SOIL = [15, 18, 14];
const MOSS = [30, 42, 25];
const HOLLOW = [7, 9, 8];
const MUD = [46, 38, 28];
const STEEL = [36, 39, 42];
const GLOW = { teal: [70, 255, 215], violet: [185, 105, 255], lime: [175, 255, 95] };

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// --- speed ----------------------------------------------------------------------------------------------
// This style needn't match a Python tool, so it uses its own cheaper noise, blur and grain (the shared
// Pillow-exact ones made a map take ~18 s).

// value noise in 0..1: random grids, bilinear with smoothstep, `octaves` halving in size; with a
// `mask` (an L layer's data) only where it is set
function vnoise(h, w, scale, seed, octaves = 3, mask = null) {
  const out = new Float32Array(w * h), r = new PyRandom(seed);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const c = Math.max(2, scale / 2 ** o), gw = Math.ceil(w / c) + 2, gh = Math.ceil(h / c) + 2;
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = r.random();
    const fx = new Int32Array(w), tx = new Float32Array(w);
    for (let x = 0; x < w; x++) { const u = x / c; fx[x] = Math.floor(u); const t = u - fx[x]; tx[x] = t * t * (3 - 2 * t); }
    for (let y = 0; y < h; y++) {
      const v = y / c, gy = Math.floor(v), t = v - gy, ty = t * t * (3 - 2 * t), r0 = gy * gw, r1 = r0 + gw, row = y * w;
      for (let x = 0; x < w; x++) {
        if (mask && !mask[row + x]) continue;
        const i = fx[x], s = tx[x];
        const a = grid[r0 + i] + (grid[r0 + i + 1] - grid[r0 + i]) * s, b = grid[r1 + i] + (grid[r1 + i + 1] - grid[r1 + i]) * s;
        out[row + x] += (a + (b - a) * ty) * amp;
      }
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

// per-pixel grain, roughly normal with sd 1, from a hash (no random stream to step)
function grain(p, seed) {
  let x = Math.imul(p ^ seed, 0x9e3779b1); x ^= x >>> 15; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13;
  const a = (x & 0xffff) / 65536, b = (x >>> 16) / 65536;
  return (a + b - 1) * 2.45;
}

// Gaussian-ish blur of an L layer, only over the part that has anything in it; wide blurs run on a
// smaller copy and are scaled back up (bilinear), which looks the same on soft light and shadow
function blurL(im, radius) {
  const { w, h, data } = im;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (data[row + x]) { a = x; break; }
    if (a < 0) continue;
    for (let x = w - 1; x >= a; x--) if (data[row + x]) { b = x; break; }
    if (a < x0) x0 = a; if (b > x1) x1 = b; if (y < y0) y0 = y; y1 = y;
  }
  const out = newImage("L", w, h);
  if (x1 < 0) return out;
  const pad = Math.ceil(radius * 3) + 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const k = Math.max(1, Math.min(8, Math.floor(radius / 2))), cw = Math.ceil((x1 - x0 + 1) / k), ch = Math.ceil((y1 - y0 + 1) / k);
  if (k === 1) {                                                             // small: blur the crop as is
    const crop = newImage("L", cw, ch);
    for (let y = y0; y <= y1; y++) crop.data.set(data.subarray(y * w + x0, y * w + x1 + 1), (y - y0) * cw);
    const bl = gaussianBlur(crop, radius).data;
    for (let y = y0; y <= y1; y++) out.data.set(bl.subarray((y - y0) * cw, (y - y0 + 1) * cw), y * w + x0);
    return out;
  }
  const small = newImage("L", cw, ch), sum = new Float32Array(cw * ch), cnt = new Float32Array(cw * ch);
  const col = new Int32Array(x1 - x0 + 1);
  for (let x = x0; x <= x1; x++) col[x - x0] = Math.trunc((x - x0) / k);
  for (let y = y0; y <= y1; y++) {
    const r = Math.trunc((y - y0) / k) * cw, row = y * w + x0;
    for (let i = 0; i < col.length; i++) { sum[r + col[i]] += data[row + i]; cnt[r + col[i]]++; }
  }
  for (let i = 0; i < sum.length; i++) small.data[i] = Math.round(sum[i] / cnt[i]);
  const bl = gaussianBlur(small, radius / k).data;
  const n = x1 - x0 + 1, c0 = new Int32Array(n), c1 = new Int32Array(n), tx = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.min(cw - 1, Math.max(0, (i + 0.5) / k - 0.5)), g = Math.floor(u);
    c0[i] = g; c1[i] = Math.min(cw - 1, g + 1); tx[i] = u - g;
  }
  for (let y = y0; y <= y1; y++) {
    const v = Math.min(ch - 1, Math.max(0, (y - y0 + 0.5) / k - 0.5)), g = Math.floor(v), ty = v - g;
    const r0 = g * cw, r1 = Math.min(ch - 1, g + 1) * cw, row = y * w + x0;
    for (let i = 0; i < n; i++) {
      const a = bl[r0 + c0[i]] + (bl[r0 + c1[i]] - bl[r0 + c0[i]]) * tx[i], b = bl[r1 + c0[i]] + (bl[r1 + c1[i]] - bl[r1 + c0[i]]) * tx[i];
      out.data[row + i] = a + (b - a) * ty + 0.5;
    }
  }
  return out;
}

// a pointed leaf blade from its base (x, y), pointing at angle a: len long, wid wide at the widest
export function leafPts(x, y, a, len, wid, bulge = 0.4) {
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, pts = [], n = 7;
  for (let i = 0; i <= n; i++) {                                          // one side, base to tip
    const t = i / n, s = Math.sin(Math.PI * Math.pow(t, bulge + 0.3)) * wid / 2;
    pts.push([x + ux * len * t + nx * s, y + uy * len * t + ny * s]);
  }
  for (let i = n - 1; i > 0; i--) {                                       // the other side, back
    const t = i / n, s = Math.sin(Math.PI * Math.pow(t, bulge + 0.3)) * wid / 2;
    pts.push([x + ux * len * t - nx * s, y + uy * len * t - ny * s]);
  }
  return pts;
}

// the two halves of a leaf, so one side can be lit and the other in shade
export function leafHalves(x, y, a, len, wid, bulge) {
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, L = [[x, y]], R = [[x, y]], n = 7;
  for (let i = 1; i <= n; i++) {
    const t = i / n, s = Math.sin(Math.PI * Math.pow(t, bulge + 0.3)) * wid / 2;
    const mx = x + ux * len * t, my = y + uy * len * t;
    L.push([mx + nx * s, my + ny * s]); R.push([mx - nx * s, my - ny * s]);
  }
  const tip = [x + ux * len, y + uy * len];
  return [[...L, tip], [...R, tip], [nx, ny]];
}

// add a glow layer (L, already blurred) in a colour, as light adds
function addLight(img, layer, rgb, k) {
  const d = img.data, g = layer.data;
  for (let p = 0; p < g.length; p++) {
    const a = g[p];
    if (!a) continue;
    const f = (a / 255) * k, i = p * 4;
    for (let c = 0; c < 3; c++) d[i + c] = u8(d[i + c] + rgb[c] * f);
  }
}

// darken by an L layer (0 = untouched, 255 = by `k`)
function darken(img, layer, k) {
  const d = img.data, g = layer.data;
  for (let p = 0; p < g.length; p++) {
    if (!g[p]) continue;
    const f = 1 - (g[p] / 255) * k, i = p * 4;
    for (let c = 0; c < 3; c++) d[i + c] = u8(d[i + c] * f);
  }
}

// --- the ground ---------------------------------------------------------------------------------------

function ground([w, h], cell) {
  const mid = vnoise(h, w, cell * 1.3, 301), fine = vnoise(h, w, cell * 0.22, 302);
  const img = newImage("RGBA", w, h);
  for (let p = 0; p < w * h; p++) {
    const t = clamp((mid[p] - 0.42) * 2.6), hol = clamp((0.4 - mid[p]) * 4);
    const f = (fine[p] - 0.5) * 16, gr = grain(p, 303) * 2.2;
    for (let k = 0; k < 3; k++) img.data[p * 4 + k] = u8(lerp(lerp(SOIL[k], MOSS[k], t), HOLLOW[k], hol) + f + gr);
    img.data[p * 4 + 3] = 255;
  }
  return img;
}

// leaf litter: small dead leaves, umber to olive, lying flat
function litter(img, cell, o) {
  const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), r = new PyRandom(311);
  const n = Math.round((w * h) / (cell * cell) * 45), keep = keeper(311, o.litter), more = extras(n, o.litter, 1311);
  const one = (g) => {
    const x = g.uniform(0, w), y = g.uniform(0, h), a = g.uniform(0, 2 * Math.PI), len = cell * g.uniform(0.05, 0.14);
    const tone = g.random(), v = g.randint(-6, 6), al = g.randint(90, 190);
    const col = tone < 0.5 ? [44 + v, 34 + v, 22 + v, al] : tone < 0.85 ? [34 + v, 40 + v, 22 + v, al] : [58 + v, 46 + v, 28 + v, al];
    return () => d.polygon(leafPts(x, y, a, len, len * 0.45), col);
  };
  for (let i = 0; i < n; i++) { const f = one(r); if (keep(i)) f(); }
  for (let i = 0; i < more.count; i++) one(more.rng)();
  return alphaComposite(img, over);
}

// roots: meandering, tapering, lit on top; some carry glowing veins (into `veins`)
function roots(img, cell, o, veins) {
  const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), sh = newImage("L", w, h), sd = new Draw(sh);
  const vd = new Draw(veins), r = new PyRandom(321);
  const n = Math.round((w * h) / (cell * cell) / 2.5), keep = keeper(321, o.roots), more = extras(n, o.roots, 1321);
  const one = (g) => {
    let x = g.uniform(-cell, w + cell), y = g.uniform(-cell, h + cell), a = g.uniform(0, 2 * Math.PI);
    const L = cell * g.uniform(1.2, 4.5), w0 = cell * g.uniform(0.04, 0.1), step = cell * 0.1, pts = [[x, y]];
    let da = 0;
    for (let s = 0; s < L; s += step) { da = da * 0.85 + g.uniform(-0.09, 0.09); a += da; x += Math.cos(a) * step; y += Math.sin(a) * step; pts.push([x, y]); }
    const glow = w0 > cell * 0.06 && g.random() < 0.3 * o.veins, hue = g.random();
    return () => {
      for (let i = 0; i < pts.length - 1; i++) {
        const t = i / pts.length, wd = Math.max(2, Math.round(w0 * (1 - t * 0.8)));
        const [p, q] = [pts[i], pts[i + 1]];
        sd.line([[p[0] + wd * 0.6, p[1] + wd * 0.8], [q[0] + wd * 0.6, q[1] + wd * 0.8]], 200, wd + 2);
        d.line([p, q], [36, 29, 22, 255], wd);
        d.line([[p[0] - wd * 0.2, p[1] - wd * 0.25], [q[0] - wd * 0.2, q[1] - wd * 0.25]], [62, 52, 40, 255], Math.max(1, Math.round(wd * 0.35)));
        if (glow && t < 0.8) vd.line([[p[0] - wd * 0.1, p[1] - wd * 0.1], [q[0] - wd * 0.1, q[1] - wd * 0.1]], hue < 0.65 ? 255 : 254, Math.max(1, Math.round(wd * 0.2)));
      }
    };
  };
  for (let i = 0; i < n; i++) { const f = one(r); if (keep(i)) f(); }
  for (let i = 0; i < more.count; i++) one(more.rng)();
  darken(img, blurL(sh, cell * 0.04), 0.5);
  return alphaComposite(img, over);
}

// --- decals -----------------------------------------------------------------------------------------

// a trampled trail between two hex centres: a meandering band of mud and flattened leaves.
// Returns the trail's mask too (L), so the undergrowth stays off it.
function trail(img, a, b, cell, seed, mask) {
  const [ax, ay] = centre(a[0], a[1], cell), [bx, by] = centre(b[0], b[1], cell);
  const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
  const r = new PyRandom(seed), m = newImage("L", img.w, img.h), md = new Draw(m);
  const ph1 = r.uniform(0, 6.3), ph2 = r.uniform(0, 6.3), pts = [];
  for (let t = -cell * 0.4; t <= L + cell * 0.4; t += cell * 0.08) {
    const off = Math.sin(t / (cell * 2.3) + ph1) * cell * 0.22 + Math.sin(t / (cell * 0.9) + ph2) * cell * 0.07;
    pts.push([ax + ux * t + nx * off, ay + uy * t + ny * off]);
  }
  for (const [x, y] of pts) { const rr = cell * r.uniform(0.3, 0.38); md.ellipse([x - rr, y - rr, x + rr, y + rr], { fill: 255 }); }
  const soft = blurL(m, cell * 0.08), tex = vnoise(img.h, img.w, cell * 0.15, seed + 7, 3, soft.data);
  for (let p = 0; p < soft.data.length; p++) {
    const s = soft.data[p] / 255;
    if (!s) continue;
    const i = p * 4, v = (tex[p] - 0.5) * 22;
    for (let k = 0; k < 3; k++) img.data[i + k] = u8(lerp(img.data[i + k], MUD[k] + v, s * 0.85));
    if (s > 0.3) mask.data[p] = 255;
  }
  const over = newImage("RGBA", img.w, img.h), d = new Draw(over);           // flattened leaves pressed in
  for (let i = 0; i < pts.length * 3; i++) {
    const [x, y] = pts[r.randint(0, pts.length - 1)], ox = r.uniform(-1, 1) * cell * 0.3, oy = r.uniform(-1, 1) * cell * 0.3;
    const len = cell * r.uniform(0.06, 0.16), v = r.randint(-5, 5);
    d.polygon(leafPts(x + ox, y + oy, Math.atan2(uy, ux) + r.uniform(-0.6, 0.6), len, len * 0.4), [30 + v, 34 + v, 20 + v, r.randint(80, 160)]);
  }
  return alphaComposite(img, over);
}

// glowing pools: dark still water with a ring of glowing algae. Adds the pools to `mask`, light to `glow`.
function pools(img, hexes, cell, mask, glow, o) {
  if (!hexes.length) return img;
  const { w, h } = img, m = newImage("L", w, h), md = new Draw(m), r = new PyRandom(331);
  for (const [c, rr] of hexes) {
    const [cx, cy] = centre(c, rr, cell);
    for (let k = 0; k < 4; k++) {
      const x = cx + r.uniform(-0.25, 0.25) * cell, y = cy + r.uniform(-0.2, 0.2) * cell, s = cell * r.uniform(0.26, 0.48);
      md.ellipse([x - s, y - s * 0.85, x + s, y + s * 0.85], { fill: 255 });
    }
  }
  const soft = blurL(m, cell * 0.1), wob = vnoise(h, w, cell * 0.22, 332, 3, soft.data), rim = newImage("L", w, h);
  for (let p = 0; p < soft.data.length; p++) {
    const v = soft.data[p] + (wob[p] - 0.5) * 220;
    if (v < 110) continue;
    const i = p * 4, depth = clamp((v - 110) / 120);
    const col = [lerp(14, 4, depth), lerp(26, 12, depth), lerp(26, 16, depth)];
    for (let k = 0; k < 3; k++) img.data[i + k] = u8(col[k] + (wob[p] - 0.5) * 6);
    mask.data[p] = 255;
    if (v < 150) rim.data[p] = 255;                                          // the algae ring at the shore
  }
  const d = img.data, alg = vnoise(h, w, cell * 0.08, 333, 3, rim.data);                   // the algae itself: patchy pale cyan
  for (let p = 0; p < rim.data.length; p++) {
    const a = rim.data[p] ? clamp((alg[p] - 0.4) * 3) * Math.min(1, o.glow) : 0;
    rim.data[p] = Math.round(a * 255);
    if (a) for (let k = 0; k < 3; k++) d[p * 4 + k] = u8(lerp(d[p * 4 + k], [40, 105, 95][k], a * 0.55));
  }
  const gl = blurL(rim, cell * 0.12);
  for (let p = 0; p < gl.data.length; p++) glow.teal.data[p] = Math.max(glow.teal.data[p], gl.data[p]);
  return img;
}

// --- the undergrowth ------------------------------------------------------------------------------------

// Two tiers of plants, each with its own soft shadow: low ferns, then taller broad leaves above them.
// Plants don't grow on the trails and pools (`clear`) nor deep inside the bulkhead (`wall`, blurred mask).
export const lit = (nx, ny) => clamp(0.5 - (nx + ny) * 0.35);                    // light from the north-west
export const tint = (base, f) => [...base.map((v) => u8(v * f)), 255];

// a fern frond: a curling rib with paired leaflets shrinking toward the tip
export function fern(d, sd, x, y, a, len, curl, base, off, leaf = 0.2, sweep = 1.0, slim = 0.38) {
  const n = 11, step = len / n, rib = [[x, y]];
  let px = x, py = y;
  for (let i = 1; i <= n; i++) { const an = a + curl * (i / n); px += Math.cos(an) * step; py += Math.sin(an) * step; rib.push([px, py]); }
  const leaflets = [];
  for (let i = 1; i < n; i++) {
    const t = i / n, an = a + curl * t, lf = len * leaf * (1 - t * 0.75);
    for (const side of [1, -1]) leaflets.push([rib[i][0], rib[i][1], an + side * sweep, lf, side]);
  }
  for (const [lx, ly, la, lf] of leaflets) sd.polygon(leafPts(lx + off, ly + off * 1.3, la, lf, lf * slim), 255);
  for (const [lx, ly, la, lf] of leaflets) {
    const nx = Math.cos(la), ny = Math.sin(la);
    d.polygon(leafPts(lx, ly, la, lf, lf * slim), tint(base, 0.7 + lit(-nx, -ny) * 0.7));
  }
  d.line(rib, tint(base, 1.4), Math.max(1, Math.round(len * 0.02)));
}

// a broad leaf: two-tone halves, a pale midrib and side veins
export function broadLeaf(d, sd, x, y, a, len, wid, base, off) {
  sd.polygon(leafPts(x + off, y + off * 1.3, a, len, wid, 0.25), 255);
  const [L, R, [nx, ny]] = leafHalves(x, y, a, len, wid, 0.25), f = lit(nx, ny);
  d.polygon(L, tint(base, 0.72 + f * 0.65));
  d.polygon(R, tint(base, 0.72 + (1 - f) * 0.65));
  const ux = Math.cos(a), uy = Math.sin(a), lw = Math.max(1, Math.round(len * 0.012)), vein = tint(base, 1.35);
  d.line([[x, y], [x + ux * len * 0.92, y + uy * len * 0.92]], tint(base, 1.6), Math.max(1, Math.round(len * 0.02)));
  for (let t = 0.2; t < 0.85; t += 0.14)
    for (const s of [1, -1]) {
      const mx = x + ux * len * t, my = y + uy * len * t, an = a + s * 0.85, vl = wid * 0.42 * Math.sin(Math.PI * t);
      d.line([[mx, my], [mx + Math.cos(an) * vl, my + Math.sin(an) * vl]], vein, lw);
    }
}

// Two tiers of plants, each with its own soft shadow: low ferns, then broad leaves above them. Plants
// gather in thickets (a slow noise field) and leave open floor between. They don't grow on trails and
// pools (`clear`) nor deep inside the bulkhead (`wall`, its blurred mask).
function undergrowth(img, cell, o, clear, wall, glow) {
  const { w, h } = img;
  // per = plants per hex-cell area at 100%; open = how much of the floor the thickets leave bare
  // (above 100% a slider also closes those gaps, so the top of the range is a solid green mat)
  const tiers = [
    { seed: 371, set: "groundcover", per: 5, kind: "sprig", fronds: [3, 6], len: [0.08, 0.2], col: [[16, 30, 17], [30, 50, 26]], sh: 0.45, off: 0.025, open: 0.05 },
    { seed: 341, set: "undergrowth", per: 2.0, kind: "fern", fronds: [4, 8], len: [0.35, 0.75], col: [[18, 36, 20], [34, 62, 32]], sh: 0.6, off: 0.05, open: 0.22 },
    { seed: 351, set: "undergrowth", per: 0.7, kind: "broad", fronds: [1, 4], len: [0.3, 0.7], col: [[22, 46, 28], [44, 80, 42]], sh: 0.7, off: 0.09, open: 0.22 },
    { seed: 381, set: "palms", per: 0.25, kind: "palm", fronds: [5, 8], len: [0.8, 1.5], col: [[18, 38, 19], [38, 64, 30]], sh: 0.75, off: 0.14, open: 0.3 },
  ];
  const thicket = vnoise(h, w, cell * 2.4, 340);
  const podR = new PyRandom(361), keepP = keeper(361, o.pods);
  let podI = 0;
  for (const T of tiers) {
    const dens = o[T.set], boost = Math.max(0, dens - 1) * 0.35;
    if (!dens) { if (T.kind === "fern") img = pods(img, cell, o, podR, keepP, () => podI++, clear, glow); continue; }
    const r = new PyRandom(T.seed), n = Math.round((w * h) / (cell * cell) * T.per);
    const keep = keeper(T.seed, dens), more = extras(n, dens, T.seed + 1000);
    const sh = newImage("L", w, h), sd = new Draw(sh), over = newImage("RGBA", w, h), d = new Draw(over);
    const radial = T.kind === "fern" || T.kind === "palm";
    const one = (g) => {
      const x = g.uniform(0, w), y = g.uniform(0, h), k = g.randint(T.fronds[0], T.fronds[1]), a0 = g.uniform(0, 2 * Math.PI);
      const shade = g.random(), roll = g.random(), blades = [];
      for (let i = 0; i < k; i++) {
        const a = a0 + (radial ? (i / k) * 2 * Math.PI : 0) + g.uniform(-0.35, 0.35) * (radial ? 1 : 4), len = cell * g.uniform(T.len[0], T.len[1]);
        blades.push([a, len, g.uniform(-0.5, 0.5) * (T.kind === "palm" ? 0.4 : 1), len * g.uniform(0.38, 0.55)]);
      }
      return () => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const p = Math.trunc(y) * w + Math.trunc(x);
        if (clear.data[p] || wall.data[p] > 200 || roll > clamp((thicket[p] - T.open + boost) * 2.6)) return;
        const base = T.col[0].map((v, c) => lerp(v, T.col[1][c], shade)), off = cell * T.off;
        for (const [a, len, curl, wid] of blades)
          if (T.kind === "fern") fern(d, sd, x, y, a, len, curl, base, off);
          else if (T.kind === "palm") fern(d, sd, x, y, a, len, curl, base, off, 0.3, 0.7, 0.28);
          else if (T.kind === "broad") broadLeaf(d, sd, x, y, a, len, wid, base, off);
          else {                                                             // a sprig: a few small leaves, no veins
            sd.polygon(leafPts(x + off, y + off * 1.3, a, len, len * 0.5), 255);
            d.polygon(leafPts(x, y, a, len, len * 0.5), tint(base, 0.75 + lit(-Math.cos(a), -Math.sin(a)) * 0.6));
          }
      };
    };
    for (let i = 0; i < n; i++) { const f = one(r); if (keep(i)) f(); }
    for (let i = 0; i < more.count; i++) one(more.rng)();
    darken(img, blurL(sh, cell * T.off), T.sh);
    img = alphaComposite(img, over);
    // mutant pods and fungus caps nestle under the ferns
    if (T.kind === "fern") img = pods(img, cell, o, podR, keepP, () => podI++, clear, glow);
  }
  return img;
}

// swollen pods and fungus caps, violet and teal, in small clusters; some glow
function pods(img, cell, o, r, keep, next, clear, glow) {
  const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over);
  const sh = newImage("L", w, h), sd = new Draw(sh), gd = { teal: new Draw(glow.teal), violet: new Draw(glow.violet), lime: new Draw(glow.lime) };
  const n = Math.round((w * h) / (cell * cell) * 0.22), more = extras(n, o.pods, 1361);
  const one = (g, i) => {
    const x = g.uniform(0, w), y = g.uniform(0, h), k = g.randint(3, 9), hue = g.choice(["teal", "teal", "violet", "lime"]);
    const shines = g.random() < 0.55, bright = g.randint(90, 255), caps = [];
    for (let j = 0; j < k; j++) caps.push([x + g.uniform(-1, 1) * cell * 0.18, y + g.uniform(-1, 1) * cell * 0.18, cell * g.uniform(0.025, 0.07)]);
    return () => {
      if (i !== null && !keep(i)) return;
      const p = Math.trunc(clamp(y, 0, h - 1)) * w + Math.trunc(clamp(x, 0, w - 1));
      if (clear.data[p]) return;
      const body = hue === "violet" ? [62, 30, 84] : hue === "teal" ? [22, 70, 66] : [58, 78, 26];
      const hi = GLOW[hue].map((v) => u8(v * 0.85));
      for (const [cx, cy, s] of caps) sd.ellipse([cx - s + s * 0.4, cy - s + s * 0.5, cx + s + s * 0.4, cy + s + s * 0.5], { fill: 255 });
      for (const [cx, cy, s] of caps) {
        d.ellipse([cx - s, cy - s, cx + s, cy + s], { fill: [...body, 255] });
        if (shines) d.ellipse([cx - s * 0.55, cy - s * 0.6, cx + s * 0.25, cy + s * 0.2], { fill: [...hi, 255] });
        if (shines) gd[hue].ellipse([cx - s * 2.2, cy - s * 2.2, cx + s * 2.2, cy + s * 2.2], { fill: bright });
      }
    };
  };
  for (let i = 0; i < n; i++) one(r, next())();
  for (let i = 0; i < more.count; i++) one(more.rng, null)();
  darken(img, blurL(sh, cell * 0.02), 0.6);
  return alphaComposite(img, over);
}

// --- the bulkhead --------------------------------------------------------------------------------------

// the ship's wall: dark panelled steel with ribs and rivets, an embossed lit edge, a shadow cast onto
// the jungle, and moss and vines creeping over it from the edge
function bulkhead(img, solid, data, cell, o, glow) {
  const { w, h } = img;
  const { m } = wallMask([w, h], solid, data, cell);
  const b = blurL(m, cell * 0.03), far = blurL(m, cell * 0.45);
  const tex = vnoise(h, w, cell * 0.5, 371, 3, b.data), d = img.data;
  const sh = newImage("L", w, h), off = Math.round(cell * 0.14);              // the cast shadow, down-right
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x - off, sy = y - Math.round(off * 1.2);
    if (sx >= 0 && sy >= 0 && m.data[sy * w + sx]) sh.data[y * w + x] = 255;
  }
  darken(img, blurL(sh, cell * 0.18), 0.75);
  const pw = cell * 1.5, ph = cell * 0.65;                                    // plates
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (b.data[p] < 128) continue;
    const i = p * 4, gx = (b.data[p + (x < w - 1 ? 1 : 0)] - b.data[p - (x > 0 ? 1 : 0)]), gy = (b.data[p + (y < h - 1 ? w : 0)] - b.data[p - (y > 0 ? w : 0)]);
    const bevel = clamp((gx + gy) * 0.9, -40, 40);                            // lit on the north-west faces
    const row = Math.floor(y / ph), px = (x + (row % 2) * pw * 0.5) % pw, py = y % ph;
    const seam = px < 3 || py < 3 ? -18 : px < 5 || py < 5 ? 6 : 0;
    const rib = (x % (cell * 3)) < cell * 0.12 ? 10 : 0;
    const t = (tex[p] - 0.5) * 16, gr = grain(p, 372) * 2;
    for (let k = 0; k < 3; k++) d[i + k] = u8(STEEL[k] + seam + rib + t + bevel + gr);
  }
  const dr = new Draw(img), rr = Math.max(2, cell * 0.018);                   // rivets along the plate rows
  for (let y = ph / 2; y < h; y += ph) for (let x = cell * 0.2; x < w; x += cell * 0.3)
    if (m.data[Math.trunc(y) * w + Math.trunc(x)] && b.data[Math.trunc(y) * w + Math.trunc(x)] > 200) {
      dr.ellipse([x - rr, y - rr, x + rr, y + rr], { fill: [26, 28, 30, 255] });
      dr.ellipse([x - rr * 0.6, y - rr * 0.7, x + rr * 0.2, y + rr * 0.1], { fill: [76, 80, 84, 255] });
    }
  // moss, thickest at the edge and in patches across the plates
  const mn = vnoise(h, w, cell * 0.45, 381, 3, b.data), mf = vnoise(h, w, cell * 0.1, 382, 3, b.data);
  for (let p = 0; p < w * h; p++) {
    if (b.data[p] < 110) continue;
    const edge = 1 - clamp((far.data[p] - 128) / 127);                         // 1 at the edge, 0 deep inside
    const v = mn[p] * 0.7 + mf[p] * 0.3 + edge * 0.45 * o.overgrowth - (1 - o.overgrowth) * 0.4;
    if (v < 0.62) continue;
    const s = clamp((v - 0.62) * 6), i = p * 4, f = (mf[p] - 0.5) * 30;
    for (let k = 0; k < 3; k++) d[i + k] = u8(lerp(d[i + k], [26, 44, 24][k] + f, s));
  }
  // vines from the edge across the wall, with leaves
  const over = newImage("RGBA", w, h), vd = new Draw(over), r = new PyRandom(391), gl = new Draw(glow.lime);
  const n = Math.round(solid.size * 1.4), keep = keeper(391, o.overgrowth), more = extras(n, o.overgrowth, 1391);
  const keys = [...solid];
  const one = (gg) => {
    const [c, rw] = keys[gg.randint(0, keys.length - 1)].split(",").map(Number), [cx, cy] = centre(c, rw, cell);
    let x = cx + gg.uniform(-0.5, 0.5) * cell, y = cy + gg.uniform(-0.5, 0.5) * cell, a = gg.uniform(0, 2 * Math.PI);
    const pts = [[x, y]], L = cell * gg.uniform(0.8, 2.6), leaves = [], shines = gg.random() < 0.25;
    for (let s = 0; s < L; s += cell * 0.06) {
      a += gg.uniform(-0.4, 0.4); x += Math.cos(a) * cell * 0.06; y += Math.sin(a) * cell * 0.06; pts.push([x, y]);
      if (gg.random() < 0.35) leaves.push([x, y, a + (gg.random() < 0.5 ? 1 : -1) * gg.uniform(0.6, 1.3), cell * gg.uniform(0.05, 0.11)]);
    }
    return () => {
      vd.line(pts, [20, 30, 16, 255], Math.max(2, Math.round(cell * 0.018)));
      for (const [lx, ly, la, ll] of leaves) vd.polygon(leafPts(lx, ly, la, ll, ll * 0.55), [36, 62, 32, 255]);
      if (shines) for (const [lx, ly] of leaves.slice(0, 3)) gl.ellipse([lx - cell * 0.03, ly - cell * 0.03, lx + cell * 0.03, ly + cell * 0.03], { fill: 200 });
    };
  };
  for (let i = 0; i < n; i++) { const f = one(r); if (keep(i)) f(); }
  for (let i = 0; i < more.count; i++) one(more.rng)();
  return { img: alphaComposite(img, over), wall: far };
}

// burnt growth: charred ground and ash around each hex, broken up by noise, only near the burn
function burn(img, hexes, cell) {
  const { w, h } = img, d = img.data, R = cell * 0.95;
  for (const [c, r] of hexes) {
    const [cx, cy] = centre(c, r, cell), x0 = Math.max(0, Math.floor(cx - R * 1.4)), x1 = Math.min(w - 1, Math.ceil(cx + R * 1.4));
    const y0 = Math.max(0, Math.floor(cy - R * 1.4)), y1 = Math.min(h - 1, Math.ceil(cy + R * 1.4));
    const bw = x1 - x0 + 1, n = vnoise(y1 - y0 + 1, bw, cell * 0.35, 431 + c * 97 + r);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dist = Math.hypot(x - cx, y - cy) / R, nv = n[(y - y0) * bw + (x - x0)];
      const s = clamp((1 - dist) * 1.6 + (nv - 0.5) * 1.4);
      if (!s) continue;
      const p = y * w + x, i = p * 4, gr = grain(p, 433) * 2.5, grey = (d[i] + d[i + 1] + d[i + 2]) / 3;
      const char = [14 + gr, 12 + gr, 10 + gr];                               // charred, the growth's colour burnt out
      for (let k = 0; k < 3; k++) d[i + k] = u8(lerp(lerp(d[i + k], grey * 0.6, s), char[k], s * 0.75));
    }
  }
  return img;
}

// --- light ------------------------------------------------------------------------------------------------

// canopy shade: darker hollows, paler gaps where light gets through
function canopy(img, cell, o) {
  if (!o.shade) return img;
  const { w, h } = img, big = vnoise(h, w, cell * 4.5, 401), d = img.data;
  for (let p = 0; p < w * h; p++) {
    const f = lerp(1, 0.55 + big[p] * 0.8, o.shade), i = p * 4;
    for (let k = 0; k < 3; k++) d[i + k] = u8(d[i + k] * f);
  }
  return img;
}

// spores: tiny drifting motes, a few of them glowing
function spores(img, cell, o, glow) {
  const { w, h } = img, d = new Draw(img), r = new PyRandom(411);
  const n = Math.round((w * h) / (cell * cell) * 1.6), keep = keeper(411, o.spores), more = extras(n, o.spores, 1411);
  const gd = { teal: new Draw(glow.teal), violet: new Draw(glow.violet), lime: new Draw(glow.lime) };
  const one = (g) => {
    const x = g.uniform(0, w), y = g.uniform(0, h), s = cell * g.uniform(0.005, 0.014), hue = g.choice(["teal", "teal", "violet", "lime"]);
    return () => {
      d.ellipse([x - s, y - s, x + s, y + s], { fill: [...GLOW[hue].map((v) => u8(v * 0.7)), 255] });
      gd[hue].ellipse([x - s * 4, y - s * 4, x + s * 4, y + s * 4], { fill: 110 });
    };
  };
  for (let i = 0; i < n; i++) { const f = one(r); if (keep(i)) f(); }
  for (let i = 0; i < more.count; i++) one(more.rng)();
  return img;
}

// --- the base map -----------------------------------------------------------------------------------------

export const name = "Overgrown Jungle";
export const blurb = "A dark jungle floor under a closed canopy: loam, leaf litter, roots, ferns and broad leaves, mutant pods, and bioluminescent fungus, veins and spores glowing in the shade. Solid structure is a bulkhead smothered in moss and vines.";
export const decals = ["tracks", "blast", "scorch", "floor_hatch"];
export const terrainNote = "Overgrown Jungle draws it as the ship's bulkhead: panelled steel, moss and vines creeping over it, plants spilling over its edge.";
export const tools = {
  tracks: { label: "Trampled trail", hint: "Click the start hex, then the end hex: a meandering trail of mud and flattened growth, kept clear of plants." },
  hatch: { label: "Glowing pool", hint: "Dark still water ringed with glowing algae; neighbouring pool hexes join into one pool." },
  breach: { label: "Burnt growth", hint: "Click a hex: scorched, burnt-off growth." },
};
export const settings = [
  { id: "litter", label: "Leaf litter", group: "Ground", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "roots", label: "Roots", group: "Ground", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "groundcover", label: "Ground cover", group: "Plants", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
  { id: "undergrowth", label: "Ferns and leaves", group: "Plants", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
  { id: "palms", label: "Palm fronds", group: "Plants", type: "range", min: 0, max: 3, step: 0.05, default: 0.5 },
  { id: "pods", label: "Mutant pods and fungus (0 = none)", group: "Plants", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "overgrowth", label: "Moss and vines (on painted bulkheads)", group: "Plants", type: "range", min: 0, max: 1.5, step: 0.05, default: 1 },
  { id: "shade", label: "Canopy shade", group: "Light", type: "range", min: 0, max: 1.5, step: 0.05, default: 1 },
  { id: "glow", label: "Bioluminescence (0 = a plain jungle)", group: "Light", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "veins", label: "Glowing root veins", group: "Light", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "spores", label: "Spores", group: "Light", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  ...ZONE_SETTINGS,
];

export function render(data, cell, opts = {}) {
  const o = withDefaults(settings, opts);
  const [w, h] = imageSize(data.cols, data.rows, cell);
  const zones = data.zones || {};
  const glow = { teal: newImage("L", w, h), violet: newImage("L", w, h), lime: newImage("L", w, h) };
  const veins = newImage("L", w, h), clear = newImage("L", w, h);
  let img = ground([w, h], cell);
  img = litter(img, cell, o);
  img = roots(img, cell, o, veins);
  (data.decals || []).filter((d) => d.type === "tracks").forEach((dec, i) => { img = trail(img, dec.from, dec.to, cell, 421 + i * 10, clear); });
  const hexOf = (dec) => (dec.hexes || (dec.zone && zones[dec.zone] ? zones[dec.zone].hexes : [])).map((k) => (typeof k === "string" ? k.split(",").map(Number) : k));
  const pool = (data.decals || []).filter((d) => d.type === "floor_hatch").flatMap(hexOf);
  img = pools(img, pool, cell, clear, glow, o);
  const solid = new Set(Object.entries(data.terrain || {}).filter(([, v]) => v === "obstruction").map(([k]) => k));
  let wall = newImage("L", w, h);
  if (solid.size) ({ img, wall } = bulkhead(img, solid, data, cell, o, glow));
  img = undergrowth(img, cell, o, clear, wall, glow);
  for (const dec of data.decals || []) if (dec.type === "blast" || dec.type === "scorch") img = burn(img, hexOf(dec), cell);
  img = canopy(img, cell, o);
  img = spores(img, cell, o, glow);
  // the veins: a thin bright line plus a soft halo, split between teal (255) and violet (254)
  const vt = newImage("L", w, h), vv = newImage("L", w, h);
  for (let p = 0; p < veins.data.length; p++) { if (veins.data[p] === 255) vt.data[p] = 255; else if (veins.data[p] === 254) vv.data[p] = 255; }
  if (o.glow) {
    addLight(img, blurL(glow.teal, cell * 0.1), GLOW.teal, 0.55 * o.glow);
    addLight(img, blurL(glow.violet, cell * 0.1), GLOW.violet, 0.55 * o.glow);
    addLight(img, blurL(glow.lime, cell * 0.1), GLOW.lime, 0.45 * o.glow);
    addLight(img, blurL(glow.teal, cell * 0.35), GLOW.teal, 0.25 * o.glow);
    addLight(img, blurL(glow.violet, cell * 0.35), GLOW.violet, 0.25 * o.glow);
    addLight(img, vt, GLOW.teal, 0.35 * o.glow);
    addLight(img, vv, GLOW.violet, 0.35 * o.glow);
    addLight(img, blurL(vt, cell * 0.06), GLOW.teal, 0.4 * o.glow);
    addLight(img, blurL(vv, cell * 0.06), GLOW.violet, 0.4 * o.glow);
  }
  return drawAllZones(img, zones, cell, o);
}

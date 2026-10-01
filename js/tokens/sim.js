// Objective and area tokens for the second training sim (the bomb run, 2026-10-01): the Size 1 bomb the
// lance escorts, and half-transparent blast areas (Blast 1, 2, 3) to lay over the map where a bombardment,
// a mine or a grenade goes off. Both are style-neutral, so they sit on any map.
//
// The bomb is ray-traced like the Depot's pipes (trace() in depot.js), with an axis-aligned box primitive
// added here for the fins and the cradle. The blast areas are the exact hex footprint of the Blast (a hex
// and its rings), filled with fire that fades from a hot core to a smoky rim, with the outer edge drawn.

import { newImage, Draw } from "../raster.js";
import { geometry, hexPoints } from "../maps/geometry.js";
import { maskOf } from "../maps/common.js";
import { tokenCanvas, grime } from "./kit.js";
import { groundShadow } from "./shadow.js";
import { layerFor, trace, cylinder, sphere, onCyl, mottle, sh } from "./depot.js";

const K = 0.85;   // the kit's view: a point (x, y, z) shows at (x, y - K z); must match depot.js

// An axis-aligned box from (x0, y0, z0) to (x1, y1, z1), for trace(). The nearest hit is the largest t.
function box([x0, y0, z0], [x1, y1, z1], info = {}) {
  return { ...info, box: [x0, y0 - K * z1, x1, y1 - K * z0], hit(sx, sy) {
    if (sx < x0 || sx > x1) return null;
    const ty = [y0 - sy, y1 - sy], tz = [z0 * K, z1 * K];
    const lo = Math.max(ty[0], tz[0]), hi = Math.min(ty[1], tz[1]);
    if (lo > hi) return null;
    return { t: hi, n: hi === ty[1] ? [0, 1, 0] : [0, 0, 1] };
  } };
}

// --- the bomb ----------------------------------------------------------------------------------------------

const DRAB = [104, 112, 78], DRAB_DARK = [78, 86, 60], BAND = [218, 176, 62], STEEL = [64, 68, 74];

// An olive-drab bomb lying east-west on a skid cradle: an ogive nose to the east, a tapered tail with four
// fins and a ring to the west, yellow bands (high explosive), and a small arming panel with a red lamp.
function tokenBomb(cell) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, [cx, cy0] = cs[0], c = cell;
  const cy = cy0 + c * 0.06, R = c * 0.15, zc = R + c * 0.07;
  const xt = cx - c * 0.26, xn = cx + c * 0.2;                                   // body from the tail joint to the nose joint
  const shapes = [];
  // cradle: two runners and two saddles
  for (const s of [-1, 1]) shapes.push(box([cx - c * 0.3, cy + s * R * 0.85 - c * 0.025, 0], [cx + c * 0.28, cy + s * R * 0.85 + c * 0.025, c * 0.035], { kind: "cradle" }));
  for (const x of [cx - c * 0.15, cx + c * 0.1]) shapes.push(box([x - c * 0.03, cy - R * 0.9, 0], [x + c * 0.03, cy + R * 0.9, zc - R * 0.55], { kind: "cradle" }));
  // body, nose, tail cone
  shapes.push(cylinder([xt, cy, zc], [xn, cy, zc], R, { kind: "body" }));
  const NOSE = c * 0.2, TAIL = c * 0.13;
  for (let i = 0; i <= 40; i++) {
    const f = i / 40, r = R * Math.sqrt(Math.max(0, 1 - f * f)) ;
    if (r > R * 0.06) shapes.push(sphere([xn + f * NOSE * 0.92, cy, zc], r, { kind: "nose" }));
  }
  for (let i = 0; i <= 30; i++) {                                              // the tail cone, tapering to the ring
    const f = i / 30;
    shapes.push(cylinder([xt - (f + 1 / 30) * TAIL, cy, zc], [xt - f * TAIL, cy, zc], R * (1 - 0.55 * f), { kind: "tail" }));
  }
  // swept fins (+ shape: one up, two out to the sides; stepped boxes, tall at the trailing edge) and the ring
  const fx0 = xt - TAIL - c * 0.02, flen = c * 0.16, th = c * 0.011, span = R * 1.35, STEPS = 10;
  for (let k = 0; k < STEPS; k++) {
    const x1 = fx0 + flen * (1 - k / STEPS), s = R * 0.45 + (span - R * 0.45) * ((k + 1) / STEPS);
    shapes.push(box([fx0, cy - th, zc], [x1, cy + th, zc + s], { kind: "fin" }));
    shapes.push(box([fx0, cy - s, zc - th], [x1, cy + s, zc + th], { kind: "fin" }));
  }
  shapes.push(cylinder([fx0, cy, zc], [fx0 + c * 0.035, cy, zc], R * 0.5, { kind: "ring" }));
  // arming panel and lamp on top
  shapes.push(box([cx - c * 0.07, cy - R * 0.32, zc + R * 0.86], [cx + c * 0.03, cy + R * 0.32, zc + R * 1.04], { kind: "panel" }));
  shapes.push(sphere([cx + c * 0.065, cy, zc + R * 0.98], c * 0.022, { kind: "lamp", gloss: 0.9 }));

  const bandAt = (x) => Math.abs(x - (xn - c * 0.035)) < c * 0.022 || Math.abs(x - (xt + c * 0.05)) < c * 0.022;
  let out = trace(w, h, shapes, (sp, p, n) => {
    switch (sp.kind) {
      case "cradle": return sh(STEEL, mottle(p, 5, 0.2));
      case "fin": return sh(DRAB_DARK, mottle(p, 4, 0.25));
      case "ring": { const { cap } = onCyl(sp, p, n); return cap ? [34, 36, 30] : sh(DRAB_DARK, 0.95); }
      case "panel": return n[2] > 0.5 ? (Math.abs(p[0] - (cx - c * 0.02)) < c * 0.035 && Math.abs(p[1] - cy) < R * 0.2 ? [30, 34, 30] : [70, 74, 66]) : [52, 56, 50];
      case "lamp": return [255, 70, 50];
      case "nose": return bandAt(p[0]) ? BAND : sh(DRAB, 0.92 * mottle(p, 6, 0.18));
      case "tail": return sh(DRAB, 0.95 * mottle(p, 6, 0.18));
      default: return bandAt(p[0]) ? BAND : sh(DRAB, mottle(p, 7, 0.2));
    }
  }, { gloss: 0.35 });
  return groundShadow(grime(out, cell, 1501, 0.1), cell);
}

// --- the mine ----------------------------------------------------------------------------------------------

// A round pressure mine: a squat dark disc with a ring of bolts, a yellow-black hazard ring round a raised
// pressure plate, and a red lamp. About half a hex across, so the hex it sits in still shows.
function tokenMine(cell) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, [cx, cy0] = cs[0], c = cell, cy = cy0 + c * 0.04;
  const R = c * 0.25, H = c * 0.07, P = c * 0.1;
  const shapes = [
    cylinder([cx, cy, 0], [cx, cy, H], R, { kind: "body" }),
    cylinder([cx, cy, H], [cx, cy, H + c * 0.025], P, { kind: "plate" }),
    sphere([cx + R * 0.62, cy - R * 0.1, H], c * 0.022, { kind: "lamp", gloss: 0.9 }),
  ];
  const out = trace(w, h, shapes, (sp, p, n) => {
    if (sp.kind === "lamp") return [255, 60, 44];
    const { r, w: wv, cap } = onCyl(sp, p, n);
    if (sp.kind === "plate") return cap === 1 ? (Math.abs(r - P * 0.55) < P * 0.12 ? [44, 46, 40] : [92, 96, 84]) : [60, 62, 54];
    if (cap !== 1) return sh([58, 62, 52], mottle(p, 4, 0.2));                // the side
    const a = Math.atan2(wv[1], wv[0]);
    if (Math.abs(r - R * 0.86) < R * 0.05 && Math.abs(((a / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.38) return [150, 150, 136];   // bolts
    if (r > P * 1.1 && r < R * 0.68) return Math.floor((a + Math.PI) / (Math.PI / 6)) % 2 ? [228, 182, 52] : [28, 28, 26];   // hazard ring
    return sh([74, 78, 66], mottle(p, 5, 0.2));
  }, { gloss: 0.3 });
  return groundShadow(grime(out, cell, 1601, 0.08), cell);
}

// --- blast areas -------------------------------------------------------------------------------------------

// the hex centres of a Blast n around the anchor (the anchor first)
function blastFootprint(cell, n) {
  const [sx, sy] = geometry(cell), fp = [[0, 0]];
  for (let r = -n; r <= n; r++)
    for (let q = -n; q <= n; q++)
      if ((q || r) && Math.abs(q + r) <= n) fp.push([sx * (q + r / 2), sy * r]);
  return fp;
}

function hash2(i, j, seed) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise2(x, y, seed) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const l = (a, b, t) => a + (b - a) * t * t * (3 - 2 * t);
  return l(l(hash2(i, j, seed), hash2(i + 1, j, seed), fx), l(hash2(i, j + 1, seed), hash2(i + 1, j + 1, seed), fx), fy);
}
const fbm = (x, y, seed) => 0.55 * vnoise2(x, y, seed) + 0.3 * vnoise2(x * 2.1, y * 2.1, seed + 7) + 0.15 * vnoise2(x * 4.3, y * 4.3, seed + 13);

// fire colours from cold (0) to hot (1)
const RAMP = [[0, [40, 30, 28]], [0.3, [120, 34, 20]], [0.55, [214, 84, 26]], [0.78, [250, 168, 50]], [1, [255, 240, 190]]];
function ramp(v) {
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < RAMP.length; i++)
    if (v <= RAMP[i][0]) {
      const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], t = (v - a) / (b - a);
      return ca.map((x, k) => x + (cb[k] - x) * t);
    }
  return RAMP[RAMP.length - 1][1];
}

function tokenBlast(cell, n) {
  const fp = blastFootprint(cell, n), { img, cs } = tokenCanvas(cell, fp), { w, h } = img;
  const [ax, ay] = cs[0], [sx, , hw] = geometry(cell), reach = n * sx + hw * 0.9;
  const mask = maskOf([w, h], cs, cell), seed = 40 + n;
  const out = newImage("RGBA", w, h), sc = cell * 0.32;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const m = mask.data[y * w + x];
      if (!m) continue;
      const dx = x - ax, dy = y - ay, d = Math.min(1, Math.hypot(dx, dy) / reach), a = Math.atan2(dy, dx);
      const billow = fbm(x / sc, y / sc, seed);
      const tongues = fbm((a / Math.PI) * 5 * n + 11, d * 2.5, seed + 3);         // flame tongues reaching outward
      const heat = 1.05 * Math.pow(1 - d, 1.1) + 0.42 * (billow - 0.5) + 0.3 * (tongues - 0.5);
      const col = ramp(heat);
      const alpha = (0.42 + 0.2 * Math.max(0, heat)) * (0.85 + 0.3 * (billow - 0.5));
      const q = (y * w + x) * 4;
      out.data[q] = col[0]; out.data[q + 1] = col[1]; out.data[q + 2] = col[2];
      out.data[q + 3] = Math.round(255 * Math.min(0.75, alpha) * (m / 255));
    }
  // the outer edge of the area: hex sides that belong to only one hex of the footprint
  const key = (p) => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}`, edges = new Map();
  for (const [cx, cy] of cs) {
    const pts = hexPoints(cx, cy, cell);
    for (let i = 0; i < 6; i++) {
      const p = pts[i], q = pts[(i + 1) % 6], k = [key(p), key(q)].sort().join("|");
      const e = edges.get(k);
      if (e) e.count++; else edges.set(k, { p, q, count: 1 });
    }
  }
  const d = new Draw(out), lw = Math.max(3, Math.round(cell * 0.035));
  for (const { p, q, count } of edges.values())
    if (count === 1) d.line([p, q], [255, 120, 40, 235], lw);
  return out;
}

export const TOKENS = {
  bomb: tokenBomb,
  mine: tokenMine,
  blast_area_1: (c) => tokenBlast(c, 1),
  blast_area_2: (c) => tokenBlast(c, 2),
  blast_area_3: (c) => tokenBlast(c, 3),
};

// Ship Deck tokens (names start sd_): the furniture of an old expedition carrier's working spaces, for the
// Ship Deck map styles. Crates, lockers, barricades and pipe runs for anywhere; a maintenance gantry, a
// tool chest and an ammunition cart for the hangar; planters and mess tables for the habitat; consoles
// and a plotting table for command; a coolant pump, a valve manifold and the reactor vessel; a printer,
// feedstock drums, a workbench and stores racking for fabrication.
//
// Built from boxes, wedges and cylinders and ray traced in the kit's view (trace() in depot.js), so the
// light and the south-facing view match the other sets; lettering, screens and plants are drawn on top.
// Screens and lamps glow onto the floor round them.

import { PyRandom } from "../rng.js?v=5b84a09c26";
import { newImage, Draw, alphaCompositeAt, gaussianBlur } from "../raster.js?v=5b84a09c26";
import { geometry } from "../maps/geometry.js?v=5b84a09c26";
import { size2Footprint, grime } from "./kit.js?v=5b84a09c26";
import { groundShadow } from "./shadow.js?v=5b84a09c26";
import { layerFor, centroid, row2, sh, A, cylinder, sphere, trace, screen, mottle, chips, fine, fill, addCyl, project, tokenDrums } from "./depot.js?v=5b84a09c26";
import { broadLeaf, fern } from "../maps/styles/jungle.js?v=5b84a09c26";

const K = 0.85;
const GREY = [96, 104, 104], DARK = [52, 56, 58], YEL = [214, 170, 44], RED = [168, 44, 32], BLUE = [62, 100, 136];
const WHITE = [196, 196, 186], OLIVE = [90, 98, 72], STEEL = [128, 134, 134], ORANGE = [192, 104, 44];

// --- shapes for trace() ------------------------------------------------------------------------------------

// an upright box: ground rectangle [x0..x1] x [y0..y1], from z0 up to z1. Seen from the south, a ray meets
// its top or its south face.
function box(x0, y0, z0, x1, y1, z1, info = {}) {
  return { ...info, box: [x0, y0 - K * z1, x1, y1 - K * z0], hit(sx, sy) {
    if (sx < x0 || sx > x1) return null;
    const lo = Math.max(y0 - sy, K * z0), tS = y1 - sy, tT = K * z1;
    const t = Math.min(tS, tT);
    if (t < lo) return null;
    return { t, n: tS <= tT ? [0, 1, 0] : [0, 0, 1] };
  } };
}

// a box whose top slopes from zb at its north edge to zf at its south edge (a console's desk, a barrier)
function wedge(x0, y0, x1, y1, zb, zf, z0 = 0, info = {}) {
  const L = y1 - y0, m = (zf - zb) / L, n = [0, -m, 1], nl = Math.hypot(...n);
  return { ...info, box: [x0, y0 - K * Math.max(zb, zf), x1, y1 - K * z0], hit(sx, sy) {
    if (sx < x0 || sx > x1) return null;
    const tTop = (zb + m * (sy - y0)) / (1 / K - m), yTop = sy + tTop;
    const tS = y1 - sy, zS = tS / K;
    let best = null;
    if (zS >= z0 && zS <= zf) best = { t: tS, n: [0, 1, 0] };
    if (yTop >= y0 && yTop <= y1 && tTop / K >= z0 && (!best || tTop > best.t)) best = { t: tTop, n: n.map((v) => v / nl) };
    return best;
  } };
}

// paint: each shape's colour, with an optional pattern(p, n) on top and mottled metal
const paint = (sp, p, n) => {
  let c = sp.col;
  if (sp.pat) { const q = sp.pat(p, n); if (q) c = q; }
  return sh(c, sp.flat ? 1 : mottle(p, sp.ms || 6, sp.ma ?? 0.16));
};
const render = (lay, shapes, gloss = 0.32) => trace(lay.w, lay.h, shapes, paint, { gloss });
const S = (x, y, z) => screen(x, y, z);
const quad = (d, pts, fill, outline = null) => d.polygon(pts.map((q) => S(...q)), fill, outline ? { outline, width: 1 } : {});

// a soft coloured glow on the floor and object round some screen-space shapes (drawn into an L mask)
function glow(obj, cell, draw, col, k = 0.55, r = 0.14) {
  const m = newImage("L", obj.w, obj.h);
  draw(new Draw(m));
  const b = gaussianBlur(m, cell * r), over = newImage("RGBA", obj.w, obj.h);
  for (let p = 0; p < m.data.length; p++) {
    const a = b.data[p] * k;
    if (a < 1) continue;
    over.data[p * 4] = col[0]; over.data[p * 4 + 1] = col[1]; over.data[p * 4 + 2] = col[2]; over.data[p * 4 + 3] = Math.min(255, a);
  }
  return alphaCompositeAt(obj, over);
}

const finish = (out, cell, seed, dirt = 0.1) => groundShadow(grime(chips(out, seed, 14, cell, [30, 32, 30]), cell, seed + 1, dirt), cell);

// stencilled text centred on a south face at height z
function stencil(d, text, x, y, z, size, col, alpha = 210) {
  const tw = d.textLength(text, size, "stencil"), [sx, sy] = S(x, y, z);
  d.text([sx - tw / 2, sy - size * 0.5], text, size, A(col, alpha), { family: "stencil" });
}

// --- anywhere ---------------------------------------------------------------------------------------------------

// a steel cargo crate: the body with ribbed sides, dark corner posts, a stencil
function crateShapes(x, y, wd, dp, ht, col, z0 = 0) {
  const e = Math.max(3, wd * 0.07), shapes = [];
  shapes.push(box(x - wd / 2, y - dp / 2, z0, x + wd / 2, y + dp / 2, z0 + ht, { col, pat: (p, n) => {
    if (n[1] > 0.9) { const f = ((p[2] - z0) / ht) % 0.33; return f < 0.05 ? sh(col, 0.72) : null; }
    if (n[2] > 0.9) { const u = (p[0] - (x - wd / 2)) / wd; return Math.abs(u - 0.33) < 0.025 || Math.abs(u - 0.66) < 0.025 ? sh(col, 0.8) : null; }
    return null;
  } }));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const px = x + sx * (wd / 2 - e / 2), py = y + sy * (dp / 2 - e / 2);
    shapes.push(box(px - e / 2 - 1, py - e / 2 - 1, z0, px + e / 2 + 1, py + e / 2 + 1, z0 + ht + 1.5, { col: DARK }));
  }
  return shapes;
}

function tokenCrate(cell, v) {
  const [lay, , cs] = layerFor(cell), [cx, cy] = cs[0];
  const col = [OLIVE, [70, 92, 112], [150, 96, 52]][v], word = ["SPARES", "RATIONS", "MAGAZINE"][v];
  const wd = cell * 0.6, dp = cell * 0.46, ht = cell * 0.36, y = cy + cell * 0.12;
  const out = render(lay, crateShapes(cx, y, wd, dp, ht, col));
  stencil(new Draw(out), word, cx, y + dp / 2, ht * 0.5, cell * 0.12, [226, 222, 200]);
  return finish(out, cell, 2100 + v);
}

function tokenCrates2(cell) {
  const [lay, , cs] = layerFor(cell, row2(cell)), [cx, cyc] = centroid(cs), y = cyc + cell * 0.12;
  const a = crateShapes(cx - cell * 0.42, y, cell * 0.6, cell * 0.46, cell * 0.36, OLIVE);
  const b = crateShapes(cx + cell * 0.3, y + cell * 0.02, cell * 0.66, cell * 0.44, cell * 0.32, [70, 92, 112]);
  const c = crateShapes(cx + cell * 0.32, y - cell * 0.02, cell * 0.44, cell * 0.34, cell * 0.24, OLIVE, cell * 0.32);
  const out = render(lay, [...a, ...b, ...c]), d = new Draw(out);
  stencil(d, "SPARES", cx - cell * 0.42, y + cell * 0.23, cell * 0.18, cell * 0.11, [226, 222, 200]);
  stencil(d, "RATIONS", cx + cell * 0.3, y + cell * 0.24, cell * 0.16, cell * 0.11, [226, 222, 200]);
  return finish(out, cell, 2110);
}

// a bank of steel lockers against a wall: doors with vent slits and handles, a name plate on each
function tokenLockers(cell) {
  const [lay, , cs] = layerFor(cell, row2(cell)), [cx, cyc] = centroid(cs);
  const x0 = cx - cell * 0.82, x1 = cx + cell * 0.82, y0 = cyc - cell * 0.12, y1 = cyc + cell * 0.2, H = cell * 0.5, n = 6, dw = (x1 - x0) / n;
  const col = [84, 104, 98];
  const out = render(lay, [box(x0, y0, 0, x1, y1, H, { col, pat: (p, nn) => {
    if (nn[1] > 0.9) {
      const u = (p[0] - x0) % dw, z = p[2];
      if (u < 2 || u > dw - 2) return sh(col, 0.55);
      if (z > H * 0.78 && z < H * 0.9 && Math.abs(u - dw / 2) < dw * 0.3 && (Math.floor(z / 3) & 1)) return sh(col, 0.6);
      if (z > H * 0.1 && z < H * 0.2 && Math.abs(u - dw / 2) < dw * 0.3 && (Math.floor(z / 3) & 1)) return sh(col, 0.6);
    }
    return null;
  } }), box(x0 - 2, y0 - 2, H, x1 + 2, y1 + 2, H + 3, { col: sh(col, 0.85) })]), d = new Draw(out);
  for (let i = 0; i < n; i++) {
    const x = x0 + dw * (i + 0.5), [hx, hy] = S(x + dw * 0.28, y1, H * 0.5);
    d.rectangle([hx - 2, hy - cell * 0.04, hx + 2, hy + cell * 0.04], { fill: A([30, 30, 30]) });
    const [lx, ly] = S(x - dw * 0.2, y1, H * 0.66);
    d.rectangle([lx, ly, lx + dw * 0.4, ly + cell * 0.035], { fill: A([206, 202, 186]) });
  }
  return finish(out, cell, 2120);
}

// a deployable barricade: a steel shield leaning back on two struts, a hazard band along its top, a slit
function tokenBarricade(cell, v) {
  const [lay, , cs] = layerFor(cell), [cx, cy0] = cs[0], cy = cy0 + cell * 0.08, wd = cell * (v ? 0.38 : 0.36);
  const xs = v ? [cx - cell * 0.2, cx + cell * 0.2] : [cx];
  const shapes = [];
  for (const x of xs) {
    shapes.push(wedge(x - wd, cy - cell * 0.16, x + wd, cy + cell * 0.06, cell * 0.5, cell * 0.06, 0, { col: [104, 112, 108], pat: (p, n) => {
      if (n[2] > 0.2 && p[2] > cell * 0.4) return (Math.floor((p[0] + p[1]) / (cell * 0.07)) & 1) ? YEL : [30, 28, 24];
      if (n[2] > 0.2 && Math.abs(p[2] - cell * 0.3) < cell * 0.025 && Math.abs(p[0] - x) < wd * 0.4) return [16, 16, 16];
      return null;
    } }));
    for (const s of [-1, 1]) shapes.push(box(x + s * wd * 0.7 - 3, cy - cell * 0.24, 0, x + s * wd * 0.7 + 3, cy - cell * 0.1, cell * 0.2, { col: DARK }));
    shapes.push(box(x - wd, cy + cell * 0.04, 0, x + wd, cy + cell * 0.1, cell * 0.04, { col: DARK }));
  }
  return finish(render(lay, shapes), cell, 2130 + v);
}

// a low run of three pipes on two stands, with a valve wheel
function tokenPipeRun(cell) {
  const [lay, , cs] = layerFor(cell, row2(cell)), [cx, cyc] = centroid(cs), y = cyc + cell * 0.05, L = cell * 0.85;
  const shapes = [];
  [[-0.14, 0.08, [96, 104, 108]], [0, 0.07, RED], [0.14, 0.06, BLUE]].forEach(([dy, r, col]) => {
    shapes.push(cylinder([cx - L, y + dy * cell, cell * 0.2], [cx + L, y + dy * cell, cell * 0.2], r * cell, { col, pat: (p) => (Math.abs(((p[0] - cx) % (cell * 0.5) + cell * 0.5) % (cell * 0.5) - cell * 0.25) < 3 ? sh(col, 0.6) : null) }));
  });
  for (const sx of [-0.55, 0.55]) shapes.push(box(cx + sx * cell - 5, y - cell * 0.24, 0, cx + sx * cell + 5, y + cell * 0.24, cell * 0.14, { col: DARK }));
  shapes.push(cylinder([cx + cell * 0.2, y, cell * 0.2], [cx + cell * 0.2, y, cell * 0.38], cell * 0.03, { col: DARK }));
  let out = render(lay, shapes, 0.45);
  const d = new Draw(out), [wx, wy] = S(cx + cell * 0.2, y, cell * 0.39), R = cell * 0.1;
  d.ellipse([wx - R, wy - R * 0.6, wx + R, wy + R * 0.6], { outline: A(RED), width: Math.max(3, Math.round(cell * 0.025)) });
  d.line([[wx - R, wy], [wx + R, wy]], A(RED), 3);
  return finish(out, cell, 2140);
}

// --- hangar ------------------------------------------------------------------------------------------------------

// a maintenance gantry, open to the south for a mech to walk in: two side frames, a beam across the back
// with a hoist, catwalks with hazard edges, ladders
function tokenGantry(cell) {
  const [sx, sy, hw] = geometry(cell);
  const [lay, , cs] = layerFor(cell, size2Footprint(cell)), [cx, cyc] = centroid(cs);
  const x0 = cx - cell * 0.95, x1 = cx + cell * 0.95, y0 = cyc - cell * 0.62, y1 = cyc + cell * 0.55, H = cell * 0.62, t = cell * 0.13;
  const frame = [118, 104, 46], shapes = [];
  for (const x of [x0, x1 - t]) {
    shapes.push(box(x, y0, H - cell * 0.05, x + t, y1, H, { col: frame, pat: (p, n) => (n[2] > 0.9 && (Math.floor(p[1] / (cell * 0.06)) & 1) ? sh(frame, 0.7) : null) }));
    for (const y of [y0, (y0 + y1) / 2, y1 - t * 0.6]) shapes.push(box(x + t * 0.2, y, 0, x + t * 0.8, y + t * 0.6, H - cell * 0.05, { col: DARK }));
  }
  shapes.push(box(x0, y0, H - cell * 0.03, x1, y0 + t, H + cell * 0.05, { col: YEL, pat: (p) => ((Math.floor((p[0] + p[2]) / (cell * 0.08)) & 1) ? [30, 28, 24] : null) }));
  const hx = cx + cell * 0.15;
  shapes.push(box(hx - cell * 0.1, y0 - 2, H + cell * 0.05, hx + cell * 0.1, y0 + t + 2, H + cell * 0.12, { col: DARK }));
  shapes.push(cylinder([hx, y0 + t * 0.5, H - cell * 0.02], [hx, y0 + t * 0.5, cell * 0.25], 2.5, { col: [40, 40, 40] }));
  shapes.push(box(hx - cell * 0.06, y0 + t * 0.2, cell * 0.18, hx + cell * 0.06, y0 + t * 0.8, cell * 0.25, { col: YEL }));
  const out = render(lay, shapes), d = new Draw(out);
  stencil(d, "GANTRY 3", cx, y0 + t, H + cell * 0.01, cell * 0.1, [30, 28, 24], 230);
  return finish(out, cell, 2150, 0.08);
}

// a red rolling tool chest: drawers with pulls, a lid with a few tools on it
function tokenToolChest(cell) {
  const [lay, , cs] = layerFor(cell), [cx, cy0] = cs[0], cy = cy0 + cell * 0.12, wd = cell * 0.3, dp = cell * 0.2, H = cell * 0.36;
  const shapes = [box(cx - wd, cy - dp, cell * 0.04, cx + wd, cy + dp, H, { col: RED, gloss: 0.6, pat: (p, n) => {
    if (n[1] > 0.9) { const f = (p[2] - cell * 0.04) / (H - cell * 0.04); return (f * 5) % 1 < 0.08 ? [70, 20, 16] : Math.abs(p[0] - cx) < wd * 0.4 && (f * 5) % 1 > 0.42 && (f * 5) % 1 < 0.55 ? [190, 190, 186] : null; }
    return null;
  } })];
  for (const s of [-1, 1]) shapes.push(cylinder([cx + s * wd * 0.8, cy + dp - 3, cell * 0.025], [cx + s * wd * 0.8, cy + dp + 3, cell * 0.025], cell * 0.025, { col: [30, 30, 30] }));
  const out = render(lay, shapes, 0.6), d = new Draw(out);
  const [ax, ay] = S(cx - wd * 0.6, cy - dp * 0.3, H), [bx, by] = S(cx + wd * 0.2, cy + dp * 0.2, H);
  d.line([[ax, ay], [bx, by]], A([150, 152, 150]), 3);
  d.rectangle([bx - 3, by - 5, bx + 6, by + 3], { fill: A([150, 152, 150]) });
  return finish(out, cell, 2160);
}

// a flatbed munitions cart: four wheels, a tow bar, a rack of missiles with yellow bands
function tokenAmmoCart(cell) {
  const [lay, , cs] = layerFor(cell, row2(cell)), [cx, cyc] = centroid(cs), y = cyc + cell * 0.08, L = cell * 0.62;
  const shapes = [box(cx - L, y - cell * 0.22, cell * 0.08, cx + L, y + cell * 0.22, cell * 0.13, { col: OLIVE })];
  for (const sx of [-0.45, 0.45]) for (const s of [-1, 1])
    shapes.push(cylinder([cx + sx * cell, y + s * cell * 0.24 - 4, cell * 0.08], [cx + sx * cell, y + s * cell * 0.24 + 4, cell * 0.08], cell * 0.08, { col: [28, 28, 28] }));
  shapes.push(box(cx + L, y - 3, cell * 0.08, cx + L + cell * 0.22, y + 3, cell * 0.11, { col: DARK }));
  for (const dy of [-0.12, 0, 0.12]) {
    const yy = y + dy * cell, zc = cell * 0.13 + cell * 0.06;
    shapes.push(cylinder([cx - L * 0.85, yy, zc], [cx + L * 0.55, yy, zc], cell * 0.055, { col: [180, 184, 176], pat: (p) => (Math.abs(p[0] - (cx - L * 0.4)) < cell * 0.03 || Math.abs(p[0] - (cx + L * 0.3)) < cell * 0.02 ? YEL : null) }));
    shapes.push(sphere([cx + L * 0.55, yy, zc], cell * 0.055, { col: [150, 46, 34] }));
  }
  return finish(render(lay, shapes, 0.5), cell, 2170);
}

// --- habitat -----------------------------------------------------------------------------------------------------

// a hydroponic trough: a steel planter on short feet, dark grow medium, leafy crops, a grow-light rail
function tokenPlanter(cell) {
  const [lay, , cs] = layerFor(cell, row2(cell)), [cx, cyc] = centroid(cs), y = cyc + cell * 0.1;
  const x0 = cx - cell * 0.85, x1 = cx + cell * 0.85, y0 = y - cell * 0.2, y1 = y + cell * 0.2, H = cell * 0.26;
  const col = [150, 154, 146];
  const out = render(lay, [
    box(x0, y0, cell * 0.03, x1, y1, H, { col, gloss: 0.5, pat: (p, n) => (n[2] > 0.9 && p[0] > x0 + 5 && p[0] < x1 - 5 && p[1] > y0 + 5 && p[1] < y1 - 5 ? [42, 34, 26] : n[1] > 0.9 && Math.abs(p[2] - H * 0.55) < 2 ? sh(col, 0.7) : null) }),
    ...[x0 + 8, x1 - 14].flatMap((x) => [box(x, y1 - 8, 0, x + 6, y1, cell * 0.04, { col: DARK })]),
  ], 0.45);
  const d = new Draw(out), scratch = newImage("L", out.w, out.h), sd = new Draw(scratch), r = new PyRandom(2181);
  for (let i = 0; i < 26; i++) {                                                   // crops: lettuce-like rosettes and fronds
    const x = r.uniform(x0 + 12, x1 - 12), yy = r.uniform(y0 + 8, y1 - 8), [px, py] = S(x, yy, H), base = r.random() < 0.6 ? [54, 104, 46] : [74, 120, 52];
    if (r.random() < 0.5) for (let k = 0; k < 6; k++) broadLeaf(d, sd, px, py, r.uniform(0, 6.28), cell * r.uniform(0.07, 0.12), cell * 0.06, base, 2);
    else for (let k = 0; k < 5; k++) fern(d, sd, px, py, r.uniform(0, 6.28), cell * r.uniform(0.1, 0.16), r.uniform(-0.4, 0.4), base, 2, 0.25, 0.9, 0.42);
  }
  const lamp = (dd) => { const [a, b] = S(x0 + 6, y, H + cell * 0.32), [e] = S(x1 - 6, y, H); dd.rectangle([a, b - 2, e, b + 3], { fill: 255 }); };
  for (const x of [x0 + 6, x1 - 8]) { const [a, b] = S(x, y, H), [, c] = S(x, y, H + cell * 0.32); d.line([[a, b], [a, c]], A([60, 62, 60]), 3); }
  const [la, lb] = S(x0 + 6, y, H + cell * 0.32), [le] = S(x1 - 6, y, H);
  d.rectangle([la, lb - 4, le, lb + 4], { fill: A([60, 62, 60]) });
  d.rectangle([la + 4, lb - 1, le - 4, lb + 2], { fill: A([255, 214, 236]) });
  return finish(glow(out, cell, lamp, [255, 150, 210], 0.35, 0.1), cell, 2180, 0.05);
}

// a steel mess table with fixed benches either side, trays and mugs
function tokenMessTable(cell) {
  const [lay, , cs] = layerFor(cell, row2(cell)), [cx, cyc] = centroid(cs), y = cyc + cell * 0.04;
  const x0 = cx - cell * 0.78, x1 = cx + cell * 0.78, top = [168, 170, 164], shapes = [];
  shapes.push(box(x0, y - cell * 0.17, cell * 0.24, x1, y + cell * 0.17, cell * 0.27, { col: top, gloss: 0.55 }));
  for (const x of [x0 + 10, x1 - 16]) shapes.push(box(x, y - 4, 0, x + 6, y + 4, cell * 0.24, { col: DARK }));
  for (const s of [-1, 1]) {
    const by = y + s * cell * 0.33;
    shapes.push(box(x0 + 6, by - cell * 0.07, cell * 0.14, x1 - 6, by + cell * 0.07, cell * 0.17, { col: [120, 128, 124] }));
    for (const x of [x0 + 14, x1 - 20]) shapes.push(box(x, by - 3, 0, x + 6, by + 3, cell * 0.14, { col: DARK }));
  }
  const out = render(lay, shapes, 0.5), d = new Draw(out), r = new PyRandom(2191);
  for (let i = 0; i < 5; i++) {
    const x = cx + (i - 2) * cell * 0.3 + r.uniform(-6, 6), s = i & 1 ? 1 : -1, [px, py] = S(x, y + s * cell * 0.08, cell * 0.27);
    d.rectangle([px - cell * 0.08, py - cell * 0.05, px + cell * 0.08, py + cell * 0.05], { fill: A([136, 140, 136]), outline: A([96, 100, 96]), width: 1 });
    d.ellipse([px + cell * 0.1, py - cell * 0.03, px + cell * 0.15, py + cell * 0.02], { fill: A([60, 90, 120]) });
  }
  return finish(out, cell, 2190, 0.05);
}

// --- command ------------------------------------------------------------------------------------------------------

// a workstation: a cabinet with a sloped desk, a lit screen and status lamps, glowing on the floor
function consoleShapes(x, y, wd) {
  const col = [62, 70, 82];
  return [
    box(x - wd, y - 14, 0, x + wd, y + 14, 34, { col }),
    wedge(x - wd, y - 22, x + wd, y + 14, 52, 34, 34, { col: sh(col, 1.1) }),
  ];
}
function screens(d, x, y, wd, cell, col) {
  quad(d, [[x - wd * 0.8, y - 19, 50], [x + wd * 0.8, y - 19, 50], [x + wd * 0.8, y + 4, 38], [x - wd * 0.8, y + 4, 38]], A(col));
}
function tokenConsole(cell, v) {
  const [lay, , cs] = layerFor(cell), [cx, cy0] = cs[0], cy = cy0 + cell * 0.12, wd = cell * 0.3;
  const scale = cell / 140, sc = (sh0) => sh0;
  const shapes = consoleShapes(cx, cy, wd).map((s) => s);
  let out = render(lay, shapes, 0.4);
  const col = v ? [120, 230, 150] : [110, 200, 255], d = new Draw(out);
  screens(d, cx, cy, wd, cell, sh(col, 0.55));
  const r = new PyRandom(2200 + v);
  for (let i = 0; i < 6; i++) {                                                    // lines of data on the screen
    const t = r.uniform(0.1, 0.9), [ax, ay] = S(cx - wd * 0.7, cy - 17 + t * 19, 49 - t * 10), [bx] = S(cx - wd * 0.7 + r.uniform(0.3, 1.3) * wd, cy, 0);
    d.line([[ax, ay], [bx, ay]], A(col), 2);
  }
  for (let i = 0; i < 4; i++) { const [lx, ly] = S(cx - wd * 0.6 + i * wd * 0.4, cy + 14, 26); d.ellipse([lx - 3, ly - 3, lx + 3, ly + 3], { fill: A(i === 2 ? [255, 90, 60] : [255, 200, 90]) }); }
  out = glow(out, cell, (g) => quad(g, [[cx - wd, cy - 22, 52], [cx + wd, cy - 22, 52], [cx + wd, cy + 14, 34], [cx - wd, cy + 14, 34]], 255), col, 0.4, 0.16);
  return finish(out, cell, 2205 + v, 0.06);
}

function tokenConsoleBank(cell) {
  const [lay, , cs] = layerFor(cell, row2(cell)), [cx, cyc] = centroid(cs), cy = cyc + cell * 0.12, wd = cell * 0.26;
  const xs = [-0.56, 0, 0.56].map((f) => cx + f * cell);
  let out = render(lay, xs.flatMap((x) => consoleShapes(x, cy, wd)), 0.4);
  const d = new Draw(out), cols = [[110, 200, 255], [120, 230, 150], [110, 200, 255]];
  xs.forEach((x, i) => {
    screens(d, x, cy, wd, cell, sh(cols[i], 0.55));
    for (let k = 0; k < 4; k++) { const [ax, ay] = S(x - wd * 0.6, cy - 15 + k * 4.5, 48 - k * 2.4); d.line([[ax, ay], [ax + wd * (0.5 + ((k * 7 + i * 3) % 5) * 0.2), ay]], A(cols[i]), 2); }
  });
  out = glow(out, cell, (g) => xs.forEach((x) => quad(g, [[x - wd, cy - 22, 52], [x + wd, cy - 22, 52], [x + wd, cy + 14, 34], [x - wd, cy + 14, 34]], 255)), [110, 200, 255], 0.35, 0.16);
  return finish(out, cell, 2210, 0.06);
}

// a round plotting table: a dark rim round a glowing chart of rings, a course line and contacts
function tokenPlotTable(cell) {
  const [lay, , cs] = layerFor(cell, size2Footprint(cell)), [cx, cyc] = centroid(cs), cy = cyc + cell * 0.12, R = cell * 0.62, H = cell * 0.3;
  const shapes = [
    cylinder([cx, cy, 0], [cx, cy, H * 0.7], R * 0.55, { col: [44, 50, 60] }),
    cylinder([cx, cy, H * 0.7], [cx, cy, H], R, { col: [58, 66, 78], pat: (p, n) => (n[2] > 0.9 && Math.hypot(p[0] - cx, p[1] - cy) < R * 0.9 ? [10, 26, 36] : null) }),
  ];
  let out = render(lay, shapes, 0.5);
  const d = new Draw(out), col = [110, 210, 255], E = (r) => { const [x, y] = S(cx, cy, H); return [x - r, y - r, x + r, y + r]; };
  for (const f of [0.25, 0.5, 0.75]) d.ellipse(E(R * 0.9 * f), { outline: A(sh(col, 0.6)), width: 2 });
  const [ox, oy] = S(cx, cy, H);
  d.line([[ox - R * 0.85, oy], [ox + R * 0.85, oy]], A(sh(col, 0.45)), 1);
  d.line([[ox, oy - R * 0.85], [ox, oy + R * 0.85]], A(sh(col, 0.45)), 1);
  d.line([[ox - R * 0.6, oy + R * 0.4], [ox - R * 0.1, oy + R * 0.1], [ox + R * 0.45, oy - R * 0.35]], A(col), 3);
  for (const [a, b, c] of [[0.3, -0.5, [255, 120, 90]], [0.55, -0.1, [255, 120, 90]], [-0.4, -0.3, [140, 255, 170]]]) d.ellipse([ox + a * R - 5, oy + b * R - 5, ox + a * R + 5, oy + b * R + 5], { fill: A(c) });
  out = glow(out, cell, (g) => g.ellipse(E(R * 0.9), { fill: 255 }), col, 0.35, 0.18);
  return finish(out, cell, 2220, 0.05);
}

// --- reactor --------------------------------------------------------------------------------------------------------

// a coolant pump: a motor lying east-west on a skid, the pump casing, blue-lagged pipes leaving it
function tokenCoolantPump(cell) {
  const [lay, , cs] = layerFor(cell, size2Footprint(cell)), [cx, cyc] = centroid(cs), y = cyc + cell * 0.1;
  const LAG = [70, 118, 150], shapes = [
    box(cx - cell * 0.8, y - cell * 0.3, 0, cx + cell * 0.6, y + cell * 0.3, cell * 0.06, { col: DARK }),
    cylinder([cx - cell * 0.7, y, cell * 0.26], [cx - cell * 0.1, y, cell * 0.26], cell * 0.2, { col: [92, 104, 96], pat: (p) => ((Math.floor(p[0] / 5) & 1) && p[2] > cell * 0.3 ? sh([92, 104, 96], 0.8) : null) }),
    cylinder([cx - cell * 0.1, y, cell * 0.26], [cx + cell * 0.02, y, cell * 0.26], cell * 0.08, { col: DARK }),
    cylinder([cx + cell * 0.25, y, cell * 0.06], [cx + cell * 0.25, y, cell * 0.42], cell * 0.24, { col: [108, 116, 112], pat: (p, n) => (n[2] > 0.9 && Math.hypot(p[0] - cx - cell * 0.25, p[1] - y) > cell * 0.19 && (Math.floor(Math.atan2(p[1] - y, p[0] - cx - cell * 0.25) * 4) & 1) ? [60, 64, 62] : null) }),
    cylinder([cx + cell * 0.25, y - cell * 0.75, cell * 0.24], [cx + cell * 0.25, y - cell * 0.12, cell * 0.24], cell * 0.12, { col: LAG }),
    cylinder([cx + cell * 0.4, y + cell * 0.05, cell * 0.2], [cx + cell * 0.95, y + cell * 0.05, cell * 0.2], cell * 0.11, { col: LAG }),
  ];
  const out = render(lay, shapes, 0.45), d = new Draw(out);
  stencil(d, "PUMP 3", cx - cell * 0.4, y + cell * 0.2, cell * 0.26, cell * 0.11, [226, 222, 200]);
  return finish(out, cell, 2230);
}

// a valve manifold: a header pipe with three risers and red hand wheels
function tokenManifold(cell) {
  const [lay, , cs] = layerFor(cell), [cx, cy0] = cs[0], y = cy0 + cell * 0.14, shapes = [];
  shapes.push(cylinder([cx - cell * 0.42, y, cell * 0.12], [cx + cell * 0.42, y, cell * 0.12], cell * 0.09, { col: [150, 150, 142] }));
  for (const x of [-0.25, 0, 0.25]) {
    shapes.push(cylinder([cx + x * cell, y - cell * 0.02, cell * 0.12], [cx + x * cell, y - cell * 0.02, cell * 0.36], cell * 0.05, { col: [150, 150, 142] }));
    shapes.push(cylinder([cx + x * cell, y - cell * 0.02, cell * 0.36], [cx + x * cell, y - cell * 0.02, cell * 0.4], cell * 0.075, { col: DARK }));
  }
  for (const s of [-1, 1]) shapes.push(box(cx + s * cell * 0.36 - 5, y - cell * 0.12, 0, cx + s * cell * 0.36 + 5, y + cell * 0.12, cell * 0.06, { col: DARK }));
  const out = render(lay, shapes, 0.5), d = new Draw(out);
  for (const x of [-0.25, 0, 0.25]) {
    const [wx, wy] = S(cx + x * cell, y - cell * 0.02, cell * 0.42), R = cell * 0.075;
    d.ellipse([wx - R, wy - R * 0.85, wx + R, wy + R * 0.85], { outline: A(RED), width: 3 });
    d.line([[wx - R, wy], [wx + R, wy]], A(RED), 2); d.line([[wx, wy - R * 0.85], [wx, wy + R * 0.85]], A(RED), 2);
  }
  return finish(out, cell, 2240);
}

// the reactor vessel: a squat domed drum on a plinth, bolted flange rings, inspection ports glowing blue,
// a hazard band round its foot (Size 3)
function tokenReactor(cell) {
  const [sx, sy, hw] = geometry(cell);
  const fp = [[0, 0], [sx, 0], [-sx, 0], [hw, -sy], [-hw, -sy], [hw, sy], [-hw, sy]];
  const [lay, , cs] = layerFor(cell, fp), { w, h } = lay, cx = cs[0][0], cy = cs[0][1] + cell * 0.32;
  const R = cell * 0.88, H = cell * 0.42, z = fine(w, h);
  addCyl(z, w, h, cx, cy, R * 1.08, cell * 0.06, 1);
  addCyl(z, w, h, cx, cy, R, H, 4, cell * 0.14);
  addCyl(z, w, h, cx, cy, R * 0.3, H + cell * 0.2, 3, cell * 0.03);
  const col = [104, 110, 112];
  let out = project(w, h, z, (x, y, hgt, wall) => {
    const r = Math.hypot(x - cx, y - cy), a = Math.atan2(y - cy, x - cx);
    if (r > R * 1.0 && hgt < cell * 0.07) return (Math.floor((a * 12) / Math.PI) & 1) ? YEL : [28, 26, 22];  // the hazard band on the plinth
    if (wall && Math.abs(hgt - H * 0.35) < 3) return [56, 60, 62];
    if (wall && Math.abs(hgt - H * 0.75) < 3) return [56, 60, 62];
    if (!wall && r < R * 0.3) return [80, 86, 90];
    if (!wall && Math.abs(r - R * 0.86) < 3) return (Math.floor((a * 24) / Math.PI) & 1) ? [50, 54, 56] : [140, 146, 148];
    if (wall && (Math.floor((a * 36) / Math.PI) % 3) === 0) return sh(col, 0.82);
    return sh(col, 1 - 0.08 * Math.sin(a * 3));
  }, { gloss: 0.4 });
  const d = new Draw(out), ports = [];
  for (const a of [-0.6, 0.6, Math.PI / 2]) {                                          // ports on the south side of the drum
    const [px, py] = S(cx + Math.cos(a) * R * 0.99, cy + Math.sin(a) * R * 0.99, H * 0.55);
    if (Math.sin(a) > 0.2) ports.push([px, py]);
  }
  for (const [px, py] of ports) { d.ellipse([px - 9, py - 7, px + 9, py + 7], { fill: A([20, 24, 28]) }); d.ellipse([px - 6, py - 5, px + 6, py + 5], { fill: A([150, 230, 255]) }); }
  const [tx, ty] = S(cx, cy, H + cell * 0.2);
  d.ellipse([tx - R * 0.2, ty - R * 0.2 * 0.85, tx + R * 0.2, ty + R * 0.2 * 0.85], { outline: A([40, 44, 46]), width: 3 });
  out = glow(out, cell, (g) => ports.forEach(([px, py]) => g.ellipse([px - 14, py - 12, px + 14, py + 12], { fill: 255 })), [110, 210, 255], 0.6, 0.16);
  return finish(out, cell, 2250, 0.06);
}

// --- fabrication -------------------------------------------------------------------------------------------------

// an industrial printer: a frame of four posts and rails, the carriage across it with the print head, a
// part half built on the bed, the nozzle glowing
function tokenPrinter(cell) {
  const [lay, , cs] = layerFor(cell, size2Footprint(cell)), [cx, cyc] = centroid(cs), cy = cyc + cell * 0.06;
  const x0 = cx - cell * 0.72, x1 = cx + cell * 0.72, y0 = cy - cell * 0.42, y1 = cy + cell * 0.5, H = cell * 0.56, t = 10, frame = [70, 78, 84], shapes = [];
  shapes.push(box(x0 + 6, y0 + 6, 0, x1 - 6, y1 - 6, cell * 0.1, { col: [70, 74, 72], pat: (p, n) => (n[2] > 0.9 && ((Math.floor(p[0] / 8) + Math.floor(p[1] / 8)) & 1) ? [62, 66, 64] : null) }));
  for (const x of [x0, x1 - t]) for (const y of [y0, y1 - t]) shapes.push(box(x, y, 0, x + t, y + t, H, { col: frame }));
  for (const x of [x0, x1 - t]) shapes.push(box(x, y0, H - t, x + t, y1, H, { col: frame }));
  for (const y of [y0, y1 - t]) shapes.push(box(x0, y, H - t, x1, y + t, H, { col: frame }));
  const by = cy - cell * 0.05;
  shapes.push(box(x0, by - t, H - t * 1.6, x1, by + t, H - t * 0.4, { col: YEL }));
  shapes.push(box(cx + cell * 0.1 - 14, by - 14, H - cell * 0.28, cx + cell * 0.1 + 14, by + 14, H - t * 0.4, { col: DARK }));
  shapes.push(box(cx - cell * 0.3, cy - cell * 0.22, cell * 0.1, cx + cell * 0.25, cy + cell * 0.2, cell * 0.24, { col: [150, 140, 120], pat: (p, n) => (n[1] > 0.9 && (Math.floor(p[2] / 2.5) & 1) ? [130, 120, 102] : null) }));
  let out = render(lay, shapes, 0.4);
  const [nx, ny] = S(cx + cell * 0.1, by, H - cell * 0.28);
  const d = new Draw(out);
  d.ellipse([nx - 4, ny - 2, nx + 4, ny + 6], { fill: A([255, 190, 90]) });
  out = glow(out, cell, (g) => g.ellipse([nx - 10, ny - 6, nx + 10, ny + 14], { fill: 255 }), [255, 160, 70], 0.6, 0.08);
  stencil(new Draw(out), "PRINTER 2", cx, y1 - 6, cell * 0.05, cell * 0.08, [214, 210, 196], 220);
  return finish(out, cell, 2260, 0.06);
}

// a steel workbench: a thick top on legs, a vice, parts and a tool tray, a shelf below
function tokenWorkbench(cell) {
  const [lay, , cs] = layerFor(cell, row2(cell)), [cx, cyc] = centroid(cs), y = cyc + cell * 0.08;
  const x0 = cx - cell * 0.8, x1 = cx + cell * 0.8, shapes = [
    box(x0, y - cell * 0.2, cell * 0.27, x1, y + cell * 0.2, cell * 0.31, { col: [140, 142, 136], gloss: 0.5 }),
    box(x0 + 6, y - cell * 0.18, cell * 0.06, x1 - 6, y + cell * 0.18, cell * 0.08, { col: DARK }),
    box(cx + cell * 0.48, y - cell * 0.12, cell * 0.31, cx + cell * 0.66, y + cell * 0.02, cell * 0.39, { col: [70, 90, 110] }),
    box(cx - cell * 0.6, y - cell * 0.16, cell * 0.31, cx - cell * 0.2, y + cell * 0.02, cell * 0.35, { col: RED }),
  ];
  for (const x of [x0 + 4, x1 - 10]) for (const s of [-1, 1]) shapes.push(box(x, y + s * cell * 0.16 - 3, 0, x + 6, y + s * cell * 0.16 + 3, cell * 0.27, { col: DARK }));
  const out = render(lay, shapes, 0.5), d = new Draw(out), r = new PyRandom(2271);
  for (let i = 0; i < 7; i++) {
    const [px, py] = S(r.uniform(cx - cell * 0.1, cx + cell * 0.4), r.uniform(y - cell * 0.15, y + cell * 0.15), cell * 0.31);
    if (r.random() < 0.5) d.ellipse([px - 5, py - 4, px + 5, py + 4], { fill: A([110, 112, 108]), outline: A([60, 60, 58]), width: 1 });
    else d.rectangle([px - 8, py - 2, px + 8, py + 2], { fill: A([150, 152, 148]) });
  }
  return finish(out, cell, 2270);
}

// stores racking: a steel frame with three shelves of boxes and drums, open to the south
function tokenRack(cell) {
  const [lay, , cs] = layerFor(cell, row2(cell)), [cx, cyc] = centroid(cs), y = cyc + cell * 0.04;
  const x0 = cx - cell * 0.85, x1 = cx + cell * 0.85, y0 = y - cell * 0.2, y1 = y + cell * 0.2, frame = [64, 90, 128], shapes = [];
  for (const x of [x0, cx - 4, x1 - 8]) for (const yy of [y0, y1 - 8]) shapes.push(box(x, yy, 0, x + 8, yy + 8, cell * 0.44, { col: frame }));
  const r = new PyRandom(2281);
  for (const z of [0.04, 0.22, 0.4].map((f) => f * cell)) {
    for (const yy of [y0, y1 - 5]) shapes.push(box(x0, yy, z, x1, yy + 5, z + 5, { col: YEL }));
    shapes.push(box(x0 + 4, y0 + 5, z, x1 - 4, y1 - 5, z + 2, { col: [56, 60, 62] }));
    for (let x = x0 + 10; x < x1 - 30; x += r.uniform(30, 52)) {
      const bw = r.uniform(22, 42), bh = r.uniform(0.07, 0.13) * cell, col = r.choice([[150, 128, 92], [94, 104, 92], [120, 126, 128], [70, 92, 112]]);
      shapes.push(box(x, y0 + 6, z + 4, x + bw, y1 - r.uniform(4, 14), z + 4 + bh, { col }));
    }
  }
  return finish(render(lay, shapes, 0.35), cell, 2280);
}

export const TOKENS = {
  sd_crate_v1: (c) => tokenCrate(c, 0),
  sd_crate_v2: (c) => tokenCrate(c, 1),
  sd_crate_v3: (c) => tokenCrate(c, 2),
  sd_crates_2hex: tokenCrates2,
  sd_lockers_2hex: tokenLockers,
  sd_barricade_v1: (c) => tokenBarricade(c, 0),
  sd_barricade_v2: (c) => tokenBarricade(c, 1),
  sd_pipe_run_2hex: tokenPipeRun,
  sd_gantry_size2: tokenGantry,
  sd_tool_chest: tokenToolChest,
  sd_ammo_cart_2hex: tokenAmmoCart,
  sd_planter_2hex: tokenPlanter,
  sd_mess_table_2hex: tokenMessTable,
  sd_console_v1: (c) => tokenConsole(c, 0),
  sd_console_v2: (c) => tokenConsole(c, 1),
  sd_console_bank_2hex: tokenConsoleBank,
  sd_plot_table_size2: tokenPlotTable,
  sd_coolant_pump_size2: tokenCoolantPump,
  sd_manifold: tokenManifold,
  sd_reactor_size3: tokenReactor,
  sd_printer_size2: tokenPrinter,
  sd_feedstock_drums: (c) => tokenDrums(c, 1, [178, 182, 172]),
  sd_workbench_2hex: tokenWorkbench,
  sd_rack_2hex: tokenRack,
};

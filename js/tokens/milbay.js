// Military Bay props (from milbay_props.py; names start mb_), after Synthetik's Military Bay: pale
// chipped concrete, dark gunmetal, red-orange caps and bands, wooden pallets; and the raised steel
// deck plates (tread plate, from milbay_map.tread_plate).

import { NpRandom, PyRandom } from "../rng.js?v=0f282507bd";
import { newImage, Draw, alphaComposite, alphaCompositeAt, paste, gaussianBlur, u8 } from "../raster.js?v=0f282507bd";
import { geometry, hexPoints, radians, arange, linspace } from "../maps/geometry.js?v=0f282507bd";
import { noise, stripes, maskOf } from "../maps/common.js?v=0f282507bd";
import { tokenCanvas, withShadow, grime, bevelBox } from "./kit.js?v=0f282507bd";

const F = Math.fround;
const T = Math.trunc;
const CONCRETE = [196, 194, 188];
const GUNMETAL = [58, 60, 66];
const CAP = [206, 74, 40];
const WOOD = [138, 104, 68];
const PLATE = [88, 90, 97];            // the raised steel deck: lighter and cooler than the concrete floor

function layerFor(cell, footprint) {
  const { img, cs } = tokenCanvas(cell, footprint), lay = newImage("RGBA", img.w, img.h);
  return [lay, new Draw(lay), cs];
}

function speckle(lay, [x0, y0, x1, y1], seed, dark = [120, 118, 112], n = 60) {
  const d = new Draw(lay), r = new PyRandom(seed);
  for (let i = 0; i < n; i++) {
    const x = r.uniform(x0, x1), y = r.uniform(y0, y1), s = r.uniform(0.6, 1.8);
    d.ellipse([x - s, y - s, x + s, y + s], { fill: [...dark, 200] });
  }
}

// --- concrete ----------------------------------------------------------------------------------------

function barrierBody(lay, d, box, cell, seed, chipped) {
  bevelBox(d, box, CONCRETE, cell, 0.03, 0.05);
  const [x0, y0, x1, y1] = box;
  speckle(lay, box, seed);
  const r = new PyRandom(seed);
  if (chipped)                                                              // broken corners, exposed aggregate
    for (let i = 0; i < 3; i++) {
      const [cx, cy] = r.choice([[x0, y0], [x1, y0], [x0, y1], [x1, y1]]), s = r.uniform(0.08, 0.16) * cell, pts = [];
      for (let k = 0; k < 5; k++) { const px = cx + r.uniform(-s, s); pts.push([px, cy + r.uniform(-s, s)]); }
      d.polygon(pts, [150, 146, 138, 255]);
      speckle(lay, [cx - s, cy - s, cx + s, cy + s], seed + 7, [96, 92, 86], 10);
    }
}

function rebarLoop(d, x, y, cell) {                                         // the lifting loop: a dark-red rebar arc
  const s = cell * 0.09, w = Math.max(3, T(cell * 0.028)), col = [120, 40, 30, 255];
  d.arc([x - s, y - s, x + s, y + s], 180, 360, col, w);
  d.line([[x - s, y], [x - s, y + s * 0.4]], col, w);
  d.line([[x + s, y], [x + s, y + s * 0.4]], col, w);
}

function tokenBarrier(cell, seed = 0) {
  const [lay, d, cs] = layerFor(cell, [[0, 0]]), [cx, cy] = cs[0];
  const box = [cx - cell * 0.4, cy - cell * 0.24, cx + cell * 0.4, cy + cell * 0.24];
  barrierBody(lay, d, box, cell, 100 + seed, seed === 1);
  d.line([[box[0] + cell * 0.06, cy], [box[2] - cell * 0.06, cy]], [172, 170, 164, 255], Math.max(1, T(cell * 0.012)));
  rebarLoop(d, cx, cy - cell * 0.02, cell);
  return withShadow(grime(lay, cell, 110 + seed, 0.15), cell);
}

function tokenBarrier2hex(cell) {
  const [sx] = geometry(cell), [lay, d, cs] = layerFor(cell, [[0, 0], [sx, 0]]), [[x0, cy], [x1]] = cs;
  const box = [x0 - cell * 0.42, cy - cell * 0.24, x1 + cell * 0.42, cy + cell * 0.24];
  barrierBody(lay, d, box, cell, 120, true);
  d.line([[box[0] + cell * 0.06, cy], [box[2] - cell * 0.06, cy]], [172, 170, 164, 255], Math.max(1, T(cell * 0.012)));
  for (const x of [x0, x1]) rebarLoop(d, x, cy - cell * 0.02, cell);
  d.line([[(x0 + x1) / 2, box[1] + cell * 0.04], [(x0 + x1) / 2, box[3] - cell * 0.04]], [150, 148, 142, 255],
    Math.max(2, T(cell * 0.02)));                                           // the joint between the two sections
  return withShadow(grime(lay, cell, 121, 0.15), cell);
}

// --- munitions ----------------------------------------------------------------------------------------

// Standing shells seen from above: a dark body ring, a red-orange cap, a bright tip
function tokenShells(cell, seed = 0) {
  const [lay, d, cs] = layerFor(cell, [[0, 0]]), [cx, cy] = cs[0];
  const spots = seed === 0 ? [[-0.18, -0.16], [0.18, -0.16], [-0.18, 0.18], [0.18, 0.18]]
    : [[-0.22, -0.12], [0.12, -0.2], [0.22, 0.14], [-0.1, 0.22], [0.0, 0.0]];
  for (const [dx, dy] of spots) {
    const x = cx + dx * cell, y = cy + dy * cell, R = cell * (seed === 0 ? 0.15 : 0.12);
    d.ellipse([x - R, y - R, x + R, y + R], { fill: [40, 42, 46, 255] });
    d.ellipse([x - R * 0.9, y - R * 0.9, x + R * 0.9, y + R * 0.9], { fill: [...GUNMETAL, 255] });
    d.ellipse([x - R * 0.62, y - R * 0.62, x + R * 0.62, y + R * 0.62], { fill: [...CAP, 255] });
    d.ellipse([x - R * 0.62, y - R * 0.62, x + R * 0.1, y + R * 0.1], { fill: [236, 120, 80, 255] });
    d.ellipse([x - R * 0.18, y - R * 0.18, x + R * 0.18, y + R * 0.18], { fill: [60, 30, 20, 255] });
    d.arc([x - R * 0.9, y - R * 0.9, x + R * 0.9, y + R * 0.9], 200, 290, [110, 112, 120, 255], Math.max(1, T(cell * 0.015)));
  }
  return withShadow(lay, cell);
}

function pallet(d, [x0, y0, x1, y1], cell) {
  d.rectangle([x0, y0, x1, y1], { fill: [...WOOD.map((c) => T(c * 0.6)), 255] });
  const n = 5;
  for (let i = 0; i < n; i++) {                                              // deck boards
    const bx0 = x0 + (x1 - x0) * i / n + cell * 0.01;
    d.rectangle([bx0, y0, bx0 + (x1 - x0) / n - cell * 0.02, y1], { fill: [...WOOD, 255] });
    d.line([[bx0 + cell * 0.02, y0], [bx0 + cell * 0.02, y1]], [162, 128, 88, 255], 1);
  }
}

// A warhead lying east-west: body, band, ogive nose
function warhead(d, x, y, length, radius, cell, band = CAP) {
  d.roundedRectangle([x - length / 2, y - radius, x + length * 0.25, y + radius], radius * 0.3, { fill: [...GUNMETAL, 255] });
  d.rectangle([x - length * 0.1, y - radius, x - length * 0.02, y + radius], { fill: [...band, 255] });
  d.polygon([[x + length * 0.25, y - radius], [x + length / 2, y], [x + length * 0.25, y + radius]], [46, 48, 54, 255]);
  d.line([[x - length / 2 + 2, y - radius * 0.4], [x + length * 0.3, y - radius * 0.4]], [96, 98, 106, 255], 1);
}

function tokenMunitionsPallet(cell) {
  const [lay, d, cs] = layerFor(cell, [[0, 0]]), [cx, cy] = cs[0];
  const box = [cx - cell * 0.4, cy - cell * 0.34, cx + cell * 0.4, cy + cell * 0.34];
  pallet(d, box, cell);
  for (let i = 0; i < 4; i++) warhead(d, cx, box[1] + cell * 0.1 + i * cell * 0.16, cell * 0.72, cell * 0.06, cell);
  d.line([[cx - cell * 0.12, box[1]], [cx - cell * 0.12, box[3]]], [40, 40, 44, 255], Math.max(2, T(cell * 0.025)));   // strap
  return withShadow(grime(lay, cell, 131, 0.12), cell);
}

function tokenAmmoCage(cell) {
  const [lay, d, cs] = layerFor(cell, [[0, 0]]), [cx, cy] = cs[0];
  const box = [cx - cell * 0.38, cy - cell * 0.32, cx + cell * 0.38, cy + cell * 0.32];
  d.rectangle(box, { fill: [30, 32, 36, 255] });
  const R = cell * 0.075;
  for (let row = 0; row < 4; row++)                                          // canisters, seen end-on
    for (let col = 0; col < 5; col++) {
      const x = box[0] + cell * 0.1 + col * cell * 0.14, y = box[1] + cell * 0.1 + row * cell * 0.14;
      d.ellipse([x - R, y - R, x + R, y + R], { fill: [44, 46, 52, 255] });
      d.ellipse([x - R * 0.6, y - R * 0.6, x + R * 0.3, y + R * 0.3], { fill: [70, 72, 80, 255] });
    }
  const frame = [86, 88, 96, 255], w = Math.max(3, T(cell * 0.03));        // the cage frame
  d.rectangle(box, { outline: frame, width: w });
  for (const x of linspace(box[0], box[2], 4)) d.line([[x, box[1]], [x, box[3]]], frame, Math.max(2, w >> 1));
  d.rectangle([box[0] + cell * 0.08, box[3] - cell * 0.1, box[0] + cell * 0.36, box[3] - cell * 0.04], { fill: [60, 110, 170, 255] });   // the blue label strip
  d.polygon([[box[2] - cell * 0.16, box[3] - cell * 0.1], [box[2] - cell * 0.06, box[3] - cell * 0.1],
    [box[2] - cell * 0.11, box[3] - cell * 0.03]], [220, 170, 40, 255]);  // hazard triangle
  return withShadow(lay, cell);
}

function tokenRocketStack(cell) {
  const [sx] = geometry(cell), [lay, d, cs] = layerFor(cell, [[0, 0], [sx, 0]]), [[x0, cy], [x1]] = cs;
  const box = [x0 - cell * 0.42, cy - cell * 0.3, x1 + cell * 0.42, cy + cell * 0.3];
  pallet(d, box, cell);
  const L = box[2] - box[0] - cell * 0.1;
  for (let i = 0; i < 4; i++) {                                              // long orange rockets
    const y = box[1] + cell * 0.1 + i * cell * 0.135, mid = (box[0] + box[2]) / 2;
    d.roundedRectangle([mid - L / 2, y - cell * 0.05, mid + L * 0.38, y + cell * 0.05], cell * 0.04, { fill: [214, 140, 50, 255] });
    d.line([[mid - L / 2 + 3, y - cell * 0.02], [mid + L * 0.38, y - cell * 0.02]], [240, 186, 100, 255], 1);
    d.polygon([[mid + L * 0.38, y - cell * 0.05], [mid + L / 2, y], [mid + L * 0.38, y + cell * 0.05]], [170, 60, 36, 255]);
    const fx = mid - L / 2 + cell * 0.04;                                    // fins
    d.polygon([[fx, y - cell * 0.05], [fx - cell * 0.05, y - cell * 0.08], [fx + cell * 0.06, y - cell * 0.05]], [80, 82, 90, 255]);
  }
  for (const x of [x0, x1]) d.line([[x, box[1]], [x, box[3]]], [40, 40, 44, 255], Math.max(2, T(cell * 0.025)));   // straps
  return withShadow(grime(lay, cell, 141, 0.12), cell);
}

// --- equipment ----------------------------------------------------------------------------------------

function tokenGasTanks(cell) {
  const [lay, d, cs] = layerFor(cell, [[0, 0]]), [cx, cy] = cs[0];
  for (const [dx, dy, R] of [[-0.15, -0.08, 0.2], [0.18, -0.12, 0.16]]) {  // two big tanks, from above
    const x = cx + dx * cell, y = cy + dy * cell, r = R * cell;
    d.ellipse([x - r, y - r, x + r, y + r], { fill: [170, 170, 176, 255] });
    d.ellipse([x - r * 0.85, y - r * 0.85, x + r * 0.4, y + r * 0.4], { fill: [204, 204, 210, 255] });
    d.ellipse([x - r * 0.3, y - r * 0.3, x + r * 0.3, y + r * 0.3], { fill: [90, 92, 100, 255] });   // valve
    d.line([[x, y], [x + r * 0.55, y - r * 0.2]], [60, 62, 70, 255], Math.max(2, T(cell * 0.02)));
  }
  for (const [dx, col] of [[-0.2, [190, 60, 50]], [0.02, [60, 110, 180]], [0.24, [190, 60, 50]]]) {   // bottles
    const x = cx + dx * cell, y = cy + 0.24 * cell, r = 0.07 * cell;
    d.ellipse([x - r, y - r, x + r, y + r], { fill: [...col, 255] });
    d.ellipse([x - r * 0.4, y - r * 0.4, x + r * 0.4, y + r * 0.4], { fill: [210, 210, 214, 255] });
  }
  return withShadow(lay, cell);
}

function tokenGenerator(cell) {
  const [lay, d, cs] = layerFor(cell, [[0, 0]]), [cx, cy] = cs[0];
  const box = [cx - cell * 0.34, cy - cell * 0.3, cx + cell * 0.34, cy + cell * 0.3];
  bevelBox(d, box, [104, 106, 112], cell, 0.03, 0.04);
  for (let i = 0; i < 5; i++) {                                              // vents
    const y = box[1] + cell * 0.1 + i * cell * 0.07;
    d.rectangle([box[0] + cell * 0.08, y, box[0] + cell * 0.4, y + cell * 0.035], { fill: [40, 42, 46, 255] });
  }
  alphaCompositeAt(lay, stripes([T(cell * 0.2), T(cell * 0.2)], T(cell * 0.06)), T(box[2] - cell * 0.24), T(box[1] + cell * 0.04));   // hazard corner
  const lx = box[2] - cell * 0.12, ly = box[3] - cell * 0.12;
  d.ellipse([lx - cell * 0.045, ly - cell * 0.045, lx + cell * 0.045, ly + cell * 0.045], { fill: [255, 150, 50, 255] });
  d.ellipse([lx - cell * 0.02, ly - cell * 0.03, lx + cell * 0.005, ly - cell * 0.005], { fill: [255, 230, 190, 255] });
  return withShadow(grime(lay, cell, 151, 0.15), cell);
}

// The Y-shaped floor anchor from the bay: three flat arms from a hub
function tokenAnchor(cell, seed = 0) {
  const [lay, d, cs] = layerFor(cell, [[0, 0]]), [cx, cy] = cs[0], rot = 20 + 40 * seed, col = [150, 152, 160, 255];
  for (let k = 0; k < 3; k++) {
    const a = radians(rot + 120 * k);
    const tip = [cx + Math.cos(a) * cell * 0.34, cy + Math.sin(a) * cell * 0.34];
    const side = [Math.cos(a + Math.PI / 2) * cell * 0.05, Math.sin(a + Math.PI / 2) * cell * 0.05];
    d.polygon([[cx + side[0], cy + side[1]], [tip[0] + side[0] * 0.4, tip[1] + side[1] * 0.4],
      [tip[0] - side[0] * 0.4, tip[1] - side[1] * 0.4], [cx - side[0], cy - side[1]]], col);
    d.line([[cx + side[0], cy + side[1]], [tip[0] + side[0] * 0.4, tip[1] + side[1] * 0.4]], [196, 198, 206, 255], Math.max(1, T(cell * 0.012)));
  }
  d.ellipse([cx - cell * 0.07, cy - cell * 0.07, cx + cell * 0.07, cy + cell * 0.07], { fill: [110, 112, 120, 255] });
  return withShadow(lay, cell, 0.04, 0.05, 0.03, 0.5);
}

// --- raised ground: steel deck plates ---------------------------------------------------------------

// Diamond-tread steel: rows of short raised bars at alternating angles (in bolted panels, unless off)
export function treadPlate([w, h], cell, seed = 11, panels = true) {
  const n = noise(h, w, cell * 2.5, seed), fine = new NpRandom(seed);
  let img = newImage("RGBA", w, h);
  for (let p = 0; p < w * h; p++) {
    const tone = F(0.9 + F(0.16 * n[p])), g = fine.normal(0, 2.4);
    for (let k = 0; k < 3; k++) img.data[p * 4 + k] = u8(F(PLATE[k] * tone) + g);
    img.data[p * 4 + 3] = 255;
  }
  const d = new Draw(img), p = cell * 0.15, L = cell * 0.045, lw = Math.max(2, T(cell * 0.022));
  arange(p / 2, h, p).forEach((y, j) => {
    arange(p / 2 + (j % 2) * p / 2, w, p).forEach((x, i) => {
      const s = (i + j) % 2 ? 1 : -1;
      d.line([[x - L + 1, y - s * L + 1], [x + L + 1, y + s * L + 1]], [44, 45, 50, 255], lw);
      d.line([[x - L, y - s * L], [x + L, y + s * L]], [128, 131, 138, 255], lw);
    });
  });
  const r = new PyRandom(seed), sx = cell * 1.9, sy = cell * 1.5;          // panels, seams and bolts
  if (panels)
    for (const y of arange(0, h + sy, sy)) {
      const off = (T(y / sy) % 2) * sx / 2;
      d.line([[0, y], [w, y]], [30, 31, 35, 255], Math.max(2, T(cell * 0.03)));
      for (const x of arange(-off, w + sx, sx)) {
        d.line([[x, y], [x, y + sy]], [30, 31, 35, 255], Math.max(2, T(cell * 0.03)));
        for (const [bx, by] of [[x + cell * 0.1, y + cell * 0.1], [x + sx - cell * 0.1, y + cell * 0.1], [x + cell * 0.1, y + sy - cell * 0.1], [x + sx - cell * 0.1, y + sy - cell * 0.1]]) {
          const b = cell * 0.03;
          d.ellipse([bx - b, by - b, bx + b, by + b], { fill: [150, 152, 158, 255], outline: [40, 40, 44, 255] });
        }
      }
    }
  const wear = newImage("RGBA", w, h), wd = new Draw(wear);                 // scuffed paths and oil
  for (let i = T(w * h / (cell * cell) * 0.3); i > 0; i--) {
    const x = r.uniform(0, w), y = r.uniform(0, h), rad = r.uniform(0.25, 0.9) * cell;
    wd.ellipse([x - rad, y - rad * 0.6, x + rad, y + rad * 0.6], { fill: [20, 20, 24, r.randint(25, 55)] });
  }
  return alphaComposite(img, gaussianBlur(wear, cell * 0.2));
}

// A deck plate. `edges`: hex edges (0 = north-east, then clockwise; 5 = north-west) with hazard striping
function tokenDeck(cell, variant = 0, edges = []) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0], size = [img.w, img.h];
  const m = maskOf(size, cs, cell);
  let tile = treadPlate(size, cell, 31 + variant, false);
  if (edges.length) {
    const pts = hexPoints(cx, cy, cell), band = newImage("L", img.w, img.h), bd = new Draw(band), k = 0.2;
    for (const i of edges) {
      const a = pts[i], b = pts[(i + 1) % 6];
      const a2 = [a[0] + (cx - a[0]) * k, a[1] + (cy - a[1]) * k], b2 = [b[0] + (cx - b[0]) * k, b[1] + (cy - b[1]) * k];
      bd.polygon([a, b, b2, a2], 235);
    }
    paste(tile, stripes(size, Math.max(3, T(cell * 0.075))), band);
  }
  tile = grime(tile, cell, 60 + variant, 0.22);
  const out = newImage("RGBA", img.w, img.h);
  paste(out, tile, m);
  const d = new Draw(out), inner = hexPoints(cx, cy, cell, 0.05), lw = Math.max(2, T(cell * 0.018));
  d.line([inner[3], inner[4], inner[5], inner[0]], [150, 153, 160, 200], lw);    // lit plate edge
  d.line([inner[0], inner[1], inner[2], inner[3]], [34, 35, 40, 220], lw);       // shaded plate edge
  d.polygon(hexPoints(cx, cy, cell, 0.012), null, { outline: [22, 22, 26, 255], width: Math.max(2, T(cell * 0.03)) });
  const r = new PyRandom(variant);
  for (const [vx, vy] of hexPoints(cx, cy, cell, 0.2)) {                    // six bolts
    const b = cell * 0.032;
    d.ellipse([vx - b, vy - b, vx + b, vy + b], { fill: [158, 160, 166, 255], outline: [36, 36, 40, 255] });
    if (r.random() < 0.3) d.line([[vx - b * 0.7, vy], [vx + b * 0.7, vy]], [60, 60, 66, 255], 1);
  }
  return out;
}

export const TOKENS = {
  mb_deck_v1: (c) => tokenDeck(c, 0),
  mb_deck_v2: (c) => tokenDeck(c, 1),
  mb_deck_v3: (c) => tokenDeck(c, 2),
  mb_deck_edge: (c) => tokenDeck(c, 3, [5]),
  mb_deck_edge2: (c) => tokenDeck(c, 4, [5, 0]),
  mb_barrier_v1: (c) => tokenBarrier(c, 0),
  mb_barrier_v2: (c) => tokenBarrier(c, 1),
  mb_barrier_2hex: tokenBarrier2hex,
  mb_shells_v1: (c) => tokenShells(c, 0),
  mb_shells_v2: (c) => tokenShells(c, 1),
  mb_munitions_pallet: tokenMunitionsPallet,
  mb_ammo_cage: tokenAmmoCage,
  mb_gas_tanks: tokenGasTanks,
  mb_generator: tokenGenerator,
  mb_rocket_stack: tokenRocketStack,
  mb_anchor_v1: (c) => tokenAnchor(c, 0),
  mb_anchor_v2: (c) => tokenAnchor(c, 1),
};

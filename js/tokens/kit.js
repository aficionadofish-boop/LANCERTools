// The terrain token kit (from roll20_maps.py): transparent hex-shaped PNGs the GM places on the map
// and deletes when the terrain is destroyed. Drawn at SS x; the Roll20 size is the pixel size / SS.
// Roll20 snaps a token by the CENTRE of its image, so the canvas is symmetric round the first
// footprint hex (the anchor).

import { NpRandom, PyRandom } from "../rng.js?v=0f282507bd";
import { newImage, cloneImage, Draw, alphaComposite, alphaCompositeAt, paste, pasteAt, crop, gaussianBlur,
  resizeL, rotate, scaleAffineNearest, blend, u8 } from "../raster.js?v=0f282507bd";
import { geometry, hexPoints, radians, degrees } from "../maps/geometry.js?v=0f282507bd";
import { noiseRgb, stripes, maskOf, HAZARD_Y, font } from "../maps/common.js?v=0f282507bd";

const F = Math.fround;
const T = Math.trunc;

// --- the canvas and shared finishes ------------------------------------------------------------------

export function tokenCanvas(cell, footprint) {
  const [, , hw, qh] = geometry(cell);
  const [ax, ay] = footprint[0];
  const xs = footprint.map((p) => p[0]), ys = footprint.map((p) => p[1]);
  const ex = Math.max(ax - (Math.min(...xs) - hw), Math.max(...xs) + hw - ax);
  const ey = Math.max(ay - (Math.min(...ys) - 2 * qh), Math.max(...ys) + 2 * qh - ay);
  const left = ax - ex, top = ay - ey;
  return { img: newImage("RGBA", Math.ceil(2 * ex), Math.ceil(2 * ey)), cs: footprint.map(([x, y]) => [x - left, y - top]) };
}

export const size2Footprint = (cell) => { const [, sy, hw] = geometry(cell); return [[0, 0], [-hw, sy], [hw, sy]]; };

// Clip a filled tile to the hex mask and draw its rim
export function finish(tile, mask, edge, cell, cs, width) {
  const out = newImage("RGBA", tile.w, tile.h);
  paste(out, tile, mask);
  const d = new Draw(out);
  for (const [cx, cy] of cs) {
    const pts = hexPoints(cx, cy, cell, 0.02);
    d.line([...pts, pts[0]], edge, width, "curve");
  }
  return out;
}

export function badge(img, text, cell, fill = [20, 20, 22, 230], fg = [235, 235, 235]) {
  const d = new Draw(img), f = font(cell * 0.24), tw = d.textLength(text, f);
  const x0 = img.w / 2 - tw / 2 - cell * 0.06, y0 = img.h / 2 - cell * 0.16;
  d.roundedRectangle([x0, y0, x0 + tw + cell * 0.12, y0 + cell * 0.32], cell * 0.05, { fill });
  d.text([img.w / 2 - tw / 2, y0 + cell * 0.02], text, f, fg);
}

// The largest font (from `start` down) whose text fits max_w x max_h -> [size, tw, th]
export function fitFont(d, text, maxW, maxH, start) {
  for (let size = T(start); size > 6; size--) {
    const [l, tp, r, b] = d.textBbox(text, size);
    if (r - l <= maxW && b - tp <= maxH) return [size, r - l, b - tp];
  }
  const [l, tp, r, b] = d.textBbox(text, 6);
  return [6, r - l, b - tp];
}

// Text centred in box [x0, y0, x1, y1], shrunk to fit; optional backing plate
export function centeredText(d, text, [x0, y0, x1, y1], fill, start, plate = null, pad = 0.12) {
  const bw = x1 - x0, bh = y1 - y0;
  const [f, tw, th] = fitFont(d, text, bw * (1 - 2 * pad), bh * (1 - 2 * pad), start);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (plate) { const m = th * 0.25; d.rectangle([cx - tw / 2 - m, cy - th / 2 - m, cx + tw / 2 + m, cy + th / 2 + m], { fill: plate }); }
  const [l, tp] = d.textBbox(text, f);
  d.text([cx - tw / 2 - l, cy - th / 2 - tp], text, f, fill);
}

// A soft shadow under an object layer (offset down-right, as if lit from top-left)
export function withShadow(obj, cell, dx = 0.05, dy = 0.07, blur = 0.05, strength = 0.6) {
  const sh = newImage("RGBA", obj.w, obj.h), fs = F(strength);
  for (let p = 0; p < obj.w * obj.h; p++) sh.data[p * 4 + 3] = T(F(obj.data[p * 4 + 3] * fs));
  const blurred = gaussianBlur(sh, cell * blur);
  const out = newImage("RGBA", obj.w, obj.h), ox = T(cell * dx), oy = T(cell * dy);
  alphaCompositeAt(out, crop(blurred, [0, 0, obj.w - ox, obj.h - oy]), ox, oy);
  return alphaCompositeAt(out, obj, 0, 0);
}

// Darken an RGBA layer with blotchy noise (wear), keeping its alpha
export function grime(layer, cell, seed, amount = 0.18) {
  const rng = new NpRandom(seed), { w, h } = layer, c = T(cell * 0.12);
  const gh = Math.max(2, Math.floor(h / c)), gw = Math.max(2, Math.floor(w / c));
  const g = rng.randomArray(gh * gw), grid = new Uint8Array(gh * gw);
  for (let i = 0; i < grid.length; i++) grid[i] = T(g[i] * 255);
  const up = resizeL(grid, gw, gh, w, h), out = cloneImage(layer), fa = F(amount);
  for (let p = 0; p < w * h; p++) {
    const k = F(1 - F(fa * F(up[p] / 255)));
    for (let ch = 0; ch < 3; ch++) out.data[p * 4 + ch] = u8(F(out.data[p * 4 + ch] * k));
  }
  return out;
}

const scale3 = (c, k) => c.slice(0, 3).map((v) => T(v * k));
const lift3 = (c, k) => c.slice(0, 3).map((v) => Math.min(255, T(v * k)));

// A raised box: base fill, a light top/left edge and a dark bottom/right edge
export function bevelBox(d, [x0, y0, x1, y1], base, cell, radius = 0.04, edge = 0.035) {
  const r = cell * radius, e = Math.max(2, T(cell * edge));
  d.roundedRectangle([x0, y0, x1, y1], r, { fill: [...scale3(base, 0.55), 255] });
  d.roundedRectangle([x0, y0, x1 - e, y1 - e], r, { fill: [...lift3(base, 1.35), 255] });
  d.roundedRectangle([x0 + e, y0 + e, x1 - e, y1 - e], r, { fill: [...base.slice(0, 3), 255] });
}

// A crate seen from above, s = side length in px
export function propCrate(layer, cx, cy, cell, s, kind, seed, label = "") {
  const d = new Draw(layer), box = [cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2];
  if (kind === "wood") {
    bevelBox(d, box, [128, 96, 60], cell);
    for (let i = 1; i < 5; i++) {                                         // planks
      const y = box[1] + (box[3] - box[1]) * i / 5;
      d.line([[box[0] + cell * 0.04, y], [box[2] - cell * 0.04, y]], [86, 62, 38, 255], Math.max(1, T(cell * 0.012)));
    }
    const k = s * 0.22;                                                   // steel corner brackets
    for (const [bx, by, sx, sy] of [[box[0], box[1], 1, 1], [box[2], box[1], -1, 1], [box[0], box[3], 1, -1], [box[2], box[3], -1, -1]])
      d.polygon([[bx, by], [bx + sx * k, by], [bx, by + sy * k]], [150, 154, 158, 255]);
  } else {                                                                // ribbed steel crate
    const base = kind === "steel" ? [74, 92, 76] : [58, 70, 96];
    bevelBox(d, box, base, cell);
    for (let i = 1; i < 6; i++) {
      const x = box[0] + (box[2] - box[0]) * i / 6;
      d.line([[x, box[1] + cell * 0.05], [x, box[3] - cell * 0.05]], [...scale3(base, 0.7), 255], Math.max(1, T(cell * 0.02)));
    }
    if (label) {
      const m = s * 0.18;
      centeredText(d, label, [cx - s / 2 + m, cy - s * 0.2, cx + s / 2 - m, cy + s * 0.2], [225, 205, 150, 255], s * 0.3,
        [30, 32, 34, 230], 0.05);
    }
  }
}

const CRATE_KINDS = ["wood", "wood", "steel", "blue"];
const CRATE_LABELS = ["", "", "04", "12", "27", "SRV", "MED", "FAB", ""];

function crateLayer([w, h], cx, cy, cell, s, kind, label, angle) {
  let layer = newImage("RGBA", w, h);
  propCrate(layer, cx, cy, cell, s, kind, 0, label);
  if (angle) layer = rotate(layer, angle, { center: [cx, cy] });
  return layer;
}

export function clipToHex(layer, cell, cs) {
  const m = maskOf([layer.w, layer.h], cs, cell), out = cloneImage(layer);
  for (let p = 0; p < layer.w * layer.h; p++) out.data[p * 4 + 3] = Math.min(layer.data[p * 4 + 3], m.data[p]);
  return out;
}

// --- plain terrain -------------------------------------------------------------------------------

function tokenWall(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), { w, h } = img;
  const m = maskOf([w, h], cs, cell), tile = noiseRgb([w, h], [88, 93, 98], 5, 1), d = new Draw(tile);
  for (let x = -h; x < w; x += T(cell * 0.18)) d.line([[x, 0], [x + h, h]], [80, 85, 90], 1);   // brushed plating
  const [cx, cy] = cs[0];
  for (const [vx, vy] of hexPoints(cx, cy, cell, 0.22)) {                // rivets
    const r = cell * 0.035;
    d.ellipse([vx - r, vy - r, vx + r, vy + r], { fill: [150, 155, 160] });
  }
  return finish(tile, m, [150, 156, 162, 255], cell, cs, T(cell * 0.05));
}

function tokenBreach(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), { w, h } = img;
  const m = maskOf([w, h], cs, cell), tile = noiseRgb([w, h], [46, 44, 42], 9, 2), d = new Draw(tile);
  const rng = new PyRandom(3), [cx, cy] = cs[0];
  for (let i = 0; i < 14; i++) {                                           // torn plating
    const a = rng.uniform(0, 2 * Math.PI), rad = rng.uniform(0.1, 0.4) * cell;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad, s = rng.uniform(0.05, 0.14) * cell, pts = [];
    for (let k = 0; k < 4; k++) { const px = x + rng.uniform(-s, s); pts.push([px, y + rng.uniform(-s, s)]); }
    d.polygon(pts, rng.choice([[96, 100, 104], [70, 72, 74], [120, 90, 60]]));
  }
  return finish(tile, m, [110, 100, 90, 255], cell, cs, T(cell * 0.03));
}

function tokenDoor(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), { w, h } = img;
  const m = maskOf([w, h], cs, cell), tile = noiseRgb([w, h], [70, 66, 52], 4, 4);
  pasteAt(tile, stripes([w, T(h * 0.3)], T(cell * 0.1)), 0, T(h * 0.35));
  new Draw(tile).line([[w / 2, 0], [w / 2, h]], [20, 20, 20], T(cell * 0.04));  // the seam
  return finish(tile, m, [...HAZARD_Y, 255], cell, cs, T(cell * 0.06));
}

function tokenCover(cell, sizeLabel, big) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), d = new Draw(img), [cx, cy] = cs[0];
  const k = big ? 0.46 : 0.36;
  const box = [cx - cell * k, cy - cell * k * 0.8, cx + cell * k, cy + cell * k * 0.8];
  d.roundedRectangle(box, cell * 0.04, { fill: [64, 70, 58, 255], outline: [68, 170, 68, 255], width: T(cell * 0.05) });
  d.line([[box[0], box[1]], [box[2], box[3]]], [90, 98, 82, 255], T(cell * 0.03));
  d.line([[box[0], box[3]], [box[2], box[1]]], [90, 98, 82, 255], T(cell * 0.03));
  badge(img, sizeLabel, cell, [20, 40, 20, 230], [160, 230, 160]);
  return img;
}

function tokenSoftCover(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), d = new Draw(img), rng = new PyRandom(5), [cx, cy] = cs[0];
  for (let i = 0; i < 9; i++) {                                            // smoke puffs
    const x = cx + rng.uniform(-0.25, 0.25) * cell, y = cy + rng.uniform(-0.25, 0.25) * cell, r = rng.uniform(0.14, 0.24) * cell;
    d.ellipse([x - r, y - r, x + r, y + r], { fill: [150, 156, 150, 120] });
  }
  const pts = hexPoints(cx, cy, cell, 0.05);
  for (let i = 0; i < 6; i++) {                                            // dashed rim
    const a = pts[i], b = pts[(i + 1) % 6];
    for (let t = 0; t < 10; t += 2) {
      const p = [a[0] + (b[0] - a[0]) * t / 10, a[1] + (b[1] - a[1]) * t / 10];
      const q = [a[0] + (b[0] - a[0]) * (t + 1) / 10, a[1] + (b[1] - a[1]) * (t + 1) / 10];
      d.line([p, q], [102, 170, 102, 255], T(cell * 0.04));
    }
  }
  return img;
}

function tokenElevated(cell, height) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), { w, h } = img;
  const out = finish(noiseRgb([w, h], [74, 64, 48], 6, 10 + height), maskOf([w, h], cs, cell), [168, 146, 107, 255], cell, cs, T(cell * 0.05));
  badge(out, "+" + height, cell, [30, 26, 18, 235], [240, 220, 170]);
  return out;
}

// A height marker for raised ground: just "+N" at the upper right of the hex, outlined
function tokenHeight(cell, height) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), d = new Draw(img), f = font(cell * 0.21), [cx, cy] = cs[0];
  const t = "+" + height, tw = d.textLength(t, f);
  const x = cx + cell * 0.2 - tw / 2, y = cy - cell * 0.44, sw = Math.max(2, T(cell * 0.022));
  d.text([x + cell * 0.02, y + cell * 0.02], t, f, [0, 0, 0, 110], { strokeWidth: sw, strokeFill: [0, 0, 0, 110] });
  d.text([x, y], t, f, [238, 238, 242, 235], { strokeWidth: sw, strokeFill: [18, 18, 22, 220] });
  return img;
}

function tokenCoolant(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), { w, h } = img;
  const tile = noiseRgb([w, h], [24, 58, 84], 4, 20), d = new Draw(tile);
  for (let y = T(h * 0.2); y < h; y += T(cell * 0.18)) {                  // ripples
    const pts = [];
    for (let x = 0; x < w; x += 2) pts.push([x, y + Math.sin(x / (cell * 0.12)) * cell * 0.03]);
    d.line(pts, [70, 150, 190], Math.max(1, T(cell * 0.02)));
  }
  return finish(tile, maskOf([w, h], cs, cell), [68, 136, 204, 255], cell, cs, T(cell * 0.04));
}

function tokenLadder(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), d = new Draw(img), [cx, cy] = cs[0];
  const x1 = cx - cell * 0.18, x2 = cx + cell * 0.18, top = cy - cell * 0.42, bot = cy + cell * 0.42;
  for (const x of [x1, x2]) d.line([[x, top], [x, bot]], [...HAZARD_Y, 255], T(cell * 0.06));
  for (let y = top + cell * 0.08; y < bot; y += cell * 0.14) d.line([[x1, y], [x2, y]], [200, 200, 200, 255], T(cell * 0.04));
  return img;
}

function tokenRubble(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), { w, h } = img;
  const m = maskOf([w, h], cs, cell, 0.04), layer = newImage("RGBA", w, h), d = new Draw(layer);
  const rng = new PyRandom(7), [cx, cy] = cs[0];
  for (let i = 0; i < 60; i++) {
    const x = cx + rng.uniform(-0.45, 0.45) * cell, y = cy + rng.uniform(-0.45, 0.45) * cell, s = rng.uniform(0.05, 0.13) * cell, pts = [];
    for (let k = 0; k < 5; k++) { const px = x + rng.uniform(-s, s); pts.push([px, y + rng.uniform(-s, s)]); }
    d.polygon(pts, rng.choice([[110, 96, 74, 255], [80, 72, 60, 255], [130, 126, 118, 255]]));
  }
  const alpha = newImage("L", w, h);                                       // the layer's alpha inside the hex
  for (let p = 0; p < w * h; p++) alpha.data[p] = blend(m.data[p], 0, layer.data[p * 4 + 3]);
  const out = newImage("RGBA", w, h);
  paste(out, layer, alpha);
  return out;
}

function tokenRock(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), { w, h } = img;
  const tile = noiseRgb([w, h], [40, 38, 36], 10, 30), d = new Draw(tile), rng = new PyRandom(11), [cx, cy] = cs[0];
  for (let i = 0; i < 5; i++) {                                            // cracks
    let x = cx + rng.uniform(-0.3, 0.3) * cell, y = cy + rng.uniform(-0.3, 0.3) * cell;
    const pts = [[x, y]];
    for (let k = 0; k < 4; k++) { x += rng.uniform(-0.15, 0.15) * cell; y += rng.uniform(-0.15, 0.15) * cell; pts.push([x, y]); }
    d.line(pts, [18, 18, 18], Math.max(1, T(cell * 0.02)));
  }
  return finish(tile, maskOf([w, h], cs, cell), [70, 68, 66, 255], cell, cs, T(cell * 0.03));
}

function tokenHazard(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), { w, h } = img;
  const out = finish(noiseRgb([w, h], [92, 26, 26], 6, 40), maskOf([w, h], cs, cell), [204, 68, 68, 255], cell, cs, T(cell * 0.05));
  const d = new Draw(out), [cx, cy] = cs[0], s = cell * 0.28;
  d.polygon([[cx, cy - s], [cx + s, cy + s * 0.75], [cx - s, cy + s * 0.75]], null, { outline: [...HAZARD_Y, 255], width: T(cell * 0.05) });
  d.line([[cx, cy - s * 0.4], [cx, cy + s * 0.25]], [...HAZARD_Y, 255], T(cell * 0.05));
  return out;
}

function tokenCore(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), d = new Draw(img), [cx, cy] = cs[0];
  for (const [k, col] of [[0.44, [60, 64, 70, 255]], [0.36, [255, 150, 40, 255]], [0.27, [255, 200, 90, 255]], [0.16, [255, 245, 210, 255]]]) {
    const r = cell * k;
    d.ellipse([cx - r, cy - r, cx + r, cy + r], { fill: col });
  }
  const r = cell * 0.44;
  d.ellipse([cx - r, cy - r, cx + r, cy + r], { outline: [160, 166, 172, 255], width: T(cell * 0.04) });
  return img;
}

// Reactor containment plating: a stepped inner plate, hex bolts and a radiation trefoil
function tokenCoreArmor(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), { w, h } = img, [cx, cy] = cs[0];
  const tile = noiseRgb([w, h], [44, 47, 52], 4, 60), d = new Draw(tile);
  const inner = hexPoints(cx, cy, cell, 0.14), lw = Math.max(2, T(cell * 0.025));
  d.polygon(inner, [66, 70, 76]);                                          // the raised inner plate
  d.line(inner.slice(0, 4), [104, 110, 116], lw);
  d.line([...inner.slice(3), inner[0]], [30, 32, 36], lw);
  for (const [vx, vy] of hexPoints(cx, cy, cell, 0.25))                   // hex-head bolts
    d.regularPolygon([vx, vy, cell * 0.05], 6, { fill: [120, 124, 128], outline: [28, 30, 32] });
  const r = cell * 0.19;                                                   // the trefoil
  d.ellipse([cx - r, cy - r, cx + r, cy + r], { fill: HAZARD_Y });
  for (let k = 0; k < 3; k++) {
    const a0 = 60 + k * 120;                                               // one blade down, two up
    d.pieslice([cx - r * 0.86, cy - r * 0.86, cx + r * 0.86, cy + r * 0.86], a0, a0 + 60, [22, 22, 22]);
  }
  let rc = r * 0.3;
  d.ellipse([cx - rc, cy - rc, cx + rc, cy + rc], { fill: HAZARD_Y });
  rc = r * 0.2;
  d.ellipse([cx - rc, cy - rc, cx + rc, cy + rc], { fill: [22, 22, 22] });
  return finish(tile, maskOf([w, h], cs, cell), [214, 120, 40, 255], cell, cs, T(cell * 0.06));
}

function tokenTurret(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), d = new Draw(img), [cx, cy] = cs[0], r = cell * 0.26;
  d.line([[cx, cy], [cx, cy - cell * 0.46]], [180, 185, 190, 255], T(cell * 0.09));
  d.ellipse([cx - r, cy - r, cx + r, cy + r], { fill: [84, 90, 96, 255], outline: [204, 68, 68, 255], width: T(cell * 0.05) });
  return img;
}

// Size 2: anchor + the two hexes below it
function tokenRelay(cell) {
  const { img, cs } = tokenCanvas(cell, size2Footprint(cell)), { w, h } = img;
  const out = finish(noiseRgb([w, h], [58, 62, 68], 5, 50), maskOf([w, h], cs, cell), [160, 166, 172, 255], cell, cs, T(cell * 0.04));
  const d = new Draw(out);
  const cx = cs.reduce((s, [x]) => s + x, 0) / 3, cy = cs.reduce((s, [, y]) => s + y, 0) / 3, r = cell * 0.55;
  d.pieslice([cx - r, cy - r, cx + r, cy + r], 200, 340, [190, 196, 202, 255]);     // the dish
  d.line([[cx, cy], [cx, cy - r * 1.05]], [230, 170, 40, 255], T(cell * 0.05));
  d.ellipse([cx - cell * 0.08, cy - r * 1.05 - cell * 0.08, cx + cell * 0.08, cy - r * 1.05 + cell * 0.08], { fill: [230, 60, 40, 255] });
  return out;
}

// --- props --------------------------------------------------------------------------------------

function tokenCrate(cell, seed = 0, kind = null, label = null) {
  const rng = new PyRandom(100 + seed), { img, cs } = tokenCanvas(cell, [[0, 0]]);
  kind = kind || rng.choice(CRATE_KINDS);
  label = label === null ? rng.choice(CRATE_LABELS) : label;
  if (kind === "wood") label = "";                                          // stencils go on the steel crates
  const s = cell * rng.uniform(0.58, 0.68);
  const layer = crateLayer([img.w, img.h], cs[0][0], cs[0][1], cell, s, kind, label, rng.uniform(-10, 10));
  return withShadow(grime(layer, cell, 3 + seed), cell);
}

function tokenCrateStack(cell, seed = 0) {
  const rng = new PyRandom(200 + seed), { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0], size = [img.w, img.h];
  const k1 = rng.choice(["steel", "blue", "wood"]), k2 = rng.choice(["wood", "steel"]);
  let s = cell * rng.uniform(0.62, 0.7);
  const bottom = crateLayer(size, cx - cell * 0.05, cy + cell * 0.05, cell, s, k1, "", rng.uniform(-8, 8));
  const tx = cx + cell * rng.uniform(0.02, 0.1), ty = cy - cell * rng.uniform(0.02, 0.1);
  s = cell * rng.uniform(0.4, 0.48);
  const top = crateLayer(size, tx, ty, cell, s, k2, "", rng.uniform(-20, 20));
  return alphaComposite(withShadow(grime(bottom, cell, 4 + seed), cell), withShadow(top, cell, 0.06, 0.08, 0.04, 0.7));
}

// 3-4 crates of mixed sizes huddled over the three hexes, one stacked on top
function tokenCratePileSize2(cell, seed = 0) {
  const rng = new PyRandom(300 + seed), { img, cs } = tokenCanvas(cell, size2Footprint(cell)), size = [img.w, img.h];
  const gx = cs.reduce((s, [x]) => s + x, 0) / 3, gy = cs.reduce((s, [, y]) => s + y, 0) / 3;
  let spots = cs.map(([x, y]) => [gx + (x - gx) * 0.78, gy + (y - gy) * 0.78]);   // pulled toward the middle
  spots.push([gx, gy + cell * 0.18]);
  rng.shuffle(spots);
  spots = spots.slice(0, rng.randint(3, 4));
  let out = newImage("RGBA", img.w, img.h);
  const plain = [];
  spots.forEach(([x, y], i) => {
    const last = i === spots.length - 1;
    const kind = last ? rng.choice(["steel", "blue"]) : rng.choice(CRATE_KINDS);
    const label = last ? ["SRV", "MED", "27", "FAB", "04", "12"][seed % 6] : "";   // differs per variant
    x = x + rng.uniform(-0.05, 0.05) * cell; y = y + rng.uniform(-0.05, 0.05) * cell;
    const s = cell * rng.uniform(0.52, 0.66);
    const layer = crateLayer(size, x, y, cell, s, kind, label, rng.uniform(-12, 12));
    out = alphaComposite(out, withShadow(grime(layer, cell, 10 * seed + i), cell));
    if (!last) plain.push([x, y]);
  });
  const [x, y] = rng.choice(plain);
  const kind = rng.choice(["wood", "steel"]);
  const top = crateLayer(size, x + cell * 0.04, y - cell * 0.04, cell, cell * 0.4, kind, "", rng.uniform(-25, 25));
  return alphaComposite(out, withShadow(top, cell, 0.06, 0.08, 0.04, 0.7));
}

const CONTAINERS = [[[150, 64, 40], "SRV-2891"], [[52, 82, 120], "COLONY STORES"], [[86, 98, 62], "SEED STOCK"], [[110, 112, 114], "HAB PARTS"]];

// A cargo container across two hexes side by side
function tokenContainer2hex(cell, seed = 0) {
  const [base, stencil] = CONTAINERS[seed % CONTAINERS.length], [sx] = geometry(cell);
  const { img, cs } = tokenCanvas(cell, [[0, 0], [sx, 0]]), layer = newImage("RGBA", img.w, img.h), d = new Draw(layer);
  const [[x0, y0], [x1]] = cs;
  const box = [x0 - cell * 0.44, y0 - cell * 0.3, x1 + cell * 0.44, y0 + cell * 0.3];
  bevelBox(d, box, base, cell, 0.02);
  for (let x = box[0] + cell * 0.08; x < box[2] - cell * 0.05; x += cell * 0.09)   // corrugation
    d.line([[x, box[1] + cell * 0.04], [x, box[3] - cell * 0.04]], [...scale3(base, 0.75), 255], Math.max(1, T(cell * 0.02)));
  centeredText(d, stencil, [box[0] + cell * 0.1, box[1] + cell * 0.12, box[2] - cell * 0.1, box[3] - cell * 0.12],
    [230, 214, 180, 255], cell * 0.2, null, 0.02);
  return withShadow(grime(layer, cell, 12 + seed, 0.25), cell);
}

const BARREL_COLOURS = [[150, 52, 36], [46, 70, 110], [196, 150, 36], [70, 90, 60], [120, 124, 128]];

function tokenBarrels(cell, seed = 0) {
  const rng = new PyRandom(400 + seed), { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0];
  const layer = newImage("RGBA", img.w, img.h), d = new Draw(layer);
  const spots = [[-0.17, -0.12], [0.17, -0.1], [0.0, 0.18], [-0.2, 0.2], [0.22, 0.17]];
  rng.shuffle(spots);
  for (const [ox, oy] of spots.slice(0, rng.randint(2, 4))) {
    const col = rng.choice(BARREL_COLOURS);
    const x = cx + ox * cell, y = cy + oy * cell, r = cell * rng.uniform(0.15, 0.18);
    d.ellipse([x - r, y - r, x + r, y + r], { fill: [...scale3(col, 0.6), 255] });
    d.ellipse([x - r * 0.88, y - r * 0.88, x + r * 0.88, y + r * 0.88], { fill: [...col, 255] });
    d.ellipse([x - r * 0.55, y - r * 0.55, x + r * 0.55, y + r * 0.55], { outline: [...scale3(col, 0.7), 255], width: Math.max(1, T(cell * 0.015)) });
    const b = r * 0.16;
    d.ellipse([x + r * 0.35 - b, y - r * 0.35 - b, x + r * 0.35 + b, y - r * 0.35 + b], { fill: [40, 40, 40, 255] });
  }
  return withShadow(grime(layer, cell, 31 + seed, 0.25), cell);
}

// --- fortifications ------------------------------------------------------------------------------

// One sandbag seen from above: a lumpy pillow pinched at its tied end, shaded puffy, burlap weave
function sandbag(length, width, base, rng) {
  const pad = 6, w = T(length + 2 * pad), h = T(width + 2 * pad), cx = w / 2, cy = h / 2, pts = [];
  for (let i = 0; i < 48; i++) {
    const th = 2 * Math.PI * i / 48, c = Math.cos(th), s = Math.sin(th), rx = length / 2, ry = width / 2;
    let r = (Math.abs(c / rx) ** 3.2 + Math.abs(s / ry) ** 3.2) ** (-1 / 3.2);    // rounded-rectangle outline
    const pinch = 1 - 0.28 * Math.max(0.0, -c) ** 6;                          // narrower at the tied end
    r *= rng.uniform(0.96, 1.03);
    pts.push([cx + c * r, cy + s * r * pinch]);
  }
  const mask = newImage("L", w, h);
  new Draw(mask).polygon(pts, 255);
  const puff = gaussianBlur(mask, width * 0.22);
  const t = -width * 0.12;                                                   // the light blob, shifted up-left
  const lit = scaleAffineNearest(gaussianBlur(mask, width * 0.18), w, h, [1, 0, t, 0, 1, t]);
  rng.uniform(-1, 1);                                                         // (drawn by the Python for the weave, times 0)
  const grain = new NpRandom(rng.randint(0, 10 ** 6));
  const out = newImage("RGBA", w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x, pf = F(puff.data[p] / 255), lf = F(lit.data[p] / 255);
      const shade = F(F(0.62 + F(0.38 * F(pf ** 0.6))) + F(0.22 * F(pf - lf)));
      const weave = 1 + 0.06 * Math.sign(Math.sin(x * 1.9) * Math.sin(y * 1.9));
      const k = shade * weave * grain.normal(1.0, 0.05);
      for (let ch = 0; ch < 3; ch++) out.data[p * 4 + ch] = u8(F(base[ch]) * k);
      out.data[p * 4 + 3] = T(F(mask.data[p] / 255) * 255);
    }
  const d = new Draw(out), fx = cx + rng.uniform(-0.15, 0.2) * length;       // a fold across the bag
  d.line([[fx - width * 0.1, cy - width * 0.32], [fx + width * 0.08, cy + width * 0.3]], [...scale3(base, 0.8), 90], Math.max(1, T(width * 0.04)));
  const tx = cx - length / 2 + 2;                                             // the tied tuft
  d.ellipse([tx - width * 0.07, cy - width * 0.06, tx + width * 0.05, cy + width * 0.06], { fill: [...scale3(base, 0.85), 200] });
  return out;
}

const SANDBAG_TONES = [[172, 154, 112], [164, 146, 104], [178, 160, 118], [156, 140, 100]];

function placeBag(layer, x, y, angle, cell, rng, toneBoost = 1.0, scale = 1.0) {
  const tone = rng.choice(SANDBAG_TONES);
  const base = tone.map((c) => Math.min(255, T(c * toneBoost * rng.uniform(0.96, 1.04))));
  const length = cell * rng.uniform(0.33, 0.36) * scale, width = cell * rng.uniform(0.2, 0.22) * scale;
  const bag = rotate(sandbag(length, width, base, rng), angle, { expand: true });
  alphaCompositeAt(layer, bag, T(x - bag.w / 2), T(y - bag.h / 2));
}

// A sandbag wall segment running east-west across the hex: two courses, the top one offset
function tokenSandbags(cell, seed = 0) {
  const rng = new PyRandom(500 + seed), { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0];
  const lower = newImage("RGBA", img.w, img.h), upper = newImage("RGBA", img.w, img.h);
  for (const x of [-0.31, 0.0, 0.31])                                         // the lower course: 3 bags x 2 rows
    for (const oy of [-0.1, 0.1]) {
      const px = cx + x * cell + rng.uniform(-1.5, 1.5), py = cy + oy * cell + rng.uniform(-1.5, 1.5);
      placeBag(lower, px, py, rng.uniform(-5, 5), cell, rng, 0.88);
    }
  for (const x of [-0.16, 0.16]) {                                            // the top course, offset half a bag
    const px = cx + x * cell + rng.uniform(-1.5, 1.5), py = cy + rng.uniform(-1.5, 1.5);
    placeBag(upper, px, py, rng.uniform(-6, 6), cell, rng, 1.04);
  }
  return alphaComposite(withShadow(lower, cell, 0.03, 0.06, 0.04, 0.6), withShadow(upper, cell, 0.035, 0.05, 0.03, 0.55));
}

// A curved sandbag nest (a gun position), open to the south
function tokenSandbagNest(cell, seed = 0) {
  const rng = new PyRandom(550 + seed), { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0], R = cell * 0.33;
  const lower = newImage("RGBA", img.w, img.h), upper = newImage("RGBA", img.w, img.h);
  for (const [layer, n, boost, rr, lo, hi] of [[lower, 7, 0.88, 1.0, 190, 350], [upper, 4, 1.04, 0.98, 215, 325]])
    for (let i = 0; i < n; i++) {
      const a = radians(lo + (hi - lo) * i / (n - 1));                        // from west, over north, to east
      const x = cx + Math.cos(a) * R * rr, y = cy + Math.sin(a) * R * rr + cell * 0.1;
      placeBag(layer, x, y, -degrees(a) - 90 + rng.uniform(-5, 5), cell, rng, boost, 0.92);
    }
  return alphaComposite(withShadow(lower, cell, 0.03, 0.06, 0.04, 0.6), withShadow(upper, cell, 0.035, 0.05, 0.03, 0.55));
}

// Steel tank traps ('Czech hedgehogs'): one big, or a cluster of three
function tokenHedgehog(cell, seed = 0) {
  const rng = new PyRandom(600 + seed), { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0];
  let layer = newImage("RGBA", img.w, img.h);
  const d = new Draw(layer);
  const spots = seed % 2 === 0 ? [[0, 0, 0.4]] : [[-0.17, -0.13, 0.25], [0.2, -0.06, 0.24], [-0.03, 0.2, 0.25]];
  for (const [ox, oy, ln] of spots) {
    const x = cx + ox * cell, y = cy + oy * cell, rot = rng.uniform(0, 60);
    const steel = [108, 100, 92].map((c) => T(c * rng.uniform(0.85, 1.05)));
    const wd = Math.max(4, cell * 0.13 * ln / 0.4);
    for (let k = 0; k < 3; k++) {
      const a = radians(rot + k * 60), ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, L = ln * cell;
      const quad = [[x - ux * L + nx * wd / 2, y - uy * L + ny * wd / 2], [x + ux * L + nx * wd / 2, y + uy * L + ny * wd / 2],
        [x + ux * L - nx * wd / 2, y + uy * L - ny * wd / 2], [x - ux * L - nx * wd / 2, y - uy * L - ny * wd / 2]];
      d.polygon(quad, [30, 28, 26, 255]);
      const half = [quad[0], quad[1], [(quad[1][0] + quad[2][0]) / 2, (quad[1][1] + quad[2][1]) / 2],
        [(quad[0][0] + quad[3][0]) / 2, (quad[0][1] + quad[3][1]) / 2]];
      const pull = (pts) => pts.map(([px, py]) => [px * 0.97 + x * 0.03, py * 0.97 + y * 0.03]);
      d.polygon(pull(quad), [...steel, 255]);
      d.polygon(pull(half), [...lift3(steel, 1.3), 255]);                      // lit flange
    }
    const b = wd * 0.45;
    d.ellipse([x - b, y - b, x + b, y + b], { fill: [56, 52, 48, 255] });
  }
  layer = grime(layer, cell, 70 + seed, 0.4);                                  // rust
  return withShadow(layer, cell, 0.06, 0.09, 0.04, 0.7);
}

// Concrete tetrapods from above: three thick tapering legs round a hub
function tokenTetrapod(cell, seed = 0) {
  const rng = new PyRandom(700 + seed), { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0];
  let out = newImage("RGBA", img.w, img.h);
  const spots = seed % 2 === 0 ? [[0, 0, 1.0]] : [[-0.15, -0.1, 0.72], [0.16, 0.13, 0.72]];
  spots.forEach(([ox, oy, k], n) => {
    let layer = newImage("RGBA", img.w, img.h);
    const d = new Draw(layer), x = cx + ox * cell, y = cy + oy * cell, rot = rng.uniform(0, 120);
    const conc = [150, 148, 140].map((c) => T(c * rng.uniform(0.92, 1.04)));
    const dark = [...scale3(conc, 0.5), 255];
    const leg = cell * 0.36 * k, root = cell * 0.2 * k, tip = cell * 0.11 * k, legs = [];
    for (let kk = 0; kk < 3; kk++) {
      const a = radians(rot + kk * 120), ux = Math.cos(a), uy = Math.sin(a), nx = -Math.sin(a), ny = Math.cos(a);
      const ex = x + ux * leg, ey = y + uy * leg;
      legs.push([[[x + nx * root, y + ny * root], [ex + nx * tip, ey + ny * tip], [ex - nx * tip, ey - ny * tip], [x - nx * root, y - ny * root]], [ex, ey]]);
    }
    for (const [poly, [ex, ey]] of legs) {                                    // outline pass
      d.polygon(poly.map(([px, py]) => [px + 2, py + 2]), dark);
      d.ellipse([ex - tip - 2, ey - tip - 2, ex + tip + 2, ey + tip + 2], { fill: dark });
    }
    legs.forEach(([poly, [ex, ey]], i) => {
      const col = [...lift3(conc, [1.1, 0.95, 0.82][i]), 255];               // each leg lit differently
      d.polygon(poly, col);
      d.ellipse([ex - tip, ey - tip, ex + tip, ey + tip], { fill: col });
    });
    const hub = root * 0.95;
    d.ellipse([x - hub, y - hub, x + hub, y + hub], { fill: [...lift3(conc, 1.2), 255] });
    d.ellipse([x - hub * 0.55, y - hub * 0.55, x + hub * 0.55, y + hub * 0.55], { fill: [...lift3(conc, 1.3), 255] });
    layer = grime(layer, cell, 80 + seed * 3 + n, 0.3);
    out = alphaComposite(out, withShadow(layer, cell, 0.06, 0.09, 0.05, 0.7));
  });
  return out;
}

// A concertina coil running east-west through the hex, on two stakes; joins with neighbours
function tokenBarbedWire(cell, seed = 0) {
  const rng = new PyRandom(800 + seed), { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0], w = img.w;
  let layer = newImage("RGBA", img.w, img.h);
  const d = new Draw(layer);
  for (const sxp of [cx - cell * 0.3, cx + cell * 0.3])                       // stakes
    d.rectangle([sxp - cell * 0.025, cy - cell * 0.03, sxp + cell * 0.025, cy + cell * 0.03], { fill: [60, 50, 40, 255] });
  const step = cell * 0.075, ry = cell * 0.2;
  for (let x = -step + rng.uniform(0, step); x < w + step; x += step) {
    const rx = step * 1.6, yj = rng.uniform(-0.02, 0.02) * cell;
    d.ellipse([x - rx, cy - ry + yj, x + rx, cy + ry + yj], { outline: [170, 172, 174, 255], width: Math.max(1, T(cell * 0.012)) });
    for (let k = 0; k < 2; k++) {                                              // barbs
      const a = rng.uniform(0, 2 * Math.PI), bx = x + Math.cos(a) * rx, by = cy + yj + Math.sin(a) * ry, s = cell * 0.018;
      d.line([[bx - s, by - s], [bx + s, by + s]], [200, 200, 200, 255], 1);
      d.line([[bx - s, by + s], [bx + s, by - s]], [200, 200, 200, 255], 1);
    }
  }
  layer = clipToHex(layer, cell, cs);
  return withShadow(layer, cell, 0.03, 0.06, 0.02, 0.5);
}

// A cargo loader (Size 2), forks pointing up into the anchor hex, carrying a crate
function tokenForkliftSize2(cell) {
  const { img, cs } = tokenCanvas(cell, size2Footprint(cell)), layer = newImage("RGBA", img.w, img.h), d = new Draw(layer);
  const [[ax, ay]] = cs, cx = ax, bw = cell * 0.86, bh = cell * 0.74, top = ay + cell * 0.36;
  const body = [cx - bw / 2, top, cx + bw / 2, top + bh], wheel = [24, 24, 26, 255];
  for (const wx of [body[0] - cell * 0.12, body[2] - cell * 0.04])            // wheels stick out at the sides
    for (const wy of [body[1] + cell * 0.06, body[3] - cell * 0.28]) {
      d.roundedRectangle([wx, wy, wx + cell * 0.16, wy + cell * 0.24], cell * 0.03, { fill: wheel });
      d.line([[wx + cell * 0.03, wy + cell * 0.12], [wx + cell * 0.13, wy + cell * 0.12]], [60, 60, 62, 255], 2);
    }
  d.rectangle([cx - cell * 0.3, top - cell * 0.12, cx + cell * 0.3, top + cell * 0.02], { fill: [70, 72, 74, 255] });   // mast crossbar
  for (const fx of [cx - cell * 0.22, cx + cell * 0.15]) {                     // forks
    d.rectangle([fx, ay - cell * 0.4, fx + cell * 0.07, top], { fill: [110, 112, 114, 255] });
    d.line([[fx, ay - cell * 0.4], [fx, top]], [150, 152, 154, 255], 2);
  }
  bevelBox(d, body, [206, 158, 38], cell, 0.08);                               // yellow body
  const cab = [cx - cell * 0.24, body[1] + cell * 0.12, cx + cell * 0.24, body[1] + cell * 0.42];
  d.roundedRectangle(cab, cell * 0.05, { fill: [34, 44, 52, 255], outline: [20, 20, 22, 255], width: 2 });
  d.line([[cab[0] + cell * 0.05, cab[1] + cell * 0.06], [cab[2] - cell * 0.1, cab[1] + cell * 0.06]], [120, 150, 170, 255], Math.max(1, T(cell * 0.02)));
  const rear = [body[0] + cell * 0.05, body[3] - cell * 0.13, body[2] - cell * 0.05, body[3] - cell * 0.04];
  alphaCompositeAt(layer, stripes([T(rear[2] - rear[0]), T(rear[3] - rear[1])], T(cell * 0.06)), T(rear[0]), T(rear[1]));
  const r = cell * 0.05, bx = body[2] - cell * 0.13, by = body[1] + cell * 0.1;
  d.ellipse([bx - r, by - r, bx + r, by + r], { fill: [255, 150, 30, 255] });  // amber beacon
  const out = withShadow(grime(layer, cell, 21, 0.22), cell);
  const cargo = newImage("RGBA", img.w, img.h);
  propCrate(cargo, cx - cell * 0.03, ay - cell * 0.1, cell, cell * 0.44, "wood", 22);
  return alphaComposite(out, withShadow(cargo, cell, 0.05, 0.07, 0.04, 0.7));
}

function tokenHatch(cell, open = false) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0], R = cell * 0.42, rIn = cell * 0.31;
  const ring = newImage("L", img.w, img.h), dm = new Draw(ring);
  dm.ellipse([cx - R, cy - R, cx + R, cy + R], { fill: 255 });
  dm.ellipse([cx - rIn, cy - rIn, cx + rIn, cy + rIn], { fill: 0 });
  const out = newImage("RGBA", img.w, img.h);
  paste(out, stripes([img.w, img.h], T(cell * 0.09)), ring);
  const d = new Draw(out);
  d.ellipse([cx - R, cy - R, cx + R, cy + R], { outline: [30, 30, 30, 255], width: Math.max(2, T(cell * 0.02)) });
  if (open) {
    d.ellipse([cx - rIn, cy - rIn, cx + rIn, cy + rIn], { fill: [6, 6, 7, 255] });
    for (let i = 0; i < 3; i++) {                                              // ladder going down
      const y = cy - rIn * 0.5 + i * rIn * 0.45;
      d.line([[cx - rIn * 0.45, y], [cx + rIn * 0.45, y]], [90, 92, 94, 255], Math.max(2, T(cell * 0.03)));
    }
  } else {
    d.ellipse([cx - rIn, cy - rIn, cx + rIn, cy + rIn], { fill: [96, 100, 104, 255], outline: [60, 62, 64, 255], width: Math.max(2, T(cell * 0.02)) });
    for (let k = 0; k < 8; k++) {                                              // bolts
      const a = k * Math.PI / 4, bx = cx + Math.cos(a) * rIn * 0.82, by = cy + Math.sin(a) * rIn * 0.82, b = cell * 0.025;
      d.ellipse([bx - b, by - b, bx + b, by + b], { fill: [150, 154, 158, 255] });
    }
    const hr = rIn * 0.45;                                                     // hand wheel
    d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], { outline: [190, 60, 40, 255], width: Math.max(2, T(cell * 0.04)) });
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI / 3;
      d.line([[cx + Math.cos(a) * hr, cy + Math.sin(a) * hr], [cx - Math.cos(a) * hr, cy - Math.sin(a) * hr]], [190, 60, 40, 255], Math.max(2, T(cell * 0.03)));
    }
  }
  return out;
}

function tokenTerminal(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0], layer = newImage("RGBA", img.w, img.h), d = new Draw(layer);
  const body = [cx - cell * 0.3, cy - cell * 0.22, cx + cell * 0.3, cy + cell * 0.24];
  bevelBox(d, body, [70, 74, 80], cell);
  const scr = [body[0] + cell * 0.06, body[1] + cell * 0.05, body[2] - cell * 0.06, body[1] + cell * 0.22];
  d.rectangle(scr, { fill: [10, 40, 34, 255] });
  for (let i = 0; i < 3; i++) {
    const y = scr[1] + cell * 0.04 + i * cell * 0.045;
    d.line([[scr[0] + cell * 0.03, y], [scr[0] + cell * (0.1 + 0.08 * (i % 2)) + cell * 0.12, y]], [110, 240, 180, 255], Math.max(1, T(cell * 0.015)));
  }
  for (let i = 0; i < 4; i++) {                                                // keys
    const x = body[0] + cell * 0.08 + i * cell * 0.12;
    d.rectangle([x, body[3] - cell * 0.13, x + cell * 0.08, body[3] - cell * 0.07], { fill: [40, 42, 46, 255] });
  }
  return withShadow(grime(layer, cell, 41), cell);
}

// Two pipes running east-west through the hex; tiles with the next hex along a row
function tokenPipes(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0], w = img.w, layer = newImage("RGBA", img.w, img.h), d = new Draw(layer);
  for (const [oy, col] of [[-0.14, [120, 126, 130]], [0.16, [150, 110, 60]]]) {
    const y = cy + oy * cell, r = cell * 0.085;
    d.rectangle([0, y - r, w, y + r], { fill: [...scale3(col, 0.6), 255] });
    d.rectangle([0, y - r, w, y + r * 0.2], { fill: [...col, 255] });
    d.line([[0, y - r * 0.55], [w, y - r * 0.55]], [...lift3(col, 1.4), 255], Math.max(1, T(cell * 0.015)));
    const fx = cx - cell * 0.05;                                               // a flange
    d.rectangle([fx, y - r * 1.35, fx + cell * 0.1, y + r * 1.35], { fill: [...scale3(col, 0.8), 255] });
  }
  const m = maskOf([img.w, img.h], cs, cell), clip = newImage("L", img.w, img.h), out = newImage("RGBA", img.w, img.h);
  for (let p = 0; p < img.w * img.h; p++) clip.data[p] = Math.min(layer.data[p * 4 + 3], m.data[p]);
  paste(out, layer, clip);
  return withShadow(out, cell, 0.02, 0.05, 0.03, 0.5);
}

// The lance's boring drop pod (Size 3), drill head pointing east
function tokenDropPodSize3(cell) {
  const [sx, sy, hw] = geometry(cell);
  const { img, cs } = tokenCanvas(cell, [[0, 0], [sx, 0], [-sx, 0], [hw, sy], [-hw, sy], [hw, -sy], [-hw, -sy]]);
  const layer = newImage("RGBA", img.w, img.h), d = new Draw(layer);
  let [cx, cy] = cs[0];
  cx -= cell * 0.28;                                                           // centre body + drill in the footprint
  const L = cell * 1.05, R = cell * 0.62;
  d.roundedRectangle([cx - L, cy - R, cx + L * 0.55, cy + R], R * 0.5, { fill: [58, 62, 66, 255] });
  d.roundedRectangle([cx - L + cell * 0.05, cy - R + cell * 0.05, cx + L * 0.55 - cell * 0.05, cy + R - cell * 0.08], R * 0.45, { fill: [92, 98, 104, 255] });
  for (let k = 0; k < 4; k++) {                                                // hull bands
    const x = cx - L + cell * 0.3 + k * cell * 0.33;
    d.line([[x, cy - R + cell * 0.06], [x, cy + R - cell * 0.08]], [60, 64, 68, 255], Math.max(2, T(cell * 0.03)));
  }
  const tip = cx + L * 1.05;                                                   // the drill cone
  d.polygon([[cx + L * 0.5, cy - R * 0.95], [tip, cy], [cx + L * 0.5, cy + R * 0.95]], [150, 120, 60, 255]);
  for (let k = 1; k < 6; k++) {                                                // spiral flutes
    const t = k / 6, x0 = cx + L * 0.5 + (tip - cx - L * 0.5) * t;
    d.line([[x0 - cell * 0.12, cy - R * 0.95 * (1 - t)], [x0 + cell * 0.04, cy + R * 0.95 * (1 - t)]], [96, 74, 36, 255], Math.max(2, T(cell * 0.03)));
  }
  alphaCompositeAt(layer, stripes([T(cell * 0.18), T(R * 1.7)], T(cell * 0.07)), T(cx - L + cell * 0.1), T(cy - R * 0.85));
  const hull = [cx - L + cell * 0.32, cy - R * 0.4, cx + L * 0.5 - cell * 0.05, cy + R * 0.4];   // between the stripes and the drill
  centeredText(d, "PATHFINDER", hull, [220, 220, 214, 255], cell * 0.16, null, 0.04);
  return withShadow(grime(layer, cell, 51, 0.3), cell, 0.06, 0.09, 0.06, 0.7);
}

// --- the registry, in roll20_maps.TOKENS order --------------------------------------------------------

export const TOKENS = {
  wall: tokenWall,
  wall_breached: tokenBreach,
  door: tokenDoor,
  cover_hard_size1: (c) => tokenCover(c, "1", false),
  cover_hard_size2: (c) => tokenCover(c, "2", true),
  cover_soft: tokenSoftCover,
  "elevated_+1": (c) => tokenElevated(c, 1),
  "elevated_+2": (c) => tokenElevated(c, 2),
  "elevated_+3": (c) => tokenElevated(c, 3),
  "elevated_+4": (c) => tokenElevated(c, 4),
  "height_+1": (c) => tokenHeight(c, 1),
  "height_+2": (c) => tokenHeight(c, 2),
  "height_+3": (c) => tokenHeight(c, 3),
  "height_+4": (c) => tokenHeight(c, 4),
  "height_+5": (c) => tokenHeight(c, 5),
  coolant: tokenCoolant,
  ladder: tokenLadder,
  rubble_difficult: tokenRubble,
  rock_obstruction: tokenRock,
  hazard_dangerous: tokenHazard,
  reactor_core: tokenCore,
  reactor_core_armor: tokenCoreArmor,
  turret: tokenTurret,
  relay_size2: tokenRelay,
  forklift_size2: tokenForkliftSize2,
  hatch: tokenHatch,
  hatch_open: (c) => tokenHatch(c, true),
  terminal: tokenTerminal,
  pipes: tokenPipes,
  drop_pod_size3: tokenDropPodSize3,
};
// Seeded variants, so repeats on one map don't look copy-pasted
const VARIANTS = [["crate", tokenCrate, 6], ["crate_stack", tokenCrateStack, 3], ["crate_pile_size2", tokenCratePileSize2, 4],
  ["container_2hex", tokenContainer2hex, 4], ["barrels", tokenBarrels, 3], ["sandbags", tokenSandbags, 3],
  ["sandbag_nest", tokenSandbagNest, 2], ["tank_trap_hedgehog", tokenHedgehog, 2], ["tank_trap_tetrapod", tokenTetrapod, 2],
  ["barbed_wire", tokenBarbedWire, 2]];
for (const [name, fn, n] of VARIANTS) for (let i = 0; i < n; i++) TOKENS[`${name}_v${i + 1}`] = (c) => fn(c, i);

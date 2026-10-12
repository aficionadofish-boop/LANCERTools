// Freight Tunnel tokens (names start fl_): an ancient ship's freight train, forge-world style: grimy, oily
// steel tread plate on heavy riveted iron girders banded with hazard stripes. One-hex deck tiles (so any
// piece can be destroyed), the cargo on them, and the locomotive at the head.
//
// Deck tiles join across neighbours. The diamond tread is laid on a lattice that repeats exactly from one
// hex to the next in every direction (bars every 1/6 hex along a row, rows of bars every 1/6 of a hex row,
// alternate rows shifted half a bar), so a deck reads as one surface; steel lashing rails run along the
// row boundaries and plate seams up the hex sides. A wagon's long sides are straight (an edge tile is cut
// flat at its shoulder line, where the next row's points meet), its ends step along the hex sides. With five
// rows the even rows stand out half a hex at the west end and the odd rows at the east end. Every tile is
// drawn for its place (north/south side, west/east end): none need rotating, so the light always falls
// from the north-west.

import { NpRandom, PyRandom } from "../rng.js?v=4f137b6395";
import { newImage, Draw, alphaComposite, alphaCompositeAt, paste, gaussianBlur, rotate, u8 } from "../raster.js?v=4f137b6395";
import { geometry, hexPoints } from "../maps/geometry.js?v=4f137b6395";
import { maskOf, stripes } from "../maps/common.js?v=4f137b6395";
import { tokenCanvas, grime } from "./kit.js?v=4f137b6395";
import { groundShadow } from "./shadow.js?v=4f137b6395";
import { fblur, drapeTarp } from "./training.js?v=4f137b6395";
import { layerFor, row2, fine, fill, addCyl, addBox, project, box, chips } from "./depot.js?v=4f137b6395";

const T = Math.trunc;
const sh = (c, k) => c.map((v) => Math.max(0, Math.min(255, T(v * k))));
const A = (c, a = 255) => [...c, a];
const shadowed = (lay, cell) => groundShadow(lay, cell);
const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x27d4eb2f, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; };

const PLATE = [102, 96, 86];                          // the deck: worn steel, warm with old grime
const BAR_LIT = [150, 144, 132], BAR_DARK = [44, 42, 40];
const RAIL = [124, 126, 130], RAIL_LIT = [182, 184, 188], RAIL_DARK = [40, 40, 44];
const IRON = [58, 56, 54], IRON_LIT = [104, 100, 96], IRON_DARK = [24, 22, 22];
const BRASS = [176, 140, 70];
const HAZ = [[222, 172, 40], [24, 22, 20]];
const hazW = (cell) => Math.max(3, Math.round(cell / 20));   // a stripe width whose period divides a hex: no jumps between tiles
const HAZ_RED = [192, 40, 32], HAZ_ORANGE = [232, 124, 36], CREAM = [232, 224, 202], YELLOW = [224, 174, 42], WHITE = [240, 238, 232];

// --- the deck -------------------------------------------------------------------------------------------------

function treadBars(d, cx, cy, w, h, cell, sy) {
  const p = cell / 6, q = sy / 6, L = p * 0.34;
  for (let j = Math.floor(-cy / q) - 1; j <= Math.ceil((h - cy) / q) + 1; j++)
    for (let i = Math.floor((-cx - j * p / 2) / p) - 1; i <= Math.ceil((w - cx - j * p / 2) / p) + 1; i++) {
      const x = cx + i * p + j * p / 2, y = cy + j * q, s = ((i + j) % 2 + 2) % 2 ? 1 : -1;
      d.line([[x - L + 1.5, y - s * L * 0.55 + 1.5], [x + L + 1.5, y + s * L * 0.55 + 1.5]], A(BAR_DARK), 3);
      d.line([[x - L, y - s * L * 0.55], [x + L, y + s * L * 0.55]], A(BAR_LIT), 3);
    }
}

function lashRail(d, w, y, cx, cell) {                                           // a raised lashing rail on a row boundary
  const t = cell * 0.04;
  d.rectangle([0, y - t, w, y + t], { fill: A(RAIL) });
  d.rectangle([0, y - t, w, y - t * 0.4], { fill: A(RAIL_LIT) });
  d.rectangle([0, y + t * 0.55, w, y + t], { fill: A(RAIL_DARK) });
  for (let x = cx - 3 * cell; x < w + cell; x += cell / 3) d.rectangle([x - cell * 0.05, y - t * 0.15, x + cell * 0.05, y + t * 0.3], { fill: A([30, 30, 32]) });   // tie-down slots
}

function deckSurface(size, cs, cell, variant) {
  const [w, h] = size, [, sy, hw] = geometry(cell), [cx, cy] = cs[0];
  let img = newImage("RGBA", w, h);
  const g = new NpRandom(500 + variant);
  for (let p = 0; p < w * h; p++) { const v = g.normal(0, 3.5); for (let k = 0; k < 3; k++) img.data[p * 4 + k] = u8(PLATE[k] + v); img.data[p * 4 + 3] = 255; }
  let d = new Draw(img);
  treadBars(d, cx, cy, w, h, cell, sy);
  for (const dx of [-hw, hw]) d.rectangle([cx + dx - 1.5, cy - sy / 2, cx + dx + 1.5, cy + sy / 2], { fill: A([40, 38, 36]) });   // plate seams, brick-laid
  for (const dy of [-sy, sy]) d.rectangle([cx - 1.5, cy + dy - sy / 2, cx + 1.5, cy + dy + sy / 2], { fill: A([40, 38, 36]) });
  for (const [x, y0] of [[cx - hw, cy - sy / 2], [cx + hw, cy - sy / 2], [cx, cy - sy * 1.5], [cx, cy + sy / 2]])   // rivets down each seam
    for (let k = 1; k < 6; k++) { const y = y0 + (sy * k) / 6; for (const s of [-1, 1]) d.ellipse([x + s * 5 - 2, y - 2, x + s * 5 + 2, y + 2], { fill: A([136, 130, 120]) }); }
  for (const y of [cy - sy / 2, cy + sy / 2]) lashRail(d, w, y, cx, cell);
  const oil = newImage("RGBA", w, h), od = new Draw(oil), r = new PyRandom(520 + variant);
  for (let i = 0; i < 7; i++) {                                                   // oil and grime: dark pools, smeared lengthwise
    const x = r.uniform(0, w), y = r.uniform(0, h), rx = cell * r.uniform(0.12, 0.42), ry = rx * r.uniform(0.25, 0.55);
    od.ellipse([x - rx, y - ry, x + rx, y + ry], { fill: [16, 14, 12, r.randint(40, 90)] });
  }
  for (let i = 0; i < 40; i++) {                                                  // rust bloom
    const x = r.uniform(0, w), y = r.uniform(0, h), s = cell * r.uniform(0.01, 0.04);
    od.ellipse([x - s, y - s * 0.7, x + s, y + s * 0.7], { fill: [120, 62, 30, r.randint(40, 90)] });
  }
  img = alphaComposite(img, gaussianBlur(oil, cell * 0.03));
  return grime(img, cell, 530 + variant, 0.05);
}

// a heavy iron girder along a line: hazard-striped top band, brass rivets, lit from the north
function girder(img, x0, x1, y0, y1, cell, seed) {
  const d = new Draw(img), t = y1 - y0;
  d.rectangle([x0, y0, x1, y1], { fill: A(IRON) });
  const band = newImage("L", img.w, img.h);
  new Draw(band).rectangle([x0, y0 + t * 0.22, x1, y0 + t * 0.62], { fill: 255 });
  paste(img, stripes([img.w, img.h], hazW(cell), HAZ), band);
  d.rectangle([x0, y0, x1, y0 + t * 0.14], { fill: A(IRON_LIT) });
  d.rectangle([x0, y1 - t * 0.14, x1, y1], { fill: A(IRON_DARK) });
  for (let x = x0 + cell * 0.08; x < x1; x += cell / 6) for (const yy of [y0 + t * 0.14, y0 + t * 0.78]) {
    d.ellipse([x - 2.5, yy - 2, x + 2.5, yy + 3], { fill: A(sh(BRASS, 0.6)) });
    d.ellipse([x - 2.5, yy - 2.5, x + 2, yy + 2], { fill: A(BRASS) });
  }
}

// the end beam on hex edges (0 = north-east, clockwise; 4 = west): the same iron with hazard stripes
function endBeam(img, pts, cs, edges, cell) {
  const [cx, cy] = cs[0], k = 0.22, band = newImage("L", img.w, img.h), bd = new Draw(band), inner = newImage("L", img.w, img.h), id = new Draw(inner);
  const lerpP = (a, f) => [a[0] + (cx - a[0]) * f, a[1] + (cy - a[1]) * f];
  for (const i of edges) {
    const a = pts[i], b = pts[(i + 1) % 6];
    bd.polygon([a, b, lerpP(b, k), lerpP(a, k)], 255);
    id.polygon([lerpP(a, k * 0.25), lerpP(b, k * 0.25), lerpP(b, k * 0.7), lerpP(a, k * 0.7)], 255);
  }
  const iron = newImage("RGBA", img.w, img.h);
  new Draw(iron).rectangle([0, 0, img.w, img.h], { fill: A(IRON) });
  paste(img, iron, band);
  paste(img, stripes([img.w, img.h], hazW(cell), HAZ), inner);
  const d = new Draw(img), lw = Math.max(2, T(cell * 0.018));
  for (const i of edges) {
    const a = pts[i], b = pts[(i + 1) % 6];
    d.line([a, b], A(IRON_DARK), lw * 2);
    d.line([lerpP(a, k), lerpP(b, k)], A(IRON_LIT), lw);
    for (let f = 0.15; f < 0.95; f += 0.23) { const m = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], q = lerpP(m, k * 0.85); d.ellipse([q[0] - 2.5, q[1] - 2.5, q[0] + 2.5, q[1] + 2.5], { fill: A(BRASS) }); }
  }
  return img;
}

// A deck tile. ends: hex edges carrying the end beam; side: "n" / "s" = a long side, cut flat
function tokenDeck(cell, variant = 0, { ends = [], side = null } = {}) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0], size = [img.w, img.h];
  const [, , hw, qh] = geometry(cell), ys = Math.round(cy - qh), yn = Math.round(cy + qh);   // whole pixels: every tile cuts on the same row
  let tile = deckSurface(size, cs, cell, variant);
  const pts = hexPoints(cx, cy, cell);
  if (ends.length) tile = endBeam(tile, pts, cs, ends, cell);
  const m = maskOf(size, cs, cell, -0.03), md = new Draw(m);                         // bleeds a little under its neighbours: no seams
  if (side === "n") md.rectangle([0, 0, img.w, ys - 1], { fill: 0 });
  if (side === "s") md.rectangle([0, yn, img.w, img.h], { fill: 0 });
  let out = newImage("RGBA", img.w, img.h);
  paste(out, tile, m);
  const t = Math.round(cell * 0.15);
  if (side === "n") girder(out, 0, img.w, ys, ys + t, cell, variant);
  if (side === "s") girder(out, 0, img.w, yn - t, yn, cell, variant);
  if (side) {                                                                      // keep the girder inside the tile's own column
    const clip = maskOf(size, cs, cell, -0.03), cd = new Draw(clip);
    cd.rectangle([0, side === "n" ? ys : yn - t, img.w, side === "n" ? ys + t : yn], { fill: 255 });
    cd.rectangle([0, 0, cx - hw - 1, img.h], { fill: 0 }); cd.rectangle([cx + hw + 1, 0, img.w, img.h], { fill: 0 });
    for (let p = 0; p < out.w * out.h; p++) if (!clip.data[p] && !m.data[p]) out.data[p * 4 + 3] = 0;
  }
  out = chips(out, 550 + variant, 10, cell, [30, 26, 22]);
  if (side) {                                                                      // the gloom under the wagon's edge, past the girder
    const g0 = newImage("RGBA", img.w, img.h), gd = new Draw(g0), y = side === "n" ? ys : yn, s = side === "n" ? -1 : 1;
    gd.rectangle([cx - hw, Math.min(y, y + s * cell * 0.12), cx + hw, Math.max(y, y + s * cell * 0.12)], { fill: [6, 6, 8, 130] });
    const soft = gaussianBlur(g0, cell * 0.04);
    for (let p = 0; p < soft.w * soft.h; p++) if (out.data[p * 4 + 3]) soft.data[p * 4 + 3] = 0;
    return alphaComposite(soft, out);
  }
  return out;
}

// A destroyed deck tile: a hole torn through the plate, its edges petalled down and scorched, two broken ribs
// across it glowing where they snapped, smoke rising
function tokenDeckHoled(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0], size = [img.w, img.h], r = new PyRandom(560);
  let tile = deckSurface(size, cs, cell, 13);
  const q = [];
  for (let i = 0; i < 18; i++) {                                                    // the torn outline: jagged
    const a = (2 * Math.PI * i) / 18, R = cell * (i % 2 ? r.uniform(0.26, 0.33) : r.uniform(0.36, 0.44));
    q.push([cx + Math.cos(a) * R * 1.1, cy + Math.sin(a) * R * 0.9]);
  }
  const scorch = newImage("RGBA", img.w, img.h), sd = new Draw(scorch);                // scorch round it
  sd.polygon(q.map(([x, y]) => [cx + (x - cx) * 1.7, cy + (y - cy) * 1.7]), [14, 12, 10, 160]);
  tile = alphaComposite(tile, gaussianBlur(scorch, cell * 0.08));
  const d = new Draw(tile);
  for (let i = 0; i < q.length; i += 2) {                                            // petals: plate bent down into the hole
    const a = q[i], b = q[(i + 1) % q.length], c = q[(i + 2) % q.length], tip = [cx + (b[0] - cx) * 0.55, cy + (b[1] - cy) * 0.55];
    d.polygon([a, c, tip], A(sh(PLATE, a[1] < cy ? 0.55 : 0.85)));
    d.line([a, tip, c], A(sh(PLATE, 1.25)), 2);
  }
  const m = maskOf(size, cs, cell, -0.03), md = new Draw(m);
  md.polygon(q.map(([x, y]) => [cx + (x - cx) * 0.7, cy + (y - cy) * 0.7]), 0);      // through to the track bed
  let out = newImage("RGBA", img.w, img.h);
  paste(out, tile, m);
  const od = new Draw(out), glow = newImage("RGBA", img.w, img.h), gd = new Draw(glow);
  for (let i = 0; i < 7; i++) {                                                         // broken reinforcing bars sticking in from the edge
    const ang = (2 * Math.PI * i) / 7 + r.uniform(-0.25, 0.25), R0 = cell * 0.4, len = cell * r.uniform(0.12, 0.24), bend = r.uniform(-0.35, 0.35);
    const x0 = cx + Math.cos(ang) * R0 * 1.1, y0 = cy + Math.sin(ang) * R0 * 0.9;
    const xm = x0 - Math.cos(ang) * len * 0.55, ym = y0 - Math.sin(ang) * len * 0.5;
    const x1 = xm - Math.cos(ang + bend) * len * 0.45, y1 = ym - Math.sin(ang + bend) * len * 0.45 + len * 0.15;   // sagging down into the hole
    const bw = Math.max(3, T(cell * 0.022));
    od.line([[x0, y0 + 2], [xm, ym + 2], [x1, y1 + 2]], A([18, 16, 14]), bw + 2);
    od.line([[x0, y0], [xm, ym], [x1, y1]], A([96, 90, 84]), bw);
    od.line([[x0, y0 - 1], [xm, ym - 1]], A([150, 144, 134]), 1);
    od.line([[xm, ym], [x1, y1]], A([200, 110, 50]), bw);                                       // heat running up from the tip
    od.ellipse([x1 - bw, y1 - bw, x1 + bw, y1 + bw], { fill: A([255, 214, 130]) });             // white-hot where it snapped
    gd.ellipse([x1 - cell * 0.06, y1 - cell * 0.05, x1 + cell * 0.06, y1 + cell * 0.05], { fill: [255, 120, 40, 190] });
  }
  for (let i = 0; i < q.length; i += 3) gd.ellipse([q[i][0] - cell * 0.03, q[i][1] - cell * 0.02, q[i][0] + cell * 0.03, q[i][1] + cell * 0.02], { fill: [255, 110, 30, 150] });   // glowing edges
  out = alphaComposite(out, gaussianBlur(glow, cell * 0.04));
  const smoke = newImage("RGBA", img.w, img.h), smd = new Draw(smoke);              // smoke drifting up and away
  for (let i = 0; i < 9; i++) {
    const t = i / 9, x = cx + cell * (0.05 + t * 0.25) + r.uniform(-6, 6), y = cy - cell * (0.05 + t * 0.32), s = cell * (0.1 + t * 0.12);
    smd.ellipse([x - s, y - s * 0.8, x + s, y + s * 0.8], { fill: [70, 68, 66, T(110 - t * 70)] });
  }
  return alphaComposite(out, gaussianBlur(smoke, cell * 0.05));
}

// --- hazard placards (ADR style) -------------------------------------------------------------------------------

function flameGlyph(d, x, y, s, col) {                                            // the flammable symbol: a stylised flame on a bar
  d.polygon([[x - s * 0.42, y + s * 0.3], [x - s * 0.5, y - s * 0.05], [x - s * 0.28, y - s * 0.32], [x - s * 0.2, y - s * 0.08], [x - s * 0.05, y - s * 0.62], [x + s * 0.16, y - s * 0.22], [x + s * 0.3, y - s * 0.4], [x + s * 0.5, y], [x + s * 0.42, y + s * 0.3]], A(col));
  d.rectangle([x - s * 0.55, y + s * 0.34, x + s * 0.55, y + s * 0.44], { fill: A(col) });
}

function bombGlyph(d, x, y, s, col) {                                             // the explosive symbol: a bursting bomb
  d.ellipse([x - s * 0.24, y - s * 0.12, x + s * 0.24, y + s * 0.36], { fill: A(col) });
  for (let k = 0; k < 9; k++) {
    const a = -Math.PI + (k * Math.PI) / 8, r0 = s * 0.32, r1 = s * (k % 2 ? 0.6 : 0.5);
    d.line([[x + Math.cos(a) * r0, y + s * 0.12 + Math.sin(a) * r0], [x + Math.cos(a) * r1, y + s * 0.12 + Math.sin(a) * r1]], A(col), Math.max(2, T(s * 0.08)));
  }
}

// A placard: a diamond with a white inner border, the class symbol in the top half, the class number below
function placard(d, x, y, s, kind, cell) {
  const ink = [20, 18, 16];
  const col = kind === "3" ? HAZ_RED : HAZ_ORANGE;
  d.polygon([[x, y - s], [x + s, y], [x, y + s], [x - s, y]], A([20, 18, 16]));
  d.polygon([[x, y - s * 0.92], [x + s * 0.92, y], [x, y + s * 0.92], [x - s * 0.92, y]], A(col));
  d.polygon([[x, y - s * 0.8], [x + s * 0.8, y], [x, y + s * 0.8], [x - s * 0.8, y]], null, { outline: A(kind === "3" ? WHITE : ink), width: Math.max(2, T(s * 0.06)) });
  if (kind === "3") flameGlyph(d, x, y - s * 0.32, s * 0.55, WHITE);
  else bombGlyph(d, x, y - s * 0.38, s * 0.55, ink);
  const num = kind === "3" ? "3" : "1.1", size = Math.max(8, T(s * (kind === "3" ? 0.42 : 0.3))), tw = d.textLength(num, size, "stencil");
  d.text([x - tw / 2, y + s * 0.3], num, size, A(kind === "3" ? WHITE : ink), { family: "stencil" });
}

// a label that reads at table zoom: heavy stencil capitals with a dark outline. align "c" (centred) or "l"
function label(d, x, y, text, size, col = CREAM, align = "c") {
  const tw = d.textLength(text, size, "stencil");
  d.text([align === "c" ? x - tw / 2 : x, y], text, size, A(col), { family: "stencil", strokeWidth: Math.max(2, Math.round(size * 0.14)), strokeFill: A([16, 14, 12]) });
  return tw;
}

// rust streaks hanging from a horizontal edge (y0) down a face, with the edge itself drawn as a weld seam
function rustStreaks(lay, x0, x1, y0, y1, seed, n, cell) {
  const over = newImage("RGBA", lay.w, lay.h), d = new Draw(over), r = new PyRandom(seed);
  d.rectangle([x0, y0 - 1.5, x1, y0 + 1.5], { fill: [70, 44, 28, 160] });          // the seam they run from
  for (let i = 0; i < n; i++) {
    const x = r.uniform(x0, x1), L = (y1 - y0) * r.uniform(0.25, 0.9), wd = cell * r.uniform(0.008, 0.02);
    d.polygon([[x, y0], [x + wd, y0], [x + wd * 0.4, y0 + L]], [96, 52, 30, r.randint(70, 140)]);
  }
  const soft = gaussianBlur(over, cell * 0.006);
  for (let p = 0; p < lay.w * lay.h; p++) if (!lay.data[p * 4 + 3]) soft.data[p * 4 + 3] = 0;
  return alphaCompositeAt(lay, soft);
}

// mottled, matte colour for a height-field surface: a fixed noise over the token
function mottler(w, h, seed, cell, amt = 0.16) {
  const n = fblur(Float32Array.from({ length: w * h }, (_, i) => hash(seed, i)), w, h, cell * 0.04);
  let lo = Infinity, hi = -Infinity;
  for (const v of n) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return (c, x, y) => { const v = (n[Math.max(0, Math.min(h - 1, Math.round(y))) * w + Math.max(0, Math.min(w - 1, Math.round(x)))] - lo) / (hi - lo || 1); return sh(c, 1 - amt / 2 + amt * v); };
}

// text set round a circle, upright to the outside, starting at the top and running clockwise
function ringText(img, cx, cy, R, text, size, col) {
  const d = new Draw(img);
  let ang = -Math.PI / 2;
  const total = d.textLength(text, size, "stencil"), stretch = (2 * Math.PI * R) / total;   // spread to close the ring
  for (const ch of text) {
    const cw = d.textLength(ch, size, "stencil") * stretch, mid = ang + cw / (2 * R);
    if (ch !== " ") {
      const g = newImage("RGBA", size * 2, size * 2), gd = new Draw(g), lw = d.textLength(ch, size, "stencil");
      gd.text([size - lw / 2, size * 0.45], ch, size, A(col), { family: "stencil", strokeWidth: Math.max(2, Math.round(size * 0.12)), strokeFill: A([16, 14, 12]) });
      const rot = rotate(g, -((mid * 180) / Math.PI + 90), { center: [size, size] });
      const x = cx + Math.cos(mid) * R, y = cy + Math.sin(mid) * R;
      alphaCompositeAt(img, rot, Math.round(x - size), Math.round(y - size));
    }
    ang += cw / R;
  }
}

// --- containers (two hexes) ------------------------------------------------------------------------------------

const CONTAINER_PAINT = [[[150, 62, 44], [118, 46, 34]], [[64, 86, 106], [46, 64, 82]], [[84, 102, 68], [62, 78, 50]], [[194, 146, 58], [150, 110, 40]]];
const CONTAINER_CODE = ["CXLU 287104", "TRSU 550921", "MKFU 103337", "HLNU 448210"];

function containerBody(lay, d, x0, x1, yb, H, depth, roof, side, cell, code, seed) {
  const top = yb - H - depth, bot = yb - H;
  d.rectangle([x0, yb - H, x1, yb], { fill: A(side) });                            // the south face: corrugated
  for (let x = x0; x < x1; x += cell * 0.07) {
    d.rectangle([x + cell * 0.035, yb - H, x + cell * 0.07, yb], { fill: A(sh(side, 0.8)) });
    d.line([[x + cell * 0.035, yb - H], [x + cell * 0.035, yb]], A(sh(side, 1.15)), 1);
  }
  d.rectangle([x0, yb - cell * 0.03, x1, yb], { fill: A(sh(side, 0.55)) });            // the bottom rail
  d.rectangle([x0, top, x1, bot], { fill: A(roof) });                              // the roof: a herringbone of ribs
  const mid = (x0 + x1) / 2, step = cell * 0.09;
  for (let k = top - (mid - x0); k < bot; k += step) {
    const ka = Math.max(top, k), kb = Math.min(bot, k + (mid - x0));
    d.line([[x0 + (ka - k), ka], [x0 + (kb - k), kb]].map(([x, y]) => [Math.min(mid, x), y]), A(sh(roof, 0.8)), 2);
    d.line([[x1 - (ka - k), ka], [x1 - (kb - k), kb]].map(([x, y]) => [Math.max(mid, x), y]), A(sh(roof, 0.8)), 2);
  }
  d.rectangle([x0, top, x1, bot], { outline: A(sh(roof, 0.58)), width: 3 });
  d.line([[x0, bot + 2], [x1, bot + 2]], A(sh(side, 1.35)), 2);
  for (const [px, py] of [[x0, top], [x1, top], [x0, bot], [x1, bot]]) {           // corner castings with their oval holes
    const s = cell * 0.045, qx = px === x0 ? px + s : px - s, qy = py === top ? py + s : py - s;
    d.rectangle([qx - s, qy - s, qx + s, qy + s], { fill: A([146, 148, 146]), outline: A([38, 38, 40]), width: 2 });
    d.ellipse([qx - s * 0.5, qy - s * 0.3, qx + s * 0.5, qy + s * 0.3], { fill: A([28, 28, 30]) });
  }
  const dx = x1 - cell * 0.42;                                                     // the door end: four locking bars
  for (let k = 0; k < 4; k++) {
    const bx = dx + k * cell * 0.09;
    d.rectangle([bx, yb - H + 3, bx + 3, yb - 3], { fill: A([46, 46, 48]) });
    d.rectangle([bx - 2, yb - H * 0.55, bx + 6, yb - H * 0.45], { fill: A([150, 150, 150]) });   // handles
  }
  const size = T(cell * 0.17), tw = label(d, x0 + cell * 0.12, yb - H * 0.86, code, size, sh(CREAM, 0.95), "l");
  d.rectangle([x0 + cell * 0.12 + tw + 5, yb - H * 0.84, x0 + cell * 0.12 + tw + 5 + size * 0.75, yb - H * 0.84 + size], { outline: A(sh(CREAM, 0.95)), width: 2 });   // the check-digit box
  d.rectangle([x0, yb - H, x1, yb - H + cell * 0.035], { fill: A(sh(side, 0.62)) });   // the top rail, which the rust runs from
  return rustStreaks(lay, x0, x1, yb - H + cell * 0.035, yb, seed + 1, 14, cell);
}

function tokenContainer(cell, v = 0, stacked = false) {
  let [lay, d, cs] = layerFor(cell, row2(cell));
  const [[xa, cy0], [xb]] = cs, yb = cy0 + cell * 0.38;
  const x0 = xa - cell * 0.46, x1 = xb + cell * 0.46, H = cell * 0.3, depth = cell * 0.62;
  const [roof, side] = CONTAINER_PAINT[v % 4];
  lay = containerBody(lay, d, x0, x1, yb, H, depth, roof, side, cell, CONTAINER_CODE[v % 4], 600 + v);
  if (stacked) {
    const [roof2, side2] = CONTAINER_PAINT[(v + 1) % 4];
    d = new Draw(lay);
    lay = containerBody(lay, d, x0 + 2, x1 - 2, yb - H, H, depth, sh(roof2, 1.06), sh(side2, 1.03), cell, CONTAINER_CODE[(v + 1) % 4], 610 + v);
  }
  return shadowed(grime(chips(lay, 620 + v, 40, cell, [40, 34, 30]), cell, 625 + v, 0.12), cell);
}

// --- steel cargo crates -------------------------------------------------------------------------------------------

// a ribbed steel crate: framed edges and corner guards, ribs across the face, a latch and a stencilled code
function steelCrate(d, x0, y0, x1, y1, h, body, cell, code) {
  const top = sh(body, 1.08), face = sh(body, 0.72), t = Math.max(2, T(cell * 0.016));
  box(d, x0, y0, x1, y1, h, top, face, sh(body, 1.35));
  for (let x = x0 + cell * 0.07; x < x1 - cell * 0.04; x += cell * 0.07) d.line([[x, y1 - h + 3], [x, y1 - 3]], A(sh(body, 0.58)), t);   // ribs on the face
  d.rectangle([x0, y0 - h, x1, y1 - h], { outline: A(sh(body, 0.55)), width: t + 1 });                // the lid frame
  d.rectangle([x0 + cell * 0.04, y0 - h + cell * 0.04, x1 - cell * 0.04, y1 - h - cell * 0.04], { outline: A(sh(body, 0.85)), width: t });
  for (const [px, py] of [[x0, y0 - h], [x1, y0 - h], [x0, y1 - h], [x1, y1 - h]]) {                 // corner guards
    const s = cell * 0.05, qx = px === x0 ? px : px - s, qy = py === y0 - h ? py : py - s;
    d.rectangle([qx, qy, qx + s, qy + s], { fill: A([130, 132, 134]) });
    d.ellipse([qx + s * 0.3, qy + s * 0.3, qx + s * 0.7, qy + s * 0.7], { fill: A([60, 60, 62]) });
  }
  const lx = (x0 + x1) / 2;                                                                          // the latch on the face
  d.rectangle([lx - cell * 0.03, y1 - h + 2, lx + cell * 0.03, y1 - h * 0.45], { fill: A([150, 150, 146]), outline: A([36, 36, 36]), width: 1 });
  label(d, (x0 + x1) / 2, (y0 + y1) / 2 - h - cell * 0.09, code, T(Math.min(cell * 0.17, (x1 - x0) * 0.42)), sh(CREAM, 0.95));
}

function tokenCrate(cell, v = 0) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0];
  if (v === 0) steelCrate(d, cx - cell * 0.34, cy - cell * 0.18, cx + cell * 0.34, cy + cell * 0.36, cell * 0.28, [84, 92, 78], cell, "MK-04");
  else {                                                                              // two, side by side, apart
    steelCrate(d, cx - cell * 0.4, cy - cell * 0.1, cx - cell * 0.03, cy + cell * 0.34, cell * 0.3, [72, 84, 100], cell, "17B");
    steelCrate(d, cx + cell * 0.03, cy - cell * 0.02, cx + cell * 0.38, cy + cell * 0.34, cell * 0.22, [84, 92, 78], cell, "17C");
  }
  return shadowed(grime(chips(lay, 635 + v, 18, cell, [34, 34, 32]), cell, 636 + v, 0.14), cell);
}

// --- steel coils ------------------------------------------------------------------------------------------------

function tokenCoil(cell, v = 0) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, [cx, cy0] = cs[0], cy = cy0 + cell * 0.14, z = fine(w, h);
  const R = cell * (v ? 0.3 : 0.36), Ri = R * 0.38, H = cell * 0.34, mot = mottler(w, h, 640 + v, cell, 0.18);
  addBox(z, w, h, cx - R * 1.08, cy - R * 0.92, cx + R * 1.08, cy + R * 0.92, cell * 0.06, 1);   // the steel cradle
  fill(z, w, h, (x, y) => {
    const rr = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (rr > R || rr < Ri) return 0;
    const e = Math.min(R - rr, rr - Ri), b = cell * 0.035;
    return H - (e < b ? b - e : 0);
  });
  let out = project(w, h, z, (x, y, hgt, wall) => {
    const rr = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
    if (hgt < cell * 0.065 && (rr > R * 0.98 || rr < Ri)) return mot(Math.abs(x - cx) > R * 0.9 ? [60, 58, 56] : [74, 72, 70], x, y);   // the cradle
    if (Math.abs(Math.sin(a * 2)) < 0.07) return [56, 60, 66];                       // the bands
    if (hgt >= H - 1) return mot(Math.floor(rr / (cell * 0.02)) % 2 ? [146, 148, 150] : [128, 130, 134], x, y);   // the wound strip, end on
    if (wall && rr < R * 0.6) return [70, 72, 76];                                     // inside the eye
    return mot([112, 116, 122], x, y);
  }, { gloss: 0.22 });
  const d = new Draw(out);
  d.rectangle([cx + R * 0.5, cy - H - R * 0.3, cx + R * 0.72, cy - H - R * 0.12], { fill: A([222, 214, 190]) });   // a mill tag
  d.line([[cx + R * 0.52, cy - H - R * 0.25], [cx + R * 0.7, cy - H - R * 0.25]], A([60, 60, 60]), 1);
  out = rustStreaks(out, cx - R, cx + R, cy - H + 2, cy, 645 + v, 6, cell);
  return shadowed(grime(chips(out, 646 + v, 20, cell, [50, 40, 34]), cell, 647 + v, 0.08), cell);
}

// --- tarped loads (soft cover), the Training Floor's drape with straps painted onto the cloth ----------------------

const CANVAS = [[96, 104, 74], [146, 128, 92], [70, 82, 92]];

// straps across the drape at token x positions: webbing lit with the cloth, a steel ratchet low down
function straps(xs, cell, col = [204, 122, 38]) {
  const half = cell * 0.024;
  return (x, y, zz) => {
    for (const sx of xs) {
      const dx = x - sx;
      if (Math.abs(dx) > half) continue;
      if (zz > 0 && zz < cell * 0.06 && Math.abs(dx) <= half * 1.4) return [150, 150, 154];      // the ratchet, near the hem
      return Math.abs(dx) > half * 0.6 ? sh(col, 0.72) : col;                                     // webbing with darker edges
    }
    return null;
  };
}

// pull the straps taut: in each strap's columns the cloth is raised to the upper convex hull of its profile, so a
// strap runs straight from edge to edge over the load instead of sinking into the gaps
function taut(xs, cell) {
  const half = Math.ceil(cell * 0.026);
  return (z, w, h) => {
    for (const sx of xs)
      for (let x = Math.round(sx - half); x <= Math.round(sx + half); x++) {
        if (x < 0 || x >= w) continue;
        const pts = [];
        for (let y = 0; y < h; y++) if (z[y * w + x] > 0.5) pts.push([y, z[y * w + x]]);
        if (pts.length < 3) continue;
        const hull = [];
        for (const p of pts) {                                                              // upper hull, monotone chain
          while (hull.length >= 2) {
            const [a, b] = [hull[hull.length - 2], hull[hull.length - 1]];
            if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0) hull.pop(); else break;
          }
          hull.push(p);
        }
        for (let k = 0; k + 1 < hull.length; k++) {
          const [ya, za] = hull[k], [yb, zb] = hull[k + 1];
          for (let y = ya; y <= yb; y++) { const v = za + ((zb - za) * (y - ya)) / Math.max(1, yb - ya); if (v > z[y * w + x]) z[y * w + x] = v; }
        }
      }
  };
}

function tokenTarp(cell, v = 0) {
  const crates = [[-0.4, -0.3, 0.4, 0.32, 0.26], [-0.32, -0.24, 0.1, 0.1, 0.4], [0.04, -0.16, 0.36, 0.28, 0.34]];
  const { img } = tokenCanvas(cell, [[0, 0]]), xs = [img.w * 0.38, img.w * 0.62];
  return drapeTarp(cell, [[0, 0]], crates, CANVAS[v % 3], { seed: 4 + v, gloss: 0.3, rseed: 650, sc: 0.95, decor: straps(xs, cell), lift: taut(xs, cell) });
}

function tokenTarp2hex(cell, v = 0) {
  const crates = [[-0.84, -0.24, -0.1, 0.28, 0.26], [-0.12, -0.26, 0.84, 0.28, 0.22], [-0.7, -0.16, -0.22, 0.12, 0.4], [0.1, -0.2, 0.62, 0.16, 0.34]];
  const { img } = tokenCanvas(cell, row2(cell)), xs = [0.24, 0.42, 0.6, 0.78].map((f) => img.w * f);
  return drapeTarp(cell, row2(cell), crates, CANVAS[(v + 1) % 3], { seed: 6 + v, gloss: 0.3, rseed: 660, sc: 0.92, decor: straps(xs, cell), lift: taut(xs, cell) });
}

// a big machine under a tarp: Size 2
function tokenMachine(cell) {
  const [, sy, hw] = geometry(cell), fp = [[0, 0], [-hw, sy], [hw, sy]];
  const crates = [[-0.9, -0.15, 0.9, 0.75, 0.3], [-0.6, -0.05, 0.3, 0.6, 0.62], [0.3, 0.05, 0.75, 0.55, 0.48], [-0.35, -0.42, 0.25, -0.1, 0.4]];
  const { img } = tokenCanvas(cell, fp), xs = [0.3, 0.5, 0.7].map((f) => img.w * f);
  return drapeTarp(cell, fp, crates, CANVAS[2], { seed: 9, gloss: 0.32, rseed: 670, sc: 0.9, decor: straps(xs, cell), lift: taut(xs, cell) });
}

// --- bulk bags (soft cover) ---------------------------------------------------------------------------------------
// Big woven sacks, square and bulging, a lifting loop at each corner and a printed panel

function tokenBulkBags(cell, v = 0) {
  const [lay, d, cs] = layerFor(cell), [cx, cy0] = cs[0], cy = cy0 + cell * 0.16;
  const bags = (v ? [[-0.2, -0.02, 0.17, 0.4], [0.2, 0.02, 0.17, 0.4]] : [[-0.19, -0.2, 0.16, 0.26], [0.19, -0.18, 0.16, 0.26], [-0.18, 0.16, 0.16, 0.26], [0.2, 0.18, 0.16, 0.26]])
    .sort((a, b) => a[1] - b[1]);                                                         // north to south, so near bags overlap far ones
  const cloth = [204, 198, 180], web = [92, 122, 168], t = Math.max(3, T(cell * 0.028));
  for (const [ox, oy, s0, h0] of bags) {
    const bx = cx + ox * cell, by = cy + oy * cell, s = s0 * cell, H = h0 * cell;
    const x0 = bx - s, x1 = bx + s, y0 = by - s * 0.8, y1 = by + s * 0.8, bulge = s * 0.12;
    const face = [[x0 + 2, y1 - H], [x1 - 2, y1 - H], [x1 + bulge * 0.4, y1 - H * 0.45], [x1, y1], [bx, y1 + bulge * 0.6], [x0, y1], [x0 - bulge * 0.4, y1 - H * 0.45]];
    d.polygon(face, A(sh(cloth, 0.74)));                                                  // the south face, bulging
    for (let k = 1; k < 9; k++) {                                                          // its weave: fine vertical threads
      const x = x0 + ((x1 - x0) * k) / 9;
      d.line([[x, y1 - H + 3], [x + (x - bx) * 0.04, y1 - 2]], A(sh(cloth, 0.66)), 1);
    }
    d.line([[x0 + s * 0.15, y1 - H + 2], [x0 + s * 0.12, y1 - 2]], A(sh(cloth, 0.6)), 2);  // corner seams
    d.line([[x1 - s * 0.15, y1 - H + 2], [x1 - s * 0.12, y1 - 2]], A(sh(cloth, 0.6)), 2);
    d.rectangle([bx - s * 0.5, y1 - H * 0.7, bx + s * 0.5, y1 - H * 0.36], { fill: A([226, 222, 210]), outline: A([60, 70, 96]), width: 2 });   // the printed panel
    d.rectangle([bx - s * 0.5, y1 - H * 0.7, bx + s * 0.5, y1 - H * 0.6], { fill: A([60, 70, 96]) });
    d.roundedRectangle([x0, y0 - H, x1, y1 - H], s * 0.32, { fill: A(cloth) });          // the top: a soft pillow, lit from the north-west
    d.roundedRectangle([x0 + s * 0.12, y0 - H + s * 0.1, x1 - s * 0.3, y1 - H - s * 0.3], s * 0.26, { fill: A(sh(cloth, 1.08)) });
    d.roundedRectangle([x0 + s * 0.3, y0 - H + s * 0.22, bx, by - H - s * 0.1], s * 0.2, { fill: A(sh(cloth, 1.15)) });
    d.roundedRectangle([x0, y0 - H, x1, y1 - H], s * 0.32, { outline: A(sh(cloth, 0.7)), width: 2 });
    d.ellipse([bx - s * 0.2, by - H - s * 0.16, bx + s * 0.2, by - H + s * 0.16], { fill: A(sh(cloth, 0.82)) });   // the filling spout, gathered and tied
    d.ellipse([bx - s * 0.1, by - H - s * 0.09, bx + s * 0.1, by - H + s * 0.07], { fill: A(sh(cloth, 1.12)) });
    d.line([[bx - s * 0.16, by - H + s * 0.02], [bx + s * 0.16, by - H + s * 0.02]], A(web), 2);
    for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {                        // lifting loops: feet on the top corners, standing up
      const fx = bx + qx * s * 0.72, fy = by - H + qy * s * 0.56, lw = s * 0.22, lh = s * 0.42;
      d.arc([fx - lw, fy - lh, fx + lw, fy + lh * 0.3], 180, 360, A(sh(web, 0.6)), t + 2);
      d.arc([fx - lw, fy - lh, fx + lw, fy + lh * 0.3], 180, 360, A(web), t);
      d.line([[fx - lw + 1, fy - lh * 0.35], [fx - lw + 1, fy + 2]], A(web), t);           // the loop's two feet, stitched down
      d.line([[fx + lw - 1, fy - lh * 0.35], [fx + lw - 1, fy + 2]], A(web), t);
    }
  }
  return shadowed(grime(lay, cell, 682 + v, 0.1), cell);
}

// --- fuel and ordnance -------------------------------------------------------------------------------------------

// a fuel tank lying east-west on saddles: a catwalk and fittings on top, a ladder, a red band (two hexes)
function tokenFuelTank(cell) {
  const [lay, , cs] = layerFor(cell, row2(cell)), { w, h } = lay, [[xa, cy0], [xb]] = cs, cx = (xa + xb) / 2, cy = cy0 + cell * 0.16;
  const L = cell * 0.86, R = cell * 0.31, z = fine(w, h), mot = mottler(w, h, 690, cell, 0.12);
  fill(z, w, h, (x, y) => {
    const dx = Math.max(0, Math.abs(x + 0.5 - cx) - (L - R * 0.6)), dy = y + 0.5 - cy;
    const q = 1 - (dx / (R * 0.6)) ** 2 - (dy / R) ** 2;
    return q <= 0 ? 0 : R * (0.25 + Math.sqrt(q) * 0.95);
  });
  for (const sx of [-0.62, 0.62]) addBox(z, w, h, cx + sx * L - cell * 0.07, cy - R * 1.15, cx + sx * L + cell * 0.07, cy + R * 1.15, cell * 0.22, 1);   // saddles
  for (const [fx, fy, fr] of [[-0.25, -0.05, 0.05], [0.0, -0.08, 0.075], [0.3, -0.05, 0.045]]) addCyl(z, w, h, cx + fx * L, cy + fy * R, cell * fr, R * 1.2 + cell * 0.05, 2, 1);   // fittings on top
  let out = project(w, h, z, (x, y, hgt) => {
    const ax = x + 0.5 - cx;
    if (hgt < cell * 0.23 && Math.abs(Math.abs(ax) - 0.62 * L) < cell * 0.08 && Math.abs(y + 0.5 - cy) > R * 0.9) return [52, 54, 58];
    if (hgt > R * 1.22) return [70, 72, 78];                                            // valves and the manhole
    if (Math.abs(ax) < cell * 0.055) return mot(HAZ_RED, x, y);                        // the red band
    if (Math.abs(ax) > L - R * 0.35 && Math.floor((y + ax) / (cell * 0.06)) % 2 === 0) return mot(YELLOW, x, y);   // striped heads
    return mot([206, 206, 198], x, y);
  }, { gloss: 0.2, k: 0.8 });
  const d = new Draw(out), top = cy - R * 1.12, t = Math.max(2, T(cell * 0.014));
  d.rectangle([cx - L * 0.55, top - cell * 0.07, cx + L * 0.55, top + cell * 0.07], { outline: A([60, 62, 66]), width: t });   // the catwalk
  for (let x = cx - L * 0.55; x < cx + L * 0.55; x += cell * 0.05) d.line([[x, top - cell * 0.07], [x, top + cell * 0.07]], A([60, 62, 66]), 1);
  const lx = cx + L * 0.2;                                                               // the ladder down the face
  for (const dx of [0, cell * 0.08]) d.line([[lx + dx, top + cell * 0.06], [lx + dx, cy + R * 0.85]], A([60, 62, 66]), t);
  for (let y = top + cell * 0.1; y < cy + R * 0.8; y += cell * 0.05) d.line([[lx, y], [lx + cell * 0.08, y]], A([60, 62, 66]), 1);
  const fs = T(cell * 0.13), fw = d.textLength("FLAMMABLE", fs, "stencil");                 // the warning plate
  d.rectangle([cx - L * 0.47, cy + R * 0.02, cx - L * 0.47 + fw + cell * 0.08, cy + R * 0.02 + fs * 1.15], { fill: A([228, 224, 212]), outline: A([40, 40, 40]), width: 2 });
  d.text([cx - L * 0.47 + cell * 0.04, cy + R * 0.02 + fs * 0.06], "FLAMMABLE", fs, A([170, 30, 24]), { family: "stencil" });
  out = rustStreaks(out, cx - L * 0.92, cx + L * 0.92, top + cell * 0.08, cy + R * 0.9, 691, 12, cell);   // from under the catwalk's edge
  const d2 = new Draw(out);
  for (const sx of [-0.72, 0.72]) placard(d2, cx + sx * L * 0.62, cy - R * 0.22, cell * 0.12, "3", cell);   // on the south face
  return shadowed(grime(chips(out, 692, 50, cell, [40, 40, 44]), cell, 693, 0.1), cell);
}

// oxblood fuel drums: rims, ribs, bungs, a rust ring at the foot, a flammable placard on one lid
function tokenFuelDrums(cell, v = 0) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, [cx, cy] = cs[0], z = fine(w, h);
  const spots = [[[-0.16, -0.06], [0.15, -0.1], [0.0, 0.2]], [[-0.14, 0.04], [0.16, 0.1]]][v % 2].map(([a, b]) => [cx + a * cell, cy + b * cell + cell * 0.12]);
  const R = cell * 0.13, H = cell * 0.28, drum = [124, 38, 30], mot = mottler(w, h, 700 + v, cell, 0.2);
  for (const [x, y] of spots) { addCyl(z, w, h, x, y, R, H, 2); addCyl(z, w, h, x, y, R * 0.86, H - 1.2, 1); }
  let out = project(w, h, z, (x, y, hgt) => {
    let best = spots[0], bd = Infinity;
    for (const s of spots) { const dd = Math.hypot(x - s[0], y - s[1]); if (dd < bd) { bd = dd; best = s; } }
    const [dx, dy] = best, v2 = hgt / H;
    if (hgt >= H - 2.5) {
      if (bd > R * 0.86) return mot(sh(drum, 1.25), x, y);                               // the rim
      if (Math.hypot(x - dx - R * 0.42, y - dy + R * 0.2) < R * 0.16) return [48, 44, 40];   // the bung
      if (Math.hypot(x - dx + R * 0.45, y - dy + R * 0.25) < R * 0.08) return [60, 56, 52];  // the vent
      return mot(sh(drum, 1.06), x, y);
    }
    if (v2 < 0.1) return [86, 48, 30];                                                   // rust at the foot
    if (Math.abs(v2 - 0.34) < 0.045 || Math.abs(v2 - 0.68) < 0.045) return mot(sh(drum, 0.72), x, y);   // ribs
    return mot(drum, x, y);
  }, { gloss: 0.12 });
  const d = new Draw(out), [fx, fy] = spots[0];
  placard(d, fx - R * 0.08, fy - H + R * 0.05, cell * 0.075, "3", cell);
  return shadowed(grime(chips(out, 705 + v, 22, cell, [60, 30, 22]), cell, 706 + v, 0.12), cell);
}

// olive ordnance crates (steel): ribs, latches, an HE stencil, lot numbers, explosive placards
function tokenOrdnance(cell, v = 0) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0], olive = [88, 96, 58];
  const boxes = v ? [[-0.4, -0.12, -0.03, 0.34, 0.24], [0.03, -0.04, 0.38, 0.34, 0.2]] : [[-0.36, -0.14, 0.36, 0.36, 0.24]];
  boxes.forEach(([a, b, c2, e, hh], i) => {
    const x0 = cx + a * cell, y0 = cy + b * cell, x1 = cx + c2 * cell, y1 = cy + e * cell, H = cell * hh;
    steelCrate(d, x0, y0, x1, y1, H, olive, cell, "HE");
    const s = Math.min(x1 - x0, H * 2) * 0.24;
    placard(d, x1 - s * 1.3, y1 - H * 0.48, s, "1.1", cell);
  });
  return shadowed(grime(chips(lay, 710 + v, 16, cell, [40, 44, 28]), cell, 711 + v, 0.14), cell);
}

// --- reels -------------------------------------------------------------------------------------------------------
// A steel cable reel lying on its flange (it can't roll off): a painted flange with welded radial gussets, a bolt
// ring, the hub boss and arbor hole, the cable showing in the gap below the top flange, and a ring of lettering
// round the rim. size 2 (three hexes) or 3 (seven)

function tokenReel(cell, size) {
  const [sx, sy, hw] = geometry(cell);
  const fp = size === 3 ? [[0, 0], [sx, 0], [-sx, 0], [hw, -sy], [-hw, -sy], [hw, sy], [-hw, sy]] : [[0, 0], [-hw, sy], [hw, sy]];
  const [lay, , cs] = layerFor(cell, fp), { w, h } = lay, z = fine(w, h);
  const cx = cs.reduce((t, [x]) => t + x, 0) / cs.length, cy = cs.reduce((t, [, y]) => t + y, 0) / cs.length + cell * (size === 3 ? 0.14 : -0.06);
  const R = cell * (size === 3 ? 1.12 : 0.78), H = cell * (size === 3 ? 0.36 : 0.28), paint = size === 3 ? [118, 44, 32] : [176, 136, 44];   // all of it inside the canvas
  const mot = mottler(w, h, 730 + size, cell, 0.22), ribs = 8, ribW = cell * 0.035, inner = R * 0.6;
  addCyl(z, w, h, cx, cy, R, H, cell * 0.04);
  fill(z, w, h, (x, y) => {                                                                   // the gussets, raised on the flange
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, rr = Math.hypot(dx, dy);
    if (rr < R * 0.17 || rr > inner) return 0;
    const a = Math.atan2(dy, dx), k = Math.round((a * ribs) / (2 * Math.PI)), da = a - (k * 2 * Math.PI) / ribs;
    return Math.abs(da * rr) < ribW ? H + cell * 0.035 : 0;
  });
  addCyl(z, w, h, cx, cy, R * 0.17, H + cell * 0.06, 2);                                     // the hub boss
  let out = project(w, h, z, (x, y, hgt, wall) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, rr = Math.hypot(dx, dy);
    if (wall && hgt < H - cell * 0.02) {
      const v = hgt / H;
      if (v > 0.16 && v < 0.84) return Math.floor(v * 24) % 2 ? [36, 38, 42] : [50, 52, 58];   // the cable between the flanges
      return mot(sh(paint, 0.78), x, y);                                                      // the flange edges
    }
    if (hgt > H + cell * 0.045) return rr < R * 0.07 ? [16, 14, 12] : mot([96, 98, 104], x, y);   // the boss and its hole
    if (hgt > H + 1) return mot(sh(paint, 1.12), x, y);                                     // gussets
    if (Math.abs(rr - R * 0.28) < cell * 0.022) {                                            // the bolt ring
      const a = Math.atan2(dy, dx);
      if (Math.abs(Math.sin(a * 8)) < 0.3) return [64, 66, 70];
    }
    if (Math.abs(rr - inner) < 2 || Math.abs(rr - R * 0.93) < 2) return mot(sh(paint, 0.7), x, y);   // the lettering band's rules
    return mot(paint, x, y);
  }, { gloss: 0.12 });
  const tsize = T(cell * (size === 3 ? 0.19 : 0.14)), band = (inner + R * 0.93) / 2;
  ringText(out, cx, cy - H, band + tsize * 0.05, size === 3 ? "CONDUCTOR CABLE  ·  DRUM 2810  ·  DO NOT ROLL  ·  " : "HV CABLE 33kV  ·  DRUM 0447  ·  ", tsize, sh(CREAM, 0.92));
  return shadowed(grime(chips(out, 731 + size, size === 3 ? 70 : 40, cell, [44, 30, 24]), cell, 732 + size, 0.12), cell);
}

// --- the train's own parts ---------------------------------------------------------------------------------------

// the coupling in the gap between two wagons (or a wagon and the locomotive): knuckle couplers on drawbars,
// two air hoses. open: uncoupled, the knuckles apart and the hoses hanging loose
function tokenCoupler(cell, open = false) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0], [, , hw] = geometry(cell), gap = open ? cell * 0.16 : 0;
  const steel = [72, 74, 80], lit = [150, 154, 160], t = Math.max(2, T(cell * 0.02));
  for (const s of [-1, 1]) {
    const x0 = cx + s * (hw + 3), x1 = cx + s * (cell * 0.07 + gap);
    d.rectangle([Math.min(x0, x1), cy - cell * 0.055, Math.max(x0, x1), cy + cell * 0.055], { fill: A(steel) });   // the drawbar
    d.line([[Math.min(x0, x1), cy - cell * 0.055], [Math.max(x0, x1), cy - cell * 0.055]], A(lit), t);
    d.line([[Math.min(x0, x1), cy + cell * 0.055], [Math.max(x0, x1), cy + cell * 0.055]], A([30, 30, 34]), t);
    const kx = cx + s * (cell * 0.11 + gap);
    d.polygon([[kx - cell * 0.08, cy - cell * 0.13], [kx + cell * 0.06, cy - cell * 0.13], [kx + cell * 0.08, cy - cell * 0.02], [kx + cell * 0.08, cy + cell * 0.13], [kx - cell * 0.08, cy + cell * 0.13]], A([60, 62, 68]));   // the knuckle
    d.line([[kx - cell * 0.08, cy - cell * 0.13], [kx + cell * 0.06, cy - cell * 0.13]], A(lit), 2);
    d.rectangle([kx - cell * 0.03, cy - cell * 0.06, kx + cell * 0.03, cy + cell * 0.06], { fill: A([28, 28, 32]) });
    d.ellipse([kx - cell * 0.02, cy - cell * 0.17, kx + cell * 0.02, cy - cell * 0.13], { fill: A(lit) });   // the lift pin
    const hy = cy + cell * 0.22;                                                             // the air hose
    const hose = open ? [[cx + s * hw, hy - cell * 0.03], [cx + s * (cell * 0.32), hy + cell * 0.12], [cx + s * (cell * 0.22 + gap), hy + cell * 0.24]] : [[cx + s * hw, hy - cell * 0.03], [cx + s * cell * 0.2, hy + cell * 0.04], [cx, hy + cell * 0.07]];
    d.line(hose, A([24, 24, 26]), T(cell * 0.04), "curve");
    d.line(hose.map(([x, y]) => [x, y - 2]), A([70, 70, 74]), 1);
    d.ellipse([cx + s * hw - cell * 0.035, hy - cell * 0.06, cx + s * hw + cell * 0.035, hy + cell * 0.01], { fill: A(HAZ_RED) });   // the angle cock
  }
  if (!open) d.ellipse([cx - cell * 0.035, cy + cell * 0.26, cx + cell * 0.035, cy + cell * 0.32], { fill: A([150, 150, 154]) });   // the glad hands
  return shadowed(chips(lay, 740 + (open ? 1 : 0), 6, cell), cell);
}

// The heavy coupling (Size 3), centred on the gap hex of a wagon's middle row. With stepped ends the gap
// zig-zags: on the middle row it is that hex, on the rows above and below it sits half a hex east. So: the
// knuckle couplers on drawbars in the middle, a pair of buffers meeting in the gap above and below, safety
// chains and air hoses between. open: uncoupled, everything parted, the chains and hoses hanging loose
function tokenCouplerBig(cell, open = false) {
  const [sx, sy, hw] = geometry(cell), fp = [[0, 0], [sx, 0], [-sx, 0], [hw, -sy], [-hw, -sy], [hw, sy], [-hw, sy]];
  const [lay, d, cs] = layerFor(cell, fp), [cx, cy] = cs[0], gap = open ? cell * 0.14 : 0;
  const steel = [74, 76, 82], lit = [156, 160, 166], dark = [26, 26, 30], t = Math.max(2, T(cell * 0.02));
  const bar = (x0, x1, y, hh) => {                                                     // a lit steel bar between two x
    d.rectangle([Math.min(x0, x1), y - hh, Math.max(x0, x1), y + hh], { fill: A(steel) });
    d.rectangle([Math.min(x0, x1), y - hh, Math.max(x0, x1), y - hh * 0.45], { fill: A(lit) });
    d.rectangle([Math.min(x0, x1), y + hh * 0.6, Math.max(x0, x1), y + hh], { fill: A(dark) });
  };
  for (const s of [-1, 1]) {                                                           // the couplers, middle row
    const x0 = cx + s * (hw + 4), kx = cx + s * (cell * 0.15 + gap);
    bar(x0, kx, cy, cell * 0.075);
    d.polygon([[kx - s * cell * 0.03, cy - cell * 0.2], [kx + s * cell * 0.13, cy - cell * 0.2], [kx + s * cell * 0.16, cy - cell * 0.04], [kx + s * cell * 0.13, cy + cell * 0.2], [kx - s * cell * 0.03, cy + cell * 0.2]].map(([x, y]) => [x - s * cell * 0.13, y]), A([62, 64, 70]));   // the knuckle head
    d.line([[kx - s * cell * 0.16, cy - cell * 0.2], [kx, cy - cell * 0.2]], A(lit), 3);
    d.rectangle([kx - s * cell * 0.1 - cell * 0.04, cy - cell * 0.08, kx - s * cell * 0.1 + cell * 0.04, cy + cell * 0.08], { fill: A(dark) });
    d.ellipse([kx - s * cell * 0.08 - cell * 0.03, cy - cell * 0.27, kx - s * cell * 0.08 + cell * 0.03, cy - cell * 0.21], { fill: A(lit) });   // the lift pin
    for (const dy of [-1, 1]) {                                                         // buffers in the gap above and below
      const by = cy + dy * sy, bx = cx + hw, stemEnd = bx + s * (cell * 0.16 + gap), wall = bx + s * (hw + 4);
      bar(wall, stemEnd, by, cell * 0.06);
      const px = stemEnd;                                                               // the buffer head: a round steel pad seen edge-on
      d.rectangle([px - (s < 0 ? 0 : cell * 0.06), by - cell * 0.2, px + (s < 0 ? cell * 0.06 : 0), by + cell * 0.2], { fill: A([96, 98, 104]), outline: A(dark), width: 2 });
      d.line([[px + (s < 0 ? cell * 0.06 : -cell * 0.06), by - cell * 0.2], [px + (s < 0 ? cell * 0.06 : -cell * 0.06), by + cell * 0.2]], A(lit), 2);
      const stripe = newImage("L", lay.w, lay.h);                                       // hazard band on the stem
      new Draw(stripe).rectangle([Math.min(wall, stemEnd) + cell * 0.04, by - cell * 0.06, Math.max(wall, stemEnd) - cell * 0.1, by + cell * 0.06], { fill: 255 });
      paste(lay, stripes([lay.w, lay.h], hazW(cell), HAZ), stripe);
    }
    const hx = cx + s * (hw - cell * 0.05), hy = cy + cell * 0.32;                       // the air hose, middle row
    const hose = open ? [[hx, hy - cell * 0.04], [cx + s * cell * 0.3, hy + cell * 0.14], [cx + s * (cell * 0.18 + gap), hy + cell * 0.28]] : [[hx, hy - cell * 0.04], [cx + s * cell * 0.2, hy + cell * 0.06], [cx, hy + cell * 0.1]];
    d.line(hose, A([22, 22, 24]), T(cell * 0.05), "curve");
    d.line(hose.map(([x, y]) => [x, y - 2]), A([74, 74, 78]), 1);
    d.ellipse([hx - cell * 0.04, hy - cell * 0.08, hx + cell * 0.04, hy], { fill: A(HAZ_RED) });   // the angle cock
  }
  for (const dy of [-1, 1]) {                                                           // safety chains, from beam to beam across the middle
    const y0 = cy + dy * cell * 0.36, pts = [];
    for (let k = 0; k <= 14; k++) {
      const f = k / 14, x = cx - hw + f * cell, sag = open ? (f < 0.5 ? f : 1 - f) * cell * 0.5 * (f < 0.42 || f > 0.58 ? 1 : 0) : Math.sin(f * Math.PI) * cell * 0.08;
      if (open && f > 0.42 && f < 0.58) continue;                                         // parted in the middle
      pts.push([x, y0 + dy * sag]);
    }
    for (let k = 0; k < pts.length; k++) {
      const [x, y] = pts[k], vert = k % 2;
      d.ellipse(vert ? [x - 3, y - 6, x + 3, y + 6] : [x - 6, y - 3, x + 6, y + 3], { outline: A([150, 150, 154]), width: 2 });
    }
  }
  if (!open) d.ellipse([cx - cell * 0.04, cy + cell * 0.38, cx + cell * 0.04, cy + cell * 0.46], { fill: A([150, 150, 154]) });   // the glad hands, joined
  return shadowed(chips(lay, 745 + (open ? 1 : 0), 14, cell), cell);
}

// a harness anchor: a welded padeye with its shackle, on a yellow-and-black painted base plate. Small, to scatter
// about the deck: a harnessed character clips on here. v2 is a pair
function tokenHarnessAnchor(cell, v = 0) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, [cx, cy] = cs[0], z = fine(w, h);
  const spots = v ? [[-0.2, -0.05], [0.2, 0.08]] : [[0, 0.04]];
  for (const [ox, oy] of spots) {
    const x = cx + ox * cell, y = cy + oy * cell;
    addCyl(z, w, h, x, y, cell * 0.12, cell * 0.025, 1.5);                                   // the base plate
    addBox(z, w, h, x - cell * 0.02, y - cell * 0.06, x + cell * 0.02, y + cell * 0.06, cell * 0.12, 1.5);   // the padeye plate, east-west on edge
  }
  let out = project(w, h, z, (x, y, hgt) => {
    let best = spots[0], bd = Infinity;
    for (const s of spots) { const dd = Math.hypot(x - cx - s[0] * cell, y - cy - s[1] * cell); if (dd < bd) { bd = dd; best = s; } }
    if (hgt < cell * 0.03) {
      const a = Math.atan2(y - cy - best[1] * cell, x - cx - best[0] * cell);
      return Math.floor((a / Math.PI) * 4 + 8) % 2 ? YELLOW : [28, 26, 24];               // the painted base: quarters
    }
    return [132, 134, 138];                                                                 // bare steel
  }, { gloss: 0.3 });
  const d = new Draw(out), t = Math.max(3, T(cell * 0.022));
  for (const [ox, oy] of spots) {                                                            // the eye and its shackle
    const x = cx + ox * cell, y = cy + oy * cell - cell * 0.1;
    d.ellipse([x - cell * 0.025, y - cell * 0.03, x + cell * 0.025, y + cell * 0.01], { fill: A([20, 20, 22]) });
    d.arc([x - cell * 0.05, y - cell * 0.075, x + cell * 0.05, y + cell * 0.025], 180, 360, A([200, 166, 60]), t);   // the shackle, brass
    d.line([[x - cell * 0.05, y - cell * 0.025], [x + cell * 0.05, y - cell * 0.025]], A([150, 120, 50]), 2);
  }
  return shadowed(chips(out, 750 + v, 6, cell, [30, 30, 30]), cell);
}

// the harness locker, where harnesses are kept: a steel cabinet, door open, harnesses hanging inside
function tokenHarnessLocker(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy0] = cs[0], cy = cy0 + cell * 0.16;
  const x0 = cx - cell * 0.3, x1 = cx + cell * 0.3, y0 = cy - cell * 0.12, y1 = cy + cell * 0.1, H = cell * 0.56;
  const body = [86, 92, 82];
  box(d, x0, y0, x1, y1, H, sh(body, 1.05), sh(body, 0.7), sh(body, 1.3));
  d.rectangle([x0 + cell * 0.04, y1 - H + cell * 0.05, x1 - cell * 0.04, y1 - cell * 0.03], { fill: A([26, 26, 28]) });   // the open front
  const yellow = [226, 178, 40], t = Math.max(3, T(cell * 0.026));
  d.line([[x0 + cell * 0.05, y1 - H + cell * 0.09], [x1 - cell * 0.05, y1 - H + cell * 0.09]], A([140, 140, 144]), t);   // the hanging rail
  for (const ox of [-0.17, 0, 0.17]) {                                                      // three harnesses: shoulder straps and a buckle
    const x = cx + ox * cell, yt = y1 - H + cell * 0.09;
    d.line([[x - cell * 0.04, yt], [x - cell * 0.05, yt + cell * 0.3], [x, yt + cell * 0.38]], A(yellow), t);
    d.line([[x + cell * 0.04, yt], [x + cell * 0.05, yt + cell * 0.3], [x, yt + cell * 0.38]], A(sh(yellow, 0.85)), t);
    d.rectangle([x - cell * 0.03, yt + cell * 0.18, x + cell * 0.03, yt + cell * 0.23], { fill: A([150, 152, 156]) });
  }
  const dx = x1 + cell * 0.02;                                                             // the door, swung open to the east
  d.polygon([[dx, y1 - H], [dx + cell * 0.14, y1 - H + cell * 0.08], [dx + cell * 0.14, y1 + cell * 0.04], [dx, y1]], A(sh(body, 0.85)));
  d.line([[dx, y1 - H], [dx, y1]], A(sh(body, 0.5)), 2);
  const stripeMask = newImage("L", lay.w, lay.h);
  new Draw(stripeMask).rectangle([x0, y1 - H - cell * 0.045, x1, y1 - H], { fill: 255 });
  paste(lay, stripes([lay.w, lay.h], Math.max(3, T(cell * 0.04)), HAZ), stripeMask);   // hazard band along the roof's front edge
  label(d, cx, y0 - H - cell * 0.005, "HARNESS", T(cell * 0.14));
  return shadowed(grime(chips(lay, 752, 14, cell), cell, 753, 0.12), cell);
}

// a marker: low clearance ahead. A weighted warning post: a hazard-striped pole on a base plate, a triangular
// sign facing south and an amber beacon on top. Lay it on the train the round before an overhead obstacle.
function tokenLowClearance(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy0] = cs[0], cy = cy0 + cell * 0.28;
  let lay = newImage("RGBA", img.w, img.h);
  const d = new Draw(lay);
  d.ellipse([cx - cell * 0.16, cy - cell * 0.06, cx + cell * 0.16, cy + cell * 0.06], { fill: A([40, 40, 42]) });   // the base plate
  d.ellipse([cx - cell * 0.16, cy - cell * 0.075, cx + cell * 0.16, cy + cell * 0.045], { fill: A([70, 70, 74]) });
  const pw = cell * 0.035, ptop = cy - cell * 0.55;
  const poleMask = newImage("L", img.w, img.h);
  new Draw(poleMask).rectangle([cx - pw, ptop, cx + pw, cy - cell * 0.02], { fill: 255 });
  paste(lay, stripes([img.w, img.h], Math.max(3, T(cell * 0.04)), HAZ), poleMask);       // the striped pole
  d.line([[cx - pw, ptop], [cx - pw, cy - cell * 0.02]], A([255, 230, 150]), 1);
  const S = cell * 0.27, sy = ptop + cell * 0.04;                                         // the sign: triangle, with its thickness showing
  const tri = [[cx, sy - S * 0.95], [cx + S, sy + S * 0.7], [cx - S, sy + S * 0.7]];
  d.polygon(tri.map(([x, y]) => [x + 3, y + 3]), A([60, 50, 20]));
  d.polygon(tri, A([24, 22, 20]));
  d.polygon([[cx, sy - S * 0.72], [cx + S * 0.8, sy + S * 0.58], [cx - S * 0.8, sy + S * 0.58]], A(YELLOW));
  d.rectangle([cx - S * 0.42, sy + S * 0.02, cx + S * 0.42, sy + S * 0.12], { fill: A([24, 22, 20]) });    // a beam overhead
  d.polygon([[cx, sy + S * 0.48], [cx - S * 0.14, sy + S * 0.24], [cx + S * 0.14, sy + S * 0.24]], A([24, 22, 20]));   // and the arrow down
  d.line([[cx, sy + S * 0.14], [cx, sy + S * 0.28]], A([24, 22, 20]), Math.max(3, T(cell * 0.03)));
  const by = sy - S * 0.95 - cell * 0.05;                                                 // the beacon
  d.rectangle([cx - cell * 0.04, by, cx + cell * 0.04, by + cell * 0.05], { fill: A([40, 40, 42]) });
  d.ellipse([cx - cell * 0.045, by - cell * 0.06, cx + cell * 0.045, by + cell * 0.02], { fill: A([255, 170, 40]) });
  d.ellipse([cx - cell * 0.02, by - cell * 0.045, cx + cell * 0.01, by - cell * 0.02], { fill: A([255, 236, 190]) });
  const glow = newImage("RGBA", img.w, img.h);
  new Draw(glow).ellipse([cx - cell * 0.14, by - cell * 0.14, cx + cell * 0.14, by + cell * 0.1], { fill: [255, 150, 40, 120] });
  lay = alphaComposite(gaussianBlur(glow, cell * 0.05), lay);
  return shadowed(lay, cell);
}

// --- the locomotive -----------------------------------------------------------------------------------------------
// An electric freight locomotive at the head of the train, nose east: nine hexes long, five rows wide (like a
// wagon), its west buffer beam on the hex edge so the coupling in the gap meets it. Collector shoes pick up power
// from a conductor rail along the tunnel wall. Hard cover.

function tokenLocomotive(cell) {
  const [sx, sy, hw] = geometry(cell), fp = [[0, 0]];
  for (let dr = -2; dr <= 2; dr++) for (let dc = -4; dc <= 4; dc++) if (dr || dc) fp.push([dc * sx + (Math.abs(dr) % 2) * hw, dr * sy]);
  let [lay, , cs] = layerFor(cell, fp);
  const [cx, cy] = cs[0];
  const x0 = cx - 4.5 * cell, x1 = cx + 4.55 * cell, y0 = cy - 2.05 * sy, y1 = cy + 2.05 * sy;
  const H = cell * 0.55, body = [58, 66, 72], d = new Draw(lay);
  const top = y0 - H * 0.3, bot = y1 - H, bx = x0 + cell * 0.22;                             // the roof, seen above the south side
  d.rectangle([bx, bot, x1 - cell * 0.5, y1], { fill: A(sh(body, 0.72)) });                 // the south side
  for (let x = bx + cell * 0.2; x < x1 - cell * 0.6; x += cell * 0.6) {                     // its louvres
    d.rectangle([x, bot + H * 0.2, x + cell * 0.35, bot + H * 0.55], { fill: A(sh(body, 0.55)) });
    for (let k = 0; k < 4; k++) d.line([[x + 2, bot + H * (0.24 + k * 0.08)], [x + cell * 0.35 - 2, bot + H * (0.24 + k * 0.08)]], A(sh(body, 0.42)), 1);
  }
  d.rectangle([bx, bot + H * 0.78, x1 - cell * 0.5, bot + H * 0.86], { fill: A(YELLOW) });  // the walkway edge stripe
  for (let y = top; y < bot; y++) {                                                         // the roof: curved, lit from the north
    const t = (y - top) / (bot - top), k = 1.22 - 0.36 * t + 0.1 * Math.sin(t * Math.PI);
    d.line([[bx, y], [x1 - cell * 0.5, y]], A(sh(body, k)), 1);
  }
  for (let x = bx + cell * 0.95; x < x1 - cell * 0.6; x += cell * 0.95) {                  // roof panel seams with brass rivets
    d.line([[x, top + 2], [x, bot - 2]], A(sh(body, 0.7)), 2);
    d.line([[x + 2, top + 2], [x + 2, bot - 2]], A(sh(body, 1.25)), 1);
    for (let y = top + cell * 0.12; y < bot; y += cell * 0.2) d.ellipse([x - 5, y - 2, x - 1, y + 2], { fill: A(BRASS) });
  }
  d.rectangle([bx, top, x1 - cell * 0.5, top + cell * 0.05], { fill: A(sh(body, 1.4)) });
  d.rectangle([bx, (top + bot) / 2 - cell * 0.03, x1 - cell * 0.5, (top + bot) / 2 + cell * 0.03], { fill: A(sh(YELLOW, 0.82)) });   // a yellow livery band
  for (const fx of [-3.2, -2.0, -0.8]) {                                                     // three radiator fans
    const fxp = cx + fx * cell, fy = (top + bot) / 2, R = cell * 0.42;
    d.rectangle([fxp - R * 1.1, fy - R * 1.1, fxp + R * 1.1, fy + R * 1.1], { fill: A(sh(body, 0.85)), outline: A(sh(body, 0.6)), width: 2 });
    d.ellipse([fxp - R, fy - R, fxp + R, fy + R], { fill: A([30, 32, 36]) });
    for (let k = 0; k < 7; k++) {
      const a = k * Math.PI * 2 / 7;
      d.polygon([[fxp, fy], [fxp + Math.cos(a) * R * 0.92, fy + Math.sin(a) * R * 0.92], [fxp + Math.cos(a + 0.42) * R * 0.92, fy + Math.sin(a + 0.42) * R * 0.92]], A([74, 78, 84]));
    }
    for (let k = -4; k <= 4; k++) d.line([[fxp - R, fy + k * R * 0.22], [fxp + R, fy + k * R * 0.22]], A([90, 94, 100]), 1);   // the grille
    d.ellipse([fxp - R * 0.14, fy - R * 0.14, fxp + R * 0.14, fy + R * 0.14], { fill: A([120, 124, 130]) });
  }
  const hx0 = cx + 0.1 * cell, hx1 = cx + 2.6 * cell;                                         // the equipment hatches
  for (let x = hx0; x < hx1; x += cell * 0.82) {
    d.rectangle([x, top + cell * 0.2, x + cell * 0.74, bot - cell * 0.2], { fill: A(sh(body, 0.94)), outline: A(sh(body, 0.62)), width: 2 });
    for (const [px, py] of [[x + 5, top + cell * 0.2 + 5], [x + cell * 0.74 - 5, top + cell * 0.2 + 5], [x + 5, bot - cell * 0.2 - 5], [x + cell * 0.74 - 5, bot - cell * 0.2 - 5]]) d.ellipse([px - 2, py - 2, px + 2, py + 2], { fill: A(BRASS) });
  }
  label(d, cx + 1.35 * cell, (top + bot) / 2 - cell * 0.2, "LINE 07", T(cell * 0.32), sh(CREAM, 0.9));
  const kx = x1 - cell * 1.4;                                                                 // the cab at the east end, raised
  d.rectangle([kx - cell * 0.5, top - cell * 0.1, x1 - cell * 0.1, bot + cell * 0.1], { fill: A(sh(body, 1.08)), outline: A(sh(body, 0.6)), width: 2 });
  d.rectangle([kx - cell * 0.5, bot + cell * 0.1, x1 - cell * 0.1, bot + H * 0.6], { fill: A(sh(body, 0.8)) });   // the cab's south side
  for (let k = 0; k < 2; k++) d.rectangle([kx + k * cell * 0.5, bot + cell * 0.16, kx + k * cell * 0.5 + cell * 0.36, bot + H * 0.5], { fill: A([40, 60, 72]), outline: A([20, 22, 26]), width: 2 });   // side windows
  const nosePts = [[x1 - cell * 0.5, top - cell * 0.1], [x1 + cell * 0.1, top + cell * 0.3], [x1 + cell * 0.1, y1 - cell * 0.2], [x1 - cell * 0.5, y1]];
  const noseMask = newImage("L", lay.w, lay.h);
  new Draw(noseMask).polygon(nosePts, 255);
  paste(lay, stripes([lay.w, lay.h], Math.max(4, T(cell * 0.1)), HAZ), noseMask);           // the nose: hazard stripes
  d.line([...nosePts, nosePts[0]], A([30, 28, 26]), 3);
  d.line([nosePts[0], nosePts[1]], A(sh(YELLOW, 1.15)), 2);
  d.rectangle([x1 - cell * 0.55, top + cell * 0.2, x1 - cell * 0.42, bot - cell * 0.2], { fill: A([46, 70, 84]), outline: A([20, 22, 26]), width: 2 });   // the windscreen
  d.line([[x1 - cell * 0.52, top + cell * 0.3], [x1 - cell * 0.45, top + cell * 0.7]], A([150, 190, 210]), 2);
  for (const ly of [top + cell * 0.32, bot - cell * 0.2]) d.ellipse([x1 - cell * 0.04, ly - cell * 0.06, x1 + cell * 0.08, ly + cell * 0.06], { fill: A([255, 236, 180]), outline: A([60, 56, 40]), width: 1 });   // headlamps
  for (const s of [-1, 1]) {                                                                  // collector shoes to the conductor rail
    for (const fx of [-3.4, 1.6]) {
      const sxp = cx + fx * cell, syp = s < 0 ? top : y1;
      d.rectangle([sxp, Math.min(syp, syp + s * cell * 0.14), sxp + cell * 0.5, Math.max(syp, syp + s * cell * 0.14)], { fill: A([46, 48, 52]) });
      d.rectangle([sxp + cell * 0.1, Math.min(syp + s * cell * 0.12, syp + s * cell * 0.2), sxp + cell * 0.4, Math.max(syp + s * cell * 0.12, syp + s * cell * 0.2)], { fill: A([150, 120, 60]) });
    }
  }
  d.line([[bx + cell * 0.1, top + cell * 0.12], [x1 - cell * 0.6, top + cell * 0.12]], A(sh(body, 1.4)), 2);   // handrail
  const beam = newImage("L", lay.w, lay.h);                                                   // the west buffer beam, on the hex edge
  new Draw(beam).rectangle([x0, top + cell * 0.1, bx, y1], { fill: 255 });
  paste(lay, stripes([lay.w, lay.h], Math.max(4, T(cell * 0.07)), HAZ), beam);
  d.rectangle([x0, top + cell * 0.1, bx, y1], { outline: A(IRON_DARK), width: 3 });
  for (const yy of [cy - sy * 1.2, cy + sy * 1.2]) {                                          // its two buffers
    d.rectangle([x0 - cell * 0.02, yy - cell * 0.12, x0 + cell * 0.08, yy + cell * 0.12], { fill: A([70, 72, 76]), outline: A([24, 24, 26]), width: 2 });
  }
  d.rectangle([x0 - 3, cy - cell * 0.055, x0 + cell * 0.12, cy + cell * 0.055], { fill: A([72, 74, 80]) });   // the drawbar end the coupling meets
  let out = rustStreaks(lay, bx, x1 - cell * 0.5, bot + H * 0.86, y1, 760, 30, cell);
  out = chips(out, 761, 140, cell, [30, 32, 36]);
  return shadowed(grime(out, cell, 762, 0.12), cell);
}

export const TOKENS = {
  fl_deck_v1: (c) => tokenDeck(c, 0),
  fl_deck_v2: (c) => tokenDeck(c, 1),
  fl_deck_v3: (c) => tokenDeck(c, 2),
  fl_deck_side_n: (c) => tokenDeck(c, 3, { side: "n" }),
  fl_deck_side_s: (c) => tokenDeck(c, 4, { side: "s" }),
  fl_deck_end_w: (c) => tokenDeck(c, 5, { ends: [4] }),
  fl_deck_end_e: (c) => tokenDeck(c, 6, { ends: [1] }),
  fl_deck_end_point_w: (c) => tokenDeck(c, 7, { ends: [3, 4, 5] }),
  fl_deck_end_point_e: (c) => tokenDeck(c, 8, { ends: [0, 1, 2] }),
  fl_deck_corner_nw: (c) => tokenDeck(c, 9, { side: "n", ends: [3, 4] }),
  fl_deck_corner_ne: (c) => tokenDeck(c, 10, { side: "n", ends: [1] }),
  fl_deck_corner_sw: (c) => tokenDeck(c, 11, { side: "s", ends: [4, 5] }),
  fl_deck_corner_se: (c) => tokenDeck(c, 12, { side: "s", ends: [1] }),
  fl_deck_holed: tokenDeckHoled,
  fl_container_2hex_v1: (c) => tokenContainer(c, 0),
  fl_container_2hex_v2: (c) => tokenContainer(c, 1),
  fl_container_2hex_v3: (c) => tokenContainer(c, 2),
  fl_container_2hex_v4: (c) => tokenContainer(c, 3),
  fl_container_stack_2hex: (c) => tokenContainer(c, 0, true),
  fl_crate_v1: (c) => tokenCrate(c, 0),
  fl_crate_v2: (c) => tokenCrate(c, 1),
  fl_coil_v1: (c) => tokenCoil(c, 0),
  fl_coil_v2: (c) => tokenCoil(c, 1),
  fl_tarp_v1: (c) => tokenTarp(c, 0),
  fl_tarp_v2: (c) => tokenTarp(c, 1),
  fl_tarp_2hex: (c) => tokenTarp2hex(c, 0),
  fl_machine_size2: tokenMachine,
  fl_bulk_bags_v1: (c) => tokenBulkBags(c, 0),
  fl_bulk_bags_v2: (c) => tokenBulkBags(c, 1),
  fl_fuel_tank_2hex: tokenFuelTank,
  fl_fuel_drums_v1: (c) => tokenFuelDrums(c, 0),
  fl_fuel_drums_v2: (c) => tokenFuelDrums(c, 1),
  fl_ordnance_v1: (c) => tokenOrdnance(c, 0),
  fl_ordnance_v2: (c) => tokenOrdnance(c, 1),
  fl_reel_size2: (c) => tokenReel(c, 2),
  fl_reel_size3: (c) => tokenReel(c, 3),
  fl_coupler: (c) => tokenCoupler(c, false),
  fl_coupler_open: (c) => tokenCoupler(c, true),
  fl_coupler_size3: (c) => tokenCouplerBig(c, false),
  fl_coupler_open_size3: (c) => tokenCouplerBig(c, true),
  fl_harness_anchor_v1: (c) => tokenHarnessAnchor(c, 0),
  fl_harness_anchor_v2: (c) => tokenHarnessAnchor(c, 1),
  fl_harness_locker: tokenHarnessLocker,
  fl_low_clearance: tokenLowClearance,
  fl_locomotive: tokenLocomotive,
};

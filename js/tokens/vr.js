// V-Reality tokens (from vr_map.py; names start vr_): the training sim's raised ground (basalt
// columns and lilac sand, intact or shattered), basalt pillars and clusters, boulders, the spawn pads,
// the flag stand and the flag. Violet and slate, clearly apart from the ship kit.

import { NpRandom, PyRandom } from "../rng.js";
import { newImage, cloneImage, Draw, alphaCompositeAt, paste, pasteAt, gaussianBlur, u8 } from "../raster.js";
import { centre, geometry, hexPoints, radians, linspace } from "../maps/geometry.js";
import { noise, maskOf } from "../maps/common.js";
import { tokenCanvas, withShadow, size2Footprint } from "./kit.js";

const F = Math.fround;
const T = Math.trunc;
const BASALT_TOP = [122, 114, 160];            // the plateau surface: pale slate
const COVER_TOP = [74, 66, 116];               // cover columns: darker and taller
const COVER_SIDE = [30, 26, 50];
const SAND = [178, 152, 196];
const GLOW = [90, 255, 150];

const scale3 = (c, k) => c.map((v) => T(v * k));
const lift3 = (c, k) => c.map((v) => Math.min(255, T(v * k)));

// Python round(x, 1)
function round1(x) {
  const t = x * 10;
  if (!Number.isInteger(t) && Number.isInteger(t * 2)) { const f = Math.floor(t); return (f % 2 === 0 ? f : f + 1) / 10; }
  return Number(x.toFixed(1));
}

// --- surfaces --------------------------------------------------------------------------------------

// Basalt column tops: a sub-hex tiling (1/3 cell), each column a slightly different height
function basaltSurface([w, h], cell, seed) {
  const img = newImage("RGBA", w, h, [...BASALT_TOP, 255]), d = new Draw(img), sub = cell / 3, r = new PyRandom(seed);
  const cols = T(w / sub) + 3, rows = T(h / (sub * Math.sqrt(3) / 2)) + 3;
  for (let rr = -1; rr < rows; rr++)
    for (let cc = -1; cc < cols; cc++) {
      const [cx, cy] = centre(cc, rr, sub), k = r.uniform(0.82, 1.12);
      const pts = hexPoints(cx, cy, sub, 0.06);
      d.polygon(pts, [...scale3(BASALT_TOP, k), 255]);
      d.line([pts[4], pts[5], pts[0], pts[1]], [...BASALT_TOP.map((v) => Math.min(255, T(v * k * 1.25))), 255],
        Math.max(1, T(cell * 0.012)));                                      // lit top-left rim of each column
    }
  return img;
}

function sandSurface([w, h], cell, seed) {
  const n = noise(h, w, cell * 1.2, seed), img = newImage("RGBA", w, h);
  const div = F(cell * 0.09);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const t = F(F(F(F(x * 0.5) + y) / div) + F(n[p] * 6));
      const rip = F(F(F(Math.sin(t)) * 0.5) + 0.5);
      const tone = F(0.9 + F(0.12 * n[p]));
      for (let k = 0; k < 3; k++) img.data[p * 4 + k] = u8(F(F(SAND[k] * tone) - F(rip * 10)));
      img.data[p * 4 + 3] = 255;
    }
  const d = new Draw(img), r = new PyRandom(seed);
  for (let i = T(w * h / (cell * cell) * 10); i > 0; i--) {               // crystal grit: difficult terrain
    const x = r.uniform(0, w), y = r.uniform(0, h), s = r.uniform(0.015, 0.05) * cell;
    d.polygon([[x, y - s * 1.6], [x + s * 0.7, y], [x, y + s * 0.5], [x - s * 0.7, y]],
      r.choice([[80, 60, 120, 255], [120, 96, 168, 255], [220, 206, 240, 255]]));
  }
  return img;
}

// Destroyed ground: darker, cracked from a point of impact, columns knocked out, rubble, de-rez pixels
function shatter(tile, cell, cx, cy, seed) {
  const r = new PyRandom(seed);
  tile = cloneImage(tile);
  for (let i = 0; i < tile.data.length; i += 4) for (let k = 0; k < 3; k++) tile.data[i + k] = u8(F(tile.data[i + k] * F(0.8)));
  const d = new Draw(tile), sub = cell / 3;
  for (let k = r.randint(3, 4); k > 0; k--) {                              // knocked-out columns
    const a = r.uniform(0, 2 * Math.PI);
    const x = cx + Math.cos(a) * r.uniform(0.05, 0.3) * cell, y = cy + Math.sin(a) * r.uniform(0.05, 0.3) * cell;
    d.polygon(hexPoints(x, y, sub, 0.05), [52, 34, 92, 255]);               // the sim's void below
    d.line(hexPoints(x, y, sub, 0.05).slice(3, 6), [24, 14, 44, 255], Math.max(2, T(cell * 0.02)));
  }
  const ix = cx + r.uniform(-0.1, 0.1) * cell, iy = cy + r.uniform(-0.1, 0.1) * cell;
  for (let k = 0; k < 5; k++) {                                             // cracks from the impact
    let a = 2 * Math.PI * k / 5 + r.uniform(-0.3, 0.3), x = ix, y = iy;
    const pts = [[ix, iy]];
    for (let i = 0; i < 4; i++) {
      a += r.uniform(-0.5, 0.5);
      const step = r.uniform(0.09, 0.15) * cell;
      x = x + Math.cos(a) * step; y = y + Math.sin(a) * step;
      pts.push([x, y]);
    }
    d.line(pts, [16, 10, 32, 255], Math.max(2, T(cell * 0.028)));
    d.line(pts.map(([px, py]) => [px + 2, py + 2]), [170, 160, 210, 110], 1);
  }
  for (let i = 0; i < 9; i++) {                                             // rubble
    const x = cx + r.uniform(-0.38, 0.38) * cell, y = cy + r.uniform(-0.38, 0.38) * cell, s = r.uniform(0.03, 0.07) * cell;
    const poly = linspace(0, 2 * Math.PI, 6, false).map((t) => { const px = x + Math.cos(t) * s * r.uniform(0.6, 1.1); return [px, y + Math.sin(t) * s * r.uniform(0.6, 1.1)]; });
    d.polygon(poly, [...BASALT_TOP.map((v) => T(v * r.uniform(0.7, 1.1))), 255], { outline: [30, 24, 52, 255] });
  }
  for (let i = 0; i < 7; i++) {                                             // de-rez pixels
    const x = cx + r.uniform(-0.35, 0.35) * cell, y = cy + r.uniform(-0.35, 0.35) * cell, s = r.choice([0.03, 0.045]) * cell;
    d.rectangle([x, y, x + s, y + s], { fill: r.choice([[...GLOW, 200], [220, 120, 255, 200], [255, 255, 255, 170]]) });
  }
  return tile;
}

// Raised ground: one hex per token; the basalt tiling lines up across neighbouring tokens
function groundTile(cell, surface, seed, destroyed = false) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0];
  let tile = surface([img.w, img.h], cell, seed);
  if (destroyed) tile = shatter(tile, cell, cx, cy, seed);
  const out = newImage("RGBA", img.w, img.h);
  paste(out, tile, maskOf([img.w, img.h], cs, cell));
  const d = new Draw(out), inner = hexPoints(cx, cy, cell, 0.03), lw = Math.max(2, T(cell * 0.022));
  d.line([inner[3], inner[4], inner[5], inner[0]], [255, 255, 255, 60], lw);        // lit rim
  d.line([inner[0], inner[1], inner[2], inner[3]], [20, 12, 40, 90], lw);           // shaded rim
  d.polygon(hexPoints(cx, cy, cell, 0.008), null, { outline: [30, 22, 54, 150], width: Math.max(1, T(cell * 0.012)) });
  return out;
}

// --- pads, the flag stand ----------------------------------------------------------------------------

function spawnPad(img, c, r, cell) {
  const [cx, cy] = centre(c, r, cell), layer = newImage("RGBA", img.w, img.h), d = new Draw(layer);
  for (const [rad, wdt] of [[0.40, 0.035], [0.28, 0.025], [0.14, 0.05]]) {
    const R = cell * rad;
    d.ellipse([cx - R, cy - R * 0.9, cx + R, cy + R * 0.9], { outline: [...GLOW, 230], width: Math.max(2, T(cell * wdt)) });
  }
  for (let a = 0; a < 360; a += 90) {                                       // four prongs, like the chamber's pads
    const x = cx + Math.cos(radians(a)) * cell * 0.46, y = cy + Math.sin(radians(a)) * cell * 0.41;
    d.ellipse([x - cell * 0.04, y - cell * 0.04, x + cell * 0.04, y + cell * 0.04], { outline: [...GLOW, 230], width: Math.max(2, T(cell * 0.02)) });
  }
  const glow = gaussianBlur(layer, cell * 0.08), haze = newImage("RGBA", img.w, img.h);
  new Draw(haze).ellipse([cx - cell * 0.4, cy - cell * 0.36, cx + cell * 0.4, cy + cell * 0.36], { fill: [...GLOW, 60] });
  alphaCompositeAt(img, gaussianBlur(haze, cell * 0.1));
  alphaCompositeAt(img, glow);
  return alphaCompositeAt(img, layer);
}

function flagStand(img, c, r, cell) {
  const [cx, cy] = centre(c, r, cell), d = new Draw(img);
  for (const [rad, col] of [[0.42, [40, 34, 64, 255]], [0.36, [120, 112, 160, 255]], [0.3, [60, 52, 90, 255]]]) {
    const R = cell * rad;
    d.ellipse([cx - R, cy - R * 0.9, cx + R, cy + R * 0.9], { fill: col });
  }
  for (let a = 0; a < 360; a += 30) {
    const x0 = cx + Math.cos(radians(a)) * cell * 0.3, y0 = cy + Math.sin(radians(a)) * cell * 0.27;
    const x1 = cx + Math.cos(radians(a)) * cell * 0.36, y1 = cy + Math.sin(radians(a)) * cell * 0.32;
    d.line([[x0, y0], [x1, y1]], [200, 190, 240, 255], Math.max(1, T(cell * 0.015)));
  }
  return img;
}

// --- cover: basalt clusters, pillars, boulders, the flag ----------------------------------------------

// Basalt hex columns packed into a footprint, each with a lit top and a dark side face
function columnCluster(cell, footprint, seed, tall = [0.18, 0.4]) {
  const { img, cs } = tokenCanvas(cell, footprint), layer = newImage("RGBA", img.w, img.h), d = new Draw(layer);
  const r = new PyRandom(seed), sub = cell / 3.2;
  let spots = [];
  for (const [cx, cy] of cs) {                                              // a 7-column rosette per hex
    spots.push([cx, cy]);
    for (let k = 0; k < 6; k++) { const a = radians(30 + 60 * k); spots.push([cx + Math.cos(a) * sub * 0.95, cy + Math.sin(a) * sub * 0.95]); }
  }
  if (cs.length > 1) {                                                      // fill between the hexes: one solid block
    cs.forEach(([ax, ay], i) => { for (const [bx, by] of cs.slice(i + 1)) spots.push([(ax + bx) / 2, (ay + by) / 2]); });
    spots.push([cs.reduce((s, [x]) => s + x, 0) / cs.length, cs.reduce((s, [, y]) => s + y, 0) / cs.length]);
  }
  const uniq = new Map();
  for (const [x, y] of spots) { const p = [round1(x), round1(y)]; if (!uniq.has(p.join())) uniq.set(p.join(), p); }
  spots = [...uniq.values()].sort((p, q) => p[1] - q[1]);                  // far (top) first, near (bottom) last
  for (const [x, y] of spots) {
    const h = r.uniform(tall[0], tall[1]) * cell, k = r.uniform(0.85, 1.15);
    const side = [...scale3(COVER_SIDE, k), 255], top = [...lift3(COVER_TOP, k), 255];
    const pts = hexPoints(x, y, sub * 0.95), lower = pts.map(([px, py]) => [px, py + h]);
    d.polygon([pts[1], pts[2], pts[3], pts[4], lower[4], lower[3], lower[2], lower[1]], side);
    d.polygon(pts, top);
    d.line([pts[4], pts[5], pts[0], pts[1]], [...lift3(top.slice(0, 3), 1.3), 255], Math.max(1, T(cell * 0.015)));
    d.line([pts[1], pts[2], pts[3]], [30, 26, 50, 255], Math.max(1, T(cell * 0.012)));
  }
  // lift the whole cluster so its base sits in the footprint, clip to the hexes
  const mask = maskOf([img.w, img.h], cs, cell, 0.02), out = newImage("RGBA", img.w, img.h);
  pasteAt(out, layer, 0, -T(cell * 0.12));
  for (let p = 0; p < img.w * img.h; p++) out.data[p * 4 + 3] = Math.min(out.data[p * 4 + 3], mask.data[p]);
  return withShadow(out, cell, 0.06, 0.08, 0.05, 0.6);
}

// One big basalt hex pillar from above: base on the hex, top lifted by h, the side face between
function pillar(d, cx, cy, cell, h, radius, seed, topStyle) {
  const r = new PyRandom(seed);
  const base = hexPoints(cx, cy + h / 2, cell * radius * 2), top = hexPoints(cx, cy - h / 2, cell * radius * 2);
  const k = r.uniform(0.9, 1.1), side = scale3(COVER_SIDE, k), topCol = lift3(COVER_TOP, k);
  for (const [a, b] of [[1, 2], [2, 3], [3, 4]]) {                         // the side faces toward the viewer
    const shade = { 1: 1.25, 2: 1.0, 3: 0.8 }[a];
    d.polygon([top[a], top[b], base[b], base[a]], [...lift3(side, shade), 255]);
  }
  for (const a of [2, 3]) d.line([top[a], base[a]], [20, 18, 34, 255], Math.max(1, T(cell * 0.012)));   // vertical edges
  d.polygon(top, [...topCol, 255]);
  d.line([top[4], top[5], top[0], top[1]], [...lift3(topCol, 1.35), 255], Math.max(2, T(cell * 0.02)));
  d.line([top[1], top[2], top[3], top[4]], [28, 24, 46, 255], Math.max(1, T(cell * 0.014)));
  const tx = cx, ty = cy - h / 2, R = cell * radius;
  if (topStyle === "chip") {                                                // a chipped corner
    const c0 = top[0];
    d.polygon([c0, [c0[0] + R * 0.45, c0[1] + R * 0.28], [c0[0] - R * 0.1, c0[1] + R * 0.5]], [...scale3(topCol, 0.7), 255]);
  } else if (topStyle === "crack") {                                        // a crack across the top
    const pts = [[tx - R * 0.7, ty - R * 0.1]];
    for (let i = 1; i < 5; i++) pts.push([tx - R * 0.7 + i * R * 0.35, ty - R * 0.1 + r.uniform(-R * 0.18, R * 0.18)]);
    d.line(pts, [26, 22, 44, 255], Math.max(1, T(cell * 0.014)));
  } else if (topStyle === "shear") {                                        // a sheared-off slab
    d.polygon([top[5], top[0], [tx + R * 0.1, ty - R * 0.1], [tx - R * 0.55, ty + R * 0.05]], [...lift3(topCol, 1.2), 255]);
    d.line([[tx - R * 0.55, ty + R * 0.05], [tx + R * 0.1, ty - R * 0.1]], [26, 22, 44, 255], Math.max(1, T(cell * 0.012)));
  }
}

// Pillars on a footprint: specs = [height (of a cell), radius, seed, top style] per hex, back to front
function pillarToken(cell, footprint, specs) {
  const { img, cs } = tokenCanvas(cell, footprint), layer = newImage("RGBA", img.w, img.h), d = new Draw(layer);
  const pairs = cs.map((c, i) => [c, specs[i]]).sort((p, q) => p[0][1] - q[0][1]);
  for (const [[cx, cy], [h, radius, seed, style]] of pairs) pillar(d, cx, cy, cell, h * cell, radius, seed, style);
  return withShadow(layer, cell, 0.07, 0.09, 0.05, 0.6);
}

function boulder(cell, footprint, seed) {
  const { img, cs } = tokenCanvas(cell, footprint), layer = newImage("RGBA", img.w, img.h), d = new Draw(layer);
  const r = new PyRandom(seed), [, , hw, qh] = geometry(cell);
  const xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]);
  const cx = xs.reduce((a, b) => a + b, 0) / cs.length, cy = ys.reduce((a, b) => a + b, 0) / cs.length;
  const fw = Math.max(...xs) - Math.min(...xs) + 2 * hw, fh = Math.max(...ys) - Math.min(...ys) + 4 * qh;
  const R = Math.min(fw, fh) * 0.4, n = 9, rim = [];
  for (let k = 0; k < n; k++) {
    const px = cx + Math.cos(2 * Math.PI * k / n) * R * r.uniform(0.8, 1.05);
    rim.push([px, cy + Math.sin(2 * Math.PI * k / n) * R * r.uniform(0.8, 1.05) * 0.9]);
  }
  const core = [cx - R * 0.15, cy - R * 0.2];
  for (let k = 0; k < n; k++) {                                            // faceted: each facet lit by its angle
    const a = rim[k], b = rim[(k + 1) % n];
    const mid = [(a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy];
    const light = 0.75 + 0.45 * (-(mid[0] + mid[1]) / (Math.hypot(...mid) * 1.42 + 1e-6));
    d.polygon([core, a, b], [...[104, 94, 128].map((v) => T(Math.min(255, v * light))), 255]);
    d.line([core, a], [60, 52, 80, 255], Math.max(1, T(cell * 0.01)));
  }
  for (let i = 0; i < 3; i++) {                                            // a few violet crystal glints
    const x = cx + r.uniform(-R, R) * 0.5, y = cy + r.uniform(-R, R) * 0.5, s = cell * 0.06;
    d.polygon([[x, y - s], [x + s * 0.5, y], [x, y + s * 0.6], [x - s * 0.5, y]], [190, 160, 240, 255]);
  }
  return withShadow(layer, cell, 0.06, 0.08, 0.05, 0.6);
}

function flagToken(cell) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), layer = newImage("RGBA", img.w, img.h), d = new Draw(layer), [cx, cy] = cs[0];
  d.ellipse([cx - cell * 0.12, cy + cell * 0.1, cx + cell * 0.12, cy + cell * 0.2], { fill: [40, 34, 64, 255] });   // foot
  d.line([[cx, cy + cell * 0.15], [cx, cy - cell * 0.42]], [220, 220, 235, 255], Math.max(2, T(cell * 0.04)));
  const flag = [[cx, cy - cell * 0.42], [cx + cell * 0.38, cy - cell * 0.3], [cx, cy - cell * 0.16]];
  d.polygon(flag, [...GLOW, 255]);
  d.line([flag[0], flag[1], flag[2]], [220, 255, 230, 255], Math.max(1, T(cell * 0.015)));
  const g = gaussianBlur(layer, cell * 0.05);
  for (let i = 0; i < g.data.length; i += 4) { g.data[i] = GLOW[0]; g.data[i + 1] = GLOW[1]; g.data[i + 2] = GLOW[2]; g.data[i + 3] = T(g.data[i + 3] * 0.6); }
  const out = newImage("RGBA", img.w, img.h);
  alphaCompositeAt(out, g);
  alphaCompositeAt(out, layer);
  return withShadow(out, cell, 0.04, 0.06, 0.04, 0.5);
}

function padToken(cell) { return spawnPad(tokenCanvas(cell, [[0, 0]]).img, 0, 0, cell); }
function flagStandToken(cell) { return flagStand(tokenCanvas(cell, [[0, 0]]).img, 0, 0, cell); }

export const TOKENS = {
  vr_ground_v1: (c) => groundTile(c, basaltSurface, 5),
  vr_ground_v2: (c) => groundTile(c, basaltSurface, 15),
  vr_ground_v3: (c) => groundTile(c, basaltSurface, 25),
  vr_ground_destroyed_v1: (c) => groundTile(c, basaltSurface, 7, true),
  vr_ground_destroyed_v2: (c) => groundTile(c, basaltSurface, 17, true),
  vr_sand_v1: (c) => groundTile(c, sandSurface, 6),
  vr_sand_v2: (c) => groundTile(c, sandSurface, 16),
  vr_spawn_pad: padToken,
  vr_flag_stand: flagStandToken,
  vr_pillar_size1_v1: (c) => pillarToken(c, [[0, 0]], [[0.26, 0.34, 31, "chip"]]),
  vr_pillar_size1_v2: (c) => pillarToken(c, [[0, 0]], [[0.18, 0.35, 32, "crack"]]),
  vr_pillar_size1_v3: (c) => pillarToken(c, [[0, 0]], [[0.3, 0.33, 33, "shear"]]),
  vr_pillar_size2: (c) => pillarToken(c, size2Footprint(c), [[0.32, 0.34, 34, "crack"], [0.16, 0.35, 35, "chip"], [0.24, 0.34, 36, "shear"]]),
  vr_basalt_size1: (c) => columnCluster(c, [[0, 0]], 11),
  vr_basalt_size2: (c) => columnCluster(c, size2Footprint(c), 12),
  vr_boulder_size1_v1: (c) => boulder(c, [[0, 0]], 21),
  vr_boulder_size1_v2: (c) => boulder(c, [[0, 0]], 22),
  vr_boulder_size2: (c) => boulder(c, size2Footprint(c), 23),
  vr_flag: flagToken,
};

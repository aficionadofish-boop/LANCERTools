// Freight Tunnel: the ground under a moving train, seen from above. A dark concrete trench between
// two lined tunnel walls (segment joints, cable trays, lamps), with the railway down the middle. The
// train itself is tokens (deck tiles and cargo, set fl_), so the base map is what rushes past below
// them: every layer is streaked lengthwise by the motion, and the tokens on top stay sharp.
//
// Decals: tracks -> the railway (ballast, sleepers, two rails); blast/scorch -> scorched ground;
// hazard_ring -> a yellow/black band; floor_hatch -> a drain grate.
// "obstruction" terrain (outside the play area) -> the tunnel wall. A whole row of it reads as one
// straight wall face, not the hex zigzag.
//
// Every layer has its own random stream, so a slider changes only its own layer.

import { NpRandom, PyRandom } from "../../rng.js?v=ee0d9b06b0";
import { newImage, Draw, alphaComposite, gaussianBlur, u8 } from "../../raster.js?v=ee0d9b06b0";
import { centre, geometry, imageSize } from "../geometry.js?v=ee0d9b06b0";
import { noise, decalBlast, decalHazardRing, ZONE_SETTINGS, withDefaults, keeper, extras } from "../common.js?v=ee0d9b06b0";
import { drawAllZones } from "../common.js?v=ee0d9b06b0";

const FLOOR = [52, 54, 58];
const FLOOR_DARK = [34, 35, 38];
const WALL = [66, 68, 72];
const WALL_DARK = [40, 41, 44];
const BALLAST = [72, 68, 62];
const SLEEPER = [118, 116, 110];
const RAIL = [150, 154, 160];
const RAIL_TOP = [214, 218, 224];
const LAMP = [255, 196, 120];

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// --- the trench floor ------------------------------------------------------------------------------------

function floor([w, h], cell, o) {
  const big = noise(h, w, cell * 3, 201), mott = noise(h, w, cell * 0.6, 202), g = new NpRandom(203);
  const img = newImage("RGBA", w, h);
  for (let p = 0; p < w * h; p++) {
    const s = (big[p] - 0.5) * 1.6, m = (mott[p] - 0.5) * 14 * o.grime, grain = g.normal(0, 3);
    for (let k = 0; k < 3; k++) img.data[p * 4 + k] = u8(lerp(FLOOR[k], s > 0 ? FLOOR[k] * 1.12 : FLOOR_DARK[k], Math.abs(s)) + m + grain);
    img.data[p * 4 + 3] = 255;
  }
  return img;
}

// stains and oil: dark blotches the train has dripped over the years
function stains(img, cell, o) {
  const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), r = new PyRandom(211);
  const area = (w * h) / (cell * cell), keep = keeper(211, o.grime);
  const n = Math.round(area / 3), more = extras(n, o.grime, 1211);
  const one = (g) => {
    const x = g.uniform(0, w), y = g.uniform(0, h), rx = cell * g.uniform(0.2, 0.9), ry = rx * g.uniform(0.3, 0.7), a = g.randint(20, 55);
    const deep = Math.min(255, Math.round(a * Math.max(1, 1 + (o.grime - 1) * 1.6)));        // above 100% the stains darken too
    return () => d.ellipse([x - rx, y - ry, x + rx, y + ry], { fill: [14, 14, 16, deep] });
  };
  for (let i = 0; i < n; i++) { const draw = one(r); if (keep(i)) draw(); }
  for (let i = 0; i < more.count; i++) one(more.rng)();                          // above 100%: more stains, the rest unmoved
  return alphaComposite(img, gaussianBlur(over, cell * 0.08));
}

// --- the tunnel walls -------------------------------------------------------------------------------------

// The wall area as one mask, with straight faces where whole runs of a row are wall: each wall hex
// fills its column strip, cut at its shoulder line on any side where the neighbouring row is open.
export function wallMask([w, h], solid, data, cell) {
  const [sx, sy, hw, qh] = geometry(cell), m = newImage("L", w, h), d = new Draw(m), key = (c, r) => c + "," + r;
  const isSolid = (c, r) => r < 0 || r >= data.rows || solid.has(key(c, r));
  const faces = [];                                                          // [x0, x1, y, side] wall faces
  for (const k of solid) {
    const [c, r] = k.split(",").map(Number), [cx, cy] = centre(c, r, cell);
    const up = r % 2 ? [[c, r - 1], [c + 1, r - 1]] : [[c - 1, r - 1], [c, r - 1]];
    const dn = r % 2 ? [[c, r + 1], [c + 1, r + 1]] : [[c - 1, r + 1], [c, r + 1]];
    const openUp = up.some(([a, b]) => !isSolid(a, b)), openDn = dn.some(([a, b]) => !isSolid(a, b));
    const y0 = openUp ? cy - qh : cy - 2 * qh - 1, y1 = openDn ? cy + qh : cy + 2 * qh + 1;
    d.rectangle([cx - hw, y0, cx + hw, y1], { fill: 255 });
    if (openUp) faces.push([cx - hw, cx + hw, y0, -1]);
    if (openDn) faces.push([cx - hw, cx + hw, y1, 1]);
  }
  return { m, faces };
}

function walls(img, solid, data, cell, o) {
  const { w, h } = img, { m, faces } = wallMask([w, h], solid, data, cell);
  const tex = noise(h, w, cell * 0.8, 221), g = new NpRandom(222);
  for (let p = 0; p < w * h; p++) {                                          // the lining: lit concrete
    if (!m.data[p]) continue;
    const t = (tex[p] - 0.5) * 18, i = p * 4, gr = g.normal(0, 2.5);
    for (let k = 0; k < 3; k++) img.data[i + k] = u8(WALL[k] + t + gr);
  }
  const d = new Draw(img), seg = cell * 1.6, lw = Math.max(2, Math.trunc(cell * 0.03));
  for (const [x0, x1, y, side] of faces) {                                  // along the floor: a drain channel, a safety line
    const yd = y + side * cell * 0.2, ys = y + side * cell * 0.62;
    d.rectangle([x0, yd - cell * 0.035, x1 + 1, yd + cell * 0.035], { fill: [20, 20, 22, 255] });
    d.rectangle([x0, yd - cell * 0.035 - 2, x1 + 1, yd - cell * 0.035], { fill: [78, 80, 86, 255] });
    d.rectangle([x0, ys - cell * 0.02, x1 + 1, ys + cell * 0.02], { fill: [190, 150, 52, 255] });
  }
  for (let x = seg / 2; x < w; x += seg)                                    // segment joints across the lining
    for (let y = 0; y < h; y += 2) if (m.data[Math.trunc(y) * w + Math.trunc(x)]) d.rectangle([x, y, x + lw, y + 2], { fill: [...WALL_DARK, 255] });
  for (const [x0, x1, y, side] of faces) {                                  // the face: a dark kerb and a lit lip
    d.rectangle([x0, side < 0 ? y : y - cell * 0.06, x1 + 1, side < 0 ? y + cell * 0.06 : y], { fill: [24, 24, 27, 255] });
    d.rectangle([x0, side < 0 ? y - cell * 0.03 : y + 0, x1 + 1, side < 0 ? y : y + cell * 0.03], { fill: [...WALL_DARK, 255] });
  }
  // cable trays: thin runs along the wall a little back from each face, with brackets
  const rc = new PyRandom(231), keepC = keeper(231, o.cables);
  faces.forEach(([x0, x1, y, side], i) => {
    for (let k = 0; k < 2; k++) {
      const yy = y - side * cell * (0.16 + k * 0.1), col = k ? [30, 32, 36, 255] : [86, 82, 74, 255];
      if (keepC(i * 2 + k)) d.rectangle([x0, yy - cell * 0.012, x1 + 1, yy + cell * 0.012], { fill: col });
    }
    if (keepC(1000 + i) && rc.random() < 0.6) {
      const bx = rc.uniform(x0, x1);
      d.rectangle([bx, Math.min(y, y - side * cell * 0.3), bx + cell * 0.03, Math.max(y, y - side * cell * 0.3)], { fill: [96, 96, 100, 255] });
    }
  });
  return { img, faces, mask: m };
}

// lamps: fittings on each wall face every few hexes, with a warm pool of light thrown onto the floor
function lamps(img, faces, cell, o) {
  if (!o.lamps) return img;
  const { w, h } = img, glow = newImage("RGBA", w, h), gd = new Draw(glow), d = new Draw(img);
  const spacing = cell * 3.2 / o.lamps, seen = new Set();
  for (const [x0, x1, y, side] of faces) {
    const off = side > 0 ? spacing / 2 : 0;                                 // the two walls' lamps alternate
    for (let x = Math.ceil((x0 - off) / spacing) * spacing + off; x < x1; x += spacing) {
      const k = Math.round(x) + "," + Math.round(y);
      if (seen.has(k)) continue;
      seen.add(k);
      const fy = y - side * cell * 0.1;
      d.rectangle([x - cell * 0.14, fy - cell * 0.035, x + cell * 0.14, fy + cell * 0.035], { fill: [...LAMP, 255] });
      const gy = y + side * cell * 0.5;
      gd.ellipse([x - cell * 1.1, gy - cell * 0.55, x + cell * 1.1, gy + cell * 0.55], { fill: [...LAMP, 70] });
      gd.ellipse([x - cell * 0.5, y + side * cell * 0.1 - cell * 0.22, x + cell * 0.5, y + side * cell * 0.1 + cell * 0.22], { fill: [...LAMP, 90] });
    }
  }
  const soft = gaussianBlur(glow, cell * 0.25);
  for (let p = 0; p < w * h; p++) {                                         // added, as light is
    const a = soft.data[p * 4 + 3] / 255;
    if (!a) continue;
    for (let k = 0; k < 3; k++) img.data[p * 4 + k] = u8(img.data[p * 4 + k] + soft.data[p * 4 + k] * a * 0.55);
  }
  return img;
}

// --- the railway ----------------------------------------------------------------------------------------

function railway(img, a, b, cell) {
  const [ax, ay] = centre(a[0], a[1], cell), [bx, by] = centre(b[0], b[1], cell);
  const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
  const gauge = cell * 2.6, bed = gauge / 2 + cell * 0.55, ext = cell * 0.5;
  const P = (t, s) => [ax + ux * t + nx * s, ay + uy * t + ny * s];
  const over = newImage("RGBA", img.w, img.h), d = new Draw(over), r = new PyRandom(241);
  d.polygon([P(-ext, -bed), P(L + ext, -bed), P(L + ext, bed), P(-ext, bed)], [...BALLAST, 255]);   // ballast bed
  for (let i = Math.round((L + 2 * ext) * bed * 2 / (cell * cell) * 160); i > 0; i--) {           // the stones
    const [x, y] = P(r.uniform(-ext, L + ext), r.uniform(-bed, bed)), s = cell * r.uniform(0.012, 0.03), v = r.randint(-26, 26);
    d.ellipse([x - s, y - s, x + s, y + s], { fill: [BALLAST[0] + v, BALLAST[1] + v, BALLAST[2] + v, 255] });
  }
  for (let t = -ext + cell * 0.2; t < L + ext; t += cell * 0.42) {                                  // concrete sleepers
    const half = gauge / 2 + cell * 0.32, tw = cell * 0.08;
    d.polygon([P(t - tw, -half), P(t + tw, -half), P(t + tw, half), P(t - tw, half)], [...SLEEPER, 255]);
    d.polygon([P(t + tw * 0.4, -half), P(t + tw, -half), P(t + tw, half), P(t + tw * 0.4, half)], [86, 84, 80, 255]);
  }
  for (const s of [-gauge / 2, gauge / 2]) {                                                       // two rails
    const rw = cell * 0.045;
    d.polygon([P(-ext, s - rw), P(L + ext, s - rw), P(L + ext, s + rw), P(-ext, s + rw)], [...RAIL, 255]);
    d.polygon([P(-ext, s - rw * 0.35), P(L + ext, s - rw * 0.35), P(L + ext, s + rw * 0.25), P(-ext, s + rw * 0.25)], [...RAIL_TOP, 255]);
  }
  return alphaComposite(img, over);
}

// a drain grate in the trench floor
function drain(img, hexes, cell) {
  const d = new Draw(img);
  for (const [c, r] of hexes) {
    const [cx, cy] = centre(c, r, cell), s = cell * 0.3;
    d.rectangle([cx - s, cy - s * 0.6, cx + s, cy + s * 0.6], { fill: [20, 20, 22, 255], outline: [96, 98, 104, 255], width: Math.max(2, Math.trunc(cell * 0.02)) });
    for (let k = -3; k <= 3; k++) d.line([[cx + k * s * 0.26, cy - s * 0.5], [cx + k * s * 0.26, cy + s * 0.5]], [80, 82, 88, 255], Math.max(1, Math.trunc(cell * 0.015)));
  }
  return img;
}

// --- the motion ---------------------------------------------------------------------------------------------

// Streak everything lengthwise: a box blur along each row (the ground moving west under the train)
function motion(img, cell, amount) {
  const L = Math.round(cell * 0.28 * amount);
  if (L < 2) return img;
  const { w, h } = img, out = newImage("RGBA", w, h), half = L >> 1;
  const acc = new Float64Array(3);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    acc.fill(0);
    let n = 0;
    for (let x = -half; x < w + half; x++) {
      const xin = x + half, xout = x - half - 1;
      if (xin >= 0 && xin < w) { for (let k = 0; k < 3; k++) acc[k] += img.data[(row + xin) * 4 + k]; n++; }
      if (xout >= 0 && xout < w) { for (let k = 0; k < 3; k++) acc[k] -= img.data[(row + xout) * 4 + k]; n--; }
      if (x >= 0 && x < w) {
        const i = (row + x) * 4;
        for (let k = 0; k < 3; k++) out.data[i + k] = u8(acc[k] / n);
        out.data[i + 3] = 255;
      }
    }
  }
  return out;
}

// speed lines: thin long streaks of grit and light, drawn after the blur so they stay crisp at the edges
function speedLines(img, cell, o) {
  const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), r = new PyRandom(251);
  const n = Math.round((w * h) / (cell * cell) * 1.2), keep = keeper(251, o.speedlines);
  for (let i = 0; i < n; i++) {
    const x = r.uniform(-cell, w), y = r.uniform(0, h), L = cell * r.uniform(0.8, 3.5), light = r.random() < 0.55;
    const col = light ? [210, 210, 215, r.randint(26, 60)] : [6, 6, 8, r.randint(30, 60)];
    if (keep(i)) d.line([[x, y], [x + L, y]], col, Math.max(1, Math.trunc(cell * r.uniform(0.008, 0.02))));
  }
  return alphaComposite(img, over);
}

// --- the base map -----------------------------------------------------------------------------------------

export const name = "Freight Tunnel";
export const blurb = "The ground under a moving train: a dark concrete trench between lined tunnel walls with cable trays and lamps, the railway down the middle, everything streaked by the speed. The train itself is tokens.";
export const decals = ["tracks", "blast", "scorch", "hazard_ring", "floor_hatch"];
export const terrainNote = "Freight Tunnel draws it as the tunnel wall, with the lamps and cable trays; a whole row of it gives one straight wall face. Paint the top and bottom rows for a tunnel.";
export const tools = {
  tracks: { label: "Railway track", hint: "Click the start hex, then the end hex: ballast, sleepers and two rails between them (they run on half a hex past each end)." },
  hatch: { label: "Drain grate", hint: "A drain grate in the trench floor." },
};
export const settings = [
  { id: "grime", label: "Stains and wear", group: "Ground", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "cables", label: "Cable trays (on painted walls)", group: "Walls", type: "range", min: 0, max: 1, step: 0.05, default: 1 },
  { id: "lamps", label: "Lamps (on painted walls)", group: "Walls", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "motion", label: "Motion streaks", group: "Speed", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "speedlines", label: "Speed lines", group: "Speed", type: "range", min: 0, max: 1, step: 0.05, default: 1 },
  ...ZONE_SETTINGS,
];

export function render(data, cell, opts = {}) {
  const o = withDefaults(settings, opts);
  const [w, h] = imageSize(data.cols, data.rows, cell);
  const zones = data.zones || {};
  let img = floor([w, h], cell, o);
  img = stains(img, cell, o);
  for (const dec of data.decals || []) if (dec.type === "tracks") img = railway(img, dec.from, dec.to, cell);
  for (const dec of data.decals || []) {
    const kind = dec.type, hexes = dec.hexes || (dec.zone && zones[dec.zone] ? zones[dec.zone].hexes : []);
    if (kind === "blast" || kind === "scorch") img = decalBlast(img, hexes, cell, 3);
    else if (kind === "hazard_ring") img = decalHazardRing(img, hexes, cell);
    else if (kind === "floor_hatch") img = drain(img, hexes, cell);
  }
  const solid = new Set(Object.entries(data.terrain || {}).filter(([, v]) => v === "obstruction").map(([k]) => k));
  let faces = [];
  if (solid.size) ({ img, faces } = walls(img, solid, data, cell, o));
  img = lamps(img, faces, cell, o);
  img = motion(img, cell, o.motion);
  img = speedLines(img, cell, o);
  return drawAllZones(img, zones, cell, o);
}

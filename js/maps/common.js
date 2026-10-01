// What every map style shares (from roll20_maps.py): noise, the sitrep zones, and the decals.
// Ported line for line; random numbers come from rng.js, so layouts match the Python tools.

import { NpRandom, PyRandom } from "../rng.js?v=0f282507bd";
import { newImage, Draw, alphaComposite, paste, gaussianBlur, resizeL, toL, u8 } from "../raster.js?v=0f282507bd";
import { centre, hexPoints, zoneEdges, connectedParts } from "./geometry.js?v=0f282507bd";

const F = Math.fround;

export const BG = [34, 35, 37];
export const HAZARD_Y = [215, 165, 29];
export const ZONE_TINT = { pc_deploy: [[68, 136, 255], 34], control_zone: [[153, 68, 204], 30] };
export const DEFAULT_TINT = [[200, 200, 200], 26];
export const ZONE_LABEL = { pc_deploy: "DEPLOY ZONE", control_zone: "CONTROL ZONE", npc_deploy: "ENEMY DEPLOY" };
const RULE_ZONES = ["pc_deploy", "control_zone", "npc_deploy", "ingress", "entrance"];

export const font = (size) => Math.trunc(size);        // roll20_maps.font(): a pixel size

// --- style settings ------------------------------------------------------------------------------
// Each style lists its settings ({id, label, group, type: "range" | "toggle", min, max, step,
// default}); the defaults give exactly the approved look. Density settings THIN or ADD without
// reshuffling: every item is still generated from the same random stream (so nothing else moves);
// below 100% an item is skipped when a fixed per-item hash says so, above 100% extra items come
// from a separate stream.

export const ZONE_SETTINGS = [
  { id: "zones", label: "Zone tint and outline", group: "Zones", type: "toggle", default: true },
  { id: "labels", label: "Zone labels", group: "Zones", type: "toggle", default: true },
];

export function withDefaults(settings, opts = {}) {
  const o = {};
  for (const s of settings) o[s.id] = opts[s.id] ?? s.default;
  return o;
}

function hashUnit(a, b) {                                   // a fixed pseudo-random number in [0, 1) per (a, b)
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// keep(i): draw item i of a layer at this density? (always, at 100% or more)
export const keeper = (layer, density) => (i) => density >= 1 || hashUnit(layer, i) < density;

// How many extra items to add above 100%, and a separate random stream for them
export function extras(n, density, seed) {
  return density > 1 ? { count: Math.floor((density - 1) * n), rng: new PyRandom(seed) } : { count: 0, rng: null };
}

// --- noise --------------------------------------------------------------------------------------

// Value noise in 0..1 (float32), from milbay_map.noise / vr_map.noise: bicubic-upsampled random grids
export function noise(h, w, cell, seed, octaves = 3) {
  const rng = new NpRandom(seed);
  const out = new Float32Array(w * h);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const c = Math.max(2, Math.trunc(cell / 2 ** o));
    const gh = Math.max(2, Math.floor(h / c) + 2), gw = Math.max(2, Math.floor(w / c) + 2);
    const g = rng.randomArray(gh * gw);
    const grid = new Uint8Array(gh * gw);
    for (let i = 0; i < grid.length; i++) grid[i] = Math.trunc(g[i] * 255);
    const up = resizeL(grid, gw, gh, w, h);
    for (let i = 0; i < out.length; i++) out[i] = F(out[i] + F(F(up[i] / 255) * amp));
    tot += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] = F(out[i] / tot);
  return out;
}

// roll20_maps.smooth_noise: 4 octaves from a shared generator
export function smoothNoise(h, w, scale, rng, octaves = 4) {
  const out = new Float32Array(w * h);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const gh = Math.max(2, Math.trunc(h / scale) + 2), gw = Math.max(2, Math.trunc(w / scale) + 2);
    const g = rng.randomArray(gh * gw);
    const grid = new Uint8Array(gh * gw);
    for (let i = 0; i < grid.length; i++) grid[i] = Math.trunc(g[i] * 255);
    const up = resizeL(grid, gw, gh, w, h);
    for (let i = 0; i < out.length; i++) out[i] += amp * up[i] / 255;
    total += amp;
    amp *= 0.5;
    scale /= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// roll20_maps.noise_rgb: a flat colour with Gaussian grain (RGBA, opaque)
export function noiseRgb([w, h], base, amount, seed) {
  const rng = new NpRandom(seed), im = newImage("RGBA", w, h);
  for (let p = 0; p < w * h; p++) {
    const g = rng.normal(0, amount);
    for (let k = 0; k < 3; k++) im.data[p * 4 + k] = u8(base[k] + g);
    im.data[p * 4 + 3] = 255;
  }
  return im;
}

export function stripes([w, h], width, colours = [HAZARD_Y, [20, 20, 20]], angleSign = 1) {
  const im = newImage("RGBA", w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const band = ((Math.floor((x + angleSign * y) / width) % 2) + 2) % 2;
      const c = colours[band === 0 ? 0 : 1], i = (y * w + x) * 4;
      im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = 255;
    }
  return im;
}

export function maskOf([w, h], centres, cell, inset = 0) {
  const m = newImage("L", w, h), d = new Draw(m);
  for (const [cx, cy] of centres) d.polygon(hexPoints(cx, cy, cell, inset), 255);
  return m;
}

// --- the floor of the plain style -----------------------------------------------------------------

export function drawFloor([w, h], cell) {
  const floor = noiseRgb([w, h], BG, 2.2, 99), d = new Draw(floor);
  const stepX = Math.trunc(cell * 2.2), stepY = Math.trunc(cell * 1.6);
  const lw = Math.max(2, Math.trunc(cell * 0.03));
  for (let x = stepX; x < w; x += stepX) {
    d.line([[x, 0], [x, h]], [27, 28, 30, 255], lw);
    d.line([[x + 2, 0], [x + 2, h]], [42, 43, 45, 255], 1);
  }
  for (let y = stepY; y < h; y += stepY) {
    d.line([[0, y], [w, y]], [27, 28, 30, 255], lw);
    d.line([[0, y + 2], [w, y + 2]], [42, 43, 45, 255], 1);
  }
  return floor;
}

// --- zones ----------------------------------------------------------------------------------------

// Both passes of the zones, as every style draws them last; o.zones / o.labels switch them off
export function drawAllZones(img, zones, cell, o, tint = {}) {
  if (o.zones) img = drawZones(img, zones, cell, { tint });
  if (o.labels) img = drawZones(img, zones, cell, { labels: true, tint });
  return img;
}

// The sitrep zones: a tint and a dashed outline, or (labels) a plated label on each part's top row.
// `tint` overrides ZONE_TINT per zone id.
export function drawZones(img, zones, cell, { labels = false, tint = {} } = {}) {
  const over = newImage("RGBA", img.w, img.h), d = new Draw(over);
  const f = font(cell * 0.2);
  for (const [zid, z] of Object.entries(zones)) {
    if (!RULE_ZONES.some((p) => zid.startsWith(p))) continue;
    const hexes = z.hexes || [];
    if (!hexes.length) continue;
    const [rgb, alpha] = tint[zid] || ZONE_TINT[zid] || DEFAULT_TINT;
    if (labels) {
      const label = ZONE_LABEL[zid] || (zid.startsWith("ingress") ? "INGRESS" : null) ||
        (zid.startsWith("entrance") ? "ENTRANCE" : z.label || "");
      if (!label) continue;
      for (const part of connectedParts(hexes, cell)) {
        const top = Math.min(...part.map(([, r]) => r));
        const row = part.filter(([, r]) => r === top).map(([c, r]) => centre(c, r, cell));
        const tx = row.reduce((s, [x]) => s + x, 0) / row.length, ty = row[0][1];
        const text = label.toUpperCase(), tw = d.textLength(text, f), m = cell * 0.05;
        d.roundedRectangle([tx - tw / 2 - m * 2, ty - cell * 0.12 - m, tx + tw / 2 + m * 2, ty + cell * 0.12 + m], m * 2,
          { fill: [20, 21, 23, 215] });
        d.text([tx - tw / 2, ty - cell * 0.12], text, f, [...rgb, 230]);
      }
      continue;
    }
    for (const [c, r] of hexes) d.polygon(hexPoints(...centre(c, r, cell), cell), [...rgb, alpha]);
    for (const [a, b] of zoneEdges(hexes, cell))                 // dashed outline: the rules boundary
      for (let t = 0; t < 8; t += 2) {
        const p = [a[0] + (b[0] - a[0]) * t / 8, a[1] + (b[1] - a[1]) * t / 8];
        const q = [a[0] + (b[0] - a[0]) * (t + 1) / 8, a[1] + (b[1] - a[1]) * (t + 1) / 8];
        d.line([p, q], [...rgb, 200], Math.max(2, Math.trunc(cell * 0.035)));
      }
  }
  return alphaComposite(img, over);
}

// --- decals ---------------------------------------------------------------------------------------

function wornAlpha(img, band, cell, seed) {
  const worn = gaussianBlur(toL(noiseRgb([img.w, img.h], [0, 0, 0], 60, seed)), cell * 0.02);
  const alpha = newImage("L", img.w, img.h);
  for (let p = 0; p < alpha.data.length; p++) {
    const k = Math.min(1, Math.max(0.55, ((worn.data[p] + 40) & 255) / 80));   // uint8 + 40 wraps, as in numpy
    alpha.data[p] = Math.trunc(band.data[p] * k);
  }
  return alpha;
}

// A yellow/black band on the floor around a block of hexes (outside their outer edges)
export function decalHazardRing(img, hexes, cell) {
  const bandW = Math.trunc(cell * 0.2);
  const inside = maskOf([img.w, img.h], hexes.map(([c, r]) => centre(c, r, cell)), cell);
  const band = newImage("L", img.w, img.h), d = new Draw(band);
  for (const [a, b] of zoneEdges(hexes, cell)) {
    d.line([a, b], 255, bandW * 2);
    for (const [x, y] of [a, b]) d.ellipse([x - bandW, y - bandW, x + bandW, y + bandW], { fill: 255 });
  }
  for (let p = 0; p < band.data.length; p++) if (inside.data[p] > 0) band.data[p] = 0;
  paste(img, stripes([img.w, img.h], Math.trunc(cell * 0.16)), wornAlpha(img, band, cell, 9));
  return img;
}

// A straight yellow/black band round a zone's inner rectangle (an elevator deck)
export function decalHazardBorder(img, zoneHexes, cell) {
  const { w, h } = img, rows = new Map();
  for (const [c, r] of zoneHexes) { if (!rows.has(r)) rows.set(r, []); rows.get(r).push(centre(c, r, cell)[0]); }
  const vals = [...rows.values()];
  let x0 = Math.max(...vals.map((v) => Math.min(...v))) - 0.3 * cell;
  let x1 = Math.min(...vals.map((v) => Math.max(...v))) + 0.3 * cell;
  const ys = zoneHexes.map(([c, r]) => centre(c, r, cell)[1]);
  let y0 = Math.min(...ys) - 0.3 * cell, y1 = Math.max(...ys) + 0.3 * cell;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w - 1, x1); y1 = Math.min(h - 1, y1);
  const band = newImage("L", w, h);
  new Draw(band).rectangle([x0, y0, x1, y1], { outline: 255, width: Math.trunc(cell * 0.22) });
  paste(img, stripes([w, h], Math.trunc(cell * 0.16)), wornAlpha(img, band, cell, 7));
  return img;
}

// Drag marks: clusters of roughly parallel, slightly curved grooves with a pale edge
export function decalScuffs(img, hexes, cell, seed = 1) {
  const over = newImage("RGBA", img.w, img.h), d = new Draw(over), rng = new PyRandom(seed);
  for (const [c, r] of hexes) {
    const [cx, cy] = centre(c, r, cell);
    const heading = rng.uniform(-0.35, 0.35) + Math.PI / 2;
    for (let n = rng.randint(4, 7); n > 0; n--) {
      const off = rng.uniform(-0.35, 0.35) * cell, ln = rng.uniform(0.35, 0.8) * cell, bend = rng.uniform(-0.08, 0.08);
      const sx = cx + Math.cos(heading + Math.PI / 2) * off;
      const sy = cy + Math.sin(heading + Math.PI / 2) * off - Math.sin(heading) * ln / 2;
      const pts = [];
      for (let i = 0; i < 9; i++) { const t = i / 8, a = heading + bend * t; pts.push([sx + Math.cos(a) * ln * t, sy + Math.sin(a) * ln * t]); }
      const wd = Math.max(1, Math.trunc(cell * rng.uniform(0.012, 0.03)));
      d.line(pts, [14, 14, 15, rng.randint(90, 150)], wd + 1);
      d.line(pts.map(([x, y]) => [x + 1.5, y]), [120, 124, 126, rng.randint(40, 80)], Math.max(1, wd >> 1));
    }
  }
  return alphaComposite(img, over);
}

export function decalBlob(img, hexes, cell, rgb, alpha, scale, seed, rim = null) {
  const over = newImage("RGBA", img.w, img.h), d = new Draw(over), rng = new PyRandom(seed);
  for (const [c, r] of hexes) {
    let [cx, cy] = centre(c, r, cell);
    cx += rng.uniform(-0.2, 0.2) * cell;
    cy += rng.uniform(-0.2, 0.2) * cell;
    const rx = scale * cell * rng.uniform(0.8, 1.2), ry = scale * cell * rng.uniform(0.6, 1.0);
    if (rim) d.ellipse([cx - rx * 1.08, cy - ry * 1.08, cx + rx * 1.08, cy + ry * 1.08], { fill: rim });
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], { fill: [...rgb, alpha] });
  }
  return alphaComposite(img, gaussianBlur(over, cell * 0.06));
}

// Blast scorch: a soot fall-off broken up by noise, dark radial streaks, fine grain
export function decalBlast(img, hexes, cell, seed = 1) {
  const { w, h } = img, rng = new NpRandom(seed);
  const soot = new Float32Array(w * h);
  for (const [c, r] of hexes) {
    const [cx, cy] = centre(c, r, cell);
    const R = cell * rng.uniform(1.15, 1.35);
    const n = smoothNoise(h, w, cell * 0.5, rng);
    const angles = [];
    for (let i = 0; i < 40; i++) angles.push(rng.uniform(-Math.PI, Math.PI));
    const streaks = angles.map((a) => ({ a, ln: rng.uniform(0.9, 1.8), wd: rng.uniform(0.015, 0.05) }));
    const reach = R * 1.8 + 2;                                   // nothing is drawn beyond dist 1.8
    const xa = Math.max(0, Math.floor(cx - reach)), xb = Math.min(w - 1, Math.ceil(cx + reach));
    const ya = Math.max(0, Math.floor(cy - reach)), yb = Math.min(h - 1, Math.ceil(cy + reach));
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const p = y * w + x, dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / R, ang = Math.atan2(dy, dx);
        const falloff = Math.max(0, Math.min(1, 1 - dist)) ** 1.1;
        const near = Math.max(0, Math.min(1, 1 - dist / 1.3));
        const body = near > 0 ? Math.max(0, Math.min(1, falloff * 1.5 + (n[p] - 0.5) * near - 0.12)) : 0;
        let streak = 0;
        for (const s of streaks) {
          if (dist >= s.ln) continue;
          let da = (ang - s.a) % (2 * Math.PI);
          if (da > Math.PI) da -= 2 * Math.PI; else if (da <= -Math.PI) da += 2 * Math.PI;
          const v = Math.exp(-((da * dist / s.wd) ** 2)) * (1 - dist / s.ln) ** 1.5;
          if (v > streak) streak = v;
        }
        soot[p] = Math.max(soot[p], Math.max(body * 0.9, dist > 0.2 ? streak * 0.75 : 0));
      }
  }
  const over = newImage("RGBA", w, h);
  for (let p = 0; p < w * h; p++) {
    const grain = Math.min(1.4, Math.max(0.5, rng.normal(1.0, 0.18)));    // drawn for every pixel, as numpy does
    if (!soot[p]) continue;
    const i = p * 4;
    over.data[i] = 10; over.data[i + 1] = 9; over.data[i + 2] = 8;
    over.data[i + 3] = Math.trunc(Math.min(1, soot[p] * grain) * 230);
  }
  return alphaComposite(img, over);
}

export function decalTracks(img, a, b, cell) {
  const over = newImage("RGBA", img.w, img.h), d = new Draw(over);
  const [ax, ay] = centre(a[0], a[1], cell), [bx, by] = centre(b[0], b[1], cell);
  const ln = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / ln, ny = (bx - ax) / ln;
  for (const side of [-1, 1]) {
    const ox = nx * side * cell * 0.45, oy = ny * side * cell * 0.45;
    const steps = Math.trunc(ln / (cell * 0.12));
    for (let i = 0; i < steps; i++) {
      const t = i / steps, x = ax + (bx - ax) * t + ox, y = ay + (by - ay) * t + oy;
      d.line([[x - nx * cell * 0.12, y - ny * cell * 0.12], [x + nx * cell * 0.12, y + ny * cell * 0.12]],
        [14, 14, 15, 90], Math.max(2, Math.trunc(cell * 0.04)));
    }
  }
  return alphaComposite(img, over);
}

// Training Floor, after Synthetik's Training Floor level: sun-baked orange ground under a warm haze, with low-contrast
// paint (pale double bay lines with rounded corners, faint dark stencil codes, hazard-stripe bands,
// dashed outlines, the floor's faint maze pattern, chalk marks), fixtures (vent grilles, dot
// grids, tie-down sockets) and litter (dark flecks, metal chips, pale flakes, brass casings, dust).
// Robot remains (dark oil splats with a wreck bit) are a decor option, off by default.
// Reference: _backstage/reference/synthetik/training_floor/. Scale: a hex is about 110 px of the game's screen.
//
// Decals: blast/scorch -> a blown-up robot (big splat and soot); tracks -> tyre tracks; hazard_border ->
// a hazard-striped loading pad; hazard_ring -> a yellow/black band; floor_hatch -> a round steel hatch.
// "obstruction" terrain (outside the play area) -> fenced-off ground behind a black palisade fence.
//
// Every layer has its own random stream, so a slider changes only its own layer.

import { NpRandom, PyRandom } from "../../rng.js?v=0f282507bd";
import { newImage, Draw, alphaComposite, paste, gaussianBlur, u8 } from "../../raster.js?v=0f282507bd";
import { centre, hexPoints, imageSize, zoneEdges, hexesBox, connectedParts } from "../geometry.js?v=0f282507bd";
import { noise, maskOf, drawAllZones, decalHazardRing, ZONE_SETTINGS, withDefaults, keeper, extras } from "../common.js?v=0f282507bd";
import { maze, remains } from "../synthetik.js?v=0f282507bd";

const F = Math.fround;
const GROUND = [216, 106, 57];
const SUN = [244, 140, 74];
const SHADE = [188, 84, 47];
const PALE = [255, 200, 155];            // painted lines
const DARKPAINT = [120, 44, 20];         // stencils, dashed outlines, stripe bands
const REMAINS = {                           // dark oil, a warm wet halo, dark shards, grey and rusty chunks
  oil: [62, 38, 32], core: [34, 22, 19], halo: [124, 64, 40], haloAlpha: 105,
  shards: [[40, 25, 20, 235], [58, 36, 28, 230], [30, 20, 18, 240]],
  chunks: [[122, 114, 108, 245], [92, 86, 82, 245], [140, 98, 72, 245]],
};
const STENCILS = ["DT", "F6", "X4", "HF6", "NEO", "DR", "RDTX", "O2", "F2", "B7", "K9", "HX", "D4", "A1", "SW", "E3", "Z2"];
const SMALL = ["CSM", "SS 3", "12", "300", "45", "B-7", "LX", "07"];

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// --- the ground ---------------------------------------------------------------------------------------

function ground([w, h], cell, o) {
  const sun = noise(h, w, cell * 7, 101), mott = noise(h, w, cell * 1.2, 102), g = new NpRandom(103);
  const img = newImage("RGBA", w, h);
  for (let p = 0; p < w * h; p++) {
    const s = (sun[p] - 0.42) * 2.4 * o.sunlight;                           // mostly sunlit, some hazy patches
    const m = (mott[p] - 0.5) * 10, grain = g.normal(0, 2.2);
    for (let k = 0; k < 3; k++) {
      const base = s > 0 ? lerp(GROUND[k], SUN[k], clamp(s)) : lerp(GROUND[k], SHADE[k], clamp(-s));
      img.data[p * 4 + k] = u8(base + m * (k === 0 ? 1 : 0.8) + grain);
    }
    img.data[p * 4 + 3] = 255;
  }
  return img;
}

// --- paint: bays, stencils, stripe bands, dashed outlines, arrows, chalk --------------------------------

function paint(img, cell, o) {
  const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), r = new PyRandom(111);
  const area = (w * h) / (cell * cell), keep = keeper(111, o.markings);
  const lw = Math.max(3, Math.trunc(cell * 0.045)), gap = cell * 0.11, rad = cell * 0.4;
  let item = 0;
  const nBays = Math.max(2, Math.round(area / 24));
  for (let i = 0; i < nBays; i++) {                                           // pale double bay lines
    const bw = r.uniform(3.5, 6) * cell, bh = r.uniform(2.6, 4.5) * cell;
    const x0 = r.uniform(-bw * 0.3, w - bw * 0.7), y0 = r.uniform(-bh * 0.3, h - bh * 0.7);
    const alpha = r.randint(48, 70);
    if (!keep(item++)) continue;
    d.roundedRectangle([x0, y0, x0 + bw, y0 + bh], rad, { outline: [...PALE, alpha], width: lw });
    d.roundedRectangle([x0 + gap + lw, y0 + gap + lw, x0 + bw - gap - lw, y0 + bh - gap - lw], rad * 0.75, { outline: [...PALE, Math.round(alpha * 0.8)], width: lw });
  }
  const nStencil = Math.max(2, Math.round(area / 14));
  for (let i = 0; i < nStencil; i++) {                                        // big dark stencil codes
    const x = r.uniform(0, w - cell), y = r.uniform(-cell * 0.2, h - cell * 0.8), text = r.choice(STENCILS), size = Math.trunc(cell * r.uniform(0.85, 1.15));
    if (!keep(item++)) continue;
    d.text([x, y], text, size, [...DARKPAINT, 30], { family: "stencil" });
  }
  const nBands = Math.max(1, Math.round(area / 22));
  for (let i = 0; i < nBands; i++) {                                          // faint hazard-stripe bands
    const len = r.uniform(2.5, 5) * cell, bh = cell * 0.32, x0 = r.uniform(0, w - len), y0 = r.uniform(0, h - bh);
    if (!keep(item++)) continue;
    for (let k = x0; k < x0 + len; k += cell * 0.3)
      d.polygon([[k, y0 + bh], [k + cell * 0.14, y0 + bh], [k + cell * 0.14 + bh, y0], [k + bh, y0]], [...DARKPAINT, 26]);
  }
  const nDash = Math.max(2, Math.round(area / 18));
  for (let i = 0; i < nDash; i++) {                                           // dashed outlines with corner ticks
    const bw = r.uniform(1.5, 3.5) * cell, bh = r.uniform(1.2, 2.5) * cell, x0 = r.uniform(0, w - bw), y0 = r.uniform(0, h - bh);
    if (!keep(item++)) continue;
    const col = [...DARKPAINT, 34], t = Math.max(2, Math.trunc(cell * 0.022)), seg = cell * 0.16;
    for (const [ax, ay, bx, by] of [[x0, y0, x0 + bw, y0], [x0, y0 + bh, x0 + bw, y0 + bh], [x0, y0, x0, y0 + bh], [x0 + bw, y0, x0 + bw, y0 + bh]]) {
      const L = Math.hypot(bx - ax, by - ay), n = Math.floor(L / (seg * 2));
      for (let s = 0; s < n; s++) {
        const t0 = (s * 2 * seg) / L, t1 = ((s * 2 + 1) * seg) / L;
        d.line([[ax + (bx - ax) * t0, ay + (by - ay) * t0], [ax + (bx - ax) * t1, ay + (by - ay) * t1]], col, t);
      }
    }
  }
  const nArrows = Math.max(2, Math.round(area / 10));
  for (let i = 0; i < nArrows; i++) {                                         // small arrows and chevrons
    const x = r.uniform(0, w), y = r.uniform(0, h), s = cell * r.uniform(0.1, 0.16), dir = r.choice([0, 1, 2, 3]), chevron = r.random() < 0.35;
    if (!keep(item++)) continue;
    const rot = ([px, py]) => { const a = (dir * Math.PI) / 2; return [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)]; };
    const col = chevron ? [...PALE, 40] : [...DARKPAINT, 38], t = Math.max(2, Math.trunc(cell * 0.022));
    if (chevron) for (const k of [0, 1]) d.line([[-s, -s], [0, 0], [-s, s]].map(([px, py]) => rot([px + k * s * 0.9, py])), col, t);
    else { d.line([rot([-s * 1.4, 0]), rot([s, 0])], col, t); d.line([rot([s * 0.4, -s * 0.55]), rot([s, 0]), rot([s * 0.4, s * 0.55])], col, t); }
  }
  const nChalk = Math.round((area / 12) * o.chalk);
  const fs = Math.trunc(cell * 0.13);
  for (let i = 0; i < nChalk; i++) {                                          // chalk measurement marks
    const x = r.uniform(0, w - cell), y = r.uniform(0, h - cell), vertical = r.random() < 0.5, L = r.uniform(0.6, 1.6) * cell;
    const col = [255, 214, 140, 70], t = Math.max(1, Math.trunc(cell * 0.012));
    d.line(vertical ? [[x, y], [x, y + L]] : [[x, y], [x + L, y]], col, t);
    d.line(vertical ? [[x - cell * 0.05, y], [x + cell * 0.05, y]] : [[x, y - cell * 0.05], [x, y + cell * 0.05]], col, t);
    if (r.random() < 0.6) d.text([x + cell * 0.08, y + cell * 0.04], r.choice(SMALL), fs, [255, 214, 140, 60]);
  }
  return alphaComposite(img, over);
}

// --- fixtures: vent grilles, dot grids, tie-down sockets ---------------------------------------------------

function fixtures(img, cell, o) {
  const { w, h } = img, d = new Draw(img), r = new PyRandom(121), area = (w * h) / (cell * cell);
  const n = Math.round((area / 13) * o.fixtures);
  const slot = [70, 30, 18, 255], hole = [62, 28, 18, 255];
  for (let i = 0; i < n; i++) {
    const kind = r.random(), x = r.uniform(cell * 0.2, w - cell), y = r.uniform(cell * 0.2, h - cell * 0.6);
    if (kind < 0.45) {                                                        // vent grille: rows of short slots, often a pair
      const rows = r.randint(2, 3), cols = r.randint(8, 12), pair = r.random() < 0.6;
      for (const px of pair ? [x, x + cell * 1.0] : [x])
        for (let a = 0; a < rows; a++)
          for (let b = 0; b < cols; b++) {
            const sx = px + b * cell * 0.055, sy = y + a * cell * 0.1;
            d.rectangle([sx, sy, sx + cell * 0.018, sy + cell * 0.07], { fill: slot });
          }
    } else if (kind < 0.7) {                                                  // a 6 x 6 dot grid
      for (let a = 0; a < 6; a++)
        for (let b = 0; b < 6; b++) {
          const cx = x + b * cell * 0.2, cy = y + a * cell * 0.2, s = cell * 0.022;
          d.ellipse([cx - s, cy - s, cx + s, cy + s], { fill: hole });
        }
    } else {                                                                  // tie-down sockets, in pairs
      for (const k of [0, 1]) {
        const cx = x + k * cell * r.uniform(1.4, 2.4), cy = y, s = cell * 0.07;
        d.ellipse([cx - s, cy - s, cx + s, cy + s], { fill: [96, 44, 26, 255] });
        d.ellipse([cx - s * 0.62, cy - s * 0.62, cx + s * 0.62, cy + s * 0.62], { fill: [150, 142, 138, 255] });
        d.ellipse([cx - s * 0.32, cy - s * 0.32, cx + s * 0.32, cy + s * 0.32], { fill: [40, 26, 22, 255] });
      }
    }
  }
  return img;
}

// --- litter: flecks, chips, flakes, casings, embers, dust patches -----------------------------------------------

function litter(img, cell, o) {
  const { w, h } = img, area = (w * h) / (cell * cell);
  const dust = newImage("RGBA", w, h), dd = new Draw(dust), rd = new PyRandom(141);
  const nd = Math.round((area / 9) * o.dust);
  for (let i = 0; i < nd; i++) {                                              // dust patches: scuffed stipple, light or dark
    const cx = rd.uniform(0, w), cy = rd.uniform(0, h), R = cell * rd.uniform(0.35, 0.9), light = rd.random() < 0.6;
    const col = light ? [250, 170, 110, 60] : [120, 50, 28, 45];
    for (let k = rd.randint(60, 140); k > 0; k--) {
      const a = rd.uniform(0, 2 * Math.PI), rr = R * Math.sqrt(rd.random()), s = cell * rd.uniform(0.008, 0.025);
      const x = cx + Math.cos(a) * rr * 1.3, y = cy + Math.sin(a) * rr * 0.8;
      dd.rectangle([x - s, y - s, x + s, y + s], { fill: col });
    }
  }
  img = alphaComposite(img, gaussianBlur(dust, cell * 0.006));
  const over = newImage("RGBA", w, h), d = new Draw(over);
  const layer = (n, density, seed, one) => {
    const r = new PyRandom(seed), keep = keeper(seed, density), more = extras(n, density, seed + 1000);
    for (let i = 0; i < n; i++) { const draw = one(r); if (keep(i)) draw(); }
    for (let i = 0; i < more.count; i++) one(more.rng)();
  };
  const poly = (r, x, y, s, k) => { const q = []; for (let i = 0; i < k; i++) { const px = x + r.uniform(-s, s); q.push([px, y + r.uniform(-s, s)]); } return q; };
  layer(Math.round(area * 14), o.debris, 151, (r) => {                          // dark flecks
    const x = r.uniform(0, w), y = r.uniform(0, h), s = r.uniform(0.008, 0.032) * cell, q = poly(r, x, y, s, r.randint(3, 5));
    const fill = r.choice([[40, 22, 16, 230], [66, 36, 24, 220], [90, 46, 28, 200]]);
    return () => d.polygon(q, fill);
  });
  layer(Math.round(area * 3), o.debris, 152, (r) => {                           // grey metal chips
    const x = r.uniform(0, w), y = r.uniform(0, h), s = r.uniform(0.01, 0.028) * cell, q = poly(r, x, y, s, 4);
    const fill = r.choice([[150, 150, 156, 225], [120, 122, 128, 225], [190, 188, 190, 210]]);
    return () => d.polygon(q, fill);
  });
  layer(Math.round(area * 2), o.debris, 153, (r) => {                           // pale flakes
    const x = r.uniform(0, w), y = r.uniform(0, h), s = r.uniform(0.006, 0.016) * cell;
    return () => d.rectangle([x - s, y - s * 0.6, x + s, y + s * 0.6], { fill: [245, 215, 185, 190] });
  });
  const cw = Math.max(2, Math.trunc(cell * 0.016));
  layer(Math.round(area * 2.2), o.casings, 154, (r) => {                        // brass casings
    const x = r.uniform(0, w), y = r.uniform(0, h), a = r.uniform(0, Math.PI), L = cell * r.uniform(0.035, 0.05);
    return () => d.line([[x, y], [x + Math.cos(a) * L, y + Math.sin(a) * L]], [236, 184, 72, 235], cw);
  });
  img = alphaComposite(img, over);
  const emb = newImage("RGBA", w, h), ed = new Draw(emb);
  const r = new PyRandom(155), ne = Math.round(area * 0.3 * o.embers);        // embers (not Synthetik's; off by default)
  for (let i = 0; i < ne; i++) {
    const x = r.uniform(0, w), y = r.uniform(0, h), s = r.uniform(0.006, 0.012) * cell;
    ed.ellipse([x - s, y - s * 1.6, x + s, y + s * 1.6], { fill: [255, 170, 80, 220] });
  }
  if (ne) { img = alphaComposite(img, gaussianBlur(emb, cell * 0.05)); img = alphaComposite(img, emb); }
  return img;
}

// --- decals -----------------------------------------------------------------------------------------------

// a painted loading pad, in the floor's own muted paint: dark diagonal stripes inside a pale double outline
function loadingPad(img, hexes, cell) {
  const [x0, y0, x1, y1] = hexesBox(hexes, cell, -cell * 0.08);
  const over = newImage("RGBA", img.w, img.h), d = new Draw(over), step = cell * 0.3, hh = y1 - y0;
  for (let k = x0 - hh; k < x1; k += step)
    d.polygon([[k, y1], [k + step * 0.5, y1], [k + step * 0.5 + hh, y0], [k + hh, y0]], [...DARKPAINT, 58]);
  const clip = newImage("L", img.w, img.h);
  new Draw(clip).rectangle([x0, y0, x1, y1], { fill: 255 });
  const pad = newImage("RGBA", img.w, img.h), pd = new Draw(pad), lw = Math.max(3, Math.trunc(cell * 0.045)), g = cell * 0.1;
  paste(pad, over, clip);
  pd.roundedRectangle([x0, y0, x1, y1], cell * 0.12, { outline: [...PALE, 90], width: lw });
  pd.roundedRectangle([x0 - g - lw, y0 - g - lw, x1 + g + lw, y1 + g + lw], cell * 0.2, { outline: [...PALE, 64], width: lw });
  return alphaComposite(img, pad);
}

// tyre tracks: two soft darker bands with faint tread ticks
function tyreTracks(img, a, b, cell) {
  const over = newImage("RGBA", img.w, img.h), d = new Draw(over);
  const [ax, ay] = centre(a[0], a[1], cell), [bx, by] = centre(b[0], b[1], cell);
  const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L, tw = cell * 0.16;
  for (const side of [-1, 1]) {
    const ox = nx * side * cell * 0.34, oy = ny * side * cell * 0.34;
    d.line([[ax + ox, ay + oy], [bx + ox, by + oy]], [96, 42, 24, 34], Math.trunc(tw));
    for (let t = 0; t < L; t += cell * 0.09) {
      const x = ax + ((bx - ax) * t) / L + ox, y = ay + ((by - ay) * t) / L + oy;
      d.line([[x - nx * tw * 0.45, y - ny * tw * 0.45], [x + nx * tw * 0.45, y + ny * tw * 0.45]], [80, 34, 20, 40], Math.max(2, Math.trunc(cell * 0.025)));
    }
  }
  return alphaComposite(img, gaussianBlur(over, cell * 0.012));
}

// the round floor hatch, as the game draws it: a recessed dark steel bowl with a bright rim, concentric
// ridges going down, and a grille of slots at the bottom (lit from the top-left, so its north wall is dark)
function floorHatch(img, hexes, cell) {
  const over = newImage("RGBA", img.w, img.h), d = new Draw(over), t = Math.max(2, Math.trunc(cell * 0.012));
  for (const [c, r] of hexes) {
    const [cx, cy] = centre(c, r, cell), R = cell * 0.92, ry = 0.72;              // about two hexes across, seen slightly from the south
    const ell = (k, dy = 0) => [cx - R * k, cy - R * k * ry + dy, cx + R * k, cy + R * k * ry + dy];
    d.ellipse(ell(1.04, R * 0.03), { fill: [70, 40, 30, 160] });                 // its shadow on the floor
    d.ellipse(ell(1.03), { fill: [164, 146, 144, 255] });                        // the rim
    d.ellipse(ell(0.96), { fill: [92, 72, 74, 255] });                           // the bowl
    for (const [k, dy, col] of [[0.86, R * 0.04, [112, 90, 92]], [0.74, R * 0.08, [124, 102, 102]], [0.6, R * 0.12, [112, 92, 92]], [0.44, R * 0.15, [98, 80, 82]]])
      d.ellipse(ell(k, dy), { outline: [...col, 255], width: Math.max(3, Math.trunc(cell * 0.02)) });   // ridges stepping down
    for (let i = 0; i < 12; i++) {                                                // radial ribs
      const a = (2 * Math.PI * i) / 12, c1 = Math.cos(a), s1 = Math.sin(a);
      d.line([[cx + c1 * R * 0.46, cy + s1 * R * 0.46 * ry + R * 0.15], [cx + c1 * R * 0.93, cy + s1 * R * 0.93 * ry]], [132, 110, 110, 255], t);
    }
    d.arc(ell(0.96), 195, 345, [52, 38, 40, 255], Math.max(4, Math.trunc(cell * 0.05)));   // the shadowed north wall
    d.arc(ell(1.03), 15, 165, [214, 200, 196, 255], Math.max(2, Math.trunc(cell * 0.016)));   // the lit south lip
    for (let k = -1; k <= 1; k++) {                                               // the grille at the bottom
      const gx = cx + k * R * 0.17, gy = cy + R * 0.2;
      d.roundedRectangle([gx - R * 0.06, gy - R * 0.13, gx + R * 0.06, gy + R * 0.13], R * 0.04, { fill: [58, 44, 46, 255], outline: [138, 116, 116, 255], width: t });
    }
  }
  return alphaComposite(img, over);
}

// fenced-off ground beyond the play area: darker, dusty, with a black palisade fence along its edge
function perimeter(img, solid, cell) {
  const { w, h } = img, m = maskOf([w, h], solid.map(([c, r]) => centre(c, r, cell)), cell);
  const dim = newImage("RGBA", w, h);
  for (let p = 0; p < w * h; p++) {
    if (!m.data[p]) continue;
    const i = p * 4;
    for (let k = 0; k < 3; k++) dim.data[i + k] = Math.trunc(img.data[i + k] * 0.7);
    dim.data[i + 3] = 255;
  }
  paste(img, dim, m);
  const d = new Draw(img), fence = [34, 30, 30, 255], post = [22, 20, 20, 255], lw = Math.max(3, Math.trunc(cell * 0.035));
  for (const [a, b] of zoneEdges(solid, cell)) {                             // the fence on the boundary with open ground
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const [ccx, ccy] = centre(...nearestSolid(solid, mx, my, cell), cell);
    const nx = mx - ccx, ny = my - ccy, L = Math.hypot(nx, ny) || 1;
    const ox = mx + nx, oy = my + ny;                                         // the neighbour's centre: off the map = no fence
    if (ox < 0 || oy < 0 || ox > w || oy > h) continue;
    const off = [(nx / L) * cell * 0.04, (ny / L) * cell * 0.04];
    const pa = [a[0] - off[0], a[1] - off[1]], pb = [b[0] - off[0], b[1] - off[1]];
    d.line([pa, pb], fence, lw);
    const n = Math.max(2, Math.round(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / (cell * 0.07)));
    for (let k = 0; k <= n; k++) {                                            // pickets
      const t = k / n, x = pa[0] + (pb[0] - pa[0]) * t, y = pa[1] + (pb[1] - pa[1]) * t, s = cell * 0.018;
      d.rectangle([x - s, y - s, x + s, y + s], { fill: k % 5 === 0 ? post : fence });
    }
  }
  return img;
}

function nearestSolid(solid, x, y, cell) {
  let best = solid[0], bd = Infinity;
  for (const s of solid) { const [cx, cy] = centre(s[0], s[1], cell), dd = (cx - x) ** 2 + (cy - y) ** 2; if (dd < bd) { bd = dd; best = s; } }
  return best;
}

// warm haze: dark dusty cloud patches and a vignette
function atmosphere(img, cell, o) {
  const { w, h } = img, cloud = noise(h, w, cell * 5, 161), veil = noise(h, w, cell * 2.2, 162);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4;
      const c = clamp((cloud[p] - 0.58) * 3.2) * clamp(veil[p] * 1.6 - 0.2) * 0.3 * o.haze;
      const nx = (x - w / 2) / (w / 2), ny = (y - h / 2) / (h / 2);
      const vig = 1 - clamp((nx * nx * 0.16 + ny * ny * 0.2 - 0.06) * o.vignette, 0, 0.35);
      for (let k = 0; k < 3; k++) img.data[i + k] = u8((img.data[i + k] * (1 - c) + [96, 40, 24][k] * c) * vig);
    }
  return img;
}

// --- the base map -----------------------------------------------------------------------------------------

export const name = "Training Floor";
export const blurb = "Sun-baked orange ground under a warm haze: pale bay lines, faint stencils and stripe bands, vent grilles and sockets, flecks, chips and casings.";
export const decals = ["hazard_border", "blast", "scorch", "tracks", "hazard_ring", "floor_hatch"];
export const terrainNote = "Training Floor draws it as fenced-off ground behind a black palisade fence.";
export const settings = [
  { id: "sunlight", label: "Sunlight and haze patches", group: "Ground", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "maze", label: "Maze floor pattern", group: "Ground", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "markings", label: "Bay lines, stencils, stripes", group: "Paint", type: "range", min: 0, max: 1, step: 0.05, default: 1 },
  { id: "chalk", label: "Chalk marks", group: "Paint", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "fixtures", label: "Vent grilles, dot grids, sockets", group: "Paint", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "debris", label: "Flecks, chips and flakes", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
  { id: "casings", label: "Spent casings", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
  { id: "dust", label: "Dust patches", group: "Clutter", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "remains", label: "Robot remains (oil splats)", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 0 },
  { id: "embers", label: "Embers", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 0 },
  { id: "haze", label: "Dust clouds", group: "Atmosphere", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "vignette", label: "Vignette", group: "Atmosphere", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  ...ZONE_SETTINGS,
];

export function render(data, cell, opts = {}) {
  const o = withDefaults(settings, opts);
  const [w, h] = imageSize(data.cols, data.rows, cell);
  const zones = data.zones || {};
  let img = ground([w, h], cell, o);
  img = maze(img, cell, o.maze, DARKPAINT);
  img = paint(img, cell, o);
  img = fixtures(img, cell, o);
  const blasts = [];
  (data.decals || []).forEach((dec, i) => {
    const kind = dec.type, hexes = dec.hexes || (dec.zone && zones[dec.zone] ? zones[dec.zone].hexes : []);
    if (kind === "hazard_border") for (const part of connectedParts(hexes, cell)) img = loadingPad(img, part, cell);   // one pad per painted group
    else if (kind === "blast" || kind === "scorch") for (const [c, r] of hexes) blasts.push(centre(c, r, cell));   // drawn with the remains
    else if (kind === "tracks") img = tyreTracks(img, dec.from, dec.to, cell);
    else if (kind === "hazard_ring") img = decalHazardRing(img, hexes, cell);
    else if (kind === "floor_hatch") img = floorHatch(img, hexes, cell);
  });
  img = remains(img, cell, o.remains, REMAINS, blasts);
  img = litter(img, cell, o);
  const solid = Object.entries(data.terrain || {}).filter(([, v]) => v === "obstruction").map(([k]) => k.split(",").map(Number));
  if (solid.length) img = perimeter(img, solid, cell);
  img = atmosphere(img, cell, o);
  return drawAllZones(img, zones, cell, o);
}

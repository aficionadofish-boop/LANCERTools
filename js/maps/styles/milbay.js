// Military Bay (from milbay_map.py), after Synthetik's Military Bay: a charcoal concrete deck in big
// slabs, faint painted lane markings and stencils, dark hazard-stripe aprons, rubble, spent casings
// and embers, drifting fog, dim red emergency light at the walls.
//
// Decals in the map JSON, in this style:
//   hazard_border (on a zone)  -> a red lift platform with railings and a centre spine
//   blast / scorch             -> a hull breach: a torn hole with glowing edges, scorch and debris
//   tracks                     -> tread marks
//   hazard_ring                -> a yellow/black band round some hexes
// ingress zones get hatch aprons; "obstruction" terrain outside the play area is ship bulkhead.

import { NpRandom, PyRandom } from "../../rng.js";
import { newImage, Draw, alphaComposite, paste, gaussianBlur, rankFilter, u8 } from "../../raster.js";
import { centre, hexPoints, geometry, arange, hexesBox, imageSize, connectedParts } from "../geometry.js";
import { noise, font, drawAllZones, decalBlast, decalTracks, decalHazardRing, ZONE_TINT, DEFAULT_TINT, ZONE_SETTINGS,
  withDefaults, keeper, extras } from "../common.js";

const F = Math.fround;
const DECK = [60, 58, 63];
const PAINT = [200, 198, 205];
const LIFT = [196, 64, 38];

// --- the deck -------------------------------------------------------------------------------------

function deck([w, h], cell, o, seed = 1) {
  const n = noise(h, w, cell * 3, seed), fine = new NpRandom(seed);
  let img = newImage("RGBA", w, h);
  for (let p = 0; p < w * h; p++) {
    const tone = F(0.88 + F(0.22 * n[p])), g = fine.normal(0, 3.2);
    for (let k = 0; k < 3; k++) img.data[p * 4 + k] = u8(F(DECK[k] * tone) + g);
    img.data[p * 4 + 3] = 255;
  }
  const d = new Draw(img), r = new PyRandom(seed);
  const sx = cell * 2.6, sy = cell * 2.2;                                   // big concrete slabs
  const seam = Math.max(2, Math.trunc(cell * 0.025));
  for (const y of arange(0, h + sy, sy)) {
    const off = (Math.trunc(y / sy) % 2) * sx / 2;
    for (const x of arange(-off, w + sx, sx)) {
      const k = r.uniform(0.93, 1.07);
      d.rectangle([x + 2, y + 2, x + sx - 2, y + sy - 2], { fill: [...DECK.map((c) => Math.trunc(c * k)), 60] });
    }
    d.line([[0, y], [w, y]], [34, 33, 36, 255], seam);
    for (const x of arange(-off, w + sx, sx)) d.line([[x, y], [x, y + sy]], [34, 33, 36, 255], seam);
  }
  const stains = newImage("RGBA", w, h), sd = new Draw(stains);
  const stain = (r) => {
    const x = r.uniform(0, w), y = r.uniform(0, h), rad = r.uniform(0.3, 1.2) * cell;
    return [[x - rad, y - rad * 0.6, x + rad, y + rad * 0.6], [18, 17, 20, r.randint(20, 45)]];
  };
  const ns = Math.trunc(w * h / (cell * cell) * 0.25), keep = keeper(11, o.stains), more = extras(ns, o.stains, 1011);
  for (let i = 0; i < ns; i++) { const [box, fill] = stain(r); if (keep(i)) sd.ellipse(box, { fill }); }
  for (let i = 0; i < more.count; i++) { const [box, fill] = stain(more.rng); sd.ellipse(box, { fill }); }
  return alphaComposite(img, gaussianBlur(stains, cell * 0.25));
}

// Faint painted lane outlines, stencilled numbers and cross marks (o.markings thins them)
function markings(img, cell, o, seed = 2) {
  const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), r = new PyRandom(seed);
  const lw = Math.max(2, Math.trunc(cell * 0.03)), keep = keeper(12, o.markings);
  let item = 0;
  for (let i = Math.max(1, Math.trunc(w / (cell * 9))); i > 0; i--) {     // painted bay outlines
    const x0 = r.uniform(0, w - cell * 3), y0 = r.uniform(cell * 0.4, h - cell * 2.5);
    const bw = r.uniform(2.2, 4.5) * cell, bh = r.uniform(1.4, 2.2) * cell;
    if (!keep(item++)) continue;
    d.rectangle([x0, y0, x0 + bw, y0 + bh], { outline: [...PAINT, 20], width: lw });
    d.rectangle([x0 + cell * 0.15, y0 + cell * 0.15, x0 + bw - cell * 0.15, y0 + bh - cell * 0.15],
      { outline: [...PAINT, 12], width: Math.max(1, lw >> 1) });
  }
  const f = font(cell * 0.2), placed = [];
  const freeSpot = (x0, x1, y0, y1) => {        // a spot at least 1.5 cells from any mark already painted
    for (let t = 0; t < 40; t++) {
      const x = r.uniform(x0, x1), y = r.uniform(y0, y1);
      if (placed.every(([px, py]) => Math.hypot(x - px, y - py) > cell * 1.5)) { placed.push([x, y]); return [x, y]; }
    }
    return null;
  };
  for (let i = Math.max(3, Math.trunc(w / (cell * 4))); i > 0; i--) {     // stencils: bay numbers, load marks
    const spot = freeSpot(cell * 0.5, w - cell, cell * 0.4, h - cell * 0.6);
    if (!spot) continue;
    const [x, y] = spot;
    const opts = [String(r.randint(1, 40)).padStart(2, "0"), String(r.randint(1, 9) * 100), "B-" + r.randint(1, 9)];
    const text = r.choice(opts);
    if (!keep(item++)) continue;
    d.text([x, y], text, f, [...PAINT, 46]);
    d.line([[x - cell * 0.05, y + cell * 0.28], [x + cell * 0.45, y + cell * 0.28]], [...PAINT, 36], lw);
  }
  for (let i = Math.max(3, Math.trunc(w / (cell * 3))); i > 0; i--) {     // cross marks
    const spot = freeSpot(0, w, 0, h);
    if (!spot || !keep(item++)) continue;
    const [x, y] = spot, s = cell * 0.1;
    d.line([[x - s, y - s], [x + s, y + s]], [...PAINT, 40], lw);
    d.line([[x - s, y + s], [x + s, y - s]], [...PAINT, 40], lw);
  }
  return alphaComposite(img, over);
}

function boxMask(img, [x0, y0, x1, y1]) {
  const m = newImage("L", img.w, img.h);
  new Draw(m).rectangle([x0, y0, x1, y1], { fill: 255 });
  return m;
}

// Dark diagonal hazard stripes on a plate under some hexes (hatch aprons)
function stripeApron(img, hexes, cell, pad = 0.12) {
  const [x0, y0, x1, y1] = hexesBox(hexes, cell, cell * pad);
  const over = newImage("RGBA", img.w, img.h), d = new Draw(over);
  d.rectangle([x0, y0, x1, y1], { fill: [30, 29, 32, 120], outline: [90, 88, 94, 90], width: Math.max(2, Math.trunc(cell * 0.025)) });
  const step = cell * 0.22;
  for (let k = x0 - (y1 - y0); k < x1; k += step)
    d.polygon([[k, y1], [k + step * 0.5, y1], [k + step * 0.5 + (y1 - y0), y0], [k + (y1 - y0), y0]], [22, 21, 24, 150]);
  const clipped = newImage("RGBA", img.w, img.h);
  paste(clipped, over, boxMask(img, [x0, y0, x1, y1]));
  return alphaComposite(img, clipped);
}

// A large, faint patch of pale diagonal stripes painted on the deck (a no-parking bay)
function stripePatch(img, [x0, y0, x1, y1], cell, seed, alpha = 19) {
  const over = newImage("RGBA", img.w, img.h), d = new Draw(over);
  const step = cell * 0.34, hgt = y1 - y0;
  for (let k = x0 - hgt; k < x1; k += step)
    d.polygon([[k, y1], [k + step * 0.45, y1], [k + step * 0.45 + hgt, y0], [k + hgt, y0]], [...PAINT, alpha]);
  d.rectangle([x0, y0, x1, y1], { outline: [...PAINT, alpha + 8], width: Math.max(2, Math.trunc(cell * 0.02)) });
  const wear = noise(img.h, img.w, cell * 0.6, seed);                      // worn paint: patchy
  const mask = boxMask(img, [x0, y0, x1, y1]);
  for (let p = 0; p < img.w * img.h; p++) {
    const m = F(F(mask.data[p] / 255) * Math.min(1, Math.max(0, F(F(wear[p] * 1.6) - 0.2))));
    over.data[p * 4 + 3] = u8(F(over.data[p * 4 + 3] * m));
  }
  return alphaComposite(img, over);
}

// Painted stripe bays: one inside each ingress hatch in the long walls, plus a few on the open deck
function stripePatches(img, cell, zones, rowsTotal, seed = 8) {
  const { w, h } = img, r = new PyRandom(seed), boxes = [];
  for (const [zid, z] of Object.entries(zones)) {
    if (!zid.startsWith("ingress")) continue;
    const rows = z.hexes.map(([, rr]) => rr);
    if (!(rows.includes(0) || Math.max(...rows) >= rowsTotal - 1)) continue;
    const [x0, y0, x1, y1] = hexesBox(z.hexes, cell);
    const top = y0 < h / 2;                                               // a hatch in the north wall opens south
    const [ay0, ay1] = top ? [y1 + cell * 0.05, y1 + cell * 1.3] : [y0 - cell * 1.3, y0 - cell * 0.05];
    boxes.push([x0 - cell * 0.3, ay0, x1 + cell * 0.3, ay1]);
  }
  const keepOut = Object.entries(zones).filter(([zid]) => zid.startsWith("control_zone")).map(([, z]) => hexesBox(z.hexes, cell));
  const m = cell * 0.3;
  const overlaps = (a, b) => a[0] < b[2] + m && b[0] < a[2] + m && a[1] < b[3] + m && b[1] < a[3] + m;
  for (let i = Math.max(2, Math.trunc(w / (cell * 7))); i > 0; i--)
    for (let t = 0; t < 30; t++) {                                        // keep bays apart
      const bw = r.uniform(2.0, 3.5) * cell, bh = r.uniform(1.2, 2.0) * cell;
      const x0 = r.uniform(cell * 3, w - bw - cell * 5), y0 = r.uniform(cell * 0.3, h - bh - cell * 0.3);
      const box = [x0, y0, x0 + bw, y0 + bh];
      if (![...boxes, ...keepOut].some((b) => overlaps(box, b))) { boxes.push(box); break; }
    }
  boxes.forEach((b, i) => { img = stripePatch(img, b, cell, seed + i); });
  return img;
}

// The freight elevator: a red-orange platform, a dark centre spine, railings on three sides
function liftPlatform(img, hexes, cell) {
  let [x0, y0, x1, y1] = hexesBox(hexes, cell, -cell * 0.05);
  const { w, h } = img;
  x1 = Math.min(x1, w - cell * 0.1);
  y0 = Math.max(y0, cell * 0.12); y1 = Math.min(y1, h - cell * 0.12);
  const n = noise(h, w, cell * 1.5, 7);
  for (let y = Math.trunc(y0); y < Math.trunc(y1); y++)
    for (let x = Math.trunc(x0); x < Math.trunc(x1); x++) {
      const p = y * w + x, tone = F(0.86 + F(0.2 * n[p]));
      for (let k = 0; k < 3; k++) img.data[p * 4 + k] = u8(F(LIFT[k] * tone));
    }
  const d = new Draw(img), cy = (y0 + y1) / 2, spine = cell * 0.55;
  d.rectangle([x0, cy - spine / 2, x1, cy + spine / 2], { fill: [120, 36, 22, 255] });              // centre spine
  d.line([[x0, cy - spine / 2], [x1, cy - spine / 2]], [226, 104, 70, 255], Math.max(2, Math.trunc(cell * 0.02)));
  const grip = Math.max(1, Math.trunc(cell * 0.015));
  for (const x of arange(x0 + cell * 0.3, x1, cell * 0.35)) {                                       // deck grip lines
    d.line([[x, y0 + cell * 0.1], [x, cy - spine / 2 - cell * 0.1]], [170, 52, 30, 255], grip);
    d.line([[x, cy + spine / 2 + cell * 0.1], [x, y1 - cell * 0.1]], [170, 52, 30, 255], grip);
  }
  const rail = [150, 150, 158, 255], rw = Math.max(3, Math.trunc(cell * 0.045)), m = cell * 0.08;
  for (const [a, b] of [[[x0, y0 + m], [x1 - m, y0 + m]], [[x0, y1 - m], [x1 - m, y1 - m]], [[x1 - m, y0 + m], [x1 - m, y1 - m]]]) {
    d.line([a, b], rail, rw);
    const steps = Math.trunc(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell * 0.7));
    for (let i = 0; i <= steps; i++) {                                                             // posts
      const t = i / Math.max(1, steps), px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      d.rectangle([px - rw, py - rw, px + rw, py + rw], { fill: [110, 110, 118, 255] });
    }
  }
  d.rectangle([x0, y0, x1, y1], { outline: [60, 20, 12, 255], width: Math.max(2, Math.trunc(cell * 0.03)) });
  return img;
}

// For every pixel, the nearest hex centre clamped to the grid -> a Uint8 "solid" lookup
function nearestHexMask([w, h], cols, rows, cell, solid) {
  const [sx, sy, hw, qh] = geometry(cell), mask = newImage("L", w, h);
  const npRound = (v) => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };
  for (let y = 0; y < h; y++) {
    const r0 = Math.floor(F(F(y - F(2 * qh)) / F(sy)));
    for (let x = 0; x < w; x++) {
      let best = Infinity, bc = 0, br = 0;
      for (const dr of [-1, 0, 1, 2]) {
        const r = Math.min(rows - 1, Math.max(0, r0 + dr));
        const shift = r % 2 === 1 ? hw : 0;
        const c = Math.min(cols - 1, Math.max(0, npRound((F(x - F(hw)) - shift) / sx)));
        const cx = hw + c * sx + shift, cy = 2 * qh + r * sy;
        const dist = (x - cx) ** 2 + (y - cy) ** 2;
        if (dist < best) { best = dist; bc = c; br = r; }
      }
      mask.data[y * w + x] = solid[br * cols + bc] ? 255 : 0;
    }
  }
  return mask;
}

// Solid ship structure beyond a compartment's walls: riveted plating, conduit runs, a lit rim
function bulkhead(img, hexes, cell, seed = 9, grid = null) {
  const { w, h } = img;
  let mask;
  if (grid) {
    const [cols, rows] = grid, solid = new Uint8Array(cols * rows);
    for (const [c, r] of hexes) solid[r * cols + c] = 1;
    mask = nearestHexMask([w, h], cols, rows, cell, solid);
  } else {
    mask = newImage("L", w, h);
    const md = new Draw(mask);
    for (const [c, r] of hexes) md.polygon(hexPoints(...centre(c, r, cell), cell), 255);
  }
  const rng = new PyRandom(seed), n = noise(h, w, cell * 2, seed), grain = new NpRandom(seed);
  const plate = newImage("RGBA", w, h);
  const base = [27, 27, 31];
  for (let p = 0; p < w * h; p++) {
    const tone = F(0.85 + F(0.25 * n[p])), g = grain.normal(0, 2.5);
    for (let k = 0; k < 3; k++) plate.data[p * 4 + k] = u8(F(base[k] * tone) + g);
    plate.data[p * 4 + 3] = 255;
  }
  const d = new Draw(plate), px = cell * 1.3, py = cell * 0.9;
  for (const yy of arange(0, h + py, py))                                     // riveted panels
    for (const xx of arange(-(Math.trunc(yy / py) % 2) * px / 2, w + px, px)) {
      d.rectangle([xx, yy, xx + px, yy + py], { outline: [24, 24, 28, 255], width: Math.max(2, Math.trunc(cell * 0.02)) });
      d.line([[xx + 2, yy + 2], [xx + px - 2, yy + 2]], [50, 50, 56, 255], 1);
      for (const [rx, ry] of [[xx + cell * 0.1, yy + cell * 0.1], [xx + px - cell * 0.1, yy + cell * 0.1],
                              [xx + cell * 0.1, yy + py - cell * 0.1], [xx + px - cell * 0.1, yy + py - cell * 0.1]])
        d.ellipse([rx - cell * 0.02, ry - cell * 0.02, rx + cell * 0.02, ry + cell * 0.02], { fill: [74, 74, 80, 255] });
    }
  for (let i = Math.max(3, Math.trunc(w / (cell * 2.5))); i > 0; i--) {    // conduit and pipe runs
    const horizontal = rng.random() < 0.6;
    const pos = rng.uniform(0, horizontal ? h : w);
    const thick = rng.choice([0.08, 0.1, 0.14]) * cell;
    const col = rng.choice([[70, 72, 78], [86, 62, 44], [58, 64, 72]]);
    const [a, b] = horizontal ? [[0, pos], [w, pos]] : [[pos, 0], [pos, h]];
    d.line([a, b], [...col.map((v) => Math.trunc(v * 0.6)), 255], Math.trunc(thick));
    const off = horizontal ? [0, -thick * 0.25] : [-thick * 0.25, 0];
    d.line([[a[0] + off[0], a[1] + off[1]], [b[0] + off[0], b[1] + off[1]]], [...col, 255], Math.max(2, Math.trunc(thick * 0.4)));
    for (const t of arange(rng.uniform(0, cell), horizontal ? w : h, cell * 1.6)) {                 // clamps
      const [cx, cy] = horizontal ? [t, pos] : [pos, t], s = thick * 0.8;
      d.rectangle(horizontal ? [cx - s * 0.3, cy - s, cx + s * 0.3, cy + s] : [cx - s, cy - s * 0.3, cx + s, cy + s * 0.3],
        { fill: [30, 30, 34, 255] });
    }
  }
  paste(img, plate, mask);
  // the rim where the structure meets the room: a dark lip and a faint lit edge
  const k = Math.max(2, Math.trunc(cell * 0.05));
  const grown = rankFilter(mask, 2 * k + 1, true), shrunk = rankFilter(mask, 2 * k + 1, false);
  const lit = [40, 40, 46];
  for (let p = 0; p < w * h; p++) {
    const m = mask.data[p] / 255;
    const rim = Math.min(1, Math.max(0, grown.data[p] / 255 - m));
    const inner = Math.min(1, Math.max(0, m - shrunk.data[p] / 255));
    if (!rim && !inner) continue;
    const f = F(1 - F(F(rim) * F(0.7)));
    for (let c = 0; c < 3; c++) img.data[p * 4 + c] = u8(F(F(img.data[p * 4 + c] * f) + inner * lit[c]));
  }
  return img;
}

// Where the pod came through: scorch, a torn hole with glowing edges, debris sprayed inward
function breach(img, hexes, cell, seed = 3) {
  img = decalBlast(img, hexes, cell, seed);
  const d = new Draw(img), r = new PyRandom(seed);
  const glow = newImage("RGBA", img.w, img.h), gd = new Draw(glow);
  for (const [c, rr] of hexes) {
    const [cx, cy] = centre(c, rr, cell), R = cell * 0.42;
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const a = i * (2 * Math.PI / 14);                              // np.linspace
      const px = cx + Math.cos(a) * R * r.uniform(0.7, 1.1), py = cy + Math.sin(a) * R * r.uniform(0.7, 1.1);
      pts.push([px, py]);
    }
    gd.polygon(pts, [255, 120, 40, 200]);
    d.polygon(pts, [8, 8, 10, 255]);
    d.polygon(pts.map(([x, y]) => [cx + (x - cx) * 0.8, cy + (y - cy) * 0.8]), [4, 4, 6, 255]);
    for (const [x, y] of pts) {                                                 // torn plate petals
      const a = Math.atan2(y - cy, x - cx), tip = [x + Math.cos(a) * cell * 0.14, y + Math.sin(a) * cell * 0.14];
      d.polygon([[x + Math.sin(a) * cell * 0.05, y - Math.cos(a) * cell * 0.05], tip,
                 [x - Math.sin(a) * cell * 0.05, y + Math.cos(a) * cell * 0.05]], [88, 86, 92, 255]);
    }
  }
  return alphaComposite(img, gaussianBlur(glow, cell * 0.12));
}

// Rubble specks, spent casings and embers; with a focus (the breach) the rubble is thrown from it.
// (Synthetik has no embers: the Python took the glinting casings for cinders. The GM likes them, so
// they stay, on their own slider.)
function scatter(img, cell, o, seed = 4, focus = null, density = 1.0) {
  const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), r = new PyRandom(seed);
  const west = focus !== null && focus[0] < w / 2;
  const speck = (r, i) => {
    const y = r.uniform(0, h);
    let x;
    if (focus === null) x = r.uniform(0, w);
    else if (i % 2 === 0) x = r.uniform(0, 0.2 * w);                    // half: the breach's 20%
    else x = 0.2 * w + 0.8 * w * (1 - Math.sqrt(r.random()));          // half: thinning out across the rest
    if (focus !== null && !west) x = w - x;
    const s = r.uniform(0.012, 0.05) * cell, pts = [];
    for (let k = 0; k < 4; k++) { const px = x + r.uniform(-s, s); pts.push([px, y + r.uniform(-s, s)]); }
    return [pts, r.choice([[22, 21, 24, 230], [34, 33, 36, 230], [120, 118, 124, 200]])];
  };
  const casing = (r) => {
    const x = r.uniform(0, w), y = r.uniform(0, h), a = r.uniform(0, Math.PI), L = cell * 0.07;
    return [[x, y], [x + Math.cos(a) * L, y + Math.sin(a) * L]];
  };
  const ember = (r) => {
    const x = r.uniform(0, w), y = r.uniform(0, h), s = r.uniform(0.006, 0.012) * cell;
    return [x - s, y - s * 1.6, x + s, y + s * 1.6];
  };
  const casingW = Math.max(2, Math.trunc(cell * 0.022));
  const n = Math.trunc(w * h / (cell * cell) * 16 * density);
  let keep = keeper(21, o.debris), more = extras(n, o.debris, 1021);
  for (let i = 0; i < n; i++) { const [pts, fill] = speck(r, i); if (keep(i)) d.polygon(pts, fill); }
  for (let i = 0; i < more.count; i++) { const [pts, fill] = speck(more.rng, i); d.polygon(pts, fill); }
  const nc = Math.trunc(w * h / (cell * cell) * 1.2 * density);          // brass casings
  keep = keeper(22, o.casings); more = extras(nc, o.casings, 1022);
  for (let i = 0; i < nc; i++) { const seg = casing(r); if (keep(i)) d.line(seg, [214, 150, 60, 230], casingW); }
  for (let i = 0; i < more.count; i++) d.line(casing(more.rng), [214, 150, 60, 230], casingW);
  img = alphaComposite(img, over);
  const emb = newImage("RGBA", w, h), ed = new Draw(emb);
  const ne = Math.trunc(w * h / (cell * cell) * 0.12);
  keep = keeper(23, o.embers); more = extras(ne, o.embers, 1023);
  for (let i = 0; i < ne; i++) { const box = ember(r); if (keep(i)) ed.ellipse(box, { fill: [255, 150, 60, 220] }); }
  for (let i = 0; i < more.count; i++) ed.ellipse(ember(more.rng), { fill: [255, 150, 60, 220] });
  img = alphaComposite(img, gaussianBlur(emb, cell * 0.05));
  return alphaComposite(img, emb);
}

// Drifting fog, dim red emergency light along the long walls, a vignette (each scaled by its setting)
function atmosphere(img, cell, o, seed = 5) {
  const { w, h } = img;
  const fog = noise(h, w, cell * 4, seed), redN = noise(h, w, cell * 2, seed + 1);
  const smoke = noise(h, w, cell * 2.5, seed + 2), bankN = noise(h, w, cell * 6, seed + 3);
  const out = new Float32Array(3);
  const tintK = [0.8, 0.8, 0.86], redK = [50, 6, 9], veil = [118, 116, 124];
  for (let y = 0; y < h; y++) {
    const edge = Math.min(y, h - y) / (cell * 1.2);
    for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4;
      for (let k = 0; k < 3; k++) out[k] = img.data[i + k];
      const f = Math.min(1, Math.max(0, fog[p] - 0.55)) * 70 * o.fog;
      for (let k = 0; k < 3; k++) out[k] += f * tintK[k];
      const red = Math.min(1, Math.max(0, 1 - edge)) ** 2 * (0.6 + 0.4 * redN[p]) * o.emergencyLight;
      for (let k = 0; k < 3; k++) out[k] += red * redK[k];
      const banks = Math.min(1, Math.min(1, Math.max(0, (smoke[p] - 0.58) * 3.2)) * Math.min(1, Math.max(0, bankN[p] * 1.8 - 0.5)) * o.fog);
      for (let k = 0; k < 3; k++) out[k] = out[k] * (1 - banks * 0.35) + veil[k] * banks * 0.35;
      const nx = (x - w / 2) / (w / 2), ny = (y - h / 2) / (h / 2);
      let vig = Math.min(1, Math.max(0.55, 1.05 - (nx * nx * 0.25 + ny * ny * 0.3)));
      if (o.vignette !== 1) vig = Math.max(0, 1 - (1 - vig) * o.vignette);
      for (let k = 0; k < 3; k++) img.data[i + k] = u8(F(out[k] * F(vig)));
    }
  }
  return img;
}

// --- the base map ---------------------------------------------------------------------------------

export const name = "Military Bay";
export const blurb = "Charcoal concrete deck, lane markings and stencils, rubble, spent casings and embers, fog, red emergency light.";
export const decals = ["hazard_border", "blast", "scorch", "tracks", "hazard_ring"];
export const terrainNote = "Military Bay paints it as ship bulkhead.";
export const settings = [
  { id: "stains", label: "Oil stains", group: "Deck", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "markings", label: "Lane markings and stencils", group: "Deck", type: "range", min: 0, max: 1, step: 0.05, default: 1 },
  { id: "stripeBays", label: "Painted stripe bays", group: "Deck", type: "toggle", default: true },
  { id: "aprons", label: "Hatch aprons at ingress", group: "Deck", type: "toggle", default: true },
  { id: "debris", label: "Rubble", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
  { id: "casings", label: "Spent casings", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
  { id: "embers", label: "Embers", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
  { id: "fog", label: "Fog and smoke", group: "Atmosphere", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "emergencyLight", label: "Red emergency light", group: "Atmosphere", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "vignette", label: "Vignette", group: "Atmosphere", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  ...ZONE_SETTINGS,
];

export function render(data, cell, opts = {}) {
  const o = withDefaults(settings, opts);
  const [w, h] = imageSize(data.cols, data.rows, cell);
  let img = deck([w, h], cell, o);
  const zones = data.zones || {};
  if (o.stripeBays) img = stripePatches(img, cell, zones, data.rows);
  img = markings(img, cell, o);
  if (o.aprons) for (const [zid, z] of Object.entries(zones)) if (zid.startsWith("ingress")) img = stripeApron(img, z.hexes, cell);
  let focus = null;
  (data.decals || []).forEach((dec, i) => {
    const kind = dec.type;
    if (kind === "hazard_border") for (const part of connectedParts(dec.hexes || zones[dec.zone].hexes, cell)) img = liftPlatform(img, part, cell);   // one lift per painted group
    else if (kind === "blast" || kind === "scorch") { img = breach(img, dec.hexes, cell, i); focus = centre(dec.hexes[0][0], dec.hexes[0][1], cell); }
    else if (kind === "tracks") img = decalTracks(img, dec.from, dec.to, cell);
    else if (kind === "hazard_ring") img = decalHazardRing(img, dec.hexes, cell);
    else throw new Error("unknown decal type for the Military Bay style: " + kind);
  });
  img = scatter(img, cell, o, 4, focus, focus ? 1.0 : 0.45);                 // a breach = heavy debris
  const solid = Object.entries(data.terrain || {}).filter(([, v]) => v === "obstruction").map(([k]) => k.split(",").map(Number));
  if (solid.length) img = bulkhead(img, solid, cell, 9, [data.cols, data.rows]);
  img = atmosphere(img, cell, o);
  // the zones as on every map, except no tint over the lift (a zone the lift covers): outline and label still show
  const tint = {}, noTint = (zid) => { tint[zid] = [(ZONE_TINT[zid] || DEFAULT_TINT)[0], 0]; };
  for (const dec of data.decals || []) {
    if (dec.type !== "hazard_border") continue;
    if (dec.zone) { noTint(dec.zone); continue; }
    const lift = new Set(dec.hexes.map((hx) => hx.join()));
    for (const [zid, z] of Object.entries(zones)) if (z.hexes.length && z.hexes.every((hx) => lift.has(hx.join()))) noTint(zid);
  }
  return drawAllZones(img, zones, cell, o, tint);
}

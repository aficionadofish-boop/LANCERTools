// Ship Deck: the inside of an old, much-repaired expedition carrier, seen from above. Riveted deck
// plates (or tiles, or a resin floor), grating trenches with pipes and cables showing through, painted
// markings and stencils, heavy bulkheads with pipe runs and lamps along their faces, and ceiling light
// falling in pools. A brownout setting drops it to dim red emergency lighting.
//
// One base, several themes (makeStyle): Hangar Deck, Habitat Ring, Command Deck, Reactor Hall,
// Fabrication Bay. The themes are registered in render.js.
//
// Decals: floor_hatch -> a round pressure hatch with a hand wheel; hazard_border -> a lift platform;
// hazard_ring -> a yellow/black band; blast/scorch -> scorch; tracks -> tread marks; bay (themes with
// bays or cells) -> a painted bay per connected group, replacing the random ones.
// "obstruction" terrain (outside the play area) -> the bulkhead.
//
// Every layer has its own random stream, so a slider changes only its own layer.

import { PyRandom } from "../../rng.js?v=666bbb997f";
import { newImage, Draw, alphaComposite, u8 } from "../../raster.js?v=666bbb997f";
import { centre, geometry, imageSize, hexesBox, connectedParts } from "../geometry.js?v=666bbb997f";
import { ZONE_SETTINGS, withDefaults, keeper, extras, drawAllZones, decalHazardRing, decalBlast, decalTracks, maskOf } from "../common.js?v=666bbb997f";
import { vnoise, grain, blurL, addLight, darken } from "./jungle.js?v=666bbb997f";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// a fixed number in [0, 1) per (a, b): per plate, per tile, per lamp
function h01(a, b) {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x27d4eb2f, 0xc2b2ae35);
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// --- the walls' outline -----------------------------------------------------------------------------------

// Where the bulkhead is, and its faces into the room. Like the tunnel's wallMask, except that beyond the
// map's edge counts as solid, and hexes in the first and last columns run out to the image's edge: side
// walls are one solid band, with faces only where they meet the room.
function shipMask([w, h], solid, data, cell) {
  const [, , hw, qh] = geometry(cell), m = newImage("L", w, h), d = new Draw(m), key = (c, r) => c + "," + r;
  const isSolid = (c, r) => r < 0 || r >= data.rows || c < 0 || c >= data.cols || solid.has(key(c, r));
  const faces = [];
  for (const k of solid) {
    const [c, r] = k.split(",").map(Number), [cx, cy] = centre(c, r, cell);
    const up = r % 2 ? [[c, r - 1], [c + 1, r - 1]] : [[c - 1, r - 1], [c, r - 1]];
    const dn = r % 2 ? [[c, r + 1], [c + 1, r + 1]] : [[c - 1, r + 1], [c, r + 1]];
    const openUp = up.some(([a, b]) => !isSolid(a, b)), openDn = dn.some(([a, b]) => !isSolid(a, b));
    const y0 = openUp ? cy - qh : cy - 2 * qh - 1, y1 = openDn ? cy + qh : cy + 2 * qh + 1;
    const x0 = c === 0 ? 0 : cx - hw, x1 = c === data.cols - 1 ? w : cx + hw;
    d.rectangle([x0, y0, x1, y1], { fill: 255 });
    if (openUp) faces.push([x0, x1, y0, -1]);
    if (openDn) faces.push([x0, x1, y1, 1]);
  }
  return { m, faces };
}

// --- the floor --------------------------------------------------------------------------------------------

// raised diamond tread: short bars on a lattice, alternating direction
function treadBar(x, y, t) {
  const i = Math.floor(x / t), j = Math.floor(y / t), fx = x / t - i - 0.5, fy = y / t - j - 0.5;
  const a = (i + j) & 1 ? fx + fy : fx - fy, b = (i + j) & 1 ? fx - fy : fx + fy;
  return Math.abs(a) < 0.11 && Math.abs(b) < 0.34;
}

function floorPlates(img, cell, F) {
  const { w, h } = img, d = img.data, pw = cell * F.w, ph = cell * F.h, sw = Math.max(2, cell * 0.018);
  const mott = vnoise(h, w, cell * 0.35, 211), t = cell * (F.treadSize || 0.09);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / ph), py = y - row * ph, off = (row & 1) * pw * (F.stagger ?? 0.5);
    for (let x = 0; x < w; x++) {
      const xx = x + off, col = Math.floor(xx / pw), px = xx - col * pw, p = y * w + x, i = p * 4;
      const id = h01(row * 7919 + 13, col), base = F.colour, v = (id - 0.5) * F.var;
      let s = (0.5 - px / pw) * 5 + (0.5 - py / ph) * 4 + (mott[p] - 0.5) * 10 + grain(p, 212) * 1.8;
      if (px < sw || py < sw) s -= 30;                                           // the seam
      else if (px < sw + 2 || py < sw + 2) s += 9;                              // the lit lip below it
      else if (px > pw - 3 || py > ph - 3) s -= 7;
      if (F.tread) s += treadBar(x, y, t) ? 10 : treadBar(x - 2, y - 2, t) ? -9 : 0;
      for (let k = 0; k < 3; k++) d[i + k] = u8(base[k] + v + s);
      d[i + 3] = 255;
    }
  }
  if (F.bolts === false) return;
  const dr = new Draw(img), rr = Math.max(2, cell * 0.017), ins = Math.min(pw, ph) * 0.11;
  for (let row = 0; row * ph < h; row++) {
    const off = (row & 1) * pw * (F.stagger ?? 0.5);
    for (let col = -1; col * pw - off < w; col++) {
      const x0 = col * pw - off, y0 = row * ph;
      const pts = [[ins, ins], [pw - ins, ins], [ins, ph - ins], [pw - ins, ph - ins]];
      if (pw > ph * 1.4) pts.push([pw / 2, ins], [pw / 2, ph - ins]);
      for (const [bx, by] of pts) {
        const x = x0 + bx, y = y0 + by;
        dr.ellipse([x - rr, y - rr, x + rr, y + rr], { fill: [...F.colour.map((c) => u8(c * 0.55)), 255] });
        dr.ellipse([x - rr * 0.6, y - rr * 0.7, x + rr * 0.15, y + rr * 0.05], { fill: [...F.colour.map((c) => u8(c * 1.35 + 10)), 255] });
      }
    }
  }
}

function floorTiles(img, cell, F) {
  const { w, h } = img, d = img.data, ts = cell * F.size, gw = Math.max(2, cell * 0.022);
  const mott = vnoise(h, w, cell * 0.6, 221);
  for (let y = 0; y < h; y++) {
    const j = Math.floor(y / ts), py = y - j * ts;
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor(x / ts), px = x - i0 * ts, p = y * w + x, i = p * 4, id = h01(j * 3001 + 7, i0);
      let c;
      if (px < gw || py < gw) c = F.grout;
      else {
        const accent = F.accentEvery && (((j % F.accentEvery) + F.accentEvery) % F.accentEvery) === 0;
        c = accent ? F.accent : F.palette[Math.floor(id * F.palette.length)];
        const edge = px < gw + 2 || py < gw + 2 ? 7 : px > ts - 3 || py > ts - 3 ? -6 : 0;
        c = c.map((v) => v + edge + (id - 0.5) * F.var);
      }
      const s = (mott[p] - 0.5) * 9 + grain(p, 222) * 1.6;
      for (let k = 0; k < 3; k++) d[i + k] = u8(c[k] + s);
      d[i + 3] = 255;
    }
  }
}

function floorResin(img, cell, F) {
  const { w, h } = img, d = img.data, J = cell * F.joint, mott = vnoise(h, w, cell * 1.1, 231), fine = vnoise(h, w, cell * 0.12, 232);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * 4, jx = x % J, jy = y % J;
    let s = (mott[p] - 0.5) * 14 + (fine[p] - 0.5) * 5 + grain(p, 233) * 1.4;
    if (jx < 2 || jy < 2) s -= 22; else if (jx < 4 || jy < 4) s += 5;
    for (let k = 0; k < 3; k++) d[i + k] = u8(F.colour[k] + s);
    d[i + 3] = 255;
  }
}

// paint worn back to bare metal in patches, and grime that gathers in hollows and along the walls
function wearAndGrime(img, cell, T, o, near) {
  const { w, h } = img, d = img.data, wn = vnoise(h, w, cell * 0.5, 241, 4), gn = vnoise(h, w, cell * 2.2, 242);
  const bare = T.bare, grime = T.grime || [20, 20, 18];
  for (let p = 0; p < w * h; p++) {
    const i = p * 4, wv = clamp((wn[p] - (0.8 - 0.07 * o.wear)) * 9) * Math.min(1, o.wear);
    const gv = clamp(((0.5 - gn[p]) * 1.2 + near[p] / 255 * 0.6) * o.grime, 0, 0.75);
    for (let k = 0; k < 3; k++) d[i + k] = u8(lerp(lerp(d[i + k], bare[k], wv * 0.3), grime[k], gv * 0.45));
  }
}

// --- trenches ----------------------------------------------------------------------------------------------

// grating trenches running across the deck, pipes or cables in the dark below. Returns their mask.
function trenches(img, cell, T, o, wall) {
  const { w, h } = img, C = T.trench, mask = newImage("L", w, h);
  if (!C || !o.trenches) return mask;
  const d = img.data, md = new Draw(mask), r = new PyRandom(501);
  const strips = [], n = Math.max(1, Math.round(h / (cell * C.every)));
  for (let k = 0; k < n; k++) strips.push(["h", (k + 0.5) * h / n + r.uniform(-0.6, 0.6) * cell]);
  if (C.crossEvery) {
    const m = Math.max(1, Math.round(w / (cell * C.crossEvery)));
    for (let k = 0; k < m; k++) strips.push(["v", (k + 0.5) * w / m + r.uniform(-0.6, 0.6) * cell]);
  }
  const keep = keeper(501, o.trenches), more = extras(strips.length, o.trenches, 1501);
  for (let i = 0; i < more.count; i++) strips.push([more.rng.random() < 0.7 ? "h" : "v", more.rng.uniform(0.1, 0.9) * (more.rng.random() < 0.7 ? h : w)]);
  const half = cell * C.w / 2, bar = cell * 0.075, pipeCols = C.pipes;
  strips.forEach(([dir, at], k) => {
    if (k < n + (C.crossEvery ? Math.max(1, Math.round(w / (cell * C.crossEvery))) : 0) && !keep(k)) return;
    const len = dir === "h" ? w : h;
    for (let a = 0; a < len; a++) for (let b = Math.floor(at - half); b <= Math.ceil(at + half); b++) {
      const x = dir === "h" ? a : b, y = dir === "h" ? b : a;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const p = y * w + x;
      if (wall[p] > 80) continue;
      const u = (b - (at - half)) / (2 * half), i = p * 4;                     // 0..1 across the trench
      let c;
      if (u < 0.06 || u > 0.94) c = u < 0.06 ? T.trenchRim.map((v) => v + 18) : T.trenchRim.map((v) => v - 14);   // the angle-iron frame
      else {
        c = T.void.slice();
        pipeCols.forEach(([pc, at2, rad]) => {                                    // pipes or cables below
          const dd = Math.abs(u - at2) / rad;
          if (dd < 1) { const s = Math.sqrt(1 - dd * dd); c = pc.map((v) => v * (0.35 + 0.75 * s)); }
        });
        const along = a % (bar * 1.6), across = (b - at) % (bar * 0.9);
        const onBar = along < bar * 0.42 || Math.abs(across) < bar * 0.12;
        const shade = (along >= bar * 0.42 && along < bar * 0.75);
        if (onBar) c = T.grate.map((v) => v + (along < bar * 0.12 ? 14 : 0));
        else if (shade) c = c.map((v) => v * 0.55);
      }
      for (let q = 0; q < 3; q++) d[i + q] = u8(c[q] + grain(p, 502) * 1.5);
      mask.data[p] = 255;
    }
  });
  return mask;
}

// --- paint ---------------------------------------------------------------------------------------------------

// rectangles of free floor: not in the walls, not over a trench, not on top of each other
function take(blocked, w, h, x0, y0, x1, y1) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, y1); y++) blocked.fill(1, y * w + Math.max(0, Math.floor(x0)), y * w + Math.min(w, Math.ceil(x1)));
}

function places(n, size, cell, w, h, blocked, seed, pad = 0.25) {
  const r = new PyRandom(seed), out = [];
  for (let tries = 0; tries < n * 40 && out.length < n; tries++) {
    const bw = size[0] * cell, bh = size[1] * cell, x = r.uniform(cell * 0.3, w - bw - cell * 0.3), y = r.uniform(cell * 0.3, h - bh - cell * 0.3);
    let ok = true;
    for (let gy = 0; gy <= 6 && ok; gy++) for (let gx = 0; gx <= 6 && ok; gx++) {
      const px = Math.trunc(x + bw * gx / 6), py = Math.trunc(y + bh * gy / 6);
      if (blocked[py * w + px]) ok = false;
    }
    if (ok && out.every(([ox, oy, ow, oh]) => x > ox + ow + pad * cell || x + bw + pad * cell < ox || y > oy + oh + pad * cell || y + bh + pad * cell < oy))
      out.push([x, y, bw, bh]);
  }
  for (const [x, y, bw, bh] of out) take(blocked, w, h, x - pad * cell * 0.5, y - pad * cell * 0.5, x + bw + pad * cell * 0.5, y + bh + pad * cell * 0.5);
  return out;
}

function paint(img, cell, T, o, blocked, glow, data, bays) {
  const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), P = T.paint || {};
  if (P.boxes) for (const [x, y, bw, bh] of bays || [])                       // walkway lines stop at a painted bay
    take(blocked, w, h, x - cell * 0.2, y - cell * 0.2, x + bw + cell * 0.2, y + bh + cell * 0.2);
  const base = blocked.slice();                                              // lines only avoid walls, trenches and decals
  const a = (al) => Math.round(al * clamp(o.markings, 0, 1.5) / 1.5 * 1.5);
  const lw = Math.max(2, Math.round(cell * 0.04));
  if (P.lanes && o.markings) {                                                // walkway lines
    const L = P.lanes, n = Math.max(1, Math.round(h / (cell * L.every)));
    for (let k = 0; k < n; k++) {
      const y = (k + 0.5) * h / n;
      for (const off of [-L.gap / 2, L.gap / 2]) {
        const yy = y + off * cell;
        for (let x = 0; x < w; x += L.dash ? cell * 0.5 : cell * 0.25) {
          const x1 = x + (L.dash ? cell * 0.3 : cell * 0.25);
          const p0 = Math.trunc(yy) * w + Math.trunc(x), p1 = Math.trunc(yy) * w + Math.min(w - 1, Math.trunc(x1));
          if (base[p0] || base[p1]) continue;
          d.rectangle([x, yy - lw / 2, x1, yy + lw / 2], { fill: [...L.colour, a(200)] });
        }
      }
      take(blocked, w, h, 0, y - (L.gap / 2 + 0.25) * cell, w, y + (L.gap / 2 + 0.25) * cell);
    }
  }
  if (P.rails) {                                                              // crane rails across the bay
    const R = P.rails, n = Math.max(1, Math.round(h / (cell * R.every)));
    for (let k = 0; k < n; k++) {
      const y = (k + 0.5) * h / n;
      for (const off of [-R.gauge / 2, R.gauge / 2]) {
        const yy = y + off * cell, rw = cell * 0.05;
        for (let x = 0; x < w; x += 2) {
          const p = Math.trunc(yy) * w + x;
          if (base[p]) continue;
          d.rectangle([x, yy - rw * 1.6, x + 2, yy + rw * 1.6], { fill: [30, 32, 32, 230] });
          d.rectangle([x, yy - rw * 0.6, x + 2, yy + rw * 0.6], { fill: [150, 154, 150, 255] });
          d.rectangle([x, yy - rw * 0.6, x + 2, yy - rw * 0.2], { fill: [196, 198, 192, 255] });
        }
        for (let x = cell * 0.2; x < w; x += cell * 0.45) {
          if (base[Math.trunc(yy) * w + Math.trunc(x)]) continue;
          for (const s of [-1, 1]) d.ellipse([x - 3, yy + s * rw * 2.3 - 3, x + 3, yy + s * rw * 2.3 + 3], { fill: [40, 42, 42, 230] });
        }
      }
      take(blocked, w, h, 0, y - (R.gauge / 2 + 0.3) * cell, w, y + (R.gauge / 2 + 0.3) * cell);
    }
  }
  if (P.inlay) {                                                              // light strips set in the deck
    const I = P.inlay, n = Math.max(1, Math.round(h / (cell * I.every))), gd = new Draw(glow);
    for (let k = 0; k < n; k++) {
      const y = (k + 0.5) * h / n + I.offset * cell;
      for (let x = 0; x < w; x += 2) {
        if (base[Math.trunc(y) * w + x]) continue;
        d.rectangle([x, y - 2, x + 2, y + 2], { fill: [...I.colour, 255] });
        gd.rectangle([x, y - cell * 0.03, x + 2, y + cell * 0.03], { fill: 200 });
      }
    }
  }
  // bays and work cells: the painted ones (the "bay" decal) if there are any, else scattered at random
  const painted = bays && bays.length > 0;
  if (P.boxes && (painted || o.markings)) {
    const B = P.boxes, n = Math.round((w * h) / (cell * cell) / B.per * (o.bays ?? 1));
    const A = painted ? (al) => Math.round(al * Math.max(1, clamp(o.markings, 0, 1.5))) : a;   // painted ones always show
    const list = painted ? bays : places(n, B.size, cell, w, h, blocked, 511);
    list.forEach(([x, y, bw, bh], k) => {
      const t = lw * 1.3;
      if (B.hazard) {                                                          // a yellow/black striped border
        for (const [rx0, ry0, rx1, ry1] of [[x, y, x + bw, y + t * 2], [x, y + bh - t * 2, x + bw, y + bh], [x, y, x + t * 2, y + bh], [x + bw - t * 2, y, x + bw, y + bh]]) {
          d.rectangle([rx0, ry0, rx1, ry1], { fill: [...B.colour, A(210)] });
          hazardBands(d, [rx0, ry0, rx1, ry1], t * 2.4, t * 1.2, [22, 20, 16, A(200)]);
        }
      } else d.rectangle([x, y, x + bw, y + bh], { outline: [...B.colour, A(200)], width: Math.round(t) });
      const label = B.label + " " + String(k + 1).padStart(2, "0"), size = cell * 0.26;
      d.text([x + t * 2.5, y + t * 2.5], label, size, [...B.colour, A(170)], { family: "stencil" });
      if (B.rings) for (const [rx, ry] of [[0.18, 0.25], [0.82, 0.25], [0.18, 0.75], [0.82, 0.75]]) {   // tie-down rings
        const cx = x + bw * rx, cy = y + bh * ry, R = cell * 0.06;
        d.ellipse([cx - R, cy - R, cx + R, cy + R], { outline: [40, 42, 44, 230], width: Math.max(2, Math.round(cell * 0.02)) });
        d.ellipse([cx - R * 0.45, cy - R * 0.45, cx + R * 0.45, cy + R * 0.45], { fill: [30, 32, 34, 230] });
      }
    });
  }
  if (P.trefoil && o.markings) {                                              // radiation warnings
    places(Math.round((w * h) / (cell * cell) / 80), [1.0, 1.0], cell, w, h, blocked, 521).forEach(([x, y, bw]) => {
      const cx = x + bw / 2, cy = y + bw / 2, R = bw * 0.46;
      d.ellipse([cx - R, cy - R, cx + R, cy + R], { fill: [...P.trefoil, a(110)] });
      for (const ang of [-90, 30, 150]) {
        const pts = [[cx, cy]];
        for (let t = ang - 30; t <= ang + 30; t += 5) pts.push([cx + Math.cos(t * Math.PI / 180) * R * 0.8, cy + Math.sin(t * Math.PI / 180) * R * 0.8]);
        d.polygon(pts, [24, 22, 18, a(170)]);
      }
      d.ellipse([cx - R * 0.24, cy - R * 0.24, cx + R * 0.24, cy + R * 0.24], { fill: [...P.trefoil, a(160)] });
      d.ellipse([cx - R * 0.15, cy - R * 0.15, cx + R * 0.15, cy + R * 0.15], { fill: [24, 22, 18, a(170)] });
    });
  }
  if (o.stencils && P.stencils) {                                             // stencilled words, faint
    const r = new PyRandom(531), n = Math.round((w * h) / (cell * cell) / 14), keep = keeper(531, o.stencils), more = extras(n, o.stencils, 1531);
    const one = (g) => {
      const text = g.choice(P.stencils), size = cell * g.uniform(0.22, 0.34), x = g.uniform(0, w), y = g.uniform(0, h);
      return () => {
        const tw = d.textLength(text, size, "stencil");
        for (let gx = 0; gx <= 4; gx++) for (const py of [y, y + size * 0.5, y + size * 1.1]) {
          const px = x + tw * gx / 4;
          if (px >= w || py >= h || blocked[Math.trunc(py) * w + Math.trunc(px)]) return;
        }
        d.text([x, y], text, size, [...P.stencilColour, a(P.stencilAlpha || 90)], { family: "stencil" });
        take(blocked, w, h, x - size * 0.4, y - size * 0.3, x + tw + size * 0.4, y + size * 1.4);
      };
    };
    for (let i = 0; i < n; i++) { const f = one(r); if (keep(i)) f(); }
    for (let i = 0; i < more.count; i++) one(more.rng)();
  }
  // paint wears with the floor: break it up a little
  const wn = vnoise(h, w, cell * 0.18, 541, 3, null);
  for (let p = 0; p < w * h; p++) if (over.data[p * 4 + 3]) over.data[p * 4 + 3] = u8(over.data[p * 4 + 3] * clamp(0.45 + wn[p] * 1.0 - (o.wear - 1) * 0.2));
  return alphaComposite(img, over);
}

// --- decals ------------------------------------------------------------------------------------------------

function hatch(img, cx, cy, cell, T) {
  const d = new Draw(img), R = cell * 0.36, S = T.hatchSteel;
  const sh = (c, f) => [...c.map((v) => u8(v * f)), 255];
  d.ellipse([cx - R * 1.12, cy - R * 1.12, cx + R * 1.12, cy + R * 1.12], { fill: [16, 16, 16, 255] });     // the recess
  if (T.hatchStripes) for (let k = 0; k < 16; k++) {
    const a0 = (k / 16) * 2 * Math.PI, a1 = ((k + 1) / 16) * 2 * Math.PI;
    d.pieslice([cx - R * 1.32, cy - R * 1.32, cx + R * 1.32, cy + R * 1.32], (a0 * 180) / Math.PI, (a1 * 180) / Math.PI, k & 1 ? [24, 22, 18, 255] : [204, 160, 38, 255]);
  }
  d.ellipse([cx - R * 1.1, cy - R * 1.1, cx + R * 1.1, cy + R * 1.1], { fill: sh(S, 0.55) });
  d.ellipse([cx - R, cy - R, cx + R, cy + R], { fill: sh(S, 1.0) });
  d.ellipse([cx - R * 0.98, cy - R * 0.98, cx + R * 0.9, cy + R * 0.9], { fill: sh(S, 1.12) });
  d.ellipse([cx - R * 0.86, cy - R * 0.86, cx + R * 0.86, cy + R * 0.86], { fill: sh(S, 0.92) });
  d.rectangle([cx - R * 0.3, cy - R * 1.22, cx + R * 0.3, cy - R * 0.95], { fill: sh(S, 0.7) });             // the hinge
  const wr = R * 0.55, lw = Math.max(3, Math.round(cell * 0.03)), wheel = T.wheel || [150, 40, 30];
  for (let k = 0; k < 4; k++) {                                                                                // the hand wheel
    const an = (k * Math.PI) / 2 + 0.4;
    d.line([[cx + 1.5, cy + 2], [cx + Math.cos(an) * wr + 1.5, cy + Math.sin(an) * wr + 2]], [10, 10, 10, 140], lw);
    d.line([[cx, cy], [cx + Math.cos(an) * wr, cy + Math.sin(an) * wr]], [...wheel, 255], lw);
  }
  d.ellipse([cx - wr + 2, cy - wr + 3, cx + wr + 2, cy + wr + 3], { outline: [10, 10, 10, 140], width: lw });
  d.ellipse([cx - wr, cy - wr, cx + wr, cy + wr], { outline: [...wheel, 255], width: lw });
  d.ellipse([cx - wr * 0.95, cy - wr * 0.95, cx + wr * 0.8, cy + wr * 0.8], { outline: [...wheel.map((v) => u8(v * 1.5 + 30)), 160], width: Math.max(1, lw >> 1) });
  d.ellipse([cx - R * 0.12, cy - R * 0.12, cx + R * 0.12, cy + R * 0.12], { fill: sh(S, 0.6) });
}

// Dark 45-degree bands across a rectangle, cut exactly to it. The phase runs on x + y over the whole map, so the
// four strips of a border meet at the corners without a seam and every band keeps the same width.
function hazardBands(d, [x0, y0, x1, y1], period, band, colour) {
  const cut = (poly, keep) => {                                                // Sutherland-Hodgman, one half-plane
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], kp = keep(p), kq = keep(q);
      if (kp >= 0) out.push(p);
      if ((kp >= 0) !== (kq >= 0)) { const f = kp / (kp - kq); out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); }
    }
    return out;
  };
  const rect = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (let c = Math.floor((x0 + y0) / period) * period; c < x1 + y1; c += period) {
    const poly = cut(cut(rect, ([x, y]) => x + y - c), ([x, y]) => c + band - (x + y));
    if (poly.length >= 3) d.polygon(poly, colour);
  }
}

// The reactor well: opaque coolant filling the ring's hexes, dark where the deck's lip shades it, glowing blue
// further in, with rippling caustic light. The hazard band is drawn over its edge afterwards.
function coolantWell(img, hexes, cell) {
  const { w, h } = img, m = maskOf([w, h], hexes.map(([c, r]) => centre(c, r, cell)), cell);
  const depth = blurL(m, cell * 0.35).data, n1 = vnoise(h, w, cell * 0.5, 591), n2 = vnoise(h, w, cell * 0.16, 592), d = img.data;
  const rim = [8, 30, 42], deep = [26, 120, 160], glow = [92, 205, 240];
  for (let p = 0; p < w * h; p++) {
    if (!m.data[p]) continue;
    const x = p % w, y = (p - x) / w, i = p * 4;
    const k = clamp((depth[p] / 255 - 0.5) * 2);                              // 0 at the rim, 1 a third of a hex in
    const core = clamp((depth[p] / 255 - 0.85) * 6.7);                        // the middle of a big well glows
    const wave = Math.sin((x * 0.8 + y * 0.6) / (cell * 0.07) + n1[p] * 9) * Math.sin((y * 0.9 - x * 0.5) / (cell * 0.1) + n2[p] * 7);
    const caustic = Math.max(0, wave) ** 5 * k;
    for (let c = 0; c < 3; c++) {
      const base = lerp(lerp(rim[c], deep[c], k), glow[c], core * 0.7);
      d[i + c] = u8(base + caustic * [70, 110, 100][c] + (n2[p] - 0.5) * 16 * k);
    }
    d[i + 3] = 255;
  }
}

function lift(img, hexes, cell, T) {
  for (const part of connectedParts(hexes, cell)) {
    const [x0, y0, x1, y1] = hexesBox(part, cell, -cell * 0.12), d = new Draw(img), t = cell * 0.12;
    d.rectangle([x0 - 4, y0 - 4, x1 + 4, y1 + 4], { fill: [14, 14, 14, 255] });
    for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) {
      const p = y * img.w + x, i = p * 4, s = treadBar(x, y, cell * 0.08) ? 12 : treadBar(x - 2, y - 2, cell * 0.08) ? -10 : 0;
      for (let k = 0; k < 3; k++) img.data[i + k] = u8(T.liftSteel[k] + s + grain(p, 551) * 2);
    }
    for (const [a0, b0, a1, b1] of [[x0, y0, x1, y0 + t], [x0, y1 - t, x1, y1], [x0, y0, x0 + t, y1], [x1 - t, y0, x1, y1]]) {
      d.rectangle([a0, b0, a1, b1], { fill: [204, 160, 38, 255] });
      hazardBands(d, [a0, b0, a1, b1], t * 1.6, t * 0.8, [24, 22, 18, 255]);
    }
    const tx = (x0 + x1) / 2, size = cell * 0.4, tw = d.textLength("LIFT", size, "stencil");
    d.text([tx - tw / 2, (y0 + y1) / 2 - size * 0.55], "LIFT", size, [196, 160, 52, 200], { family: "stencil" });
  }
}

// --- the bulkhead ----------------------------------------------------------------------------------------------

function bulkhead(img, solid, data, cell, T, o, light) {
  const { w, h } = img, { m, faces } = shipMask([w, h], solid, data, cell), W = T.wall;
  const b = blurL(m, cell * 0.03), d = img.data, sh = newImage("L", w, h), off = Math.round(cell * 0.12);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {                   // the shadow it casts, down-right
    const sx = x - off, sy = y - Math.round(off * 1.2);
    if (sx >= 0 && sy >= 0 && m.data[sy * w + sx]) sh.data[y * w + x] = 255;
  }
  darken(img, blurL(sh, cell * 0.16), 0.6);
  const tex = vnoise(h, w, cell * 0.6, 561, 3, b.data), rib = cell * 1.0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (b.data[p] < 128) continue;
    const i = p * 4, gx = b.data[p + (x < w - 1 ? 1 : 0)] - b.data[p - (x > 0 ? 1 : 0)], gy = b.data[p + (y < h - 1 ? w : 0)] - b.data[p - (y > 0 ? w : 0)];
    const bevel = clamp((gx + gy) * 0.8, -36, 36), rx = x % rib;
    const frame = rx < cell * 0.14 ? (rx < cell * 0.03 ? 18 : 9) : rx < cell * 0.17 ? -14 : 0;  // the frames: ribs across the bulkhead
    const seam = y % Math.round(cell * 0.7) < 3 ? -12 : 0;
    for (let k = 0; k < 3; k++) d[i + k] = u8(W[k] + bevel + frame + seam + (tex[p] - 0.5) * 12 + grain(p, 562) * 2);
  }
  const dr = new Draw(img), rr = Math.max(2, cell * 0.016);
  for (let x = cell * 0.07; x < w; x += rib) for (let y = cell * 0.1; y < h; y += cell * 0.22)
    if (b.data[Math.trunc(y) * w + Math.trunc(x)] > 220) {
      dr.ellipse([x - rr, y - rr, x + rr, y + rr], { fill: [...W.map((v) => u8(v * 0.5)), 255] });
      dr.ellipse([x - rr * 0.6, y - rr * 0.7, x + rr * 0.2, y + rr * 0.1], { fill: [...W.map((v) => u8(v * 1.5 + 12)), 255] });
    }
  // pipe runs along each face, on the wall's top a little in from the edge; brackets, the odd valve wheel
  const pipes = T.pipes, r = new PyRandom(571), keep = keeper(571, o.pipes), lampAt = cell * T.wallLamps, ld = new Draw(light);
  const byLine = new Map();
  for (const f of faces) { const k = Math.round(f[2]) + "," + f[3]; if (!byLine.has(k)) byLine.set(k, []); byLine.get(k).push(f); }
  const runs = [];
  for (const list of byLine.values()) {
    list.sort((a, b2) => a[0] - b2[0]);
    let cur = list[0].slice();
    for (const f of list.slice(1)) { if (f[0] <= cur[1] + 2) cur[1] = Math.max(cur[1], f[1]); else { runs.push(cur); cur = f.slice(); } }
    runs.push(cur);
  }
  runs.sort((a, b2) => a[2] - b2[2] || a[0] - b2[0]);
  let fi = 0;
  for (const [x0, x1, y, side] of runs) {
    if (x1 - x0 < cell * 1.6) continue;
    const inward = -side;
    pipes.forEach(([col, dist, rad], j) => {
      if (!keep(fi * 8 + j)) return;
      const cy = y + inward * dist * cell, R = rad * cell;
      for (let yy = Math.floor(cy - R); yy <= Math.ceil(cy + R); yy++) {
        const u = (yy - cy) / R;
        if (Math.abs(u) > 1) continue;
        const s = Math.sqrt(1 - u * u), lit = 0.35 + 0.7 * s - u * 0.25;
        for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
          if (x < 0 || x >= w || yy < 0 || yy >= h || !m.data[yy * w + x]) continue;
          const i = (yy * w + x) * 4, br = (x % (cell * 0.55)) < cell * 0.05 ? 0.55 : 1;
          for (let k = 0; k < 3; k++) d[i + k] = u8(col[k] * lit * br);
        }
      }
    });
    if (o.pipes && r.random() < 0.3 * o.pipes) {                                // a valve wheel on the top pipe
      const vx = r.uniform(x0 + cell * 0.2, x1 - cell * 0.2), vy = y + inward * pipes[0][1] * cell, vr = cell * 0.08;
      dr.ellipse([vx - vr, vy - vr, vx + vr, vy + vr], { outline: [...(T.wheel || [150, 40, 30]), 255], width: Math.max(2, Math.round(cell * 0.022)) });
      dr.line([[vx - vr, vy], [vx + vr, vy]], [...(T.wheel || [150, 40, 30]), 255], 2);
      dr.line([[vx, vy - vr], [vx, vy + vr]], [...(T.wheel || [150, 40, 30]), 255], 2);
    } else r.random();
    // lamps fixed at the face, every few cells (on a global grid so neighbouring faces line up)
    for (let lx = Math.ceil(x0 / lampAt) * lampAt; lx < x1; lx += lampAt) {
      const fy = y + inward * cell * 0.04;
      dr.rectangle([lx - cell * 0.14, fy - cell * 0.035, lx + cell * 0.14, fy + cell * 0.035], { fill: [26, 26, 26, 255] });
      dr.rectangle([lx - cell * 0.11, fy - cell * 0.018, lx + cell * 0.11, fy + cell * 0.018], { fill: [...T.lampGlass, 255] });
      const py = y + side * cell * 0.55;
      ld.ellipse([lx - cell * 1.0, py - cell * 0.7, lx + cell * 1.0, py + cell * 0.7], { fill: 150 });
    }
    fi++;
  }
  return m;
}

// --- light ---------------------------------------------------------------------------------------------------

function lighting(img, cell, T, o, light, wall, glow) {
  const { w, h } = img, d = img.data, ld = new Draw(light), L = T.lamps, sp = cell * L.every;
  const em = o.emergency;
  for (let j = 0, y = sp * 0.5; y < h + sp; y += sp * 0.87, j++)                  // ceiling lamps, staggered
    for (let i = 0, x = (j & 1 ? sp * 0.5 : 0) + sp * 0.25; x < w + sp; x += sp, i++) {
      const on = em ? h01(j * 131 + 5, i) < 0.3 : true;
      if (!on) continue;
      const R = cell * L.r;
      ld.ellipse([x - R, y - R * 0.8, x + R, y + R * 0.8], { fill: 255 });
    }
  const soft = blurL(light, cell * L.r * 0.6), amb = T.ambient * (1 - 0.55 * em), k = o.lights * 1.15;
  const tint = T.light.map((v, c) => lerp(v / 255, [1.0, 0.3, 0.26][c], em * 0.85));
  for (let p = 0; p < w * h; p++) {
    const i = p * 4, f = clamp(amb + (1 - amb) * (soft.data[p] / 255) * k * (em ? 0.8 : 1), 0, 1.25) * (wall[p] ? 1 : 1);
    for (let c = 0; c < 3; c++) d[i + c] = u8(d[i + c] * f * tint[c]);
  }
  if (glow) addLight(img, blurL(glow, cell * 0.08), T.glowColour || [120, 210, 255], 0.5 * (1 - em * 0.7));
}

// --- the style ---------------------------------------------------------------------------------------------------

export function makeStyle(T) {
  const settings = [
    { id: "wear", label: "Worn paint", group: "Floor", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
    { id: "grime", label: "Grime", group: "Floor", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
    { id: "markings", label: T.markingsLabel || "Painted markings", group: "Paint", type: "range", min: 0, max: 1.5, step: 0.05, default: 1 },
    ...(T.paint && T.paint.boxes ? [{ id: "bays", label: `Random ${T.paint.boxes.tool.toLowerCase()}s (when none are painted)`, group: "Paint", type: "range", min: 0, max: 2, step: 0.05, default: 1 }] : []),
    { id: "stencils", label: "Stencilled words", group: "Paint", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
    { id: "trenches", label: T.trenchLabel || "Grating trenches", group: "Structure", type: "range", min: 0, max: 2, step: 0.05, default: T.trench ? 1 : 0 },
    { id: "pipes", label: "Pipes along the bulkheads", group: "Structure", type: "range", min: 0, max: 1, step: 0.05, default: T.pipesDefault ?? 1 },
    { id: "lights", label: "Lamp light", group: "Light", type: "range", min: 0, max: 1.5, step: 0.05, default: 1 },
    { id: "emergency", label: "Brownout (dim red emergency light)", group: "Light", type: "range", min: 0, max: 1, step: 0.05, default: 0 },
    ...ZONE_SETTINGS,
  ];

  function render(data, cell, opts = {}) {
    const o = withDefaults(settings, opts);
    const [w, h] = imageSize(data.cols, data.rows, cell);
    const zones = data.zones || {};
    const solid = new Set(Object.entries(data.terrain || {}).filter(([, v]) => v === "obstruction").map(([k]) => k));
    let img = newImage("RGBA", w, h);
    const F = T.floor;
    if (F.kind === "tiles") floorTiles(img, cell, F); else if (F.kind === "resin") floorResin(img, cell, F); else floorPlates(img, cell, F);
    const wm = solid.size ? shipMask([w, h], solid, data, cell).m : newImage("L", w, h);
    const near = blurL(wm, cell * 0.7).data;
    wearAndGrime(img, cell, T, o, near);
    const tr = trenches(img, cell, T, o, wm.data);
    const blocked = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) blocked[p] = wm.data[p] || tr.data[p] || near[p] > 120 ? 1 : 0;
    const glow = newImage("L", w, h), light = newImage("L", w, h);
    const hexOf = (dec) => (dec.hexes || (dec.zone && zones[dec.zone] ? zones[dec.zone].hexes : [])).map((k) => (typeof k === "string" ? k.split(",").map(Number) : k));
    for (const dec of data.decals || []) {
      if (!["floor_hatch", "hazard_border", "hazard_ring"].includes(dec.type)) continue;
      const pad = dec.type === "hazard_ring" ? cell * 0.75 : cell * 0.25;
      for (const [c, r] of hexOf(dec)) { const [x, y] = centre(c, r, cell); take(blocked, w, h, x - cell / 2 - pad, y - cell * 0.6 - pad, x + cell / 2 + pad, y + cell * 0.6 + pad); }
    }
    // painted bays: each connected group of "bay" hexes is one box, numbered top to bottom, left to right
    const bayHexes = (data.decals || []).filter((dec) => dec.type === "bay").flatMap(hexOf);
    const bays = T.paint && T.paint.boxes && bayHexes.length
      ? connectedParts(bayHexes, cell).map((p) => hexesBox(p, cell, -cell * 0.1)).map(([x0, y0, x1, y1]) => [x0, y0, x1 - x0, y1 - y0])
        .sort((p, q) => (Math.abs(p[1] - q[1]) > cell * 0.5 ? p[1] - q[1] : p[0] - q[0]))
      : [];
    img = paint(img, cell, T, o, blocked, glow, data, bays);
    for (const dec of data.decals || []) {
      if (dec.type === "tracks") img = decalTracks(img, dec.from, dec.to, cell);
      else if (dec.type === "hazard_border") lift(img, hexOf(dec), cell, T);
      else if (dec.type === "hazard_ring") {
        if (T.coolant) coolantWell(img, hexOf(dec), cell);
        img = decalHazardRing(img, hexOf(dec), cell);
      }
      else if (dec.type === "floor_hatch") for (const [c, r] of hexOf(dec)) hatch(img, ...centre(c, r, cell), cell, T);
    }
    if (T.ringGlow) for (const dec of data.decals || [])                              // a reactor well glows
      if (dec.type === "hazard_ring") { const gd = new Draw(glow); for (const [c, r] of hexOf(dec)) { const [x, y] = centre(c, r, cell); gd.ellipse([x - cell * 0.6, y - cell * 0.6, x + cell * 0.6, y + cell * 0.6], { fill: T.coolant ? 110 : 255 }); } }
    (data.decals || []).filter((x) => x.type === "blast" || x.type === "scorch").forEach((dec, i) => { img = decalBlast(img, hexOf(dec), cell, 581 + i); });
    let wall = wm;
    if (solid.size) wall = bulkhead(img, solid, data, cell, T, o, light);
    lighting(img, cell, T, o, light, wall.data, glow);
    return drawAllZones(img, zones, cell, o);
  }

  return {
    name: T.name, blurb: T.blurb, terrainNote: T.terrainNote,
    decals: ["tracks", "blast", "scorch", "hazard_border", "hazard_ring", "floor_hatch", ...(T.paint && T.paint.boxes ? ["bay"] : [])],
    tools: {
      lift: { label: "Lift platform", hint: "A heavy lift platform with a hazard-striped edge; neighbouring hexes join into one platform." },
      ...(T.paint && T.paint.boxes ? { bay: { label: T.paint.boxes.tool, hint: `A ${T.paint.boxes.tool.toLowerCase()} painted on the deck: neighbouring hexes join into one, numbered top to bottom. Once you paint one, the random ones go.` } } : {}),
      ...(T.coolant ? { ring: { label: "Reactor well", hint: "The painted hexes fill with glowing coolant, with a yellow/black band round the edge." } } : {}),
      hatch: { label: "Pressure hatch", hint: "A round hatch in the deck with a hand wheel." },
      breach: { label: "Scorch", hint: "Click a hex: soot and burn marks." },
    },
    settings, render,
  };
}

// --- the themes ------------------------------------------------------------------------------------------------

const BULKHEAD = "draws it as a heavy bulkhead: ribbed steel with pipe runs and lamps along its face.";

export const HANGAR = {
  name: "Hangar Deck",
  blurb: "A carrier's hangar deck: big riveted plates in naval grey, mech bays painted on the deck with tie-down rings, yellow walkway lines, grating trenches over pipes, warm lamp light in pools.",
  terrainNote: "Hangar Deck " + BULKHEAD,
  floor: { kind: "plates", w: 1.5, h: 0.75, stagger: 0.5, colour: [84, 94, 96], var: 10 },
  bare: [128, 130, 126], grime: [26, 28, 26],
  trench: { w: 0.34, every: 7, crossEvery: 0, pipes: [[[90, 96, 100], 0.3, 0.18], [[140, 58, 44], 0.68, 0.14]] },
  void: [10, 11, 12], grate: [96, 102, 104], trenchRim: [70, 76, 78],
  paint: {
    lanes: { every: 6, gap: 1.6, colour: [214, 170, 40], dash: false },
    boxes: { per: 22, size: [3.2, 3.6], colour: [212, 210, 196], label: "BAY", tool: "Mech bay", rings: true },
    stencils: ["NO STOWAGE", "KEEP CLEAR", "DECK 2", "FR 114", "FR 118", "MECH LANE", "TIE DOWN"], stencilColour: [222, 220, 206], stencilAlpha: 80,
  },
  wall: [56, 62, 64], pipes: [[[96, 104, 108], 0.13, 0.05], [[150, 52, 40], 0.25, 0.035], [[70, 96, 120], 0.34, 0.03]],
  wallLamps: 2.4, lampGlass: [255, 236, 196], hatchSteel: [100, 108, 110], hatchStripes: true, wheel: [170, 46, 34],
  liftSteel: [74, 80, 82],
  lamps: { every: 3.4, r: 1.6 }, light: [255, 238, 210], ambient: 0.4,
};

export const HABITAT = {
  name: "Habitat Ring",
  blurb: "Living quarters made pleasant: warm stone-coloured tiles with a darker band, drains, pale painted bulkheads, soft daylight lamps. Few pipes on show.",
  terrainNote: "Habitat Ring " + BULKHEAD,
  floor: { kind: "tiles", size: 0.5, palette: [[150, 134, 114], [144, 127, 108], [156, 140, 120], [139, 123, 104]], grout: [84, 76, 66], accent: [104, 112, 98], accentEvery: 7, var: 8 },
  bare: [170, 158, 140], grime: [60, 52, 44],
  trench: { w: 0.16, every: 9, crossEvery: 0, pipes: [[[60, 70, 64], 0.5, 0.3]] },
  void: [18, 18, 16], grate: [120, 118, 110], trenchRim: [110, 104, 94], trenchLabel: "Drain channels",
  paint: { stencils: ["RING C", "QUARTERS 40-58", "WASHROOM", "COMMONS", "HYDROPONICS"], stencilColour: [70, 62, 52], stencilAlpha: 70 },
  wall: [96, 92, 84], pipes: [[[130, 128, 118], 0.12, 0.04]], pipesDefault: 0.5,
  wallLamps: 2.0, lampGlass: [255, 248, 224], hatchSteel: [130, 130, 124], hatchStripes: false, wheel: [60, 110, 90],
  liftSteel: [110, 108, 100],
  lamps: { every: 2.8, r: 1.6 }, light: [255, 246, 228], ambient: 0.52,
};

export const COMMAND = {
  name: "Command Deck",
  blurb: "Dark polished deck plates in big squares, narrow cable trenches with light strips beside them, few markings, cool light.",
  terrainNote: "Command Deck " + BULKHEAD,
  floor: { kind: "plates", w: 1.0, h: 1.0, stagger: 0, colour: [46, 52, 60], var: 5 },
  bare: [70, 76, 84], grime: [20, 22, 26],
  trench: { w: 0.2, every: 4, crossEvery: 0, pipes: [[[160, 60, 50], 0.25, 0.12], [[60, 110, 150], 0.45, 0.12], [[180, 160, 70], 0.65, 0.1], [[90, 90, 96], 0.82, 0.1]] },
  void: [8, 9, 12], grate: [70, 76, 86], trenchRim: [60, 66, 76], trenchLabel: "Cable trenches",
  paint: {
    inlay: { every: 4, offset: 0.32, colour: [170, 225, 255] },
    stencils: ["SECTION 1", "BRIDGE ACCESS", "AUTHORISED ONLY", "WATCH STATION"], stencilColour: [150, 170, 190], stencilAlpha: 60,
  },
  glowColour: [110, 200, 255],
  wall: [40, 46, 56], pipes: [[[64, 70, 80], 0.13, 0.045], [[54, 60, 72], 0.24, 0.035]], pipesDefault: 0.6,
  wallLamps: 2.4, lampGlass: [210, 232, 255], hatchSteel: [70, 78, 88], hatchStripes: false, wheel: [150, 40, 30],
  liftSteel: [56, 62, 72],
  lamps: { every: 3.2, r: 1.4 }, light: [214, 230, 255], ambient: 0.38,
};

export const REACTOR = {
  name: "Reactor Hall",
  blurb: "Heavy tread plate crossed by wide coolant trenches, radiation markings and warning stencils, red valve wheels on the bulkhead pipes, hard white light. A hazard ring becomes a reactor well full of glowing coolant.",
  terrainNote: "Reactor Hall " + BULKHEAD,
  floor: { kind: "plates", w: 1.0, h: 1.0, stagger: 0.5, colour: [76, 80, 82], var: 6, tread: true },
  bare: [120, 122, 120], grime: [22, 22, 20],
  trench: { w: 0.62, every: 3.6, crossEvery: 7, pipes: [[[70, 120, 150], 0.25, 0.14], [[200, 196, 180], 0.55, 0.16], [[70, 120, 150], 0.82, 0.12]] },
  void: [6, 8, 10], grate: [92, 96, 98], trenchRim: [180, 146, 40], trenchLabel: "Coolant trenches",
  paint: {
    trefoil: [214, 172, 42],
    stencils: ["COOLANT LOOP A", "COOLANT LOOP B", "RADIATION AREA", "NO ENTRY WITHOUT DOSIMETER", "PUMP 3"], stencilColour: [214, 172, 42], stencilAlpha: 95,
  },
  ringGlow: true, coolant: true, glowColour: [90, 190, 255],
  wall: [54, 58, 60], pipes: [[[150, 150, 140], 0.14, 0.06], [[70, 120, 150], 0.29, 0.05], [[160, 46, 34], 0.4, 0.03]],
  wallLamps: 2.0, lampGlass: [235, 245, 255], hatchSteel: [96, 100, 102], hatchStripes: true, wheel: [170, 46, 34],
  liftSteel: [70, 74, 76],
  lamps: { every: 3.0, r: 1.5 }, light: [235, 245, 255], ambient: 0.36,
};

export const FABRICATION = {
  name: "Fabrication Bay",
  blurb: "A pale grey resin floor in large panels, crane rails across the bay, work cells boxed in hazard stripes, green walkway dashes, stores stencils, bright even light.",
  terrainNote: "Fabrication Bay " + BULKHEAD,
  floor: { kind: "resin", joint: 2.0, colour: [122, 124, 120] },
  bare: [150, 150, 146], grime: [44, 44, 40],
  paint: {
    rails: { every: 6, gauge: 0.7 },
    boxes: { per: 26, size: [3, 3], colour: [210, 168, 40], label: "CELL", tool: "Work cell", hazard: true },
    lanes: { every: 6, gap: 1.2, colour: [70, 150, 96], dash: true },
    stencils: ["STORES", "PRINT CELL", "FEEDSTOCK", "QUARANTINE", "OUTBOUND", "KEEP CLEAR"], stencilColour: [40, 42, 40], stencilAlpha: 70,
  },
  wall: [72, 76, 74], pipes: [[[110, 114, 110], 0.13, 0.045], [[60, 110, 80], 0.24, 0.035]], pipesDefault: 0.7,
  wallLamps: 2.4, lampGlass: [240, 248, 255], hatchSteel: [110, 112, 108], hatchStripes: true, wheel: [170, 46, 34],
  liftSteel: [92, 96, 92],
  lamps: { every: 3.0, r: 1.7 }, light: [244, 248, 255], ambient: 0.5,
};

export const hangar = makeStyle(HANGAR), habitat = makeStyle(HABITAT), command = makeStyle(COMMAND);
export const reactor = makeStyle(REACTOR), fabrication = makeStyle(FABRICATION);

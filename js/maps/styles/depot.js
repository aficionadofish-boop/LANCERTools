// Depot, after Synthetik's Depot level: a teal-blue storage floor under cold light, dark at the edges.
// Paint: the floor's faint pale maze pattern, thin pale bay lines with square steps, pale diagonal
// stripe fields, faint dark stencil codes and >> chevrons, and tank pads (a square of dark corner
// brackets round a dark ring, with raised slat grilles beside it). Litter: paper scraps, dark
// flecks, grey chips, a few brass casings, pale scuffed patches. Robot remains are off by default.
// Reference: _backstage/reference/synthetik/depot/. Scale: a hex is about 110 px of the game's screen.
//
// Decals: blast/scorch -> a blown-up robot (dark oil splat); tracks -> forklift tracks; hazard_border ->
// a dark steel plate with herringbone tread; hazard_ring -> a yellow/black band; floor_hatch -> the round
// lift pad with its white rings and X. "obstruction" terrain -> a sunken pipe trench behind a railing.
//
// Every layer has its own random stream, so a slider changes only its own layer.
//
// The style is built from a theme (makeStyle): the Generator Annex (annex.js) is the same floor in green,
// with bar fields instead of diagonal stripes and manhole lids.

import { NpRandom, PyRandom } from "../../rng.js?v=0a584851f0";
import { newImage, cloneImage, Draw, alphaComposite, paste, gaussianBlur, u8 } from "../../raster.js?v=0a584851f0";
import { centre, imageSize, zoneEdges, hexesBox, connectedParts } from "../geometry.js?v=0a584851f0";
import { noise, maskOf, drawAllZones, decalHazardRing, ZONE_SETTINGS, withDefaults, keeper, extras } from "../common.js?v=0a584851f0";
import { maze, remains } from "../synthetik.js?v=0a584851f0";

// the Depot's theme; the Annex has its own (annex.js)
export const DEPOT = {
  name: "Depot",
  blurb: "A teal storage floor in cold light: a faint pale maze, bay lines, stripe fields, dark stencils, tank pads with slat grilles, paper scraps and scuffs, dark fog at the edges.",
  terrainNote: "Depot draws it as a sunken pipe trench behind a steel railing.",
  GROUND: [46, 106, 132], LIT: [64, 136, 158], SHADE: [30, 72, 102],
  PALE: [150, 206, 216],                 // pale paint: maze, bay lines, stripes, chalk
  DARKPAINT: [18, 46, 66],               // stencils, brackets, rings, chevrons
  SLAT: [34, 54, 70], SLAT_LIT: [96, 128, 142],
  FOG: [14, 30, 52], mist: [120, 170, 190],
  REMAINS: {                             // near-black oil with a blue wet halo; the robots' pale and grey bits
    oil: [20, 26, 36], core: [8, 12, 18], halo: [38, 72, 98], haloAlpha: 90,
    shards: [[16, 24, 32, 235], [26, 38, 50, 230], [10, 16, 22, 240]],
    chunks: [[150, 158, 168, 245], [90, 98, 110, 245], [206, 210, 214, 245]],
  },
  STENCILS: ["SK23", "AVN", "X4", "64", "VLPE", "A2", "F4", "IL", "K7", "D9", "R12", "B5", "N3"],
  CHALK: ["34", "36", "5", "321", "240", "L 36", "12", "7-B", "88"],
  mazeAlpha: 20, stripes: "diagonal", padLabel: "Tank pads",
  chalk: [200, 232, 236], scuff: [170, 208, 216], stipple: [196, 226, 230],
  paper: [[206, 222, 224, 215], [180, 204, 210, 200], [226, 234, 234, 225]],
  flecks: [[12, 22, 30, 225], [22, 36, 46, 215], [30, 48, 60, 200]],
  track: [16, 40, 56], track2: [12, 32, 46],
  pit: [22, 48, 76], pipe: [34, 56, 80], pipeLit: [70, 82, 88], flange: [56, 84, 110], flangeLine: [18, 32, 48],
  pitShadow: [8, 18, 30], railShadow: [8, 16, 26], rail: [104, 116, 130], railDark: [26, 34, 44], railLit: [138, 150, 164],
};

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function makeStyle(T) {
  const { GROUND, LIT, SHADE, PALE, DARKPAINT, SLAT, SLAT_LIT, FOG, REMAINS, STENCILS, CHALK } = T;
  const S = (c, a) => [...(T.steel ? T.steel(c) : c), a];                        // the steel of plates and pads, per theme

  // --- the ground ---------------------------------------------------------------------------------------

  // teal floor: broad lit pools and shaded patches, a fine mottle and grain
  function ground([w, h], cell, o) {
    const pool = noise(h, w, cell * 6, 201), mott = noise(h, w, cell * 1.3, 202), g = new NpRandom(203);
    const img = newImage("RGBA", w, h);
    for (let p = 0; p < w * h; p++) {
      const s = (pool[p] - 0.45) * 2.6 * o.light;
      const m = (mott[p] - 0.5) * 8, grain = g.normal(0, 2.0);
      for (let k = 0; k < 3; k++) {
        const base = s > 0 ? lerp(GROUND[k], LIT[k], clamp(s)) : lerp(GROUND[k], SHADE[k], clamp(-s));
        img.data[p * 4 + k] = u8(base + m * (k === 0 ? 0.6 : 1) + grain);
      }
      img.data[p * 4 + 3] = 255;
    }
    return img;
  }

  // --- paint: bay lines, stripe fields, stencils, chevrons, chalk ---------------------------------------------

  function paint(img, cell, o) {
    const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), r = new PyRandom(211);
    const area = (w * h) / (cell * cell), keep = keeper(211, o.markings);
    const lw = Math.max(4, Math.trunc(cell * 0.06));
    let item = 0;
    const nBays = Math.max(2, Math.round(area / 40));
    for (let i = 0; i < nBays; i++) {                                           // pale bay lines: big rectangles, some with a step
      const bw = r.uniform(4, 8) * cell, bh = r.uniform(3, 6) * cell;
      const x0 = r.uniform(-bw * 0.3, w - bw * 0.7), y0 = r.uniform(-bh * 0.3, h - bh * 0.7), x1 = x0 + bw, y1 = y0 + bh;
      const alpha = r.randint(56, 72), stepped = r.random() < 0.5, sx = r.uniform(0.3, 0.6) * bw, sy = r.uniform(0.3, 0.5) * bh;
      const corner = r.randint(0, 3), inner = r.random() < 0.4;
      if (!keep(item++)) continue;
      let pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      if (stepped) {                                                            // one corner stepped in
        const c = pts[corner], nx = corner === 1 || corner === 2 ? -1 : 1, ny = corner >= 2 ? -1 : 1;
        const a = [c[0] + nx * sx, c[1]], b = [c[0] + nx * sx, c[1] + ny * sy], e = [c[0], c[1] + ny * sy];
        const seq = corner % 2 === 0 ? [e, b, a] : [a, b, e];
        pts = [...pts.slice(0, corner), ...seq, ...pts.slice(corner + 1)];
      }
      const bay = (q, a) => {
        if (T.bays !== "dashed") return d.line(q, [...PALE, a], lw, "curve");
        for (let k = 0; k + 1 < q.length - 1; k++) {                         // long dark dashes, a gap at each corner
          const [ax, ay] = q[k], [bx, by] = q[k + 1], L = Math.hypot(bx - ax, by - ay), dash = cell * 0.55, gap = cell * 0.22;
          for (let t = gap / 2; t < L - gap / 2; t += dash + gap) {
            const t1 = Math.min(L - gap / 2, t + dash);
            d.line([[ax + ((bx - ax) * t) / L, ay + ((by - ay) * t) / L], [ax + ((bx - ax) * t1) / L, ay + ((by - ay) * t1) / L]], [...DARKPAINT, a], lw);
          }
        }
      };
      bay([...pts, pts[0], pts[1]], alpha);
      if (inner) {
        const g = cell * 0.55;
        bay([[x0 + g, y0 + g], [x1 - g, y0 + g], [x1 - g, y1 - g], [x0 + g, y1 - g], [x0 + g, y0 + g], [x1 - g, y0 + g]], Math.round(alpha * 0.8));
      }
    }
    const nStripe = Math.max(1, Math.round(area / 28)), fields = [], gap = cell * 1.2;
    for (let i = 0; i < nStripe; i++)                                           // pale diagonal stripe fields: placed first, each
      for (let tries = 0; tries < 40; tries++) {                                // at least `gap` from the others, so none melt together
        const tall = r.random() < 0.55, fw = (tall ? r.uniform(1.4, 2.4) : r.uniform(2.4, 4.5)) * cell, fh = (tall ? r.uniform(2.6, 4.5) : r.uniform(1.2, 2)) * cell;
        const x0 = r.uniform(-cell, w - fw + cell), y0 = r.uniform(-cell, h - fh + cell);
        if (fields.some((f) => x0 < f.x0 + f.fw + gap && f.x0 < x0 + fw + gap && y0 < f.y0 + f.fh + gap && f.y0 < y0 + fh + gap)) continue;
        fields.push({ x0, y0, fw, fh, alpha: r.randint(32, 44) });
        break;
      }
    for (const { x0, y0, fw, fh, alpha } of fields) {
      if (!keep(item++)) continue;
      const field = newImage("RGBA", w, h), fd = new Draw(field), step = cell * 0.26, sw = cell * 0.12;
      if (T.stripes === "checker") {                                          // a checkerboard of dark squares
        const q = cell * 0.3;
        for (let j = 0; j * q < fh; j++)
          for (let i = 0; i * q < fw; i++) if ((i + j) % 2 === 0) fd.rectangle([x0 + i * q, y0 + j * q, x0 + (i + 1) * q - 1, y0 + (j + 1) * q - 1], { fill: [...DARKPAINT, Math.round(alpha * 1.5)] });
      } else if (T.stripes === "bars") {                                               // rows of straight bars, across the long side
        const across = fw >= fh, bw = cell * 0.09, pitch = cell * 0.24;
        if (across) for (let k = x0 + pitch / 2; k < x0 + fw - bw; k += pitch) fd.rectangle([k, y0, k + bw, y0 + fh], { fill: [...PALE, alpha] });
        else for (let k = y0 + pitch / 2; k < y0 + fh - bw; k += pitch) fd.rectangle([x0, k, x0 + fw, k + bw], { fill: [...PALE, alpha] });
      } else
        for (let k = x0 - fh; k < x0 + fw; k += step)                           // stripes rising to the right
          fd.polygon([[k, y0 + fh], [k + sw, y0 + fh], [k + sw + fh, y0], [k + fh, y0]], [...PALE, alpha]);
      const clip = newImage("L", w, h);
      new Draw(clip).rectangle([x0, y0, x0 + fw, y0 + fh], { fill: 255 });
      paste(over, field, clip);
    }
    const nStencil = Math.max(2, Math.round(area / 40));
    for (let i = 0; i < nStencil; i++) {                                        // big faint dark stencil codes
      const x = r.uniform(0, w - cell), y = r.uniform(-cell * 0.2, h - cell * 0.6), text = r.choice(STENCILS), size = Math.trunc(cell * r.uniform(0.55, 0.9));
      if (!keep(item++)) continue;
      d.text([x, y], text, size, [...DARKPAINT, 48], { family: "stencil" });
    }
    const nChev = Math.max(2, Math.round(area / 40));
    for (let i = 0; i < nChev; i++) {                                           // >> chevrons, pointing along a row
      const x = r.uniform(0, w), y = r.uniform(0, h), s = cell * r.uniform(0.16, 0.22), dir = r.choice([1, -1]);
      if (!keep(item++)) continue;
      const t = Math.max(3, Math.trunc(cell * 0.035));
      if (T.marks === "plus") { d.line([[x - s, y], [x + s, y]], [...DARKPAINT, 50], t); d.line([[x, y - s], [x, y + s]], [...DARKPAINT, 50], t); continue; }
      for (const k of [0, 1]) d.line([[x - dir * s * 0.5 + dir * k * s * 0.8, y - s], [x + dir * s * 0.5 + dir * k * s * 0.8, y], [x - dir * s * 0.5 + dir * k * s * 0.8, y + s]], [...DARKPAINT, 44], t, "curve");
    }
    const nChalk = Math.round((area / 14) * o.chalk);
    for (let i = 0; i < nChalk; i++) {                                          // chalk numbers, underlined
      const x = r.uniform(0, w - cell), y = r.uniform(0, h - cell), fs = Math.trunc(cell * r.uniform(0.12, 0.16)), text = r.choice(CHALK);
      const col = [...T.chalk, 60], t = Math.max(1, Math.trunc(cell * 0.01));
      d.text([x, y], text, fs, col);
      if (r.random() < 0.5) d.line([[x, y + fs * 1.25], [x + fs * text.length * 0.6, y + fs * 1.2]], col, t);
    }
    return alphaComposite(img, over);
  }

  // --- tank pads: corner-bracket squares round a dark ring, with slat grilles and chevrons beside -------------

  function grille(d, x, y, cell, cols, rows) {                                 // raised steel slats, lit on top
    const sw = cell * 0.19, sh = cell * 0.03, pitch = cell * 0.052, gap = cell * 0.035;
    for (let c = 0; c < cols; c++)
      for (let k = 0; k < rows; k++) {
        const sx = x + c * (sw + gap), sy = y + k * pitch;
        d.rectangle([sx, sy, sx + sw, sy + sh], { fill: [...SLAT, 255] });
        d.line([[sx, sy], [sx + sw, sy]], [...SLAT_LIT, 255], Math.max(1, Math.trunc(cell * 0.008)));
      }
  }

  function pads(img, cell, o) {
    const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), fx = new Draw(img), r = new PyRandom(221);
    const keep = keeper(221, o.pads), gw = cell * 6.5, gh = cell * 5.5;
    let item = 0;
    for (let gy = -gh * 0.3; gy < h; gy += gh)                                 // a jittered grid, so pads never overlap
      for (let gx = -gw * 0.3; gx < w; gx += gw) {
        const on = r.random() < 0.5, S = cell * r.uniform(2.6, 3.4), cx = gx + gw / 2 + r.uniform(-0.6, 0.6) * cell, cy = gy + gh / 2 + r.uniform(-0.5, 0.5) * cell;
        const sides = r.randint(0, 2), ring = r.random() < 0.8;
        if (!on || !keep(item++)) continue;
        const x0 = cx - S / 2, y0 = cy - S / 2, x1 = cx + S / 2, y1 = cy + S / 2, L = cell * 0.4, t = Math.max(3, Math.trunc(cell * 0.04));
        const col = [...DARKPAINT, 70];
        for (const [px, py, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]])
          d.line([[px + sx * L, py], [px, py], [px, py + sy * L]], col, t, "curve");
        for (const px of [x0, x1]) d.line([[px, cy - S * 0.12], [px, cy + S * 0.12]], col, t);    // the side dashes
        if (ring) {
          const R = S * 0.3;
          d.ellipse([cx - R, cy - R, cx + R, cy + R], { outline: [...DARKPAINT, 46], width: Math.max(3, Math.trunc(cell * 0.05)) });
          for (let a = 0; a < 360; a += 45) {                                   // ticks round the ring
            const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
            d.line([[cx + c * R * 1.08, cy + s * R * 1.08], [cx + c * R * 1.22, cy + s * R * 1.22]], [...DARKPAINT, 46], t);
          }
        }
        if (sides > 0) for (const sx of sides === 2 ? [-1, 1] : [1]) {        // grilles and chevrons beside the ring
          const gx0 = sx < 0 ? x0 + cell * 0.18 : x1 - cell * 0.18 - cell * 0.41;
          grille(fx, gx0, cy - S * 0.36, cell, 2, 9);
          grille(fx, gx0, cy + S * 0.1, cell, 2, 9);
          const chx = sx < 0 ? x0 + cell * 0.38 : x1 - cell * 0.38, s = cell * 0.17;
          for (const k of [0, 1]) d.line([[chx - s * 0.5 + k * s * 0.8, cy - s], [chx + s * 0.5 + k * s * 0.8, cy], [chx - s * 0.5 + k * s * 0.8, cy + s]], [...DARKPAINT, 40], t, "curve");
        }
      }
    return alphaComposite(img, over);
  }

  // loose grilles, one to three slat columns, anywhere on the floor
  function grilles(img, cell, o) {
    const { w, h } = img, d = new Draw(img), r = new PyRandom(231), area = (w * h) / (cell * cell);
    const n = Math.round((area / 34) * o.grilles);
    for (let i = 0; i < n; i++) grille(d, r.uniform(0, w - cell), r.uniform(0, h - cell), cell, r.randint(1, 3), r.randint(8, 12));
    return img;
  }

  // round manhole lids: a pale rim, a dished lid with a lifting slot, seen slightly from the south (themes with
  // manholes only)
  function manholes(img, cell, o) {
    const { w, h } = img, d = new Draw(img), r = new PyRandom(281), area = (w * h) / (cell * cell);
    const n = Math.round((area / 30) * o.manholes), t = Math.max(2, Math.trunc(cell * 0.014));
    for (let i = 0; i < n; i++) {
      const x = r.uniform(cell * 0.3, w - cell * 0.3), y = r.uniform(cell * 0.3, h - cell * 0.3), R = cell * r.uniform(0.15, 0.19), ry = 0.8;
      d.ellipse([x - R + 2, y - R * ry + 4, x + R + 2, y + R * ry + 4], { fill: [...T.pitShadow, 255] });
      d.ellipse([x - R, y - R * ry, x + R, y + R * ry], { fill: [...T.lidRim, 255] });
      d.ellipse([x - R * 0.82, y - R * ry * 0.82, x + R * 0.82, y + R * ry * 0.82], { fill: [...T.lid, 255], outline: [...T.lidRim.map((v) => v * 0.7), 255], width: t });
      d.rectangle([x - R * 0.3, y - R * 0.08, x + R * 0.3, y + R * 0.08], { fill: [...T.lid.map((v) => v * 0.6), 255] });
    }
    return img;
  }

  // --- litter: paper scraps, flecks, chips, casings, scuffed patches ---------------------------------------------

  function litter(img, cell, o) {
    const [haze, dust, over] = kept("litter", [img.w, img.h, cell, o.scuffs, o.paper, o.debris, o.casings], () => litterLayers(img.w, img.h, cell, o));
    return alphaComposite(alphaComposite(alphaComposite(img, haze), dust), over);
  }

  function litterLayers(w, h, cell, o) {
    const area = (w * h) / (cell * cell);
    const dust = newImage("RGBA", w, h), dd = new Draw(dust), rd = new PyRandom(241);
    const nd = Math.round((area / 80) * o.scuffs);
    const haze = newImage("RGBA", w, h), hd = new Draw(haze);
    for (let i = 0; i < nd; i++) {                                              // pale scuffed patches: a soft smear, fine stipple on it
      const cx = rd.uniform(0, w), cy = rd.uniform(0, h), R = cell * rd.uniform(0.6, 1.2);
      for (let k = rd.randint(5, 8); k > 0; k--) {
        const a = rd.uniform(0, 2 * Math.PI), rr = R * rd.uniform(0, 0.6), s = R * rd.uniform(0.3, 0.55);
        const x = cx + Math.cos(a) * rr * 1.3, y = cy + Math.sin(a) * rr * 0.7;
        hd.ellipse([x - s * 1.3, y - s * 0.75, x + s * 1.3, y + s * 0.75], { fill: [...T.scuff, 34] });
      }
      for (let k = rd.randint(300, 600); k > 0; k--) {
        const a = rd.uniform(0, 2 * Math.PI), rr = R * Math.sqrt(rd.random()), s = cell * rd.uniform(0.004, 0.011);
        const x = cx + Math.cos(a) * rr * 1.4, y = cy + Math.sin(a) * rr * 0.75;
        dd.rectangle([x - s, y - s, x + s, y + s], { fill: [...T.stipple, 44] });
      }
    }
    const hazeSoft = gaussianBlur(haze, cell * 0.12);
    const over = newImage("RGBA", w, h), d = new Draw(over);
    const layer = (n, density, seed, one) => {
      const r = new PyRandom(seed), keep = keeper(seed, density), more = extras(n, density, seed + 1000);
      for (let i = 0; i < n; i++) { const draw = one(r); if (keep(i)) draw(); }
      for (let i = 0; i < more.count; i++) one(more.rng)();
    };
    const quad = (r, x, y, s, t) => {                                           // a small rotated rectangle
      const a = r.uniform(0, Math.PI), c = Math.cos(a), si = Math.sin(a);
      return [[-s, -t], [s, -t], [s, t], [-s, t]].map(([px, py]) => [x + px * c - py * si, y + px * si + py * c]);
    };
    layer(Math.round(area * 0.25), o.paper, 251, (r) => {                        // paper scraps
      const x = r.uniform(0, w), y = r.uniform(0, h), s = cell * r.uniform(0.02, 0.045), q = quad(r, x, y, s, s * r.uniform(0.5, 0.8));
      const fill = r.choice(T.paper);
      return () => d.polygon(q, fill);
    });
    layer(Math.round(area * 4), o.debris, 252, (r) => {                         // dark flecks
      const x = r.uniform(0, w), y = r.uniform(0, h), s = r.uniform(0.006, 0.022) * cell, q = [];
      for (let k = r.randint(3, 5); k > 0; k--) { const px = x + r.uniform(-s, s); q.push([px, y + r.uniform(-s, s)]); }
      const fill = r.choice(T.flecks);
      return () => d.polygon(q, fill);
    });
    layer(Math.round(area * 0.8), o.debris, 253, (r) => {                       // grey metal chips
      const x = r.uniform(0, w), y = r.uniform(0, h), s = r.uniform(0.01, 0.024) * cell, q = quad(r, x, y, s, s * 0.6);
      const fill = r.choice([[150, 160, 168, 220], [112, 124, 134, 220]]);
      return () => d.polygon(q, fill);
    });
    const cw = Math.max(2, Math.trunc(cell * 0.016));
    layer(Math.round(area * 0.4), o.casings, 254, (r) => {                      // brass casings
      const x = r.uniform(0, w), y = r.uniform(0, h), a = r.uniform(0, Math.PI), L = cell * r.uniform(0.035, 0.05);
      return () => d.line([[x, y], [x + Math.cos(a) * L, y + Math.sin(a) * L]], [230, 184, 80, 235], cw);
    });
    return [hazeSoft, dust, over];
  }

  // --- decals -----------------------------------------------------------------------------------------------

  // a dark steel plate set in the floor: herringbone tread, lighter side rails, bolt posts at the top corners
  function steelPlate(img, hexes, cell) {
    const [x0, y0, x1, y1] = hexesBox(hexes, cell, -cell * 0.1);
    const over = newImage("RGBA", img.w, img.h), d = new Draw(over), mid = (x0 + x1) / 2, t = Math.max(2, Math.trunc(cell * 0.012));
    d.rectangle([x0 + cell * 0.03, y0 + cell * 0.04, x1 + cell * 0.03, y1 + cell * 0.04], { fill: S([10, 22, 34], 120) });   // a thin shadow
    d.rectangle([x0, y0, x1, y1], { fill: S([64, 66, 86], 255) });
    const tread = newImage("RGBA", img.w, img.h), td = new Draw(tread), step = cell * 0.13, hh = mid - x0;
    for (let k = y0 - hh; k < y1 + hh; k += step) {                             // chevrons pointing down: \ on the left, / on the right
      td.line([[x0, k], [mid, k + hh]], S([44, 46, 62], 255), t);
      td.line([[x1, k], [mid, k + hh]], S([44, 46, 62], 255), t);
    }
    const clip = newImage("L", img.w, img.h), rw = cell * 0.09;
    new Draw(clip).rectangle([x0 + rw, y0, x1 - rw, y1], { fill: 255 });
    paste(over, tread, clip);
    for (const rx of [x0, x1 - rw]) {                                           // the side rails
      d.rectangle([rx, y0, rx + rw, y1], { fill: S([96, 104, 126], 255) });
      d.line([[rx + 2, y0], [rx + 2, y1]], S([132, 140, 160], 255), t);
    }
    for (const bx of [x0 + rw / 2, x1 - rw / 2]) {                              // bolt posts
      const s = cell * 0.07;
      d.rectangle([bx - s, y0 - s * 0.4, bx + s, y0 + s * 1.2], { fill: S([74, 80, 98], 255), outline: S([30, 34, 46], 255), width: t });
      d.ellipse([bx - s * 0.5, y0 + s * 0.2, bx + s * 0.5, y0 + s * 1.0], { fill: S([150, 156, 170], 255) });
    }
    return alphaComposite(img, over);
  }

  // forklift tracks: two soft darker bands with faint tread ticks
  function forkliftTracks(img, a, b, cell) {
    const over = newImage("RGBA", img.w, img.h), d = new Draw(over);
    const [ax, ay] = centre(a[0], a[1], cell), [bx, by] = centre(b[0], b[1], cell);
    const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L, tw = cell * 0.14;
    for (const side of [-1, 1]) {
      const ox = nx * side * cell * 0.3, oy = ny * side * cell * 0.3;
      d.line([[ax + ox, ay + oy], [bx + ox, by + oy]], [...T.track, 40], Math.trunc(tw));
      for (let t = 0; t < L; t += cell * 0.09) {
        const x = ax + ((bx - ax) * t) / L + ox, y = ay + ((by - ay) * t) / L + oy;
        d.line([[x - nx * tw * 0.45, y - ny * tw * 0.45], [x + nx * tw * 0.45, y + ny * tw * 0.45]], [...T.track2, 46], Math.max(2, Math.trunc(cell * 0.025)));
      }
    }
    return alphaComposite(img, gaussianBlur(over, cell * 0.012));
  }

  // the round lift pad: a steel disc about two hexes across, seen slightly from the south, with a bright rim,
  // two white rings, clamps round the inner ring and a white X in the middle
  function liftPad(img, hexes, cell) {
    const over = newImage("RGBA", img.w, img.h), d = new Draw(over), t = Math.max(2, Math.trunc(cell * 0.014));
    for (const [c, r] of hexes) {
      const [cx, cy] = centre(c, r, cell), R = cell * 1.0, ry = 0.72;
      const ell = (k, dy = 0) => [cx - R * k, cy - R * k * ry + dy, cx + R * k, cy + R * k * ry + dy];
      d.ellipse(ell(1.05, R * 0.04), { fill: S([8, 18, 30], 150) });                  // its shadow on the floor
      d.ellipse(ell(1.03), { fill: S([120, 130, 150], 255) });                        // the rim
      d.ellipse(ell(0.95), { fill: S([48, 54, 72], 255) });                           // the disc
      d.ellipse(ell(0.9), { outline: S([70, 76, 96], 255), width: t });
      for (const [k, wd] of [[0.78, 0.04], [0.52, 0.035]])                          // the white rings
        d.ellipse(ell(k), { outline: S([214, 220, 226], 255), width: Math.max(3, Math.trunc(cell * wd)) });
      for (let i = 0; i < 10; i++) {                                                // clamps round the inner ring
        const a = (2 * Math.PI * i) / 10, px = cx + Math.cos(a) * R * 0.64, py = cy + Math.sin(a) * R * 0.64 * ry, s = cell * 0.025;
        d.rectangle([px - s, py - s, px + s, py + s], { fill: S([34, 38, 52], 255) });
      }
      const x = R * 0.2, xw = Math.max(4, Math.trunc(cell * 0.07));                 // the X
      d.line([[cx - x, cy - x * ry], [cx + x, cy + x * ry]], S([206, 212, 218], 255), xw);
      d.line([[cx - x, cy + x * ry], [cx + x, cy - x * ry]], S([206, 212, 218], 255), xw);
      d.arc(ell(1.03), 15, 165, S([176, 186, 200], 255), Math.max(3, Math.trunc(cell * 0.02)));   // the lit south lip
      d.arc(ell(0.95), 195, 345, S([28, 32, 46], 255), Math.max(3, Math.trunc(cell * 0.03)));     // the shadowed north edge
    }
    return alphaComposite(img, over);
  }

  // blue silo grate lids, about 1.5 hexes across, seen slightly from the south: a cogged rim with tabs, a
  // grating, a hinge, small marks; lids near each other are linked by dark pipes on the floor
  function cogHatch(img, hexes, cell) {
    const over = newImage("RGBA", img.w, img.h), d = new Draw(over), t = Math.max(2, Math.trunc(cell * 0.016)), ry = 0.86;
    const cs = hexes.map(([c, r]) => centre(c, r, cell)), blue = T.hatchBlue, pipe = [22, 24, 32, 255], pw = Math.max(4, Math.trunc(cell * 0.05));
    for (let i = 0; i < cs.length; i++)                                          // links first, under the lids
      for (let j = i + 1; j < cs.length; j++) {
        const [ax, ay] = cs[i], [bx, by] = cs[j];
        if (Math.hypot(bx - ax, by - ay) > cell * 2.2) continue;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        for (const o of [-1, 1]) d.line([[ax, ay + o * cell * 0.12], [mx, ay + o * cell * 0.12], [mx, by + o * cell * 0.12], [bx, by + o * cell * 0.12]], pipe, pw, "curve");
      }
    for (const [cx, cy] of cs) {
      const R = cell * 0.6, lift = cell * 0.05;
      const ell = (k, dy = 0) => [cx - R * k, cy - R * k * ry + dy, cx + R * k, cy + R * k * ry + dy];
      d.ellipse(ell(1.06, R * 0.1), { fill: [...T.pitShadow, 150] });              // its shadow
      for (let k = 0; k < 8; k++) {                                              // the cog tabs
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8, tx = cx + Math.cos(a) * R * 1.0, ty = cy + Math.sin(a) * R * ry;
        d.rectangle([tx - cell * 0.07, ty - cell * 0.05, tx + cell * 0.07, ty + cell * 0.05 + lift], { fill: [...blue.map((v) => v * 0.6), 255] });
        d.rectangle([tx - cell * 0.07, ty - cell * 0.05, tx + cell * 0.07, ty + cell * 0.04], { fill: [...blue.map((v) => v * 0.85), 255] });
      }
      d.ellipse(ell(0.98, lift), { fill: [...blue.map((v) => v * 0.55), 255] });     // the rim's side
      d.ellipse(ell(0.98), { fill: [...blue, 255] });                               // the rim
      d.arc(ell(0.98), 200, 340, [...blue.map((v) => Math.min(255, v * 1.35)), 255], t * 2);   // lit far edge
      d.ellipse(ell(0.74), { fill: [...blue.map((v) => v * 0.7), 255] });            // the grating
      const gs = cell * 0.075, grid = newImage("RGBA", img.w, img.h), gd = new Draw(grid), gc = [...blue.map((v) => v * 0.92), 255], gt = Math.max(3, Math.trunc(cell * 0.022));
      gd.ellipse(ell(0.74), { fill: [...blue.map((v) => v * 0.38), 255] });           // dark below the grating
      for (let x = cx - R * 0.74; x <= cx + R * 0.74; x += gs) gd.line([[x, cy - R * 0.74 * ry], [x, cy + R * 0.74 * ry]], gc, gt);
      for (let y = cy - R * 0.74 * ry; y <= cy + R * 0.74 * ry; y += gs * ry) gd.line([[cx - R * 0.74, y], [cx + R * 0.74, y]], gc, gt);
      const clip = newImage("L", img.w, img.h);                                    // the grating stays inside its circle
      new Draw(clip).ellipse(ell(0.74), { fill: 255 });
      paste(over, grid, clip);
      d.ellipse(ell(0.74), { outline: [...blue.map((v) => v * 0.9), 255], width: t * 2 });
      d.rectangle([cx - cell * 0.1, cy - R * ry - cell * 0.06, cx + cell * 0.1, cy - R * ry + cell * 0.05], { fill: [34, 38, 52, 255] });   // the hinge
      for (let k = 0; k < 3; k++) d.rectangle([cx + R * 0.55 + k * cell * 0.03, cy - R * 0.45 + k * cell * 0.02, cx + R * 0.55 + k * cell * 0.03 + cell * 0.02, cy - R * 0.45 + k * cell * 0.02 + cell * 0.02], { fill: [230, 234, 240, 255] });
      d.rectangle([cx + R * 0.5, cy + R * 0.55, cx + R * 0.58, cy + R * 0.62], { fill: [196, 60, 50, 255] });
    }
    return alphaComposite(img, over);
  }

  // the sunken pipe trench beyond the play area: a dark lower floor, shaded under its north and west walls,
  // big pipes with flanges running east-west, thin pipe pairs, and a steel railing along the edge.
  // The trench settings (all 0 by default, which draws exactly the original) break up its sameness: pit floor
  // detail, pipe variety, cross pipes, machinery, depth and work lamps. Each has its own random stream.
  function trench(img, solid, cell, o = {}) {
    const vary = o.trenchVariety || 0, cross = o.trenchCross || 0, mach = o.trenchMachines || 0;
    const lamps = o.trenchLamps || 0, depth = o.trenchDepth || 0, floorDet = o.trenchFloor || 0;
    const { w, h } = img, m = maskOf([w, h], solid.map(([c, r]) => centre(c, r, cell)), cell);
    const low = newImage("RGBA", w, h), mott = kept("pitNoise", [w, h, cell], () => noise(h, w, cell * 2, 261));
    const lip = newImage("L", w, h);                                            // the open floor, shifted down-right: the walls' shadow
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = Math.trunc(x - cell * 0.14), sy = Math.trunc(y - cell * 0.2);
        lip.data[y * w + x] = sx < 0 || sy < 0 ? 0 : 255 - m.data[sy * w + sx];
      }
    const shade = gaussianBlur(lip, cell * 0.08);
    for (let p = 0; p < w * h; p++) {
      if (!m.data[p]) continue;
      const i = p * 4, v = (mott[p] - 0.5) * 10;
      low.data[i] = u8(T.pit[0] + v); low.data[i + 1] = u8(T.pit[1] + v); low.data[i + 2] = u8(T.pit[2] + v); low.data[i + 3] = 255;
    }
    if (floorDet) pitFloor(low, m, cell, floorDet);
    paste(img, low, m);
    const pipes = newImage("RGBA", w, h);
    let d = new Draw(pipes);
    const tube = (y, r, x0, x1, bright = 1, col = T.pipe) => {                  // a round pipe: shaded across, lit from the north
      for (let k = -r; k < r; k++) {
        const u = (k + 0.5) / r, lit = Math.sqrt(Math.max(0, 1 - u * u)) * 0.75 + (u < 0 ? -u * 0.35 : -u * 0.45) + 0.15;
        d.line([[x0, y + k], [x1, y + k]], [0, 1, 2].map((c) => u8(col[c] + T.pipeLit[c] * lit * bright)).concat(255), 1);
      }
    };
    const tubeV = (x, r, y0, y1, bright = 1, col = T.pipe) => {                 // the same running north-south, lit from the west
      for (let k = -r; k < r; k++) {
        const u = (k + 0.5) / r, lit = Math.sqrt(Math.max(0, 1 - u * u)) * 0.75 + (u < 0 ? -u * 0.35 : -u * 0.45) + 0.15;
        d.line([[x + k, y0], [x + k, y1]], [0, 1, 2].map((c) => u8(col[c] + T.pipeLit[c] * lit * bright)).concat(255), 1);
      }
    };
    const flangeAt = (x, y, pr, vert = false) => {
      const fw = cell * 0.1;
      if (!vert) {
        for (let k = 0; k < fw; k++) d.line([[x + k, y - pr * 1.25], [x + k, y + pr * 1.25]], [0, 1, 2].map((c) => u8(T.flange[c] + (k / fw) * [30, 30, 26][c])).concat(255), 1);
        d.rectangle([x, y - pr * 1.25, x + fw, y + pr * 1.25], { outline: [...T.flangeLine, 255], width: 2 });
      } else {
        for (let k = 0; k < fw; k++) d.line([[x - pr * 1.25, y + k], [x + pr * 1.25, y + k]], [0, 1, 2].map((c) => u8(T.flange[c] + (1 - k / fw) * [30, 30, 26][c])).concat(255), 1);
        d.rectangle([x - pr * 1.25, y, x + pr * 1.25, y + fw], { outline: [...T.flangeLine, 255], width: 2 });
      }
    };
    // a pipe bending down out of sight: the end rounds over and darkens as it turns away, a flange at the bend
    const elbow = (xe, y, pr, dir, col) => {
      for (let k = -pr; k < pr; k++) {
        const u = (k + 0.5) / pr, hw = pr * 0.6 * Math.sqrt(Math.max(0, 1 - u * u));
        const lit = (Math.sqrt(Math.max(0, 1 - u * u)) * 0.75 + (u < 0 ? -u * 0.35 : -u * 0.45) + 0.15) * 0.55;
        d.line([[xe, y + k], [xe + dir * hw, y + k]], [0, 1, 2].map((c) => u8(col[c] * 0.8 + T.pipeLit[c] * lit)).concat(255), 1);
      }
      d.ellipse([xe + dir * pr * 0.1 - pr * 0.18, y - pr * 0.5, xe + dir * pr * 0.1 + pr * 0.18, y + pr * 0.9], { fill: [...T.pitShadow, 120] });
      flangeAt(dir > 0 ? xe - cell * 0.1 : xe, y, pr);
    };
    // a valve body (a handwheel on top) or a pump (vent slats) set in the run, the pipe entering both sides
    const inline = (gx0, gx1, y, pr, kind) => {
      const x0 = gx0 - cell * 0.06, x1 = gx1 + cell * 0.06, hh = pr * 1.45, face = cell * 0.07;
      const body = T.flange.map((c) => c * (kind === "pump" ? 0.9 : 1.05)), top = body.map((c) => Math.min(255, c * 1.3)), side = body.map((c) => c * 0.55);
      d.rectangle([x0 + cell * 0.04, y - hh + cell * 0.06, x1 + cell * 0.06, y + hh + face + cell * 0.06], { fill: [...T.pitShadow, 190] });
      d.rectangle([x0, y + hh, x1, y + hh + face], { fill: [...side, 255] });
      d.rectangle([x0, y - hh, x1, y + hh], { fill: [...top, 255], outline: [...T.flangeLine, 255], width: 2 });
      const cx = (x0 + x1) / 2;
      if (kind === "valve") {
        const R = Math.min(hh * 0.85, (x1 - x0) * 0.42), lw = Math.max(2, Math.trunc(cell * 0.02));
        d.ellipse([cx - R + 2, y - R + 3, cx + R + 2, y + R + 3], { outline: [...T.pitShadow, 200], width: lw });
        d.ellipse([cx - R, y - R, cx + R, y + R], { outline: [196, 64, 48, 255], width: lw });            // a red handwheel
        for (let a = 0; a < 3; a++) { const t = (a * Math.PI) / 3; d.line([[cx - Math.cos(t) * R, y - Math.sin(t) * R], [cx + Math.cos(t) * R, y + Math.sin(t) * R]], [150, 52, 40, 255], Math.max(1, lw - 1)); }
        d.ellipse([cx - R * 0.2, y - R * 0.2, cx + R * 0.2, y + R * 0.2], { fill: [...side, 255] });
      } else {
        for (let x = x0 + cell * 0.06; x < x1 - cell * 0.04; x += cell * 0.055) d.line([[x, y - hh * 0.7], [x, y + hh * 0.7]], [...side, 255], 2);
        d.ellipse([x1 - cell * 0.09, y + hh + face * 0.3, x1 - cell * 0.05, y + hh + face * 0.7], { fill: [90, 255, 120, 255] });   // its run light
      }
    };
    const vr = new PyRandom(281), parts = connectedParts(solid, cell);
    for (const part of parts) {
      const ys = part.map(([c, r]) => centre(c, r, cell)[1]), xs = part.map(([c, r]) => centre(c, r, cell)[0]);
      const top = Math.min(...ys) - cell * 0.3, bot = Math.max(...ys) + cell * 0.3, left = Math.min(...xs) - cell, right = Math.max(...xs) + cell;
      const pr0 = cell * 0.2;
      for (let y0 = top + cell * 0.6; y0 < bot - cell * 0.3; y0 += cell * 1.3) {   // big pipes, east-west
        // variety: each row its own size, offset and tint, sometimes a second big pipe, runs broken into lengths
        const k1 = vr.uniform(0.55, 1.45), k2 = vr.uniform(-0.35, 0.35), k3 = vr.uniform(0.75, 1.3), twin = vr.random() < 0.3, thin = vr.random() < 0.65;
        const breaks = [], gaps = [];                                          // runs wall to wall, broken only by a reason
        for (let x = left; x < right;) {
          let x1 = x + cell * vr.uniform(1.8, 4.6);
          if (x1 > right - cell * 1.2) x1 = right;
          breaks.push([x, x1]);
          if (x1 >= right) break;
          const g = cell * vr.uniform(0.45, 0.85), kind = vr.random() < 0.6 ? (vr.random() < 0.5 ? "valve" : "pump") : "dive";
          gaps.push([x1, x1 + g, kind]);
          x = x1 + g;
        }
        const pr = pr0 * lerp(1, k1, vary), y = y0 + k2 * cell * vary, col = T.pipe.map((c) => c * lerp(1, k3, vary));
        const runs = vary > 0.5 ? breaks : [[left, right]];
        for (const [x0, x1] of runs) {
          d.rectangle([x0, y + pr * 0.4, x1, y + pr * 1.5], { fill: [...T.pitShadow, 180] });   // shadow under it
          tube(y, pr, x0, x1, 1, col);
          if (runs.length > 1) for (const [gx0, gx1, kind] of gaps) if (kind === "dive") {   // both ends bend down into the pit floor
            if (Math.abs(gx0 - x1) < 1) elbow(x1, y, pr, 1, col);
            if (Math.abs(gx1 - x0) < 1) elbow(x0, y, pr, -1, col);
          }
          const fstep = cell * lerp(2.4, vr.uniform(1.2, 3.2), vary);
          for (let x = x0 + cell * lerp(0.8, vr.uniform(0.3, 1.2), vary); x < x1; x += fstep) flangeAt(x, y, pr);
        }
        if (runs.length > 1) for (const [gx0, gx1, kind] of gaps) if (kind !== "dive") inline(gx0, gx1, y, pr, kind);
        if (twin && vary) { const ty = y - pr * 2.6 * vary; tube(ty, pr * 0.7, left, right, 0.9, col.map((c) => c * 0.9)); }
        if (!vary || thin) {
          const ty = y + cell * 0.52 * lerp(1, k1 * 0.9, vary);                    // a thin pipe pair beside it
          for (const oy of [0, cell * 0.1]) tube(ty + oy, Math.max(2, Math.trunc(cell * 0.03)), left, right, 0.8);
        }
      }
      if (cross) {                                                              // north-south pipes over the others
        const cr = new PyRandom(291 + part.length), n = Math.round(((right - left) / (cell * 4)) * cross);
        for (let i = 0; i < n; i++) {
          const x = cr.uniform(left + cell, right - cell), r = cell * cr.uniform(0.09, 0.17), y0 = cr.uniform(top, top + cell), y1 = cr.uniform(bot - cell, bot);
          d.rectangle([x + r * 0.4, y0, x + r * 1.6, y1], { fill: [...T.pitShadow, 170] });
          tubeV(x, r, y0, y1, 1.05, T.pipe.map((c) => c * 1.1));
          for (let y = y0 + cell * cr.uniform(0.3, 1); y < y1; y += cell * cr.uniform(1.5, 3)) flangeAt(x, y, r, true);
        }
      }
    }
    for (let p = 0; p < w * h; p++) if (!m.data[p]) pipes.data[p * 4 + 3] = 0;     // the pipes run into the walls
    img = alphaComposite(img, pipes);
    if (mach) img = machinery(img, m, solid, cell, mach);
    for (let p = 0; p < w * h; p++) {                                           // the walls' shadow over floor and pipes
      if (!m.data[p]) continue;
      const k = 1 - (shade.data[p] / 255) * 0.6;
      for (let c = 0; c < 3; c++) img.data[p * 4 + c] = u8(img.data[p * 4 + c] * k);
    }
    if (depth) {                                                                // deeper in, darker: far from the open floor the pit falls away
      const near = gaussianBlur(lip, cell * 1.4);
      for (let p = 0; p < w * h; p++) {
        if (!m.data[p]) continue;
        const k = 1 - Math.min(0.85, depth * 0.6 * (1 - Math.min(1, near.data[p] / 110)));
        for (let c = 0; c < 3; c++) img.data[p * 4 + c] = u8(img.data[p * 4 + c] * k);
      }
    }
    if (lamps) img = workLamps(img, m, solid, cell, lamps);
    d = new Draw(img);
    const rail = [...T.rail, 255], dark = [...T.railDark, 255], lw = Math.max(3, Math.trunc(cell * 0.03));
    for (const [a, b] of zoneEdges(solid, cell)) {                             // the railing, on the edge facing open floor
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const [ccx, ccy] = centre(...nearestSolid(solid, mx, my, cell), cell);
      const nx = mx - ccx, ny = my - ccy, L = Math.hypot(nx, ny) || 1;
      if (mx + nx < 0 || my + ny < 0 || mx + nx > w || my + ny > h) continue;   // the neighbour is off the map: no railing
      const off = [(nx / L) * cell * 0.03, (ny / L) * cell * 0.03];
      const pa = [a[0] - off[0], a[1] - off[1]], pb = [b[0] - off[0], b[1] - off[1]];
      d.line([[pa[0] + cell * 0.03, pa[1] + cell * 0.05], [pb[0] + cell * 0.03, pb[1] + cell * 0.05]], [...T.railShadow, 200], lw);   // its shadow
      d.line([pa, pb], dark, lw + 2);
      d.line([pa, pb], rail, lw - 1);
      const n = Math.max(1, Math.round(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / (cell * 0.3)));
      for (let k = 0; k <= n; k++) {                                            // posts
        const t = k / n, x = pa[0] + (pb[0] - pa[0]) * t, y = pa[1] + (pb[1] - pa[1]) * t, s = cell * 0.028;
        d.rectangle([x - s, y - s, x + s, y + s], { fill: dark });
        d.rectangle([x - s * 0.5, y - s * 0.5, x + s * 0.4, y + s * 0.4], { fill: [...T.railLit, 255] });
      }
    }
    return img;
  }

  // the pit floor: grating panels, cable runs snaking along it, dark puddles with a glint
  function pitFloor(low, m, cell, amt) {
    const { w, h } = low, d = new Draw(low), r = new PyRandom(301), P = cell * 0.62;
    const line = [...T.pit.map((c) => c * 0.55), 255], barLit = [...T.pit.map((c) => Math.min(255, c * 1.35)), 255];
    const keepG = keeper(301, amt);
    let i = 0;
    for (let y = 0; y < h; y += P) for (let x = (Math.round(y / P) % 2) * P * 0.5; x < w; x += P) {   // grating panels in two patterns
      if (!keepG(i++)) continue;
      const my = Math.min(h - 1, Math.trunc(y + P / 2)), mx = Math.min(w - 1, Math.trunc(x + P / 2));
      if (!m.data[my * w + mx]) continue;
      d.rectangle([x + 2, y + 2, x + P - 2, y + P - 2], { outline: line, width: 2 });
      if ((Math.floor(x / P) + Math.floor(y / P)) % 3 === 0) for (let k = x + P * 0.15; k < x + P - 4; k += P * 0.14) d.line([[k, y + 5], [k, y + P - 5]], line, 2);
      else for (let k = y + P * 0.2; k < y + P - 4; k += P * 0.2) { d.line([[x + 5, k], [x + P - 5, k]], line, 2); d.line([[x + 5, k - 2], [x + P - 5, k - 2]], barLit, 1); }
    }
    const n = Math.round((w * h) / (cell * cell) / 6 * amt);
    for (let k = 0; k < n; k++) {                                              // cable runs
      let x = r.uniform(0, w), y = r.uniform(0, h), a = r.choice([0, Math.PI]) + r.uniform(-0.3, 0.3);
      const pts = [[x, y]];
      for (let s = 0; s < cell * r.uniform(2, 5); s += cell * 0.1) { a += r.uniform(-0.2, 0.2); x += Math.cos(a) * cell * 0.1; y += Math.sin(a) * cell * 0.1; pts.push([x, y]); }
      const col = r.choice([[16, 16, 18], [60, 24, 20], [24, 30, 20], [70, 60, 20]]);
      d.line(pts, [...col, 255], Math.max(3, Math.trunc(cell * 0.025)));
      d.line(pts.map(([px, py]) => [px - 1, py - 1]), [...col.map((c) => c + 40), 255], 1);
    }
    for (let k = 0; k < n; k++) {                                              // puddles
      const x = r.uniform(0, w), y = r.uniform(0, h), rx = cell * r.uniform(0.2, 0.6), ry = rx * r.uniform(0.4, 0.7);
      d.ellipse([x - rx, y - ry, x + rx, y + ry], { fill: [...T.pit.map((c) => c * 0.45), 255] });
      d.ellipse([x - rx * 0.5, y - ry * 0.6, x + rx * 0.1, y - ry * 0.3], { fill: [...T.pit.map((c) => Math.min(255, c * 1.6)), 120] });
    }
  }

  // machinery standing in the pit: pumps, tanks and junction boxes over the pipes, each with a lit top, a
  // dark south face, vents or a hatch, bolts, a hazard edge and an indicator light
  function machinery(img, m, solid, cell, amt) {
    const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), r = new PyRandom(311);
    const spots = solid.filter(() => r.random() < 0.12 * amt);
    for (const [c, rr] of spots) {
      const [cx, cy] = centre(c, rr, cell), kind = r.randint(0, 2), bw = cell * r.uniform(0.45, 0.8), bh = cell * r.uniform(0.35, 0.6), H = cell * r.uniform(0.12, 0.25);
      const body = T.flange.map((v) => v * r.uniform(0.8, 1.15)), topC = body.map((v) => Math.min(255, v * 1.3)), side = body.map((v) => v * 0.55);
      d.rectangle([cx - bw / 2 + cell * 0.06, cy - bh / 2 + cell * 0.1, cx + bw / 2 + cell * 0.1, cy + bh / 2 + H + cell * 0.1], { fill: [...T.pitShadow, 200] });   // shadow
      if (kind === 2) {                                                        // a tank: a lit disc on a dark drum
        const R = Math.min(bw, bh) * 0.6;
        d.rectangle([cx - R, cy, cx + R, cy + H], { fill: [...side, 255] });
        d.ellipse([cx - R, cy + H - R * 0.5, cx + R, cy + H + R * 0.5], { fill: [...side, 255] });
        d.ellipse([cx - R, cy - R * 0.5, cx + R, cy + R * 0.5], { fill: [...topC, 255], outline: [...T.flangeLine, 255], width: 2 });
        d.ellipse([cx - R * 0.3, cy - R * 0.18, cx + R * 0.3, cy + R * 0.18], { outline: [...body, 255], width: 2 });
      } else {
        d.rectangle([cx - bw / 2, cy + bh / 2, cx + bw / 2, cy + bh / 2 + H], { fill: [...side, 255] });   // south face
        d.rectangle([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], { fill: [...topC, 255], outline: [...T.flangeLine, 255], width: 2 });
        if (kind === 0) for (let x = cx - bw * 0.35; x < cx + bw * 0.35; x += cell * 0.06) d.line([[x, cy - bh * 0.3], [x, cy + bh * 0.3]], [...side, 255], 2);   // vents
        else { d.rectangle([cx - bw * 0.3, cy - bh * 0.3, cx + bw * 0.3, cy + bh * 0.3], { outline: [...side, 255], width: 2 }); d.line([[cx - bw / 2, cy + bh / 2 + 2], [cx + bw / 2, cy + bh / 2 + 2]], [196, 160, 50, 255], 3); }
        for (const [bx, by] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) d.ellipse([cx + bx * bw * 0.42 - 2, cy + by * bh * 0.4 - 2, cx + bx * bw * 0.42 + 2, cy + by * bh * 0.4 + 2], { fill: [...side, 255] });
      }
      const led = r.choice([[90, 255, 120], [255, 170, 60], [255, 70, 50]]);
      d.ellipse([cx + bw * 0.3 - 3, cy + bh / 2 + H * 0.4 - 3, cx + bw * 0.3 + 3, cy + bh / 2 + H * 0.4 + 3], { fill: [...led, 255] });
    }
    for (let p = 0; p < w * h; p++) if (!m.data[p]) over.data[p * 4 + 3] = 0;
    return alphaComposite(img, over);
  }

  // work lamps on the trench walls: fittings along each wall that faces the open floor, spaced evenly (the
  // slider sets how close), each throwing a bright pool of light down into the pit away from its wall. The
  // light adds colour, so it shows even where the pit is darkest.
  function workLamps(img, m, solid, cell, amt) {
    const { w, h } = img, col = T.lamp || [255, 206, 140], spacing = cell * 2.6 / Math.max(0.3, amt);
    const glow = newImage("L", w, h), gd = new Draw(glow), lamps = [];
    const edges = zoneEdges(solid, cell).map(([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
    for (const [mx, my] of edges) {
      const [ccx, ccy] = centre(...nearestSolid(solid, mx, my, cell), cell);
      let nx = ccx - mx, ny = ccy - my;                                          // into the pit
      const L = Math.hypot(nx, ny) || 1;
      nx /= L; ny /= L;
      if (mx - nx * cell < 0 || my - ny * cell < 0 || mx - nx * cell > w || my - ny * cell > h) continue;   // a wall on the map's edge
      if (lamps.some(([x, y]) => Math.hypot(x - mx, y - my) < spacing)) continue;
      lamps.push([mx + nx * cell * 0.1, my + ny * cell * 0.1, nx, ny]);
    }
    const blob = (x, y, nx, ny, along, across, v) => {                           // an ellipse along the light's direction
      const pts = [];
      for (let k = 0; k < 24; k++) { const t = (k / 24) * 2 * Math.PI, u = Math.cos(t) * along, q = Math.sin(t) * across; pts.push([x + nx * u - ny * q, y + ny * u + nx * q]); }
      gd.polygon(pts, v);
    };
    for (const [x, y, nx, ny] of lamps) {
      blob(x + nx * cell * 0.9, y + ny * cell * 0.9, nx, ny, cell * 1.0, cell * 0.75, 110);   // the pool on the pipes below
      blob(x + nx * cell * 0.45, y + ny * cell * 0.45, nx, ny, cell * 0.5, cell * 0.38, 200);
      blob(x + nx * cell * 0.12, y + ny * cell * 0.12, nx, ny, cell * 0.16, cell * 0.16, 255);
    }
    const soft = gaussianBlur(glow, cell * 0.22);
    for (let p = 0; p < w * h; p++) {
      if (!m.data[p] || !soft.data[p]) continue;
      const a = soft.data[p] / 255;
      for (let c = 0; c < 3; c++) img.data[p * 4 + c] = u8(img.data[p * 4 + c] * (1 + a * 1.6) + col[c] * a * a * 0.35);
    }
    const d = new Draw(img);
    for (const [x, y, nx, ny] of lamps) {                                        // the fitting: a dark caged housing, a bright lens
      const px = -ny, py = nx, s = cell * 0.13, t = cell * 0.07;
      const quad = (u0, u1, v0, v1) => [[x + nx * u0 + px * v0, y + ny * u0 + py * v0], [x + nx * u1 + px * v0, y + ny * u1 + py * v0], [x + nx * u1 + px * v1, y + ny * u1 + py * v1], [x + nx * u0 + px * v1, y + ny * u0 + py * v1]];
      d.polygon(quad(-t, t, -s, s), [22, 22, 24, 255]);
      d.polygon(quad(0, t * 0.8, -s * 0.75, s * 0.75), [...col, 255]);
      d.polygon(quad(t * 0.1, t * 0.5, -s * 0.5, s * 0.5), [255, 250, 235, 255]);
      for (const v of [-s * 0.4, 0, s * 0.4]) d.line([[x + nx * t * 0.8 + px * v, y + ny * t * 0.8 + py * v], [x + px * v, y + py * v]], [30, 30, 32, 255], 2);   // the cage
    }
    return img;
  }


  function nearestSolid(solid, x, y, cell) {
    let best = solid[0], bd = Infinity;
    for (const s of solid) { const [cx, cy] = centre(s[0], s[1], cell), dd = (cx - x) ** 2 + (cy - y) ** 2; if (dd < bd) { bd = dd; best = s; } }
    return best;
  }

  // cold fog: dark drifting patches, a pale mist here and there, and a strong vignette
  function atmosphere(img, cell, o) {
    const { w, h } = img, [cloud, veil, mist] = kept("fog", [w, h, cell], () => [noise(h, w, cell * 5, 271), noise(h, w, cell * 2.2, 272), noise(h, w, cell * 3.5, 273)]);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x, i = p * 4;
        const c = clamp((cloud[p] - 0.56) * 3.2) * clamp(veil[p] * 1.6 - 0.2) * 0.4 * o.fog;
        const ms = clamp((mist[p] - 0.64) * 4) * 0.12 * o.fog;
        const nx = (x - w / 2) / (w / 2), ny = (y - h / 2) / (h / 2);
        const vig = 1 - clamp((nx * nx * 0.24 + ny * ny * 0.3 - 0.05) * o.vignette, 0, 0.45);
        for (let k = 0; k < 3; k++) {
          const v = img.data[i + k] * (1 - c) + FOG[k] * c;
          img.data[i + k] = u8((v * (1 - ms) + T.mist[k] * ms) * vig);
        }
      }
    return img;
  }

  // --- the base map -----------------------------------------------------------------------------------------

  const decals = ["hazard_border", "blast", "scorch", "tracks", "hazard_ring", "floor_hatch"];
  const settings = [
    { id: "light", label: "Light pools and shade", group: "Ground", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
    { id: "maze", label: "Maze floor pattern", group: "Ground", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
    { id: "markings", label: "Bay lines, stripes, stencils", group: "Paint", type: "range", min: 0, max: 1, step: 0.05, default: 1 },
    { id: "pads", label: T.padLabel, group: "Paint", type: "range", min: 0, max: 1, step: 0.05, default: 1 },
    { id: "grilles", label: "Loose slat grilles", group: "Paint", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
    { id: "chalk", label: "Chalk numbers", group: "Paint", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
    { id: "paper", label: "Paper scraps", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
    { id: "debris", label: "Flecks and chips", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
    { id: "casings", label: "Spent casings", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
    { id: "scuffs", label: "Scuffed patches", group: "Clutter", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
    { id: "remains", label: "Robot remains (oil splats)", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 0 },
    { id: "fog", label: "Fog", group: "Atmosphere", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
    { id: "vignette", label: "Vignette", group: "Atmosphere", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
    ...(T.settings || []),
    { id: "trenchFloor", label: "Pit floor detail", group: "Solid structure", type: "range", min: 0, max: 1, step: 0.05, default: 0 },
    { id: "trenchVariety", label: "Pipe variety", group: "Solid structure", type: "range", min: 0, max: 1, step: 0.05, default: 0 },
    { id: "trenchCross", label: "Cross pipes", group: "Solid structure", type: "range", min: 0, max: 2, step: 0.05, default: 0 },
    { id: "trenchMachines", label: "Machinery", group: "Solid structure", type: "range", min: 0, max: 2, step: 0.05, default: 0 },
    { id: "trenchDepth", label: "Pit depth (darker inward)", group: "Solid structure", type: "range", min: 0, max: 1.5, step: 0.05, default: 0 },
    { id: "trenchLamps", label: "Work lamps", group: "Solid structure", type: "range", min: 0, max: 2, step: 0.05, default: 0 },
    ...ZONE_SETTINGS,
  ].filter((st) => st.id !== "maze" || T.mazeAlpha);

  // Kept between renders in the same worker (the Map Maker's): the layers an edit of decals or solid
  // structure can't change. One entry per layer, keyed by the map size and the settings it depends on, so
  // the pixels are exactly those of a full redraw. The floor with its paint is most of the time.
  const store = {};
  function kept(name, key, make) {
    const k = JSON.stringify(key);
    if (store[name]?.k !== k) { store[name] = null; store[name] = { k, v: make() }; }
    return store[name].v;
  }
  const LATER = new Set(["paper", "debris", "casings", "scuffs", "remains", "fog", "vignette", "zones", "labels",
    "trenchFloor", "trenchVariety", "trenchCross", "trenchMachines", "trenchDepth", "trenchLamps"]);

  function render(data, cell, opts = {}) {
    const o = withDefaults(settings, opts);
    const [w, h] = imageSize(data.cols, data.rows, cell);
    const zones = data.zones || {};
    const base = kept("base", [w, h, cell, Object.entries(o).filter(([k]) => !LATER.has(k))], () => {
      let im = ground([w, h], cell, o);
      if (T.mazeAlpha) im = maze(im, cell, o.maze, PALE, T.mazeAlpha);
      im = paint(im, cell, o);
      im = pads(im, cell, o);
      im = grilles(im, cell, o);
      if (T.settings?.some((st) => st.id === "manholes")) im = manholes(im, cell, o);
      return im;
    });
    let img = cloneImage(base);
    const blasts = [];
    (data.decals || []).forEach((dec) => {
      const kind = dec.type, hexes = dec.hexes || (dec.zone && zones[dec.zone] ? zones[dec.zone].hexes : []);
      if (kind === "hazard_border") for (const part of connectedParts(hexes, cell)) img = steelPlate(img, part, cell);   // one plate per painted group
      else if (kind === "blast" || kind === "scorch") for (const [c, r] of hexes) blasts.push(centre(c, r, cell));   // drawn with the remains
      else if (kind === "tracks") img = forkliftTracks(img, dec.from, dec.to, cell);
      else if (kind === "hazard_ring") img = decalHazardRing(img, hexes, cell);
      else if (kind === "floor_hatch") img = T.hatch === "cog" ? cogHatch(img, hexes, cell) : liftPad(img, hexes, cell);
    });
    img = remains(img, cell, o.remains, REMAINS, blasts);
    img = litter(img, cell, o);
    const solid = Object.entries(data.terrain || {}).filter(([, v]) => v === "obstruction").map(([k]) => k.split(",").map(Number));
    if (solid.length) img = trench(img, solid, cell, o);
    img = atmosphere(img, cell, o);
    return drawAllZones(img, zones, cell, o);
  }
  return { name: T.name, blurb: T.blurb, terrainNote: T.terrainNote, decals, settings, render };
}

export const { name, blurb, terrainNote, decals, settings, render } = makeStyle(DEPOT);

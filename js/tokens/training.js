// Training Floor tokens (names start tf_), after Synthetik's Training Floor: orange gas cylinders, tarp-covered and
// camo-netted stacks, concrete dragon's teeth, hex posts and blocks, the radar dish, yellow pipe racks,
// black palisade fence, tyres and big wheels, pallets, the blue WPN crate, supply boxes, the long white
// tent, the camo-netted APC, concrete panel stacks. Reference: _backstage/reference/synthetik/training_floor/.
//
// Drawn like the rest of the kit: from above with the near (south) face showing, the kit's shadow
// (down-right, so sets mix on one map), colours warmed to sit on the Training Floor's orange floor.

import { PyRandom } from "../rng.js?v=0f282507bd";
import { newImage, Draw, alphaComposite, alphaCompositeAt, paste } from "../raster.js?v=0f282507bd";
import { geometry } from "../maps/geometry.js?v=0f282507bd";
import { tokenCanvas, grime, size2Footprint, clipToHex } from "./kit.js?v=0f282507bd";
import { groundShadow } from "./shadow.js?v=0f282507bd";

const withShadow = (obj, cell) => groundShadow(obj, cell);                      // stood on the floor (shadow.js), not the kit's offset copy

const T = Math.trunc;
const sh = (c, k) => c.map((v) => Math.max(0, Math.min(255, T(v * k))));
const A = (c, a = 255) => [...c, a];

const ORANGE = [210, 86, 52], GREYCYL = [158, 148, 142], CAP = [62, 54, 54];
const TARP = [74, 54, 50], CAMO = [[106, 128, 60], [78, 98, 48], [158, 138, 84], [122, 86, 56], [138, 156, 76], [184, 120, 64]];
const CONCRETE = [200, 190, 180], CONCRETE_SIDE = [142, 124, 116];
const PIPE = [228, 178, 76], FRAME = [44, 36, 36];
const FENCE = [42, 34, 34];
const RUBBER = [52, 44, 44], HUB = [206, 150, 58];
const WOOD = [178, 134, 98];
const CANVAS = [214, 202, 188];
const APC = [172, 158, 148];
const STRAP = [70, 112, 152];

// the object's layer, its canvas and the hex centres
function layerFor(cell, fp = [[0, 0]]) {
  const { img, cs } = tokenCanvas(cell, fp);
  const lay = newImage("RGBA", img.w, img.h);
  return [lay, new Draw(lay), cs];
}

// a box seen from above with its south face: top [x0, y0 - h .. x1, y1 - h], face below it
function box(d, x0, y0, x1, y1, h, top, side, rim = null) {
  d.rectangle([x0, y1 - h, x1, y1], { fill: A(side) });
  d.rectangle([x0, y0 - h, x1, y1 - h], { fill: A(top) });
  if (rim) d.line([[x0, y1 - h], [x1, y1 - h]], A(rim), 2);
}

// camouflage netting: blotches in greens and browns, clipped to a mask, with a fine net grid
function camo(lay, maskPoly, seed, cell) {
  const w = lay.w, h = lay.h, net = newImage("RGBA", w, h), d = new Draw(net), r = new PyRandom(seed);
  const xs = maskPoly.map((p) => p[0]), ys = maskPoly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  d.rectangle([x0, y0, x1, y1], { fill: A([66, 74, 44]) });                     // the net's own dark olive
  for (let i = T(((x1 - x0) * (y1 - y0)) / (cell * cell) * 700); i > 0; i--) {   // leaves: a dense cover
    const x = r.uniform(x0, x1), y = r.uniform(y0, y1), s = cell * r.uniform(0.018, 0.05), q = [];
    for (let k = r.randint(4, 6); k > 0; k--) { const px = x + r.uniform(-s, s); q.push([px, y + r.uniform(-s, s)]); }
    d.polygon(q, A(r.choice(CAMO), 250));
  }
  for (let x = x0; x < x1; x += cell * 0.05) d.line([[x, y0], [x, y1]], [34, 38, 26, 30], 1);   // the net
  for (let y = y0; y < y1; y += cell * 0.05) d.line([[x0, y], [x1, y]], [34, 38, 26, 30], 1);
  const m = newImage("L", w, h);
  new Draw(m).polygon(maskPoly, 255);
  const out = newImage("RGBA", w, h);
  paste(out, net, m);
  return alphaCompositeAt(lay, out);
}

// --- gas cylinders ---------------------------------------------------------------------------------------

function cylinder(d, x, y, r, hgt, body) {
  const hi = sh(body, 1.16), lo = sh(body, 0.72);
  d.roundedRectangle([x - r, y - hgt, x + r, y + r * 0.6], r * 0.9, { fill: A(lo) });              // the side, seen from the south
  d.rectangle([x - r * 0.72, y - hgt + r * 0.2, x - r * 0.25, y + r * 0.2], { fill: A(hi) });       // a lit stripe
  d.rectangle([x - r, y - hgt * 0.35, x + r, y - hgt * 0.22], { fill: A([72, 118, 172]) });         // the blue label band
  d.rectangle([x - r, y - hgt * 0.64, x + r, y - hgt * 0.58], { fill: A(sh(body, 0.55)) });
  d.ellipse([x - r, y - hgt - r * 0.85, x + r, y - hgt + r * 0.85], { fill: A(body) });            // the top
  d.ellipse([x - r * 0.72, y - hgt - r * 0.6, x + r * 0.72, y - hgt + r * 0.6], { fill: A(CAP) }); // the cap
  d.ellipse([x - r * 0.46, y - hgt - r * 0.38, x + r * 0.46, y - hgt + r * 0.38], { outline: A([140, 132, 128]), width: 2 });
  d.ellipse([x - r * 0.16, y - hgt - r * 0.14, x + r * 0.16, y - hgt + r * 0.14], { fill: A([30, 26, 26]) });
}

function tokenCylinders(cell, seed = 0) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0], r = new PyRandom(900 + seed);
  const spots = [[[-0.2, -0.05], [0.17, -0.12], [0.02, 0.24]], [[-0.24, 0.02], [0.0, -0.16], [0.23, 0.0], [0.05, 0.25]], [[-0.12, 0.1], [0.16, 0.12]]][seed % 3];
  spots.sort((a, b) => a[1] - b[1]);
  for (const [ox, oy] of spots) {
    const body = r.random() < 0.8 ? sh(ORANGE, r.uniform(0.94, 1.06)) : GREYCYL;
    cylinder(d, cx + ox * cell, cy + oy * cell + cell * 0.12, cell * r.uniform(0.1, 0.12), cell * r.uniform(0.3, 0.38), body);
  }
  return withShadow(grime(lay, cell, 910 + seed, 0.12), cell);
}

// --- soft shapes: a height map, lit and projected -----------------------------------------------------------

// separable box blur (3 passes ~ Gaussian) on a Float32 field, edges clamped
export function fblur(src, w, h, rad) {
  let a = Float32Array.from(src), b = new Float32Array(w * h);
  const r = Math.max(1, Math.round(rad)), n = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[y * w + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        b[y * w + x] = acc / n;
        acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += b[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / n;
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

// Light a height field (z in px) from the top-left, with an optional glossy highlight, and project it
// as seen slightly from the south (a point of height z shows k*z px higher). Drawn south to north with
// a y-buffer, so near surfaces hide far ones and the draped sides show. colour(p) -> [r, g, b].
function shadeField(w, h, z, colour, { gloss = 0, k = 0.75 } = {}) {
  const out = newImage("RGBA", w, h), ybuf = new Float32Array(w).fill(Infinity);
  const L = (() => { const v = [-0.55, -0.75, 0.9], m = Math.hypot(...v); return v.map((c) => c / m); })();
  const H = (() => { const v = [L[0], L[1] + 0.55, L[2] + 0.85], m = Math.hypot(...v); return v.map((c) => c / m); })();
  for (let y = h - 1; y >= 0; y--)
    for (let x = 0; x < w; x++) {
      const p = y * w + x, zz = z[p];
      if (zz <= 0.2) continue;
      const sy = Math.round(y - zz * k);
      if (sy >= ybuf[x]) continue;
      const zx = (z[y * w + Math.min(w - 1, x + 1)] - z[y * w + Math.max(0, x - 1)]) / 2;
      const zy = (z[Math.min(h - 1, y + 1) * w + x] - z[Math.max(0, y - 1) * w + x]) / 2;
      const nm = Math.hypot(zx, zy, 1), nx = -zx / nm, ny = -zy / nm, nz = 1 / nm;
      const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const spec = gloss ? Math.pow(Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]), 28) * gloss : 0;
      const c = colour(p), light = 0.32 + 0.82 * diff;
      const px = [0, 1, 2].map((i) => Math.min(255, c[i] * light + spec * 190));
      for (let yy = Math.max(0, sy); yy < Math.min(h, ybuf[x], y + 1); yy++) {        // down to its own foot at most
        const q = (yy * w + x) * 4;
        out.data[q] = px[0]; out.data[q + 1] = px[1]; out.data[q + 2] = px[2]; out.data[q + 3] = 255;
      }
      ybuf[x] = sy;
    }
  return out;
}

// --- tarp-covered stacks -------------------------------------------------------------------------------------

// A plastic tarp over stacked crates: the crates' heights, smoothed and bridged into a drape, a skirt with
// a wavy hem on the ground, hanging folds on the sides; lit, glossy, and (netted) camo on the tops.
function tokenTarp(cell, netted = false, seed = 0) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), w = img.w, h = img.h, [cx, cy0] = cs[0], cy = cy0 + cell * 0.1;
  const r = new PyRandom(920 + seed);
  const crates = [
    [[-0.32, -0.26, 0.02, 0.02, 0.24], [0.02, -0.26, 0.32, 0.02, 0.2], [-0.32, 0.02, 0.32, 0.26, 0.22], [-0.24, -0.2, 0.08, 0.0, 0.34]],
    [[-0.32, -0.24, 0.32, 0.26, 0.2], [0.0, -0.22, 0.3, 0.1, 0.33], [-0.3, 0.02, -0.02, 0.24, 0.27]],
    [[-0.3, -0.26, 0.3, 0.02, 0.26], [-0.3, 0.02, 0.3, 0.26, 0.21], [-0.2, -0.2, 0.14, 0.0, 0.36]],
    [[-0.33, -0.24, -0.02, 0.26, 0.28], [0.0, -0.24, 0.32, 0.26, 0.22], [0.04, -0.2, 0.28, 0.02, 0.32]],
  ][seed % 4];
  const base = new Float32Array(w * h), sc = 0.86;                                // the whole stack a bit inside the hex
  for (const [a, b, c, e, hh] of crates) {
    const ht = cell * (hh * 0.85 + r.uniform(-0.012, 0.012));
    for (let y = Math.round(cy + b * sc * cell); y < Math.round(cy + e * sc * cell); y++)
      for (let x = Math.round(cx + a * sc * cell); x < Math.round(cx + c * sc * cell); x++)
        if (x >= 0 && y >= 0 && x < w && y < h) base[y * w + x] = Math.max(base[y * w + x], ht);
  }
  const tight = fblur(base, w, h, cell * 0.012), loose = fblur(base, w, h, cell * 0.06);  // the drape: bridged over the gaps
  const cover = new Float32Array(w * h), sil = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) { cover[p] = Math.max(tight[p], loose[p] * 0.86); sil[p] = base[p] > 0 ? 1 : 0; }
  const slope = (x, y) => {                                                       // how steep the drape is here
    const gx = cover[y * w + Math.min(w - 1, x + 1)] - cover[y * w + Math.max(0, x - 1)];
    const gy = cover[Math.min(h - 1, y + 1) * w + x] - cover[Math.max(0, y - 1) * w + x];
    return Math.hypot(gx, gy) / 2;
  };
  const skirtBlur = fblur(sil, w, h, cell * 0.05);
  const wob = new PyRandom(930 + seed), phase = [wob.uniform(0, 6), wob.uniform(0, 6), wob.uniform(0, 6)];
  const bumps = fblur(Float32Array.from({ length: w * h }, () => wob.random() - 0.5), w, h, cell * 0.07);   // broad soft billows
  const bumpMax = Math.max(...bumps.map(Math.abs)) || 1;
  const z = new Float32Array(w * h), ht = Math.max(...base);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const hem = 0.4 + 0.1 * Math.sin(x * 0.21 + phase[0]) + 0.06 * Math.sin(y * 0.29 + phase[1]);    // a wavy hem, close in
      const onSkirt = skirtBlur[p] > hem, onCover = cover[p] > cell * 0.03;
      if (!onSkirt && !onCover) continue;                                          // bare ground: nothing here
      let zz = onCover ? cover[p] : 0;
      if (onSkirt) zz = Math.max(zz, cell * 0.018 * Math.min(1, (skirtBlur[p] - hem) * 6));
      const side = onCover ? Math.min(1, Math.max(0, (slope(x, y) - 0.12) * 5)) : 0;
      zz += side * cell * 0.006 * Math.sin(x * 0.5 + Math.sin(y * 0.08 + phase[2]) * 3);            // hanging folds, on the sides only
      if (onCover) zz += (bumps[p] / bumpMax) * cell * 0.02;                                         // the tarp billows over the tops
      z[p] = Math.max(1, zz);
    }
  let leaf = null;
  if (netted) {                                                                   // the net lies on the tops
    const nl = newImage("RGBA", w, h), nd = new Draw(nl), rr = new PyRandom(940 + seed);
    for (let i = 700; i > 0; i--) {
      const x = rr.uniform(0, w), y = rr.uniform(0, h), s = cell * rr.uniform(0.018, 0.045), q = [];
      for (let k = rr.randint(4, 6); k > 0; k--) { const px = x + rr.uniform(-s, s); q.push([px, y + rr.uniform(-s, s)]); }
      nd.polygon(q, A(rr.choice(CAMO), 255));
    }
    leaf = nl.data;
  }
  const tone = fblur(Float32Array.from({ length: w * h }, () => r.random()), w, h, cell * 0.06);
  const lay = shadeField(w, h, z, (p) => {
    if (leaf && leaf[p * 4 + 3] && z[p] > ht * 0.55) return [leaf[p * 4], leaf[p * 4 + 1], leaf[p * 4 + 2]];
    const t = 1.08 + (tone[p] - 0.5) * 0.5;
    return [TARP[0] * t * 1.06, TARP[1] * t, TARP[2] * t];
  }, { gloss: netted ? 0.35 : 0.75, k: 0.6 });
  return withShadow(lay, cell);
}

// --- concrete ---------------------------------------------------------------------------------------------------

function tokenDragonTooth(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0];
  const b = cell * 0.3, t = cell * 0.13, h = cell * 0.22, by = cy + cell * 0.1, ty = by - h;
  const B = [[cx - b, by - b], [cx + b, by - b], [cx + b, by + b], [cx - b, by + b]];
  const U = [[cx - t, ty - t], [cx + t, ty - t], [cx + t, ty + t], [cx - t, ty + t]];
  d.polygon([B[0], B[1], U[1], U[0]], A(sh(CONCRETE, 1.02)));                     // north
  d.polygon([B[1], B[2], U[2], U[1]], A(sh(CONCRETE, 0.84)));                     // east
  d.polygon([B[3], B[0], U[0], U[3]], A(sh(CONCRETE, 1.1)));                      // west (lit)
  d.polygon([B[2], B[3], U[3], U[2]], A(CONCRETE_SIDE));                          // south
  d.polygon(U, A(sh(CONCRETE, 1.14)));
  return withShadow(grime(lay, cell, 950, 0.12), cell);
}

function hexPost(d, x, y, r, hgt) {                                               // a hex prism with a pointed top
  const P = (yy) => [0, 1, 2, 3, 4, 5].map((i) => [x + Math.cos((Math.PI / 3) * i) * r, yy + Math.sin((Math.PI / 3) * i) * r * 0.6]);
  const top = P(y - hgt), bot = P(y);
  for (const [a, b, k] of [[3, 2, 1.06], [2, 1, 0.92], [1, 0, 0.78]])            // the three faces toward the south
    d.polygon([top[a], top[b], bot[b], bot[a]], A(sh(CONCRETE_SIDE, k)));
  const tip = [x, y - hgt - r * 0.7];
  for (let i = 0; i < 6; i++) d.polygon([top[i], top[(i + 1) % 6], tip], A(sh(CONCRETE, [1.0, 0.9, 1.05, 1.15, 1.2, 1.1][i])));
}

function tokenPosts(cell, seed = 0) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0];
  const spots = seed === 0 ? [[-0.2, -0.05], [0.18, -0.08], [0.0, 0.2]] : [[-0.16, 0.08], [0.16, 0.12]];
  spots.sort((a, b) => a[1] - b[1]);
  for (const [ox, oy] of spots) hexPost(d, cx + ox * cell, cy + oy * cell + cell * 0.14, cell * 0.1, cell * 0.36);
  return withShadow(grime(lay, cell, 960 + seed, 0.12), cell);
}

function tokenBlock(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0];
  const x0 = cx - cell * 0.34, x1 = cx + cell * 0.34, y0 = cy - cell * 0.28, y1 = cy + cell * 0.3, h = cell * 0.26;
  box(d, x0, y0, x1, y1, h, CONCRETE, CONCRETE_SIDE, sh(CONCRETE, 1.1));
  d.line([[x0 + cell * 0.08, y0 - h + cell * 0.1], [x0 + cell * 0.3, y0 - h + cell * 0.22], [x0 + cell * 0.36, y1 - h - 3]], A(sh(CONCRETE, 0.86)), 2);   // a cast seam
  d.ellipse([x0 + cell * 0.12, y1 - cell * 0.13, x0 + cell * 0.24, y1 - cell * 0.06], { fill: A([40, 32, 30]) });   // lifting hole
  return withShadow(grime(lay, cell, 970, 0.16), cell);
}

function tokenPanels(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0];
  const x0 = cx - cell * 0.26, x1 = cx + cell * 0.26, y0 = cy - cell * 0.36, y1 = cy + cell * 0.36;
  d.rectangle([x0 - 3, y1 - cell * 0.12, x1 + 3, y1 + cell * 0.04], { fill: A([60, 52, 48]) });   // the pallet under it
  for (let x = x0; x < x1; x += cell * 0.09) d.rectangle([x, y1 - cell * 0.1, x + cell * 0.05, y1 + cell * 0.03], { fill: A([96, 86, 80]) });
  const n = 4, pw = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {                                                   // the slabs
    const px = x0 + i * pw;
    d.rectangle([px, y0, px + pw - 2, y1 - cell * 0.1], { fill: A(sh([192, 182, 168], [1.04, 0.98, 1.02, 0.95][i])) });
    d.line([[px + pw - 3, y0], [px + pw - 3, y1 - cell * 0.1]], A([150, 140, 128]), 2);
  }
  for (const y of [y0 + cell * 0.14, y1 - cell * 0.3]) d.rectangle([x0 - 2, y, x1 + 2, y + cell * 0.03], { fill: A(STRAP) });   // straps
  d.polygon([[cx + cell * 0.08, y1 - cell * 0.22], [cx + cell * 0.13, y1 - cell * 0.18], [cx + cell * 0.08, y1 - cell * 0.14], [cx + cell * 0.03, y1 - cell * 0.18]], A([60, 140, 176]));
  return withShadow(grime(lay, cell, 980, 0.12), cell);
}

// --- the radar dish (Size 2) ----------------------------------------------------------------------------------

function tokenDish(cell) {
  const [lay, d, cs] = layerFor(cell, size2Footprint(cell));
  const cx = cs.reduce((s, [x]) => s + x, 0) / 3, cy = cs.reduce((s, [, y]) => s + y, 0) / 3;
  const bx0 = cx - cell * 0.5, bx1 = cx + cell * 0.5, by1 = cy + cell * 0.62;
  box(d, bx0, cy - cell * 0.25, bx1, by1, cell * 0.3, CONCRETE, CONCRETE_SIDE, sh(CONCRETE, 1.1));   // the concrete base
  const gx = cx, gy = cy - cell * 0.12, gr = cell * 0.42;
  d.ellipse([gx - gr, gy - gr * 0.7, gx + gr, gy + gr * 0.7], { fill: A([44, 40, 42]) });   // the toothed ring
  for (let i = 0; i < 40; i++) {
    const a = (2 * Math.PI * i) / 40, x = gx + Math.cos(a) * gr, y = gy + Math.sin(a) * gr * 0.7;
    d.rectangle([x - 2, y - 2, x + 2, y + 2], { fill: A([70, 66, 66]) });
  }
  d.polygon([[gx - gr * 0.7, gy + gr * 0.1], [gx + gr * 0.7, gy + gr * 0.1], [gx + gr * 0.5, gy - gr * 0.55], [gx - gr * 0.5, gy - gr * 0.55]], A([48, 64, 96]));   // the mount
  const R = cell * 0.66, dx = cx - cell * 0.06, dy = cy - cell * 0.5;           // the dish, tilted to the south-west
  d.ellipse([dx - R, dy - R * 0.95, dx + R, dy + R * 0.95], { fill: A([96, 92, 90]) });
  d.ellipse([dx - R * 0.96, dy - R * 0.9, dx + R * 0.96, dy + R * 0.88], { fill: A([232, 228, 222]) });
  for (const [k, col] of [[0.8, [40, 38, 40]], [0.68, [232, 228, 222]], [0.54, [40, 38, 40]], [0.42, [232, 228, 222]], [0.26, [40, 38, 40]], [0.14, [214, 210, 204]]])
    d.ellipse([dx - R * k, dy - R * k * 0.92, dx + R * k, dy + R * k * 0.92], { fill: A(col) });
  const shade = newImage("RGBA", lay.w, lay.h);                                  // the bowl's shaded side (lit from the top-left)
  new Draw(shade).ellipse([dx - R * 0.7, dy - R * 0.6, dx + R * 1.1, dy + R * 1.0], { fill: [60, 50, 50, 55] });
  const bowl = newImage("L", lay.w, lay.h);
  new Draw(bowl).ellipse([dx - R * 0.96, dy - R * 0.9, dx + R * 0.96, dy + R * 0.88], { fill: 255 });
  const shadeIn = newImage("RGBA", lay.w, lay.h);
  paste(shadeIn, shade, bowl);
  alphaCompositeAt(lay, shadeIn);
  d.rectangle([dx + R * 0.28, dy - R * 0.62, dx + R * 0.42, dy - R * 0.5], { fill: A([228, 186, 60]) });   // a yellow marker
  for (const a of [0.6, 2.1, 3.9]) d.line([[dx + Math.cos(a) * R * 0.86, dy + Math.sin(a) * R * 0.8], [dx + R * 0.05, dy - R * 0.02]], A([60, 58, 60]), 3);   // the feed struts
  d.ellipse([dx - 6 + R * 0.05, dy - 6 - R * 0.02, dx + 6 + R * 0.05, dy + 6 - R * 0.02], { fill: A([60, 58, 60]) });
  return withShadow(grime(lay, cell, 990, 0.1), cell, 0.06, 0.09, 0.05, 0.6);
}

// --- pipe rack (two hexes) --------------------------------------------------------------------------------------

function tokenPipeRack(cell) {
  const [sx] = geometry(cell), [lay, d, cs] = layerFor(cell, [[0, 0], [sx, 0]]), [[xa, cy], [xb]] = cs;
  const x0 = xa - cell * 0.46, x1 = xb + cell * 0.46, y0 = cy - cell * 0.34, y1 = cy + cell * 0.34;
  d.rectangle([x0, y0, x1, y1], { fill: A([34, 28, 28]) });
  const n = 7, ph = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {                                                   // the pipes, lying east-west
    const y = y0 + i * ph;
    d.rectangle([x0 + 4, y + 2, x1 - 4, y + ph - 2], { fill: A(PIPE) });
    d.rectangle([x0 + 4, y + ph * 0.62, x1 - 4, y + ph - 2], { fill: A(sh(PIPE, 0.8)) });
    d.line([[x0 + 4, y + ph * 0.3], [x1 - 4, y + ph * 0.3]], A(sh(PIPE, 1.12)), 2);
    for (const ex of [x0 + 4, x1 - cell * 0.12]) d.rectangle([ex, y + 2, ex + cell * 0.08, y + ph - 2], { fill: A([62, 48, 40]) });   // dark ends
  }
  for (const fx of [xa - cell * 0.1, xb - cell * 0.02]) {                         // the black truss frames
    d.rectangle([fx, y0 - 3, fx + cell * 0.1, y1 + 3], { outline: A(FRAME), width: 4 });
    for (let y = y0; y < y1; y += cell * 0.14) { d.line([[fx, y], [fx + cell * 0.1, y + cell * 0.14]], A(FRAME), 3); d.line([[fx + cell * 0.1, y], [fx, y + cell * 0.14]], A(FRAME), 3); }
  }
  d.rectangle([xa + cell * 0.2, cy - cell * 0.05, xa + cell * 0.3, cy + cell * 0.02], { fill: A([96, 88, 86]) });   // a tag plate
  return withShadow(grime(lay, cell, 1000, 0.12), cell);
}

// --- palisade fence (east-west, tiles along a row) -----------------------------------------------------------------

function tokenFence(cell) {
  const [lay, d, cs] = layerFor(cell), [, cy] = cs[0], w = lay.w;
  const top = cy - cell * 0.3, bot = cy + cell * 0.08;
  d.rectangle([0, top + cell * 0.04, w, top + cell * 0.08], { fill: A(FENCE) });   // rails
  d.rectangle([0, bot - cell * 0.1, w, bot - cell * 0.06], { fill: A(FENCE) });
  for (let x = 1; x < w; x += cell * 0.055) {                                     // pickets with spear tops
    d.rectangle([x, top + cell * 0.02, x + cell * 0.028, bot], { fill: A(FENCE) });
    d.line([[x + 1, top + cell * 0.03], [x + 1, bot - 2]], A([90, 70, 64]), 1);
    d.polygon([[x - 1, top + cell * 0.02], [x + cell * 0.014, top - cell * 0.02], [x + cell * 0.029, top + cell * 0.02]], A(FENCE));
  }
  for (const px of [cell * 0.03, w / 2 - cell * 0.03, w - cell * 0.09]) d.rectangle([px, top - cell * 0.03, px + cell * 0.06, bot + 2], { fill: A([30, 24, 24]) });   // posts
  return withShadow(clipToHex(lay, cell, cs), cell, 0.03, 0.06, 0.02, 0.55);
}

// --- tyres ---------------------------------------------------------------------------------------------------------

function tyre(d, x, y, r, hub = false) {
  d.ellipse([x - r, y - r, x + r, y + r], { fill: A(RUBBER) });
  for (let i = 0; i < 18; i++) {                                                  // tread blocks round the rim
    const a = (2 * Math.PI * i) / 18, px = x + Math.cos(a) * r * 0.93, py = y + Math.sin(a) * r * 0.93;
    d.ellipse([px - r * 0.07, py - r * 0.07, px + r * 0.07, py + r * 0.07], { fill: A(sh(RUBBER, 1.3)) });
  }
  d.ellipse([x - r * 0.7, y - r * 0.7, x + r * 0.7, y + r * 0.7], { outline: A(sh(RUBBER, 0.7)), width: 2 });
  if (hub) {
    d.ellipse([x - r * 0.46, y - r * 0.46, x + r * 0.46, y + r * 0.46], { fill: A(HUB) });
    d.ellipse([x - r * 0.3, y - r * 0.3, x + r * 0.3, y + r * 0.3], { fill: A(sh(HUB, 0.8)) });
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i, px = x + Math.cos(a) * r * 0.38, py = y + Math.sin(a) * r * 0.38; d.ellipse([px - 2, py - 2, px + 2, py + 2], { fill: A([90, 70, 40]) }); }
  } else d.ellipse([x - r * 0.4, y - r * 0.4, x + r * 0.4, y + r * 0.4], { fill: A([26, 22, 22]) });
}

function tokenTyres(cell, seed = 0) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0];
  if (seed === 2) { tyre(d, cx, cy, cell * 0.36, true); return withShadow(grime(lay, cell, 1012, 0.12), cell); }   // one big wheel
  const spots = seed === 0 ? [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]] : [[-0.18, -0.12], [0.14, -0.2], [0.02, 0.18]];
  for (const [ox, oy] of spots)                                                   // stacks: the top tyre, the one under peeking out
    for (const k of [1, 0]) tyre(d, cx + ox * cell + k * 3, cy + oy * cell + k * 5, cell * 0.15, false);
  return withShadow(grime(lay, cell, 1010 + seed, 0.12), cell);
}

// --- pallets and crates ------------------------------------------------------------------------------------------------

function tokenPallet(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0];
  const x0 = cx - cell * 0.32, x1 = cx + cell * 0.32, y0 = cy - cell * 0.26, y1 = cy + cell * 0.28;
  d.rectangle([x0, y1 - cell * 0.08, x1, y1], { fill: A(sh(WOOD, 0.62)) });       // the south side: blocks
  for (const bx of [x0, cx - cell * 0.04, x1 - cell * 0.08]) d.rectangle([bx, y1 - cell * 0.08, bx + cell * 0.08, y1], { fill: A(sh(WOOD, 0.85)) });
  d.rectangle([x0, y0 - cell * 0.02, x1, y1 - cell * 0.08], { fill: A([62, 44, 34]) });
  const n = 7, sw = (y1 - cell * 0.08 - y0) / n;
  for (let i = 0; i < n; i++) d.rectangle([x0, y0 + i * sw, x1, y0 + i * sw + sw * 0.7], { fill: A(sh(WOOD, [1, 0.94, 1.06, 0.97, 1.02, 0.92, 1.04][i])) });
  return withShadow(grime(lay, cell, 1020, 0.2), cell);
}

function tokenWpnCrate(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0];
  const x0 = cx - cell * 0.38, x1 = cx + cell * 0.38, y0 = cy - cell * 0.14, y1 = cy + cell * 0.18, h = cell * 0.12;
  box(d, x0, y0, x1, y1, h, [206, 202, 202], [150, 146, 148]);
  d.rectangle([x0 + cell * 0.05, y0 - h + cell * 0.03, x1 - cell * 0.05, y1 - h - cell * 0.05], { fill: A([68, 134, 178]) });   // the blue lid
  d.text([cx - cell * 0.2, y0 - h + cell * 0.035], "WPN", T(cell * 0.2), A([240, 244, 248]), { family: "stencil" });
  for (const ex of [x0 + cell * 0.08, x1 - cell * 0.14]) d.rectangle([ex, y1 - h + 3, ex + cell * 0.06, y1 - 3], { fill: A([120, 116, 118]) });   // latches
  return withShadow(grime(lay, cell, 1030, 0.1), cell);
}

function tokenSupplies(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0], r = new PyRandom(1040);
  d.rectangle([cx - cell * 0.34, cy + cell * 0.2, cx + cell * 0.34, cy + cell * 0.3], { fill: A(sh(WOOD, 0.6)) });   // pallet edge
  const boxes = [[-0.32, -0.2, -0.06, 0.2, 0.2], [-0.04, -0.28, 0.16, 0.2, 0.26], [0.18, -0.12, 0.34, 0.2, 0.16], [-0.3, -0.36, -0.08, -0.2, 0.1]];
  for (const [a, b, c, e, hh] of boxes) {
    const col = sh([222, 214, 204], r.uniform(0.94, 1.04));
    box(d, cx + a * cell, cy + b * cell, cx + c * cell, cy + e * cell, cell * hh, col, sh(col, 0.72), sh(col, 1.08));
    if (r.random() < 0.6) d.rectangle([cx + a * cell + 4, cy + e * cell - cell * hh + 4, cx + a * cell + cell * 0.05, cy + e * cell - 4], { fill: A([190, 70, 52]) });   // a red mark
    d.line([[cx + ((a + c) / 2) * cell, cy + b * cell - cell * hh], [cx + ((a + c) / 2) * cell, cy + e * cell - cell * hh]], A(sh(col, 0.8)), 2);   // tape
  }
  return withShadow(grime(lay, cell, 1041, 0.1), cell);
}

// --- the long tent (two hexes) -------------------------------------------------------------------------------------

function tokenTent(cell) {
  const [sx] = geometry(cell), [lay, d, cs] = layerFor(cell, [[0, 0], [sx, 0]]), [[xa, cy], [xb]] = cs, r = new PyRandom(1050);
  const x0 = xa - cell * 0.46, x1 = xb + cell * 0.46, y0 = cy - cell * 0.36, y1 = cy + cell * 0.36, ridge = cy - cell * 0.04;
  d.polygon([[x0, y0], [x1, y0], [x1, ridge], [x0, ridge]], A(sh(CANVAS, 1.04)));   // the lit north roof
  d.polygon([[x0, ridge], [x1, ridge], [x1, y1], [x0, y1]], A(sh(CANVAS, 0.86)));   // the shaded south roof
  d.line([[x0, ridge], [x1, ridge]], A(sh(CANVAS, 1.12)), 3);
  for (const ex of [x0, x1]) d.polygon([[ex, y0], [ex + (ex === x0 ? cell * 0.16 : -cell * 0.16), ridge], [ex, y1]], A(sh(CANVAS, 0.76)));   // the ends
  const mid = (x0 + x1) / 2;
  d.line([[mid, y0], [mid, y1]], A(sh(CANVAS, 0.8)), 3);                          // where the two sections meet
  for (let i = 0; i < 16; i++) {                                                  // creases
    const x = r.uniform(x0 + cell * 0.1, x1 - cell * 0.1), ya = r.uniform(y0, y1), L = cell * r.uniform(0.1, 0.25);
    d.line([[x, ya], [x + r.uniform(-L, L) * 0.4, Math.min(y1, ya + L)]], A(sh(CANVAS, r.choice([0.9, 1.08])), 200), 2);
  }
  return withShadow(grime(lay, cell, 1051, 0.14), cell);
}

// --- the camo-netted APC (Size 2) -----------------------------------------------------------------------------------

function tokenApc(cell) {
  const [lay, d, cs] = layerFor(cell, size2Footprint(cell));
  const cx = cs.reduce((s, [x]) => s + x, 0) / 3, cy = cs.reduce((s, [, y]) => s + y, 0) / 3;
  const L = cell * 0.95, W = cell * 0.42;
  for (const wx of [-0.62, -0.2, 0.22, 0.62])                                     // wheels sticking out at the sides
    for (const sgn of [-1, 1]) d.roundedRectangle([cx + wx * L - cell * 0.1, cy + sgn * W - cell * 0.08, cx + wx * L + cell * 0.1, cy + sgn * W + cell * 0.08], cell * 0.04, { fill: A([34, 30, 30]) });
  const hull = [[cx - L, cy - W * 0.7], [cx - L * 0.85, cy - W], [cx + L * 0.75, cy - W], [cx + L, cy - W * 0.45], [cx + L, cy + W * 0.45], [cx + L * 0.75, cy + W], [cx - L * 0.85, cy + W], [cx - L, cy + W * 0.7]];
  d.polygon(hull.map(([x, y]) => [x, y + cell * 0.05]), A(sh(APC, 0.66)));        // the south side
  d.polygon(hull, A(APC));
  d.polygon([[cx + L * 0.75, cy - W], [cx + L, cy - W * 0.45], [cx + L, cy + W * 0.45], [cx + L * 0.75, cy + W]], A(sh(APC, 1.1)));   // the sloped nose
  let out = camo(lay, [[cx - L * 0.9, cy - W * 0.9], [cx + L * 0.55, cy - W * 0.95], [cx + L * 0.62, cy + W * 0.9], [cx - L * 0.92, cy + W * 0.8]], 1060, cell);
  const d2 = new Draw(out);
  d2.roundedRectangle([cx + L * 0.2, cy - W * 0.35, cx + L * 0.5, cy + W * 0.35], cell * 0.05, { fill: A(sh(APC, 0.9)), outline: A(sh(APC, 0.6)), width: 2 });   // hatch
  d2.rectangle([cx + L * 0.8, cy - W * 0.5, cx + L * 0.9, cy - W * 0.2], { fill: A([60, 70, 80]) });   // vision blocks
  d2.rectangle([cx + L * 0.8, cy + W * 0.2, cx + L * 0.9, cy + W * 0.5], { fill: A([60, 70, 80]) });
  return withShadow(grime(out, cell, 1061, 0.14), cell, 0.06, 0.09, 0.05, 0.6);
}

export const TOKENS = {
  tf_cylinders_v1: (c) => tokenCylinders(c, 0),
  tf_cylinders_v2: (c) => tokenCylinders(c, 1),
  tf_cylinders_v3: (c) => tokenCylinders(c, 2),
  tf_tarp_stack_v1: (c) => tokenTarp(c, false, 0),
  tf_tarp_stack_v2: (c) => tokenTarp(c, false, 1),
  tf_tarp_stack_camo_v1: (c) => tokenTarp(c, true, 2),
  tf_tarp_stack_camo_v2: (c) => tokenTarp(c, true, 3),
  tf_dragon_tooth: tokenDragonTooth,
  tf_posts_v1: (c) => tokenPosts(c, 0),
  tf_posts_v2: (c) => tokenPosts(c, 1),
  tf_concrete_block: tokenBlock,
  tf_panel_stack: tokenPanels,
  tf_radar_dish_size2: tokenDish,
  tf_pipe_rack_2hex: tokenPipeRack,
  tf_fence: tokenFence,
  tf_tyres_v1: (c) => tokenTyres(c, 0),
  tf_tyres_v2: (c) => tokenTyres(c, 1),
  tf_wheel: (c) => tokenTyres(c, 2),
  tf_pallet: tokenPallet,
  tf_wpn_crate: tokenWpnCrate,
  tf_supplies: tokenSupplies,
  tf_tent_2hex: tokenTent,
  tf_apc_size2: tokenApc,
};

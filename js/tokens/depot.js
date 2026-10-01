// Depot tokens (names start dp_), after Synthetik's Depot: steel-blue storage tanks (squat, tall and lying),
// gas bottles, steel drums, wooden crates, strapped supply boxes, concrete blocks on a pallet, hollow
// concrete blocks, flanged pipe bundles, banded pipe stacks, the galvanised U-pipe, tetrapods, sheet-pile
// walls, railing, the dark container, steel slabs, the yellow ammo crate. Reference:
// _backstage/reference/synthetik/depot/.
//
// Drawn like the rest of the kit: from above with the near (south) face showing and the kit's shadow
// (down-right, so sets mix on one map). Round steel things are lit height fields (project()): a
// height map, lit from the top-left and shown as seen from the south, with paint that can change with
// height up a wall (bands, stencils). Hard boxes are drawn flat.

import { PyRandom } from "../rng.js?v=0f282507bd";
import { newImage, Draw, alphaComposite, alphaCompositeAt, paste } from "../raster.js?v=0f282507bd";
import { geometry } from "../maps/geometry.js?v=0f282507bd";
import { tokenCanvas, grime, size2Footprint } from "./kit.js?v=0f282507bd";
import { groundShadow } from "./shadow.js?v=0f282507bd";

const withShadow = (obj, cell) => groundShadow(obj, cell);                      // stood on the floor (shadow.js), not the kit's offset copy
import { fblur } from "./training.js?v=0f282507bd";

const T = Math.trunc;
export const sh = (c, k) => c.map((v) => Math.max(0, Math.min(255, T(v * k))));
export const A = (c, a = 255) => [...c, a];
const norm = (v) => { const m = Math.hypot(...v); return v.map((c) => c / m); };

const STEEL = [70, 118, 142], STEEL_TOP = [86, 132, 148];        // the tanks
const BOTTLE = [54, 72, 92], CAPDARK = [44, 46, 54];
const DRUM = [100, 132, 142];
const WOOD = [198, 178, 144], WOOD_DARK = [150, 128, 104];
const BOX = [214, 210, 190];
const CONCRETE = [164, 168, 156];
const PILING = [56, 62, 70];
const ORANGE = [196, 104, 76], YELLOW = [222, 172, 70], LABEL = [74, 120, 168];

// the object's layer, its draw and the hex centres
export function layerFor(cell, fp = [[0, 0]]) {
  const { img, cs } = tokenCanvas(cell, fp);
  const lay = newImage("RGBA", img.w, img.h);
  return [lay, new Draw(lay), cs];
}
export const centroid = (cs) => [cs.reduce((s, [x]) => s + x, 0) / cs.length, cs.reduce((s, [, y]) => s + y, 0) / cs.length];
export const row3 = (cell) => { const [sx] = geometry(cell); return [[0, 0], [sx, 0], [-sx, 0]]; };
export const row2 = (cell) => { const [sx] = geometry(cell); return [[0, 0], [sx, 0]]; };

// --- lit height fields ----------------------------------------------------------------------------------------

const LIGHT = norm([-0.55, -0.75, 0.9]), FILL = norm([-0.6, 0.8, 0.3]), HALF = norm([LIGHT[0], LIGHT[1] + 0.7, LIGHT[2] + 0.7]);

// How bright a surface with normal n is: key light from the top-left, a fill from the south-west (so
// walls facing the viewer are lit on their west side and fall off to the east), and a highlight.
function lightOf(n, gloss) {
  const d = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
  const f = Math.max(0, n[0] * FILL[0] + n[1] * FILL[1] + n[2] * FILL[2]);
  const s = gloss ? Math.pow(Math.max(0, n[0] * HALF[0] + n[1] * HALF[1] + n[2] * HALF[2]), 30) * gloss : 0;
  return [0.5 + 0.55 * d + 0.2 * f, s];
}

// Show a height field (z in px over the footprint) as seen from the south: a point of height z shows z*k px
// higher. Drawn south to north with a y-buffer, so near surfaces hide far ones and walls show below their
// rims. paint(x, y, hgt, wall) gives the colour of footprint pixel (x, y) at height hgt (on a wall, the
// height of that row), or null to leave it out. Returns an RGBA layer. A fine field (fine(): built 3x finer
// from the true shapes) is drawn at that scale, with paint still called in token pixels, and averaged
// down: smooth edges, and no ripples or bands where steep slopes make neighbouring pixels jump rows.
export function project(w, h, z, paint, { gloss = 0, k = 1 } = {}) {
  const s = z.fine || 1;
  if (s === 1) return projectAt(w, h, z, paint, gloss, k, 1);
  const fineOut = projectAt(w * s, h * s, z, (x, y, hgt, wall) => paint((x + 0.5) / s - 0.5, (y + 0.5) / s - 0.5, hgt / s, wall), gloss, k, s);
  return downsample(fineOut, s);
}

// a height field s times finer than the token (heights in fine pixels), for project()
export function fine(w, h, s = 3) {
  const z = new Float32Array(w * s * h * s);
  z.fine = s;
  return z;
}

// raise a height field to fn(x, y) (token pixels, as an integer-pixel loop would see them: x + 0.5 is the
// centre), at the field's own scale
export function fill(z, w, h, fn) {
  const s = z.fine || 1, W = w * s, H = h * s;
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      const v = fn((X + 0.5) / s - 0.5, (Y + 0.5) / s - 0.5) * s;
      if (v > z[Y * W + X]) z[Y * W + X] = v;
    }
}

function projectAt(w, h, z, paint, gloss, k, ss) {
  const out = newImage("RGBA", w, h), ybuf = new Float32Array(w).fill(Infinity), zs = fblur(z, w, h, 1.5 * ss);   // normals from a smoothed copy
  const zw = ss > 1 ? fblur(z, w, h, 3.5 * ss) : zs;                                   // which way a wall faces: smoother still
  for (let y = h - 1; y >= 0; y--)
    for (let x = 0; x < w; x++) {
      const p = y * w + x, zz = z[p];
      if (zz <= 0) continue;
      const sy = Math.round(y - zz * k);
      if (sy >= ybuf[x]) continue;
      const gx = (zs[y * w + Math.min(w - 1, x + 1)] - zs[y * w + Math.max(0, x - 1)]) / 2;
      const gy = (zs[Math.min(h - 1, y + 1) * w + x] - zs[Math.max(0, y - 1) * w + x]) / 2;
      const top = norm([-gx, -gy, 1]);
      const wx = (zw[y * w + Math.min(w - 1, x + 1)] - zw[y * w + Math.max(0, x - 1)]) / 2, wy = (zw[Math.min(h - 1, y + 1) * w + x] - zw[Math.max(0, y - 1) * w + x]) / 2;
      const gm = Math.hypot(wx, wy), side = gm > 0.01 ? [wx / gm, wy / gm, 0] : [0, 1, 0];   // a wall faces down the slope
      const wallN = [side[0] * 0.94, Math.max(side[1], 0.2) * 0.94, 0.33];
      const last = Math.min(h, ybuf[x], y + 1), cliff = zz - (y + 1 < h ? z[p + w] : 0) > 3 * ss;   // a real wall below this pixel
      for (let yy = Math.max(0, sy); yy < last; yy++) {
        const wall = yy > sy + ss, hgt = wall ? Math.max(0, (y - yy) / k) : zz;
        const c = paint(x, y, hgt, wall);
        if (!c) continue;
        const [l, s] = lightOf(wall && cliff ? norm(wallN) : top, gloss);
        const q = (yy * w + x) * 4;
        out.data[q] = Math.min(255, c[0] * l + s * 200); out.data[q + 1] = Math.min(255, c[1] * l + s * 200);
        out.data[q + 2] = Math.min(255, c[2] * l + s * 200); out.data[q + 3] = 255;
      }
      ybuf[x] = sy;
    }
  return out;
}

// add a standing cylinder (centre cx, cy on the ground, radius R, height H) to a height field, its top
// edge rounded over `bevel` px; dome > 0 raises the middle of the top
export function addCyl(z, w, h, cx, cy, R, H, bevel = 2, dome = 0) {
  const f = z.fine || 1;
  if (f > 1) { w *= f; h *= f; cx *= f; cy *= f; R *= f; H *= f; bevel *= f; dome *= f; }
  for (let y = Math.max(0, T(cy - R - 1)); y < Math.min(h, cy + R + 1); y++)
    for (let x = Math.max(0, T(cx - R - 1)); x < Math.min(w, cx + R + 1); x++) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (r > R) continue;
      const e = R - r, v = H - (e < bevel ? bevel - Math.sqrt(Math.max(0, bevel * bevel - (bevel - e) ** 2)) : 0) + dome * (1 - (r / R) ** 2);
      if (v > z[y * w + x]) z[y * w + x] = v;
    }
}

// add a box (ground rectangle, height H) with rounded top edges
export function addBox(z, w, h, x0, y0, x1, y1, H, bevel = 1.5) {
  const f = z.fine || 1;
  if (f > 1) { w *= f; h *= f; x0 *= f; y0 *= f; x1 *= f; y1 *= f; H *= f; bevel *= f; }
  for (let y = Math.max(0, T(y0)); y < Math.min(h, y1); y++)
    for (let x = Math.max(0, T(x0)); x < Math.min(w, x1); x++) {
      const e = Math.min(x + 0.5 - x0, x1 - x - 0.5, y + 0.5 - y0, y1 - y - 0.5);
      const v = H - (e < bevel ? bevel - e : 0);
      if (v > z[y * w + x]) z[y * w + x] = v;
    }
}

// chipped paint: small dark flakes, only where the layer is drawn
export function chips(lay, seed, n, cell, col = [24, 34, 44]) {
  const r = new PyRandom(seed), over = newImage("RGBA", lay.w, lay.h), d = new Draw(over);
  for (let i = 0; i < n; i++) {
    const x = r.uniform(0, lay.w), y = r.uniform(0, lay.h), s = cell * r.uniform(0.008, 0.022), q = [];
    for (let k = r.randint(4, 6); k > 0; k--) { const px = x + r.uniform(-s, s); q.push([px, y + r.uniform(-s * 0.7, s * 0.7)]); }
    d.polygon(q, A(col, 220));
  }
  for (let p = 0; p < lay.w * lay.h; p++) if (!lay.data[p * 4 + 3]) over.data[p * 4 + 3] = 0;
  return alphaCompositeAt(lay, over);
}

// average an RGBA image down by s x s (premultiplied, so edges stay clean)
export function downsample(img, s) {
  const w = Math.floor(img.w / s), h = Math.floor(img.h / s), out = newImage("RGBA", w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < s; j++)
        for (let i = 0; i < s; i++) {
          const q = ((y * s + j) * img.w + x * s + i) * 4, al = img.data[q + 3];
          r += img.data[q] * al; g += img.data[q + 1] * al; b += img.data[q + 2] * al; a += al;
        }
      const q = (y * w + x) * 4;
      if (a) { out.data[q] = r / a; out.data[q + 1] = g / a; out.data[q + 2] = b / a; out.data[q + 3] = a / (s * s); }
    }
  return out;
}

// --- ray-traced round shapes ----------------------------------------------------------------------------------

// The kit's view as a camera: a point (x, y, z) shows at (x, y - K z) on the token, so each pixel is a ray
// p(t) = (sx, sy + t, t / K), and a larger t is nearer the viewer. Shapes are rasterised into a t-buffer at
// TSS x TSS samples a pixel (nothing below the floor shows), then painted, lit with lightOf and averaged down.
const K = 0.85, TSS = 3, DIR = [0, 1, 1 / K];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function sphere(c, R, info = {}) {
  const e = R * Math.hypot(1, K), sy = c[1] - K * c[2], a = dot(DIR, DIR);
  return { ...info, box: [c[0] - R, sy - e, c[0] + R, sy + e], hit(sx, sy0) {
    const oc = [sx - c[0], sy0 - c[1], -c[2]], b = 2 * dot(oc, DIR), cc = dot(oc, oc) - R * R, disc = b * b - 4 * a * cc;
    if (disc < 0) return null;
    const t = (-b + Math.sqrt(disc)) / (2 * a);
    return { t, n: [(oc[0]) / R, (oc[1] + t) / R, (oc[2] + t / K) / R] };
  } };
}

// a finite cylinder from A to B with flat ends
export function cylinder(A, B, R, info = {}) {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L, (B[2] - A[2]) / L];
  const du = dot(DIR, u), dp = DIR.map((v, i) => v - du * u[i]), a = dot(dp, dp);
  const xs = [A[0] - R, A[0] + R, B[0] - R, B[0] + R], sys = [];
  for (const P of [A, B]) for (const dy of [-R, R]) for (const dz of [-R, R]) sys.push(P[1] + dy - K * (P[2] + dz));
  return { ...info, A, u, L, R, box: [Math.min(...xs), Math.min(...sys), Math.max(...xs), Math.max(...sys)], hit(sx, sy) {
    const oa = [sx - A[0], sy - A[1], -A[2]], ou = dot(oa, u), op = oa.map((v, i) => v - ou * u[i]);
    let best = -Infinity, n = null;
    if (a > 1e-9) {
      const b = 2 * dot(dp, op), c = dot(op, op) - R * R, disc = b * b - 4 * a * c;
      if (disc >= 0)
        for (const sg of [1, -1]) {
          const t = (-b + sg * Math.sqrt(disc)) / (2 * a), s = ou + t * du;
          if (s >= 0 && s <= L && t > best) { best = t; n = op.map((v, i) => (v + t * dp[i]) / R); }
        }
    }
    if (Math.abs(du) > 1e-9)
      for (const s0 of [0, L]) {
        const t = (s0 - ou) / du, wv = op.map((v, i) => v + t * dp[i]);
        if (dot(wv, wv) <= R * R && t > best) { best = t; n = s0 === 0 ? u.map((v) => -v) : u.slice(); }
      }
    return n ? { t: best, n } : null;
  } };
}

// where a point sits on a cylinder: s along its axis, r from the axis, and which end cap (0 on the side)
export function onCyl(pr, p, n) {
  const ap = [p[0] - pr.A[0], p[1] - pr.A[1], p[2] - pr.A[2]], s = dot(ap, pr.u);
  const w = ap.map((v, i) => v - s * pr.u[i]), cap = Math.abs(dot(n, pr.u)) > 0.99 ? Math.sign(dot(n, pr.u)) : 0;
  return { s, r: Math.hypot(...w), w, cap };
}

// value noise in 3D (0..1), for mottled metal
function hash3(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
  const l = (a, b, t) => a + (b - a) * t * t * (3 - 2 * t);
  const c = (di, dj, dk) => hash3(i + di, j + dj, k + dk);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy), l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
export const mottle = (p, scale, amt) => 1 - amt / 2 + amt * (0.7 * vnoise(p[0] / scale, p[1] / scale, p[2] / scale) + 0.3 * vnoise(p[0] / (scale * 0.3), p[1] / (scale * 0.3), p[2] / (scale * 0.3)));

// Render shapes into a w x h RGBA layer. paint(shape, point, normal) -> [r, g, b]; a shape's own `gloss`
// overrides the default.
export function trace(w, h, shapes, paint, { gloss = 0.4 } = {}) {
  const W = w * TSS, H = h * TSS, tb = new Float32Array(W * H).fill(-Infinity), id = new Int32Array(W * H).fill(-1);
  const P = new Float32Array(W * H * 3), N = new Float32Array(W * H * 3);
  shapes.forEach((sp, k) => {
    const [x0, y0, x1, y1] = sp.box;
    for (let Y = Math.max(0, Math.floor(y0 * TSS)); Y < Math.min(H, Math.ceil(y1 * TSS)); Y++)
      for (let X = Math.max(0, Math.floor(x0 * TSS)); X < Math.min(W, Math.ceil(x1 * TSS)); X++) {
        const sx = (X + 0.5) / TSS, sy = (Y + 0.5) / TSS, r = sp.hit(sx, sy), q = Y * W + X;
        if (!r || r.t <= tb[q] || r.t / K < -0.01) continue;
        tb[q] = r.t; id[q] = k;
        P[q * 3] = sx; P[q * 3 + 1] = sy + r.t; P[q * 3 + 2] = r.t / K;
        N[q * 3] = r.n[0]; N[q * 3 + 1] = r.n[1]; N[q * 3 + 2] = r.n[2];
      }
  });
  const hi = newImage("RGBA", W, H);
  for (let q = 0; q < W * H; q++) {
    if (id[q] < 0) continue;
    const sp = shapes[id[q]], p = [P[q * 3], P[q * 3 + 1], P[q * 3 + 2]], n = [N[q * 3], N[q * 3 + 1], N[q * 3 + 2]];
    const c = paint(sp, p, n);
    if (!c) continue;
    const [l, s] = lightOf(n, sp.gloss ?? gloss);
    for (let i = 0; i < 3; i++) hi.data[q * 4 + i] = Math.min(255, c[i] * l + s * 200);
    hi.data[q * 4 + 3] = 255;
  }
  return downsample(hi, TSS);
}
export const screen = (x, y, z) => [x, y - K * z];                                           // where a 3D point shows

// --- the storage tanks (Size 2) ---------------------------------------------------------------------------

// A squat tank: a bolted plinth, the steel body with label plates, a stencil and a stripe, and on the top a
// railing ring, a manhole and a pipe elbow. kind 0: "IL" with an orange stripe; kind 1: "2" with yellow bars.
function tokenTank(cell, kind = 0) {
  const [lay, , cs] = layerFor(cell, size2Footprint(cell)), { w, h } = lay, [cx, cyc] = centroid(cs);
  const cy = cyc + cell * 0.12, R = cell * 0.66, H = cell * 0.78, z = fine(w, h);
  addCyl(z, w, h, cx, cy, R * 1.07, cell * 0.07, 2);                              // the plinth
  addCyl(z, w, h, cx, cy, R, H, cell * 0.035);
  const hx = cx + R * 0.12, hy = cy - R * 0.1;
  addCyl(z, w, h, hx, hy, R * 0.26, H + cell * 0.07, 2);                           // the manhole collar
  addCyl(z, w, h, hx, hy, R * 0.18, H + cell * 0.1, 2, cell * 0.01);
  addCyl(z, w, h, cx - R * 0.42, cy - R * 0.38, R * 0.1, H + cell * 0.12, 2);      // a vent stack
  const paint = (x, y, hgt) => {
    const u = (x + 0.5 - cx) / R, v = hgt / H, top = hgt >= H - cell * 0.03;
    if (hgt < cell * 0.075 && Math.hypot(x - cx, y - cy) > R * 0.99) return [40, 62, 76];      // plinth
    if (top) {
      if (Math.hypot(x - hx, y - hy) < R * 0.26) return hgt > H + cell * 0.08 ? [70, 100, 114] : [58, 88, 104];
      return STEEL_TOP;
    }
    if (v > 0.9) return sh(STEEL, 0.86);                                           // the top band
    if (Math.abs(v - 0.3) < 0.012) return sh(STEEL, 0.78);                        // a seam
    if (u > -0.62 && u < -0.54 && v > 0.2 && v < 0.78) return [150, 162, 168];    // a label plate
    if (kind === 0 && u > 0.6 && u < 0.7 && v > 0.22 && v < 0.84) return ORANGE;
    if (kind === 1 && u > 0.5 && u < 0.62 && v > 0.12 && v < 0.62 && Math.floor(v * 22) % 2 === 0) return YELLOW;
    return STEEL;
  };
  let out = project(w, h, z, paint, { gloss: 0.35 });
  const d = new Draw(out), t = Math.max(2, T(cell * 0.016)), ry = 1;               // top and front features, drawn over
  const tcy = cy - H;                                                              // the top face's centre on screen
  for (const [px, py] of [[-0.46, 0.2], [-0.38, 0.28]]) d.rectangle([cx + px * R, tcy + py * R, cx + px * R + cell * 0.05, tcy + py * R + cell * 0.05], { fill: A([200, 206, 206]) });
  d.polygon([[cx + R * 0.38, tcy + R * 0.02], [cx + R * 0.52, tcy - R * 0.08], [cx + R * 0.52, tcy + R * 0.1]], A(YELLOW));   // hazard chevrons
  d.polygon([[cx + R * 0.24, tcy + R * 0.06], [cx + R * 0.36, tcy - R * 0.02], [cx + R * 0.36, tcy + R * 0.14]], A(YELLOW));
  const rr = R * 0.93, lift = cell * 0.14;                                         // the railing ring, on posts
  for (let a = 0; a < 360; a += 30) {
    const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
    if (a > 200 && a < 340) continue;                                              // the gate at the back
    d.line([[cx + c * rr, tcy + s * rr * ry], [cx + c * rr, tcy + s * rr * ry - lift]], A([40, 60, 74]), t);
  }
  d.arc([cx - rr, tcy - rr - lift, cx + rr, tcy + rr - lift], -150, 200, A([44, 66, 80]), t + 1);
  d.arc([cx - rr, tcy - rr - lift, cx + rr, tcy + rr - lift], 20, 160, A([96, 130, 144]), 1);
  d.line([[cx - R * 0.42, tcy - R * 0.38 - cell * 0.12], [cx - R * 0.42, tcy - R * 0.62 - cell * 0.12], [cx - R * 0.9, tcy - R * 0.62 - cell * 0.1]], A([48, 74, 90]), T(cell * 0.05), "curve");   // pipe elbow over the rim
  const fy = cy + R - H * 0.5;                                                     // the stencil, mid-way up the front
  d.text([cx - cell * 0.02, fy - cell * 0.2], kind === 0 ? "IL" : "2", T(cell * 0.42), A(sh(STEEL, 0.62)), { family: "stencil" });
  if (kind === 1) for (let i = 0; i < 4; i++) d.rectangle([cx - R * 0.55, fy - cell * 0.16 + i * cell * 0.07, cx - R * 0.3, fy - cell * 0.13 + i * cell * 0.07], { fill: A(sh(STEEL, 0.66)) });
  for (let a = 20; a < 170; a += 30) {                                             // plinth bolts
    const x = cx + Math.cos((a * Math.PI) / 180) * R * 1.035, y = cy + Math.sin((a * Math.PI) / 180) * R * 1.035 - cell * 0.06;
    d.rectangle([x - 3, y - 3, x + 3, y + 3], { fill: A([30, 44, 56]) });
  }
  out = chips(out, 1100 + kind, 60, cell);
  const acc = kind === 0 ? [[0.62, 0.34, "cap"], [0.86, 0.1, "bee"]] : [[-0.66, 0.46, "drum"], [0.72, 0.36, "cap"]];
  out = accessories(out, cell, cx, cy, R, acc, 1110 + kind);
  return withShadow(grime(out, cell, 1120 + kind, 0.1), cell, 0.06, 0.09, 0.05, 0.6);
}

// A tall tank: a slimmer, taller body with a big stencil, a checker strip, a hazard-striped column and a
// riser pipe up its west side
function tokenTallTank(cell) {
  const [lay, , cs] = layerFor(cell, size2Footprint(cell)), { w, h } = lay, [cx, cyc] = centroid(cs);
  const cy = cyc + cell * 0.2, R = cell * 0.56, H = cell * 1.32, z = fine(w, h);
  addCyl(z, w, h, cx, cy, R * 1.06, cell * 0.06, 2);
  addCyl(z, w, h, cx, cy, R, H, cell * 0.08, cell * 0.04);
  addCyl(z, w, h, cx + R * 0.1, cy - R * 0.12, R * 0.22, H + cell * 0.1, 2);
  addCyl(z, w, h, cx - R * 1.02, cy + R * 0.05, cell * 0.045, H * 0.96, 1);        // the riser pipe
  const paint = (x, y, hgt) => {
    const u = (x + 0.5 - cx) / R, v = hgt / H, top = hgt >= H - cell * 0.06;
    if (Math.hypot(x - (cx - R * 1.02), y - (cy + R * 0.05)) < cell * 0.05) return [48, 76, 94];
    if (hgt < cell * 0.065 && Math.hypot(x - cx, y - cy) > R * 0.99) return [40, 62, 76];
    if (top) return Math.hypot(x - (cx + R * 0.1), y - (cy - R * 0.12)) < R * 0.22 ? [64, 94, 110] : STEEL_TOP;
    if (u > -0.66 && u < -0.56 && v > 0.1 && v < 0.8) return Math.floor(v * 30) % 2 === 0 ? [206, 210, 212] : sh(STEEL, 0.7);   // checker strip
    if (u > 0.56 && u < 0.72 && v > 0.08 && v < 0.86) return (Math.floor(v * 40 + u * 6) % 2 === 0 ? YELLOW : sh(STEEL, 0.6));   // hazard column
    if (Math.abs(v - 0.5) < 0.008) return sh(STEEL, 0.78);
    return STEEL;
  };
  let out = project(w, h, z, paint, { gloss: 0.35 });
  const d = new Draw(out), fy = cy + R - H * 0.55;
  d.text([cx - cell * 0.18, fy - cell * 0.28], "F2", T(cell * 0.52), A(sh(STEEL, 0.6)), { family: "stencil" });
  d.polygon([[cx + R * 0.3, cy - H + R * 0.05], [cx + R * 0.44, cy - H - R * 0.05], [cx + R * 0.44, cy - H + R * 0.13]], A(YELLOW));
  d.rectangle([cx - R * 0.4, cy - H - R * 0.2, cx - R * 0.3, cy - H - R * 0.1], { fill: A([200, 206, 206]) });
  out = chips(out, 1130, 70, cell);
  out = accessories(out, cell, cx, cy, R, [[0.7, 0.4, "cap"]], 1131);
  return withShadow(grime(out, cell, 1132, 0.1), cell, 0.06, 0.09, 0.05, 0.6);
}

// A long tank lying east-west on saddles, a catwalk frame on top, a stencil on its side, a pipe along its
// foot and two gas bottles in front (three hexes in a row)
function tokenLyingTank(cell) {
  const [lay, , cs] = layerFor(cell, row3(cell)), { w, h } = lay, [cx, cy0] = cs[0], cy = cy0 + cell * 0.2;
  const L = cell * 1.3, R = cell * 0.33, z = fine(w, h);
  fill(z, w, h, (x, y) => {
    const dx = Math.max(0, Math.abs(x + 0.5 - cx) - (L - R * 0.6)), dy = y + 0.5 - cy;     // domed ends
    const q = 1 - (dx / (R * 0.6)) ** 2 - (dy / R) ** 2;
    return q <= 0 ? 0 : R * (0.25 + Math.sqrt(q) * 0.95);
  });
  for (const sx of [-0.62, 0.62]) addBox(z, w, h, cx + sx * L - cell * 0.08, cy - R * 1.2, cx + sx * L + cell * 0.08, cy + R * 1.2, cell * 0.24, 1);   // saddles
  const paint = (x, y, hgt, wall) => {
    const ax = x + 0.5 - cx;
    if (hgt < cell * 0.25 && Math.abs(Math.abs(ax) - 0.62 * L) < cell * 0.09 && Math.abs(y + 0.5 - cy) > R * 0.9) return [44, 58, 70];
    const band = y + 0.5 - cy;
    if (Math.abs(band + R * 0.25) < R * 0.08 && Math.abs(ax) < L * 0.5 && Math.floor((ax + L) / (cell * 0.07)) % 2 === 0) return YELLOW;   // hazard dashes
    return STEEL;
  };
  let out = project(w, h, z, paint, { gloss: 0.4, k: 0.8 });
  const d = new Draw(out), t = Math.max(2, T(cell * 0.016)), top = cy - R * 1.45;
  for (const [a, b] of [[-0.45, -0.05], [0.05, 0.45]]) {                           // the catwalk frame on top
    d.rectangle([cx + a * L, top - cell * 0.1, cx + b * L, top + cell * 0.08], { outline: A([36, 48, 58]), width: t });
    for (let x = cx + a * L; x < cx + b * L; x += cell * 0.06) d.line([[x, top - cell * 0.1], [x, top + cell * 0.08]], A([36, 48, 58]), 1);
  }
  d.text([cx + L * 0.08, cy - R * 0.7], "F4", T(cell * 0.4), A(sh(STEEL, 0.5)), { family: "stencil" });
  d.line([[cx - L * 0.9, cy + R * 0.95], [cx + L * 0.9, cy + R * 0.95]], A([54, 80, 98]), T(cell * 0.04));   // the pipe along its foot
  d.line([[cx - L * 0.9, cy + R * 0.95 - 2], [cx + L * 0.9, cy + R * 0.95 - 2]], A([110, 140, 154]), 1);
  for (const x of [-0.8, -0.35, 0.3, 0.8]) d.rectangle([cx + x * L - 3, cy + R * 0.85, cx + x * L + 3, cy + R * 1.05], { fill: A([36, 48, 58]) });
  out = chips(out, 1140, 90, cell);
  out = accessories(out, cell, cx, cy, R, [[-2.2, 0.95, "cap"], [-0.9, 1.0, "bee"], [2.6, 0.9, "ring"]], 1141);
  return withShadow(grime(out, cell, 1142, 0.1), cell, 0.06, 0.09, 0.05, 0.6);
}

// --- gas bottles and drums ------------------------------------------------------------------------------------

// One gas bottle into a height field + paint list: a rounded body and a top fitting. fit: "cap" (a dark cap),
// "bee" (a yellow valve guard with dark ports), "ring" (a collar ring with a dark valve)
export function bottle(z, w, h, x, y, r, hgt, fit, paints) {
  addCyl(z, w, h, x, y, r, hgt, r * 0.45, r * 0.25);                                 // round shoulders
  if (fit === "cap") addCyl(z, w, h, x, y, r * 0.5, hgt + r * 0.55, 2, r * 0.1);
  else if (fit === "bee") addCyl(z, w, h, x, y, r * 0.62, hgt + r * 0.6, 2);
  else addCyl(z, w, h, x, y, r * 0.8, hgt + r * 0.35, 1);
  paints.push({ x, y, r, hgt, fit });
}

export function bottlePaint(paints, cell, body = BOTTLE, label = LABEL) {
  return (px, py, hgt) => {
    for (const b of paints) {
      const dd = Math.hypot(px + 0.5 - b.x, py + 0.5 - b.y);
      if (dd > b.r + 0.5) continue;
      if (hgt > b.hgt + 1) {                                                        // the fitting
        if (b.fit === "bee") return dd < b.r * 0.2 || (Math.abs(dd - b.r * 0.38) < b.r * 0.08) ? [40, 32, 22] : YELLOW;
        if (b.fit === "ring") return dd > b.r * 0.62 ? [60, 66, 78] : dd < b.r * 0.22 ? [30, 30, 36] : [48, 52, 62];
        return CAPDARK;
      }
      const u = (px + 0.5 - b.x) / b.r, v = hgt / b.hgt;
      if (u > 0.3 && u < 0.62 && v > 0.3 && v < 0.62) return label;                // the label
      if (u < -0.35 && u > -0.6 && v > 0.12 && v < 0.2) return [214, 150, 70];      // an orange tag
      return body;
    }
    return null;
  };
}

// accessories standing round a big object: [dx, dy (in R from its centre), kind] -> bottles or drums
function accessories(out, cell, cx, cy, R, items, seed) {
  const { w, h } = out, z = fine(w, h), paints = [], drums = [], r = new PyRandom(seed);
  for (const [dx, dy, kind] of items) {
    const x = cx + dx * R, y = cy + dy * R;
    if (kind === "drum") { addCyl(z, w, h, x, y, cell * 0.13, cell * 0.28, 2); drums.push([x, y]); }
    else bottle(z, w, h, x, y, cell * r.uniform(0.1, 0.12), cell * r.uniform(0.36, 0.42), kind, paints);
  }
  const bp = bottlePaint(paints, cell);
  const lay = project(w, h, z, (x, y, hgt) => {
    for (const [dx, dy] of drums) if (Math.hypot(x - dx, y - dy) < cell * 0.135) return drumPaint(x, y, hgt, dx, dy, cell);
    return bp(x, y, hgt);
  }, { gloss: 0.3 });
  return alphaCompositeAt(out, lay);
}

function drumPaint(x, y, hgt, dx, dy, cell, drum = DRUM) {
  const H = cell * 0.28, v = hgt / H;
  if (hgt >= H - 1) {
    const dd = Math.hypot(x - dx, y - dy);
    if (Math.abs(dd - cell * 0.1) < 1.5) return sh(drum, 0.8);                     // the rim
    if (Math.hypot(x - dx - cell * 0.05, y - dy + cell * 0.03) < cell * 0.018) return [40, 50, 58];   // bung
    return sh(drum, 1.25);
  }
  if (Math.abs(v - 0.34) < 0.05 || Math.abs(v - 0.68) < 0.05) return sh(drum, 0.78);   // ribs
  return drum;
}

export function tokenBottles(cell, seed = 0, body = BOTTLE, label = LABEL) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, [cx, cy] = cs[0], z = fine(w, h), paints = [], r = new PyRandom(1150 + seed);
  const spots = [[[-0.2, -0.08, "cap"], [0.16, -0.14, "ring"], [0.02, 0.22, "bee"]],
    [[-0.24, 0.0, "cap"], [0.02, -0.18, "cap"], [0.24, 0.02, "bee"], [0.0, 0.24, "ring"]],
    [[-0.13, 0.08, "ring"], [0.16, 0.12, "cap"]]][seed % 3];
  for (const [ox, oy, fit] of spots) bottle(z, w, h, cx + ox * cell, cy + oy * cell + cell * 0.16, cell * r.uniform(0.1, 0.12), cell * r.uniform(0.34, 0.42), fit, paints);
  const out = project(w, h, z, bottlePaint(paints, cell, body, label), { gloss: 0.3 });
  return withShadow(grime(chips(out, 1155 + seed, 18, cell), cell, 1156 + seed, 0.1), cell);
}

export function tokenDrums(cell, seed = 0, drum = DRUM) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, [cx, cy] = cs[0], z = fine(w, h);
  const spots = [[[-0.16, -0.06], [0.15, -0.1], [0.0, 0.2]], [[-0.14, 0.04], [0.16, 0.1]]][seed % 2].map(([a, b]) => [cx + a * cell, cy + b * cell + cell * 0.12]);
  for (const [x, y] of spots) addCyl(z, w, h, x, y, cell * 0.13, cell * 0.28, 2);
  const out = project(w, h, z, (x, y, hgt) => {
    let best = spots[0], bd = Infinity;
    for (const s of spots) { const dd = Math.hypot(x - s[0], y - s[1]); if (dd < bd) { bd = dd; best = s; } }
    return drumPaint(x, y, hgt, best[0], best[1], cell, drum);
  }, { gloss: 0.3 });
  return withShadow(grime(chips(out, 1160 + seed, 16, cell), cell, 1161 + seed, 0.12), cell);
}

// --- crates and boxes (drawn flat) --------------------------------------------------------------------------------

// a box seen from above with its south face: top [x0, y0 - h .. x1, y1 - h], face below it
export function box(d, x0, y0, x1, y1, h, top, side, rim = null) {
  d.rectangle([x0, y1 - h, x1, y1], { fill: A(side) });
  d.rectangle([x0, y0 - h, x1, y1 - h], { fill: A(top) });
  if (rim) d.line([[x0, y1 - h], [x1, y1 - h]], A(rim), 2);
}

// a wooden crate: plank lines and a frame on the top, a framed south face with a diagonal brace
export function crate(d, r, x0, y0, x1, y1, h, cell, tone = 1) {
  const top = sh(WOOD, tone), side = sh(WOOD_DARK, tone), t = Math.max(2, T(cell * 0.014)), f = cell * 0.035;
  box(d, x0, y0, x1, y1, h, top, side);
  for (let y = y0 - h + f * 2; y < y1 - h - f; y += cell * 0.06) d.line([[x0 + f, y], [x1 - f, y]], A(sh(top, 0.9)), 1);   // planks
  for (let i = 0; i < 6; i++) {                                                     // grain streaks
    const x = r.uniform(x0 + f, x1 - f), y = r.uniform(y0 - h + f, y1 - h - f);
    d.line([[x, y], [Math.min(x1 - f, x + r.uniform(0.04, 0.12) * cell), y + r.uniform(-1, 1)]], A(sh(top, 0.84)), 1);
  }
  d.rectangle([x0, y0 - h, x1, y1 - h], { outline: A(sh(top, 0.78)), width: t + 1 });                     // the frame
  d.rectangle([x0 + f, y0 - h + f, x1 - f, y1 - h - f], { outline: A(sh(top, 0.86)), width: t });
  d.rectangle([x0, y1 - h, x1, y1], { outline: A(sh(side, 0.74)), width: t + 1 });
  d.line([[x0 + f, y1 - f], [x1 - f, y1 - h + f]], A(sh(side, 0.8)), t + 1);      // the brace
  d.line([[x0 + f, y1 - h + f * 0.8], [x1 - f, y1 - h + f * 0.8]], A(sh(side, 1.12)), 1);
}

function tokenCrate(cell, seed = 0) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0], r = new PyRandom(1170 + seed);
  if (seed === 0) crate(d, r, cx - cell * 0.26, cy - cell * 0.12, cx + cell * 0.26, cy + cell * 0.34, cell * 0.2, cell);
  else if (seed === 1) {                                                              // two crates, staggered
    crate(d, r, cx - cell * 0.34, cy - cell * 0.24, cx + cell * 0.04, cy + cell * 0.1, cell * 0.17, cell, 0.97);
    crate(d, r, cx - cell * 0.06, cy - cell * 0.02, cx + cell * 0.32, cy + cell * 0.34, cell * 0.17, cell, 1.03);
  } else {                                                                            // a tall crate (long, north-south)
    crate(d, r, cx - cell * 0.2, cy - cell * 0.4, cx + cell * 0.2, cy + cell * 0.38, cell * 0.24, cell);
    d.line([[cx - cell * 0.18, cy - cell * 0.04], [cx + cell * 0.18, cy - cell * 0.04]], A(sh(WOOD, 0.74)), 2);
  }
  d.rectangle([cx + cell * 0.04, cy + cell * 0.1, cx + cell * 0.14, cy + cell * 0.14], { fill: A([196, 70, 56]) });   // a red stamp
  return withShadow(grime(lay, cell, 1175 + seed, 0.16), cell);
}

function tokenCrateStack(cell) {                                                      // two tall crates and a bottle
  const [lay, d, cs] = layerFor(cell), { w, h } = lay, [cx, cy] = cs[0], r = new PyRandom(1180);
  crate(d, r, cx - cell * 0.38, cy - cell * 0.38, cx - cell * 0.04, cy + cell * 0.3, cell * 0.26, cell, 0.97);
  crate(d, r, cx + cell * 0.04, cy - cell * 0.36, cx + cell * 0.38, cy + cell * 0.32, cell * 0.26, cell, 1.02);
  const z = fine(w, h), paints = [];
  bottle(z, w, h, cx - cell * 0.02, cy + cell * 0.36, cell * 0.11, cell * 0.38, "ring", paints);
  const out = alphaCompositeAt(lay, project(w, h, z, bottlePaint(paints, cell), { gloss: 0.3 }));
  return withShadow(grime(out, cell, 1181, 0.14), cell);
}

function tokenAmmo(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0];
  const x0 = cx - cell * 0.34, x1 = cx + cell * 0.34, y0 = cy - cell * 0.14, y1 = cy + cell * 0.22, hh = cell * 0.16;
  box(d, x0, y0, x1, y1, hh, YELLOW, WOOD_DARK);
  d.rectangle([x0, y0 - hh, x1, y1 - hh], { outline: A(sh(YELLOW, 0.8)), width: 3 });
  d.text([cx - cell * 0.27, y0 - hh + cell * 0.03], "AMMO", T(cell * 0.22), A([70, 62, 60]), { family: "stencil" });
  for (let y = y1 - hh + 4; y < y1 - 2; y += cell * 0.045) d.line([[x0 + 2, y], [x1 - 2, y]], A(sh(WOOD_DARK, 0.86)), 1);   // wooden sides
  for (const ex of [x0 + cell * 0.07, x1 - cell * 0.13]) d.rectangle([ex, y1 - hh + 3, ex + cell * 0.06, y1 - hh + cell * 0.08], { fill: A([226, 226, 222]) });   // latches
  d.text([x0 + cell * 0.06, y1 - cell * 0.075], "200x", T(cell * 0.07), A([60, 70, 110]));
  return withShadow(grime(lay, cell, 1190, 0.1), cell);
}

// white supply boxes of mixed sizes on a pallet, held by two dark straps; coloured labels
function tokenSupplies(cell, seed = 0) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0], r = new PyRandom(1200 + seed);
  const x0 = cx - cell * 0.4, x1 = cx + cell * 0.4, y0 = cy - cell * 0.3, y1 = cy + cell * 0.32;
  d.rectangle([x0, y1 - cell * 0.06, x1, y1 + cell * 0.02], { fill: A(sh(WOOD_DARK, 0.8)) });   // the pallet
  for (const bx of [x0, cx - cell * 0.05, x1 - cell * 0.1]) d.rectangle([bx, y1 - cell * 0.05, bx + cell * 0.1, y1 + cell * 0.02], { fill: A(sh(WOOD, 0.8)) });
  const layout = [
    [[-0.4, -0.3, 0.0, 0.02, 0.26], [0.0, -0.3, 0.4, -0.06, 0.24], [0.02, -0.06, 0.4, 0.26, 0.2], [-0.4, 0.02, 0.02, 0.26, 0.22], [-0.3, -0.26, -0.04, -0.06, 0.32]],
    [[-0.4, -0.28, 0.4, 0.02, 0.22], [-0.4, 0.02, 0.1, 0.26, 0.22], [0.1, 0.02, 0.4, 0.26, 0.18], [-0.12, -0.24, 0.3, -0.02, 0.3]],
  ][seed % 2];
  for (const [a, b, c, e, hh] of layout) {
    const col = sh(BOX, r.uniform(0.95, 1.03)), H = cell * hh * 0.6, bx0 = cx + a * cell, bx1 = cx + c * cell, by0 = cy + b * cell, by1 = cy + e * cell;
    box(d, bx0, by0, bx1, by1, H, col, sh(col, 0.74), sh(col, 1.06));
    d.rectangle([bx0, by0 - H, bx1, by1 - H], { outline: A(sh(col, 0.84)), width: 1 });
    const lab = r.choice([[208, 84, 64], [70, 110, 160], [220, 150, 60]]);           // labels: stripes and a triangle
    if (r.random() < 0.7) d.rectangle([bx0 + cell * 0.03, by1 - H + cell * 0.03, bx0 + cell * 0.03 + (bx1 - bx0) * 0.5, by1 - H + cell * 0.045], { fill: A(lab) });
    if (r.random() < 0.5) d.rectangle([bx0 + cell * 0.03, by1 - H * 0.5, bx0 + cell * 0.12, by1 - H * 0.5 + cell * 0.02], { fill: A([60, 64, 70]) });
    if (r.random() < 0.3) { const tx = (bx0 + bx1) / 2, ty = (by0 + by1) / 2 - H; d.polygon([[tx, ty - cell * 0.03], [tx + cell * 0.03, ty + cell * 0.025], [tx - cell * 0.03, ty + cell * 0.025]], A([214, 96, 70])); }
  }
  for (const sx of [-0.16, 0.16]) {                                                  // the straps, over the top and down the front
    const x = cx + sx * cell;
    d.rectangle([x - cell * 0.016, y0 - cell * 0.2, x + cell * 0.016, y1 - cell * 0.02], { fill: A([54, 56, 60]) });
  }
  return withShadow(grime(lay, cell, 1205 + seed, 0.08), cell);
}

// grey concrete blocks on a wooden pallet: a 4 x 3 layer of cubes, the south row showing its faces
function tokenBlockPallet(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0], r = new PyRandom(1210);
  const x0 = cx - cell * 0.4, x1 = cx + cell * 0.4, y0 = cy - cell * 0.24, y1 = cy + cell * 0.32, hh = cell * 0.17;
  d.rectangle([x0, y1 - cell * 0.07, x1, y1 + cell * 0.01], { fill: A(sh(WOOD_DARK, 0.72)) });
  for (const bx of [x0, cx - cell * 0.05, x1 - cell * 0.1]) d.rectangle([bx, y1 - cell * 0.06, bx + cell * 0.1, y1 + cell * 0.01], { fill: A(sh(WOOD, 0.74)) });
  const sx = (x1 - x0) / 4, sy = (y1 - cell * 0.07 - y0) / 3;
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 4; i++) {
      const bx = x0 + i * sx + r.uniform(-1.5, 1.5), by = y0 + j * sy + r.uniform(-1.5, 1.5), col = sh(CONCRETE, r.uniform(0.94, 1.05));
      box(d, bx + 1, by, bx + sx - 2, by + sy - 1, hh, col, sh(col, 0.72));
      d.rectangle([bx + 1, by - hh, bx + sx - 2, by + sy - 1 - hh], { outline: A(sh(col, 0.84)), width: 1 });
      if (r.random() < 0.3) d.ellipse([bx + sx * 0.4, by - hh + sy * 0.3, bx + sx * 0.52, by - hh + sy * 0.42], { fill: A(sh(col, 0.7)) });   // a chip
    }
  return withShadow(grime(lay, cell, 1211, 0.16), cell);
}

// a hollow concrete block, long north-south, with a square opening in the top
function tokenHollowBlock(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0];
  const x0 = cx - cell * 0.22, x1 = cx + cell * 0.22, y0 = cy - cell * 0.3, y1 = cy + cell * 0.38, hh = cell * 0.2;
  box(d, x0, y0, x1, y1, hh, sh(CONCRETE, 0.96), sh(CONCRETE, 0.7), sh(CONCRETE, 1.08));
  d.rectangle([x0 + cell * 0.07, y0 - hh + cell * 0.06, x1 - cell * 0.07, y0 - hh + cell * 0.3], { fill: A([54, 58, 62]) });   // the opening
  d.rectangle([x0 + cell * 0.07, y0 - hh + cell * 0.06, x1 - cell * 0.07, y0 - hh + cell * 0.1], { fill: A([36, 38, 42]) });
  d.line([[x0, y0 - hh + cell * 0.38], [x1, y0 - hh + cell * 0.38]], A(sh(CONCRETE, 0.84)), 2);   // a cast joint
  d.rectangle([cx - cell * 0.06, y1 - hh * 0.55, cx + cell * 0.06, y1 - hh * 0.4], { fill: A([60, 64, 68]) });   // a fork slot
  const r = new PyRandom(1215);
  for (let i = 0; i < 10; i++) { const x = r.uniform(x0 + 4, x1 - 4), y = r.uniform(y0 - hh + 4, y1 - hh - 4); d.ellipse([x - 1.5, y - 1.5, x + 1.5, y + 1.5], { fill: A(sh(CONCRETE, 0.7)) }); }   // pores
  return withShadow(grime(lay, cell, 1216, 0.14), cell);
}

// --- pipes -----------------------------------------------------------------------------------------------------

// Big flanged pipes stacked 3-2-3, lying north-south with their open ends facing south, flanges at both
// ends, two steel straps with blue clamps over the top (Size 2). Ray-traced.
function tokenPipeBundle(cell) {
  const [lay, , cs] = layerFor(cell, size2Footprint(cell)), { w, h } = lay, [cx, cyc] = centroid(cs);
  const R = cell * 0.15, ys = cyc + cell * 0.55, len = cell * 1.0, fl = cell * 0.05, s3 = Math.sqrt(3);
  const rows = [[R, [-2, 0, 2]], [R * (1 + s3), [-1, 1]], [R * (1 + 2 * s3), [-2, 0, 2]]];
  const shapes = [], straps = [0.3, 0.7].map((f) => ys - len * f);
  for (const [zc, xs] of rows)
    for (const i of xs) {
      const x = cx + i * R;
      shapes.push(cylinder([x, ys - len + fl, zc], [x, ys - fl, zc], R, { kind: "pipe", zc }));
      shapes.push(cylinder([x, ys - fl, zc], [x, ys, zc], R * 1.14, { kind: "flange", zc }));
      shapes.push(cylinder([x, ys - len, zc], [x, ys - len + fl, zc], R * 1.14, { kind: "flange", zc }));
    }
  let out = trace(w, h, shapes, (sp, p, n) => {
    const { s, r, w: wv, cap } = onCyl(sp, p, n);
    if (sp.kind === "flange") {
      if (cap !== 1) return sh([84, 100, 112], mottle(p, 6, 0.2));
      if (r < R * 0.8) return wv[2] < 0 && r > R * 0.55 ? [70, 110, 186] : [26, 36, 70];     // the bore, its lit lower inside
      const a = Math.atan2(wv[2], wv[0]);
      if (Math.abs(r - R * 0.97) < R * 0.07 && Math.abs(((a / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.4) return [36, 44, 54];   // bolts
      return [96, 112, 124];
    }
    if (straps.some((y) => Math.abs(p[1] - y) < cell * 0.022)) return [38, 42, 50];            // the straps
    return sh([96, 116, 128], mottle(p, 7, 0.22));
  }, { gloss: 0.45 });
  const d = new Draw(out), top = R * (2 + 2 * s3);
  for (const y of straps) for (const i of [-1, 1]) {                                          // blue clamps between the top pipes
    const [x, yy] = screen(cx + i * R, y, top - R * 0.15);
    d.rectangle([x - cell * 0.022, yy - cell * 0.03, x + cell * 0.022, yy + cell * 0.03], { fill: A([60, 112, 176]), outline: A([30, 50, 80]), width: 1 });
  }
  for (const side of [-1, 1]) {                                                               // wooden chocks at the foot
    const [x, yy] = screen(cx + side * 3.3 * R, ys - cell * 0.04, 0);
    d.rectangle([x - cell * 0.03, yy - cell * 0.22, x + cell * 0.03, yy], { fill: A(sh(WOOD_DARK, 0.85)), outline: A(sh(WOOD_DARK, 0.6)), width: 1 });
  }
  out = chips(out, 1220, 30, cell);
  return withShadow(grime(out, cell, 1221, 0.08), cell, 0.06, 0.09, 0.05, 0.6);
}

// Dark pipes with yellow bands, stacked five wide and lying east-west in two black frames (two hexes)
function tokenPipeStack(cell) {
  const [lay, , cs] = layerFor(cell, row2(cell)), { w, h } = lay, [[xa, cy0], [xb]] = cs, cy = cy0 + cell * 0.12;
  const x0 = xa - cell * 0.44, x1 = xb + cell * 0.44, r = cell * 0.058, n = 5, Z = cell * 0.3, z = fine(w, h);
  const top = cy - n * r;
  fill(z, w, h, (x, y) => {                                                           // the top layer: rounded ridges east-west
    if (x + 0.5 < x0 || x + 0.5 > x1) return 0;
    const i = Math.floor((y + 0.5 - top) / (2 * r));
    if (i < 0 || i >= n) return 0;
    const u = (y + 0.5 - (top + (2 * i + 1) * r)) / r, endc = Math.min(x + 0.5 - x0, x1 - x - 0.5);
    return Math.abs(u) >= 1 ? 0 : Z - r + r * Math.sqrt(1 - u * u) - (endc < 2 ? 2 - endc : 0);
  });
  const band = (x) => { const e = Math.min(x - x0, x1 - x); return e > cell * 0.12 && e < cell * 0.2; };
  let out = project(w, h, z, (x, y, hgt, wall) => {
    if (wall) {                                                                        // the south face: the lower layers' ends
      const layer = Math.floor((hgt / Z) * 4);
      return layer % 2 === 0 ? [40, 48, 58] : [52, 62, 74];
    }
    return band(x) ? YELLOW : [62, 76, 90];
  }, { gloss: 0.45 });
  const d = new Draw(out);
  for (const fx of [xa - cell * 0.02, xb - cell * 0.12]) {                              // the frames
    d.rectangle([fx, top - Z - cell * 0.03, fx + cell * 0.12, cy + n * r - Z + cell * 0.03], { outline: A([30, 32, 38]), width: Math.max(3, T(cell * 0.025)) });
    d.rectangle([fx, cy + n * r - Z, fx + cell * 0.12, cy + n * r], { fill: A([30, 32, 38]) });
  }
  for (let i = 0; i < n; i++) {                                                        // the open ends at the east, in shadow
    const yc = top + (2 * i + 1) * r - Z;
    d.ellipse([x1 - r * 0.7, yc - r * 0.8, x1 + r * 0.3, yc + r * 0.8], { fill: A([22, 26, 32]) });
  }
  d.polygon([[xa + cell * 0.2, top - Z + cell * 0.25], [xa + cell * 0.27, top - Z + cell * 0.18], [xa + cell * 0.34, top - Z + cell * 0.25], [xa + cell * 0.27, top - Z + cell * 0.32]], A(YELLOW));   // a diamond label
  return withShadow(grime(chips(out, 1230, 40, cell), cell, 1231, 0.1), cell);
}

// A galvanised U-pipe: a run east-west held a little off the floor, bending down at both ends into flange
// plates on the floor, with two collars (three hexes in a row). Ray-traced; the bends are swept spheres.
function tokenUPipe(cell) {
  const [lay, , cs] = layerFor(cell, row3(cell)), { w, h } = lay, [cx, cy0] = cs[0], cy = cy0 + cell * 0.12;
  const R = cell * 0.15, B = cell * 0.24, L = cell * 1.28, shapes = [];
  shapes.push(cylinder([cx - L + B, cy, B], [cx + L - B, cy, B], R, { kind: "pipe" }));
  for (const side of [-1, 1]) {
    const ax = cx + side * (L - B);                                                     // the bend: a quarter circle down to the floor
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * (Math.PI / 2 + 0.3);
      shapes.push(sphere([ax + side * B * Math.sin(Math.min(a, Math.PI / 2)), cy, B * Math.cos(a) - (a > Math.PI / 2 ? B * (a - Math.PI / 2) : 0)], R, { kind: "pipe" }));
    }
    shapes.push(cylinder([cx + side * L, cy, 0], [cx + side * L, cy, cell * 0.03], R * 1.6, { kind: "plate", gloss: 0.2 }));
    shapes.push(cylinder([cx + side * L * 0.55 - cell * 0.025, cy, B], [cx + side * L * 0.55 + cell * 0.025, cy, B], R * 1.12, { kind: "collar" }));
  }
  const out = trace(w, h, shapes, (sp, p, n) => {
    if (sp.kind === "plate") {
      const { r, w: wv, cap } = onCyl(sp, p, n);
      const a = Math.atan2(wv[1], wv[0]);
      if (cap === 1 && Math.abs(r - R * 1.35) < R * 0.1 && Math.abs(((a / (Math.PI / 3)) % 1 + 1) % 1 - 0.5) > 0.42) return [160, 170, 176];   // bolts
      return [70, 86, 96];
    }
    if (sp.kind === "collar") return sh([124, 140, 144], mottle(p, 5, 0.15));
    return sh([150, 168, 170], mottle(p, 4, 0.28));
  }, { gloss: 0.5 });
  return withShadow(grime(out, cell, 1241, 0.06), cell);
}


// --- concrete and steel obstacles ------------------------------------------------------------------------------------

// The obstacles' concrete: cool grey, a notch darker than the pallet blocks, with a faint mottle
const CAST = [128, 133, 132];
const castPaint = (seed) => (x, y) => sh(CAST, 0.93 + 0.14 * vnoise(x / 9 + seed, y / 9, seed));

// A three-legged concrete tetrapod: legs to the west-south-west, the south-east and the north, flat-topped
// with chamfered sides, and an upright arm: a sharp three-sided spike (it shows pointing up the token, in
// line with the north leg). A lit fine field. Variants: 1 and 2 are mirror images; 3 and 4 are turned and a
// little smaller or larger.
function tokenTetrapod(cell, seed = 0) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, z = fine(w, h);
  const [turn, mirror, size] = [[0, 1, 1], [0, -1, 1], [24, 1, 0.92], [-20, -1, 1.05]][seed % 4];
  const cx = cs[0][0], cy = cs[0][1] + cell * 0.12, rot = (turn * Math.PI) / 180;
  const dir = (deg) => { const a = (deg * Math.PI) / 180 + rot; return [mirror * Math.cos(a), Math.sin(a)]; };
  const legs = [160, 35, -80].map(dir);
  const Lg = cell * 0.42 * size, hc = cell * 0.15 * size, spike = cell * 0.34 * size, sb = cell * 0.12 * size;
  const faces = [90, 210, 330].map(dir);                                                   // the spike's three faces
  fill(z, w, h, (x, y) => {
    const px = x + 0.5 - cx, py = y + 0.5 - cy;
    let v = 0;
    for (const [ux, uy] of legs) {
      const along = px * ux + py * uy, across = Math.abs(-px * uy + py * ux);
      if (along < -cell * 0.05 || along > Lg) continue;
      const f = Math.max(0, along) / Lg, ridge = hc * (1 - f * 0.55), half = cell * 0.1 * size * (1 - f * 0.35);
      if (across < half) v = Math.max(v, across < half * 0.5 ? ridge : ridge * (1 - ((across - half * 0.5) / (half * 0.5)) * 0.55));
    }
    const dd = Math.max(...faces.map(([fx, fy]) => px * fx + py * fy));                   // distance to the spike's faces
    if (dd < sb) v = Math.max(v, spike * (1 - dd / sb));
    return v;
  });
  const out = project(w, h, z, castPaint(seed), { gloss: 0.08 });
  return withShadow(grime(chips(out, 1250 + seed, 10, cell, [70, 74, 74]), cell, 1255 + seed, 0.1), cell);
}

// A concrete dragon's tooth: a square frustum with sharp edges, lit on its west face and shaded on its east,
// a little twisted and off-centre per variant, v3 with a chipped corner. A lit fine field.
function tokenDragonTooth(cell, seed = 0) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, z = fine(w, h);
  const [turn, size, ox, oy] = [[0, 1, 0, 0], [14, 0.9, 0.04, -0.03], [-11, 1.06, -0.03, 0.02]][seed % 3];
  const cx = cs[0][0] + ox * cell, cy = cs[0][1] + cell * 0.1 + oy * cell, a = (turn * Math.PI) / 180;
  const b = cell * 0.29 * size, t = cell * 0.12 * size, H = cell * 0.26 * size;
  const dents = seed === 2 ? [[b * 0.85, -b * 0.8, cell * 0.09], [-b * 0.7, b * 0.9, cell * 0.05]] : [[b * 0.9, b * 0.9, cell * 0.035]];
  fill(z, w, h, (x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a);
    const e = Math.max(Math.abs(u), Math.abs(v));
    if (e > b) return 0;
    let zz = H * Math.min(1, (b - e) / (b - t));
    for (const [du, dv, rr] of dents) { const q = Math.hypot(u - du, v - dv); if (q < rr) zz = Math.min(zz, H * 0.4 + (q / rr) * H * 0.6); }   // chips
    return zz;
  });
  const out = project(w, h, z, castPaint(seed + 7), { gloss: 0.08 });
  return withShadow(grime(chips(out, 1265 + seed, 8, cell, [70, 74, 74]), cell, 1268 + seed, 0.1), cell);
}

// Sheet piling running east-west: corrugated dark steel with lit and shaded flutes, a capping rail and
// bolted brackets; tiles along a row
function tokenSheetWall(cell) {
  const [lay, d, cs] = layerFor(cell), [, cy0] = cs[0], w = lay.w, cy = cy0 + cell * 0.14;
  const H = cell * 0.46, th = cell * 0.08, pitch = cell * 0.1;
  for (let x = 0; x < w; x += pitch) {                                                // the south face: flutes
    d.rectangle([x, cy - H, x + pitch * 0.35, cy], { fill: A(sh(PILING, 1.15)) });
    d.rectangle([x + pitch * 0.35, cy - H, x + pitch * 0.55, cy], { fill: A(sh(PILING, 0.95)) });
    d.rectangle([x + pitch * 0.55, cy - H, x + pitch * 0.85, cy], { fill: A(sh(PILING, 0.75)) });
    d.rectangle([x + pitch * 0.85, cy - H, x + pitch, cy], { fill: A(sh(PILING, 0.9)) });
  }
  d.rectangle([0, cy - H - th, w, cy - H], { fill: A(sh(PILING, 1.3)) });              // the top edge, seen from above
  for (let x = 0; x < w; x += pitch) d.line([[x + pitch * 0.35, cy - H - th], [x + pitch * 0.55, cy - H - 1]], A(sh(PILING, 0.9)), 1);
  d.line([[0, cy - H], [w, cy - H]], A(sh(PILING, 1.55)), 1);
  for (const bx of [cell * 0.16, w / 2 + cell * 0.05, w - cell * 0.22]) {             // brackets
    d.rectangle([bx, cy - H - th - 2, bx + cell * 0.06, cy], { fill: A(sh(PILING, 0.62)) });
    for (const by of [cy - H * 0.8, cy - H * 0.3]) d.rectangle([bx - 3, by, bx + cell * 0.06 + 3, by + cell * 0.04], { fill: A(sh(PILING, 0.7)) });
  }
  return withShadow(lay, cell, 0.03, 0.06, 0.02, 0.55);                              // edge to edge: tiles join
}

// a steel railing running east-west across the hex from edge to edge: a post at each edge (half of it here,
// half in the next tile) and one in the middle, a top rail and a mid rail, foot plates. Tiles along a row.
export function tokenRailing(cell, col = [98, 112, 126], foot = [70, 80, 90]) {
  const [lay, , cs] = layerFor(cell), { w, h } = lay, [cx, cy0] = cs[0], cy = cy0 + cell * 0.12, H = cell * 0.34, rp = cell * 0.022;
  const shapes = [];
  for (const x of [cx - cell / 2, cx, cx + cell / 2]) {
    shapes.push(cylinder([x, cy, 0], [x, cy, H + rp], rp, { kind: "post" }));
    shapes.push(cylinder([x, cy, 0], [x, cy, cell * 0.01], rp * 1.7, { kind: "foot", gloss: 0 }));
  }
  for (const z of [H, H * 0.5]) shapes.push(cylinder([cx - cell / 2 - rp, cy, z], [cx + cell / 2 + rp, cy, z], rp * 0.9, { kind: "rail" }));
  const out = trace(w, h, shapes, (sp) => (sp.kind === "foot" ? foot : col), { gloss: 0.5 });
  return withShadow(out, cell, 0.03, 0.06, 0.02, 0.5);
}

// the dark container: a ribbed roof with corner castings, a corrugated south side with a worn orange band
// (three hexes in a row)
export function tokenContainer(cell, roof = [66, 70, 88], side = [40, 58, 82], band = [204, 136, 62]) {
  const [lay, d, cs] = layerFor(cell, row3(cell)), [cx, cy0] = cs[0], cy = cy0 + cell * 0.12;
  const x0 = cx - cell * 1.36, x1 = cx + cell * 1.36, y0 = cy - cell * 0.3, y1 = cy + cell * 0.36, H = cell * 0.28;
  d.rectangle([x0, y1 - H, x1, y1], { fill: A(side) });
  for (let x = x0; x < x1; x += cell * 0.07) d.rectangle([x + cell * 0.035, y1 - H, x + cell * 0.07, y1], { fill: A(sh(side, 0.78)) });   // corrugation
  const r = new PyRandom(1260);
  for (let x = x0 + cell * 0.1; x < x1 - cell * 0.1; x += cell * 0.07) {               // the worn orange band
    const drip = r.uniform(0, cell * 0.05);
    d.rectangle([x, y1 - H * 0.72, x + cell * 0.07, y1 - H * 0.36 + drip], { fill: A(sh(band, x % 2 ? 1 : 0.9)) });
  }
  d.rectangle([x0, y0 - H, x1, y1 - H], { fill: A(roof) });
  const mid = (x0 + x1) / 2, top = y0 - H, bot = y1 - H, step = cell * 0.09;
  for (let k = top - (mid - x0); k < bot; k += step) {                                  // the roof ribs: a herringbone
    const ka = Math.max(top, k), kb = Math.min(bot, k + (mid - x0));
    d.line([[x0 + (ka - k), ka], [x0 + (kb - k), kb]].map(([x, y]) => [Math.min(mid, x), y]), A(sh(roof, 0.8)), 2);
    d.line([[x1 - (ka - k), ka], [x1 - (kb - k), kb]].map(([x, y]) => [Math.max(mid, x), y]), A(sh(roof, 0.8)), 2);
  }
  d.rectangle([x0, top, x1, bot], { outline: A(sh(roof, 0.6)), width: 3 });
  d.line([[x0, bot + 2], [x1, bot + 2]], A(sh(side, 1.4)), 2);
  for (const [px, py] of [[x0, top], [x1, top], [x0, bot], [x1, bot]]) {                // corner castings
    const s = cell * 0.05, qx = px === x0 ? px + s : px - s, qy = py === top ? py + s : py - s;
    d.ellipse([qx - s, qy - s, qx + s, qy + s], { fill: A([150, 156, 168]), outline: A([40, 44, 54]), width: 2 });
  }
  return withShadow(grime(lay, cell, 1261, 0.12), cell, 0.06, 0.09, 0.05, 0.6);
}

// steel slabs stacked east-west: holes along the top, pegs at the ends, two straps (two hexes)
function tokenSlabs(cell) {
  const [lay, d, cs] = layerFor(cell, row2(cell)), [[xa, cy0], [xb]] = cs, cy = cy0 + cell * 0.1;
  const x0 = xa - cell * 0.4, x1 = xb + cell * 0.4, n = 5, sw = cell * 0.13, H = cell * 0.24, steel = [90, 92, 108];
  const top = cy - n * sw * 0.5;
  d.rectangle([x0, top + n * sw - H, x1, top + n * sw], { fill: A(sh(steel, 0.66)) });   // the south face: slab edges
  for (let i = 0; i < 4; i++) d.line([[x0, top + n * sw - H + (i + 1) * H / 5], [x1, top + n * sw - H + (i + 1) * H / 5]], A(sh(steel, 0.5)), 2);
  for (let i = 0; i < n; i++) {                                                          // the top slabs
    const y = top + i * sw - H;
    d.rectangle([x0, y, x1, y + sw - 2], { fill: A(sh(steel, [1.02, 0.96, 1.05, 0.98, 1.0][i])) });
    d.line([[x0, y], [x1, y]], A(sh(steel, 1.3)), 1);
    for (const hx of [0.3, 0.7]) { const x = x0 + (x1 - x0) * hx, yy = y + sw / 2 - 1; d.ellipse([x - cell * 0.03, yy - cell * 0.022, x + cell * 0.03, yy + cell * 0.022], { fill: A([28, 28, 34]) }); }
    for (const ex of [x0 + cell * 0.05, x1 - cell * 0.13]) d.rectangle([ex, y + sw * 0.35, ex + cell * 0.08, y + sw * 0.65], { fill: A([30, 30, 36]) });   // pegs
  }
  for (const sx of [0.18, 0.82]) { const x = x0 + (x1 - x0) * sx; d.rectangle([x - cell * 0.03, top - H - 2, x + cell * 0.03, top + n * sw], { fill: A([56, 76, 100]) }); }   // straps
  d.polygon([[x1 - cell * 0.35, top - H + cell * 0.3], [x1 - cell * 0.28, top - H + cell * 0.23], [x1 - cell * 0.21, top - H + cell * 0.3], [x1 - cell * 0.28, top - H + cell * 0.37]], A(YELLOW));
  return withShadow(grime(lay, cell, 1270, 0.12), cell);
}

export const TOKENS = {
  dp_tank_size2_v1: (c) => tokenTank(c, 0),
  dp_tank_size2_v2: (c) => tokenTank(c, 1),
  dp_tank_tall_size2: tokenTallTank,
  dp_tank_lying_3hex: tokenLyingTank,
  dp_bottles_v1: (c) => tokenBottles(c, 0),
  dp_bottles_v2: (c) => tokenBottles(c, 1),
  dp_bottles_v3: (c) => tokenBottles(c, 2),
  dp_drums_v1: (c) => tokenDrums(c, 0),
  dp_drums_v2: (c) => tokenDrums(c, 1),
  dp_crate_v1: (c) => tokenCrate(c, 0),
  dp_crate_v2: (c) => tokenCrate(c, 1),
  dp_crate_v3: (c) => tokenCrate(c, 2),
  dp_crate_stack: tokenCrateStack,
  dp_ammo_crate: tokenAmmo,
  dp_supplies_v1: (c) => tokenSupplies(c, 0),
  dp_supplies_v2: (c) => tokenSupplies(c, 1),
  dp_block_pallet: tokenBlockPallet,
  dp_hollow_block: tokenHollowBlock,
  dp_pipe_bundle_size2: tokenPipeBundle,
  dp_pipe_stack_2hex: tokenPipeStack,
  dp_u_pipe_3hex: tokenUPipe,
  dp_tetrapod_v1: (c) => tokenTetrapod(c, 0),
  dp_tetrapod_v2: (c) => tokenTetrapod(c, 1),
  dp_tetrapod_v3: (c) => tokenTetrapod(c, 2),
  dp_tetrapod_v4: (c) => tokenTetrapod(c, 3),
  dp_dragon_tooth_v1: (c) => tokenDragonTooth(c, 0),
  dp_dragon_tooth_v2: (c) => tokenDragonTooth(c, 1),
  dp_dragon_tooth_v3: (c) => tokenDragonTooth(c, 2),
  dp_sheet_wall: tokenSheetWall,
  dp_railing: tokenRailing,
  dp_container_3hex: tokenContainer,
  dp_slabs_2hex: tokenSlabs,
};

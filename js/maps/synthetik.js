// What the Synthetik styles share (Training Floor, Depot): the floor's maze pattern and the robot
// remains. Colours come from the style, so each level keeps its own paint and oil.

import { PyRandom } from "../rng.js";
import { newImage, Draw, alphaComposite, gaussianBlur, u8 } from "../raster.js";
import { noise } from "./common.js";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// The floor's maze pattern: thick, soft bands winding in 60° turns with rounded bends and curled ends,
// spread over the whole floor. Grown as random walks on a triangular lattice; a band may not come next
// to another, so the gaps stay even. `amount` scales the paint's opacity (alpha34 at 1).
export function maze(img, cell, amount, rgb, alpha = 34) {
  if (!amount) return img;
  const { w, h } = img, over = newImage("RGBA", w, h), d = new Draw(over), r = new PyRandom(104);
  const s = cell * 0.21, rowH = (s * Math.sqrt(3)) / 2, lw = Math.max(4, Math.trunc(cell * 0.14));
  const cols = Math.ceil(w / s) + 3, rows = Math.ceil(h / rowH) + 3;
  const pos = (i, j) => [(i - 1) * s + (j % 2 ? s / 2 : 0), (j - 1) * rowH];
  const DIRS = [[1, 0], [0.5, 1], [-0.5, 1], [-1, 0], [-0.5, -1], [0.5, -1]];         // in lattice steps (x in s, y in rows)
  const step = ([i, j], k) => {                                                      // the neighbour in direction k (odd-row offset)
    const [dx, dy] = DIRS[k];
    if (dy === 0) return [i + dx, j];
    const odd = j % 2 === 1;
    return [dx > 0 ? (odd ? i + 1 : i) : (odd ? i : i - 1), j + dy];
  };
  const used = new Set(), key = (p) => p[0] + "," + p[1];
  const free = (p, from) => {
    if (p[0] < 0 || p[1] < 0 || p[0] >= cols || p[1] >= rows || used.has(key(p))) return false;
    for (let k = 0; k < 6; k++) { const q = step(p, k); if (used.has(key(q)) && (!from || key(q) !== key(from))) return false; }
    return true;
  };
  const col = [...rgb, Math.min(255, Math.round(alpha * amount))];
  const order = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) order.push([i, j]);
  r.shuffle(order);
  for (const start of order) {
    if (!free(start, null)) continue;
    const path = [start];
    used.add(key(start));
    let dir = r.randint(0, 5), cur = start;
    const len = r.randint(12, 45), bias = r.choice([1, -1]);                         // each band leans one way: spirals
    for (let n = 0; n < len; n++) {
      const t = r.random();
      const tries = t < 0.5 ? [0, bias, -bias] : t < 0.88 ? [bias, 0, -bias] : [-bias, 0, bias];
      let moved = false;
      for (const turn of tries) {
        const k = (((dir + turn) % 6) + 6) % 6, nxt = step(cur, k);
        if (!free(nxt, cur)) continue;
        used.add(key(nxt)); path.push(nxt); cur = nxt; dir = k; moved = true;
        break;
      }
      if (!moved) break;
    }
    if (path.length < 2) continue;
    const pts = path.map(([i, j]) => pos(i, j));
    d.line(pts, col, lw, "curve");
    for (const [x, y] of [pts[0], pts[pts.length - 1]]) d.ellipse([x - lw / 2, y - lw / 2, x + lw / 2, y + lw / 2], { fill: col });   // round ends
  }
  return alphaComposite(img, gaussianBlur(over, cell * 0.022));                     // soft, rounded bends
}

// Robot remains: dark oil splats with a wet halo, torn edges, angular shards and metal chunks.
// The splats are drawn as masks (body, core), then given torn edges and a gritty inside with noise;
// the shards and chunks go on last. `pal` = { oil, core, halo, haloAlpha, shards, chunks } (colours;
// shards and chunks as [r, g, b, a]). `density` scales the scattered splats; focusHexes get a big one.
export function remains(img, cell, density, pal, focusHexes = []) {
  const { w, h } = img, r = new PyRandom(131), area = (w * h) / (cell * cell);
  const spots = [];
  const n = Math.round((area / 16) * density);
  for (let i = 0; i < n; i++) spots.push([r.uniform(0, w), r.uniform(0, h), cell * r.uniform(0.35, 0.95), r.random() < 0.6]);
  for (const [cx, cy] of focusHexes) spots.push([cx, cy, cell * 1.05, true]);                        // blown-up robots
  if (!spots.length) return img;
  const body = newImage("L", w, h), core = newImage("L", w, h), bd = new Draw(body), cd = new Draw(core);
  const chunks = newImage("RGBA", w, h), kd = new Draw(chunks);
  for (const [cx, cy, R, wreck] of spots) {
    splat(bd, r, cx, cy, R, 255);
    for (let i = r.randint(3, 6); i > 0; i--) {                                                      // the dark core
      const a = r.uniform(0, 2 * Math.PI), dd = R * r.uniform(0, 0.35), s = R * r.uniform(0.16, 0.34);
      cd.ellipse([cx + Math.cos(a) * dd - s, cy + Math.sin(a) * dd - s * 0.8, cx + Math.cos(a) * dd + s, cy + Math.sin(a) * dd + s * 0.8], { fill: 255 });
    }
    for (let i = r.randint(110, 220); i > 0; i--) {                                                  // angular shards round it
      const a = r.uniform(0, 2 * Math.PI), dd = R * r.uniform(0.6, 2.6), x = cx + Math.cos(a) * dd, y = cy + Math.sin(a) * dd * 0.9;
      const s = cell * r.uniform(0.008, 0.03) * Math.max(0.5, 2.2 - dd / R), q = [];
      for (let k = r.randint(3, 4); k > 0; k--) { const px = x + r.uniform(-s, s); q.push([px, y + r.uniform(-s, s)]); }
      kd.polygon(q, r.choice(pal.shards));
    }
    if (!wreck) continue;
    for (let i = r.randint(3, 8); i > 0; i--) {                                                      // metal chunks
      const a = r.uniform(0, 2 * Math.PI), dd = R * r.uniform(0, 1.2), x = cx + Math.cos(a) * dd, y = cy + Math.sin(a) * dd * 0.9;
      const s = R * r.uniform(0.04, 0.13), q = [];
      for (let k = 0; k < 5; k++) { const b = (2 * Math.PI * k) / 5 + r.uniform(-0.4, 0.4); q.push([x + Math.cos(b) * s * r.uniform(0.5, 1.1), y + Math.sin(b) * s * r.uniform(0.5, 1.1)]); }
      kd.polygon(q, r.choice(pal.chunks));
    }
  }
  const soft = gaussianBlur(body, cell * 0.016), halo = gaussianBlur(body, cell * 0.1), coreSoft = gaussianBlur(core, cell * 0.05);
  const rough = noise(h, w, cell * 0.12, 132), grit = noise(h, w, cell * 0.05, 133);
  const wet = newImage("RGBA", w, h), over = newImage("RGBA", w, h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const hv = clamp((halo.data[p] / 255 + (rough[p] - 0.5) * 0.5 - 0.22) * 3);                   // a lighter, wet halo
    if (hv) { wet.data[i] = pal.halo[0]; wet.data[i + 1] = pal.halo[1]; wet.data[i + 2] = pal.halo[2]; wet.data[i + 3] = u8(hv * pal.haloAlpha); }
    const edge = soft.data[p] / 255 + (rough[p] - 0.5) * 0.55;                                       // a torn, irregular edge
    const a = clamp((edge - 0.5) * 6);
    if (!a) continue;
    const c = clamp(coreSoft.data[p] / 255 * 1.4) * 0.6, g = 0.78 + 0.32 * grit[p];                 // darker core, gritty inside
    for (let k = 0; k < 3; k++) over.data[i + k] = u8(lerp(pal.oil[k], pal.core[k], c));
    over.data[i + 3] = u8(a * 225 * Math.min(1, g));
  }
  return alphaComposite(alphaComposite(alphaComposite(img, wet), over), chunks);
}

// One splat, like the game's: overlapping lumpy blobs, thin tapering streaks that end in a drop, and
// fine spatter. (One fill: overlaps don't darken, as drawing replaces pixels; the core is a second pass.)
function splat(d, r, cx, cy, R, colBody) {
  const blob = (x, y, s, fill) => d.ellipse([x - s, y - s * r.uniform(0.7, 1), x + s, y + s * r.uniform(0.7, 1)], { fill });
  const at = (a, dd) => [cx + Math.cos(a) * dd, cy + Math.sin(a) * dd * 0.9];
  for (let i = r.randint(6, 10); i > 0; i--) { const [x, y] = at(r.uniform(0, 2 * Math.PI), R * r.uniform(0, 0.45)); blob(x, y, R * r.uniform(0.28, 0.55), colBody); }
  for (let i = r.randint(10, 18); i > 0; i--) { const [x, y] = at(r.uniform(0, 2 * Math.PI), R * r.uniform(0.45, 0.95)); blob(x, y, R * r.uniform(0.1, 0.28), colBody); }
  for (let i = r.randint(6, 12); i > 0; i--) {                                // streaks: tapered, ending in a drop
    const a = r.uniform(0, 2 * Math.PI), d0 = R * r.uniform(0.4, 0.7), d1 = R * r.uniform(0.95, 1.55), wd = R * r.uniform(0.03, 0.07);
    const [x0, y0] = at(a, d0), [x1, y1] = at(a, d1), nx = -Math.sin(a) * wd, ny = Math.cos(a) * wd;
    d.polygon([[x0 + nx, y0 + ny], [x1, y1], [x0 - nx, y0 - ny]], colBody);
    if (r.random() < 0.7) blob(x1, y1, wd * r.uniform(0.8, 1.6), colBody);
  }
  for (let i = r.randint(45, 85); i > 0; i--) {                               // fine spatter
    const dd = R * r.uniform(0.9, 2.5), [x, y] = at(r.uniform(0, 2 * Math.PI), dd), s = R * r.uniform(0.015, 0.06) * (2.7 - dd / R);
    blob(x, y, s, colBody);
  }
  for (let i = r.randint(3, 6); i > 0; i--) { const [x, y] = at(r.uniform(0, 2 * Math.PI), R * r.uniform(0, 0.35)); blob(x, y, R * r.uniform(0.14, 0.3), colBody); }
}

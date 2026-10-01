// Ballistic Silos tokens (names start bs_), after Synthetik's Ballistic Silos: missile nose cones in blue
// launch racks, open and bolted silo mouths, blue tanks in scaffold cages (lying and standing), the big blue
// silo lid, blue gas bottles and drums, the navy container and the blue railing. The Depot set (dp_) and
// the Training Floor's dragon's tooth fit this floor too: hollow blocks, tetrapods, crates, pipe stacks,
// sheet piling. Reference: _backstage/reference/synthetik/ballistic_silos/.
//
// Drawn with the Depot's tools (tokens/depot.js): racks flat, round parts as lit height fields or ray-traced.

import { PyRandom } from "../rng.js";
import { alphaCompositeAt, Draw } from "../raster.js";
import { grime, size2Footprint } from "./kit.js";
import { groundShadow } from "./shadow.js";

const withShadow = (obj, cell) => groundShadow(obj, cell);                      // stood on the floor (shadow.js), not the kit's offset copy
import { layerFor, centroid, row3, project, fine, fill, addCyl, chips, trace, cylinder, onCyl, mottle, screen, sh, A,
  tokenRailing, tokenBottles, tokenDrums, tokenContainer } from "./depot.js";

const T = Math.trunc;
const BLUE = [40, 92, 166], BLUE_DARK = [26, 58, 112], FRAME = [42, 46, 60], FRAME_LIT = [86, 92, 112];
const CONE = [56, 54, 68], RED = [190, 56, 52], YELLOW = [222, 160, 58];

// A launch rack seen from above with its south face: a blue box braced with dark X's, a dark deck, and four
// posts rising to a square top ring. part: "back" (the deck, the far posts), "front" (near posts, ring, braces)
function rack(d, cx, cy, a, Hb, Hf, part, cell) {
  const t = Math.max(3, T(cell * 0.028)), x0 = cx - a, x1 = cx + a, y0 = cy - a * 0.8, y1 = cy + a * 0.8;
  const P = (x, y, z) => [x, y - z];                                                  // heights 1:1, as the height fields show them
  if (part === "back") {
    d.rectangle([x0, y1 - Hb, x1, y1], { fill: A(BLUE) });                                  // the blue south face
    d.rectangle([x0, y1 - Hb, x1, y1], { outline: A(FRAME), width: t });
    for (const [a0, a1] of [[x0, cx], [cx, x1]]) {                                         // X braces
      d.line([[a0, y1 - Hb], [a1, y1]], A(FRAME), t);
      d.line([[a0, y1], [a1, y1 - Hb]], A(FRAME), t);
    }
    d.line([[cx, y1 - Hb], [cx, y1]], A(FRAME), t);
    d.rectangle([x0, y0 - Hb, x1, y1 - Hb], { fill: A(sh(BLUE, 0.8)), outline: A(FRAME), width: t });   // the deck
    d.rectangle([x0 + a * 0.12, y0 - Hb + a * 0.1, x1 - a * 0.12, y1 - Hb - a * 0.1], { fill: A([34, 36, 48]) });
    for (const x of [x0, x1]) d.line([P(x, y0, Hb), P(x, y0, Hf)], A(FRAME), t);            // the far posts
    d.line([P(x0, y0, Hf), P(x1, y0, Hf)], A(FRAME), t);
    return;
  }
  for (const x of [x0, x1]) { d.line([P(x, y1, Hb), P(x, y1, Hf)], A(FRAME), t); d.line([P(x, y1, Hb) , P(x, y1, Hf)].map(([px, py]) => [px - 1, py]), A(FRAME_LIT), 1); }
  d.line([P(x0, y1, Hf), P(x1, y1, Hf)], A(FRAME), t);                                      // the top ring's near side
  for (const x of [x0, x1]) d.line([P(x, y0, Hf), P(x, y1, Hf)], A(FRAME), t);
  for (const [xa, xb] of [[x0, x1]]) { d.line([P(xa, y1, Hb), P(xb, y1, Hf)], A(FRAME), t - 1); d.line([P(xa, y1, Hf), P(xb, y1, Hb)], A(FRAME), t - 1); }   // front upper brace
}

// --- the missile in its rack (Size 2) -----------------------------------------------------------------------

function tokenMissile(cell) {
  const [lay, d, cs] = layerFor(cell, size2Footprint(cell)), { w, h } = lay, [cx, cyc] = centroid(cs), cy = cyc + cell * 0.3;
  const a = cell * 0.5, Hb = cell * 0.36, Hf = cell * 0.8;
  rack(d, cx, cy, a, Hb, Hf, "back", cell);
  const z = fine(w, h), Rc = a * 0.78, Hc = cell * 1.0;                                     // the nose cone, standing in the rack
  fill(z, w, h, (x, y) => { const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); return r < Rc ? Hb + Hc * Math.pow(1 - r / Rc, 0.8) : 0; });
  const r0 = new PyRandom(1400);
  const flecks = Array.from({ length: 10 }, () => [r0.uniform(0, 2 * Math.PI), r0.uniform(0.2, 0.8)]);
  const cone = project(w, h, z, (x, y, hgt) => {
    if (hgt < Hb + 1) return null;                                                       // inside the rack, below its deck
    const ang = Math.atan2(y + 0.5 - cy, x + 0.5 - cx), v = (hgt - Hb) / Hc;
    if (Math.abs(ang - 2.2) < 0.18 && v > 0.25 && v < 0.4) return YELLOW;                // the yellow mark
    if (flecks.some(([fa, fv]) => Math.abs(ang - (fa - Math.PI)) < 0.08 && Math.abs(v - fv) < 0.03)) return [210, 212, 220];   // chipped paint
    return CONE;
  }, { gloss: 0.4 });
  alphaCompositeAt(lay, cone);
  rack(d, cx, cy, a, Hb, Hf, "front", cell);
  return withShadow(grime(chips(lay, 1401, 30, cell), cell, 1402, 0.1), cell, 0.06, 0.09, 0.05, 0.6);
}

// --- a silo mouth in its rack (Size 2): v1 capped with red bolt rings, v2 open ------------------------------------

function tokenSilo(cell, open = false) {
  const [lay, d, cs] = layerFor(cell, size2Footprint(cell)), { w, h } = lay, [cx, cyc] = centroid(cs), cy = cyc + cell * 0.3;
  const a = cell * 0.5, Hb = cell * 0.36, Hf = cell * 0.62, R = a * 0.82, Hm = cell * 0.14;
  rack(d, cx, cy, a, Hb, Hf, "back", cell);
  const z = fine(w, h);
  addCyl(z, w, h, cx, cy, R, Hb + Hm, 3);
  if (!open) addCyl(z, w, h, cx, cy, R * 0.34, Hb + Hm + cell * 0.04, 2, cell * 0.02);
  const bolts = Array.from({ length: 10 }, (_, k) => (k / 10) * Math.PI * 2);
  const mouth = project(w, h, z, (x, y, hgt, wall) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    if (wall) return hgt < Hb + 1 ? null : [44, 42, 58];                                // hidden below the deck
    if (open) {
      if (r < R * 0.62) return [14, 14, 20];                                              // the dark shaft
      if (bolts.some((b) => Math.hypot(dx - Math.cos(b) * R * 0.8, dy - Math.sin(b) * R * 0.8) < R * 0.07)) return [20, 20, 28];   // bolt holes
      return [58, 56, 72];
    }
    for (const b of bolts) {                                                               // red bolt rings
      const q = Math.hypot(dx - Math.cos(b) * R * 0.72, dy - Math.sin(b) * R * 0.72);
      if (q < R * 0.13) return q > R * 0.07 ? RED : [40, 30, 36];
    }
    if (r < R * 0.34) return Math.floor(r / (cell * 0.03)) % 2 ? [70, 72, 84] : [50, 52, 64];   // the grille in the middle
    return [54, 52, 68];
  }, { gloss: 0.3 });
  alphaCompositeAt(lay, mouth);
  rack(d, cx, cy, a, Hb, Hf, "front", cell);
  return withShadow(grime(chips(lay, 1410 + open, 30, cell), cell, 1412 + open, 0.1), cell, 0.06, 0.09, 0.05, 0.6);
}

// --- a blue tank lying east-west in a braced scaffold cage (three hexes in a row) -------------------------------------

function tokenTankRack(cell) {
  const [lay, d, cs] = layerFor(cell, row3(cell)), { w, h } = lay, [cx, cy0] = cs[0], cy = cy0 + cell * 0.22;
  const L = cell * 1.3, R = cell * 0.27, zc = R + cell * 0.04, Hc = zc + R + cell * 0.04, t = Math.max(3, T(cell * 0.026));
  const x0 = cx - L, x1 = cx + L, yN = cy - R * 1.1, yS = cy + R * 1.1, P = (x, y, z) => screen(x, y, z);
  for (let x = x0; x <= x1 + 1; x += (x1 - x0) / 4) d.line([P(x, yN, 0), P(x, yN, Hc)], A(FRAME), t);   // the far posts
  d.line([P(x0, yN, Hc), P(x1, yN, Hc)], A(FRAME), t);
  const tank = trace(w, h, [
    cylinder([x0 + cell * 0.12, cy, zc], [x1 - cell * 0.12, cy, zc], R, { kind: "body" }),
    cylinder([x0 + cell * 0.04, cy, zc], [x0 + cell * 0.12, cy, zc], R * 0.9, { kind: "cap" }),
    cylinder([x1 - cell * 0.12, cy, zc], [x1 - cell * 0.04, cy, zc], R * 0.9, { kind: "end" }),
  ], (sp, p, n) => {
    if (sp.kind === "cap") return RED;
    if (sp.kind === "end") return BLUE_DARK;
    const { s } = onCyl(sp, p, n);
    if (s < cell * 0.25) return RED;                                                       // the red west end
    return sh(BLUE, mottle(p, 8, 0.12));
  }, { gloss: 0.4 });
  alphaCompositeAt(lay, tank);
  const bays = 4, bw = (x1 - x0) / bays;
  for (let k = 0; k <= bays; k++) { const x = x0 + k * bw; d.line([P(x, yS, 0), P(x, yS, Hc)], A(FRAME), t); d.line([P(x, yN, Hc), P(x, yS, Hc)], A(FRAME), t); }   // near posts, top cross bars
  d.line([P(x0, yS, Hc), P(x1, yS, Hc)], A(FRAME), t);
  for (let k = 0; k < bays; k++) {                                                         // X braces over the top
    const xa = x0 + k * bw, xb = xa + bw;
    d.line([P(xa, yN, Hc), P(xb, yS, Hc)], A(FRAME), t - 1);
    d.line([P(xa, yS, Hc), P(xb, yN, Hc)], A(FRAME), t - 1);
  }
  const [lx, ly] = P(x1 - cell * 0.5, yS, zc * 0.8);
  d.polygon([[lx, ly - cell * 0.05], [lx + cell * 0.06, ly + cell * 0.04], [lx - cell * 0.06, ly + cell * 0.04]], A(YELLOW));   // a warning triangle
  return withShadow(grime(chips(lay, 1420, 40, cell), cell, 1421, 0.08), cell, 0.06, 0.09, 0.05, 0.6);
}

// --- a tall blue tank in a scaffold cage (Size 2): a domed top with a red arc ---------------------------------------------

function tokenTankCage(cell) {
  const [lay, d, cs] = layerFor(cell, size2Footprint(cell)), { w, h } = lay, [cx, cyc] = centroid(cs), cy = cyc + cell * 0.18;
  const R = cell * 0.52, H = cell * 0.9, a = R * 1.12, t = Math.max(3, T(cell * 0.026));
  for (const [px, py] of [[cx - a, cy - a], [cx + a, cy - a]]) d.line([[px, py], [px, py - H * 1.08]], A(FRAME), t);   // the far posts
  const z = fine(w, h);
  addCyl(z, w, h, cx, cy, R, H, cell * 0.06, cell * 0.14);
  const tank = project(w, h, z, (x, y, hgt, wall) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    if (!wall && r > R * 0.55 && r < R * 0.78 && ang > -2.6 && ang < -0.6) return RED;   // the red arc on top
    if (!wall && r < R * 0.2) return sh(BLUE, 1.1);
    if (wall && Math.abs(hgt / H - 0.5) < 0.02) return BLUE_DARK;
    return BLUE;
  }, { gloss: 0.45 });
  alphaCompositeAt(lay, tank);
  for (const [px, py] of [[cx - a, cy + a * 0.7], [cx + a, cy + a * 0.7]]) d.line([[px, py], [px, py - H * 1.08]], A(FRAME), t);   // the near posts
  for (const k of [0.35, 0.75, 1.08]) {                                                     // rings round the cage
    const yy = cy - H * k;
    d.line([[cx - a, yy + a * 0.7], [cx + a, yy + a * 0.7]], A(FRAME), t);
    if (k === 1.08) { d.line([[cx - a, yy - a], [cx + a, yy - a]], A(FRAME), t); for (const px of [cx - a, cx + a]) d.line([[px, yy - a], [px, yy + a * 0.7]], A(FRAME), t); }
  }
  return withShadow(grime(chips(lay, 1430, 40, cell), cell, 1431, 0.08), cell, 0.06, 0.09, 0.05, 0.6);
}

// --- the big blue silo lid (Size 2): a low domed disc with a hinge, bolts and marks ----------------------------------------

function tokenLid(cell) {
  const [lay, d, cs] = layerFor(cell, size2Footprint(cell)), { w, h } = lay, [cx, cyc] = centroid(cs), cy = cyc + cell * 0.02;
  const R = cell * 0.72, z = fine(w, h);
  addCyl(z, w, h, cx, cy, R, cell * 0.12, 4, cell * 0.08);
  addCyl(z, w, h, cx, cy, R * 0.34, cell * 0.24, 3, cell * 0.03);
  const lid = project(w, h, z, (x, y, hgt, wall) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    if (wall) return BLUE_DARK;
    for (let k = 0; k < 16; k++) { const b = (k / 16) * Math.PI * 2; if (Math.hypot(dx - Math.cos(b) * R * 0.9, dy - Math.sin(b) * R * 0.9) < cell * 0.022) return [30, 50, 90]; }   // bolts
    if (Math.abs(r - R * 0.62) < cell * 0.012) return BLUE_DARK;                         // a seam
    if (r > R * 0.44 && r < R * 0.5 && ang > 0.2 && ang < 0.6) return RED;
    if (dx > R * 0.2 && dx < R * 0.42 && Math.abs(dy - R * 0.3) < cell * 0.02) return [220, 224, 230];
    if (dx > -R * 0.5 && dx < -R * 0.3 && Math.abs(dy - R * 0.38) < cell * 0.03) return [224, 150, 60];
    return BLUE;
  }, { gloss: 0.35 });
  const [hx, hy] = [cx, cy - R - cell * 0.02];
  d.rectangle([hx - cell * 0.14, hy - cell * 0.16, hx + cell * 0.14, hy + cell * 0.04], { fill: A([36, 38, 50]), outline: A([70, 74, 90]), width: 2 });   // the hinge
  alphaCompositeAt(lay, lid);
  return withShadow(grime(chips(lay, 1440, 40, cell), cell, 1441, 0.08), cell, 0.06, 0.09, 0.05, 0.6);
}

export const TOKENS = {
  bs_missile_size2: tokenMissile,
  bs_silo_size2_v1: (c) => tokenSilo(c, false),
  bs_silo_size2_v2: (c) => tokenSilo(c, true),
  bs_tank_rack_3hex: tokenTankRack,
  bs_tank_cage_size2: tokenTankCage,
  bs_lid_size2: tokenLid,
  bs_bottles_v1: (c) => tokenBottles(c, 0, [40, 92, 166], [210, 214, 224]),
  bs_bottles_v2: (c) => tokenBottles(c, 1, [40, 92, 166], [210, 214, 224]),
  bs_drums_v1: (c) => tokenDrums(c, 0, [46, 100, 176]),
  bs_drums_v2: (c) => tokenDrums(c, 1, [46, 100, 176]),
  bs_container_3hex: (c) => tokenContainer(c, [40, 40, 70], [30, 34, 72], [206, 150, 62]),
  bs_railing: (c) => tokenRailing(c, [48, 100, 190], [30, 40, 70]),
};

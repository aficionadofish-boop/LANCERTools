// Generator Annex tokens (names start ga_), after Synthetik's Generator Annex: transformers with yellow
// ribbed insulators, tall generator blocks, fan units, battery racks, the yellow-framed power cabinet, vent
// boxes, broken concrete barriers with rebar loops, the green railing and the UPG crate. The Depot set
// (dp_) fits this floor too: tetrapods, pallets, supply boxes, crates, hollow blocks, sheet piling.
// Reference: _backstage/reference/synthetik/generator_annex/.
//
// Drawn with the Depot's tools (tokens/depot.js): boxes flat, round parts ray-traced.

import { PyRandom } from "../rng.js?v=0f282507bd";
import { alphaCompositeAt, Draw } from "../raster.js?v=0f282507bd";
import { grime, size2Footprint } from "./kit.js?v=0f282507bd";
import { groundShadow } from "./shadow.js?v=0f282507bd";

const withShadow = (obj, cell) => groundShadow(obj, cell);                      // stood on the floor (shadow.js), not the kit's offset copy
import { layerFor, centroid, row2, row3, box, chips, trace, cylinder, onCyl, mottle, screen, sh, A, tokenRailing, crate } from "./depot.js?v=0f282507bd";

const T = Math.trunc;
const DARK = [42, 48, 34], DARK_SIDE = [32, 38, 28], RIB = [24, 28, 20];
const OLIVE = [70, 80, 60], GREEN = [60, 150, 84], YELLOW = [214, 172, 72], INSUL = [232, 186, 76];
const CONCRETE = [182, 188, 158], RUST = [150, 84, 50];

// horizontal ribs across a box's south face
function ribs(d, x0, x1, yTop, yBot, pitch, col = RIB) {
  for (let y = yTop + pitch * 0.5; y < yBot - 1; y += pitch) d.line([[x0 + 1, y], [x1 - 1, y]], A(col), Math.max(1, T(pitch * 0.35)));
}

// a label: the small yellow diamond, the orange tag
function diamond(d, x, y, s) { d.polygon([[x, y - s], [x + s, y], [x, y + s], [x - s, y]], A([222, 170, 60])); }

// --- the transformer (Size 2): a dark tank on a ribbed base, six yellow insulators leaning outward -----------

function tokenTransformer(cell) {
  const [lay, d, cs] = layerFor(cell, size2Footprint(cell)), { w, h } = lay, [cx, cyc] = centroid(cs), cy = cyc + cell * 0.35;
  const bw = cell * 0.44, bd = cell * 0.36, H = cell * 0.36;
  box(d, cx - bw, cy - bd, cx + bw, cy + bd, H * 0.45, sh(DARK, 1.1), DARK_SIDE);         // the base
  ribs(d, cx - bw, cx + bw, cy + bd - H * 0.45, cy + bd, cell * 0.035);
  const tx0 = cx - bw * 0.86, tx1 = cx + bw * 0.86, ty0 = cy - bd * 0.9, ty1 = cy + bd * 0.8;   // the tank on it
  box(d, tx0, ty0 - H * 0.45, tx1, ty1 - H * 0.45, H * 0.55, [48, 52, 40], [36, 40, 30]);
  d.rectangle([tx0, ty0 - H, tx1, ty1 - H], { outline: A([150, 156, 140]), width: Math.max(3, T(cell * 0.025)) });   // its pale top frame
  d.rectangle([tx0 + cell * 0.08, ty0 - H + cell * 0.08, tx1 - cell * 0.08, ty1 - H - cell * 0.08], { fill: A([30, 34, 26]) });
  diamond(d, cx + bw * 0.5, cy + bd - H * 0.2, cell * 0.035);
  const shapes = [], L = cell * 0.5, r = cell * 0.055;                                     // the insulators, leaning out and up
  for (const side of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const bx = cx + side * bw * 0.72, by = cy - bd * 0.7 + i * bd * 0.7, bz = H;
      const lean = 0.42, dir = [side * Math.sin(lean), -0.15, Math.cos(lean)];
      const tip = [bx + dir[0] * L, by + dir[1] * L, bz + dir[2] * L];
      shapes.push(cylinder([bx, by, bz], [bx + dir[0] * cell * 0.06, by + dir[1] * cell * 0.06, bz + dir[2] * cell * 0.06], r * 1.4, { kind: "collar" }));
      shapes.push(cylinder([bx, by, bz], tip, r, { kind: "insulator", len: L }));
      shapes.push(cylinder(tip, [tip[0] + dir[0] * cell * 0.04, tip[1] + dir[1] * cell * 0.04, tip[2] + dir[2] * cell * 0.04], r * 0.8, { kind: "cap" }));
    }
  const ins = trace(w, h, shapes, (sp, p, n) => {
    if (sp.kind === "collar") return GREEN;
    if (sp.kind === "cap") return [150, 156, 150];
    const { s } = onCyl(sp, p, n);
    return Math.floor(s / (cell * 0.028)) % 2 ? sh(INSUL, 0.86) : INSUL;                  // ribbed sheds
  }, { gloss: 0.5 });
  alphaCompositeAt(lay, ins);
  return withShadow(grime(chips(lay, 1300, 30, cell), cell, 1301, 0.1), cell, 0.06, 0.09, 0.05, 0.6);
}

// --- the generator block (Size 2): a tall dark ribbed block, a bolted top panel, green feet ------------------

function tokenGenerator(cell) {
  const [lay, d, cs] = layerFor(cell, size2Footprint(cell)), [cx, cyc] = centroid(cs), cy = cyc + cell * 0.55;
  const bw = cell * 0.5, bd = cell * 0.3, H = cell * 0.95, r = new PyRandom(1310);
  d.rectangle([cx - bw * 0.92, cy - cell * 0.02, cx + bw * 0.92, cy + bd + cell * 0.04], { fill: A([26, 30, 22]) });   // the plinth
  for (let i = 0; i < 6; i++) {                                                           // green feet
    const fx = cx - bw * 0.8 + i * bw * 0.32;
    d.polygon([[fx, cy + bd + cell * 0.02], [fx + cell * 0.07, cy + bd - cell * 0.02], [fx + cell * 0.1, cy + bd + cell * 0.02]], A(GREEN));
  }
  box(d, cx - bw, cy - bd, cx + bw, cy + bd, H, OLIVE, DARK_SIDE);
  ribs(d, cx - bw, cx + bw, cy + bd - H, cy + bd - cell * 0.04, cell * 0.04);
  d.line([[cx - bw * 0.4, cy + bd - H * 0.95], [cx - bw * 0.4, cy + bd - H * 0.4]], A([20, 24, 18]), 2);   // a seam
  const top = cy - bd - H, bot = cy + bd - H;
  d.rectangle([cx - bw, top, cx + bw, bot], { outline: A(sh(OLIVE, 0.7)), width: 2 });
  for (const [px, py] of [[0.2, 0.25], [0.4, 0.25], [0.6, 0.25], [0.8, 0.25], [0.2, 0.75], [0.4, 0.75], [0.6, 0.75], [0.8, 0.75]]) {   // bolts
    const x = cx - bw + px * 2 * bw, y = top + py * (bot - top), s = cell * 0.035;
    d.ellipse([x - s, y - s, x + s, y + s], { fill: A([150, 156, 144]), outline: A([40, 44, 36]), width: 2 });
    d.ellipse([x - s * 0.4, y - s * 0.6, x + s * 0.2, y], { fill: A([210, 214, 204]) });
  }
  d.rectangle([cx - bw * 0.1, top + (bot - top) * 0.44, cx + bw * 0.1, top + (bot - top) * 0.56], { fill: A([30, 34, 28]) });   // a vent
  d.rectangle([cx - bw * 0.7, cy + bd - H * 0.35, cx - bw * 0.5, cy + bd - H * 0.3], { fill: A([196, 90, 60]) });   // an orange tag
  diamond(d, cx + bw * 0.55, cy + bd - H * 0.3, cell * 0.035);
  return withShadow(grime(chips(lay, 1311, 40, cell), cell, 1312, 0.1), cell, 0.06, 0.09, 0.05, 0.6);
}

// --- the fan unit: a dark block with a round fan in a bolted frame on top --------------------------------------

function tokenFanUnit(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy0] = cs[0], cy = cy0 + cell * 0.2;
  const bw = cell * 0.34, bd = cell * 0.26, H = cell * 0.3;
  box(d, cx - bw, cy - bd, cx + bw, cy + bd, H, [44, 48, 38], DARK_SIDE);
  ribs(d, cx - bw, cx + bw, cy + bd - H, cy + bd, cell * 0.035);
  const tx = cx, ty = cy - H, R = bd * 0.9;
  d.rectangle([cx - bw, ty - bd, cx + bw, ty + bd], { fill: A([34, 36, 30]), outline: A([60, 64, 52]), width: 2 });
  for (const [px, py] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const x = tx + px * (bw - cell * 0.05), y = ty + py * (bd - cell * 0.05); d.ellipse([x - 4, y - 4, x + 4, y + 4], { fill: A([140, 146, 136]) }); }
  d.ellipse([tx - R, ty - R, tx + R, ty + R], { fill: A([20, 22, 20]), outline: A([90, 94, 84]), width: 3 });
  for (let i = 0; i < 12; i++) {                                                           // blades, curved
    const a = (i / 12) * Math.PI * 2, b = a + 0.5;
    d.polygon([[tx + Math.cos(a) * R * 0.25, ty + Math.sin(a) * R * 0.25], [tx + Math.cos(a) * R * 0.92, ty + Math.sin(a) * R * 0.92], [tx + Math.cos(b) * R * 0.9, ty + Math.sin(b) * R * 0.9]], A([58, 62, 54]));
  }
  d.ellipse([tx - R * 0.25, ty - R * 0.25, tx + R * 0.25, ty + R * 0.25], { fill: A([96, 100, 90]) });
  d.rectangle([cx - bw * 0.7, cy + bd - H * 0.55, cx - bw * 0.35, cy + bd - H * 0.3], { fill: A([196, 160, 70]) });   // a yellow plate
  return withShadow(grime(lay, cell, 1320, 0.1), cell);
}

// --- the battery rack (two hexes): a grey-green cabinet, a grid of cells with yellow terminals ------------------

function tokenBatteryRack(cell) {
  const [lay, d, cs] = layerFor(cell, row2(cell)), [[xa, cy0], [xb]] = cs, cy = cy0 + cell * 0.16;
  const x0 = xa - cell * 0.44, x1 = xb + cell * 0.44, y0 = cy - cell * 0.28, y1 = cy + cell * 0.26, H = cell * 0.3, body = [66, 84, 58];
  box(d, x0, y0, x1, y1, H, sh(body, 1.08), sh(body, 0.82));
  for (let x = x0 + cell * 0.1; x < x1 - cell * 0.1; x += cell * 0.3) d.rectangle([x, y1 - H * 0.7, x + cell * 0.14, y1 - H * 0.55], { fill: A(sh(body, 0.55)) });   // vent slots
  d.rectangle([x0 + cell * 0.08, y1 - H * 0.35, x0 + cell * 0.14, y1 - H * 0.28], { fill: A([60, 110, 170]) });
  d.rectangle([x1 - cell * 0.16, y1 - H * 0.35, x1 - cell * 0.1, y1 - H * 0.28], { fill: A([200, 70, 50]) });
  const cols = 6, rows = 3, gx = (x1 - x0 - cell * 0.08) / cols, gy = (y1 - y0 - cell * 0.08) / rows;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {                                                      // the cells
      const bx = x0 + cell * 0.04 + i * gx, by = y0 - H + cell * 0.04 + j * gy;
      d.rectangle([bx + 2, by + 2, bx + gx - 2, by + gy - 2], { fill: A([46, 52, 48]), outline: A([90, 104, 86]), width: 1 });
      for (const tx of [0.3, 0.7]) { const x = bx + gx * tx, y = by + gy * 0.4, s = cell * 0.022; d.ellipse([x - s, y - s, x + s, y + s], { fill: A(YELLOW) }); }
      d.rectangle([bx + gx * 0.2, by + gy * 0.7, bx + gx * 0.8, by + gy * 0.78], { fill: A([150, 160, 150]) });
    }
  return withShadow(grime(lay, cell, 1330, 0.1), cell);
}

// --- the power cabinet (three hexes): a yellow steel frame, three round fans in a dark deck, braced sides -----

function tokenPowerCabinet(cell) {
  const [lay, d, cs] = layerFor(cell, row3(cell)), [cx, cy0] = cs[0], cy = cy0 + cell * 0.18;
  const x0 = cx - cell * 1.36, x1 = cx + cell * 1.36, y0 = cy - cell * 0.28, y1 = cy + cell * 0.3, H = cell * 0.3;
  const frame = [206, 160, 60], t = Math.max(4, T(cell * 0.04));
  d.rectangle([x0, y1 - H, x1, y1], { fill: A([30, 34, 30]) });                           // the south side: dark grille
  for (let x = x0; x < x1; x += cell * 0.05) d.line([[x, y1 - H], [x, y1]], A([44, 50, 44]), 1);
  for (let k = 0; k < 4; k++) {                                                             // braces
    const bx = x0 + (k * (x1 - x0)) / 4, ex = bx + (x1 - x0) / 4;
    d.line([[bx, y1 - H], [ex, y1]], A(frame), t);
    d.line([[bx, y1 - H], [bx, y1]], A(frame), t);
  }
  d.line([[x1, y1 - H], [x1, y1]], A(frame), t);
  d.line([[x0, y1 - 2], [x1, y1 - 2]], A(frame), t);
  d.rectangle([x0, y0 - H, x1, y1 - H], { fill: A([28, 30, 32]) });                       // the deck
  d.rectangle([x0, y0 - H, x1, y1 - H], { outline: A(frame), width: t + 2 });
  const R = (y1 - y0) * 0.38;
  for (const k of [-1, 0, 1]) {                                                             // the fans
    const fx = cx + k * cell * 0.85, fy = (y0 + y1) / 2 - H;
    d.ellipse([fx - R * 1.2, fy - R, fx + R * 1.2, fy + R], { fill: A([12, 14, 16]), outline: A([60, 64, 66]), width: 3 });
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; d.line([[fx, fy], [fx + Math.cos(a) * R * 1.1, fy + Math.sin(a) * R * 0.92]], A([40, 42, 44]), 3); }
    d.ellipse([fx - R * 0.2, fy - R * 0.2, fx + R * 0.2, fy + R * 0.2], { fill: A([70, 72, 74]) });
  }
  for (const [px, py] of [[x0, y0 - H], [x1, y0 - H], [x0, y1 - H], [x1, y1 - H]]) d.rectangle([px - 5, py - 5, px + 5, py + 5], { fill: A([60, 50, 30]) });
  diamond(d, x1 - cell * 0.3, y1 - H * 0.5, cell * 0.04);
  return withShadow(grime(lay, cell, 1340, 0.1), cell, 0.06, 0.09, 0.05, 0.6);
}

// --- the vent box: a dark radiator block with slats on top ---------------------------------------------------------

function tokenVentBox(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy0] = cs[0], cy = cy0 + cell * 0.14;
  const bw = cell * 0.36, bd = cell * 0.26, H = cell * 0.2;
  box(d, cx - bw, cy - bd, cx + bw, cy + bd, H, [50, 54, 40], DARK_SIDE);
  ribs(d, cx - bw, cx + bw, cy + bd - H, cy + bd, cell * 0.03);
  for (let y = cy - bd - H + cell * 0.04; y < cy + bd - H - cell * 0.03; y += cell * 0.045) {    // slats on top
    d.rectangle([cx - bw + cell * 0.04, y, cx + bw - cell * 0.04, y + cell * 0.022], { fill: A([24, 28, 20]) });
    d.line([[cx - bw + cell * 0.04, y + cell * 0.024], [cx + bw - cell * 0.04, y + cell * 0.024]], A([78, 84, 64]), 1);
  }
  return withShadow(grime(lay, cell, 1350, 0.12), cell);
}

// --- the broken concrete barrier: a chipped jersey-barrier stub, sloped sides, a broken top with rebar ------------

function tokenBarrier(cell, seed = 0) {
  const [lay, d, cs] = layerFor(cell), [cx, cy0] = cs[0], cy = cy0 + cell * 0.16, r = new PyRandom(1360 + seed);
  const bw = cell * 0.4, bd = cell * 0.2, H = cell * 0.22, tw = bd * 0.45;                  // footprint half-depth, top half-depth
  const n = 16, brk = [];                                                                   // the broken top edge (north and south)
  for (let i = 0; i <= n; i++) brk.push(r.uniform(0, 1) * cell * (seed ? 0.07 : 0.035) * (i === 0 || i === n ? 0.3 : 1));
  const xs = (i) => cx - bw + (i / n) * 2 * bw;
  const northTop = brk.map((b, i) => [xs(i), cy - tw - H + b]), southTop = brk.map((b, i) => [xs(n - i), cy + tw - H + brk[n - i] * 0.6]);
  d.polygon([[cx - bw, cy - tw - H], [cx + bw, cy - tw - H], [cx + bw, cy - bd], [cx - bw, cy - bd]], A(sh(CONCRETE, 1.0)));   // the north slope (seen over the top)
  d.polygon([...northTop, ...southTop], A(sh(CONCRETE, 1.1)));                             // the broken top
  d.polygon([...southTop, [cx - bw, cy + bd * 0.55], [cx + bw, cy + bd * 0.55]], A(sh(CONCRETE, 0.84)));   // the sloped south face (southTop runs east to west)
  d.polygon([[cx - bw, cy + bd * 0.55], [cx + bw, cy + bd * 0.55], [cx + bw, cy + bd], [cx - bw, cy + bd]], A(sh(CONCRETE, 0.72)));   // its steep foot
  d.line([[cx - bw, cy + bd * 0.55], [cx + bw, cy + bd * 0.55]], A(sh(CONCRETE, 0.95)), 1);
  for (let i = 0; i < 22; i++) {                                                            // chips, pits and stains
    const x = r.uniform(cx - bw, cx + bw), y = r.uniform(cy - tw - H, cy + bd), s = cell * r.uniform(0.008, 0.028), q = [];
    for (let k = 0; k < 5; k++) { const px = x + r.uniform(-s, s); q.push([px, y + r.uniform(-s, s)]); }
    d.polygon(q, A(sh(CONCRETE, r.uniform(0.55, 0.78))));
  }
  const w3 = Math.max(3, T(cell * 0.024));
  for (let i = 0; i < (seed ? 4 : 2); i++) {                                                // rebar stubs at the break
    const x = cx - bw * 0.7 + r.uniform(0, 1.4) * bw, y = cy - H + r.uniform(-tw, tw) * 0.6;
    d.line([[x, y], [x + r.uniform(-0.04, 0.04) * cell, y - r.uniform(0.04, 0.09) * cell]], A(sh(RUST, 0.8)), w3);
  }
  const lx = cx + (seed ? cell * 0.1 : -cell * 0.04), ly = cy - H + cell * 0.01, lr = cell * 0.075;   // the lifting loop, set in the top
  d.arc([lx - lr, ly - lr * 1.5, lx + lr, ly + lr * 0.5], 180, 360, A([60, 36, 24]), w3 + 2);
  d.arc([lx - lr, ly - lr * 1.5, lx + lr, ly + lr * 0.5], 190, 350, A(RUST), w3);
  return withShadow(grime(lay, cell, 1365 + seed, 0.14), cell);
}

// --- the UPG crate: a pale crate with a yellow sticker, the upgrade loot ---------------------------------------------

function tokenUpg(cell) {
  const [lay, d, cs] = layerFor(cell), [cx, cy] = cs[0];
  const x0 = cx - cell * 0.3, x1 = cx + cell * 0.3, y0 = cy - cell * 0.12, y1 = cy + cell * 0.2, H = cell * 0.14;
  box(d, x0, y0, x1, y1, H, [210, 206, 190], [150, 146, 134]);
  d.rectangle([x0 - 4, y0 - H + cell * 0.04, x0 + cell * 0.04, y1 - cell * 0.02], { fill: A([130, 130, 124]) });   // end caps
  d.rectangle([x1 - cell * 0.04, y0 - H + cell * 0.04, x1 + 4, y1 - cell * 0.02], { fill: A([130, 130, 124]) });
  d.rectangle([x0 + cell * 0.08, y0 - H + cell * 0.03, x1 - cell * 0.08, y1 - H - cell * 0.03], { fill: A([236, 190, 64]) });   // the sticker
  d.text([x0 + cell * 0.1, y0 - H + cell * 0.03], "UPG", T(cell * 0.16), A([60, 50, 40]), { family: "stencil" });
  for (let i = 0; i < 4; i++) d.line([[x1 - cell * 0.2 + i * cell * 0.03, y0 - H + cell * 0.05], [x1 - cell * 0.24 + i * cell * 0.03, y1 - H - cell * 0.05]], A([40, 36, 30]), 2);   // hazard ticks
  return withShadow(grime(lay, cell, 1370, 0.08), cell);
}

export const TOKENS = {
  ga_transformer_size2: tokenTransformer,
  ga_generator_size2: tokenGenerator,
  ga_fan_unit: tokenFanUnit,
  ga_battery_rack_2hex: tokenBatteryRack,
  ga_power_cabinet_3hex: tokenPowerCabinet,
  ga_vent_box: tokenVentBox,
  ga_barrier_v1: (c) => tokenBarrier(c, 0),
  ga_barrier_v2: (c) => tokenBarrier(c, 1),
  ga_railing: (c) => tokenRailing(c, [60, 138, 78], [34, 70, 44]),
  ga_upg_crate: tokenUpg,
};

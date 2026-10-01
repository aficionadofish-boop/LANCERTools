// V-Reality (from vr_map.py): Perseverance's training sim, after Synthetik: Legion Rising's
// V-Reality chamber. The base map is a violet nebula floor with faint giant rings, rubble specks and
// a few embers, plus the deploy zone. Raised ground, the spawn pads and the flag stand are tokens.

import { NpRandom, PyRandom } from "../../rng.js";
import { newImage, Draw, alphaComposite, gaussianBlur, u8 } from "../../raster.js";
import { imageSize } from "../geometry.js";
import { noise, drawAllZones, ZONE_SETTINGS, withDefaults, keeper, extras } from "../common.js";

const F = Math.fround;
const FLOOR = [98, 70, 152];
const NEBULA_A = [70, 62, 150];
const NEBULA_B = [150, 88, 186];

function floor([w, h], cell, o, seed = 3) {
  const n1 = noise(h, w, cell * 5, seed), n2 = noise(h, w, cell * 3, seed + 1), grain = new NpRandom(seed);
  let img = newImage("RGBA", w, h);
  for (let p = 0; p < w * h; p++) {
    const a = F(n1[p] - 0.5), b = F(n2[p] - 0.5), g = grain.normal(0, 3);
    for (let k = 0; k < 3; k++)
      img.data[p * 4 + k] = u8(FLOOR[k] + a * (NEBULA_A[k] - FLOOR[k]) * 1.6 * o.nebula + b * (NEBULA_B[k] - FLOOR[k]) * 1.4 * o.nebula + g);
    img.data[p * 4 + 3] = 255;
  }
  const over = newImage("RGBA", w, h), d = new Draw(over), r = new PyRandom(seed);
  const cx = w * 0.8, cy = h * 0.35;                                         // faint giant rings, off to one side
  if (o.rings)
    for (let k = 0; k < 4; k++) {
      const rad = w * (0.35 + 0.2 * k);
      d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], { outline: [230, 220, 255, 26], width: Math.max(2, Math.trunc(cell * 0.02)) });
    }
  const speck = (r) => {
    const x = r.uniform(0, w), y = r.uniform(0, h), s = r.uniform(0.01, 0.045) * cell, pts = [];
    for (let k = 0; k < 4; k++) { const px = x + r.uniform(-s, s); pts.push([px, y + r.uniform(-s, s)]); }
    return [pts, r.choice([[40, 30, 72, 220], [58, 46, 96, 220], [170, 150, 210, 160]])];
  };
  const n = Math.trunc(w * h / (cell * cell) * 14);                          // rubble specks
  let keep = keeper(31, o.specks), more = extras(n, o.specks, 1031);
  for (let i = 0; i < n; i++) { const [pts, fill] = speck(r); if (keep(i)) d.polygon(pts, fill); }
  for (let i = 0; i < more.count; i++) { const [pts, fill] = speck(more.rng); d.polygon(pts, fill); }
  // spent casings, as Military Bay draws them (not in the approved sim map, so 0 by default; own stream)
  const nc = Math.trunc(w * h / (cell * cell) * 1.2 * o.casings), cr = new PyRandom(1033), cw = Math.max(2, Math.trunc(cell * 0.022));
  for (let i = 0; i < nc; i++) {
    const x = cr.uniform(0, w), y = cr.uniform(0, h), a = cr.uniform(0, Math.PI), L = cell * 0.07;
    d.line([[x, y], [x + Math.cos(a) * L, y + Math.sin(a) * L]], [214, 150, 60, 230], cw);
  }
  img = alphaComposite(img, over);
  const emb = newImage("RGBA", w, h), ed = new Draw(emb);                   // a few orange embers (not Synthetik's; kept for looks)
  const ember = (r) => {
    const x = r.uniform(0, w), y = r.uniform(0, h), s = r.uniform(0.012, 0.025) * cell;
    return [x - s, y - s * 2, x + s, y + s * 2];
  };
  const ne = Math.trunc(w * h / (cell * cell) * 0.6);
  keep = keeper(32, o.embers); more = extras(ne, o.embers, 1032);
  for (let i = 0; i < ne; i++) { const box = ember(r); if (keep(i)) ed.ellipse(box, { fill: [255, 150, 70, 230] }); }
  for (let i = 0; i < more.count; i++) ed.ellipse(ember(more.rng), { fill: [255, 150, 70, 230] });
  img = alphaComposite(img, gaussianBlur(emb, cell * 0.01));
  return alphaComposite(img, gaussianBlur(emb, cell * 0.06));
}

export const name = "V-Reality";
export const blurb = "A virtual training arena: a violet nebula floor with faint giant rings and embers. Raised ground, pads and the flag are tokens.";
export const decals = [];
export const settings = [
  { id: "nebula", label: "Nebula swirl", group: "Floor", type: "range", min: 0, max: 2, step: 0.05, default: 1 },
  { id: "rings", label: "Giant rings", group: "Floor", type: "toggle", default: true },
  { id: "specks", label: "Rubble specks", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
  { id: "casings", label: "Spent casings", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 0 },
  { id: "embers", label: "Embers", group: "Clutter", type: "range", min: 0, max: 3, step: 0.05, default: 1 },
  ...ZONE_SETTINGS,
];

export function render(data, cell, opts = {}) {
  const o = withDefaults(settings, opts);
  const img = floor(imageSize(data.cols, data.rows, cell), cell, o);
  // raised ground, the spawn pads and the flag stand are tokens: only the other zones are drawn
  const zones = Object.fromEntries(Object.entries(data.zones || {}).filter(([k]) => k !== "spawn" && k !== "flag"));
  // the default control-zone purple vanishes on the violet floor: amber instead
  return drawAllZones(img, zones, cell, o, { control_zone: [[245, 190, 70], 44] });
}

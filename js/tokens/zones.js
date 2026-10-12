// Zone markers as tokens (names start zone_): for maps where terrain tokens cover the base map (a train's deck
// tiles, raised ground), so the zones painted into the map are hidden. A tint hex fills its hex exactly, so a
// group of them reads as one tinted zone; a label is the map's own plate, centred on the middle of three hexes.
// The colours are the map's zone colours, a little stronger so they show over busy tokens.

import { newImage, Draw } from "../raster.js?v=9ea0917c06";
import { geometry, hexPoints } from "../maps/geometry.js?v=9ea0917c06";
import { font } from "../maps/common.js?v=9ea0917c06";
import { tokenCanvas } from "./kit.js?v=9ea0917c06";

const ZONES = {
  deploy: { rgb: [68, 136, 255], label: "DEPLOY ZONE" },
  enemy: { rgb: [200, 200, 200], label: "ENEMY DEPLOY" },
  control: { rgb: [153, 68, 204], label: "CONTROL ZONE" },
  ingress: { rgb: [200, 200, 200], label: "INGRESS" },
  entrance: { rgb: [200, 200, 200], label: "ENTRANCE" },
};

function tokenTint(cell, kind) {
  const { img, cs } = tokenCanvas(cell, [[0, 0]]), [cx, cy] = cs[0], d = new Draw(img), { rgb } = ZONES[kind];
  d.polygon(hexPoints(cx, cy, cell, -0.01), [...rgb, 72]);
  const pts = hexPoints(cx, cy, cell, 0.03);                                 // a faint inner rim, so a lone hex still reads
  d.line([...pts, pts[0]], [...rgb, 110], Math.max(2, Math.trunc(cell * 0.015)));
  return img;
}

function tokenLabel(cell, kind) {
  const [sx] = geometry(cell), { img, cs } = tokenCanvas(cell, [[0, 0], [sx, 0], [-sx, 0]]), [tx, ty] = cs[0];
  const d = new Draw(img), { rgb, label } = ZONES[kind], f = font(cell * 0.24), tw = d.textLength(label, f), m = cell * 0.06;
  d.roundedRectangle([tx - tw / 2 - m * 2, ty - cell * 0.15 - m, tx + tw / 2 + m * 2, ty + cell * 0.15 + m], m * 2, { fill: [20, 21, 23, 225] });
  d.roundedRectangle([tx - tw / 2 - m * 2, ty - cell * 0.15 - m, tx + tw / 2 + m * 2, ty + cell * 0.15 + m], m * 2, { outline: [...rgb, 200], width: 2 });
  d.text([tx - tw / 2, ty - cell * 0.145], label, f, [...rgb, 240]);
  return img;
}

export const TOKENS = {};
for (const kind of Object.keys(ZONES)) {
  TOKENS[`zone_${kind}`] = (c) => tokenTint(c, kind);
  TOKENS[`zone_label_${kind}_3hex`] = (c) => tokenLabel(c, kind);
}

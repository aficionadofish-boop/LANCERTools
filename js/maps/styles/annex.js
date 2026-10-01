// Generator Annex, after Synthetik's Generator Annex level: the Depot's floor (depot.js, makeStyle) in green
// light. A stronger pale maze, pale bay lines, rows of straight pale bars instead of diagonal stripes,
// faint dark stencils, equipment pads with slat grilles, manhole lids, paper scraps and scuffs. Solid
// structure is a sunken pipe trench behind a green railing.
// Reference: _backstage/reference/synthetik/generator_annex/.

import { makeStyle } from "./depot.js?v=0f282507bd";

const ANNEX = {
  name: "Generator Annex",
  blurb: "A green plant floor: a strong pale maze, bay lines, rows of pale bars, dark stencils, equipment pads with slat grilles, manhole lids, paper scraps and scuffs, dark green fog at the edges.",
  terrainNote: "Generator Annex draws it as a sunken pipe trench behind a green railing.",
  GROUND: [66, 146, 76], LIT: [92, 170, 88], SHADE: [44, 112, 66],
  PALE: [150, 214, 140],
  DARKPAINT: [18, 58, 32],
  SLAT: [30, 44, 30], SLAT_LIT: [82, 110, 78],
  FOG: [12, 36, 26], mist: [120, 190, 130],
  REMAINS: {
    oil: [22, 34, 26], core: [8, 14, 10], halo: [40, 84, 52], haloAlpha: 90,
    shards: [[16, 28, 20, 235], [26, 44, 30, 230], [10, 18, 12, 240]],
    chunks: [[150, 160, 150, 245], [90, 100, 92, 245], [206, 212, 204, 245]],
  },
  STENCILS: ["TX", "DX", "NE", "6", "VLPE", "GA", "P4", "T3", "K2", "E7", "03", "TX NE"],
  CHALK: ["34", "37", "240", "300", "23 44", "CSM", "36 HERE", "12", "SHJ"],
  mazeAlpha: 36, stripes: "bars", padLabel: "Equipment pads",
  chalk: [214, 238, 204], scuff: [170, 216, 160], stipple: [200, 232, 190],
  paper: [[214, 228, 208, 215], [190, 214, 184, 200], [230, 238, 226, 225]],
  flecks: [[14, 28, 18, 225], [24, 42, 28, 215], [34, 56, 38, 200]],
  track: [18, 50, 30], track2: [14, 40, 24],
  pit: [22, 58, 40], pipe: [30, 60, 44], pipeLit: [70, 90, 76], flange: [52, 90, 64], flangeLine: [16, 36, 24],
  pitShadow: [8, 22, 14], railShadow: [8, 20, 12], rail: [62, 140, 80], railDark: [20, 52, 30], railLit: [120, 190, 128],
  steel: ([r, g, b]) => { const v = (r + g + b) / 3; return [v * 0.98, v * 1.03, v * 0.97]; },   // neutral grey, not the Depot's blue
  lid: [124, 134, 124], lidRim: [170, 178, 166],
  settings: [{ id: "manholes", label: "Manhole lids", group: "Paint", type: "range", min: 0, max: 3, step: 0.05, default: 1 }],
};

export const { name, blurb, terrainNote, decals, settings, render } = makeStyle(ANNEX);

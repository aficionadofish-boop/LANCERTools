// Ballistic Silos, after Synthetik's Ballistic Silos level: the Depot's floor (depot.js, makeStyle) in
// cold grey-violet under purple fog. No maze: checkerboard fields, dark dashed bay lines, dark + marks,
// stencils (DTX…), pads with slat grilles. The floor hatch is the blue cogged grate lid, linked to its
// neighbours by dark pipes. Solid structure is a sunken trench behind a blue railing.
// Reference: _backstage/reference/synthetik/ballistic_silos/.

import { makeStyle } from "./depot.js";

const SILOS = {
  name: "Ballistic Silos",
  blurb: "A grey-violet launch floor under purple fog: checkerboard fields, dark dashed bay lines, + marks, dark stencils, pads with slat grilles, blue grate lids, paper scraps and scuffs.",
  terrainNote: "Ballistic Silos draws it as a sunken pipe trench behind a blue railing.",
  GROUND: [84, 90, 116], LIT: [106, 116, 138], SHADE: [60, 64, 92],
  PALE: [150, 160, 190],
  DARKPAINT: [38, 40, 64],
  SLAT: [34, 36, 52], SLAT_LIT: [96, 100, 126],
  FOG: [30, 20, 56], mist: [150, 150, 200],
  REMAINS: {
    oil: [26, 24, 36], core: [10, 10, 16], halo: [60, 58, 90], haloAlpha: 90,
    shards: [[18, 18, 28, 235], [30, 30, 44, 230], [12, 12, 20, 240]],
    chunks: [[160, 164, 176, 245], [96, 100, 112, 245], [210, 212, 220, 245]],
  },
  STENCILS: ["DTX", "0", "4", "6", "SH", "BX", "07", "S3", "R9", "DX", "11"],
  CHALK: ["240", "300", "S.D", "SH.", "12", "5", "SW"],
  mazeAlpha: 0, stripes: "checker", bays: "dashed", marks: "plus", hatch: "cog", padLabel: "Silo pads",
  hatchBlue: [44, 104, 178],
  chalk: [210, 214, 236], scuff: [170, 176, 210], stipple: [196, 200, 230],
  paper: [[214, 216, 232, 215], [190, 194, 214, 200], [232, 234, 242, 225]],
  flecks: [[16, 16, 26, 225], [26, 26, 40, 215], [36, 38, 56, 200]],
  track: [26, 26, 46], track2: [20, 20, 38],
  pit: [24, 28, 52], pipe: [30, 40, 70], pipeLit: [70, 76, 100], flange: [50, 64, 100], flangeLine: [16, 20, 40],
  pitShadow: [10, 10, 22], railShadow: [8, 8, 20], rail: [44, 100, 190], railDark: [16, 30, 70], railLit: [110, 160, 230],
};

export const { name, blurb, terrainNote, decals, settings, render } = makeStyle(SILOS);

// Every token in the kit, in the order roll20_maps.py tokens() writes them: the general kit, the
// V-Reality set (vr_*), the Military Bay props (mb_*). renderToken() draws one at SS x and gives
// its Roll20 size, which also goes into the file name (e.g. crate_v1_70x81.png).

import { CELL, SS, pyRound } from "../maps/geometry.js";
import { TOKENS as KIT } from "./kit.js";
import { TOKENS as VR } from "./vr.js";
import { TOKENS as MILBAY } from "./milbay.js";
import { TOKENS as TRAINING } from "./training.js";
import { TOKENS as DEPOT } from "./depot.js";
import { TOKENS as ANNEX } from "./annex.js";
import { TOKENS as SILOS } from "./silos.js";
import { TOKENS as SIM } from "./sim.js";

export const TOKENS = { ...KIT, ...VR, ...MILBAY, ...TRAINING, ...DEPOT, ...ANNEX, ...SILOS, ...SIM };

export function renderToken(name) {
  const fn = TOKENS[name];
  if (!fn) throw new Error("unknown token: " + name);
  const img = fn(CELL * SS);
  const w = pyRound(img.w / SS), h = pyRound(img.h / SS);
  return { img, w, h, file: `${name}_${w}x${h}.png` };
}

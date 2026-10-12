// Every token in the kit, in the order roll20_maps.py tokens() writes them: the general kit, the
// V-Reality set (vr_*), the Military Bay props (mb_*). renderToken() draws one at SS x and gives
// its Roll20 size, which also goes into the file name (e.g. crate_v1_70x81.png).

import { CELL, SS, pyRound } from "../maps/geometry.js?v=4f137b6395";
import { TOKENS as KIT } from "./kit.js?v=4f137b6395";
import { TOKENS as VR } from "./vr.js?v=4f137b6395";
import { TOKENS as MILBAY } from "./milbay.js?v=4f137b6395";
import { TOKENS as TRAINING } from "./training.js?v=4f137b6395";
import { TOKENS as DEPOT } from "./depot.js?v=4f137b6395";
import { TOKENS as ANNEX } from "./annex.js?v=4f137b6395";
import { TOKENS as SILOS } from "./silos.js?v=4f137b6395";
import { TOKENS as SIM } from "./sim.js?v=4f137b6395";
import { TOKENS as FREIGHT } from "./freight.js?v=4f137b6395";
import { TOKENS as ZONES } from "./zones.js?v=4f137b6395";
import { TOKENS as JUNGLE } from "./jungle.js?v=4f137b6395";

export const TOKENS = { ...KIT, ...VR, ...MILBAY, ...TRAINING, ...DEPOT, ...ANNEX, ...SILOS, ...SIM, ...FREIGHT, ...ZONES, ...JUNGLE };

export function renderToken(name) {
  const fn = TOKENS[name];
  if (!fn) throw new Error("unknown token: " + name);
  const img = fn(CELL * SS);
  const w = pyRound(img.w / SS), h = pyRound(img.h / SS);
  return { img, w, h, file: `${name}_${w}x${h}.png` };
}

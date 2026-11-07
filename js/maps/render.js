// Render a base map: a hexmap JSON (cols, rows, zones, terrain, decals) in a style -> an RGBA image
// at SS x the Roll20 size, and helpers to show or save it.

import { CELL, SS } from "./geometry.js?v=666bbb997f";
import * as milbay from "./styles/milbay.js?v=666bbb997f";
import * as vr from "./styles/vr.js?v=666bbb997f";
import * as training from "./styles/training.js?v=666bbb997f";
import * as depot from "./styles/depot.js?v=666bbb997f";
import * as annex from "./styles/annex.js?v=666bbb997f";
import * as silos from "./styles/silos.js?v=666bbb997f";
import * as tunnel from "./styles/tunnel.js?v=666bbb997f";
import * as jungle from "./styles/jungle.js?v=666bbb997f";
import { hangar, habitat, command, reactor, fabrication } from "./styles/shipdeck.js?v=666bbb997f";

export const STYLES = { milbay, vr, training, depot, annex, silos, tunnel, jungle, hangar, habitat, command, reactor, fabrication };

export function renderBase(data, style, opts = {}) {
  const s = STYLES[style];
  if (!s) throw new Error("unknown map style: " + style);
  const img = s.render(data, CELL * SS, opts);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;       // saved as RGB
  return img;
}

export function toCanvas(img) {
  const cv = document.createElement("canvas");
  cv.width = img.w; cv.height = img.h;
  cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer), img.w, img.h), 0, 0);
  return cv;
}

// A shadow that stands the object on the floor. The kit's withShadow() shifts the whole silhouette
// down-right by one amount, which leaves a strip of floor between a tall object's base and its shadow, so
// it seems to hover. Here each column's lowest drawn pixel is taken as its foot, and every pixel above it
// casts shadow sheared down-right by its height above that foot (light from the top-left, as in the kit):
// at the foot the shadow touches the object, and the tops throw the long part. Longer shadows are lighter,
// and the shadow fades out before the canvas edge instead of being cut. Used by the Synthetik sets.

import { newImage, alphaCompositeAt, gaussianBlur } from "../raster.js";

export function groundShadow(obj, cell, { ax = 0.34, ay = 0.16, blur = 0.03, strength = 0.55 } = {}) {
  const { w, h } = obj, foot = new Int32Array(w).fill(-1);
  for (let x = 0; x < w; x++)
    for (let y = h - 1; y >= 0; y--) if (obj.data[(y * w + x) * 4 + 3] > 64) { foot[x] = y; break; }
  const cast = newImage("L", w, h), fade = cell * 1.3;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = obj.data[(y * w + x) * 4 + 3];
      if (a < 16 || foot[x] < y) continue;
      const hgt = foot[x] - y, X = Math.round(x + hgt * ax), Y = Math.round(foot[x] + hgt * ay);
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const v = a * Math.max(0.35, 1 - hgt / fade), q = Y * w + X;
      if (v > cast.data[q]) cast.data[q] = v;
    }
  const soft = gaussianBlur(cast, cell * blur), edge = cell * 0.08, out = newImage("RGBA", w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const e = Math.min(1, Math.min(x, y, w - 1 - x, h - 1 - y) / edge), q = y * w + x;
      out.data[q * 4] = 8; out.data[q * 4 + 1] = 8; out.data[q * 4 + 2] = 14;
      out.data[q * 4 + 3] = soft.data[q] * strength * e * e;
    }
  return alphaCompositeAt(out, obj);
}

// Text for the raster library, drawn by the browser (in the page or in a worker). Two families:
//   "sans"    Arimo Bold (metric-compatible with the Arial Bold the Python tools use), placed like
//             Pillow's default "la" anchor: x = pen origin, y = the ascender line, which Pillow puts
//             ceil(1854 / 2048 * size) px above the baseline. Every approved map and token uses it.
//   "stencil" Barlow Condensed ExtraBold: heavy condensed capitals (Synthetik's floor stencils).
// installText(fontsDir) loads both from the site's fonts/ folder.

import { setTextRasterizer } from "../raster.js";

const FAMILIES = {
  sans: { css: "LTArimo", file: "Arimo-Bold.ttf", weight: "700", ascent: (size) => Math.ceil((1854 / 2048) * size) },
  stencil: { css: "LTBarlow", file: "BarlowCondensed-ExtraBold.ttf", weight: "800", ascent: (size) => Math.ceil(size * 0.9) },
};
const PAD = 4;

export async function installText(fontsDir) {
  const fonts = globalThis.document ? document.fonts : self.fonts;
  await Promise.all(Object.values(FAMILIES).map(async (f) => {
    const face = new FontFace(f.css, `url(${new URL(f.file, fontsDir).href})`, { weight: f.weight });
    await face.load();
    fonts.add(face);
  }));
  const cv = new OffscreenCanvas(8, 8);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const setFont = (size, family) => { const f = FAMILIES[family] || FAMILIES.sans; ctx.font = `${f.weight} ${size}px ${f.css}`; return f; };
  setTextRasterizer({
    measure(text, size, family = "sans") { setFont(size, family); return ctx.measureText(text).width; },
    // stroke: Pillow's stroke_width (FreeType stroker, round joins): the glyphs grown by that much
    raster(text, size, fx, fy, stroke = 0, family = "sans") {
      setFont(size, family);
      const pad = PAD + Math.ceil(stroke);
      const w = Math.ceil(ctx.measureText(text).width) + 2 * pad, h = Math.ceil(size * 1.4) + 2 * pad;
      cv.width = w; cv.height = h;                         // resizing resets the context
      const f = setFont(size, family);
      ctx.fillStyle = ctx.strokeStyle = "#fff";
      ctx.textBaseline = "alphabetic";
      const x = pad + fx, y = pad + f.ascent(size) + fy;
      ctx.fillText(text, x, y);
      if (stroke > 0) { ctx.lineJoin = "round"; ctx.lineWidth = 2 * stroke; ctx.strokeText(text, x, y); }
      const px = ctx.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h);
      for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3];
      return { mask, w, h, ox: -pad, oy: -pad };
    },
  });
}

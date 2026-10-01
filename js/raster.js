// A small image library with Pillow's semantics, so the map styles port line for line from the
// Python tools and give the same pixels:
//   - drawing REPLACES pixels (alpha included), no blending, no antialiasing; coordinates are
//     rounded/truncated the way Pillow's C code does it;
//   - alphaComposite / paste / convert use Pillow's integer arithmetic;
//   - gaussianBlur is Pillow's extended box blur (3 passes, channels blurred separately, not
//     premultiplied), resizeL is its fixed-point bicubic.
// Images: {mode: "RGBA" | "L", w, h, data: Uint8Array}. No DOM here, except text, which goes
// through a rasterizer the page installs (setTextRasterizer).

export function newImage(mode, w, h, fill = 0) {
  const ch = mode === "RGBA" ? 4 : 1;
  const data = new Uint8Array(w * h * ch);
  if (ch === 4) {
    const f = Array.isArray(fill) ? fill : [0, 0, 0, 0];
    const a = f.length > 3 ? f[3] : 255;
    for (let i = 0; i < data.length; i += 4) { data[i] = f[0]; data[i + 1] = f[1]; data[i + 2] = f[2]; data[i + 3] = a; }
  } else if (fill) data.fill(fill);
  return { mode, w, h, data };
}

export function cloneImage(im) { return { mode: im.mode, w: im.w, h: im.h, data: im.data.slice() }; }

// numpy-style float arrays -> image: clip to 0..255 and truncate (astype(np.uint8))
export const u8 = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.trunc(v));

const ROUND_UP = (f) => (f >= 0 ? Math.floor(f + 0.5) : -Math.floor(Math.abs(f) + 0.5));
const ROUND_DOWN = (f) => (f >= 0 ? Math.ceil(f - 0.5) : -Math.ceil(Math.abs(f) - 0.5));
const F = Math.fround;
const roundf = (f) => (f >= 0 ? Math.floor(f + 0.5) : -Math.floor(-f + 0.5));   // C roundf / lround
const pyRound = (f) => {                                                         // Python round(): half to even
  const r = Math.round(f);
  return Math.abs(f % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

// --- drawing ------------------------------------------------------------------------------------

export class Draw {
  constructor(im) { this.im = im; this.ch = im.mode === "RGBA" ? 4 : 1; this.mask = null; }

  ink(c) {
    if (this.ch === 1) return [typeof c === "number" ? c : c[0]];
    return [c[0], c[1], c[2], c.length > 3 ? c[3] : 255];
  }

  hline(x0, y, x1, ink) {                              // this.mask (a Uint8Array, w x h): only where set
    const { w, h, data } = this.im;
    if (y < 0 || y >= h) return;
    if (x0 < 0) x0 = 0; else if (x0 >= w) return;
    if (x1 < 0) return; else if (x1 >= w) x1 = w - 1;
    const ch = this.ch, m = this.mask;
    for (let x = x0, i = (y * w + x0) * ch; x <= x1; x++) {
      if (m && !m[y * w + x]) { i += ch; continue; }
      for (let k = 0; k < ch; k++) data[i++] = ink[k];
    }
  }

  point(x, y, ink) {
    const { w, h, data } = this.im;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * this.ch;
    for (let k = 0; k < this.ch; k++) data[i + k] = ink[k];
  }

  // Pillow's polygon_generic over integer edges
  fillEdges(edges, ink) {
    let ymin = this.im.h - 1, ymax = 0;
    const table = [];
    for (const e of edges) {
      if (ymin > e.ymin) ymin = e.ymin;
      if (ymax < e.ymax) ymax = e.ymax;
      if (e.ymin === e.ymax) { this.hline(e.xmin, e.ymin, e.xmax, ink); continue; }
      table.push(e);
    }
    if (ymin < 0) ymin = 0;
    if (ymax > this.im.h) ymax = this.im.h;
    const xx = new Array(table.length * 2);
    for (; ymin <= ymax; ymin++) {
      let j = 0;
      for (let i = 0; i < table.length; i++) {
        const cur = table[i];
        if (ymin < cur.ymin || ymin > cur.ymax) continue;
        const at = (e, y) => F(F(F(y - e.y0) * e.dx) + e.x0);
        xx[j++] = at(cur, ymin);
        if (ymin === cur.ymax && ymin < ymax) {
          xx[j] = xx[j - 1];
          j++;
        } else if ((ymin === cur.ymin || ymin === cur.ymax) && cur.dx !== 0) {
          for (let k = 0; k < i; k++) {                 // connect discontiguous corners
            const o = table[k];
            if ((ymin !== o.ymin && ymin !== o.ymax) || o.dx === 0) continue;
            if (roundf(xx[j - 1]) !== roundf(at(o, ymin))) continue;
            const off = ymin === cur.ymax ? -1 : 1;
            const a = at(cur, ymin + off);
            if (ymin + off >= o.ymin && ymin + off <= o.ymax) {
              const b = at(o, ymin + off);
              if (xx[j - 1] > a + 1 && xx[j - 1] > b + 1) xx[j - 1] = roundf(Math.max(a, b)) + 1;
              else if (xx[j - 1] < a - 1 && xx[j - 1] < b - 1) xx[j - 1] = roundf(Math.min(a, b)) - 1;
              break;
            }
          }
        }
      }
      const row = xx.slice(0, j).sort((p, q) => p - q);
      for (let i = 1; i < j; i += 2) {
        const xs = ROUND_UP(row[i - 1]), xe = ROUND_DOWN(row[i]);
        if (xe < xs) continue;
        this.hline(xs, ymin, xe, ink);
      }
    }
  }

  // ImagingDrawPolygon, filled: edges between the points (consecutive horizontal runs merged)
  polygonInt(p, ink) {
    const edges = [];
    const n = p.length;
    let i;
    for (i = 0; i < n - 1; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[i + 1];
      if (y0 === y1 && i !== 0 && y0 === p[i - 1][1]) {
        const last = edges[edges.length - 1];
        if (x1 > x0 && x0 > p[i - 1][0]) { last.xmax = x1; continue; }
        if (x1 < x0 && x0 < p[i - 1][0]) { last.xmin = x1; continue; }
      }
      edges.push(edge(x0, y0, x1, y1));
    }
    if (p[i][0] !== p[0][0] || p[i][1] !== p[0][1]) edges.push(edge(p[i][0], p[i][1], p[0][0], p[0][1]));
    this.fillEdges(edges, ink);
  }

  // ImagingDrawPolygon, outline: Bresenham lines (width 1) or wide lines
  polygonOutlineInt(p, ink, width) {
    const n = p.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % n];
      if (width === 1) this.bresenham(x0, y0, x1, y1, ink);
      else this.wideLine(x0, y0, x1, y1, ink, width);
    }
  }

  polygon(pts, fill = null, { outline = null, width = 1 } = {}) {
    const p = pts.map(([x, y]) => [Math.trunc(x), Math.trunc(y)]);
    if (fill !== null) this.polygonInt(p, this.ink(fill));
    if (outline === null || width === 0 || sameInk(outline, fill)) return;
    if (width === 1) { this.polygonOutlineInt(p, this.ink(outline), 1); return; }
    // wider: the outline is drawn 2w-1 wide, masked to the polygon's own fill (no growing outward)
    const m = newImage("L", this.im.w, this.im.h);
    new Draw(m).polygonInt(p, [1]);
    const saved = this.mask;
    this.mask = m.data;
    this.polygonOutlineInt(p, this.ink(outline), width * 2 - 1);
    this.mask = saved;
  }

  regularPolygon([x, y, r], nSides, { rotation = 0, fill = null, outline = null, width = 1 } = {}) {
    const degrees = 360 / nSides, angles = [];
    let cur = (270 - 0.5 * degrees) + rotation;
    for (let i = 0; i < nSides; i++) { angles.push(cur); cur += degrees; if (cur > 360) cur -= 360; }
    const round2 = (v) => Number(v.toFixed(2));           // Python round(v, 2)
    const rad = (d) => d * (Math.PI / 180);                // Python math.radians
    const pts = angles.map((a) => [
      round2(r * Math.cos(rad(360 - a)) - 0 * Math.sin(rad(360 - a)) + x),
      round2(0 * Math.cos(rad(360 - a)) + r * Math.sin(rad(360 - a)) + y)]);
    this.polygon(pts, fill, { outline, width });
  }

  rectangle([x0, y0, x1, y1], { fill = null, outline = null, width = 1 } = {}) {
    x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (fill !== null) {
      const ink = this.ink(fill);
      let a = y0, b = y1;
      if (a < 0) a = 0; else if (a >= this.im.h) a = null;
      if (a !== null && b >= 0) {
        if (b > this.im.h) b = this.im.h;
        for (let y = a; y <= b; y++) this.hline(x0, y, x1, ink);
      }
    }
    if (outline !== null && width !== 0 && !sameInk(outline, fill)) {
      const ink = this.ink(outline);
      for (let i = 0; i < width; i++) {
        this.hline(x0, y0 + i, x1, ink);
        this.hline(x0, y1 - i, x1, ink);
        this.bresenham(x1 - i, y0 + width, x1 - i, y1 - width + 1, ink);
        this.bresenham(x0 + i, y0 + width, x0 + i, y1 - width + 1, ink);
      }
    }
  }

  bresenham(x0, y0, x1, y1, ink) {
    let dx = x1 - x0, dy = y1 - y0, xs = 1, ys = 1;
    if (dx < 0) { dx = -dx; xs = -1; }
    if (dy < 0) { dy = -dy; ys = -1; }
    if (dx === 0) { for (let i = 0; i < dy; i++) { this.point(x0, y0, ink); y0 += ys; } }
    else if (dy === 0) { for (let i = 0; i < dx; i++) { this.point(x0, y0, ink); x0 += xs; } }
    else if (dx > dy) {
      const n = dx; dy += dy; let e = dy - dx; dx += dx;
      for (let i = 0; i < n; i++) { this.point(x0, y0, ink); if (e >= 0) { y0 += ys; e -= dx; } e += dy; x0 += xs; }
    } else {
      const n = dy; dx += dx; let e = dx - dy; dy += dy;
      for (let i = 0; i < n; i++) { this.point(x0, y0, ink); if (e >= 0) { x0 += xs; e -= dy; } e += dx; y0 += ys; }
    }
  }

  wideLine(x0, y0, x1, y1, ink, width) {
    const dx = x1 - x0, dy = y1 - y0;
    if (dx === 0 && dy === 0) { this.point(x0, y0, ink); return; }
    const big = Math.hypot(dx, dy), small = (width - 1) / 2;
    const rmax = ROUND_UP(small) / big, rmin = ROUND_DOWN(small) / big;
    const dxmin = ROUND_DOWN(rmin * dy), dxmax = ROUND_DOWN(rmax * dy);
    const dymin = ROUND_DOWN(rmin * dx), dymax = ROUND_DOWN(rmax * dx);
    const v = [[x0 - dxmin, y0 + dymax], [x1 - dxmin, y1 + dymax], [x1 + dxmax, y1 - dymin], [x0 + dxmax, y0 - dymin]];
    this.fillEdges([edge(...v[0], ...v[1]), edge(...v[1], ...v[2]), edge(...v[2], ...v[3]), edge(...v[3], ...v[0])], ink);
  }

  line(pts, fill, width = 1, joint = null) {
    const ink = this.ink(fill);
    const p = pts.map(([x, y]) => [Math.trunc(x), Math.trunc(y)]);
    if (width <= 1) {
      for (let i = 0; i < p.length - 1; i++) this.bresenham(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], ink);
      if (p.length > 1) this.point(p[p.length - 1][0], p[p.length - 1][1], ink);
    } else {
      for (let i = 0; i < p.length - 1; i++) this.wideLine(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], ink, width);
    }
    if (joint !== "curve" || width <= 4) return;
    const deg = (r) => r * (180 / Math.PI), rad = (d) => d * (Math.PI / 180);   // Python math.degrees / radians
    const pmod = (a, m) => ((a % m) + m) % m;                            // Python %
    for (let i = 1; i < pts.length - 1; i++) {                         // ImageDraw.line's round joints
      const point = pts[i];
      const angles = [[pts[i - 1], point], [point, pts[i + 1]]].map(([s, e]) => pmod(deg(Math.atan2(e[0] - s[0], s[1] - e[1])), 360));
      if (angles[0] === angles[1]) continue;
      const coordAt = ([x, y], angle) => {
        angle -= 90;
        const dist = width / 2 - 1;
        return [[x, dist * Math.cos(rad(angle))], [y, dist * Math.sin(rad(angle))]].map(([v, dv]) => v + (dv > 0 ? Math.floor(dv) : Math.ceil(dv)));
      };
      const flipped = (angles[1] > angles[0] && angles[1] - 180 > angles[0]) || (angles[1] < angles[0] && angles[1] + 180 > angles[0]);
      const box = [point[0] - width / 2 + 1, point[1] - width / 2 + 1, point[0] + width / 2 - 1, point[1] + width / 2 - 1];
      const [start, end] = flipped ? [angles[1] + 90, angles[0] + 90] : [angles[0] - 90, angles[1] - 90];
      this.pieslice(box, start - 90, end - 90, fill);
      if (width > 8) {
        const gap = flipped ? [coordAt(point, angles[0] + 90), point, coordAt(point, angles[1] + 90)]
          : [coordAt(point, angles[0] - 90), point, coordAt(point, angles[1] - 90)];
        this.line(gap, fill, 3);
      }
    }
  }

  // Pillow's arc (arcNew): the ellipse ring of this width, clipped to the angle range
  arc(box, start, end, fill, width = 1) {
    const [x0, y0, x1, y1] = box.map(Math.trunc);
    const ink = this.ink(fill);
    [start, end] = normalizeAngles(F(start), F(end));
    if (start + 360 === end) { this.ellipseInt(x0, y0, x1, y1, ink, false, width); return; }
    if (start === end) return;
    const a = x1 - x0, b = y1 - y0;
    if (a < 0 || b < 0) return;
    const root = arcTree(a, b, start, end);
    for (const [X0, Y, X1] of ellipseSpans(a, b, width)) {
      const ev = clipTree(root, X0, Y, X1);
      for (let i = 0; i + 1 < ev.length; i += 2)
        this.hline(x0 + Math.trunc((ev[i].x + a) / 2), y0 + Math.trunc((Y + b) / 2), x0 + Math.trunc((ev[i + 1].x + a) / 2), ink);
    }
  }

  // Pillow's ellipseNew: integer quarter curves, spans per row
  ellipseInt(x0, y0, x1, y1, ink, fill, width) {
    const a = x1 - x0, b = y1 - y0;
    if (a < 0 || b < 0) return;
    for (const [X0, Y, X1] of ellipseSpans(a, b, fill ? a + b : width))
      this.hline(x0 + Math.trunc((X0 + a) / 2), y0 + Math.trunc((Y + b) / 2), x0 + Math.trunc((X1 + a) / 2), ink);
  }

  ellipse(box, { fill = null, outline = null, width = 1 } = {}) {
    const [x0, y0, x1, y1] = box.map(Math.trunc);
    if (fill !== null) this.ellipseInt(x0, y0, x1, y1, this.ink(fill), true, 0);
    if (outline !== null && width !== 0 && !sameInk(outline, fill)) this.ellipseInt(x0, y0, x1, y1, this.ink(outline), false, width);
  }

  // Pillow's filled pieslice (pieNew): the ellipse clipped by the two sides' half-planes
  pieslice(box, start, end, fill) {
    const [x0, y0, x1, y1] = box.map(Math.trunc);
    const ink = this.ink(fill);
    [start, end] = normalizeAngles(F(start), F(end));
    if (start + 360 === end) { this.ellipseInt(x0, y0, x1, y1, ink, true, 0); return; }
    if (start === end) return;
    const a = x1 - x0, b = y1 - y0;
    if (a < 0 || b < 0) return;
    const rad = (d) => d * Math.PI / 180.0;                 // as the C: (d * M_PI) / 180
    const xl = a * Math.cos(rad(start)), xr = a * Math.cos(rad(end));
    const yl = b * Math.sin(rad(start)), yr = b * Math.sin(rad(end));
    let root = { type: end - start < 180 ? "and" : "or", l: { type: "clip", a: -yl, b: xl, c: 0 }, r: { type: "clip", a: yr, b: -xr, c: 0 } };
    if (end - start < 90) root = { type: "and", l: root, r: { type: "clip", a: (xl + xr) / 2, b: (yl + yr) / 2, c: 0 } };
    for (const [X0, Y, X1] of ellipseSpans(a, b, x1 + y1 - x0 - y0)) {
      const ev = clipTree(root, X0, Y, X1);
      for (let i = 0; i + 1 < ev.length; i += 2)
        this.hline(x0 + Math.trunc((ev[i].x + a) / 2), y0 + Math.trunc((Y + b) / 2), x0 + Math.trunc((ev[i + 1].x + a) / 2), ink);
    }
  }

  // ImageDraw.rounded_rectangle (all four corners)
  roundedRectangle(box, radius, { fill = null, outline = null, width = 1 } = {}) {
    let [x0, y0, x1, y1] = box;
    let d = radius * 2;
    x0 = pyRound(x0); y0 = pyRound(y0); x1 = pyRound(x1); y1 = pyRound(y1);
    const fullX = d >= x1 - x0 - 1;
    if (fullX) d = x1 - x0;
    const fullY = d >= y1 - y0 - 1;
    if (fullY) d = y1 - y0;
    if (fullX && fullY) { this.ellipse(box, { fill, outline, width }); return; }
    if (d === 0) { this.rectangle(box, { fill, outline, width }); return; }
    const r = Math.trunc(Math.floor(d / 2));
    const parts = fullX ? [[[x0, y0, x0 + d, y0 + d], 180, 360], [[x0, y1 - d, x0 + d, y1], 0, 180]]
      : fullY ? [[[x0, y0, x0 + d, y0 + d], 90, 270], [[x1 - d, y0, x1, y0 + d], 270, 90]]
      : [[[x0, y0, x0 + d, y0 + d], 180, 270], [[x1 - d, y0, x1, y0 + d], 270, 360],
         [[x1 - d, y1 - d, x1, y1], 0, 90], [[x0, y1 - d, x0 + d, y1], 90, 180]];
    if (fill !== null) {
      for (const [b, s, e] of parts) this.pieslice(b, s, e, fill);
      if (fullX) this.rectangle([x0, y0 + r + 1, x1, y1 - r - 1], { fill });
      else if (x1 - r - 1 > x0 + r + 1) this.rectangle([x0 + r + 1, y0, x1 - r - 1, y1], { fill });
      if (!fullX && !fullY) {
        this.rectangle([x0, y0 + r + 1, x0 + r, y1 - r - 1], { fill });
        this.rectangle([x1 - r, y0 + r + 1, x1, y1 - r - 1], { fill });
      }
    }
    if (outline !== null && width !== 0 && !sameInk(outline, fill)) {
      for (const [b, s, e] of parts) this.arc(b, s, e, outline, width);
      if (!fullX) {
        this.rectangle([x0 + r + 1, y0, x1 - r - 1, y0 + width - 1], { fill: outline });
        this.rectangle([x0 + r + 1, y1 - width + 1, x1 - r - 1, y1], { fill: outline });
      }
      if (!fullY) {
        this.rectangle([x0, y0 + r + 1, x0 + width - 1, y1 - r - 1], { fill: outline });
        this.rectangle([x1 - width + 1, y0 + r + 1, x1, y1 - r - 1], { fill: outline });
      }
    }
  }

  // Text at (x, y) with Pillow's default "la" anchor (left, ascender). Blending as Pillow's
  // fill_mask_L: on a pixel that isn't opaque the colour is the ink's; alpha follows the coverage.
  // strokeFill: first the stroked glyphs in that colour, then the plain text in `fill` (as Pillow)
  // family: "sans" (Arimo, the default; Pillow-placed) or "stencil" (Barlow Condensed ExtraBold)
  text(xy, text, size, fill, { strokeWidth = 0, strokeFill = null, family = "sans" } = {}) {
    if (strokeFill !== null && strokeWidth > 0) {
      this.textPass(xy, text, size, strokeFill, strokeWidth, family);
      if (!sameInk(fill, strokeFill)) this.textPass(xy, text, size, fill, 0, family);
    } else this.textPass(xy, text, size, fill, strokeWidth, family);
  }

  // ImageDraw.textbbox((0, 0), text): [left, top, right, bottom] of the ink, anchor "la"
  textBbox(text, size, family = "sans") {
    const g = textRasterizer.raster(text, size, 0, 0, 0, family);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j < g.h; j++)
      for (let i = 0; i < g.w; i++)
        if (g.mask[j * g.w + i]) { x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j); }
    if (x0 === Infinity) return [0, 0, 0, 0];
    return [g.ox + x0, g.oy + y0, g.ox + x1 + 1, g.oy + y1 + 1];
  }

  textPass([x, y], text, size, fill, stroke, family = "sans") {
    const ink = this.ink(fill);
    const g = textRasterizer.raster(text, size, x - Math.trunc(x), y - Math.trunc(y), stroke, family);
    const ox = Math.trunc(x) + g.ox, oy = Math.trunc(y) + g.oy;
    const { w, h, data } = this.im, ch = this.ch;
    for (let j = 0; j < g.h; j++) {
      const yy = oy + j;
      if (yy < 0 || yy >= h) continue;
      for (let i = 0; i < g.w; i++) {
        const xx = ox + i, m = g.mask[j * g.w + i];
        if (!m || xx < 0 || xx >= w) continue;
        const p = (yy * w + xx) * ch;
        if (ch === 1) { data[p] = blend(m, data[p], ink[0]); continue; }
        const opaque = data[p + 3] === 255;
        for (let k = 0; k < 3; k++) data[p + k] = blend(opaque ? m : 255, data[p + k], ink[k]);
        data[p + 3] = blend(m, data[p + 3], ink[3]);
      }
    }
  }

  textLength(text, size, family = "sans") { return textRasterizer.measure(text, size, family); }
}

// --- Pillow's ellipse engine (Draw.c: quarter_*, ellipse_*, clip_tree_*) --------------------------

function quarter(a, b) {
  if (a < 0 || b < 0) return { finished: true };
  return { cx: a, cy: b % 2, ex: a % 2, ey: b, a2: a * a, b2: b * b, a2b2: a * a * b * b, finished: false };
}

function quarterNext(s) {
  if (s.finished) return null;
  const ret = [s.cx, s.cy];
  if (s.cx === s.ex && s.cy === s.ey) s.finished = true;
  else {
    const delta = (x, y) => Math.abs(s.a2 * y * y + s.b2 * x * x - s.a2b2);
    let nx = s.cx, ny = s.cy + 2, nd = delta(nx, ny);
    if (nx > 1) {
      let d = delta(s.cx - 2, s.cy + 2);
      if (nd > d) { nx = s.cx - 2; ny = s.cy + 2; nd = d; }
      d = delta(s.cx - 2, s.cy);
      if (nd > d) { nx = s.cx - 2; ny = s.cy; }
    }
    s.cx = nx; s.cy = ny;
  }
  return ret;
}

function* ellipseSpans(a, b, w) {                    // yields [x0, y, x1] on the doubled grid
  const leftmost = a % 2;
  const so = quarter(a, b);
  let first = w < 1 ? null : quarterNext(so);
  if (!first) return;
  let [pr, py] = first;
  const si = quarter(a - 2 * (w - 1), b - 2 * (w - 1));
  let pl = leftmost, finished = false;
  for (;;) {
    if (finished) return;
    const y = py, r = pr;
    let l = pl, n;
    while ((n = quarterNext(so)) !== null && n[1] <= y) {}
    if (n === null) finished = true; else { pr = n[0]; py = n[1]; }
    while ((n = quarterNext(si)) !== null && n[1] <= y) l = n[0];
    pl = n === null ? leftmost : n[0];
    const buf = [];
    if ((l > 0 || l < r) && y > 0) buf.push([l === 0 ? 2 : l, y, r]);
    if (y > 0) buf.push([-r, y, -l]);
    if (l > 0 || l < r) buf.push([l === 0 ? 2 : l, -y, r]);
    buf.push([-r, -y, -l]);
    while (buf.length) yield buf.pop();
  }
}

function normalizeAngles(al, ar) {
  if (ar - al >= 360) return [0, 360];
  const fmod = (x, m) => x % m;
  al = F(fmod(al < 0 ? 360 - fmod(-al, 360) : al, 360));
  ar = F(al + fmod(ar < al ? 360 - fmod(al - ar, 360) : ar - al, 360));
  return [al, ar];
}

// Draw.c arc_init: the clipping tree for an arc between angles al..ar (degrees)
function arcTree(a, b, al, ar) {
  if (a < b) {                                        // based on the "wide" ellipse, then transposed
    const t = arcTree(b, a, F(90 - ar), F(90 - al));
    const transpose = (n) => { if (!n) return; if (n.type === "clip") [n.a, n.b] = [n.b, n.a]; transpose(n.l); transpose(n.r); };
    transpose(t);
    return t;
  }
  [al, ar] = normalizeAngles(al, ar);
  if (ar === al + 360) return null;
  const rad = (d) => d * Math.PI / 180.0;                   // as the C: (d * M_PI) / 180
  const lc = { type: "clip", a: -a * Math.sin(rad(al)), b: b * Math.cos(rad(al)), c: (a * a - b * b) * Math.sin(al * Math.PI / 90) / 2 };
  const rc = { type: "clip", a: a * Math.sin(rad(ar)), b: -b * Math.cos(rad(ar)), c: (b * b - a * a) * Math.sin(ar * Math.PI / 90) / 2 };
  const half = (v) => ({ type: "clip", a: 0, b: v, c: 0 });
  if (al % 180 === 0 || ar % 180 === 0) return { type: ar - al < 180 ? "and" : "or", l: lc, r: rc };
  if ((Math.trunc(al / 180) + Math.trunc(ar / 180)) % 2 === 1)
    return { type: "or", l: { type: "and", l: half(Math.trunc(al / 180) % 2 === 0 ? 1 : -1), r: lc },
      r: { type: "and", l: half(Math.trunc(ar / 180) % 2 === 0 ? 1 : -1), r: rc } };
  const t = ar - al < 180 ? "and" : "or";
  return { type: t, l: { type: t, l: lc, r: rc }, r: half(ar < 180 || ar > 540 ? 1 : -1) };
}

function clipTree(node, x0, y, x1) {                  // -> [{x, type}], disjoint segments
  if (!node) return [{ x: x0, type: 1 }, { x: x1, type: -1 }];
  if (node.type === "clip") {
    const eps = 1e-9, { a: A, b: B, c: C } = node;
    if (Math.abs(A) < eps) { if (B * y + C < -eps) { x0 = 1; x1 = 0; } }
    else {
      const ix = -(B * y + C) / A;
      if (A * x0 + B * y + C < eps) x0 = roundf(Math.max(x0, ix));
      if (A * x1 + B * y + C < eps) x1 = roundf(Math.min(x1, ix));
    }
    return x0 <= x1 ? [{ x: x0, type: 1 }, { x: x1, type: -1 }] : [];
  }
  const l1 = clipTree(node.l, x0, y, x1), l2 = clipTree(node.r, x0, y, x1), out = [];
  let i1 = 0, i2 = 0, k1 = 0, k2 = 0, tail = null;
  while (i1 < l1.length || i2 < l2.length) {
    let t;
    if (i2 >= l2.length || (i1 < l1.length && (l1[i1].x < l2[i2].x || (l1[i1].x === l2[i2].x && l1[i1].type > l2[i2].type)))) { t = l1[i1++]; k1 += t.type; }
    else { t = l2[i2++]; k2 += t.type; }
    const open = t.type === 1 && (tail === null || tail.type === -1);
    if ((node.type === "or" && (open || (t.type === -1 && k1 === 0 && k2 === 0))) ||
        (node.type === "and" && ((open && k1 > 0 && k2 > 0) || (t.type === -1 && tail !== null && tail.type === 1 && (k1 === 0 || k2 === 0))))) {
      out.push(t); tail = t;
    }
  }
  return out;
}

function edge(x0, y0, x1, y1) {
  const e = { x0, y0, xmin: Math.min(x0, x1), xmax: Math.max(x0, x1), ymin: Math.min(y0, y1), ymax: Math.max(y0, y1) };
  if (y0 === y1) { e.d = 0; e.dx = 0; }
  else { e.dx = F((x1 - x0) / (y1 - y0)); e.d = y0 === e.ymin ? 1 : -1; }
  return e;
}

function sameInk(a, b) {
  if (a === null || b === null) return false;
  if (typeof a === "number" || typeof b === "number") return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Pillow's BLEND / DIV255
export function blend(mask, a, b) {
  const t = a * (255 - mask) + b * mask + 128;
  return ((t >> 8) + t) >> 8;
}

// --- text ------------------------------------------------------------------------------------------

let textRasterizer = {
  raster() { return { mask: new Uint8Array(0), w: 0, h: 0, ox: 0, oy: 0 }; },
  measure(text, size) { return text.length * size * 0.6; },
};
export function setTextRasterizer(r) { textRasterizer = r; }

// --- compositing -----------------------------------------------------------------------------------

// Image.alpha_composite(dst, src): Pillow's integer "over"
export function alphaComposite(dst, src) {
  const out = new Uint8Array(dst.data.length), d = dst.data, s = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const sa = s[i + 3];
    if (sa === 0) { out[i] = d[i]; out[i + 1] = d[i + 1]; out[i + 2] = d[i + 2]; out[i + 3] = d[i + 3]; continue; }
    const blendA = d[i + 3] * (255 - sa);
    const outa255 = sa * 255 + blendA;
    const coef1 = Math.floor(sa * 255 * 255 * 128 / outa255);
    const coef2 = 255 * 128 - coef1;
    for (let k = 0; k < 3; k++) {
      const t = s[i + k] * coef1 + d[i + k] * coef2 + (0x80 << 7);
      out[i + k] = (((t >> 8) + t) >> 8) >> 7;
    }
    const ta = outa255 + 0x80;
    out[i + 3] = ((ta >> 8) + ta) >> 8;
  }
  return { mode: "RGBA", w: dst.w, h: dst.h, data: out };
}

// img.alpha_composite(src, (dx, dy)) in place: src over the part of img it covers
export function alphaCompositeAt(dst, src, dx = 0, dy = 0) {
  const x0 = Math.max(0, dx), y0 = Math.max(0, dy);
  const x1 = Math.min(dst.w, dx + src.w), y1 = Math.min(dst.h, dy + src.h);
  if (x1 <= x0 || y1 <= y0) return dst;
  const w = x1 - x0, h = y1 - y0;
  const a = crop(dst, [x0, y0, x1, y1]), b = crop(src, [x0 - dx, y0 - dy, x1 - dx, y1 - dy]);
  const r = alphaComposite(a, b);
  for (let y = 0; y < h; y++) dst.data.set(r.data.subarray(y * w * 4, (y + 1) * w * 4), ((y0 + y) * dst.w + x0) * 4);
  return dst;
}

// img.paste(src, (dx, dy)) in place, no mask: a straight copy, clipped
export function pasteAt(dst, src, dx, dy) {
  const ch = dst.mode === "RGBA" ? 4 : 1;
  const x0 = Math.max(0, dx), x1 = Math.min(dst.w, dx + src.w);
  if (x1 <= x0) return dst;
  for (let y = Math.max(0, dy); y < Math.min(dst.h, dy + src.h); y++)
    dst.data.set(src.data.subarray(((y - dy) * src.w + (x0 - dx)) * ch, ((y - dy) * src.w + (x1 - dx)) * ch), (y * dst.w + x0) * ch);
  return dst;
}

// img.crop(box): outside the image is transparent/zero
export function crop(im, [x0, y0, x1, y1]) {
  const ch = im.mode === "RGBA" ? 4 : 1, out = newImage(im.mode, x1 - x0, y1 - y0);
  for (let y = Math.max(0, y0); y < Math.min(im.h, y1); y++) {
    const xa = Math.max(0, x0), xb = Math.min(im.w, x1);
    if (xb <= xa) continue;
    out.data.set(im.data.subarray((y * im.w + xa) * ch, (y * im.w + xb) * ch), ((y - y0) * out.w + (xa - x0)) * ch);
  }
  return out;
}

export function alphaOf(im) {                               // im.split()[3]
  const out = newImage("L", im.w, im.h);
  for (let p = 0; p < im.w * im.h; p++) out.data[p] = im.data[p * 4 + 3];
  return out;
}

export function putAlpha(im, alpha) {                        // in place
  for (let p = 0; p < im.w * im.h; p++) im.data[p * 4 + 3] = alpha.data[p];
  return im;
}

// --- geometry: Image.rotate / Image.transform --------------------------------------------------------

const MULDIV255 = (a, b) => { const t = a * b + 128; return ((t >> 8) + t) >> 8; };

function premultiply(im) {                                   // RGBA -> RGBa
  const out = cloneImage(im), d = out.data;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; d[i] = MULDIV255(d[i], a); d[i + 1] = MULDIV255(d[i + 1], a); d[i + 2] = MULDIV255(d[i + 2], a); }
  return out;
}

function unpremultiply(im) {                                 // RGBa -> RGBA
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255 || a === 0) continue;
    for (let k = 0; k < 3; k++) d[i + k] = Math.min(255, Math.floor(255 * d[i + k] / a));
  }
  return im;
}

const FLOORI = (v) => (v < 0 ? Math.floor(v) : Math.trunc(v));

// Pillow's affine transform, bicubic filter, on an RGBa image (all four bands), fill with zeros
function affineBicubic(src, w, h, m) {
  const out = newImage("RGBA", w, h), s = src.data, W = src.w, H = src.h;
  const xc = (x) => (x < 0 ? 0 : x < W ? x : W - 1), yc = (y) => (y < 0 ? 0 : y < H ? y : H - 1);
  const cubic = (v1, v2, v3, v4, d) => {
    const p1 = v2, p2 = -v1 + v3, p3 = 2 * (v1 - v2) + v3 - v4, p4 = -v1 + v2 - v3 + v4;
    return p1 + d * (p2 + d * (p3 + d * p4));
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let xin = m[0] * (x + 0.5) + m[1] * (y + 0.5) + m[2];
      let yin = m[3] * (x + 0.5) + m[4] * (y + 0.5) + m[5];
      if (xin < 0 || xin >= W || yin < 0 || yin >= H) continue;
      xin -= 0.5; yin -= 0.5;
      let xi = FLOORI(xin), yi = FLOORI(yin);
      const dx = xin - xi, dy = yin - yi;
      xi--; yi--;
      const cols = [xc(xi), xc(xi + 1), xc(xi + 2), xc(xi + 3)];
      const o = (y * w + x) * 4;
      for (let b = 0; b < 4; b++) {
        const row = (r) => { const base = r * W; return cubic(s[(base + cols[0]) * 4 + b], s[(base + cols[1]) * 4 + b], s[(base + cols[2]) * 4 + b], s[(base + cols[3]) * 4 + b], dx); };
        const v1 = row(yc(yi));
        const v2 = yi + 1 >= 0 && yi + 1 < H ? row(yi + 1) : v1;
        const v3 = yi + 2 >= 0 && yi + 2 < H ? row(yi + 2) : v2;
        const v4 = yi + 3 >= 0 && yi + 3 < H ? row(yi + 3) : v3;
        const v = cubic(v1, v2, v3, v4, dy);
        out.data[o + b] = v <= 0 ? 0 : v >= 255 ? 255 : Math.trunc(v);
      }
    }
  return out;
}

// Image.rotate(angle, resample=BICUBIC, center=None, expand=False) of an RGBA image
export function rotate(im, angle, { center = null, expand = false } = {}) {
  angle = ((angle % 360) + 360) % 360;
  let w = im.w, h = im.h;
  if (!center && angle === 0) return cloneImage(im);
  const [cx, cy] = center || [w / 2, h / 2];
  const r = -(angle * (Math.PI / 180));                      // -math.radians(angle)
  const r15 = (v) => Number(v.toFixed(15)) || 0;
  const m = [r15(Math.cos(r)), r15(Math.sin(r)), 0, r15(-Math.sin(r)), r15(Math.cos(r)), 0];
  const tf = (x, y) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
  [m[2], m[5]] = tf(-cx, -cy);
  m[2] += cx; m[5] += cy;
  if (expand) {
    const xs = [], ys = [];
    for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]]) { const [tx, ty] = tf(x, y); xs.push(tx); ys.push(ty); }
    const nw = Math.ceil(Math.max(...xs)) - Math.floor(Math.min(...xs));
    const nh = Math.ceil(Math.max(...ys)) - Math.floor(Math.min(...ys));
    [m[2], m[5]] = tf(-(nw - w) / 2, -(nh - h) / 2);
    w = nw; h = nh;
  }
  return unpremultiply(affineBicubic(premultiply(im), w, h, m));
}

// Image.transform(size, AFFINE, (a, 0, c, 0, e, f)) with NEAREST on an "L" image (ImagingScaleAffine)
export function scaleAffineNearest(im, w, h, a) {
  const out = newImage("L", w, h);
  const COORD = (v) => (v < 0 ? -1 : Math.trunc(v));
  const xintab = new Int32Array(w);
  let xo = a[2] + a[0] * 0.5, yo = a[5] + a[4] * 0.5, xmin = w, xmax = 0;
  for (let x = 0; x < w; x++) {
    const xin = COORD(xo);
    if (xin >= 0 && xin < im.w) { xmax = x + 1; if (x < xmin) xmin = x; xintab[x] = xin; }
    xo += a[0];
  }
  for (let y = 0; y < h; y++) {
    const yi = COORD(yo);
    if (yi >= 0 && yi < im.h) for (let x = xmin; x < xmax; x++) out.data[y * w + x] = im.data[yi * im.w + xintab[x]];
    yo += a[4];
  }
  return out;
}

// img.paste(src, (0, 0), mask) in place; mask is an "L" image (or omitted: plain copy)
export function paste(dst, src, mask = null) {
  const d = dst.data, s = src.data, ch = dst.mode === "RGBA" ? 4 : 1;
  const n = dst.w * dst.h;
  for (let p = 0; p < n; p++) {
    const m = mask ? mask.data[p] : 255;
    if (m === 0) continue;
    const i = p * ch;
    if (m === 255) { for (let k = 0; k < ch; k++) d[i + k] = s[i + k]; continue; }
    for (let k = 0; k < ch; k++) d[i + k] = blend(m, d[i + k], s[i + k]);
  }
}

export function toL(im) {                                    // convert("L") from RGB(A)
  const out = newImage("L", im.w, im.h), s = im.data;
  for (let p = 0, i = 0; p < im.w * im.h; p++, i += 4)
    out.data[p] = (s[i] * 19595 + s[i + 1] * 38470 + s[i + 2] * 7471 + 0x8000) >>> 16;
  return out;
}

// --- filters ---------------------------------------------------------------------------------------

function blurRadius(radius, passes) {                      // Pillow's, in C single-precision floats
  radius = F(radius);
  const sigma2 = F(F(radius * radius) / passes);
  const L = F(Math.sqrt(12.0 * sigma2 + 1.0));
  const l = F(Math.floor((L - 1.0) / 2.0));
  let a = F(F(2 * l + 1) * F(F(l * F(l + 1)) - F(3 * sigma2)));
  a = F(a / F(6 * F(sigma2 - F(F(l + 1) * F(l + 1)))));
  return F(l + a);
}

function boxBlurLines(data, ch, len, count, stride, step, fr) {
  // blur `count` lines of `len` pixels; pixel k of line n at (n * stride + k * step) * ch
  const r = Math.trunc(fr);
  const ww = Math.trunc(F(16777216 / F(F(fr * 2) + 1)));
  const fw = Math.floor((16777216 - (r * 2 + 1) * ww) / 2);
  const line = new Float64Array(len), last = len - 1;
  for (let n = 0; n < count; n++) {
    for (let c = 0; c < ch; c++) {
      for (let k = 0; k < len; k++) line[k] = data[(n * stride + k * step) * ch + c];
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += line[k < 0 ? 0 : k > last ? last : k];
      for (let x = 0; x < len; x++) {
        const lf = x - r - 1, rf = x + r + 1;
        const bulk = acc * ww + (line[lf < 0 ? 0 : lf] + line[rf > last ? last : rf]) * fw;
        data[(n * stride + x * step) * ch + c] = Math.floor((bulk + 8388608) / 16777216);
        const out = x - r, inn = x + r + 1;
        acc += line[inn > last ? last : inn] - line[out < 0 ? 0 : out];
      }
    }
  }
}

export function gaussianBlur(im, radius) {
  const out = cloneImage(im), ch = im.mode === "RGBA" ? 4 : 1;
  const fr = blurRadius(radius, 3);
  if (fr === 0) return out;
  for (let p = 0; p < 3; p++) boxBlurLines(out.data, ch, im.w, im.h, im.w, 1, fr);
  for (let p = 0; p < 3; p++) boxBlurLines(out.data, ch, im.h, im.w, 1, im.w, fr);
  return out;
}

// MaxFilter / MinFilter(size) on an "L" image, edges replicated
export function rankFilter(im, size, max) {
  const r = size >> 1, { w, h } = im, pick = max ? Math.max : Math.min;
  const tmp = new Uint8Array(w * h), out = newImage("L", w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = im.data[y * w + x];
      for (let k = -r; k <= r; k++) v = pick(v, im.data[y * w + Math.min(w - 1, Math.max(0, x + k))]);
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let k = -r; k <= r; k++) v = pick(v, tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]);
      out.data[y * w + x] = v;
    }
  return out;
}

// --- resize: Pillow's bicubic (a = -0.5), 8-bit fixed point, horizontal pass then vertical -------

function bicubic(x) {
  const a = -0.5;
  if (x < 0) x = -x;
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
  return 0;
}

function coeffs(inSize, outSize) {
  const scale = inSize / outSize, filterscale = Math.max(scale, 1), support = 2 * filterscale;
  const list = [];
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
    const k = [];
    let ww = 0;
    for (let x = 0; x < xmax; x++) { const w = bicubic((x + xmin - center + 0.5) / filterscale); k.push(w); ww += w; }
    const kk = k.map((w) => { const v = ww ? w / ww : 0; return v < 0 ? Math.trunc(-0.5 + v * 4194304) : Math.trunc(0.5 + v * 4194304); });
    list.push({ xmin, kk });
  }
  return list;
}

const clip8 = (ss) => { const v = Math.floor(ss / 4194304); return v < 0 ? 0 : v > 255 ? 255 : v; };

// An "L" grid (Uint8Array, gw x gh) resized to w x h
export function resizeL(grid, gw, gh, w, h) {
  const cx = coeffs(gw, w), cy = coeffs(gh, h);
  const mid = new Uint8Array(w * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < w; x++) {
      const { xmin, kk } = cx[x];
      let ss = 2097152;
      for (let k = 0; k < kk.length; k++) ss += grid[y * gw + xmin + k] * kk[k];
      mid[y * w + x] = clip8(ss);
    }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const { xmin, kk } = cy[y];
    for (let x = 0; x < w; x++) {
      let ss = 2097152;
      for (let k = 0; k < kk.length; k++) ss += mid[(xmin + k) * w + x] * kk[k];
      out[y * w + x] = clip8(ss);
    }
  }
  return out;
}

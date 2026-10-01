// Hex geometry for Roll20 maps (from roll20_maps.py). Roll20's Hex (V) page: regular pointy-top
// hexes one cell wide, rows sqrt(3)/2 cells apart, odd rows shifted right (odd-r). Maps are drawn
// at SS x the Roll20 pixel size.

export const CELL = 70.0;          // Roll20 cell width, px at 1x
export const SS = 2;               // supersampling

export function geometry(cell) {   // [step across a row, row step, half hex width, quarter hex height]
  const sx = cell, sy = cell * Math.sqrt(3) / 2;
  return [sx, sy, sx / 2, sy / 3];
}

export function centre(col, row, cell) {
  const [sx, sy, hw, qh] = geometry(cell);
  return [hw + col * sx + (row % 2 ? hw : 0), 2 * qh + row * sy];
}

export function hexPoints(cx, cy, cell, inset = 0) {
  const [, , hw, qh] = geometry(cell);
  const k = 1 - inset;
  return [[0, -2 * qh], [hw, -qh], [hw, qh], [0, 2 * qh], [-hw, qh], [-hw, -qh]].map(([x, y]) => [cx + x * k, cy + y * k]);
}

export function imageSize(cols, rows, cell) {
  const [sx, sy, hw, qh] = geometry(cell);
  return [Math.ceil(cols * sx + hw), Math.ceil((rows - 1) * sy + 4 * qh)];
}

export function colLetter(col) {
  let s = "";
  col += 1;
  while (col) { const rem = (col - 1) % 26; col = Math.floor((col - 1) / 26); s = String.fromCharCode(65 + rem) + s; }
  return s;
}

// Python round(): half to even
export function pyRound(f) {
  const r = Math.round(f);
  return Math.abs(f % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// Python's math.radians / math.degrees (x * (pi / 180), not (x * pi) / 180: they round differently)
export const radians = (d) => d * (Math.PI / 180);
export const degrees = (r) => r * (180 / Math.PI);

// numpy.arange(start, stop, step) with numpy's own fill (start + i * ((start + step) - start))
export function arange(start, stop, step) {
  const n = Math.max(0, Math.ceil((stop - start) / step));
  const out = [];
  if (n > 0) out.push(start);
  if (n > 1) out.push(start + step);
  const delta = (start + step) - start;
  for (let i = 2; i < n; i++) out.push(start + i * delta);
  return out;
}

// numpy.linspace(start, stop, num[, endpoint])
export function linspace(start, stop, num, endpoint = true) {
  const div = endpoint ? num - 1 : num, step = (stop - start) / div, out = [];
  for (let i = 0; i < num; i++) out.push(i * step + start);
  if (endpoint && num > 1) out[num - 1] = stop;
  return out;
}

// Outer edges of a set of hexes, as [p, q] segments
export function zoneEdges(hexes, cell) {
  const cset = new Map();
  for (const [c, r] of hexes) {
    const [cx, cy] = centre(c, r, cell);
    cset.set(pyRound(cx) + "," + pyRound(cy), [cx, cy]);
  }
  const edges = [];
  for (const [cx, cy] of cset.values()) {
    const pts = hexPoints(cx, cy, cell);
    for (let i = 0; i < 6; i++) {
      const a = pts[i], b = pts[(i + 1) % 6];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const nx = 2 * mx - cx, ny = 2 * my - cy;
      if (!cset.has(pyRound(nx) + "," + pyRound(ny))) edges.push([a, b]);
    }
  }
  return edges;
}

// Split hexes into groups of neighbours
export function connectedParts(hexes, cell) {
  const left = hexes.slice(), parts = [];
  while (left.length) {
    const part = [], todo = [left.pop()];
    while (todo.length) {
      const h = todo.pop();
      part.push(h);
      const [hx, hy] = centre(h[0], h[1], cell);
      const near = left.filter((o) => { const [ox, oy] = centre(o[0], o[1], cell); return Math.hypot(ox - hx, oy - hy) < cell * 1.1; });
      for (const o of near) left.splice(left.indexOf(o), 1);
      todo.push(...near);
    }
    parts.push(part);
  }
  return parts;
}

// Bounding box [x0, y0, x1, y1] of some hexes, in px
export function hexesBox(hexes, cell, pad = 0) {
  const pts = hexes.flatMap(([c, r]) => hexPoints(...centre(c, r, cell), cell));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

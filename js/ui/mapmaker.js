// The Map Maker: paint a hex map (zones, solid structure, decals), pick a style and its settings, and
// get the Roll20 base map. Drawing happens in the render worker; this page keeps an overlay of what
// was painted, so edits show at once while the map redraws underneath.

import { MapModel, key, parse, zoneKind } from "./mapmodel.js";
import { Renderer } from "./renderer.js";
import * as cache from "./rendercache.js";
import { STYLES } from "../maps/render.js";
import { CELL, SS, geometry, centre, hexPoints, imageSize, colLetter, zoneEdges } from "../maps/geometry.js";
import { ZONE_TINT, DEFAULT_TINT } from "../maps/common.js";

const $ = (id) => document.getElementById(id);
const STORE = "lancertools.mapmaker";
const renderer = new Renderer();
const model = new MapModel(15, 10);

const TOOLS = [
  { id: "pc_deploy", label: "Deploy zone", colour: "#4488ff", hint: "Where the PCs deploy." },
  { id: "npc_deploy", label: "Enemy deploy", colour: "#c8c8c8" },
  { id: "control_zone", label: "Control zone", colour: "#9944cc" },
  { id: "ingress", label: "Ingress", colour: "#e0e0e0", hint: "Each connected group is its own ingress (Military Bay gives it a hatch apron)." },
  { id: "entrance", label: "Entrance", colour: "#bbbbbb" },
  { id: "solid", label: "Solid structure", colour: "#101012", terrain: true,
    hint: "Outside the play area. Walls and cover inside the area are tokens." },
  { id: "lift", label: "Lift / loading pad", colour: "#c44026", decal: "hazard_border", hint: "Military Bay: a freight elevator with railings. Training Floor: a hazard-striped loading pad. Depot: a dark steel plate with herringbone tread." },
  { id: "breach", label: "Hull breach", colour: "#ff7828", decal: "blast", hint: "Click a hex: a torn hole with scorch; rubble is thrown from the first breach." },
  { id: "ring", label: "Hazard ring", colour: "#d7a51d", decal: "hazard_ring", hint: "A yellow/black band on the floor around the painted block (a reactor well)." },
  { id: "tracks", label: "Tread marks", colour: "#777", decal: "tracks", hint: "Click the start hex, then the end hex." },
  { id: "hatch", label: "Floor hatch", colour: "#8a8684", decal: "floor_hatch", hint: "A round steel hatch set in the floor (Depot: the round lift pad with the X, about two hexes across)." },
  { id: "erase", label: "Eraser", colour: "transparent", hint: "Removes everything on a hex. Right-drag erases with any tool." },
];
let tool = "pc_deploy";
let trackStart = null;

// --- the view --------------------------------------------------------------------------------------

const stage = $("stage"), baseCv = $("base"), overCv = $("over");
const baseCtx = baseCv.getContext("2d"), overCtx = overCv.getContext("2d");
let view = { s: 1, ox: 0, oy: 0 };
let bitmap = null, bitmapSize = null;
let hover = null;
let showEdits = true, showGrid = true;

const mapSize = () => imageSize(model.cols, model.rows, CELL);           // at 1x (Roll20 px)

function resize() {
  const dpr = window.devicePixelRatio || 1, w = stage.clientWidth, h = stage.clientHeight;
  for (const cv of [baseCv, overCv]) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + "px"; cv.style.height = h + "px";
    cv.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  drawBase(); drawOverlay();
}

function fit() {
  const [w, h] = mapSize(), pad = 24;
  view.s = Math.max(0.02, Math.min((stage.clientWidth - 2 * pad) / w, (stage.clientHeight - 2 * pad) / h));
  view.ox = (stage.clientWidth - w * view.s) / 2;
  view.oy = (stage.clientHeight - h * view.s) / 2;
  drawBase(); drawOverlay();
}

function drawBase() {
  const ctx = baseCtx, [w, h] = mapSize();
  ctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);
  ctx.fillStyle = "#1c1d20";
  ctx.fillRect(view.ox, view.oy, w * view.s, h * view.s);
  if (bitmap) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, view.ox, view.oy, (bitmapSize[0] / SS) * view.s, (bitmapSize[1] / SS) * view.s);
  }
}

const toScreen = ([x, y]) => [view.ox + x * view.s, view.oy + y * view.s];

function hexPath(ctx, c, r, inset = 0) {
  const pts = hexPoints(...centre(c, r, CELL), CELL, inset).map(toScreen);
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
}

function fillHexes(ctx, keys, fill) {
  if (!keys.size) return;
  ctx.beginPath();
  for (const k of keys) hexPath(ctx, ...parse(k));
  ctx.fillStyle = fill;
  ctx.fill();
}

function outline(ctx, keys, stroke, width, dash = []) {
  if (!keys.size) return;
  ctx.beginPath();
  for (const [a, b] of zoneEdges([...keys].map(parse), CELL)) { const p = toScreen(a), q = toScreen(b); ctx.moveTo(...p); ctx.lineTo(...q); }
  ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const UI_BLUE = "#1e90ff";                                  // the site's accent (hover, pending track start)

function drawOverlay() {
  const ctx = overCtx;
  ctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);
  if (showGrid) {
    ctx.beginPath();
    for (let r = 0; r < model.rows; r++) for (let c = 0; c < model.cols; c++) hexPath(ctx, c, r);
    ctx.strokeStyle = "rgba(255,255,255,0.13)"; ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (showEdits) {
    const solid = new Set([...model.terrain].filter(([, v]) => v === "obstruction").map(([k]) => k));
    fillHexes(ctx, solid, "rgba(0,0,0,0.55)");
    outline(ctx, solid, "rgba(150,150,160,0.6)", 1.5);
    for (const z of model.zones) {
      const kind = zoneKind(z.id);
      if (!kind) continue;
      const [rgb] = ZONE_TINT[z.id] || ZONE_TINT[kind] || DEFAULT_TINT;
      fillHexes(ctx, z.hexes, rgba(rgb, 0.28));
      outline(ctx, z.hexes, rgba(rgb, 0.95), 2, [6, 4]);
    }
    const lift = model.hexDecal("hazard_border");
    if (lift) { fillHexes(ctx, lift.hexes, "rgba(196,64,38,0.45)"); outline(ctx, lift.hexes, "#e0683f", 2.5); }
    const ring = model.hexDecal("hazard_ring");
    if (ring) outline(ctx, ring.hexes, "#d7a51d", 4, [8, 6]);
    const hatch = model.hexDecal("floor_hatch");
    if (hatch)
      for (const k of hatch.hexes) {
        const [x, y] = toScreen(centre(...parse(k), CELL)), rr = CELL * 0.4 * view.s;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(140,136,132,0.55)"; ctx.fill();
        ctx.strokeStyle = "#ddd"; ctx.lineWidth = 2; ctx.stroke();
      }
    for (const d of model.decals) {
      if ((d.type === "blast" || d.type === "scorch") && d.hexes)
        for (const k of d.hexes) {
          const [x, y] = toScreen(centre(...parse(k), CELL)), rr = CELL * 0.3 * view.s;
          ctx.beginPath(); ctx.arc(x, y, rr, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(255,120,40,0.55)"; ctx.fill();
          ctx.strokeStyle = "#ffb070"; ctx.lineWidth = 2; ctx.stroke();
        }
      if (d.type === "tracks") arrow(ctx, d.from, d.to, "rgba(220,220,220,0.8)");
    }
  }
  if (trackStart) {
    const [x, y] = toScreen(centre(...trackStart, CELL));
    ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); ctx.fillStyle = UI_BLUE; ctx.fill();
    if (hover) arrow(ctx, trackStart, hover, UI_BLUE);
  }
  if (hover) {
    ctx.beginPath(); hexPath(ctx, ...hover);
    ctx.strokeStyle = UI_BLUE; ctx.lineWidth = 2; ctx.stroke();
  }
}

function arrow(ctx, from, to, colour) {
  const a = toScreen(centre(...from, CELL)), b = toScreen(centre(...to, CELL));
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), s = 10;
  ctx.beginPath();
  ctx.moveTo(...a); ctx.lineTo(...b);
  ctx.moveTo(b[0] - s * Math.cos(ang - 0.5), b[1] - s * Math.sin(ang - 0.5)); ctx.lineTo(...b);
  ctx.lineTo(b[0] - s * Math.cos(ang + 0.5), b[1] - s * Math.sin(ang + 0.5));
  ctx.strokeStyle = colour; ctx.lineWidth = 3; ctx.stroke();
}

// the hex under a point on screen (or null)
function hexAt(sx, sy) {
  const x = (sx - view.ox) / view.s, y = (sy - view.oy) / view.s;
  const [csx, csy, hw, qh] = geometry(CELL);
  let best = null, bd = Infinity;
  const r0 = Math.floor((y - 2 * qh) / csy);
  for (let r = r0 - 1; r <= r0 + 2; r++) {
    if (r < 0 || r >= model.rows) continue;
    const c0 = Math.round((x - hw - (r % 2 ? hw : 0)) / csx);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= model.cols) continue;
      const [cx, cy] = centre(c, r, CELL), d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bd) { bd = d; best = [c, r]; }
    }
  }
  return best && bd <= (CELL * 0.6) ** 2 ? best : null;
}

// --- editing -----------------------------------------------------------------------------------------

const undoStack = [], redoStack = [];
let strokeBefore = null, strokeChanged = false, painting = 0, panning = null, spaceDown = false;

function apply(c, r, erase) {
  const t = TOOLS.find((x) => x.id === tool);
  if (tool === "erase") return model.eraseAll(c, r);
  if (t.decal && !styleHas(t.decal)) return false;
  if (ZONE_KIND_IDS.has(tool)) return erase ? model.eraseZone(c, r) : model.paintZone(tool, c, r);
  if (tool === "solid") return model.setSolid(c, r, !erase);
  if (tool === "lift") return model.setHexDecal("hazard_border", c, r, !erase);
  if (tool === "ring") return model.setHexDecal("hazard_ring", c, r, !erase);
  if (tool === "hatch") return model.setHexDecal("floor_hatch", c, r, !erase);
  if (tool === "breach") return model.setBreach(c, r, !erase);
  if (tool === "tracks") {
    if (erase) return model.eraseTracks(c, r);
    if (!trackStart) { trackStart = [c, r]; return false; }
    const from = trackStart;
    trackStart = null;
    return model.addTracks(from, [c, r]);
  }
  return false;
}
const ZONE_KIND_IDS = new Set(["pc_deploy", "npc_deploy", "control_zone", "ingress", "entrance"]);
const styleHas = (decal) => (STYLES[model.style].decals || []).includes(decal);

function commit(before) {
  undoStack.push(before);
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  changed();
}

function changed({ render = true } = {}) {
  drawOverlay();
  save();
  if (render) requestRender();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(model.snapshot());
  model.restore(undoStack.pop());
  syncControls();
  changed();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(model.snapshot());
  model.restore(redoStack.pop());
  syncControls();
  changed();
}

overCv.addEventListener("contextmenu", (e) => e.preventDefault());
overCv.addEventListener("pointerdown", (e) => {
  overCv.setPointerCapture(e.pointerId);
  if (e.button === 1 || (e.button === 0 && spaceDown)) { panning = [e.offsetX - view.ox, e.offsetY - view.oy]; return; }
  if (e.button !== 0 && e.button !== 2) return;
  painting = e.button === 2 ? 2 : 1;
  strokeBefore = model.snapshot();
  strokeChanged = false;
  const h = hexAt(e.offsetX, e.offsetY);
  if (h) strokeChanged = apply(h[0], h[1], painting === 2) || strokeChanged;
  drawOverlay();
});
overCv.addEventListener("pointermove", (e) => {
  if (panning) { view.ox = e.offsetX - panning[0]; view.oy = e.offsetY - panning[1]; drawBase(); drawOverlay(); return; }
  const h = hexAt(e.offsetX, e.offsetY);
  const same = h && hover && h[0] === hover[0] && h[1] === hover[1];
  if (same) return;
  hover = h;
  $("hover").textContent = h ? `${colLetter(h[0])}${h[1] + 1}` + (model.describe(...h).length ? " · " + model.describe(...h).join(", ") : "") : "–";
  if (painting && h && tool !== "tracks" && tool !== "breach") strokeChanged = apply(h[0], h[1], painting === 2) || strokeChanged;
  drawOverlay();
});
overCv.addEventListener("pointerup", () => {
  panning = null;
  if (painting && strokeChanged) commit(strokeBefore);
  painting = 0;
  drawOverlay();
});
overCv.addEventListener("pointerleave", () => { if (!painting) { hover = null; $("hover").textContent = "–"; drawOverlay(); } });
overCv.addEventListener("wheel", (e) => {
  e.preventDefault();
  const k = Math.pow(1.0015, -e.deltaY), s = Math.min(8, Math.max(0.05, view.s * k));
  view.ox = e.offsetX - (e.offsetX - view.ox) * (s / view.s);
  view.oy = e.offsetY - (e.offsetY - view.oy) * (s / view.s);
  view.s = s;
  drawBase(); drawOverlay();
}, { passive: false });

addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea")) return;
  if (e.code === "Space") { spaceDown = true; overCv.classList.add("pan"); e.preventDefault(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
  else if (e.key === "f") fit();
  else if (e.key === "e") toggleView("edits");
  else if (e.key === "g") toggleView("grid");
  else if (e.key === "Escape") { trackStart = null; drawOverlay(); }
});
addEventListener("keyup", (e) => { if (e.code === "Space") { spaceDown = false; overCv.classList.remove("pan"); } });

function toggleView(which) {
  if (which === "edits") showEdits = !showEdits; else showGrid = !showGrid;
  $("edits").setAttribute("aria-pressed", String(showEdits));
  $("grid").setAttribute("aria-pressed", String(showGrid));
  drawOverlay();
}

// --- rendering -----------------------------------------------------------------------------------------

let rendering = false, dirty = false, renderTimer = null, timerPending = false;
let workerHasMap = false;                                     // false after showing a kept picture: the worker drew nothing yet

function requestRender(delay = 0) {
  clearTimeout(renderTimer);
  timerPending = true;
  renderTimer = setTimeout(() => { timerPending = false; dirty = true; if (!rendering) runRender(); }, delay);
}

async function runRender() {
  rendering = true;
  while (dirty) {
    dirty = false;
    status(`Rendering ${STYLES[model.style].name}…`, "busy");
    try {
      const json = model.toJson(), style = model.style, opts = model.optsFor();
      const r = await renderer.map(json, style, opts);
      bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(r.pixels), r.w, r.h));
      bitmapSize = [r.w, r.h];
      workerHasMap = true;
      status(`Drawn in ${(r.ms / 1000).toFixed(1)} s`);
      cache.keyFor(json, style, opts).then((k) => cache.put(k, r.pixels, r.w, r.h));   // for the next visit
    } catch (e) {
      console.error(e);
      status("Couldn't draw the map: " + String(e.message).split("\n")[0], "err");
    }
    drawBase();
  }
  rendering = false;
}

function status(text, cls = "") { const s = $("status"); s.textContent = text; s.className = cls; }

async function settled() {                                   // until the drawn map matches the edits
  while (rendering || dirty || timerPending) await new Promise((r) => setTimeout(r, 100));
}

// --- the sidebar ---------------------------------------------------------------------------------------

function buildTools() {
  const box = $("tools");
  box.innerHTML = "";
  for (const t of TOOLS) {
    const b = document.createElement("button");
    b.innerHTML = `<span class="sw" style="background:${t.colour}"></span>${t.label}`;
    b.setAttribute("aria-pressed", String(t.id === tool));
    if (t.decal && !styleHas(t.decal)) { b.disabled = true; b.title = `Not drawn in ${STYLES[model.style].name}`; }
    b.onclick = () => { tool = t.id; trackStart = null; buildTools(); };
    box.append(b);
  }
  const t = TOOLS.find((x) => x.id === tool);
  let hint = t.hint || "";
  if (t.terrain) hint += " " + (STYLES[model.style].terrainNote || `${STYLES[model.style].name} doesn't draw it.`);
  $("toolHint").textContent = hint + " Left-drag paints, right-drag erases. Space-drag or middle-drag pans, the wheel zooms.";
}

function buildSettings() {
  const box = $("settings"), style = STYLES[model.style], opts = model.optsFor();
  box.innerHTML = "";
  let group = null;
  for (const s of style.settings) {
    if (s.group !== group) {
      group = s.group;
      const g = document.createElement("div");
      g.className = "group-name";
      g.textContent = group;
      box.append(g);
    }
    const v = opts[s.id] ?? s.default, row = document.createElement("div"), id = "opt_" + s.id;
    if (s.type === "toggle") {
      row.className = "setting toggle";
      row.innerHTML = `<input type="checkbox" id="${id}"${v ? " checked" : ""}><label for="${id}">${s.label}</label>`;
      row.querySelector("input").onchange = (e) => setOpt(s, e.target.checked);
    } else {
      row.className = "setting";
      row.innerHTML = `<label for="${id}">${s.label}</label><output>${Math.round(v * 100)}%</output>
        <input type="range" id="${id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" title="Double-click to reset">`;
      const input = row.querySelector("input"), out = row.querySelector("output");
      input.oninput = () => { out.textContent = Math.round(input.value * 100) + "%"; setOpt(s, Number(input.value), 300); };
      input.ondblclick = () => { input.value = s.default; input.oninput(); };
    }
    box.append(row);
  }
}

function setOpt(s, value, delay = 0) {
  model.setOpt(s.id, value);
  save();
  requestRender(delay);
}

function syncControls() {
  $("name").value = model.name;
  $("cols").value = model.cols;
  $("rows").value = model.rows;
  $("style").value = model.style;
  $("styleBlurb").textContent = STYLES[model.style].blurb || "";
  buildTools();
  buildSettings();
  updateOut();
}

function updateOut() {
  const [w, h] = mapSize();
  $("out").textContent = `Roll20 size ${w} × ${h} px`;
}

$("style").innerHTML = Object.entries(STYLES).map(([id, s]) => `<option value="${id}">${s.name}</option>`).join("");
$("style").onchange = (e) => { const before = model.snapshot(); model.style = e.target.value; syncControls(); commit(before); };
$("name").onchange = (e) => { model.name = e.target.value.trim() || "untitled"; save(); };
for (const id of ["cols", "rows"])
  $(id).onchange = () => {
    const cols = Math.max(3, Math.min(60, Number($("cols").value) || model.cols));
    const rows = Math.max(3, Math.min(60, Number($("rows").value) || model.rows));
    if (cols === model.cols && rows === model.rows) return;
    const before = model.snapshot();
    model.resize(cols, rows);
    syncControls();
    commit(before);
    fit();
  };
$("resetOpts").onclick = () => { model.resetOpts(); buildSettings(); save(); requestRender(); };
$("new").onclick = () => {
  if (!confirm("Start a new, empty map? (Undo brings the old one back.)")) return;
  const before = model.snapshot(), style = model.style;
  model.reset(model.cols, model.rows);
  model.style = style;
  syncControls(); commit(before); fit();
};
$("open").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j.cols || !j.rows) throw new Error("no cols/rows: not a map file");
    const before = model.snapshot();
    model.load(j);
    if (!STYLES[model.style]) model.style = "milbay";
    if (model.name === "untitled") model.name = f.name.replace(/\.json$/i, "");
    syncControls(); commit(before); fit();
  } catch (err) { alert("Couldn't open that file: " + err.message); }
};
$("save").onclick = () => download(new Blob([JSON.stringify(model.toJson(), null, 1)], { type: "application/json" }), `${slug()}.json`);
$("png").onclick = async () => {
  const btn = $("png");
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    await settled();
    if (!workerHasMap) { requestRender(); await settled(); }             // the picture on screen was a kept one
    const { png } = await renderer.mapPng();
    const [w, h] = mapSize();
    const name = `${slug()}_base_${w}x${h}.png`;
    download(new Blob([png], { type: "image/png" }), name);
    $("out").textContent = `Saved ${name}: in Roll20 set it to ${w} × ${h} px.`;
  } catch (err) { alert("Couldn't save the map: " + err.message); }
  btn.disabled = false;
  btn.textContent = "Download base map (PNG)";
};
$("edits").onclick = () => toggleView("edits");
$("grid").onclick = () => toggleView("grid");
$("fit").onclick = fit;
$("undo").onclick = undo;
$("redo").onclick = redo;

function slug() { return model.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "map"; }

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// --- keep the work between visits (this browser only) ----------------------------------------------------

// On arrival: if the last drawn picture is of exactly this map, style, settings and code, show it and
// don't draw again; otherwise draw.
async function showKept() {
  const kept = await cache.get(await cache.keyFor(model.toJson(), model.style, model.optsFor()).catch(() => null));
  if (rendering || dirty || timerPending) return;                             // edited meanwhile: that drawing wins
  if (!kept) { requestRender(); return; }
  bitmap = kept.bitmap;
  bitmapSize = [kept.w, kept.h];
  status("Shown as last drawn (nothing changed)");
  drawBase();
}

function save() { try { localStorage.setItem(STORE, model.snapshot()); } catch {} }

function load() {
  try {
    const s = localStorage.getItem(STORE);
    if (s) { model.restore(s); if (!STYLES[model.style]) model.style = "milbay"; }
  } catch {}
}

load();
const openUrl = new URLSearchParams(location.search).get("open");            // maps.html?open=<map.json url>
if (openUrl) {
  try {
    const j = await (await fetch(openUrl)).json();
    model.load(j);
    if (!STYLES[model.style]) model.style = "milbay";
    history.replaceState(null, "", location.pathname);                        // a reload keeps the edits, not the file
  } catch (e) { console.error("couldn't open", openUrl, e); }
}
syncControls();
new ResizeObserver(() => resize()).observe(stage);
resize();
fit();
await showKept();
// for tests/ (headless checks): open a map, set a setting, wait for the drawing, fetch the PNG
window.mapmaker = {
  model, settled,
  open(j) { model.load(j); syncControls(); fit(); requestRender(); },
  setOpt(id, v) { model.setOpt(id, v); buildSettings(); requestRender(); },
  png: () => renderer.mapPng(),
  status: () => $("status").textContent,
};
window.ready = true;

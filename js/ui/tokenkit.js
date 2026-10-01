// The Token Kit: a 5etools-style list (filter, set and kind chips, sortable columns, J/K to move) and a
// stat block for the selected token, with its preview and downloads. Tokens are drawn by the render
// worker: the selected one first, the rest in the background (for the ZIPs).

import { Renderer } from "./renderer.js?v=0f282507bd";
import { TOKENS } from "../tokens/index.js?v=0f282507bd";
import { describe, SETS, FOOTPRINT_TEXT } from "../tokens/meta.js?v=0f282507bd";
import { zipBlob } from "../zip.js?v=0f282507bd";

const $ = (id) => document.getElementById(id);
const renderer = new Renderer();
const items = Object.keys(TOKENS).map(describe);
const byName = new Map(items.map((t) => [t.name, t]));
const drawn = new Map();                                   // name -> Promise<{file, w, h, png, url}>
const store = (k, v) => { try { localStorage.setItem("lancertools.tokens." + k, v); } catch {} };
const recall = (k, d) => { try { return localStorage.getItem("lancertools.tokens." + k) ?? d; } catch { return d; } };

function draw(name) {
  if (!drawn.has(name))
    drawn.set(name, renderer.token(name).then((r) => ({ ...r, url: URL.createObjectURL(new Blob([r.png], { type: "image/png" })) })));
  return drawn.get(name);
}

// --- filtering and sorting -----------------------------------------------------------------------------

const kinds = [...new Set(items.map((t) => t.kind))].sort();
const on = { sets: new Set(Object.keys(SETS)), kinds: new Set(kinds) };
let sortKey = "title", sortDir = 1, selected = recall("selected", items[0].name), bg = recall("bg", "dark");

function chip(label, active, onclick, colour) {
  const b = document.createElement("button");
  b.className = "chip";
  b.textContent = label;
  b.setAttribute("aria-pressed", String(active));
  if (colour) b.style.borderLeft = `3px solid ${colour}`;
  b.onclick = () => { onclick(); b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); renderList(); };
  return b;
}

for (const [id, s] of Object.entries(SETS)) $("chips").append(chip(s.name, true, () => toggle(on.sets, id), s.colour));
for (const k of kinds) $("chips").append(chip(k, true, () => toggle(on.kinds, k)));
function toggle(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }

function visible() {
  const q = $("filter").value.trim().toLowerCase();
  return items
    .filter((t) => on.sets.has(t.set) && on.kinds.has(t.kind))
    .filter((t) => !q || `${t.name} ${t.title} ${t.kind} ${SETS[t.set].name}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const ka = sortKey === "set" ? SETS[a.set].name : a[sortKey], kb = sortKey === "set" ? SETS[b.set].name : b[sortKey];
      return (ka < kb ? -1 : ka > kb ? 1 : (a.variant || 0) - (b.variant || 0)) * sortDir;
    });
}

function renderList() {
  const rows = visible(), body = $("list").tBodies[0];
  body.replaceChildren(...rows.map((t) => {
    const tr = document.createElement("tr");
    tr.dataset.name = t.name;
    if (t.name === selected) tr.className = "sel";
    tr.innerHTML = `<td class="name">${t.title}${t.variant ? ` <span style="color:var(--muted);font-weight:400">v${t.variant}</span>` : ""}</td>
      <td>${t.kind}</td><td class="num">${t.footprint.replace("Size ", "")}</td>
      <td class="num" style="color:${SETS[t.set].colour}">${SETS[t.set].name}</td>`;
    tr.onclick = () => select(t.name);
    return tr;
  }));
  $("count").textContent = `${rows.length}/${items.length}`;
}

for (const th of $("list").tHead.rows[0].cells)
  th.onclick = () => {
    if (sortKey === th.dataset.k) sortDir = -sortDir; else { sortKey = th.dataset.k; sortDir = 1; }
    for (const o of $("list").tHead.rows[0].cells) o.classList.toggle("sorted", o === th), o.classList.toggle("desc", o === th && sortDir < 0);
    renderList();
  };
$("filter").oninput = renderList;

// --- the stat block ---------------------------------------------------------------------------------------

async function select(name, scroll = false) {
  selected = name;
  store("selected", name);
  for (const tr of $("list").tBodies[0].rows) tr.classList.toggle("sel", tr.dataset.name === name);
  if (scroll) $("list").querySelector("tr.sel")?.scrollIntoView({ block: "nearest" });
  const t = byName.get(name), set = SETS[t.set];
  const family = items.filter((o) => o.family === t.family && o.variant);
  $("sb").innerHTML = `
    <h2 class="sb-title">${t.title}<span class="src" style="color:${set.colour}">${set.name}</span></h2>
    <div class="sb-sub">${t.kind}, ${t.footprint} (${FOOTPRINT_TEXT[t.footprint]})${t.variant ? `, variant ${t.variant}` : ""}</div>
    <div class="prevbar"><div class="variants" id="variants"></div>
      <div class="btn-group" id="bgs">${["dark", "deck", "check", "light"].map((b) =>
        `<button data-bg="${b}" aria-pressed="${b === bg}">${b === "check" ? "Checker" : b[0].toUpperCase() + b.slice(1)}</button>`).join("")}</div></div>
    <div class="preview" id="pv"><span class="hint">Drawing…</span></div>
    <h3 class="sec">Details</h3>
    <dl>
      <dt>Roll20 size</dt><dd id="d-size">…</dd>
      <dt>File</dt><dd class="mono" id="d-file">…</dd>
      <dt>Footprint</dt><dd>${t.footprint}: ${FOOTPRINT_TEXT[t.footprint]}</dd>
      <dt>Kind</dt><dd>${t.kind}</dd>
    </dl>
    ${t.notes ? `<p class="notes">${t.notes}</p>` : ""}
    <div class="sb-actions">
      <button class="go" id="dl" disabled>Download PNG</button>
      <button class="action" id="dlset">${set.name} set (.zip)</button>
    </div>`;
  for (const o of family) {
    const b = document.createElement("button");
    b.className = "chip pick";
    b.textContent = "v" + o.variant;
    b.setAttribute("aria-pressed", String(o.name === name));
    b.onclick = () => select(o.name, true);
    $("variants").append(b);
  }
  for (const b of $("bgs").children) b.onclick = () => { bg = b.dataset.bg; store("bg", bg); applyBg(); for (const o of $("bgs").children) o.setAttribute("aria-pressed", String(o === b)); };
  $("dlset").onclick = () => downloadZip(items.filter((o) => o.set === t.set).map((o) => o.name), `lancertools_${t.set}_tokens.zip`);
  applyBg();
  const r = await draw(name);
  if (selected !== name) return;
  const img = new Image();
  img.src = r.url;
  img.alt = t.title;
  img.width = r.w * 2; img.height = r.h * 2;                 // at its drawn size (2x the Roll20 size)
  $("pv").replaceChildren(img);
  $("d-size").textContent = `${r.w} × ${r.h} px`;
  $("d-file").textContent = r.file;
  $("dl").disabled = false;
  $("dl").onclick = () => save(new Blob([r.png], { type: "image/png" }), r.file);
}

function applyBg() { document.body.classList.remove("bg-dark", "bg-deck", "bg-check", "bg-light"); document.body.classList.add("bg-" + bg); }

function save(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function downloadZip(names, zipName) {
  const files = await Promise.all(names.map(draw));
  save(zipBlob(files.map((f) => ({ name: f.file, data: f.png }))), zipName);
}
$("all").onclick = () => downloadZip(items.map((t) => t.name), "lancertools_tokens.zip");

// J / K (and the arrow keys) move through the list, as on 5etools
addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  const step = e.key === "j" || e.key === "J" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "K" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const rows = [...$("list").tBodies[0].rows], i = rows.findIndex((r) => r.dataset.name === selected);
  const next = rows[Math.min(rows.length - 1, Math.max(0, i + step))];
  if (next) select(next.dataset.name, true);
});

if (!byName.has(selected)) selected = items[0].name;
renderList();
select(selected, true);
window.ready = true;

// the rest in the background, so the ZIPs are ready
let done = 0;
for (const t of items) {
  await draw(t.name).catch((e) => console.error(t.name, e));
  $("progress").textContent = ++done < items.length ? `Drawing tokens… ${done}/${items.length}` : `${items.length} tokens ready`;
}
$("all").disabled = false;

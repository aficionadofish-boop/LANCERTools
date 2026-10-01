// The Map Maker's map: the same JSON the Python tools read (cols, rows, terrain, zones, decals), held
// in a form that's easy to paint. Anything else in an imported file (name, tokens, elevation, other
// zones, other decals) is kept and written back. Zone ids and decal order are kept too: decals are
// seeded by their position in the list, so an imported map renders exactly as before.

export const key = (c, r) => `${c},${r}`;
export const parse = (k) => k.split(",").map(Number);

// Rule zones the painter knows; the single ones have one zone each, ingress/entrance one per group
export const ZONE_KINDS = ["pc_deploy", "npc_deploy", "control_zone", "ingress", "entrance"];
const GROUPED = new Set(["ingress", "entrance"]);
export const zoneKind = (id) => ZONE_KINDS.find((k) => id === k || (GROUPED.has(k) && id.startsWith(k))) || null;

const neighbours = (c, r) => {
  const odd = r % 2 === 1;
  return [[c - 1, r], [c + 1, r], [odd ? c : c - 1, r - 1], [odd ? c + 1 : c, r - 1], [odd ? c : c - 1, r + 1], [odd ? c + 1 : c, r + 1]];
};

function parts(keys) {                                     // connected groups of hex keys
  const left = new Set(keys), out = [];
  while (left.size) {
    const start = left.values().next().value, part = new Set([start]), todo = [start];
    left.delete(start);
    while (todo.length) {
      const [c, r] = parse(todo.pop());
      for (const [nc, nr] of neighbours(c, r)) { const k = key(nc, nr); if (left.has(k)) { left.delete(k); part.add(k); todo.push(k); } }
    }
    out.push(part);
  }
  return out;
}

export class MapModel {
  constructor(cols = 15, rows = 10) { this.reset(cols, rows); }

  reset(cols, rows) {
    this.name = "untitled";
    this.cols = cols; this.rows = rows;
    this.style = "milbay";
    this.zones = [];                                      // [{id, hexes: Set<key>, rest: {...}}] in file order
    this.terrain = new Map();                             // key -> terrain type ("obstruction" is painted)
    this.decals = [];                                     // [{type, hexes?: Set, from?, to?, rest}] in file order
    this.extra = {};                                      // other top-level keys, written back as they were
    this.settings = {};                                   // per style: {id: value}
  }

  // --- JSON in and out -----------------------------------------------------------------------------

  load(j) {
    this.reset(j.cols || 15, j.rows || 10);
    const { cols, rows, terrain, zones, decals, style, style_settings: ss, ...extra } = j;
    this.name = j.name || "untitled";
    delete extra.name;
    this.extra = extra;
    if (style) this.style = style;
    if (ss) this.settings = JSON.parse(JSON.stringify(ss));
    for (const [k, v] of Object.entries(terrain || {})) this.terrain.set(k, v);
    for (const [id, z] of Object.entries(zones || {})) {
      const { hexes, ...rest } = z;
      this.zones.push({ id, hexes: new Set((hexes || []).map(([c, r]) => key(c, r))), rest });
    }
    for (const d of decals || []) {
      const { type, hexes, zone, from, to, ...rest } = d;
      const dec = { type, rest };
      if (type === "hazard_border" && zone && !hexes) {       // the lift on a zone: held as its hexes
        const z = this.zones.find((z) => z.id === zone);
        dec.hexes = new Set(z ? z.hexes : []);
        dec.zone = zone;
      } else if (hexes) dec.hexes = new Set(hexes.map(([c, r]) => key(c, r)));
      if (from) { dec.from = from; dec.to = to; }
      this.decals.push(dec);
    }
    return this;
  }

  toJson() {
    const sortKeys = (set) => [...set].map(parse);
    const zones = {};
    for (const z of this.zones) if (z.hexes.size) zones[z.id] = { hexes: sortKeys(z.hexes), ...z.rest };
    const decals = [];
    for (const d of this.decals) {
      const out = { type: d.type };
      if (d.hexes) {
        const z = d.type === "hazard_border" && this.zones.find((z) => z.hexes.size === d.hexes.size && [...z.hexes].every((k) => d.hexes.has(k)));
        if (z) out.zone = z.id;                           // the lift is a whole zone: say so (the Python reads it)
        else out.hexes = sortKeys(d.hexes);
        if (!d.hexes.size) continue;
      }
      if (d.from) { out.from = d.from; out.to = d.to; }
      decals.push({ ...out, ...d.rest });
    }
    const terrain = {};
    for (const [k, v] of this.terrain) terrain[k] = v;
    const settings = this.settings[this.style];
    return { name: this.name, cols: this.cols, rows: this.rows, style: this.style,
      ...(settings && Object.keys(settings).length ? { style_settings: { [this.style]: settings } } : {}),
      terrain, zones, decals, ...this.extra };
  }

  snapshot() { return JSON.stringify({ ...this.toJson(), style_settings: this.settings }); }
  restore(s) { this.load(JSON.parse(s)); }

  optsFor(style = this.style) { return this.settings[style] || {}; }
  setOpt(id, value) { (this.settings[this.style] ||= {})[id] = value; }
  resetOpts() { delete this.settings[this.style]; }

  inside(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }

  // --- zones ---------------------------------------------------------------------------------------

  zoneAt(k) { return this.zones.find((z) => zoneKind(z.id) && z.hexes.has(k)) || null; }

  paintZone(kind, c, r) {
    const k = key(c, r);
    const cur = this.zoneAt(k);
    if (cur && zoneKind(cur.id) === kind) return false;
    if (cur) this.removeFromZone(cur, k);
    if (!GROUPED.has(kind)) {
      let z = this.zones.find((z) => z.id === kind);
      if (!z) this.zones.push(z = { id: kind, hexes: new Set(), rest: {} });
      z.hexes.add(k);
      return true;
    }
    // ingress / entrance: join the group it touches (merging groups it bridges), or start a new one
    const near = new Set(neighbours(c, r).map(([nc, nr]) => key(nc, nr)));
    const touching = this.zones.filter((z) => zoneKind(z.id) === kind && [...z.hexes].some((h) => near.has(h)));
    if (!touching.length) {
      let n = 1;
      while (this.zones.some((z) => z.id === `${kind}_${n}`)) n++;
      this.zones.push({ id: `${kind}_${n}`, hexes: new Set([k]), rest: {} });
      return true;
    }
    touching[0].hexes.add(k);
    for (const z of touching.slice(1)) { for (const h of z.hexes) touching[0].hexes.add(h); z.hexes.clear(); }
    this.zones = this.zones.filter((z) => z.hexes.size || !zoneKind(z.id));
    return true;
  }

  removeFromZone(z, k) {
    z.hexes.delete(k);
    if (GROUPED.has(zoneKind(z.id)) && z.hexes.size) {    // a group cut in two becomes two groups
      const ps = parts(z.hexes);
      if (ps.length > 1) {
        z.hexes = ps[0];
        const kind = zoneKind(z.id);
        for (const p of ps.slice(1)) {
          let n = 1;
          while (this.zones.some((o) => o.id === `${kind}_${n}`)) n++;
          this.zones.push({ id: `${kind}_${n}`, hexes: p, rest: {} });
        }
      }
    }
    this.zones = this.zones.filter((o) => o.hexes.size || !zoneKind(o.id));
  }

  eraseZone(c, r) {
    const z = this.zoneAt(key(c, r));
    if (!z) return false;
    this.removeFromZone(z, key(c, r));
    return true;
  }

  // --- terrain: solid structure (outside the play area) --------------------------------------------

  setSolid(c, r, on) {
    const k = key(c, r), is = this.terrain.get(k) === "obstruction";
    if (on === is) return false;
    if (on) this.terrain.set(k, "obstruction"); else this.terrain.delete(k);
    return true;
  }

  // --- decals ----------------------------------------------------------------------------------------

  hexDecal(type, create) {                                 // the one lift / hazard ring decal
    let d = this.decals.find((d) => d.type === type && d.hexes);
    if (!d && create) this.decals.push(d = { type, hexes: new Set(), rest: {} });
    return d;
  }

  setHexDecal(type, c, r, on) {
    const k = key(c, r), d = this.hexDecal(type, on);
    if (!d || d.hexes.has(k) === on) return false;
    if (on) d.hexes.add(k); else d.hexes.delete(k);
    delete d.zone;
    if (!d.hexes.size) this.decals = this.decals.filter((x) => x !== d);
    return true;
  }

  breachAt(k) { return this.decals.find((d) => (d.type === "blast" || d.type === "scorch") && d.hexes && d.hexes.has(k)); }

  setBreach(c, r, on) {
    const k = key(c, r), d = this.breachAt(k);
    if (!!d === on) return false;
    if (on) this.decals.push({ type: "blast", hexes: new Set([k]), rest: {} });
    else { d.hexes.delete(k); if (!d.hexes.size) this.decals = this.decals.filter((x) => x !== d); }
    return true;
  }

  addTracks(from, to) {
    if (from[0] === to[0] && from[1] === to[1]) return false;
    this.decals.push({ type: "tracks", from, to, rest: {} });
    return true;
  }

  eraseTracks(c, r) {
    const n = this.decals.length;
    this.decals = this.decals.filter((d) => !(d.type === "tracks" && ((d.from[0] === c && d.from[1] === r) || (d.to[0] === c && d.to[1] === r))));
    return this.decals.length !== n;
  }

  eraseAll(c, r) {
    let changed = this.eraseZone(c, r);
    changed = this.setSolid(c, r, false) || changed;
    changed = this.setHexDecal("hazard_border", c, r, false) || changed;
    changed = this.setHexDecal("hazard_ring", c, r, false) || changed;
    changed = this.setHexDecal("floor_hatch", c, r, false) || changed;
    changed = this.setBreach(c, r, false) || changed;
    changed = this.eraseTracks(c, r) || changed;
    return changed;
  }

  // what's on a hex, for the hover readout
  describe(c, r) {
    const k = key(c, r), out = [];
    const z = this.zoneAt(k);
    if (z) out.push(z.id);
    const t = this.terrain.get(k);
    if (t) out.push(t === "obstruction" ? "solid structure" : t);
    if (this.hexDecal("hazard_border")?.hexes.has(k)) out.push("lift");
    if (this.hexDecal("hazard_ring")?.hexes.has(k)) out.push("hazard ring");
    if (this.hexDecal("floor_hatch")?.hexes.has(k)) out.push("floor hatch");
    if (this.breachAt(k)) out.push("breach");
    return out;
  }

  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    const ok = (k) => { const [c, r] = parse(k); return this.inside(c, r); };
    for (const z of this.zones) z.hexes = new Set([...z.hexes].filter(ok));
    this.zones = this.zones.filter((z) => z.hexes.size || !zoneKind(z.id));
    for (const k of [...this.terrain.keys()]) if (!ok(k)) this.terrain.delete(k);
    for (const d of this.decals) if (d.hexes) d.hexes = new Set([...d.hexes].filter(ok));
    this.decals = this.decals.filter((d) => (d.hexes ? d.hexes.size : this.inside(...d.from) && this.inside(...d.to)));
  }
}

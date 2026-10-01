// The last drawn base map, kept in this browser (IndexedDB), so coming back to the Map Maker with nothing
// changed shows it at once instead of drawing it again. One picture is kept, keyed by the map, its style
// and settings, and a hash of the drawing code: every module the render worker loads, found by following
// its imports, so a changed style never shows an old picture. Any failure (private window, storage
// blocked, quota) just means no cache: the map is drawn as usual.

const DB = "lancertools", STORE = "renders", SLOT = "last";

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
  return dbPromise;
}

async function request(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const q = fn(d.transaction(STORE, mode).objectStore(STORE));
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}

// the drawing code's own sources, from the worker down through its static imports
let codePromise = null;
function codeText() {
  codePromise ??= (async () => {
    const seen = new Map(), todo = [new URL("../worker.js", import.meta.url).href];
    while (todo.length) {
      const url = todo.pop();
      if (seen.has(url)) continue;
      const text = await (await fetch(url)).text();
      seen.set(url, text);
      for (const m of text.matchAll(/(?:import|export)\s[^;]*?from\s*["'](\.{1,2}\/[^"']+)["']/g)) todo.push(new URL(m[1], url).href);
    }
    return [...seen.keys()].sort().map((u) => u + "\n" + seen.get(u)).join("\n");
  })();
  return codePromise;
}

async function sha1(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function keyFor(map, style, opts) {
  return sha1((await codeText()) + "\n" + JSON.stringify([map, style, opts]));
}

// the kept picture for this key, as an ImageBitmap with its size, or null
export async function get(key) {
  try {
    const rec = await request("readonly", (s) => s.get(SLOT));
    if (!rec || rec.key !== key) return null;
    return { bitmap: await createImageBitmap(rec.blob), w: rec.w, h: rec.h };
  } catch { return null; }
}

// keep a freshly drawn picture (RGBA pixels), as a PNG, replacing the last one
export async function put(key, pixels, w, h) {
  try {
    const cv = new OffscreenCanvas(w, h);
    cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
    const blob = await cv.convertToBlob({ type: "image/png" });
    await request("readwrite", (s) => s.put({ key, w, h, blob }, SLOT));
  } catch { /* no cache this time */ }
}

// The page side of the render worker: promise-based calls.

export class Renderer {
  constructor() {
    this.worker = new Worker(new URL("../worker.js", import.meta.url), { type: "module" });
    this.pending = new Map();
    this.next = 1;
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error)); else p.resolve(data);
    };
  }

  call(msg) {
    const id = this.next++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ ...msg, id }); });
  }

  map(map, style, opts) { return this.call({ type: "map", map, style, opts }); }
  mapPng() { return this.call({ type: "mapPng" }); }
  token(name) { return this.call({ type: "token", name }); }
}

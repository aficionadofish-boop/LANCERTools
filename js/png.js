// PNG encoding straight from the RGBA bytes. A canvas stores pixels premultiplied, so drawing an
// image into one and exporting it would change the colour of half-transparent pixels (token
// shadows); this writes the bytes as they are. Deflate comes from the browser (CompressionStream).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// img: {mode: "RGBA" | "L", w, h, data} -> PNG bytes (RGBA or greyscale, 8 bit, no filtering)
export async function encodePNG(img) {
  const ch = img.mode === "RGBA" ? 4 : 1, row = img.w * ch;
  const raw = new Uint8Array((row + 1) * img.h);
  for (let y = 0; y < img.h; y++) raw.set(img.data.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, img.w); v.setUint32(4, img.h);
  ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function pngBlob(img) { return new Blob([await encodePNG(img)], { type: "image/png" }); }

export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

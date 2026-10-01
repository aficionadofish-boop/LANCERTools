// The render worker: base maps and tokens are drawn here, so the page stays responsive.
// Messages in:  {id, type: "map", map, style, opts}      -> {id, w, h, pixels (RGBA buffer), ms}
//               {id, type: "mapPng"}                      -> {id, png} (the last map, as PNG bytes)
//               {id, type: "token", name}                 -> {id, file, w, h, png}
// On failure:   {id, error}

import { installText } from "./maps/text.js?v=0f282507bd";
import { renderBase } from "./maps/render.js?v=0f282507bd";
import { renderToken } from "./tokens/index.js?v=0f282507bd";
import { encodePNG } from "./png.js?v=0f282507bd";

const ready = installText(new URL("../fonts/", import.meta.url).href);
let lastMap = null;

self.onmessage = async ({ data: msg }) => {
  const { id } = msg;
  try {
    await ready;
    if (msg.type === "map") {
      const t0 = performance.now();
      lastMap = renderBase(msg.map, msg.style, msg.opts);
      const pixels = lastMap.data.slice().buffer;
      self.postMessage({ id, w: lastMap.w, h: lastMap.h, pixels, ms: performance.now() - t0 }, [pixels]);
    } else if (msg.type === "mapPng") {
      const png = await encodePNG(lastMap);
      self.postMessage({ id, png }, [png.buffer]);
    } else if (msg.type === "token") {
      const { img, w, h, file } = renderToken(msg.name);
      const png = await encodePNG(img);
      self.postMessage({ id, file, w, h, png }, [png.buffer]);
    } else throw new Error("unknown message: " + msg.type);
  } catch (e) {
    self.postMessage({ id, error: String((e && e.stack) || e) });
  }
};

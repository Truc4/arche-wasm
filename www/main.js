// Boot the app. The page IS the wasm program: one full-screen canvas, no chrome. We fetch the gfx module
// and drive it with GfxRunner (gfx.js) — a wasi reactor whose arche_run/arche_frame render every pixel
// inside wasm and present them to the GPU. The compute samples live on the test-only demos.html.
"use strict";

(async function () {
  const screen = document.getElementById("screen");
  const APP = "square"; // the arche gfx program: src/<APP>.arche → www/<APP>.wasm
  try {
    const resp = await fetch("./" + APP + ".wasm");
    if (!resp.ok) throw new Error("could not fetch " + APP + ".wasm (" + resp.status + ")");
    const bytes = await resp.arrayBuffer();
    const gfx = new GfxRunner(screen);
    await gfx.start(bytes);
  } catch (e) {
    screen.dataset.status = "error";
    console.error(e);
  }
})();

// Picker for the test-only demo gallery (demos.html). The public site is index.html + main.js (the
// full-screen app); this page keeps the compute demos + the gfx demo selectable so the committed e2e
// harness (tests/e2e/demos.spec.ts) can drive each one and assert its output. Two paths, by data-kind:
//   • compute (default) — instantiate with the WASI shim, run `_start`, render captured stdout into #out.
//   • gfx               — a reactor module: drive it with GfxRunner (gfx.js), rendering into #screen.
// The element's data-status (idle → running → done|live|error) is what Playwright awaits, so the
// assertions are deterministic (no arbitrary timeouts).
"use strict";

const out = document.getElementById("out");
const screen = document.getElementById("screen");
const sel = document.getElementById("demo");
const btn = document.getElementById("run");

let gfx = null; // the live GfxRunner, if a gfx demo is running

async function runCompute(name) {
  out.style.display = "";
  out.textContent = "";
  out.dataset.status = "running";
  try {
    const resp = await fetch("./" + name + ".wasm");
    if (!resp.ok) throw new Error("could not fetch " + name + ".wasm (" + resp.status + ")");
    const bytes = await resp.arrayBuffer(); // arrayBuffer path → no application/wasm MIME needed
    const shim = new WasiShim([name]);
    const { instance } = await WebAssembly.instantiate(bytes, shim.imports);
    shim.start(instance);
    out.textContent = shim.stdout + (shim.stderr ? "\n[stderr] " + shim.stderr : "");
    out.dataset.status = "done";
  } catch (e) {
    out.textContent = "error: " + (e && e.message ? e.message : e);
    out.dataset.status = "error";
  }
}

async function runGfx(name) {
  screen.style.display = "";
  screen.dataset.status = "running";
  try {
    const resp = await fetch("./" + name + ".wasm");
    if (!resp.ok) throw new Error("could not fetch " + name + ".wasm (" + resp.status + ")");
    const bytes = await resp.arrayBuffer();
    gfx = new GfxRunner(screen);
    await gfx.start(bytes);
  } catch (e) {
    screen.dataset.status = "error";
    console.error(e);
  }
}

function run() {
  if (gfx) { gfx.stop(); gfx = null; }
  const opt = sel.options[sel.selectedIndex];
  if (opt.dataset.kind === "gfx") {
    out.style.display = "none";
    runGfx(sel.value);
  } else {
    screen.style.display = "none";
    runCompute(sel.value);
  }
}

btn.addEventListener("click", run);

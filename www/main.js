// Fetch the selected demo's `.wasm`, instantiate it with the vendored WASI shim, run it, and render
// its captured stdout into the page. `#out`'s data-status (idle → running → done|error) is what the
// Playwright e2e awaits, so the assertion is deterministic (no arbitrary timeouts).
"use strict";

const out = document.getElementById("out");
const sel = document.getElementById("demo");
const btn = document.getElementById("run");

async function run(name) {
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

btn.addEventListener("click", () => run(sel.value));

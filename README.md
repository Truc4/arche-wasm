# arche-wasm

arche compute programs compiled to **WebAssembly** (`wasm32-wasi`) and run in the browser, with
Playwright end-to-end tests. The browser counterpart to `arche-rpg` / `arche-web-server`.

Each `src/*.arche` is built with `arche build --arch=wasm32` into a `.wasm` module and executed inside
the page by a small vendored WASI shim (`www/wasi.js`) — the program's `fmt` output is captured from
its `fd_write` (stdout) and shown on the page. No server round-trip, no framework, no bundler.

## Layout

- `src/` — the arche demos:
  - `reduce.arche` — a data-parallel `reduce(+, …)` over a pooled column → `sum=20.0`.
  - `pipeline.arche` — a columnar ETL: array-literal scatter → whole-column `revenue = price*qty` →
    `reduce` → `revenue_total=116.0`.
  - `primes.arche` — a `system` with nested `for`/`if` counting primes below 100 → `primes<100: 25`.
- `www/` — `index.html` (the page), `wasi.js` (the vendored WASI preview1 shim), `main.js` (fetch →
  instantiate → run → render), and the built `*.wasm`.
- `tests/e2e/` — Playwright specs that build each demo, load the page, run it, and assert the printed text.

## Requirements

- The **arche compiler** on `PATH` — or `make ARCHE=/path/to/arche` (e.g. `../arche/build/arche`).
- A **WASI sysroot** for the wasm link, one of:
  - `ARCHE_WASI_SDK` / `WASI_SDK_PATH` pointing at a [wasi-sdk](https://github.com/WebAssembly/wasi-sdk), or
  - the system `/usr/share/wasi-sysroot` (Arch: `sudo pacman -S wasi-libc wasi-compiler-rt`).
- `node` + `npm` (the Playwright runner) and `python3` (the static file server).

## Build & run in a browser

```sh
make wasm                              # src/*.arche → www/*.wasm
python3 -m http.server 8000 -d www     # open http://localhost:8000
```

## End-to-end tests

```sh
make e2e     # builds the wasm, installs Playwright + Chromium (first run only), runs the specs
```

Each spec `skip`s cleanly when its `.wasm` is absent (no WASI sysroot), so the suite is safe on a
machine without the wasm toolchain — matching the arche repo's gating convention.

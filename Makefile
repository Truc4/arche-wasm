# arche-wasm — arche compute programs compiled to WebAssembly (wasm32-wasi) and run in the browser.
#
# Uses the `arche` compiler from PATH; override with `make ARCHE=/path/to/arche` (e.g.
# `make ARCHE=../arche/build/arche`). The `--arch=wasm32` link needs a WASI sysroot at build time:
# `ARCHE_WASI_SDK`/`WASI_SDK_PATH` pointing at a wasi-sdk, or the system `/usr/share/wasi-sysroot`
# (Arch's `wasi-libc` package). See README.
ARCHE ?= arche
SRC  := $(wildcard src/*.arche)
WASM := $(patsubst src/%.arche,www/%.wasm,$(SRC))

.PHONY: all wasm serve dev e2e clean

all: wasm

# Port for the static file server (override: `make serve PORT=9000`).
PORT ?= 8000
# The demo `make dev` runs natively (override: `make dev APP=square`).
APP ?= scene
# gfx backend for the native `dev` run: x11 (window) or headless (PPM dump). See arche.toml.
GFX ?= x11

# Build every src/<name>.arche → www/<name>.wasm.
wasm: $(WASM)

www/%.wasm: src/%.arche
	$(ARCHE) build --arch=wasm32 -o $@ $<

# Build the wasm, then serve www/ statically — open http://localhost:$(PORT).
serve: wasm
	python3 -m http.server $(PORT) -d www

# Dev loop: run src/$(APP).arche NATIVELY via `arche run` — no wasm build, no browser. `arche run` is a
# hot-reload host: edit the source and it recompiles + reloads live. Uses a windowed gfx backend
# (GFX=x11) instead of the wasm shim. Override the demo/backend: `make dev APP=square GFX=headless`.
dev:
	ARCHE_SELECT=gfx=$(GFX),text=terminal $(ARCHE) run src/$(APP).arche

# One-time: install the Playwright test runner + a headless Chromium.
node_modules: package.json
	npm install
	npx playwright install chromium

# Build the wasm, then drive a headless browser that runs each demo and asserts its printed output.
e2e: wasm node_modules
	npx playwright test

clean:
	rm -f www/*.wasm
	rm -rf test-results playwright-report

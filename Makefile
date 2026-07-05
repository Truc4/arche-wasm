# arche-wasm — arche compute programs compiled to WebAssembly (wasm32-wasi) and run in the browser.
#
# Uses the `arche` compiler from PATH; override with `make ARCHE=/path/to/arche` (e.g.
# `make ARCHE=../arche/build/arche`). The `--arch=wasm32` link needs a WASI sysroot at build time:
# `ARCHE_WASI_SDK`/`WASI_SDK_PATH` pointing at a wasi-sdk, or the system `/usr/share/wasi-sysroot`
# (Arch's `wasi-libc` package). See README.
ARCHE ?= arche
SRC  := $(wildcard src/*.arche)
WASM := $(patsubst src/%.arche,www/%.wasm,$(SRC))

.PHONY: all wasm e2e clean

all: wasm

# Build every src/<name>.arche → www/<name>.wasm.
wasm: $(WASM)

www/%.wasm: src/%.arche
	$(ARCHE) build --arch=wasm32 -o $@ $<

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

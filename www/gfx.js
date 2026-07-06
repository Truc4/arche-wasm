// Browser host for an arche gfx (Tier 1) module — the reactor path. A `--arch=wasm32` build whose #run
// schedule has a top-level `forever` is a wasi REACTOR: no `_start`, instead it exports `arche_run` (one
// -shot init) + `arche_frame` (one tick) and imports the six `gfx_be_*` symbols the native backends
// provide in C. Here JS provides them: the arche program renders its world into its own [W*H]int software
// framebuffer, and `gfx_be_present` blits that to a <canvas> via putImageData — arche owns every pixel,
// the canvas is a dumb surface. We drive it: _initialize() → arche_run() once → arche_frame() per
// requestAnimationFrame. Reuses WasiShim (wasi.js) for the WASI imports (clock/rng/etc.). No dependencies.
(function (global) {
  class GfxRunner {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.wasi = new WasiShim(["gfx"]); // WASI imports + memory plumbing
      this.w = 0;
      this.h = 0;
      this.handle = 1n;     // opaque window handle: arche `window` lowers to i64, so this crosses as BigInt
                            // (the arche side only stores/passes it back to gfx_be_w/h/present/poll)
      this.img = null;      // reused ImageData sized to the framebuffer
      this.frames = 0;
      this.memory = null;
      this._raf = 0;
      this._stopped = false;
    }

    // 0xRRGGBB int framebuffer (px) → RGBA ImageData → canvas. Recompute the Int32 view each call: wasm
    // memory can grow and detach its ArrayBuffer.
    _blit(pxPtr, w, h) {
      const n = w * h;
      const px = new Int32Array(this.memory.buffer, pxPtr, n);
      const d = this.img.data;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const p = px[i];
        d[j] = (p >> 16) & 0xff;
        d[j + 1] = (p >> 8) & 0xff;
        d[j + 2] = p & 0xff;
        d[j + 3] = 0xff;
      }
      this.ctx.putImageData(this.img, 0, 0);
    }

    get gfxImports() {
      const self = this;
      return {
        gfx_be_open(w, h, _titlePtr) {
          self.w = w;
          self.h = h;
          self.canvas.width = w;
          self.canvas.height = h;
          self.img = self.ctx.createImageData(w, h);
          return self.handle;
        },
        gfx_be_w() { return self.w; },
        gfx_be_h() { return self.h; },
        gfx_be_present(_win, pxPtr, w, h) {
          self._blit(pxPtr, w, h);
          self.frames++;
          if (self.frames === 1) self.canvas.dataset.status = "live"; // first painted frame (e2e signal)
        },
        gfx_be_poll() { return 1; },   // the tab is always "open"; native inserts Closed here to exit
        gfx_be_close() { },
      };
    }

    async start(bytes) {
      this.canvas.dataset.status = "running";
      const importObj = Object.assign({}, this.wasi.imports, { env: this.gfxImports });
      const { instance } = await WebAssembly.instantiate(bytes, importObj);
      this.instance = instance;
      this.memory = instance.exports.memory;
      this.wasi.memory = instance.exports.memory; // WasiShim reads memory lazily per call
      if (instance.exports._initialize) instance.exports._initialize(); // reactor: run ctors / wasi init
      instance.exports.arche_run();  // one-shot: alloc-init + open window + seed
      const tick = () => {
        if (this._stopped) return;
        instance.exports.arche_frame(); // one frame: step + clear + draw + present
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }

    stop() {
      this._stopped = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }

  global.GfxRunner = GfxRunner;
  if (typeof module !== "undefined" && module.exports) module.exports = { GfxRunner }; // node test harness
})(typeof window !== "undefined" ? window : globalThis);

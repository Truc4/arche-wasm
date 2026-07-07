// Browser host for an arche gfx (Tier 1) module — the reactor path. A `--arch=wasm32` build whose #run
// schedule has a top-level `forever` is a wasi REACTOR: no `_start`, instead it exports `arche_run` (one
// -shot init) + `arche_frame` (one tick) and imports the six `gfx_be_*` symbols the native backends
// provide in C. Here JS provides them: the arche program renders its world into its own [W*H]int software
// framebuffer, and `gfx_be_present` hands that buffer to the GPU — arche owns every pixel, the host owns
// zero. We drive it: _initialize() → arche_run() once → arche_frame() per requestAnimationFrame. Reuses
// WasiShim (wasi.js) for the WASI imports (clock/rng/etc.). No dependencies.
//
// PRESENT PATH — GPU-composited, zero per-pixel JS. The framebuffer is uploaded straight from wasm linear
// memory as a texture and drawn as one fullscreen quad; a two-line fragment shader does the colour swizzle
// on the GPU. No CPU pixel loop, no putImageData. This is the standard way to present a software
// framebuffer (emulators do the same) and the on-ramp to a GPU-rasterizing backend later.
(function (global) {
  // Vertex shader: a fullscreen triangle-strip quad in clip space. v_uv maps the quad to [0,1]², with the
  // V axis flipped so framebuffer row 0 lands at the TOP of the canvas (arche's buffer is top-row-first).
  const VS = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = vec2((a_pos.x + 1.0) * 0.5, (1.0 - a_pos.y) * 0.5);
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }`;

  // Fragment shader: the framebuffer int is 0x00RRGGBB; in little-endian wasm memory that is the byte
  // sequence [B, G, R, 0], so the RGBA texel arrives as (B, G, R, 0). Reorder to real RGB and force opaque
  // alpha. Getting this line wrong shows up immediately as swapped red/blue — the e2e bg-colour check guards it.
  const FS = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    void main() {
      vec4 t = texture2D(u_tex, v_uv);
      gl_FragColor = vec4(t.b, t.g, t.r, 1.0);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error("gfx shader compile failed: " + gl.getShaderInfoLog(s));
    }
    return s;
  }

  // Largest render width we'll ask the wasm to fill. The arche program's framebuffer is a fixed-size array
  // sized to MAXW×(render height); we render only the live w×h sub-region into it, so w must never exceed
  // this. MUST match `MAXW` in src/scene.arche. 4096 covers wider-than-32:9 at a 1080 render height.
  const MAXW = 4096;

  class GfxRunner {
    constructor(canvas) {
      this.canvas = canvas;
      // preserveDrawingBuffer keeps the last frame readable via gl.readPixels (the e2e reads it); alpha:false
      // + no depth/antialias is the cheapest surface for a 2D blit.
      this.gl = canvas.getContext("webgl", {
        preserveDrawingBuffer: true, alpha: false, antialias: false, depth: false, stencil: false,
      });
      if (!this.gl) throw new Error("WebGL is not available");
      this.wasi = new WasiShim(["gfx"]); // WASI imports + memory plumbing
      this.w = 0;           // current render width — tracks the window aspect (gfx_be_w reports it)
      this.h = 0;           // render height — fixed, from the wasm's requested H (gfx_be_h reports it)
      this.renderH = 0;
      this.texW = 0;        // size the framebuffer texture is currently allocated at (realloc'd on resize)
      this.texH = 0;
      this.handle = 1n;     // opaque window handle: arche `window` lowers to i64, so this crosses as BigInt
                            // (the arche side only stores/passes it back to gfx_be_w/h/present/poll)
      this.tex = null;      // the framebuffer texture, (re)allocated when the render size changes
      this.frames = 0;
      this.memory = null;
      this._raf = 0;
      this._stopped = false;
      this.keys = { left: false, right: false }; // ←/→ (or A/D) held state, read by gfx_be_axis_x
      this._kd = null;
      this._ku = null;
      this._onResize = null;
    }

    // Size the canvas backing store to the window: fixed render height, width = height × window aspect
    // (capped at MAXW). The CSS sizes the element to 100vw×100vh; because the backing aspect equals the
    // window aspect, the image fills exactly — no bars, no distortion. Called on open and on every resize;
    // the wasm reads the new width via gfx_be_w next frame and renders a wider/narrower slice of the world.
    _sizeToWindow() {
      const ch = Math.max(1, window.innerHeight);
      let w = Math.round(this.renderH * window.innerWidth / ch);
      if (w < 1) w = 1;
      if (w > MAXW) w = MAXW;
      if (w === this.w && this.canvas.height === this.renderH) return;
      this.w = w;
      this.h = this.renderH;
      this.canvas.width = w;          // resizing the backing store; the texture is realloc'd in _present
      this.canvas.height = this.renderH;
    }

    // Track the horizontal movement keys. Called from start(); torn down in stop(). preventDefault keeps the
    // arrow keys from scrolling the page.
    _bindKeys() {
      const set = (down) => (e) => {
        const k = e.key;
        if (k === "ArrowLeft" || k === "a" || k === "A") { this.keys.left = down; e.preventDefault(); }
        else if (k === "ArrowRight" || k === "d" || k === "D") { this.keys.right = down; e.preventDefault(); }
      };
      this._kd = set(true);
      this._ku = set(false);
      window.addEventListener("keydown", this._kd);
      window.addEventListener("keyup", this._ku);
    }

    // Build the shader program, the fullscreen-quad vertex buffer, and the framebuffer texture. Called once
    // per open (the arche side opens exactly one window).
    _initGL(w, h) {
      const gl = this.gl;
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error("gfx program link failed: " + gl.getProgramInfoLog(prog));
      }
      gl.useProgram(prog);

      // Fullscreen quad as a triangle strip: (-1,-1) (1,-1) (-1,1) (1,1).
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);

      // The framebuffer texture. NEAREST + CLAMP_TO_EDGE are valid for the non-power-of-two, window-derived
      // sizes we use and keep pixels crisp when the canvas is scaled up. Storage is (re)allocated in _present
      // whenever the render size changes; the initial allocation here just gives it a valid size.
      this.tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.viewport(0, 0, w, h);
    }

    // Upload the live w×h region of the framebuffer straight from wasm memory and draw it. Recompute the
    // byte view each call: wasm memory can grow and detach its ArrayBuffer. When the render size changed
    // (window resize), reallocate the texture + viewport to match; otherwise refill in place. No per-pixel
    // JS — the GPU does the swizzle.
    _present(pxPtr, w, h) {
      const gl = this.gl;
      const bytes = new Uint8Array(this.memory.buffer, pxPtr, w * h * 4);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      if (w !== this.texW || h !== this.texH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        gl.viewport(0, 0, w, h);
        this.texW = w;
        this.texH = h;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    get gfxImports() {
      const self = this;
      return {
        // The `log_be_emit` seam: arche's panic policies + the `log` device's wasm backend emit here
        // (level, ptr, len into linear memory). This is the browser log backend — the host owns the sink.
        // level: 0 debug, 1 info, 2 warn, 3 error. Without this import the module fails to instantiate
        // (LinkError), which reads as a black screen.
        log_be_emit(level, ptr, len) {
          const s = self.wasi._dec.decode(new Uint8Array(self.memory.buffer, ptr, len));
          self.wasi.stderr += s;
          (level >= 3 ? console.error : level >= 2 ? console.warn : level >= 1 ? console.info : console.debug)(s);
        },
        gfx_be_open(_w, h, _titlePtr) {
          // `h` is the fixed render height (the wasm's requested H). The width is derived from the window
          // aspect, not the wasm's requested width, so the render fills the window with no bars.
          self.renderH = h;
          self._sizeToWindow();
          self._initGL(self.w, self.h);
          if (!self._onResize) {
            self._onResize = () => self._sizeToWindow();
            window.addEventListener("resize", self._onResize);
          }
          return self.handle;
        },
        gfx_be_w() { return self.w; },
        gfx_be_h() { return self.h; },
        gfx_be_present(_win, pxPtr, w, h) {
          self._present(pxPtr, w, h);
          self.frames++;
          if (self.frames === 1) self.canvas.dataset.status = "live"; // first painted frame (e2e signal)
        },
        gfx_be_poll() { return 1; },   // the tab is always "open"; native inserts Closed here to exit
        gfx_be_axis_x() { return (self.keys.right ? 1 : 0) - (self.keys.left ? 1 : 0); },
        gfx_be_close() { },
      };
    }

    async start(bytes) {
      this.canvas.dataset.status = "running";
      this._bindKeys();
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
      if (this._kd) window.removeEventListener("keydown", this._kd);
      if (this._ku) window.removeEventListener("keyup", this._ku);
      if (this._onResize) window.removeEventListener("resize", this._onResize);
      this._kd = this._ku = this._onResize = null;
    }
  }

  global.GfxRunner = GfxRunner;
  if (typeof module !== "undefined" && module.exports) module.exports = { GfxRunner }; // node test harness
})(typeof window !== "undefined" ? window : globalThis);

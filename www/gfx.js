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
      this.w = 0;
      this.h = 0;
      this.handle = 1n;     // opaque window handle: arche `window` lowers to i64, so this crosses as BigInt
                            // (the arche side only stores/passes it back to gfx_be_w/h/present/poll)
      this.tex = null;      // the framebuffer texture, (re)allocated to W×H on open
      this.frames = 0;
      this.memory = null;
      this._raf = 0;
      this._stopped = false;
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

      // W×H texture. NEAREST + CLAMP_TO_EDGE are valid for non-power-of-two sizes (480×360) and keep pixels
      // crisp when the canvas is scaled up. Allocate storage now; texSubImage2D refills it each frame.
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

    // Upload the [W*H]int framebuffer straight from wasm memory and draw it. Recompute the byte view each
    // call: wasm memory can grow and detach its ArrayBuffer. No per-pixel JS — the GPU does the swizzle.
    _present(pxPtr, w, h) {
      const gl = this.gl;
      const bytes = new Uint8Array(this.memory.buffer, pxPtr, w * h * 4);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    get gfxImports() {
      const self = this;
      return {
        gfx_be_open(w, h, _titlePtr) {
          self.w = w;
          self.h = h;
          self.canvas.width = w;
          self.canvas.height = h;
          self._initGL(w, h);
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

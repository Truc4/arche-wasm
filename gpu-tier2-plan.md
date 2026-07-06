# Tier 2 GPU — slice 1: arche-driven instanced-quad rendering on the GPU (WebGL2, browser)

## Context

Tier 1 (shipped) has arche render a CPU software framebuffer and blit it to a browser `<canvas>` via a wasm
reactor. Tier 2 is GPU rendering. The user directed "implement the gpu features on a new branch." Per the
standing "user owns all git," these changes are made **uncommitted in the working tree**; the user runs
`git checkout -b gpu-tier2` to carry them onto the branch (Claude does not run git).

**Design fork (decided autonomously, logged in `../arche/docs/design/wasm-gfx-tier1.md`'s companion):**
`../arche/docs/wip/gpu-graphics-pipeline.md` argues the arche-native long-term direction is *rendering as a
join+aggregate gather query* over pools — an explicit multi-week GPU-backend generalization (multi-pool
kernels, foreign-buffer indexing, bounded reductions, func-monoids) with "no cheap version," not a session
slice. `../arche/docs/design/rendering-tiers.md` Tier 2 is the conventional instanced-quads pipeline. Agent
exploration confirms native Vulkan reuses more existing code but is a large, fiddly, hard-to-verify
graphics-pipeline build. For a first slice that is **verifiable and working this session** and serves the
web-portfolio goal, we take the **web WebGL2 instanced-quad path**: reuses the Tier 1 reactor/canvas/rAF
wholesale, needs zero arche-compiler risk (the GPU work is a host JS renderer + a demo that hands it instance
columns), and verifies in headless Chromium (WebGL2 via SwiftShader). Native Vulkan parity and the
gather-query direction are documented follow-ups.

**Architecture proven by this slice:** arche owns a flat instance buffer (a `[1]` singleton pool with
`[N]float`/`[N]int` columns = x, y, size, color), a `map` runs the per-frame physics over it, and a
`#foreign gl_draw(...)` hands those columns (as `[]`-slices, exactly like Tier 1's `gfx_be_present` hands the
framebuffer) to the browser host, which uploads them as **per-instance vertex attributes** and draws all N
quads in **one instanced GPU draw call** (`drawArraysInstanced`). The pool columns *are* the instance buffer
— the DOD payoff `rendering-tiers.md` describes, now real on the GPU. (Columns lower to contiguous `[N x T]`
SoA arrays that slice to a `{ptr,len}` FFI view.)

## Changes (all in `~/Code/arche-wasm` — zero arche-compiler change for this slice)

1. **`src/quadsgl.arche`** — self-contained wasm-reactor, no gfx device dependency (plain int handle):
   - `Scene :: arche { xs::[N]float, ys::[N]float, vx::[N]float, vy::[N]float, sz::[N]float, col::[N]int }`,
     a `[1]Scene(1)` singleton (the instance buffers) + `[1]Win ?abort` (int handle).
   - `#foreign { gl_open :: proc(w:int,h:int)(win:int);  gl_draw :: proc(xs,ys,ss:[]float, cols:[]int,
     n:int)(xs,ys,ss:[]float, cols:[]int); }` — `gl_draw` slices are in-out (the FFI-read-only-slice idiom).
   - `boot` (gl_open → Win), `seed` (scatter into the flat arrays), `step` (branch-free `select` bounce),
     `draw` (`gl_draw(...)`), `#run seq({ boot, seed, forever(seq({ step, draw })) })` (reactor auto-splits).
2. **`www/gl.js`** — the WebGL2 host (`GlRunner`): reuse `WasiShim`; provide `env.gl_open` (webgl2 context,
   instanced-quad program: unit quad VBO + per-instance `a_center/a_size/a_color` via `vertexAttribDivisor`)
   and `env.gl_draw` (read the 4 column slices from wasm memory, `bufferData` the instance VBO, `clear`,
   `drawArraysInstanced(TRIANGLE_STRIP, 0, 4, n)`; `#screen[data-status="live"]` on first draw). Drive
   `_initialize` → `arche_run` → rAF `arche_frame`.
3. **`www/index.html` + `www/main.js`** — a `quadsgl` option (`data-kind="gl"`) routed to `GlRunner`.
4. **`tests/e2e/gpu.spec.ts`** — assert a real `webgl2` context rendered instanced quads and animates.
5. **`playwright.config.ts`** — chromium args for headless WebGL2 (angle/swiftshader).

## Verification

1. wasm build → reactor module (exports arche_run/arche_frame, imports env.gl_open/gl_draw); node-load with
   stubs to confirm no trap + sane `gl_draw` args.
2. `make e2e ARCHE=../arche/build/arche` — gpu.spec green + the existing 4 stay green.
3. Screenshot via a direct Chromium script.

## Follow-ups (documented, not in this slice)

- Promote instanced-draw into the `gfx` device (a `quad` pool + `gfx.draw` + `gfx_be_submit` in all variants).
- Generalize the `@gpu` dispatch's single `elem_size` to per-column strides/types (mixed f32/u32 attributes).
- **Native Vulkan** parity: reuse `runtime/gpu_runtime.c` + a graphics pipeline (offscreen VkImage → instanced
  `vkCmdDraw` → blit into the framebuffer pool), per `../arche/docs/wip/gpu-graphics-pipeline.md`.
- **Glyph atlas → text as physics bodies** (the end goal): uv columns + a glyph atlas per-instance.
- The principled **gather-query** GPU renderer (the arche-native direction).

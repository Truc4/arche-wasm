// Browser DOM backend for an arche `text` device (extras/text/wasm). The arche program owns no glyph
// pixels — instead it issues `text.draw(x, y, "…", size, color)` calls that lower to the wasm imports
// `text_be_draw` / `text_be_clear`, which THIS module fulfils by creating absolutely-positioned <span>s in
// a full-viewport #text-layer <div> above the gfx <canvas>. So the browser's own font engine renders the
// text (crisp, selectable, inspectable) while gfx keeps owning the framebuffer — the two composite: canvas
// pixels below, DOM text above.
//
// GfxRunner (gfx.js) news one of these up per run and merges `imports` into the SAME wasm import object as
// the gfx_be_* seams (one instance ⇒ one import object). It also feeds us `memory` (to read the UTF-8 string
// out of linear memory) and `renderH` (the fixed gfx render height) so we can map render pixels → CSS px.
//
// COORDINATES. arche gives (x, y, size) in gfx RENDER pixels: 0..renderW × 0..renderH, renderH fixed (1080).
// The canvas is CSS-sized 100vw×100vh with backing aspect = window aspect, so the on-screen scale is uniform
// `scale = innerHeight / renderH` on both axes. We keep each run's render-space record and re-place them on
// resize, so labels track the canvas exactly (mirrors gfx.js's _sizeToWindow on the text side). No deps.
(function (global) {
  class TextLayer {
    constructor() {
      this.layer = null;         // the #text-layer overlay div (created lazily on first draw)
      this.spans = [];           // POOLED { x, y, size, text, el } in RENDER space; reused across frames
      this._cursor = 0;          // per-frame reuse cursor: text_be_draw fills spans[0], [1], … in order
      this.memory = null;        // wasm linear memory (set by GfxRunner before arche_run)
      this.renderH = 0;          // gfx render height (set by GfxRunner in gfx_be_open)
      this._dec = new TextDecoder();
      this._onResize = null;
    }

    // Create the overlay once. position:fixed + inset:0 lays it exactly over the full-viewport canvas;
    // pointer-events:none so it never intercepts the ←/→ keys or clicks; overflow:hidden clips off-screen
    // runs. z-index keeps it above the canvas.
    _ensureLayer() {
      if (this.layer) return;
      const d = document.getElementById("text-layer") || document.createElement("div");
      d.id = "text-layer";
      // Only what's needed to place text: a viewport-anchored positioning context. `inset:0` gives it the
      // viewport's box so the absolutely-positioned spans have room to lay a line out (a zero-size container
      // would wrap every glyph). Everything else (font, clipping, pointer-events, stacking) is style — add
      // it later on #text-layer if wanted; DOM order already paints this above the canvas.
      d.style.cssText = "position:fixed;inset:0;";
      if (!d.parentNode) document.body.appendChild(d);
      this.layer = d;
      if (!this._onResize) {
        this._onResize = () => this.reflow();
        window.addEventListener("resize", this._onResize);
      }
    }

    // Render pixels → on-screen CSS px: uniform scale = displayed height / render height. renderH is set
    // before any draw runs (GfxRunner sets it in gfx_be_open, which precedes the arche_run prefix HUD).
    _scale() {
      return this.renderH ? window.innerHeight / this.renderH : 1;
    }

    // Position a recorded run at the current scale.
    _place(rec) {
      const s = this._scale();
      rec.el.style.left = rec.x * s + "px";
      rec.el.style.top = rec.y * s + "px";
      rec.el.style.fontSize = rec.size * s + "px";
    }

    // Re-place every run — bound to window resize so the HUD tracks the canvas.
    reflow() {
      for (const rec of this.spans) this._place(rec);
    }

    // The wasm imports the arche text/wasm backend expects. Merged into env by GfxRunner.
    get imports() {
      const self = this;
      return {
        // text_be_draw(x, y, s, n, size, color): a []char lowers to (ptr, len) — here (sPtr, n). REUSE the
        // pooled span at the current cursor (create it once), update it IN PLACE, and advance. Reusing the
        // node — and rewriting textContent ONLY when the string actually changed — lets a text selection
        // survive the per-frame redraw as world signs scroll: replacing the text node (or the element) drops
        // the selection, but moving it via left/top does not. Decode from wasm memory each call (it can grow
        // and detach its ArrayBuffer, same caveat as gfx.js _present). color is 0xRRGGBB.
        text_be_draw(x, y, sPtr, n, size, color) {
          self._ensureLayer();
          const str = self._dec.decode(new Uint8Array(self.memory.buffer, sPtr, n));
          let rec = self.spans[self._cursor];
          if (!rec) {
            const el = document.createElement("span");
            el.style.position = "absolute";
            self.layer.appendChild(el);
            rec = { x: 0, y: 0, size: 0, text: null, el };
            self.spans[self._cursor] = rec;
          }
          self._cursor++;
          if (rec.el.style.display === "none") rec.el.style.display = "";
          if (rec.text !== str) { rec.el.textContent = str; rec.text = str; } // rewrite only on change → keeps selection
          rec.el.style.color = "#" + (color >>> 0 & 0xffffff).toString(16).padStart(6, "0");
          rec.x = x; rec.y = y; rec.size = size;
          self._place(rec);
        },
        // text_be_clear(): BEGIN a frame — keep the pooled nodes (so a selection on a reused span survives),
        // hide only the spans the previous frame didn't reuse, and reset the cursor. (A drop in label count
        // hides its now-unused spans one frame later; the count is usually stable, so this is invisible.)
        text_be_clear() {
          for (let i = self._cursor; i < self.spans.length; i++) self.spans[i].el.style.display = "none";
          self._cursor = 0;
        },
      };
    }

    // Tear down: remove the overlay + resize listener (GfxRunner.stop()).
    destroy() {
      if (this._onResize) window.removeEventListener("resize", this._onResize);
      this._onResize = null;
      if (this.layer && this.layer.parentNode) this.layer.parentNode.removeChild(this.layer);
      this.layer = null;
      this.spans = [];
      this._cursor = 0;
    }
  }

  global.TextLayer = TextLayer;
  if (typeof module !== "undefined" && module.exports) module.exports = { TextLayer }; // node test harness
})(typeof window !== "undefined" ? window : globalThis);

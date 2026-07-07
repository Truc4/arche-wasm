import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The gfx (Tier 1) path end to end: `src/scene.arche` was built to a wasm REACTOR (globalSetup), and the
// public site (index.html + main.js) auto-runs it full-screen. arche renders its own software framebuffer;
// gfx.js presents it to the GPU (WebGL) and feeds ←/→ key state back in via gfx_be_axis_x. We assert the
// scene is actually painted, and that holding → changes the frame (the player moves, then the camera
// follows) — i.e. rendering AND input both work. A missing .wasm (no WASI sysroot) skips, like the compute specs.
const wwwDir = path.resolve(__dirname, '..', '..', 'www');

// Read the canvas back off the GPU with gl.readPixels (the presenter is WebGL, so there is no 2D context to
// getImageData): how many pixels are NOT the 0x0b0f1a background (the square is painted, not a blank frame),
// plus a POSITIONAL rolling hash of the bytes (so a moved square yields a different value). The hash must
// fold in each pixel's POSITION — a plain per-pixel colour sum is translation-invariant (moving the square
// keeps the same count of each colour) and would miss the move. The background-colour check also guards the
// fragment shader's channel swizzle — a wrong order would make no pixel match the bg.
async function sample(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const c = document.getElementById('screen') as HTMLCanvasElement;
    const gl = c.getContext('webgl') as WebGLRenderingContext;
    const w = c.width, h = c.height;
    const d = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, d);
    let nonbg = 0;
    let hash = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (!(d[i] === 0x0b && d[i + 1] === 0x0f && d[i + 2] === 0x1a)) nonbg++;
      // Rolling hash: multiplying the accumulator each pixel makes the value order/position-sensitive, so a
      // translated square changes it (a plain additive colour sum would not).
      hash = (hash * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 2147483647;
    }
    return { nonbg, hash, w, h };
  });
}

test('the app auto-runs full-screen, paints the scene, and moves the player on ← / →', async ({ page }) => {
  test.skip(!fs.existsSync(path.join(wwwDir, 'scene.wasm')), 'wasm not built (WASI sysroot missing?)');
  await page.goto('/index.html'); // the app boots itself — no picker, no click

  const screen = page.locator('#screen');
  await expect(screen).toHaveAttribute('data-status', 'live', { timeout: 5000 }); // first frame painted

  const a = await sample(page);
  expect(a.w).toBe(1920);
  expect(a.h).toBe(1080);
  expect(a.nonbg).toBeGreaterThan(1000); // the scene was actually rasterized, not a blank frame

  await page.keyboard.down('ArrowRight'); // hold right…
  // …until the frame actually changes (the player moves, then the camera follows). A fixed wait is flaky
  // under headless software rendering (SwiftShader), where requestAnimationFrame ticks slowly; poll the
  // readback until the frame has changed.
  await expect.poll(async () => (await sample(page)).hash, { timeout: 5000 }).not.toBe(a.hash);
  await page.keyboard.up('ArrowRight');   // the frame changed → keyboard input drives the scene
  const b = await sample(page);
  expect(b.nonbg).toBeGreaterThan(1000);
});

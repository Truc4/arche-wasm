import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The gfx (Tier 1) path end to end: `src/balls.arche` was built to a wasm REACTOR (globalSetup), the page
// drives it with requestAnimationFrame (gfx.js), and the arche program blits its own software framebuffer
// to a <canvas>. We assert the canvas actually painted the world (discs, not a blank frame) AND that it
// animates (two samples a few frames apart differ). A missing .wasm (no WASI sysroot) skips, like the
// compute specs.
const wwwDir = path.resolve(__dirname, '..', '..', 'www');

// A cheap fingerprint of the canvas: how many pixels are NOT the 0x0b0f1a background, plus a rolling hash
// of the pixel bytes (so two different frames produce different sums).
async function sample(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const c = document.getElementById('screen') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonbg = 0;
    let hash = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (!(d[i] === 0x0b && d[i + 1] === 0x0f && d[i + 2] === 0x1a)) nonbg++;
      hash = (hash + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7 + i) % 2147483647;
    }
    return { nonbg, hash, w: c.width, h: c.height };
  });
}

test('balls gfx demo renders its framebuffer to the canvas and animates', async ({ page }) => {
  test.skip(!fs.existsSync(path.join(wwwDir, 'balls.wasm')), 'wasm not built (WASI sysroot missing?)');
  await page.goto('/index.html');
  await page.selectOption('#demo', 'balls');
  await page.click('#run');

  const screen = page.locator('#screen');
  await expect(screen).toHaveAttribute('data-status', 'live', { timeout: 5000 }); // first frame painted

  const a = await sample(page);
  expect(a.w).toBe(480);
  expect(a.h).toBe(360);
  expect(a.nonbg).toBeGreaterThan(1000); // the discs were actually rasterized, not a blank frame

  await page.waitForTimeout(300); // let several rAF ticks advance
  const b = await sample(page);
  expect(b.nonbg).toBeGreaterThan(1000);
  expect(b.hash).not.toBe(a.hash); // the frame changed → it is animating
});

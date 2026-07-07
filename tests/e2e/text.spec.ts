import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The `text` device (DOM backend) end to end: `src/scene.arche` imports `text` and its `draw_hud` system —
// running once in the arche_run prefix — issues two `text.draw` calls. Those cross the wasm boundary to
// www/text.js (env.text_be_draw), which creates positioned <span>s in a #text-layer overlay above the gfx
// <canvas>. We assert the overlay was actually built: two spans, carrying the expected label strings. A
// missing .wasm (no WASI sysroot) skips, matching the gfx/compute specs.
const wwwDir = path.resolve(__dirname, '..', '..', 'www');

test('the scene overlays HUD text via the DOM text device', async ({ page }) => {
  test.skip(!fs.existsSync(path.join(wwwDir, 'scene.wasm')), 'wasm not built (WASI sysroot missing?)');
  await page.goto('/index.html'); // the app boots itself and runs draw_hud once

  // Wait for the first painted frame — by then arche_run (which contains the HUD prefix) has completed.
  await expect(page.locator('#screen')).toHaveAttribute('data-status', 'live', { timeout: 5000 });

  const layer = page.locator('#text-layer');
  await expect(layer).toContainText('arche-wasm');
  await expect(layer).toContainText('text device: DOM backend');
  await expect(layer.locator('span')).toHaveCount(2); // exactly the two draw_hud runs, not per-frame spam
});

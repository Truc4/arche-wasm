import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The whole pipeline, asserted end to end: each arche program was built to `.wasm` (globalSetup),
// the page fetches + runs it in the browser via the WASI shim, and we check the exact text it printed.
// Expected strings are pinned from running each demo under node:wasi (see README / the arche repo's
// wasm_backend.py). A missing .wasm (no WASI sysroot) skips rather than fails, matching that convention.
const DEMOS: Record<string, string> = {
  reduce: 'sum=20.0',
  pipeline: 'revenue_total=116.0',
  primes: 'primes<100: 25',
};

const wwwDir = path.resolve(__dirname, '..', '..', 'www');

for (const [name, expected] of Object.entries(DEMOS)) {
  test(`${name} runs in the browser and prints ${JSON.stringify(expected)}`, async ({ page }) => {
    test.skip(!fs.existsSync(path.join(wwwDir, `${name}.wasm`)), 'wasm not built (WASI sysroot missing?)');
    await page.goto('/index.html');
    await page.selectOption('#demo', name);
    await page.click('#run');
    const out = page.locator('#out');
    await expect(out).toHaveAttribute('data-status', 'done'); // deterministic: waits for the run to finish
    await expect(out).toContainText(expected);
  });
}

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Build every src/*.arche → www/<name>.wasm before the browser tests run, so `npx playwright test`
// works on its own (the Makefile's `make e2e` builds them too). Best-effort: if the arche compiler or
// the WASI sysroot is missing, the wasm simply isn't produced and the corresponding spec test.skips.
export default function globalSetup() {
  const arche = process.env.ARCHE || 'arche';
  const root = path.resolve(__dirname, '..', '..');
  const srcDir = path.join(root, 'src');
  const wwwDir = path.join(root, 'www');
  for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith('.arche'))) {
    const name = f.replace(/\.arche$/, '');
    try {
      execFileSync(arche, ['build', '--arch=wasm32', '-o', path.join(wwwDir, `${name}.wasm`), path.join(srcDir, f)], {
        stdio: 'pipe',
        env: { ...process.env, ARCHE_NO_GPU: '1' },
      });
    } catch {
      console.warn(`[globalSetup] could not build ${name}.wasm (arche/WASI sysroot missing?) — its test will skip`);
    }
  }
}

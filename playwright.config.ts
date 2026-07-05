import { defineConfig, devices } from '@playwright/test';

// Serve the static `www/` (the page + shim + built .wasm) and drive headless Chromium against it.
// The .wasm is fetched as an ArrayBuffer (no application/wasm MIME needed), so a plain static server
// suffices. globalSetup builds the wasm so `npx playwright test` also works standalone (`make e2e`
// builds it first anyway).
const PORT = 5178;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/globalSetup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `python3 -m http.server ${PORT} --directory www --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});

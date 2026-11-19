import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    viewport: { width: 380, height: 860 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm exec vite -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/taskpane.html',
    env: { ADDIN_TEST_HTTP: '1' },
    reuseExistingServer: false,
  },
});

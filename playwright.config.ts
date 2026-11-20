import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1,
  timeout: 30000, expect: { timeout: 8000 },
  reporter: 'list',
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node api/test/helpers/e2e-server.js', url: 'http://localhost:3101/api/dishes', reuseExistingServer: false },
    { command: 'node web/test-server.js', url: 'http://localhost:5174', reuseExistingServer: false, timeout: 120000, env: { WEB_PORT: '5174', VITE_API_URL: 'http://localhost:3101/api' } },
  ],
});

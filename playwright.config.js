import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  use: { baseURL: process.env.POC_BASE_URL || 'http://127.0.0.1:8787', viewport: { width: 412, height: 915 }, screenshot: 'only-on-failure' },
  webServer: process.env.POC_BASE_URL ? undefined : { command: 'npm run dev', url: 'http://127.0.0.1:8787/api/health', reuseExistingServer: !process.env.CI },
});

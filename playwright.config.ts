import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: a real browser against a real wslog, a real upstream
 * server, and real app connections. Every test starts its own instances on
 * free ports, so they run in parallel. Needs the dashboard built (`npm run test:e2e` does it).
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
});

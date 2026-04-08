import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration.
 * Tests live in tests/e2e/ and run against a locally-started dev server.
 *
 * Run all tests:   yarn test:e2e
 * Interactive UI:  yarn test:e2e:ui
 */
export default defineConfig({
  expect: {
    timeout: 10_000,
  },

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Run tests in files in parallel */
  fullyParallel: true,

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],

  /* Reporter */
  reporter: process.env.CI ? 'github' : 'html',

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Directory for test files */
  testDir: './tests/e2e',

  /* Shared settings for all projects */
  use: {
    /* Base URL for all page.goto('/') calls */
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',

    /* Run browsers in headless mode by default */
    headless: true,

    /* Collect trace on first retry */
    trace: 'on-first-retry',
  },

  /* Start both servers before running tests.
   * NODE_ENV=test activates the AUTH_CODE bypass in AuthService so the
   * E2E auth fixture can log in with TEST_AUTH_CODE without a real email.
   * The WebSocket server is required by sync.spec.ts to push real-time
   * updates across browser contexts. */
  webServer: [
    {
      command: 'NODE_ENV=test TEST_AUTH_CODE=e2e-test-code yarn dev',
      env: {
        NODE_ENV: 'test',
        TEST_AUTH_CODE: 'e2e-test-code',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://localhost:3000',
    },
    {
      command: 'yarn ws:server',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      url: 'http://localhost:3001',
    },
  ],

  /* Workers: 1 in CI to avoid resource contention */
  workers: process.env.CI ? 1 : undefined,
});

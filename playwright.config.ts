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

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Reporter */
  reporter: process.env.CI ? 'github' : 'html',

  /* Shared settings for all projects */
  use: {
    /* Base URL for all page.goto('/') calls */
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',

    /* Collect trace on first retry */
    trace: 'on-first-retry',

    /* Run browsers in headless mode by default */
    headless: true,
  },

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

  /* Start the Next.js dev server before running tests */
  webServer: {
    command: 'yarn dev',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: 'http://localhost:3000',
  },

  /* Directory for test files */
  testDir: './tests/e2e',

  /* Workers: 1 in CI to avoid resource contention */
  workers: process.env.CI ? 1 : undefined,
});

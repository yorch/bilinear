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
    timeout: 20_000,
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
      // -H 127.0.0.1 pins IPv4. Without it, Next 16's default `localhost` resolves
      // to ::1 (IPv6) on Node ≥17, and Playwright's URL probe — which goes to
      // 127.0.0.1 — never gets an answer. The webServer just hangs until timeout
      // with no output. stdout/stderr piping surfaces server logs in the CI log.
      command: 'NODE_ENV=test TEST_AUTH_CODE=000000 yarn next dev -H 127.0.0.1',
      env: {
        JWT_REFRESH_SECRET:
          process.env.JWT_REFRESH_SECRET ?? 'e2e-test-refresh-secret-for-testing-purposes-only-xyz',
        JWT_SECRET:
          process.env.JWT_SECRET ?? 'e2e-test-jwt-secret-for-testing-purposes-only-32chars',
        NODE_ENV: 'test',
        TEST_AUTH_CODE: '000000',
      },
      reuseExistingServer: !process.env.CI,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 180_000,
      // `/health` returns 200; Playwright's webServer only accepts 2xx/3xx as
      // "ready". `/` redirects through onboarding/auth and returns 404 on this
      // app, so the probe would otherwise poll until timeout.
      url: 'http://127.0.0.1:3000/health',
    },
    {
      command: 'yarn ws:server',
      env: {
        JWT_SECRET:
          process.env.JWT_SECRET ?? 'e2e-test-jwt-secret-for-testing-purposes-only-32chars',
        NODE_ENV: 'test',
        REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      },
      reuseExistingServer: !process.env.CI,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 30_000,
      url: 'http://127.0.0.1:3001',
    },
  ],

  /* Workers: 1 in CI to avoid resource contention */
  workers: process.env.CI ? 1 : undefined,
});

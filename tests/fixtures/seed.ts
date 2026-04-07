/**
 * Database seed helpers for E2E tests.
 *
 * These run before the test suite to ensure a clean, deterministic state.
 * In CI, a separate seed script populates the test database; locally,
 * developers can run `yarn db:seed` to get the same base data.
 *
 * The fixtures here provide typed helpers to create entities via the API
 * (not directly through Prisma) so tests exercise the same code path users do.
 */

export const TEST_USER = {
  email: 'e2e@test.local',
  name: 'E2E User',
};

export const TEST_TEAM = {
  key: 'E2E',
  name: 'E2E Team',
};

export const TEST_ISSUE = {
  description: 'Created by E2E test suite',
  priority: 2, // High
  title: 'E2E Test Issue',
};

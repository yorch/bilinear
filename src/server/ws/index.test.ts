/**
 * Unit tests for the WS server's periodic re-auth sweep.
 *
 * `ws/index.ts` is a standalone entry-point script: importing it opens a
 * Redis connection, binds an HTTP server, and registers process signal
 * handlers as module-level side effects (`yarn ws:server` is its only
 * intended runner). To exercise the pure, exported `shouldTerminateConnection`
 * predicate in isolation, every side-effecting dependency is mocked below and
 * fake timers keep the module's own `setInterval` schedulers from ever firing
 * during the test run.
 *
 * The predicate is the only part of the re-auth sweep that's meaningfully
 * unit-testable this way — the sweep's DB batching and actual socket
 * termination (`sweepRevokedConnections`, wired to live `liveConnections`)
 * need a real socket/Redis/DB and are covered by reasoning + code review
 * here; a staging pass should verify a revoked user's WS connection is
 * actually closed within one sweep interval.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(function MockRedis() {
    return {
      disconnect: vi.fn(),
      on: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(function MockWebSocketServer() {
    return {
      close: vi.fn(),
      on: vi.fn(),
    };
  }),
}));

vi.mock('node:http', () => ({
  createServer: vi.fn(() => ({
    close: vi.fn(),
    listen: vi.fn((_port: number, cb?: () => void) => cb?.()),
  })),
}));

vi.mock('@/server/lib/prisma', () => ({
  prisma: {
    cycle: { findUnique: vi.fn() },
    issue: { findMany: vi.fn() },
    organization: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

describe('ws/index shouldTerminateConnection', () => {
  // biome-ignore lint/suspicious/noExplicitAny: dynamically imported module shape
  let shouldTerminateConnection: any;

  beforeAll(async () => {
    // Prevent the module's own webhook/cycle-rollover/re-auth setIntervals
    // from ever firing a real callback against the mocked prisma above.
    vi.useFakeTimers();
    const mod = await import('./index');
    shouldTerminateConnection = mod.shouldTerminateConnection;
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  const activeUser = { active: true };
  const deactivatedUser = { active: false };
  const liveOrg = { archivedAt: null, suspendedAt: null };
  const suspendedOrg = { archivedAt: null, suspendedAt: new Date('2026-07-01T00:00:00Z') };
  const archivedOrg = { archivedAt: new Date('2026-07-01T00:00:00Z'), suspendedAt: null };

  it('keeps a connection whose user is active and org is not suspended/archived', () => {
    expect(shouldTerminateConnection(activeUser, liveOrg)).toBe(false);
  });

  it('terminates when the user has been deactivated', () => {
    expect(shouldTerminateConnection(deactivatedUser, liveOrg)).toBe(true);
  });

  it('terminates when the user row is missing (deleted)', () => {
    expect(shouldTerminateConnection(undefined, liveOrg)).toBe(true);
    expect(shouldTerminateConnection(null, liveOrg)).toBe(true);
  });

  it('terminates when the org is suspended', () => {
    expect(shouldTerminateConnection(activeUser, suspendedOrg)).toBe(true);
  });

  it('terminates when the org is archived', () => {
    expect(shouldTerminateConnection(activeUser, archivedOrg)).toBe(true);
  });

  it('terminates when the org row is missing (deleted)', () => {
    expect(shouldTerminateConnection(activeUser, undefined)).toBe(true);
    expect(shouldTerminateConnection(activeUser, null)).toBe(true);
  });

  it('terminates when both user and org checks fail', () => {
    expect(shouldTerminateConnection(deactivatedUser, suspendedOrg)).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_SCOPE_ID } from '@/lib/config';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  ConfigService,
  InvalidScopeError,
  SettingNotWritableError,
  UnknownSettingError,
} from './config.service';

/**
 * Layer precedence and the write guards. The storage guarantees these rest on
 * (the unique index, the platform sentinel deduplicating, a malformed row
 * surviving a read) are checked against a real Postgres by
 * `yarn db:verify:config` — a mock cannot observe them.
 */
describe('ConfigService', () => {
  let prisma: MockPrismaClient;
  let config: ConfigService;
  const ORG = '11111111-1111-1111-1111-111111111111';
  const TEAM = '22222222-2222-2222-2222-222222222222';

  /** Stub `setting.findMany` per (scopeType, scopeId). */
  const withRows = (rows: Record<string, Array<{ key: string; value: unknown }>>) => {
    prisma.setting.findMany.mockImplementation(
      ({ where }: { where: { scopeId: string; scopeType: string } }) =>
        Promise.resolve(rows[`${where.scopeType}:${where.scopeId}`] ?? []),
    );
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    config = new ConfigService(prisma as never);
  });

  afterEach(() => {
    delete process.env.WEBHOOK_MAX_ATTEMPTS;
    delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
  });

  describe('precedence', () => {
    it('falls back to the code default when nothing is stored', async () => {
      withRows({});
      const r = await config.explain('limits.maxInitiativeDepth', { orgId: ORG });
      expect(r.value).toBe(5);
      expect(r.source).toBe('code-default');
    });

    it('prefers a platform row over the code default', async () => {
      withRows({
        [`platform:${PLATFORM_SCOPE_ID}`]: [{ key: 'limits.maxInitiativeDepth', value: 7 }],
      });
      const r = await config.explain('limits.maxInitiativeDepth', { orgId: ORG });
      expect(r.value).toBe(7);
      expect(r.source).toBe('platform');
    });

    it('prefers an org row over a platform row', async () => {
      withRows({
        [`org:${ORG}`]: [{ key: 'limits.maxInitiativeDepth', value: 3 }],
        [`platform:${PLATFORM_SCOPE_ID}`]: [{ key: 'limits.maxInitiativeDepth', value: 7 }],
      });
      const r = await config.explain('limits.maxInitiativeDepth', { orgId: ORG });
      expect(r.value).toBe(3);
      expect(r.source).toBe('org');
    });

    it('prefers a team row over an org row', async () => {
      withRows({
        [`org:${ORG}`]: [{ key: 'cycles.upcomingCount', value: 9 }],
        [`team:${TEAM}`]: [{ key: 'cycles.upcomingCount', value: 4 }],
      });
      const r = await config.explain('cycles.upcomingCount', { orgId: ORG, teamId: TEAM });
      expect(r.value).toBe(4);
      expect(r.source).toBe('team');
    });

    it('ignores a team row when no team id is supplied', async () => {
      withRows({
        [`org:${ORG}`]: [{ key: 'cycles.upcomingCount', value: 9 }],
        [`team:${TEAM}`]: [{ key: 'cycles.upcomingCount', value: 4 }],
      });
      const r = await config.explain('cycles.upcomingCount', { orgId: ORG });
      expect(r.value).toBe(9);
    });

    it('skips a scope the knob does not declare', async () => {
      // maxInitiativeDepth is platform+org only. A team row for it must not be
      // consulted even when a team id is present, or a knob's declared scope
      // list would be advisory rather than enforced.
      withRows({
        [`org:${ORG}`]: [{ key: 'limits.maxInitiativeDepth', value: 3 }],
        [`team:${TEAM}`]: [{ key: 'limits.maxInitiativeDepth', value: 2 }],
      });
      const r = await config.explain('limits.maxInitiativeDepth', { orgId: ORG, teamId: TEAM });
      expect(r.value).toBe(3);
    });
  });

  describe('environment layers', () => {
    it('places a default-mode env var above the code default', async () => {
      withRows({});
      process.env.WEBHOOK_MAX_ATTEMPTS = '9';
      const r = await config.explain('webhook.maxAttempts', { orgId: ORG });
      expect(r.value).toBe(9);
      expect(r.source).toBe('env');
    });

    it('places a default-mode env var below every stored layer', async () => {
      withRows({ [`org:${ORG}`]: [{ key: 'webhook.maxAttempts', value: 2 }] });
      process.env.WEBHOOK_MAX_ATTEMPTS = '9';
      const r = await config.explain('webhook.maxAttempts', { orgId: ORG });
      expect(r.value).toBe(2);
      expect(r.source).toBe('org');
    });

    it('ignores a malformed default-mode env var rather than throwing', async () => {
      withRows({});
      process.env.WEBHOOK_MAX_ATTEMPTS = 'not-a-number';
      const r = await config.explain('webhook.maxAttempts', { orgId: ORG });
      expect(r.value).toBe(5);
      expect(r.source).toBe('code-default');
    });

    it('locks a knob whose override-mode env var is set', async () => {
      withRows({});
      process.env.ALLOW_PRIVATE_WEBHOOK_URLS = '1';
      const r = await config.explain('security.allowPrivateWebhookUrls');
      expect(r.value).toBe(true);
      expect(r.locked).toBe(true);
      expect(r.source).toBe('env');
    });

    it('never returns a redacted knob’s value', async () => {
      process.env.JWT_SECRET = 'super-secret';
      const r = await config.explain('env.JWT_SECRET');
      expect(r.value).toBeNull();
      expect(r.locked).toBe(true);
    });
  });

  describe('write guards', () => {
    it('rejects an unknown key', async () => {
      await expect(config.set('nope.missing', 'org', ORG, 1, null)).rejects.toBeInstanceOf(
        UnknownSettingError,
      );
    });

    it('rejects a scope the knob does not declare', async () => {
      await expect(
        config.set('limits.maxInitiativeDepth', 'team', TEAM, 3, null),
      ).rejects.toBeInstanceOf(InvalidScopeError);
    });

    it('refuses to store an env-only knob', async () => {
      await expect(
        config.set('env.JWT_SECRET', 'platform', PLATFORM_SCOPE_ID, 'x', null),
      ).rejects.toBeInstanceOf(SettingNotWritableError);
      expect(prisma.setting.upsert).not.toHaveBeenCalled();
    });

    it('returns the previous value so the caller can audit both sides', async () => {
      withRows({});
      prisma.setting.findUnique.mockResolvedValue({ value: 4 });
      const result = await config.set('limits.maxInitiativeDepth', 'org', ORG, 6, 'user1');
      expect(result.previousValue).toBe(4);
      expect(result.value).toBe(6);
    });
  });

  describe('caching', () => {
    it('loads a scope once and serves further keys from the snapshot', async () => {
      // The whole point of loading a scope rather than a key: six knobs used to
      // mean six round-trips, and sixty would mean sixty.
      withRows({
        [`org:${ORG}`]: [
          { key: 'limits.maxInitiativeDepth', value: 3 },
          { key: 'limits.maxExportRows', value: 50 },
        ],
      });
      await config.explain('limits.maxInitiativeDepth', { orgId: ORG });
      await config.explain('limits.maxExportRows', { orgId: ORG });
      const orgReads = prisma.setting.findMany.mock.calls.filter(
        call => (call[0] as { where: { scopeType: string } }).where.scopeType === 'org',
      );
      expect(orgReads).toHaveLength(1);
    });

    it('re-reads after an invalidation for that scope', async () => {
      withRows({ [`org:${ORG}`]: [{ key: 'limits.maxExportRows', value: 50 }] });
      await config.explain('limits.maxExportRows', { orgId: ORG });
      config.applyInvalidation(JSON.stringify({ scopeId: ORG, scopeType: 'org' }));
      await config.explain('limits.maxExportRows', { orgId: ORG });
      const orgReads = prisma.setting.findMany.mock.calls.filter(
        call => (call[0] as { where: { scopeType: string } }).where.scopeType === 'org',
      );
      expect(orgReads).toHaveLength(2);
    });

    it('survives a malformed invalidation payload', async () => {
      const spy = vi.spyOn(config, 'clearCache');
      expect(() => config.applyInvalidation('{not json')).not.toThrow();
      spy.mockRestore();
    });
  });

  describe('stored rows that no longer match their declaration', () => {
    it('falls through to the layer below instead of throwing', async () => {
      // `settings.value` is Json, so unlike a typed column the database checks
      // nothing. A knob whose type changed across a release can have a row of
      // the old shape, and that must not take the process down.
      withRows({
        [`org:${ORG}`]: [{ key: 'limits.maxInitiativeDepth', value: 'not-a-number' }],
        [`platform:${PLATFORM_SCOPE_ID}`]: [{ key: 'limits.maxInitiativeDepth', value: 7 }],
      });
      const r = await config.explain('limits.maxInitiativeDepth', { orgId: ORG });
      expect(r.value).toBe(7);
      expect(r.source).toBe('platform');
    });

    it('ignores a row whose key is no longer declared', async () => {
      withRows({ [`org:${ORG}`]: [{ key: 'retired.knob', value: 1 }] });
      const r = await config.explain('limits.maxInitiativeDepth', { orgId: ORG });
      expect(r.value).toBe(5);
    });
  });
});

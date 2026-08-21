import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_SCOPE_ID } from '@/lib/config';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ORG, TEST_USER } from '../../../test/fixtures';
import { settingResolvers } from './setting';

/**
 * The authorization surface for configuration.
 *
 * These exist because a review found that `resolveScopeId` returned the
 * platform sentinel unconditionally: any org admin, in any tenant, could write
 * the deployment-wide default for every other tenant through
 * `settingSet(scope: platform)`. The knob-level `editableBy` check did not stop
 * it, because `editableBy` is a property of the knob and reaching platform
 * scope is a property of the caller.
 */
describe('settingResolvers', () => {
  let ctx: MockGraphQLContext;

  const asPlatformAdmin = () => {
    ctx.prisma.user.findUnique.mockResolvedValue({ isPlatformAdmin: true });
  };
  const asRegularUser = () => {
    ctx.prisma.user.findUnique.mockResolvedValue({ isPlatformAdmin: false });
  };

  beforeEach(() => {
    ctx = createMockContext({ orgRole: 'owner', userId: TEST_USER.id });
    asRegularUser();
  });

  const set = (input: Record<string, unknown>) =>
    settingResolvers.Mutation.settingSet({}, { input } as never, ctx as never);
  const clear = (args: Record<string, unknown>) =>
    settingResolvers.Mutation.settingClear({}, args as never, ctx as never);
  const list = (args: Record<string, unknown>) =>
    settingResolvers.Query.settings({}, args as never, ctx as never);

  describe('platform scope', () => {
    it('refuses a platform-scope write from an org admin', async () => {
      // `cycles.upcomingCount` is org-admin editable AND declares platform
      // scope — precisely the shape that made this exploitable.
      await expect(
        set({ key: 'cycles.upcomingCount', scope: 'platform', value: 100 }),
      ).rejects.toBeInstanceOf(GraphQLError);
      expect(ctx.prisma.setting.upsert).not.toHaveBeenCalled();
    });

    it('refuses a platform-scope clear from an org admin', async () => {
      await expect(
        clear({ key: 'cycles.upcomingCount', scope: 'platform' }),
      ).rejects.toBeInstanceOf(GraphQLError);
      expect(ctx.prisma.setting.delete).not.toHaveBeenCalled();
    });

    it('allows a platform-scope write from a platform admin', async () => {
      asPlatformAdmin();
      ctx.prisma.setting.findUnique.mockResolvedValue(null);

      const result = await set({ key: 'cycles.upcomingCount', scope: 'platform', value: 20 });

      expect(result.success).toBe(true);
      const [[arg]] = ctx.prisma.setting.upsert.mock.calls as [
        [{ create: { scopeId: string; scopeType: string } }],
      ];
      expect(arg.create.scopeType).toBe('platform');
      expect(arg.create.scopeId).toBe(PLATFORM_SCOPE_ID);
    });

    it('refuses a platform-scope write while impersonating', async () => {
      // requirePlatformAdmin refuses an impersonated session even when the
      // impersonated target is themselves a platform admin. A hand-rolled
      // isPlatformAdmin check dropped that rule.
      asPlatformAdmin();
      ctx.impersonatorId = 'admin-1';

      await expect(
        set({ key: 'cycles.upcomingCount', scope: 'platform', value: 20 }),
      ).rejects.toBeInstanceOf(GraphQLError);
      expect(ctx.prisma.setting.upsert).not.toHaveBeenCalled();
    });
  });

  describe('tenancy', () => {
    it('refuses an org scopeId that is not the session’s org', async () => {
      await expect(
        set({
          key: 'limits.maxExportRows',
          scope: 'org',
          scopeId: '99999999-9999-9999-9999-999999999999',
          value: 50,
        }),
      ).rejects.toBeInstanceOf(GraphQLError);
      expect(ctx.prisma.setting.upsert).not.toHaveBeenCalled();
    });

    it('refuses a user scopeId belonging to someone else', async () => {
      await expect(
        list({ scope: 'user', scopeId: '99999999-9999-9999-9999-999999999999' }),
      ).rejects.toBeInstanceOf(GraphQLError);
    });

    it('refuses a team from another organization', async () => {
      // The team lookup is scoped by organizationId, so a foreign team simply
      // does not resolve.
      ctx.prisma.team.findFirst.mockResolvedValue(null);
      await expect(
        list({ scope: 'team', scopeId: '88888888-8888-8888-8888-888888888888' }),
      ).rejects.toBeInstanceOf(GraphQLError);
    });

    it('requires a teamId for team scope', async () => {
      await expect(list({ scope: 'team' })).rejects.toBeInstanceOf(GraphQLError);
    });
  });

  describe('role gating', () => {
    it('refuses a write from a plain member', async () => {
      ctx.orgRole = 'member';
      await expect(
        set({ key: 'limits.maxExportRows', scope: 'org', value: 50 }),
      ).rejects.toBeInstanceOf(GraphQLError);
      expect(ctx.prisma.setting.upsert).not.toHaveBeenCalled();
    });

    it('refuses an org admin writing a platform-admin-only knob', async () => {
      await expect(
        set({ key: 'limits.maxExportRows', scope: 'org', value: 50 }),
      ).rejects.toBeInstanceOf(GraphQLError);
    });

    it('hides platform-admin-only knobs from an org admin’s listing', async () => {
      ctx.prisma.setting.findMany.mockResolvedValue([]);
      const rows = await list({ scope: 'org' });
      const keys = rows.map((r: { key: string }) => r.key);
      // Visible to org-admin…
      expect(keys).toContain('limits.maxExportRows');
      // …but webhook.requestTimeoutMs is platform-scope + platform-admin only.
      expect(keys).not.toContain('webhook.requestTimeoutMs');
    });
  });

  describe('propagation', () => {
    it('broadcasts an org-scope write', async () => {
      asPlatformAdmin();
      ctx.prisma.setting.findUnique.mockResolvedValue(null);
      const spy = vi.spyOn(ctx.services.sync, 'createSyncAction');

      await set({ key: 'limits.maxExportRows', scope: 'org', value: 50 });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][2]).toBe('Setting');
    });

    it('does NOT broadcast a platform-scope write', async () => {
      // No org channel exists for platform scope, and inventing one would fan a
      // deployment-wide change into one arbitrary tenant's stream.
      asPlatformAdmin();
      ctx.prisma.setting.findUnique.mockResolvedValue(null);
      const spy = vi.spyOn(ctx.services.sync, 'createSyncAction');

      await set({ key: 'cycles.upcomingCount', scope: 'platform', value: 20 });

      expect(spy).not.toHaveBeenCalled();
    });

    it('does NOT broadcast a user-scope write', async () => {
      // The whole point: createSyncAction fans out to every client in the org,
      // so broadcasting one person's preference hands it to the workspace.
      asPlatformAdmin();
      ctx.prisma.setting.findUnique.mockResolvedValue(null);
      const spy = vi.spyOn(ctx.services.sync, 'createSyncAction');

      await set({ key: 'cycles.upcomingCount', scope: 'user', value: 20 }).catch(() => {
        // cycles.upcomingCount does not declare user scope; the rejection is
        // itself the guarantee. Either way nothing may broadcast.
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('error mapping', () => {
    it('maps a validation failure to BAD_USER_INPUT', async () => {
      asPlatformAdmin();
      await expect(
        set({ key: 'cycles.upcomingCount', scope: 'platform', value: 10_000 }),
      ).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    });

    it('maps a validation failure thrown by a *different copy* of the class', async () => {
      // Not hypothetical, and not visible to any other test here. The registry
      // is importable from the browser, so the bundler emits it into the SSR
      // chunk as well as the server one — two copies, two class identities. An
      // `instanceof` check compared the thrown value against the wrong
      // constructor and fell through to `throw err`, which Apollo masked: a
      // platform admin typing an out-of-range number saw "Internal server
      // error" instead of the bounds message. Recognition keys on `name`,
      // which survives the duplication; this fakes the foreign copy.
      asPlatformAdmin();
      const foreign = new Error('cycles.upcomingCount must be between 1 and 100');
      foreign.name = 'InvalidSettingValueError';
      ctx.config.set = vi.fn().mockRejectedValue(foreign);

      await expect(
        set({ key: 'cycles.upcomingCount', scope: 'platform', value: 10_000 }),
      ).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    });
  });

  describe('redaction', () => {
    it('never returns a secret’s value through the single-setting query', async () => {
      asPlatformAdmin();
      process.env.JWT_SECRET = 'super-secret-value';

      const row = await settingResolvers.Query.setting(
        {},
        { key: 'env.JWT_SECRET', scope: 'platform' } as never,
        ctx as never,
      );

      expect(row.value).toBeNull();
      expect(row.redacted).toBe(true);
      expect(row.envIsSet).toBe(true);
      expect(row.envVarName).toBe('JWT_SECRET');
      expect(JSON.stringify(row)).not.toContain('super-secret-value');
    });
  });

  describe('audit', () => {
    it('records both sides of an org-scope change', async () => {
      asPlatformAdmin();
      ctx.prisma.setting.findUnique.mockResolvedValue({ value: 10 });
      const spy = vi.spyOn(ctx.services.auditLog, 'log').mockResolvedValue(undefined);

      await set({ key: 'limits.maxExportRows', scope: 'org', value: 50 });

      expect(spy).toHaveBeenCalledTimes(1);
      const entry = spy.mock.calls[0][0] as {
        action: string;
        metadata: { previousValue: unknown; value: unknown };
        orgId: string;
      };
      expect(entry.action).toBe('settings.config_changed');
      expect(entry.orgId).toBe(TEST_ORG.id);
      // previousValue is what makes a mis-set knob recoverable by lookup.
      expect(entry.metadata.previousValue).toBe(10);
      expect(entry.metadata.value).toBe(50);
    });

    it('routes a platform-scope change to the platform audit log', async () => {
      asPlatformAdmin();
      ctx.prisma.setting.findUnique.mockResolvedValue(null);
      const orgSpy = vi.spyOn(ctx.services.auditLog, 'log').mockResolvedValue(undefined);
      const platformSpy = vi
        .spyOn(ctx.services.platformAdmin, 'recordAudit')
        .mockResolvedValue(undefined as never);

      await set({ key: 'cycles.upcomingCount', scope: 'platform', value: 20 });

      // AuditLogEntry is org-scoped; a platform change belongs to no tenant.
      expect(platformSpy).toHaveBeenCalledTimes(1);
      expect(orgSpy).not.toHaveBeenCalled();
    });
  });
});

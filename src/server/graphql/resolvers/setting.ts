import { GraphQLError } from 'graphql';
import {
  getSetting,
  InvalidSettingValueError,
  PLATFORM_SCOPE_ID,
  type ResolvedSetting,
  type SettingRole,
  type SettingScope,
  settingsForScope,
} from '@/lib/config';
import { InvalidScopeError, SettingNotWritableError, UnknownSettingError } from '../../config';
import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

/**
 * Effective config role for the caller.
 *
 * Deliberately coarse: the registry only distinguishes three levels, and the
 * mapping from org roles to them is the whole of the authorization model for
 * configuration. `owner` and `admin` are both org-admins here — the split
 * between them governs membership, not settings.
 */
async function callerRole(ctx: GraphQLContext): Promise<SettingRole> {
  const user = ctx.userId
    ? await ctx.prisma.user.findUnique({
        select: { isPlatformAdmin: true },
        where: { id: ctx.userId },
      })
    : null;
  if (user?.isPlatformAdmin) {
    return 'platform-admin';
  }
  return ctx.orgRole === 'owner' || ctx.orgRole === 'admin' ? 'org-admin' : 'member';
}

const ROLE_RANK: Record<SettingRole, number> = {
  member: 0,
  'org-admin': 1,
  'platform-admin': 2,
};

function satisfies(actual: SettingRole, required: SettingRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/**
 * Resolve the entity id for a scope, defaulting to the caller's own org/team.
 *
 * A caller may never name another org's id: config is tenant data, and letting
 * `scopeId` through unchecked would turn a read into a cross-tenant leak. Team
 * ids are verified to belong to the caller's org for the same reason.
 */
async function resolveScopeId(
  ctx: GraphQLContext,
  scope: SettingScope,
  requested: string | null | undefined,
): Promise<string> {
  if (scope === 'platform') {
    return PLATFORM_SCOPE_ID;
  }
  if (scope === 'user') {
    if (requested && requested !== ctx.userId) {
      throw new GraphQLError('Cannot access another user’s settings', {
        extensions: { code: 'FORBIDDEN' },
      });
    }
    if (!ctx.userId) {
      throw new GraphQLError('Not authenticated', { extensions: { code: 'UNAUTHENTICATED' } });
    }
    return ctx.userId;
  }
  if (scope === 'org') {
    if (requested && requested !== ctx.orgId) {
      throw new GraphQLError('Cannot access another organization’s settings', {
        extensions: { code: 'FORBIDDEN' },
      });
    }
    if (!ctx.orgId) {
      throw new GraphQLError('No organization in session', {
        extensions: { code: 'FORBIDDEN' },
      });
    }
    return ctx.orgId;
  }
  // team
  if (!requested) {
    throw new GraphQLError('teamId is required for team-scoped settings', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  const team = await ctx.prisma.team.findFirst({
    select: { id: true },
    where: { id: requested, organizationId: ctx.orgId ?? '' },
  });
  if (!team) {
    throw new GraphQLError('Team not found', { extensions: { code: 'NOT_FOUND' } });
  }
  return team.id;
}

/** Shape a `ResolvedSetting` for the SDL, never leaking a redacted value. */
function toGraphQL(resolved: ResolvedSetting) {
  const d = resolved.definition;
  return {
    editableBy: d.editableBy,
    enumValues: d.enumValues ?? null,
    envIsSet: d.env ? (process.env[d.env.name] ?? '') !== '' : false,
    envVarName: d.env?.name ?? null,
    key: resolved.key,
    labelKey: d.labelKey,
    locked: resolved.locked,
    max: d.bounds?.max ?? null,
    min: d.bounds?.min ?? null,
    redacted: d.redacted ?? false,
    restartRequired: d.restartRequired ?? false,
    scopes: d.scopes,
    source: resolved.source,
    type: d.type,
    // Already null for a redacted knob — `explain` never populates it.
    value: resolved.value,
  };
}

/**
 * Propagate a config change to other clients.
 *
 * Per-scope, and deliberately not one mechanism. `createSyncAction` is
 * org-keyed and the WS server fans it out to *every* connected client in that
 * org, so:
 *
 * - org and team scope broadcast, which is correct — the value applies to
 *   everyone in the org.
 * - user scope does NOT broadcast. Fanning a user's own preference out to the
 *   whole workspace would hand every member another person's settings. This
 *   codebase already learned that lesson once (see the comment on
 *   SYNC_PAYLOAD_OMITTED_FIELDS in sync.service.ts). Until ConnectionManager
 *   can address a single user's sockets, the client applies its own write
 *   locally and other devices pick it up on next bootstrap.
 * - platform scope has no org channel at all. Invalidation still reaches every
 *   *server* process over the config:invalidate channel, so behaviour changes
 *   immediately; connected browsers refresh on next load.
 */
async function propagate(
  ctx: GraphQLContext,
  scope: SettingScope,
  scopeId: string,
): Promise<string | null> {
  if (scope !== 'org' && scope !== 'team') {
    return null;
  }
  if (!ctx.orgId) {
    return null;
  }
  const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Setting', scopeId, {
    scope,
    scopeId,
  });
  return sync.id.toString();
}

function mapConfigError(err: unknown): never {
  if (err instanceof UnknownSettingError) {
    throw new GraphQLError((err as Error).message, { extensions: { code: 'NOT_FOUND' } });
  }
  if (err instanceof InvalidSettingValueError || err instanceof InvalidScopeError) {
    throw new GraphQLError((err as Error).message, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  if (err instanceof SettingNotWritableError) {
    throw new GraphQLError((err as Error).message, { extensions: { code: 'FORBIDDEN' } });
  }
  throw err;
}

export const settingResolvers = {
  Mutation: {
    settingClear: async (
      _parent: unknown,
      { key, scope, scopeId }: { key: string; scope: SettingScope; scopeId?: string | null },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const definition = getSetting(key);
      if (!definition) {
        throw new GraphQLError(`Unknown setting: ${key}`, {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const role = await callerRole(ctx);
      if (!satisfies(role, definition.editableBy)) {
        throw new GraphQLError('Insufficient permissions to change this setting', {
          extensions: { code: 'FORBIDDEN' },
        });
      }
      const resolvedScopeId = await resolveScopeId(ctx, scope, scopeId);

      let previous: unknown;
      try {
        previous = await ctx.config.clear(key, scope, resolvedScopeId);
      } catch (err) {
        mapConfigError(err);
      }

      await recordAudit(ctx, key, scope, resolvedScopeId, previous, null);
      const lastSyncId = await propagate(ctx, scope, resolvedScopeId);
      const resolved = await ctx.config.explain(key, await idsFor(ctx, scope, resolvedScopeId));
      return { lastSyncId, setting: toGraphQL(resolved), success: true };
    },

    settingSet: async (
      _parent: unknown,
      {
        input,
      }: {
        input: { key: string; scope: SettingScope; scopeId?: string | null; value: unknown };
      },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const definition = getSetting(input.key);
      if (!definition) {
        throw new GraphQLError(`Unknown setting: ${input.key}`, {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const role = await callerRole(ctx);
      if (!satisfies(role, definition.editableBy)) {
        throw new GraphQLError('Insufficient permissions to change this setting', {
          extensions: { code: 'FORBIDDEN' },
        });
      }
      const resolvedScopeId = await resolveScopeId(ctx, input.scope, input.scopeId);

      let previousValue: unknown;
      let value: unknown;
      try {
        const result = await ctx.config.set(
          input.key,
          input.scope,
          resolvedScopeId,
          input.value,
          ctx.userId ?? null,
        );
        previousValue = result.previousValue;
        value = result.value;
      } catch (err) {
        mapConfigError(err);
      }

      await recordAudit(ctx, input.key, input.scope, resolvedScopeId, previousValue, value);
      const lastSyncId = await propagate(ctx, input.scope, resolvedScopeId);
      const resolved = await ctx.config.explain(
        input.key,
        await idsFor(ctx, input.scope, resolvedScopeId),
      );
      return { lastSyncId, setting: toGraphQL(resolved), success: true };
    },
  },

  Query: {
    setting: async (
      _parent: unknown,
      { key, scope, scopeId }: { key: string; scope: SettingScope; scopeId?: string | null },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const definition = getSetting(key);
      if (!definition) {
        throw new GraphQLError(`Unknown setting: ${key}`, {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      const role = await callerRole(ctx);
      if (!satisfies(role, definition.visibleTo)) {
        throw new GraphQLError('Insufficient permissions to read this setting', {
          extensions: { code: 'FORBIDDEN' },
        });
      }
      const resolvedScopeId = await resolveScopeId(ctx, scope, scopeId);
      const resolved = await ctx.config.explain(key, await idsFor(ctx, scope, resolvedScopeId));
      return toGraphQL(resolved);
    },

    settings: async (
      _parent: unknown,
      { scope, scopeId }: { scope: SettingScope; scopeId?: string | null },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const role = await callerRole(ctx);
      const resolvedScopeId = await resolveScopeId(ctx, scope, scopeId);
      const ids = await idsFor(ctx, scope, resolvedScopeId);

      const visible = settingsForScope(scope).filter(d => satisfies(role, d.visibleTo));
      const resolved = await Promise.all(visible.map(d => ctx.config.explain(d.key, ids)));
      return resolved.map(toGraphQL);
    },
  },
};

/**
 * Build the id bundle a resolution needs. A team-scoped read still has to
 * carry its org so the chain can fall through team → org → platform.
 */
async function idsFor(ctx: GraphQLContext, scope: SettingScope, scopeId: string) {
  if (scope === 'team') {
    return { orgId: ctx.orgId, teamId: scopeId, userId: ctx.userId };
  }
  if (scope === 'user') {
    return { orgId: ctx.orgId, userId: scopeId };
  }
  if (scope === 'org') {
    return { orgId: scopeId, userId: ctx.userId };
  }
  return {};
}

/**
 * Record the change, with both sides of it.
 *
 * `previousValue` is what makes a mis-set knob recoverable: restoring it is a
 * lookup rather than a guess. Platform-scope writes go to `PlatformAuditLog`
 * because `AuditLogEntry` is org-scoped and a platform change belongs to no
 * single tenant.
 */
async function recordAudit(
  ctx: GraphQLContext,
  key: string,
  scope: SettingScope,
  scopeId: string,
  previousValue: unknown,
  value: unknown,
): Promise<void> {
  const metadata = { key, previousValue: previousValue ?? null, scope, scopeId, value };
  if (scope === 'platform') {
    void ctx.services.platformAdmin.recordAudit({
      action: 'setting.changed',
      actorId: ctx.userId ?? null,
      ipAddress: ctx.clientIp,
      metadata,
      targetId: null,
      targetType: 'Setting',
    });
    return;
  }
  if (!ctx.orgId) {
    return;
  }
  await ctx.services.auditLog.log({
    action: 'settings.config_changed',
    ipAddress: ctx.clientIp,
    metadata,
    orgId: ctx.orgId,
    resourceId: scopeId,
    resourceType: 'Setting',
    userId: ctx.userId ?? null,
  });
}

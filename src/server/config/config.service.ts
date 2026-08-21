/**
 * Resolves configuration values through the layered chain, caches them per
 * process, and writes them.
 *
 * Deliberately NOT bolted onto the GraphQL context. Two of the three processes
 * that read configuration have no GraphQL request at all: `src/server/ws/` runs
 * the webhook retry sweep and cycle rollover on `setInterval`, and consumes
 * exactly the knobs this system makes configurable (`webhook.maxAttempts` is
 * the registry's own headline example); `src/server/yjs/` talks to Prisma the
 * same way. So the snapshot and its invalidation live here, and `ctx.config` is
 * a thin per-request memo over this — see `./request-config`.
 *
 * Invalidation runs on a dedicated `config:invalidate` channel subscribed
 * unconditionally at process start. It cannot reuse the sync channel: the WS
 * server subscribes to `sync:<orgId>` only while an org has a live client
 * (`ws/index.ts`), so an org with nobody connected would never see an
 * invalidation while that same process is still retrying its webhooks. The TTL
 * is the backstop for a dropped message, and it is not optional — Next.js runs
 * multiple server instances, each with its own snapshot.
 */

import type Redis from 'ioredis';
import {
  getSetting,
  InvalidSettingValueError,
  PLATFORM_SCOPE_ID,
  type ResolvedSetting,
  SCOPE_ORDER,
  SETTINGS,
  type SettingDefinition,
  type SettingRole,
  type SettingScope,
  type SettingSource,
  type SettingValue,
  satisfiesRole,
  settingsForScope,
  validateSettingValue,
} from '@/lib/config';
import type { PrismaClient } from '../../generated/prisma';
import { childLogger } from '../lib/logger';
import { finalizeValue, requireDefinition, resolveWithoutDatabase, sourceForEnv } from './reader';

const log = childLogger({ module: 'config' });

/** Redis channel every process subscribes to at start. */
export const CONFIG_INVALIDATE_CHANNEL = 'config:invalidate';

/**
 * Snapshot lifetime. Short enough that a dropped invalidation self-heals within
 * a cycle rather than persisting until restart, long enough that the common
 * case is served from memory.
 */
export const CONFIG_CACHE_TTL_MS = 30_000;

/**
 * Cache size above which a load also sweeps expired entries. Below it the walk
 * costs more than the entries it would reclaim.
 */
const CONFIG_CACHE_SWEEP_THRESHOLD = 64;

/** The ids a resolution is relative to. All optional — background jobs have none. */
export interface ConfigScopeIds {
  orgId?: string | null;
  teamId?: string | null;
  userId?: string | null;
}

/**
 * Who is performing a write, and with what authority.
 *
 * `role` is not decoration — `assertWritable` re-checks it, so platform-scope
 * protection lives in the primitive every writer funnels through rather than
 * only in the one resolver that remembers to call `requirePlatformAdmin`. That
 * mattered here: the escalation this guards against shipped precisely because
 * the check lived at one call site and the shared write path trusted it.
 *
 * Required rather than defaulted. A default would be a permissive value a new
 * caller inherits by saying nothing, which is the failure mode being closed;
 * making it required forces every writer — including operator scripts with
 * direct database access — to state its authority out loud.
 */
export interface SettingWriter {
  /** User id for the audit trail, or `null` for a system or operator write. */
  actorId: string | null;
  role: SettingRole;
}

export class UnknownSettingError extends Error {}
export class SettingNotWritableError extends Error {}
export class InvalidScopeError extends Error {}

interface ScopeCacheEntry {
  expiresAt: number;
  values: Map<string, SettingValue>;
}

function scopeCacheKey(scopeType: SettingScope, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

export class ConfigService {
  /** Per-(scope, id) snapshot of every stored key for that scope. */
  private cache = new Map<string, ScopeCacheEntry>();
  /**
   * Monotonic counter per cache key, bumped by every invalidation. A load that
   * finishes after its generation moved on discards its result instead of
   * caching a snapshot that is already known to be stale.
   *
   * Deliberately a second map rather than a field on `ScopeCacheEntry`: the
   * counter has to outlive the entry. Invalidation and the expiry sweep both
   * remove the cached snapshot, and folding the counter into it would reset
   * that scope's generation to 0 — letting an in-flight load that started
   * before the invalidation match again and cache exactly the snapshot the
   * counter exists to reject.
   */
  private generation = new Map<string, number>();
  /**
   * In-flight loads, so N concurrent misses on one scope issue one query
   * rather than N. Without it a cold start with a bootstrap burst re-queries
   * the same scope once per concurrent caller, every TTL, forever.
   */
  private inflight = new Map<string, Promise<Map<string, SettingValue>>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis?: Redis,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * Resolve one knob, returning the value and the layer that supplied it.
   *
   * Precedence, lowest first: code default → env → platform → org → team →
   * user. An `override`-mode env var short-circuits above everything.
   */
  async explain(key: string, ids: ConfigScopeIds = {}): Promise<ResolvedSetting> {
    const definition = requireDefinition(key);

    // The database-free part of the chain, shared with DEFAULTS_ONLY_CONFIG so
    // the two readers cannot drift on `locked`, redaction, or the override
    // short-circuit. A non-null `resolved` means the answer needs no query.
    const { envValue, resolved } = resolveWithoutDatabase(definition, key);
    if (resolved) {
      return resolved;
    }

    let value: SettingValue | null = envValue;
    let source: SettingSource = sourceForEnv(envValue);
    // The deepest scope an id was actually supplied for. A per-scope default
    // map has to be read at the scope being resolved — without this, a knob
    // declaring `{ org: 10, team: 3 }` would hand a caller who only supplied an
    // orgId the *team* default, because the no-argument fallback walks
    // SCOPE_ORDER in reverse.
    let deepest: SettingScope | undefined;

    for (const scope of SCOPE_ORDER) {
      if (!definition.scopes.includes(scope)) {
        continue;
      }
      const scopeId = this.scopeIdFor(scope, ids);
      if (!scopeId) {
        continue;
      }
      deepest = scope;
      const stored = (await this.loadScope(scope, scopeId)).get(key);
      if (stored !== undefined) {
        value = stored;
        source = scope;
      }
    }

    return {
      definition,
      key,
      locked: false,
      source,
      // Redaction and the default fallback both live in `finalizeValue`, at
      // the single exit. They used to be inlined here and handled only in the
      // two early returns of `resolveWithoutDatabase`, so a knob declared
      // `redacted` with `storage: 'db'` would have returned its value — and
      // `toGraphQL` passes this straight to the client.
      value: finalizeValue(definition, value, deepest),
    };
  }

  /** Resolve one knob to its effective value. */
  async get<T extends SettingValue = SettingValue>(
    key: string,
    ids: ConfigScopeIds = {},
  ): Promise<T> {
    const resolved = await this.explain(key, ids);
    // Only a redacted knob resolves to null, and nothing reads a secret through
    // `get` — they are consumed from `process.env` at their point of use.
    if (resolved.value === null) {
      throw new SettingNotWritableError(`${key} is redacted and cannot be read`);
    }
    return resolved.value as T;
  }

  /** Convenience for the common integer knob. */
  async getInt(key: string, ids: ConfigScopeIds = {}): Promise<number> {
    return this.get<number>(key, ids);
  }

  /** Convenience for the common boolean knob. */
  async getBoolean(key: string, ids: ConfigScopeIds = {}): Promise<boolean> {
    return this.get<boolean>(key, ids);
  }

  /**
   * Resolve every knob declared at a scope — the admin console's read path.
   *
   * `include` is where the caller applies its own visibility rule; the settings
   * resolver passes `d => satisfies(role, d.visibleTo)`. Without the predicate
   * the resolver had to re-implement this method's body to filter first, so the
   * two drifted apart by construction.
   */
  async explainAll(
    scope: SettingScope,
    ids: ConfigScopeIds = {},
    include: (definition: SettingDefinition) => boolean = () => true,
  ): Promise<ResolvedSetting[]> {
    const defs = settingsForScope(scope).filter(include);
    return Promise.all(defs.map(d => this.explain(d.key, ids)));
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * Store a value for one knob at one scope.
   *
   * Returns the previous stored value (or `null` if none) so the caller can put
   * it in the audit record — that is what makes a rollback mechanical rather
   * than a guess, and it is nearly free here.
   */
  async set(
    key: string,
    scope: SettingScope,
    scopeId: string,
    rawValue: unknown,
    writer: SettingWriter,
  ): Promise<{ previousValue: SettingValue | null; value: SettingValue }> {
    const definition = this.assertWritable(key, scope, writer.role);
    const value = validateSettingValue(definition, rawValue);

    const existing = await this.prisma.setting.findUnique({
      select: { value: true },
      where: { scopeType_scopeId_key: { key, scopeId, scopeType: scope } },
    });

    await this.prisma.setting.upsert({
      create: { key, scopeId, scopeType: scope, updatedBy: writer.actorId, value },
      update: { updatedBy: writer.actorId, value },
      where: { scopeType_scopeId_key: { key, scopeId, scopeType: scope } },
    });

    await this.invalidate(scope, scopeId);
    return {
      previousValue: (existing?.value as SettingValue | undefined) ?? null,
      value,
    };
  }

  /**
   * Remove a stored value so the knob falls back to the layer below. This is
   * "reset to inherited", and it is why the generic table earns its keep — the
   * same operation against a column would need a sentinel for "unset".
   */
  async clear(
    key: string,
    scope: SettingScope,
    scopeId: string,
    writer: SettingWriter,
  ): Promise<SettingValue | null> {
    this.assertWritable(key, scope, writer.role);
    const existing = await this.prisma.setting.findUnique({
      select: { value: true },
      where: { scopeType_scopeId_key: { key, scopeId, scopeType: scope } },
    });
    if (!existing) {
      return null;
    }
    await this.prisma.setting.delete({
      where: { scopeType_scopeId_key: { key, scopeId, scopeType: scope } },
    });
    await this.invalidate(scope, scopeId);
    return existing.value as SettingValue;
  }

  /**
   * Delete every row for a scope. `settings.scopeId` is polymorphic and so
   * carries no foreign key, which means it gets none of the `onDelete: Cascade`
   * the rest of the schema relies on — deleting an org, team or user has to
   * come here explicitly or the rows outlive their owner forever.
   */
  async deleteScope(scopeType: SettingScope, scopeId: string): Promise<number> {
    const { count } = await this.prisma.setting.deleteMany({
      where: { scopeId, scopeType },
    });
    if (count > 0) {
      await this.invalidate(scopeType, scopeId);
    }
    return count;
  }

  /**
   * Drop rows for knobs explicitly retired via `deprecated: true`.
   *
   * **Only tombstoned keys, never merely-unknown ones.** An earlier version
   * deleted everything absent from this process's registry, which is unsafe in
   * exactly the situation config systems are most needed: a rollback, a
   * blue/green window, or a developer running `yarn ws:server` from an older
   * checkout against a shared database. In all three, an older process sees a
   * newer version's keys as "unknown" and would silently delete every tenant's
   * value for them, irrecoverably — the audit log records the writes, not the
   * mass delete.
   *
   * Retiring a knob is therefore a two-step, deliberate act: mark it
   * `deprecated` in one release (its rows stop being read), delete the
   * declaration in a later one. That also preserves the rule keys are never
   * reused, because the tombstone stays visible in the registry until it is
   * safe to drop.
   */
  async pruneDeprecatedKeys(): Promise<number> {
    const deprecated = SETTINGS.filter(d => d.deprecated).map(d => d.key);
    if (deprecated.length === 0) {
      return 0;
    }
    const { count } = await this.prisma.setting.deleteMany({
      where: { key: { in: deprecated } },
    });
    if (count > 0) {
      // Name the keys, not just a count: a destructive sweep whose log cannot
      // answer "what did it remove" is not auditable.
      log.warn({ count, keys: deprecated }, 'Pruned settings rows for deprecated keys');
      this.cache.clear();
    }
    return count;
  }

  // ── Cache and invalidation ───────────────────────────────────────────────

  /** Drop this process's snapshot for a scope and tell the others to do the same. */
  async invalidate(scopeType: SettingScope, scopeId: string): Promise<void> {
    this.bumpGeneration(scopeCacheKey(scopeType, scopeId));
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.publish(CONFIG_INVALIDATE_CHANNEL, JSON.stringify({ scopeId, scopeType }));
    } catch (err) {
      // Best-effort: the TTL is the backstop, so a Redis blip costs staleness
      // rather than correctness.
      log.error({ err, scopeId, scopeType }, 'Config invalidation publish failed');
    }
  }

  /** Apply an invalidation received on the Redis channel. */
  applyInvalidation(payload: string): void {
    try {
      const { scopeId, scopeType } = JSON.parse(payload) as {
        scopeId: string;
        scopeType: SettingScope;
      };
      this.bumpGeneration(scopeCacheKey(scopeType, scopeId));
    } catch (err) {
      log.error({ err }, 'Malformed config invalidation payload');
    }
  }

  /** Drop the whole snapshot. Used by tests and the deprecated-key prune. */
  clearCache(): void {
    this.cache.clear();
    // Bump every known generation too, so a load already in flight cannot
    // repopulate the cache with a snapshot taken before this call.
    for (const key of [...this.generation.keys()]) {
      this.generation.set(key, (this.generation.get(key) ?? 0) + 1);
    }
  }

  /**
   * Drop a scope's snapshot and mark any in-flight load of it stale.
   *
   * The generation counter closes a race the plain `cache.delete` could not:
   * a reader that missed the cache, issued its query, and had an invalidation
   * arrive while it was awaiting would otherwise write its pre-invalidation
   * snapshot afterwards and serve it for the full TTL — precisely the staleness
   * the invalidation channel exists to prevent.
   */
  private bumpGeneration(cacheKey: string): void {
    this.cache.delete(cacheKey);
    this.generation.set(cacheKey, (this.generation.get(cacheKey) ?? 0) + 1);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private scopeIdFor(scope: SettingScope, ids: ConfigScopeIds): string | null {
    switch (scope) {
      case 'platform':
        return PLATFORM_SCOPE_ID;
      case 'org':
        return ids.orgId ?? null;
      case 'team':
        return ids.teamId ?? null;
      case 'user':
        return ids.userId ?? null;
    }
  }

  /**
   * Every guard a write must clear, in the one place every write goes through.
   *
   * The role checks duplicate the settings resolver deliberately. The resolver
   * has to run them anyway — it needs `ctx` for the impersonation rule that
   * `requirePlatformAdmin` enforces, and it produces the user-facing error —
   * but a duplicate check in the shared primitive is what makes the guarantee
   * hold for callers that are not that resolver.
   */
  private assertWritable(key: string, scope: SettingScope, role: SettingRole): SettingDefinition {
    const definition = requireDefinition(key);
    if (scope === 'platform' && role !== 'platform-admin') {
      throw new SettingNotWritableError(
        'Platform-scope settings may only be written by a platform administrator',
      );
    }
    if (!satisfiesRole(role, definition.editableBy)) {
      throw new SettingNotWritableError(`${key} requires ${definition.editableBy} to change`);
    }
    if (definition.storage === 'env-only') {
      throw new SettingNotWritableError(`${key} is env-only and cannot be stored`);
    }
    if (definition.deprecated) {
      throw new SettingNotWritableError(`${key} is deprecated`);
    }
    if (!definition.scopes.includes(scope)) {
      throw new InvalidScopeError(
        `${key} cannot be set at ${scope} scope (allowed: ${definition.scopes.join(', ')})`,
      );
    }
    return definition;
  }

  /**
   * Every stored key for one scope, in one query, memoised for the TTL.
   *
   * Loading the whole scope rather than one key at a time is what keeps this
   * from becoming the N+1 the old per-knob `select` pattern already was: six
   * knobs meant six round-trips, and sixty would mean sixty.
   */
  private async loadScope(
    scopeType: SettingScope,
    scopeId: string,
  ): Promise<Map<string, SettingValue>> {
    const cacheKey = scopeCacheKey(scopeType, scopeId);
    const hit = this.cache.get(cacheKey);
    const now = Date.now();
    if (hit && hit.expiresAt > now) {
      return hit.values;
    }

    const existing = this.inflight.get(cacheKey);
    if (existing) {
      return existing;
    }

    // Captured before the query. If an invalidation lands while it is in
    // flight, the generation moves on and the result is returned to this
    // caller but NOT cached — otherwise a snapshot taken before a write would
    // be served for the whole TTL despite the invalidation having arrived.
    const generation = this.generation.get(cacheKey) ?? 0;

    const load = (async () => {
      const rows = await this.prisma.setting.findMany({
        select: { key: true, value: true },
        where: { scopeId, scopeType },
      });

      const values = new Map<string, SettingValue>();
      for (const row of rows) {
        const definition = getSetting(row.key);
        if (!definition) {
          // A row whose knob has been retired. Ignored rather than thrown so a
          // half-finished prune cannot take the process down.
          continue;
        }
        try {
          // The database does not type-check `value` — a knob whose type
          // changed across a release can have a row of the old shape. Fall
          // through to the layer below and log, never throw.
          values.set(row.key, validateSettingValue(definition, row.value));
        } catch (err) {
          if (err instanceof InvalidSettingValueError) {
            log.warn(
              { err, key: row.key, scopeId, scopeType },
              'Stored setting does not match its declaration — ignoring row',
            );
            continue;
          }
          throw err;
        }
      }

      if ((this.generation.get(cacheKey) ?? 0) === generation) {
        this.cache.set(cacheKey, { expiresAt: now + CONFIG_CACHE_TTL_MS, values });
        this.sweepExpired(now);
      }
      return values;
    })().finally(() => {
      this.inflight.delete(cacheKey);
    });

    this.inflight.set(cacheKey, load);
    return load;
  }

  /**
   * Drop expired entries so the snapshot cannot grow without bound.
   *
   * `scopeId` is never attacker-controlled (org is forced to the session's,
   * team must resolve to a real row), so this is not a memory-exhaustion
   * defence — it is simply that a long-lived process would otherwise hold one
   * entry per org and per team it ever touched, forever. Runs only when the
   * map is large enough for the walk to be worth it.
   */
  private sweepExpired(now: number): void {
    if (this.cache.size < CONFIG_CACHE_SWEEP_THRESHOLD) {
      return;
    }
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}

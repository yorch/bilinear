/**
 * The read surface services depend on, and a database-free implementation of
 * it.
 *
 * Services take a `ConfigReader` rather than the concrete `ConfigService` for
 * one practical reason: every service is unit-tested against a mocked Prisma
 * client that knows nothing about a `setting` delegate. `DEFAULTS_ONLY_CONFIG`
 * resolves from the registry and the environment alone — no query — so a
 * service constructed without an explicit reader behaves exactly as it did when
 * the value was a module constant. That is also what keeps the existing tests
 * meaningful: they assert the default, and the default is still what they get.
 *
 * Production wiring passes the real `ConfigService` from the GraphQL context
 * and from the standalone WS/YJS entry points.
 */

import {
  defaultForScope,
  getSetting,
  parseEnvValue,
  type ResolvedSetting,
  type SettingDefinition,
  type SettingScope,
  type SettingValue,
} from '@/lib/config';
import {
  type ConfigScopeIds,
  SettingNotWritableError,
  UnknownSettingError,
} from './config.service';

export interface ConfigReader {
  explain(key: string, ids?: ConfigScopeIds): Promise<ResolvedSetting>;
  get<T extends SettingValue = SettingValue>(key: string, ids?: ConfigScopeIds): Promise<T>;
  getBoolean(key: string, ids?: ConfigScopeIds): Promise<boolean>;
  getInt(key: string, ids?: ConfigScopeIds): Promise<number>;
}

/**
 * Look up a key or throw the same error the real service throws.
 *
 * Shared so the two readers cannot disagree on the error *type*:
 * `mapConfigError` in the settings resolver keys on `instanceof`, so a bare
 * `Error` here would surface as INTERNAL_SERVER_ERROR where `ConfigService`
 * surfaces NOT_FOUND.
 */
export function requireDefinition(key: string): SettingDefinition {
  const definition = getSetting(key);
  if (!definition) {
    throw new UnknownSettingError(`Unknown setting: ${key}`);
  }
  return definition;
}

/**
 * The part of resolution that needs no database: code default → env, plus the
 * `override`-mode short-circuit and redaction.
 *
 * Both readers call this so they cannot drift. They previously computed
 * `locked` differently — the defaults-only reader keyed it on `storage`, the
 * real service on `env.mode === 'override'` — which agreed only because every
 * `override` knob today is also `env-only`. Declaring one `override` + `db`
 * knob, which is the mode's documented purpose, would have made the two
 * disagree, with the unit-test path reporting the knob as editable.
 *
 * Returns `null` when the caller must continue into the database layers.
 */
export function resolveWithoutDatabase(
  definition: SettingDefinition,
  key: string,
  scope?: SettingScope,
): { envValue: SettingValue | null; resolved: ResolvedSetting | null } {
  const envValue = definition.env
    ? parseEnvValue(definition, process.env[definition.env.name])
    : null;

  // An override-mode env var wins outright, whatever the storage. Reported as
  // locked so the UI renders the knob read-only rather than accepting a write
  // that would never take effect.
  if (definition.env?.mode === 'override' && envValue !== null) {
    return {
      envValue,
      resolved: {
        definition,
        key,
        locked: true,
        source: 'env',
        value: definition.redacted ? null : envValue,
      },
    };
  }

  // env-only knobs never consult the database.
  if (definition.storage === 'env-only') {
    return {
      envValue,
      resolved: {
        definition,
        key,
        locked: true,
        source: envValue !== null ? 'env' : 'code-default',
        value: definition.redacted ? null : (envValue ?? defaultForScope(definition, scope)),
      },
    };
  }

  return { envValue, resolved: null };
}

/**
 * Resolves `code default → env` and stops. No database, no cache, no Redis.
 *
 * Used as the constructor default for every service, so a service is never
 * *unable* to read configuration — it simply cannot see stored overrides
 * unless it was given the real reader.
 */
class DefaultsOnlyConfig implements ConfigReader {
  async explain(key: string): Promise<ResolvedSetting> {
    const definition = requireDefinition(key);
    const { envValue, resolved } = resolveWithoutDatabase(definition, key);
    if (resolved) {
      return resolved;
    }
    return {
      definition,
      key,
      locked: false,
      source: envValue !== null ? 'env' : 'code-default',
      value: definition.redacted ? null : (envValue ?? defaultForScope(definition)),
    };
  }

  async get<T extends SettingValue = SettingValue>(key: string): Promise<T> {
    const resolved = await this.explain(key);
    if (resolved.value === null) {
      throw new SettingNotWritableError(`${key} is redacted and cannot be read`);
    }
    return resolved.value as T;
  }

  async getBoolean(key: string): Promise<boolean> {
    return this.get<boolean>(key);
  }

  async getInt(key: string): Promise<number> {
    return this.get<number>(key);
  }
}

export const DEFAULTS_ONLY_CONFIG: ConfigReader = new DefaultsOnlyConfig();

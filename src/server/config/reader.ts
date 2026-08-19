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
  type SettingValue,
} from '@/lib/config';
import type { ConfigScopeIds } from './config.service';

export interface ConfigReader {
  explain(key: string, ids?: ConfigScopeIds): Promise<ResolvedSetting>;
  get<T extends SettingValue = SettingValue>(key: string, ids?: ConfigScopeIds): Promise<T>;
  getBoolean(key: string, ids?: ConfigScopeIds): Promise<boolean>;
  getInt(key: string, ids?: ConfigScopeIds): Promise<number>;
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
    const definition = getSetting(key);
    if (!definition) {
      throw new Error(`Unknown setting: ${key}`);
    }
    const envValue = definition.env
      ? parseEnvValue(definition, process.env[definition.env.name])
      : null;
    return {
      definition,
      key,
      locked: definition.storage === 'env-only',
      source: envValue !== null ? 'env' : 'code-default',
      value: definition.redacted ? null : (envValue ?? defaultForScope(definition)),
    };
  }

  async get<T extends SettingValue = SettingValue>(key: string): Promise<T> {
    const resolved = await this.explain(key);
    if (resolved.value === null) {
      throw new Error(`${key} is redacted and cannot be read`);
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

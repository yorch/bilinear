import { defaultForScope, getSetting, type ResolvedSetting, type SettingValue } from '@/lib/config';
import type { ConfigReader } from '@/server/config/reader';

/**
 * A `ConfigReader` that answers from a plain object, falling back to the
 * registry's declared default for any key it wasn't given.
 *
 * Services resolve caps through `ConfigReader` rather than reading a column,
 * so a test that wants to exercise "org has raised this limit" stubs the
 * reader instead of mocking `organization.findUnique`. Unspecified keys still
 * resolve — a test overriding one cap doesn't have to enumerate the rest.
 */
export function createStubConfig(values: Record<string, SettingValue> = {}): ConfigReader {
  const resolve = (key: string): SettingValue => {
    if (key in values) {
      return values[key];
    }
    const definition = getSetting(key);
    if (!definition) {
      throw new Error(`Unknown setting in test stub: ${key}`);
    }
    return defaultForScope(definition);
  };

  return {
    async explain(key: string): Promise<ResolvedSetting> {
      const definition = getSetting(key);
      if (!definition) {
        throw new Error(`Unknown setting in test stub: ${key}`);
      }
      return {
        definition,
        key,
        locked: false,
        source: key in values ? 'org' : 'code-default',
        value: resolve(key),
      };
    },
    async get<T extends SettingValue = SettingValue>(key: string): Promise<T> {
      return resolve(key) as T;
    },
    async getBoolean(key: string): Promise<boolean> {
      return resolve(key) as boolean;
    },
    async getInt(key: string): Promise<number> {
      return resolve(key) as number;
    },
  };
}

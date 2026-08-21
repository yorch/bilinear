import type { ResolvedSetting, SettingValue } from '@/lib/config';
import {
  type ConfigReader,
  DEFAULTS_ONLY_CONFIG,
  finalizeValue,
  requireDefinition,
  resolveWithoutDatabase,
} from '@/server/config/reader';

/**
 * A `ConfigReader` that answers from a plain object, falling back to the
 * registry's declared default for any key it wasn't given.
 *
 * Services resolve caps through `ConfigReader` rather than reading a column,
 * so a test that wants to exercise "org has raised this limit" stubs the
 * reader instead of mocking `organization.findUnique`. Unspecified keys still
 * resolve — a test overriding one cap doesn't have to enumerate the rest.
 *
 * Built on the same `requireDefinition` / `resolveWithoutDatabase` /
 * `finalizeValue` helpers the two real readers share, rather than re-deriving
 * resolution a third time. The first version did re-derive it and had already
 * drifted in two ways: it threw a bare `Error` for an unknown key where
 * `UnknownSettingError` is what callers match on, and it ignored `redacted`,
 * so a test stubbing a secret got a value production would never hand back.
 */
export function createStubConfig(values: Record<string, SettingValue> = {}): ConfigReader {
  const explain = async (key: string): Promise<ResolvedSetting> => {
    if (!(key in values)) {
      return DEFAULTS_ONLY_CONFIG.explain(key);
    }
    const definition = requireDefinition(key);
    // An env-only knob, or one an `override`-mode variable has locked, cannot
    // be overridden by a stored row in production either — so the stub must
    // not pretend it can.
    const { resolved } = resolveWithoutDatabase(definition, key);
    if (resolved) {
      return resolved;
    }
    return {
      definition,
      key,
      locked: false,
      source: 'org',
      value: finalizeValue(definition, values[key]),
    };
  };

  const get = async <T extends SettingValue = SettingValue>(key: string): Promise<T> => {
    const resolved = await explain(key);
    return resolved.value as T;
  };

  return {
    explain,
    get,
    async getBoolean(key: string): Promise<boolean> {
      return get<boolean>(key);
    },
    async getInt(key: string): Promise<number> {
      return get<number>(key);
    },
  };
}

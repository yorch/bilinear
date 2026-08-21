/**
 * Public surface of the configuration registry. Import from here rather than
 * reaching into `./registry` or `./types` directly.
 */
export {
  defaultForScope,
  defineSetting,
  getSetting,
  InvalidSettingValueError,
  isInvalidSettingValueError,
  numericSettingDefault,
  parseEnvValue,
  SETTINGS,
  satisfiesRole,
  settingDefault,
  settingKeys,
  settingsForScope,
  validateSettingValue,
} from './registry';
export type {
  EnvMode,
  ResolvedSetting,
  SettingDefinition,
  SettingEnvBinding,
  SettingRole,
  SettingScope,
  SettingSource,
  SettingStorage,
  SettingType,
  SettingValue,
} from './types';
export { SCOPE_ORDER } from './types';

/**
 * Sentinel `scopeId` for platform-scope rows.
 *
 * Platform scope has no entity to point at, but `settings.scope_id` is NOT
 * NULL on purpose: Postgres unique indexes are NULLS DISTINCT by default, so a
 * nullable column would let ('platform', NULL, key) be inserted repeatedly and
 * the resolver would pick an arbitrary row — a silent, data-dependent bug.
 * Postgres 15+ can express NULLS NOT DISTINCT, but Prisma's DSL cannot, so the
 * all-zeroes UUID is the portable answer. Every id column in this schema is
 * `@db.Uuid`, so the sentinel has to be a valid UUID.
 */
export const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Types for the configuration registry.
 *
 * Deliberately dependency-free (no imports, no server-only or client-only
 * APIs) so the registry can be imported from both browser bundles (the admin
 * and workspace settings UIs render their forms from it) and server code
 * (`src/server/config/` resolves and writes values through it). This mirrors
 * `src/lib/sync-config.ts` and `src/lib/plan-limits.ts` — the latter is the
 * five-knob ancestor this module generalises. Do not add imports here.
 */

/**
 * The four scopes a value can be configured at, in precedence order — later
 * scopes override earlier ones.
 *
 * `project` is deliberately absent. Config is policy that applies to a *class*
 * of entities and is inherited; an attribute is a property of one entity and is
 * edited on that entity. `Project.roadmapVisible` is an attribute, and no
 * project column wants inheritance. See docs/CONFIG_ASSESSMENT.md §7-D1.
 *
 * Two caveats the names hide, both deliberate and both documented rather than
 * fixed, because fixing either is a schema change that must happen before rows
 * exist rather than after:
 *
 * - `user` does NOT nest under `org`. A user belongs to many orgs, and the
 *   existing preference columns (`users.locale`, `users.accent`) are global per
 *   user. A single `scopeId` cannot key a per-(user, org) preference, so user
 *   scope is global. See docs/CONFIG_ASSESSMENT.md §9-4.
 * - `team` is flat. `Team.parentId` is a real hierarchy, but team-scope
 *   resolution does not walk it — a sub-team inherits from its org, not from
 *   its parent team. See docs/CONFIG_ASSESSMENT.md §9-5.
 */
export type SettingScope = 'platform' | 'org' | 'team' | 'user';

/** Scopes in resolution order, lowest precedence first. */
export const SCOPE_ORDER: readonly SettingScope[] = ['platform', 'org', 'team', 'user'];

/** The value shapes a knob can hold. `value` is stored as JSON either way. */
export type SettingType = 'boolean' | 'enum' | 'int' | 'number' | 'string';

export type SettingValue = boolean | number | string;

/**
 * How a knob's environment variable participates in resolution.
 *
 * - `default` — replaces the *code* default, below every database layer. This
 *   is the chain as drawn, and it is what every migrated env var starts as
 *   because it reproduces the pre-registry behaviour exactly (env if set, else
 *   the constant).
 * - `override` — sits above every layer including `user`. Reserved for safety
 *   and infrastructure knobs an operator must be able to force regardless of
 *   what a tenant has stored. A knob resolved this way renders locked in the
 *   admin UI (see `ResolvedSetting.locked`).
 *
 * A third `seed` mode was considered and rejected: materialising a row lazily
 * on read turns the resolver — a pure read path also called from background
 * jobs — into a writer. Seeding is a provisioning concern and happens at org
 * creation instead. See docs/CONFIG_ASSESSMENT.md §7-D4.
 */
export type EnvMode = 'default' | 'override';

/**
 * Whether a knob has database layers at all.
 *
 * `env-only` knobs are never written, never listed as editable, and never
 * stored — secrets, connection strings, ports, and the client/server-shared
 * sync constants. They are in the registry so that documentation generation
 * and `explain()` can see them, not so they can be changed at runtime.
 */
export type SettingStorage = 'db' | 'env-only';

/**
 * Role required to read or write a knob.
 *
 * `editableBy` and `visibleTo` are genuinely two fields. The plan limits are
 * the proof: visible to org admins, editable only by platform admins. A single
 * `role` field could not express a case the product already has.
 */
export type SettingRole = 'member' | 'org-admin' | 'platform-admin';

export interface SettingEnvBinding {
  mode: EnvMode;
  /** Environment variable name, e.g. `WEBHOOK_MAX_ATTEMPTS`. */
  name: string;
}

export interface SettingDefinition {
  /** Bounds for `int`/`number` knobs. Enforced on every write. */
  bounds?: { max: number; min: number };
  /**
   * Code default — the bottom of the chain. A map supplies a different default
   * per scope (an org default and a team default for one key are different
   * things and one scalar cannot hold both).
   */
  default: SettingValue | Partial<Record<SettingScope, SettingValue>>;
  /**
   * Tombstone. A retired knob stays declared so its rows can be pruned and its
   * key can never be reused for a different knob — a reused key would silently
   * resurrect a stale tenant value with a new meaning.
   */
  deprecated?: boolean;
  /** Role required to write. Ignored for `env-only` knobs, which nobody writes. */
  editableBy: SettingRole;
  /** Allowed values for `enum` knobs. */
  enumValues?: readonly string[];
  env?: SettingEnvBinding;
  /** Dotted, stable, and never reused. */
  key: string;
  /** i18n key for the human-readable label. */
  labelKey: string;
  /**
   * Never return the value — only the variable name and whether it is set.
   * Every secret is `storage: 'env-only', redacted: true`.
   *
   * Without this the admin console becomes a secrets-disclosure endpoint: the
   * registry covers all of `.env.example`, including `JWT_SECRET` and
   * `SMTP_PASS`, and the locked-knob UI names the variable behind a value.
   */
  redacted?: boolean;
  /**
   * True when the value is only read at process start (ports, `setInterval`
   * cadences). Surfaced in the UI so a knob that needs a restart says so
   * rather than appearing to have taken effect.
   */
  restartRequired?: boolean;
  /** Scopes this knob may be stored at, lowest precedence first. */
  scopes: readonly SettingScope[];
  storage: SettingStorage;
  type: SettingType;
  /** Role required to read. */
  visibleTo: SettingRole;
}

/** Where a resolved value came from. */
export type SettingSource = SettingScope | 'code-default' | 'env';

export interface ResolvedSetting {
  definition: SettingDefinition;
  key: string;
  /**
   * True when an `override`-mode env var supplied the value, so no stored
   * value can take effect. The UI must render the knob read-only and name the
   * variable — without that, saving appears to succeed and silently does
   * nothing.
   */
  locked: boolean;
  /** Which layer supplied `value`. */
  source: SettingSource;
  /**
   * `null` for a redacted knob — callers get `envVarName`/`isSet` instead.
   */
  value: SettingValue | null;
}

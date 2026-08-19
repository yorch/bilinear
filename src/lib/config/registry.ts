/**
 * The configuration registry — one declaration per knob, and the single source
 * of truth for every value that changes app behaviour without changing user
 * data.
 *
 * Adding a knob is one entry here. Everything else derives from it: the
 * resolved value's type, the write validator, the admin/settings form rows, the
 * i18n key list, the `.env.example` documentation, and the audit metadata.
 *
 * Dependency-free by design — see `./types`. Imported by both the browser
 * (settings UIs) and the server (`src/server/config/`).
 */

import { SCOPE_ORDER, type SettingDefinition, type SettingScope, type SettingValue } from './types';

/**
 * Identity helper. Exists to get the declaration checked against
 * `SettingDefinition` at the definition site rather than only where the array
 * is consumed, so a malformed entry names its own line in the type error.
 */
export function defineSetting(definition: SettingDefinition): SettingDefinition {
  return definition;
}

/**
 * Every knob in the system.
 *
 * Grouped by area, and within a group by scope. The `env-only` entries at the
 * bottom are not runtime-configurable — they are declared so that documentation
 * generation and `explain()` can see the whole surface, and so that a secret can
 * be marked `redacted` in one place.
 */
export const SETTINGS: readonly SettingDefinition[] = [
  // ── Plan-tier caps (were Organization.max* columns) ───────────────────────
  // Platform-admin editable, org-admin visible: this is a billing boundary, and
  // the split is why `editableBy` and `visibleTo` are two fields.
  defineSetting({
    bounds: { max: 1000, min: 1 },
    default: 20,
    editableBy: 'platform-admin',
    key: 'limits.maxCustomFieldsPerTeam',
    labelKey: 'config.limits.maxCustomFieldsPerTeam',
    scopes: ['platform', 'org'],
    storage: 'db',
    type: 'int',
    visibleTo: 'org-admin',
  }),
  defineSetting({
    bounds: { max: 1000, min: 1 },
    default: 30,
    editableBy: 'platform-admin',
    key: 'limits.maxCustomFieldsPerOrg',
    labelKey: 'config.limits.maxCustomFieldsPerOrg',
    scopes: ['platform', 'org'],
    storage: 'db',
    type: 'int',
    visibleTo: 'org-admin',
  }),
  defineSetting({
    bounds: { max: 10_000, min: 1 },
    default: 250,
    editableBy: 'platform-admin',
    key: 'limits.maxLabelGroupChildren',
    labelKey: 'config.limits.maxLabelGroupChildren',
    scopes: ['platform', 'org'],
    storage: 'db',
    type: 'int',
    visibleTo: 'org-admin',
  }),
  defineSetting({
    bounds: { max: 20, min: 1 },
    default: 5,
    editableBy: 'platform-admin',
    key: 'limits.maxInitiativeDepth',
    labelKey: 'config.limits.maxInitiativeDepth',
    scopes: ['platform', 'org'],
    storage: 'db',
    type: 'int',
    visibleTo: 'org-admin',
  }),
  defineSetting({
    bounds: { max: 1_000_000, min: 1 },
    default: 10_000,
    editableBy: 'platform-admin',
    key: 'limits.maxExportRows',
    labelKey: 'config.limits.maxExportRows',
    scopes: ['platform', 'org'],
    storage: 'db',
    type: 'int',
    visibleTo: 'org-admin',
  }),
  defineSetting({
    bounds: { max: 10_000, min: 1 },
    default: 500,
    editableBy: 'platform-admin',
    key: 'limits.maxImportRows',
    labelKey: 'config.limits.maxImportRows',
    scopes: ['platform', 'org'],
    storage: 'db',
    type: 'int',
    visibleTo: 'org-admin',
  }),

  // ── Cycles (was Team.upcomingCycleCount) ──────────────────────────────────
  defineSetting({
    bounds: { max: 100, min: 1 },
    default: 15,
    editableBy: 'org-admin',
    key: 'cycles.upcomingCount',
    labelKey: 'config.cycles.upcomingCount',
    scopes: ['platform', 'org', 'team'],
    storage: 'db',
    type: 'int',
    visibleTo: 'member',
  }),

  // ── Webhooks ──────────────────────────────────────────────────────────────
  defineSetting({
    bounds: { max: 20, min: 1 },
    default: 5,
    editableBy: 'platform-admin',
    env: { mode: 'default', name: 'WEBHOOK_MAX_ATTEMPTS' },
    key: 'webhook.maxAttempts',
    labelKey: 'config.webhook.maxAttempts',
    scopes: ['platform', 'org'],
    storage: 'db',
    type: 'int',
    visibleTo: 'org-admin',
  }),
  defineSetting({
    bounds: { max: 1000, min: 1 },
    default: 20,
    editableBy: 'platform-admin',
    env: { mode: 'default', name: 'WEBHOOK_AUTO_DISABLE_AFTER' },
    key: 'webhook.autoDisableAfter',
    labelKey: 'config.webhook.autoDisableAfter',
    scopes: ['platform', 'org'],
    storage: 'db',
    type: 'int',
    visibleTo: 'org-admin',
  }),
  defineSetting({
    bounds: { max: 60_000, min: 1000 },
    default: 10_000,
    editableBy: 'platform-admin',
    env: { mode: 'default', name: 'WEBHOOK_REQUEST_TIMEOUT_MS' },
    key: 'webhook.requestTimeoutMs',
    labelKey: 'config.webhook.requestTimeoutMs',
    scopes: ['platform'],
    storage: 'db',
    type: 'int',
    visibleTo: 'platform-admin',
  }),

  // ── Invites ───────────────────────────────────────────────────────────────
  defineSetting({
    bounds: { max: 90, min: 1 },
    default: 7,
    editableBy: 'platform-admin',
    key: 'invite.expiryDays',
    labelKey: 'config.invite.expiryDays',
    scopes: ['platform', 'org'],
    storage: 'db',
    type: 'int',
    visibleTo: 'org-admin',
  }),
  defineSetting({
    bounds: { max: 10_000, min: 1 },
    default: 200,
    editableBy: 'platform-admin',
    key: 'invite.maxPending',
    labelKey: 'config.invite.maxPending',
    scopes: ['platform', 'org'],
    storage: 'db',
    type: 'int',
    visibleTo: 'org-admin',
  }),

  // ── Branding ──────────────────────────────────────────────────────────────
  // The runtime counterpart to NEXT_PUBLIC_APP_NAME, which is inlined by
  // `next build` and therefore unreachable for a deployment running a prebuilt
  // image. Same reasoning as WS_PUBLIC_URL / YJS_PUBLIC_URL in env.ts.
  defineSetting({
    default: 'Bilinear',
    editableBy: 'platform-admin',
    env: { mode: 'default', name: 'APP_NAME' },
    key: 'branding.appName',
    labelKey: 'config.branding.appName',
    scopes: ['platform'],
    storage: 'db',
    type: 'string',
    visibleTo: 'member',
  }),

  // ── AI assistant ──────────────────────────────────────────────────────────
  defineSetting({
    default: 'anthropic',
    editableBy: 'platform-admin',
    enumValues: ['anthropic', 'openai'],
    env: { mode: 'default', name: 'AI_PROVIDER' },
    key: 'ai.provider',
    labelKey: 'config.ai.provider',
    scopes: ['platform'],
    storage: 'db',
    type: 'enum',
    visibleTo: 'platform-admin',
  }),
  defineSetting({
    default: '',
    editableBy: 'platform-admin',
    env: { mode: 'default', name: 'ANTHROPIC_MODEL' },
    key: 'ai.anthropicModel',
    labelKey: 'config.ai.anthropicModel',
    scopes: ['platform'],
    storage: 'db',
    type: 'string',
    visibleTo: 'platform-admin',
  }),
  defineSetting({
    default: '',
    editableBy: 'platform-admin',
    env: { mode: 'default', name: 'OPENAI_MODEL' },
    key: 'ai.openaiModel',
    labelKey: 'config.ai.openaiModel',
    scopes: ['platform'],
    storage: 'db',
    type: 'string',
    visibleTo: 'platform-admin',
  }),

  // ── Logging ───────────────────────────────────────────────────────────────
  defineSetting({
    default: 'info',
    editableBy: 'platform-admin',
    enumValues: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
    env: { mode: 'default', name: 'LOG_LEVEL' },
    key: 'log.level',
    labelKey: 'config.log.level',
    scopes: ['platform'],
    storage: 'db',
    type: 'enum',
    visibleTo: 'platform-admin',
  }),
  defineSetting({
    bounds: { max: 1, min: 0 },
    default: 1,
    editableBy: 'platform-admin',
    env: { mode: 'default', name: 'LOG_HTTP_SAMPLE_RATE' },
    key: 'log.httpSampleRate',
    labelKey: 'config.log.httpSampleRate',
    scopes: ['platform'],
    storage: 'db',
    type: 'number',
    visibleTo: 'platform-admin',
  }),

  // ── Security ──────────────────────────────────────────────────────────────
  // `override` mode: an operator must be able to force these from the
  // deployment regardless of what is stored, because they protect the server
  // from its own tenants.
  defineSetting({
    default: false,
    editableBy: 'platform-admin',
    env: { mode: 'override', name: 'ALLOW_PRIVATE_WEBHOOK_URLS' },
    key: 'security.allowPrivateWebhookUrls',
    labelKey: 'config.security.allowPrivateWebhookUrls',
    scopes: ['platform'],
    storage: 'db',
    type: 'boolean',
    visibleTo: 'platform-admin',
  }),
  defineSetting({
    default: false,
    editableBy: 'platform-admin',
    env: { mode: 'override', name: 'AUTH_RATE_LIMIT_FAIL_CLOSED' },
    key: 'security.authRateLimitFailClosed',
    labelKey: 'config.security.authRateLimitFailClosed',
    scopes: ['platform'],
    storage: 'db',
    type: 'boolean',
    visibleTo: 'platform-admin',
  }),

  // ── env-only: secrets ─────────────────────────────────────────────────────
  // Declared so the surface is visible in one place and each is marked
  // redacted exactly once. Never stored, never editable, value never returned.
  ...(
    [
      ['JWT_SECRET', 'config.env.jwtSecret'],
      ['JWT_REFRESH_SECRET', 'config.env.jwtRefreshSecret'],
      ['DATABASE_URL', 'config.env.databaseUrl'],
      ['REDIS_URL', 'config.env.redisUrl'],
      ['GOOGLE_CLIENT_SECRET', 'config.env.googleClientSecret'],
      ['GITHUB_CLIENT_SECRET', 'config.env.githubClientSecret'],
      ['SLACK_CLIENT_SECRET', 'config.env.slackClientSecret'],
      ['SLACK_SIGNING_SECRET', 'config.env.slackSigningSecret'],
      ['SMTP_PASS', 'config.env.smtpPass'],
      ['ANTHROPIC_API_KEY', 'config.env.anthropicApiKey'],
      ['OPENAI_API_KEY', 'config.env.openaiApiKey'],
      ['SENTRY_AUTH_TOKEN', 'config.env.sentryAuthToken'],
    ] as const
  ).map(([name, labelKey]) =>
    defineSetting({
      default: '',
      editableBy: 'platform-admin',
      env: { mode: 'override', name },
      key: `env.${name}`,
      labelKey,
      redacted: true,
      scopes: ['platform'],
      storage: 'env-only',
      type: 'string',
      visibleTo: 'platform-admin',
    }),
  ),

  // ── env-only: boot-time and deployment-wide ───────────────────────────────
  // Read before a database connection exists, or structurally coupled across
  // the client/server boundary (`src/lib/sync-config.ts`). Not secret, but not
  // runtime-changeable either. `restartRequired` is redundant for these — they
  // cannot be changed at all — so it is left off.
  ...(
    [
      ['APP_URL', 'config.env.appUrl'],
      ['WS_PORT', 'config.env.wsPort'],
      ['WS_PUBLIC_URL', 'config.env.wsPublicUrl'],
      ['YJS_PORT', 'config.env.yjsPort'],
      ['YJS_PUBLIC_URL', 'config.env.yjsPublicUrl'],
      ['UPLOAD_DIR', 'config.env.uploadDir'],
      ['TRUST_PROXY_HEADERS', 'config.env.trustProxyHeaders'],
      ['GRAPHQL_ALLOWED_ORIGINS', 'config.env.graphqlAllowedOrigins'],
      ['SMTP_HOST', 'config.env.smtpHost'],
      ['SMTP_PORT', 'config.env.smtpPort'],
      ['SMTP_USER', 'config.env.smtpUser'],
      ['SMTP_SECURE', 'config.env.smtpSecure'],
      ['COLLAB_ENABLED', 'config.env.collabEnabled'],
    ] as const
  ).map(([name, labelKey]) =>
    defineSetting({
      default: '',
      editableBy: 'platform-admin',
      env: { mode: 'override', name },
      key: `env.${name}`,
      labelKey,
      scopes: ['platform'],
      storage: 'env-only',
      type: 'string',
      visibleTo: 'platform-admin',
    }),
  ),
];

/** Registry indexed by key. Built once at module load. */
const BY_KEY = new Map<string, SettingDefinition>(SETTINGS.map(s => [s.key, s]));

/** Look up a knob, or `undefined` if the key is not declared. */
export function getSetting(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

/** Every declared key. */
export function settingKeys(): string[] {
  return [...BY_KEY.keys()];
}

/** Knobs a UI should render for a scope — declared there, stored, not retired. */
export function settingsForScope(scope: SettingScope): SettingDefinition[] {
  return SETTINGS.filter(s => s.storage === 'db' && !s.deprecated && s.scopes.includes(scope));
}

/** The code default for a knob at a scope, honouring a per-scope default map. */
export function defaultForScope(definition: SettingDefinition, scope?: SettingScope): SettingValue {
  const d = definition.default;
  if (typeof d === 'object') {
    if (scope && d[scope] !== undefined) {
      return d[scope] as SettingValue;
    }
    // Fall back to the highest-precedence scope that declares one, so a knob
    // whose map omits the requested scope still has a defined answer.
    for (const s of [...SCOPE_ORDER].reverse()) {
      if (d[s] !== undefined) {
        return d[s] as SettingValue;
      }
    }
    throw new Error(`Setting ${definition.key} has an empty default map`);
  }
  return d;
}

/**
 * The declared code default for a key, for the handful of places that need it
 * without a resolver — error messages that quote the limit generically, and
 * the exported constants services still publish for their tests.
 *
 * Throws on an unknown key, which makes a typo a module-load failure rather
 * than a silent `undefined` at the point of use.
 */
export function settingDefault(key: string, scope?: SettingScope): SettingValue {
  const definition = getSetting(key);
  if (!definition) {
    throw new Error(`Unknown setting: ${key}`);
  }
  return defaultForScope(definition, scope);
}

/** `settingDefault` narrowed to number, for the numeric caps. */
export function numericSettingDefault(key: string, scope?: SettingScope): number {
  const value = settingDefault(key, scope);
  if (typeof value !== 'number') {
    throw new Error(`Setting ${key} is not numeric`);
  }
  return value;
}

export class InvalidSettingValueError extends Error {}

/**
 * Coerce and validate a value against its declaration.
 *
 * This is load-bearing rather than a nicety: `settings.value` is `Json`, so
 * unlike a typed column the database checks nothing. Every write goes through
 * here, and it is the only thing standing between a typo and a knob that
 * bricks a feature.
 */
export function validateSettingValue(definition: SettingDefinition, raw: unknown): SettingValue {
  const { bounds, enumValues, key, type } = definition;

  if (type === 'boolean') {
    if (typeof raw !== 'boolean') {
      throw new InvalidSettingValueError(`${key} must be a boolean`);
    }
    return raw;
  }

  if (type === 'int' || type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (typeof raw !== 'number' && typeof raw !== 'string') {
      throw new InvalidSettingValueError(`${key} must be a number`);
    }
    if (!Number.isFinite(n)) {
      throw new InvalidSettingValueError(`${key} must be a finite number`);
    }
    if (type === 'int' && !Number.isInteger(n)) {
      throw new InvalidSettingValueError(`${key} must be an integer`);
    }
    if (bounds && (n < bounds.min || n > bounds.max)) {
      throw new InvalidSettingValueError(`${key} must be between ${bounds.min} and ${bounds.max}`);
    }
    return n;
  }

  if (type === 'enum') {
    if (typeof raw !== 'string' || !enumValues?.includes(raw)) {
      throw new InvalidSettingValueError(`${key} must be one of: ${enumValues?.join(', ') ?? ''}`);
    }
    return raw;
  }

  if (typeof raw !== 'string') {
    throw new InvalidSettingValueError(`${key} must be a string`);
  }
  return raw;
}

/**
 * Parse a value that came from an environment variable, which is always a
 * string. Returns `null` when the variable is unset, empty, or malformed —
 * env is a *layer*, and a bad value falls through to the layer below rather
 * than throwing, so one typo cannot stop the process from booting.
 */
export function parseEnvValue(
  definition: SettingDefinition,
  raw: string | undefined,
): SettingValue | null {
  if (raw === undefined || raw === '') {
    return null;
  }
  if (definition.type === 'boolean') {
    const v = raw.trim().toLowerCase();
    if (v === '1' || v === 'true') {
      return true;
    }
    if (v === '0' || v === 'false') {
      return false;
    }
    return null;
  }
  try {
    return validateSettingValue(definition, raw);
  } catch {
    return null;
  }
}

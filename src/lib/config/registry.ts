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

import { DEFAULT_APP_NAME } from '../app-config';
import { DECIMAL_RE, ENV_DEFAULTS, isEnvFlagSet, SAMPLE_RATE_BOUNDS } from '../env-defaults';
import {
  SCOPE_ORDER,
  type SettingDefinition,
  type SettingRole,
  type SettingScope,
  type SettingValue,
} from './types';

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

  // ── Branding ──────────────────────────────────────────────────────────────
  // The knob this whole system was built for: renaming the product used to
  // need a rebuild, because `NEXT_PUBLIC_APP_NAME` is inlined by `next build`.
  //
  // Declared and then *removed* on the first pass, because wiring only the
  // server-rendered surfaces would have renamed transactional emails and the
  // PWA manifest while the sidebar still said Bilinear — a knob that renames
  // some of the product is worse than one that renames none of it. It is back
  // now that every consumer reads one resolved value: the root layout resolves
  // it once per request and hands it to `BrandingProvider`, and the surfaces
  // outside React (metadata, manifest, email) call `getAppName()` directly.
  //
  // `visibleTo: 'platform-admin'` even though every member sees the name.
  // `visibleTo` governs the *settings API*, and the knob is platform-scoped —
  // `resolveScopeId` refuses platform scope to anyone else, so `'member'` here
  // would have granted nothing and read as a promise the API cannot keep.
  // Members get the name from `BrandingProvider`, resolved server-side in the
  // root layout, which needs no read permission at all.
  defineSetting({
    default: DEFAULT_APP_NAME,
    editableBy: 'platform-admin',
    env: { mode: 'default', name: 'NEXT_PUBLIC_APP_NAME' },
    key: 'branding.appName',
    labelKey: 'config.branding.appName',
    scopes: ['platform'],
    storage: 'db',
    type: 'string',
    visibleTo: 'platform-admin',
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
  // env-only: read once at module load by the Apollo access-log plugin
  // (`src/app/api/graphql/route.ts`). Making it dynamic would put a config
  // read in the logging path of every request to buy a knob whose whole
  // purpose is to reduce per-request work.
  defineSetting({
    // The bounds come from the shared module, not a second literal: this pair
    // is the one that already drifted, and `parseSampleRate` enforcing one
    // range while the console advertised another is the failure being closed.
    bounds: SAMPLE_RATE_BOUNDS,
    default: 1,
    editableBy: 'platform-admin',
    env: { mode: 'override', name: 'LOG_HTTP_SAMPLE_RATE' },
    key: 'log.httpSampleRate',
    labelKey: 'config.log.httpSampleRate',
    restartRequired: true,
    scopes: ['platform'],
    storage: 'env-only',
    type: 'number',
    visibleTo: 'platform-admin',
  }),

  // ── Security ──────────────────────────────────────────────────────────────
  // Deliberately `env-only`, not merely `override`.
  //
  // These are not tunables; they are the guards protecting the server from its
  // own tenants — the SSRF screen on webhook delivery, and whether brute-force
  // protection survives a Redis outage. A database-storable kill switch means
  // a compromised platform-admin session can disable SSRF protection with a
  // mutation, which is a materially worse failure than the redeploy it saves.
  // §5 of docs/CONFIG_ASSESSMENT.md says such caps should never be tenant
  // editable; env-only is the honest expression of that, and it loses nothing
  // — ALLOW_PRIVATE_WEBHOOK_URLS exists for local development, where setting an
  // environment variable is already the workflow.
  defineSetting({
    default: false,
    editableBy: 'platform-admin',
    env: { mode: 'override', name: 'ALLOW_PRIVATE_WEBHOOK_URLS' },
    key: 'security.allowPrivateWebhookUrls',
    labelKey: 'config.security.allowPrivateWebhookUrls',
    scopes: ['platform'],
    storage: 'env-only',
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
    storage: 'env-only',
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
      // Half a credential in practice: an IAM access-key id on SES, the
      // literal 'apikey' paired with a secret on SendGrid. Presence is the
      // useful signal; the value is not worth echoing back.
      ['SMTP_USER', 'config.env.smtpUser'],
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
  //
  // The third tuple element is the value the CODE falls back to when the
  // variable is unset. Declaring it matters: with a blanket `''` the console
  // reported `env.SMTP_PORT` as empty while mail was going out on 587, which is
  // exactly the kind of confident-and-wrong answer a configuration console
  // exists to eliminate. The ones `env.ts` also states come from the shared
  // `ENV_DEFAULTS` rather than being restated here — this file cannot import
  // `src/server/`, so the constants live in `src/lib/env-defaults.ts`.
  ...(
    [
      ['APP_URL', 'config.env.appUrl', ENV_DEFAULTS.APP_URL],
      ['WS_PORT', 'config.env.wsPort', String(ENV_DEFAULTS.WS_PORT)],
      ['WS_PUBLIC_URL', 'config.env.wsPublicUrl', ''],
      ['YJS_PORT', 'config.env.yjsPort', String(ENV_DEFAULTS.YJS_PORT)],
      ['YJS_PUBLIC_URL', 'config.env.yjsPublicUrl', ''],
      ['UPLOAD_DIR', 'config.env.uploadDir', './uploads'],
      ['TRUST_PROXY_HEADERS', 'config.env.trustProxyHeaders', ''],
      ['GRAPHQL_ALLOWED_ORIGINS', 'config.env.graphqlAllowedOrigins', ''],
      ['SMTP_HOST', 'config.env.smtpHost', ''],
      ['SMTP_PORT', 'config.env.smtpPort', String(ENV_DEFAULTS.SMTP_PORT)],
      ['SMTP_SECURE', 'config.env.smtpSecure', ''],
      ['COLLAB_ENABLED', 'config.env.collabEnabled', ''],
    ] as const
  ).map(([name, labelKey, fallback]) =>
    defineSetting({
      default: fallback,
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

/**
 * Role authority, lowest first. The three levels are ordinal — an org admin can
 * do anything a member can — so comparisons are rank comparisons, not equality.
 */
const ROLE_RANK: Record<SettingRole, number> = {
  member: 0,
  'org-admin': 1,
  'platform-admin': 2,
};

/**
 * Does `actual` meet or exceed the authority `required` demands?
 *
 * Lives here rather than in the settings resolver because `ConfigService` needs
 * the same predicate for its own write guard, and two copies of an ordinal
 * comparison is exactly how a privilege check drifts.
 */
export function satisfiesRole(actual: SettingRole, required: SettingRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** Registry indexed by key. Built once at module load. */
const BY_KEY = new Map<string, SettingDefinition>(SETTINGS.map(s => [s.key, s]));

/** Look up a knob, or `undefined` if the key is not declared. */
export function getSetting(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

/**
 * Knobs a UI should render for a scope: declared there and not retired.
 *
 * Includes `env-only` knobs deliberately. They cannot be *written* —
 * `assertWritable` refuses, and they resolve `locked: true` so the control
 * renders read-only and names the variable — but the console exists to answer
 * "why is it behaving like that here", and the answer is frequently "an
 * environment variable". Filtering them out here was what made the
 * lock-and-redaction states in `SettingRow` unreachable, and left twenty-five
 * `config.env.*` labels and an entire "Environment" section declared and never
 * rendered. See CONFIG_ASSESSMENT §4.4: *every* knob, with redacted ones
 * showing name and presence only.
 */
export function settingsForScope(scope: SettingScope): SettingDefinition[] {
  return SETTINGS.filter(s => !s.deprecated && s.scopes.includes(scope));
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
function settingDefault(key: string, scope?: SettingScope): SettingValue {
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

export class InvalidSettingValueError extends Error {
  constructor(message: string) {
    super(message);
    // Set explicitly because `instanceof` is not reliable for this particular
    // class — see `isInvalidSettingValueError`.
    this.name = 'InvalidSettingValueError';
  }
}

/**
 * Recognise a validation failure **without** relying on `instanceof`.
 *
 * This module is deliberately importable from both the browser and the server,
 * and the bundler takes that literally: `src/lib/config` is emitted into the
 * SSR chunk (client components render forms from the registry) *and* reachable
 * from the server chunk that holds the GraphQL resolvers. Two copies means two
 * class identities, so the resolver's `instanceof` check compared a value
 * thrown by one copy against the constructor of the other and quietly said no.
 *
 * The visible symptom was a platform admin typing an out-of-range number and
 * getting "Internal server error" instead of the bounds message — the error was
 * built correctly, mapped as unrecognised, and masked by Apollo. Unit tests
 * cannot see it: under Vitest there is only ever one copy of the module.
 *
 * `name` is stable across copies, so it is what the check keys on. The
 * `instanceof` arm stays first because it is exact when it does apply.
 */
export function isInvalidSettingValueError(err: unknown): err is InvalidSettingValueError {
  return (
    err instanceof InvalidSettingValueError ||
    (err instanceof Error && err.name === 'InvalidSettingValueError')
  );
}

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
    if (typeof raw !== 'number' && typeof raw !== 'string') {
      throw new InvalidSettingValueError(`${key} must be a number`);
    }
    // A strict decimal parse rather than bare `Number()`, which happily accepts
    // '0x10' as 16, '' as 0 and '  7  ' as 7. Those are not values a form or an
    // env var is ever meant to submit, and '' → 0 was caught only by the bounds
    // happening to start at 1 — a fragile place for that guarantee to live.
    //
    // Exponent notation IS accepted: `1e-3` is a decimal number by any ordinary
    // reading, and rejecting it made this parser disagree with `sampleRateEnv`
    // over `LOG_HTTP_SAMPLE_RATE=1e-3` — the console reporting 1 while the
    // process sampled 0.001. `parseSampleRate` is the shared arbiter now, and
    // `registry.test.ts` asserts the two agree.
    if (typeof raw === 'string' && !DECIMAL_RE.test(raw.trim())) {
      throw new InvalidSettingValueError(`${key} must be a decimal number`);
    }
    const n = typeof raw === 'number' ? raw : Number(raw.trim());
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
    // Only the literal string '1' is true; everything else is false.
    //
    // `isEnvFlagSet` is the same predicate `boolEnv` uses, imported rather than
    // restated: this pair has already drifted once, and the comment asking the
    // next person to keep them in step is what failed. `registry.test.ts` pins
    // the convention itself, so widening it turns that red too.
    return isEnvFlagSet(raw);
  }
  try {
    return validateSettingValue(definition, raw);
  } catch {
    return null;
  }
}

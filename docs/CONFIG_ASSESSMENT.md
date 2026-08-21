# Configuration System — Assessment

**Status: implemented.** This began as an assessment and is now the design
record for a system that ships. Sections 1–3 describe the state of the code
*before* the work and are kept in the past tense they were written in — they are
the evidence for the decisions, not a description of the code today. Sections
4–8 describe what was built, with the places implementation diverged from the
proposal called out inline.

Where to look in the code:

| Piece | Lives in |
| ----- | -------- |
| Registry (declarations, validation) | `src/lib/config/` |
| Resolver, cache, invalidation, writes | `src/server/config/` |
| GraphQL surface | `src/server/graphql/resolvers/setting.ts` |
| Storage | `Setting` model in `prisma/schema.prisma` |
| Admin console | `src/app/(admin)/admin/config/` |
| Real-Postgres verification | `yarn db:verify:config` |

Originally written to answer one question: *what would it take to give this app
a single, coherent configuration system that admins (and other roles) can drive
from the UI, instead of the five disconnected mechanisms it had?*

Four design questions were settled in review on 2026-08-18 — scope model,
storage shape, who edits plan limits, and env-vs-database precedence. They are
recorded with their reasoning in [§7](#7-decisions-taken-2026-08-18); what
implementation changed is in [§8](#8-what-implementation-changed), what two
review passes over the built system changed is in §8.1, and what is still open
is in [§9](#9-still-open).

The design was then put through an adversarial review, which changed it in
four material ways: the env `seed` mode was dropped (it made the resolver
write), redaction was added because "show the env var and its value" would have
turned `/admin/config` into a secrets endpoint, propagation became a per-scope
matrix (a user-scope SyncAction would fan a user's preferences out to the whole
org), and the config reader moved out of the GraphQL context because the WS and
YJS processes have none. D1's conclusion survived but its reasoning did not —
see §7-D1.

Scope: every value that changes app behaviour without changing user data —
environment variables, feature flags, plan-tier caps, tunables, defaults, and
per-user preferences.

---

## 1. Executive summary

The app has **five independent configuration mechanisms** with no shared
vocabulary, no shared read path, no shared audit trail, and no shared UI:

| # | Layer | Where it lives | Who can change it | Reaches the UI? |
| - | ----- | -------------- | ----------------- | --------------- |
| 1 | Environment variables | `.env` / container env | whoever can redeploy | partly |
| 2 | Org config columns | `organizations.*` | platform admin (5 of 13), org admin (1 of 13) | partly |
| 3 | Team config columns | `teams.*` | team admin (13 of 27) | partly |
| 4 | Code constants | `src/**/*.ts` module scope | nobody — requires a release | no |
| 5 | User preferences | `users.*` + cookies | the user | yes |

The headline numbers:

- **68 environment variables** documented in `.env.example`; **11** of them are
  read through the one typed accessor that exists (`src/server/lib/env.ts`),
  the rest are read as raw `process.env.X` at 20+ scattered call sites.
- **~65 behavioural constants** hardcoded in module scope, mostly across
  `src/server/**` — rate limits, retry policy, timeouts, retention windows,
  token lifetimes, sweep intervals, payload caps. None is configurable at
  runtime by anyone.
- **13 org-level config columns** exist. **5** are editable (platform-admin
  console only). **1** is editable by an org admin. **7 are dead** — the column
  exists, nothing reads it. (5 + 1 + 7 = 13.)
- **27 team-level config columns** exist. **13** are reachable from
  `TeamUpdateInput`, **4** are read by code but settable only in the DB, **8
  are dead**, and **2** are read in exactly one place each.
  (13 + 4 + 8 + 2 = 27.)
- **The three platform-admin config writes have no propagation path** — see
  §3-F1. Org- and team-scoped writes are fine.

Three ingredients already exist and are well-built: `src/server/lib/env.ts`
(typed, validated env accessors), the `Organization.max*` plan-limit columns
with bounds validation and a platform-admin editor, and `src/lib/plan-limits.ts`
(a declarative field registry already shared by two UIs). The registry and the
UI layer are largely generalisations of those three.

**The rest is genuinely new infrastructure, and three constraints found in
adversarial review are what make it so.** Each is load-bearing on the design,
not a detail:

- **Config propagation is not one mechanism.** `createSyncAction` is org-keyed
  and fans out to every client in the org, so a user-scope write would
  broadcast one person's preferences to the whole workspace. Propagation
  becomes a per-scope matrix, and per-user targeted delivery is a capability
  the WS server does not have today (§4.3).
- **The config reader cannot live in the GraphQL context.** The WS and YJS
  servers are separate processes with no request, and they consume exactly the
  knobs being made configurable. That forces a standalone `ConfigService` with
  its own Redis channel and a TTL backstop (§4.3).
- **Exposing configuration means exposing secrets unless designed not to.**
  The registry covers all 68 env vars including `JWT_SECRET` and `SMTP_PASS`,
  so redaction is a required field, not a refinement (§4.2).

**Cost of not building it.** F1–F7 are present-tense defects, not risks: every
new knob keeps landing in whichever of the five mechanisms is nearest, dead
config keeps accumulating (15 columns so far), and the ~65 constants stay
release-only — which is what makes an incident-time change a deploy.

**Definition of done.** F1–F7 closed; every knob reachable from one registry;
no config read via raw `process.env` outside `env.ts`; and every config write
audited and propagated by construction rather than per call site.

---

## 2. Inventory

### 2.1 Layer 1 — Environment variables

`.env.example` documents 68 vars. They are not one thing; they fall into five
groups with very different mobility, and the file does not distinguish them:

**(a) Secrets and connection strings — must stay in env.** `DATABASE_URL`,
`REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `GOOGLE_CLIENT_SECRET`,
`GITHUB_CLIENT_SECRET`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`,
`SMTP_PASS`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SENTRY_AUTH_TOKEN`.
These correctly belong to the deployment, not the database. ~12 vars.

**(b) Boot-time / process-level — must stay in env.** `WS_PORT`, `YJS_PORT`,
`APP_URL`, `NODE_ENV`, `UPLOAD_DIR`, `TRUST_PROXY_HEADERS`,
`GRAPHQL_ALLOWED_ORIGINS`. Read before a DB connection exists, or govern the
process itself. 7 vars.

**(c) Build-time `NEXT_PUBLIC_*` — the trap.** `NEXT_PUBLIC_APP_NAME`,
`NEXT_PUBLIC_WS_PORT`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_COLLAB_ENABLED`,
`NEXT_PUBLIC_YJS_SERVER_URL`, `NEXT_PUBLIC_SENTRY_DSN`. These are **inlined by
`next build`**, so a deployment running the published container image cannot
set them at all. The codebase already discovered this and worked around it
twice — `WS_PUBLIC_URL`, `YJS_PUBLIC_URL` and `COLLAB_ENABLED` are
request-time runtime counterparts added specifically because the
`NEXT_PUBLIC_*` spellings were unreachable for prebuilt images (see the doc
comments in `src/server/lib/env.ts`). `NEXT_PUBLIC_APP_NAME` — the product's
display name, the single most likely thing an operator wants to change —
**still has no runtime counterpart**. Changing the app name currently requires
a rebuild.

**(d) Operational tunables that have no business being in env.**
`LOG_LEVEL`, `LOG_PRETTY`, `LOG_HTTP_SAMPLE_RATE`,
`AUTH_RATE_LIMIT_FAIL_CLOSED`, `ALLOW_PRIVATE_WEBHOOK_URLS`, `AI_PROVIDER`,
`ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `OPENAI_MODEL`, `OPENAI_BASE_URL`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SECURE`. Every one of these is a
policy decision an operator might want to change without a redeploy — turning
log sampling down during an incident, switching AI model, pointing SMTP at a
different relay. ~14 vars. **This is the primary migration target.**

**(e) Deployment-orchestration vars the app never reads.** `APP_IMAGE`,
`APP_PORT`, `POSTGRES_*`, `TRAEFIK_NAME`, `DOMAIN_APP`, `WATCHTOWER_*`,
`COMPOSE_PROFILES`, `DATABASE_URL_OVERRIDE`, `REDIS_PASSWORD`. These are
docker-compose inputs, not application config, and they sit in the same file
with no separation. ~11 vars.

**Documentation drift found:**

- `WS_PORT_PUBLISHED` and `YJS_PORT_PUBLISHED` are consumed by
  `docker-compose*.yml` but appear **nowhere** in `.env.example`.
- `DEBUG`, `NO_COLOR`, `PRISMA_CLIENT_GET_TIME`, `PRISMA_DISABLE_WARNINGS` are
  documented in `.env.example` as if they were app knobs. The app never reads
  any of them — they are third-party library vars. Noise in the one file
  operators are told to read.
- `NEXT_RUNTIME` is documented as something to set; it is set *by* Next.js and
  read in `src/instrumentation.ts:2` to choose which Sentry config to import
  (the Sentry config files never read it themselves). Documenting it as an
  input invites someone to set it wrongly.

**Structural note.** `src/server/lib/env.ts` is a genuinely good module —
typed getters, present-but-malformed values throw with an actionable message,
missing values fall back so `next build` still works without secrets. It
covers **11 of 68** vars (`ALLOW_PRIVATE_WEBHOOK_URLS`, `APP_URL`,
`AUTH_RATE_LIMIT_FAIL_CLOSED`, `COLLAB_ENABLED`, `LOG_HTTP_SAMPLE_RATE`,
`SMTP_PORT`, `TRUST_PROXY_HEADERS`, `WS_PORT`, `WS_PUBLIC_URL`, `YJS_PORT`,
`YJS_PUBLIC_URL`). Being in `env.ts` is orthogonal to being runtime-editable:
several group (d) tunables below already read through it and are still
redeploy-only. Everything else is a bare `process.env.X` read. One
side effect: because the accessor takes the name as a string
literal (`numericEnv('SMTP_PORT', …)`), a naive `grep process.env.SMTP_PORT`
finds nothing — so the migration itself has made some vars *harder* to trace.
A registry (§4.1) fixes that permanently.

### 2.2 Layer 2 — Organization config columns (13)

| Column | Read by | Editable by |
| ------ | ------- | ----------- |
| `aiEnabled` | `ai.service.ts` | org owner/admin, via `aiSettingsUpdate` |
| `maxCustomFieldsPerTeam` | `custom-field.service.ts` | platform admin |
| `maxCustomFieldsPerOrg` | `custom-field.service.ts` | platform admin |
| `maxLabelGroupChildren` | `label.service.ts` | platform admin |
| `maxInitiativeDepth` | `initiative.service.ts` | platform admin |
| `maxExportRows` | `import.service.ts` | platform admin |
| `roadmapEnabled` | **nothing** (exposed in SDL + `db.ts`, gates nothing) | nobody |
| `customersEnabled` | **nothing** | nobody |
| `initiativesEnabled` | **nothing** | nobody |
| `fiscalYearStartMonth` | **nothing** | nobody |
| `securitySettings` (Json) | **nothing** (only stripped from sync payloads) | nobody |
| `authSettings` (Json) | **nothing** (only stripped from sync payloads) | nobody |
| `themeSettings` (Json) | **nothing** | nobody |

Seven of thirteen are inert. Three of those are `Json` blobs with no schema,
no reader, and no writer. Two of the three (`authSettings`,
`securitySettings`) already made it into the sync-payload omit list
(`src/server/services/sync.service.ts:37`) and the client's belt-and-braces
strip (`src/lib/sync-manager.ts:867-869`) — load-bearing in the *plumbing*
while carrying no data.

`themeSettings` is in neither list, so it already syncs to every client
unstripped. That is harmless only because it is always `null` today; the
moment anything writes to it, an org-wide broadcast ships it to every member.
Whatever is decided about these three columns (§9-2), `themeSettings` should
either join the omit list or be dropped — leaving a schemaless, unstripped
blob on the synced Organization row is a trap set for whoever fills it in.

`roadmapEnabled` is the sharpest case: it is a non-null field in the GraphQL
SDL (`schema.ts:46`), it is typed into the client's IndexedDB row
(`src/lib/db.ts:13`), it syncs to every client — and no code branches on it.
The public-roadmap feature is gated by `PublicRoadmap.enabled`
(`prisma/schema.prisma:1171`), checked in `resolvers/roadmap.ts:90-95` — a
`PublicRoadmap` row can exist and still be disabled. Two booleans named for
the same feature, and the org-level one is the inert one.

The five `max*` columns are the model to copy. They were introduced with the
explicit intent recorded in the schema: *"data-driven so a future admin UI can
raise/lower them per org without a code change. Until that UI ships, these are
only settable directly in the DB."* The UI did ship — in the platform-admin
console only.

**Missing entirely: there is no `organizationUpdate` mutation.** An org
owner cannot rename their own workspace, change its URL key, or set a logo
from the app. `logoUrl` is a column, is in the SDL, is returned by resolvers,
and has no writer.

### 2.3 Layer 3 — Team config columns (27)

Counting the `Team` model's non-bookkeeping columns (`prisma/schema.prisma:291-346`,
excluding `id`, `organizationId`, `key`, `displayName`, `issueCount`,
`retiredAt`, `createdAt`, `updatedAt`, `archivedAt`) gives 27, in four groups:

**Reachable from `TeamUpdateInput` (13)** — `name`, `description`, `icon`,
`color`, `private`, `timezone`, `cyclesEnabled`, `cycleDuration`,
`issueEstimationType`, `triageEnabled`, `autoClosePeriod`, `autoArchivePeriod`,
`parentId`. Matches the SDL input exactly (`src/server/graphql/schema.ts:440-454`).

**Read by code but not settable through the API (4)** — `upcomingCycleCount`
(`cycle.service.ts:615`), `autoCloseChildIssues` and `autoCloseParentIssues`
(the `issue.service.ts` terminal-state cascade), and `defaultIssueStateId`.
These are live knobs an admin can only change with `psql`.

**Read in exactly one place each (2)** — `cycleCooldownTime`
(`cycle.service.ts:617`) and `cycleStartDay` (`cycle.service.ts:638`), both off
a single `select` at `cycle.service.ts:602-604`. Live, but neither exposed nor
dead.

**Dead — nothing in `src/` reads them (8)** — `cycleLockToActive`,
`cycleAutoAssignStarted`, `cycleAutoAssignCompleted`, `autoCloseStateId`,
`issueEstimationExtended`, `issueEstimationAllowZero`, `defaultIssueEstimate`,
`joinByDefault`. Each appears only in `src/test/fixtures.ts` — not even in the
GraphQL SDL.

So of 27 team knobs: **13 exposed, 6 live-but-hidden** (the 4 unsettable plus
the 2 read-once)**, 8 dead**. Four of the 13 (`name`, `description`, `icon`,
`color`) are identity, not configuration; excluding them gives 9 genuinely
configurable knobs exposed out of 23.

### 2.4 Layer 4 — Code constants (~65, none configurable)

These are the values an operator most often actually wants to change during an
incident, and none of them can be changed without a release:

**Rate limiting** (`src/server/middleware/rate-limit.ts`) — `WINDOW_SECONDS`
3600, `REQUEST_LIMIT` 5000, `HOURLY_COMPLEXITY_BUDGET` 250 000,
`MAX_SINGLE_COMPLEXITY` 10 000, plus the auth-mutation limits (5/hr/email
login, 20/hr/IP, 10/15min verify, 50/15min IP) written inline in
`checkAuthMutationLimit`.

**Auth / token lifetimes** — `REFRESH_TOKEN_DAYS` 30 (`jwt.ts:10`) and
`ACCESS_TOKEN_EXPIRY_SECONDS` 86 400 (`jwt.ts:133`, imported by
`auth.service.ts`); `MAGIC_LINK_EXPIRY_MINUTES` 15 and
`REFRESH_GRACE_PERIOD_MINUTES` 30 (`auth.service.ts:19-20`);
`INVITE_EXPIRY_DAYS` 7, `MAX_PENDING_INVITES` 200
(`organization-invite.service.ts:17,24`).

**Webhooks** (`webhook.service.ts`) — `MAX_ATTEMPTS` 5, `AUTO_DISABLE_AFTER`
20 consecutive failures, `REQUEST_TIMEOUT_MS` 10 000. Retry sweep cadence
`WEBHOOK_RETRY_INTERVAL_MS` 30 000 lives in `ws/index.ts`.

**Sync / realtime** (`src/lib/sync-config.ts`) — `DELTA_PAGE_SIZE` 5000,
`SYNC_ACTION_RETENTION_DAYS` 30, `SYNC_ACTION_PRUNE_INTERVAL_MS` 1h,
`WS_PING_INTERVAL_MS` 30s, `WS_PONG_TIMEOUT_MS`, `WS_HEARTBEAT_CLIENT_TIMEOUT_MS`
75s, `WS_BROADCAST_COALESCE_MS` 50ms, `MAX_BUFFERED_BYTES` 1 MB
(`connection-manager.ts`). **Note:** this file is deliberately dependency-free
and shared across the client/server boundary; several of its values must stay
identical on both sides. Any config system must treat it as a special case —
see §5.

**Payload / input caps** (`src/server/lib/limits.ts`) — `DEFAULT_LIST_LIMIT`
50, `MAX_LIST_LIMIT` 200, `MAX_BULK_OPERATION` 200, `MAX_RICH_TEXT_LENGTH`
100 000, `MAX_WEBHOOK_NAME_LENGTH` 256, `MAX_EMOJI_LENGTH` 32. Plus
`MAX_TITLE_LENGTH` 512 (`issue.service.ts`), `MAX_FILE_SIZE` 25 MB
(`api/upload/route.ts`), `PASTE_INLINE_LIMIT` 2 MB (`tiptap-editor.tsx`),
`MAX_IMPORT_ROWS` 500 (`import.service.ts` — note this one was **not** given a
per-org column while its sibling `MAX_EXPORT_ROWS` was).

**Background jobs** (`ws/index.ts`, `yjs/server.ts`) —
`CYCLE_ROLLOVER_INTERVAL_MS` 5min, `REAUTH_SWEEP_INTERVAL_MS` 60s (defined
twice, in two files, with the same value).

**Integrations** — `CLOCK_SKEW_MS` 60s and `MAX_REPLAY_CACHE_SIZE` 10 000
(`saml.service.ts`), `MAX_REQUEST_AGE_SECONDS` 300 (`slack.service.ts`),
`BOOTSTRAP_PROJECT_UPDATES_PER_PROJECT` 50 / `_TOTAL` 1000 (`sync.service.ts`).

**Defaults with no override** — `DEFAULT_WORKFLOW_STATES` (`team.service.ts`),
`defaultLocale` `'en'` (`i18n/index.ts`), default accent, the AI system prompts
and `maxTokens` in `ai.service.ts`.

Where a per-org column *was* added, the constant was correctly kept as the
fallback (`org?.maxInitiativeDepth ?? MAX_INITIATIVE_DEPTH`). That two-tier
read is the right pattern and generalises cleanly.

### 2.5 Layer 5 — User preferences

`users.locale`, `users.accent`, `users.timezone`,
`users.emailNotificationsEnabled`, plus the `locale`/`accent` cookies the
session route seeds from those columns. This layer is the only one that
actually works end to end: persisted, editable from the UI, follows the
account across devices, with a documented cookie-seeding rationale.

Gap: notification preferences are a single boolean. There is no per-event-type
control, no digest schedule, no quiet hours — and `NotificationSubscription`
is per-entity, not per-preference.

---

## 3. Cross-cutting findings

**F1 — Platform-admin config changes do not propagate.** Org- and team-scoped
config writes are fine: `aiSettingsUpdate` (`resolvers/organization.ts:96-102`)
and `teamUpdate` (`resolvers/team.ts:182-184`) both emit a SyncAction. The gap
is the platform-admin console — `updateTenantLimits`, `suspendTenant` and
`restoreTenant` (`platform-admin.service.ts`) write to `organizations` and emit
nothing, in neither the service nor its resolver. A platform admin raising a
cap, or suspending a tenant, is invisible to every open client until reload.
This is a direct violation of the repo's own stated invariant ("Every mutation
creates a SyncAction").

Two caveats that matter for the fix (§6 Phase 0). The `max*` limits are not in
the synced `DBOrganization` shape (`src/lib/db.ts:6-16`), so adding a SyncAction
to `updateTenantLimits` alone would change nothing for any client — the payload
and the client type would have to grow too. `suspendedAt` is likewise absent,
and that one is the more serious of the two: a suspended tenant's open clients
carry on as if nothing happened.

**F2 — No audit trail for configuration.** `AuditLogEntry` and
`PlatformAuditLog` exist and the platform-admin resolver does log limit edits.
But `aiSettingsUpdate` does not, team-settings edits do not, and env changes
inherently cannot. "Who turned this off, and when" is unanswerable for most of
the surface.

**F3 — Config reads are unbatched per-request DB hits.** Each gate reads its
own column at the point of use: `ai.service.ts` selects `aiEnabled`,
`label.service.ts` selects `maxLabelGroupChildren`, `initiative.service.ts`
selects `maxInitiativeDepth`. Each is a separate round-trip. This is fine at
6 knobs and will not be fine at 60. A config system needs a per-request cache
(the GraphQL context already exists as the natural home) or a Redis-backed
snapshot with pub/sub invalidation — the Redis pub/sub channel is already
there for sync.

**F4 — No validation layer except for the 5 plan limits.**
`TENANT_LIMIT_BOUNDS` is exactly the right idea: min/max per key, whole update
rejected if any key is out of range, so an org can never be left partially
applied. Nothing else has it. Env vars get it only for the 11 in `env.ts`.

**F5 — Four-tier scoping exists implicitly but is never named.** Values
resolve platform → org → team → user, but there is no `resolve()` that
expresses it, no way to see the effective value and where it came from, and no
way to express "org sets a default, team may override within these bounds".
`upcomingCycleCount` is per-team, `maxExportRows` is per-org, and the reason
one is which is recorded only in a code comment.

**F6 — No dev-facing view of effective configuration.** There is no
`/admin/config`, no startup log of resolved settings, no diagnostic endpoint.
Debugging "why is this behaving like that here" means reading source.

**F7 — Dead config is a liability, not just clutter.** 7 org columns and 8
team columns exist with no reader. Someone will eventually set
`joinByDefault = true` in the DB, or read `roadmapEnabled: false` off the
GraphQL type and reasonably conclude the roadmap is off. Config that lies is
worse than config that is absent.

---

## 4. Proposed target architecture

Five pieces. Each is independently shippable and independently useful.

### 4.1 A single config registry (the keystone)

One declarative module — the source of truth for *every* knob, generalising
what `src/lib/plan-limits.ts` already does for five of them:

```ts
defineSetting({
  key: 'webhook.maxAttempts',
  scopes: ['platform', 'org'],     // ordered; a write to a scope not listed is rejected
  type: 'int',
  default: 5,                      // or a per-scope map: { platform: 5, org: 5 }
  bounds: { min: 1, max: 20 },
  storage: 'db',                   // 'db' | 'env-only'  (see §5)
  editableBy: 'platform-admin',    // role required to write
  visibleTo: 'org-admin',          // role required to read — genuinely a
                                   // separate field, see §7-D3
  env: { name: 'WEBHOOK_MAX_ATTEMPTS', mode: 'default' },  // see §4.2
  redacted: false,                 // true ⇒ never return the value, only presence
  labelKey: 'settings.webhook.maxAttempts',
  restartRequired: false,
})
```

Everything else derives from this one declaration: the TypeScript type of the
resolved config object, the validator, the GraphQL SDL fields, the admin UI
form rows (already the `PLAN_LIMIT_FIELDS` pattern), the i18n key list, the
`.env.example` generator, and the audit-log field names. Adding a knob becomes
one entry, not eight edits across the stack.

Critically, the registry also makes every knob **greppable by key from one
place** — fixing the traceability regression noted in §2.1.

Four fields carry more weight than they look:

- **`scopes` is a list, not a single scope.** A single value cannot express the
  model the product already has. Plan limits need a platform-scope row (the
  product-wide default a platform admin edits once) *and* an org-scope row (the
  per-tenant override), which is why `editableBy: 'platform-admin'` and
  `scopes: ['platform','org']` coexist without contradiction. The resolver
  rejects a write to a scope not in the list, so "settable at org and team but
  never per-user" is expressible.
- **`default` may be a per-scope map.** An org-level default and a team-level
  default for the same key are different things, and one scalar cannot hold
  both.
- **`storage: 'env-only'`** marks a knob that never has DB layers —
  secrets, ports, `DATABASE_URL`. It is never writable, never listed as
  editable, and §5's "deployment-wide, at boot" is expressed as
  `storage: 'env-only', scopes: ['platform']`. Without this field the registry
  has no way to say what §5 says in prose.
- **`redacted: true`** marks a knob whose value must never leave the server.
  Every secret is `storage: 'env-only', redacted: true`. §4.2 carries both the
  mechanism and why it is not optional.

**Resolution needs explicit ids.** `config.get(key, { orgId, teamId, userId })`
— not `ctx.config.get(key)` alone. A single request can touch several teams (a
bulk issue move), and the background jobs in the WS process have no request,
no team and no user at all. `ctx.config` exists as a thin wrapper bound to the
current request's own ids, but the underlying API always takes the scope
explicitly.

### 4.2 A layered resolver with an explicit precedence chain

```
code default  →  env  →  platform value  →  org value  →  team value  →  user value
```

`config.get('webhook.maxAttempts', { orgId })` resolves through the chain and
is memoised per request. Two properties matter:

- **Every layer is optional.** A knob with no org row resolves to the code
  default — which is exactly the `org?.maxInitiativeDepth ?? MAX_INITIATIVE_DEPTH`
  pattern already in use at four call sites (`initiative.service.ts:597`,
  `import.service.ts:224`, `label.service.ts:164`, `custom-field.service.ts:187-188`),
  generalised.
- **The resolver reports provenance.** `config.explain(key, ids)` returns the
  effective value *and* which layer supplied it. That is what makes §3-F6
  answerable and what makes the admin UI honest ("inherited from org" vs "set
  here").

Which layers a given key actually consults is its `scopes` list, not the full
chain — see §7-D1 for what `team` and `user` mean here, since neither is the
simple nesting the diagram suggests.

**Storage — decided (§7-D2): a single generic `settings` table.**

```
settings(scope_type, scope_id, key, value Json, updated_by, updated_at)
  @@unique([scope_type, scope_id, key])
  @@index([scope_type, scope_id])          -- load a whole scope in one read
```

Typed columns do not scale to 60+ knobs across four scopes, and every new knob
would be a migration. The registry supplies the type and bounds that the DB
column would otherwise have given us; `value` is `Json` so one table carries
ints, booleans, strings and enums without a column per shape.

Four consequences follow, one of them a genuine trap:

- **The DB no longer type-checks a value, so the registry must.** Every write
  goes through the registry's validator (§4.1 `type` + `bounds`) — there is no
  second line of defence like a `SmallInt` column. Reads must also tolerate a
  row whose stored shape no longer matches the registry (a knob whose type
  changed across a release): fall back to the next layer and log, never throw.
- **Platform-scope rows need a sentinel `scope_id`, not NULL.** This is the
  trap. Postgres unique indexes are `NULLS DISTINCT` by default, so
  `@@unique([scope_type, scope_id, key])` with `scope_id = NULL` constrains
  *nothing* — `('platform', NULL, 'webhook.maxAttempts')` can be inserted a
  thousand times and the resolver picks an arbitrary one, silently. Postgres 15+
  can express `UNIQUE NULLS NOT DISTINCT`, but Prisma's DSL cannot, so that
  route means hand-writing the index in the custom-constraints migration.
  Simpler: every id column in this schema is `@db.Uuid`, so use the all-zeroes
  UUID as the platform sentinel and keep `scope_id` non-null.
- **A polymorphic `scope_id` cannot carry a foreign key,** so it gets none of
  the `onDelete: Cascade` the rest of the schema relies on. Deleting an org,
  team or user leaves its config rows behind forever. Cleanup has to be
  explicit — a delete in the org/team/user delete paths, plus a periodic sweep
  alongside the existing `SYNC_ACTION_PRUNE` job as a backstop.
- **The `Organization.max*` columns get folded in, not kept in parallel.**
  During Phase 1 the resolver reads them as a layer so nothing has to migrate;
  Phase 2 copies them into `settings` rows and drops the columns. The GraphQL
  `OrganizationPlanLimits` type is unchanged throughout — the resolver serves
  the same SDL shape from the registry, so this is a storage move with no API
  break. Keeping both permanently would recreate the exact "two mechanisms, no
  shared read path" problem this whole exercise is meant to remove.

**Env precedence — decided (§7-D4): two modes.**

| Mode | Position in the chain | Use for |
| ---- | --------------------- | ------- |
| `default` (the default) | replaces the *code default*, below every DB layer | almost everything |
| `override` | sits **above every layer** | safety and infra knobs an operator must be able to force |

`default` is the chain exactly as drawn above, which is why it is the default:
setting an env var changes behaviour for anyone who has not explicitly
configured the knob, and an explicit setting always wins. `override` is the
deliberate exception — `ALLOW_PRIVATE_WEBHOOK_URLS`, `AUTH_RATE_LIMIT_FAIL_CLOSED`
and the security-invariant caps of §5 should be forceable from the deployment
no matter what any tenant has stored.

A third `seed` mode was proposed and **dropped** — see §7-D4 for why. Seeding
is a provisioning concern, not a resolver mode: `OrganizationService.create`
writes the seeded rows in the same transaction as the org, and the registry
marks them `seededAtCreation: true` purely as documentation.

Two rules make `override` safe:

1. **A knob whose effective value comes from an env override renders as locked
   in the admin UI, naming the env var.** `explain()` already returns
   provenance, so this is free — and without it `override` produces exactly the
   "I saved it and nothing happened" confusion that made this an open question.
2. **Naming the variable is not showing its value.** `explain()` returns the
   var name plus a presence boolean for any `redacted` knob, and never the
   value. Without this rule, "show the env var and its value" turns
   `/admin/config` into a secrets-disclosure endpoint for `JWT_SECRET`,
   `SMTP_PASS` and `ANTHROPIC_API_KEY` — the registry generates `.env.example`,
   so those *are* registry entries. `.env.example` generation emits
   documentation-only stanzas for them, never values.

Migration safety: every env var moved onto the registry in Phase 3 starts in
`default` mode, which reproduces today's behaviour bit for bit (env if set,
else the constant). Promotion to `override` is a separate, deliberate call
per knob.

### 4.3 Cache, invalidation, and propagation

Three processes read config, and only one of them serves GraphQL requests. This
is the part the naive design gets wrong.

**The reader is a standalone `ConfigService`, not the GraphQL context.**
`src/server/ws/index.ts` is a separate process with no GraphQL context: it
constructs `WebhookService` and `CycleService` directly and drives them on
`setInterval` (`ws/index.ts:408-435`). Those jobs consume precisely the knobs
this document proposes to make configurable — `MAX_ATTEMPTS` (the §4.1 headline
example), `AUTO_DISABLE_AFTER` and `REQUEST_TIMEOUT_MS`
(`webhook.service.ts:54-61`), and `Team.upcomingCycleCount` via cycle rollover.
`yjs/server.ts` likewise talks to Prisma with no context. So `ConfigService`
owns the snapshot and its own Redis subscription; `ctx.config` is a thin
per-request memo *over* it, not the primary cache.

**Invalidation runs on a dedicated `config:*` channel, subscribed
unconditionally at process start.** It cannot reuse the sync channel: the WS
server subscribes to `sync:<orgId>` on an org's *first* client connection and
unsubscribes on the last (`ws/index.ts:112,130`), so an org with zero connected
clients would never receive invalidation — while that same process is still
retrying its webhooks. A TTL on the snapshot is the backstop for a missed
message. Next.js also runs multiple server instances, each with its own
in-process snapshot, so the TTL is not optional.

**Propagation to clients is per-scope, and it is not one mechanism.**
`createSyncAction(orgId, …)` is org-keyed and `ws/index.ts:143` broadcasts to
*every* connected client in that org, so a single rule does not work:

| Scope | Propagation | Audit |
| ----- | ----------- | ----- |
| platform | no org channel exists — either a new non-org channel or an explicit per-tenant fan-out, whose cost must be acknowledged | `PlatformAuditLog` |
| org | SyncAction, as `aiSettingsUpdate` does today | `AuditLogEntry` |
| team | SyncAction, as `teamUpdate` does today | `AuditLogEntry` |
| user | **targeted delivery to that user's own sockets** | `AuditLogEntry` |

The user row is the one that must not be got wrong. Broadcasting a user-scope
config change org-wide hands every member of the org another user's
preferences. This codebase already learned that lesson once — hence
`SYNC_PAYLOAD_OMITTED_FIELDS` and its comment that "a SyncAction fans out to
every member" (`sync.service.ts:34-38`). A generic `settings` table recreates
exactly that hazard, and `visibleTo` does not save us: it is a *read-path* role
check that the broadcast path never consults. Targeted per-user delivery is a
capability `ConnectionManager` does not have today — new work, and it should be
budgeted as such.

Note also that `AuditLogEntry` is org-scoped, so platform-scope writes belong
in `PlatformAuditLog`, which the platform-admin resolver already uses
(`platform-admin.ts:42-56`).

**The client half needs storage too.** `CLAUDE.md` forbids components reading
GraphQL directly — they read MobX stores. So a config store and a Dexie table
are part of this work, not an afterthought; §4.4's "inherited value shown
greyed" has to read from somewhere.

### 4.4 UI

- `/admin/config` — platform-admin console: every knob, grouped, with
  effective value + provenance + bounds. Extends the existing tenant editor.
  Redacted knobs show name and presence only.
- `/[workspace]/settings/*` — org-admin view: knobs whose `editableBy` the
  caller satisfies, rendered from the same registry, with inherited values
  shown greyed and a "reset to inherited" action.
- Team settings — same component, team scope, closing the live-but-hidden team
  knobs from §2.3.

One form component driven by the registry, three mount points. This is
literally what `PLAN_LIMIT_FIELDS` already does across two pages.

### 4.5 Lifecycle, history, and testing

Three things a registry-driven system needs that a pile of constants does not:

- **Knob removal and key reuse.** When a knob leaves the registry its rows
  persist. If the key is ever reused for a different knob, a stale tenant value
  silently resurrects with a new meaning. The registry needs a `deprecated`
  tombstone list plus a prune, and a standing rule that **keys are never
  reused**.
- **History and rollback.** §9-3's "reset" deletes the row, which discards the
  previous value — there is no undo for "someone set this wrong an hour ago".
  Recording `previousValue` in the audit metadata makes rollback mechanical and
  is nearly free at write time.
- **Testing.** `CLAUDE.md`'s "a test that cannot fail is not a test" bites
  hardest here: the useful tests are **registry invariants**, not per-knob
  cases — every key unique, every `default` inside its own `bounds`, every
  `labelKey` present in every locale, every `scopes` entry legal for that
  knob's storage, no key colliding with a tombstone. Plus a CI drift check on
  whatever is generated (SDL fields, `.env.example`), since generation without
  a drift gate is just a stale file waiting to happen.

One open mechanical question: how the TypeScript type of the resolved config is
actually derived. Const-generic inference across 60+ entries and a codegen step
are materially different build stories, and the SDL/`.env.example` generators
are codegen either way.

---

## 5. What should *not* move into the database

Being explicit about this matters as much as the migration list. In registry
terms every item below is `storage: 'env-only'` — never written, never listed
as editable, and (for the secrets) `redacted: true`.

- **Secrets** (§2.1a). They belong to the deployment. If anything, they should
  move *further* out (a secrets manager), not in. All are `redacted`.
- **Boot-time values** (§2.1b) — ports, `DATABASE_URL`, `REDIS_URL`. Read
  before a DB connection exists. Bootstrapping config from a database that
  config tells you how to reach is circular.
- **`src/lib/sync-config.ts`** — these values must be **identical on both
  sides of the client/server boundary** (genuinely dual-imported: server via
  `sync.service.ts:7` and `ws/index.ts:29`, client via `ws-client.ts:18` and
  `sync-manager.ts:1`) and several are structurally coupled —
  `WS_PONG_TIMEOUT_MS` is literally derived from `WS_PING_INTERVAL_MS`, and
  `MAX_PLAUSIBLE_XACT_ID` is a wire-format constant of the delta cursor.
  Making them per-org runtime-editable would let an admin desynchronise their
  own clients. If any become configurable it is `storage: 'env-only',
  scopes: ['platform']` — deployment-wide, at boot, with the derived
  relationships preserved — never per-tenant.
- **Security-invariant caps.** `MAX_SINGLE_COMPLEXITY`, SAML `CLOCK_SKEW_MS`,
  Slack's `MAX_REQUEST_AGE_SECONDS`, `MAX_BUFFERED_BYTES`. These protect the
  server from its clients; letting a tenant raise them is a vulnerability, not
  a feature. If exposed at all: platform scope, never org scope.

---

## 6. Suggested phasing

Ordered so each phase is shippable alone and each de-risks the next. Sizes are
relative, not estimates:

| Phase | Size | What it buys |
| ----- | ---- | ------------ |
| 0 — truth and cleanup | S | Removes the misleading state; no new infrastructure |
| 1 — registry over existing storage | M | Provenance + `/admin/config` read-only; no migration |
| 2 — `settings` table and generic writes | L | The actual system; contains all the new infrastructure |
| 3 — migrate the tunables | M | Runtime-changeable operations knobs |
| 4 — fill the gaps | S–M | `organizationUpdate`, runtime app name, notification prefs |

Phase 2 is where the risk concentrates: it is the only phase that builds
something the codebase has no precedent for.

**Phase 0 — Truth and cleanup (small, no new infrastructure).**
Delete or wire up the 7 dead org columns and 8 dead team columns; decide
`roadmapEnabled`'s fate (it is non-null in the SDL, so removal is a breaking
SDL change — likely wire it to `PublicRoadmap.enabled` instead), and put
`themeSettings` in the sync omit list or drop it (§2.2). Fix the `.env.example`
drift (add `WS_PORT_PUBLISHED`/`YJS_PORT_PUBLISHED`, drop the four third-party
vars, correct the `NEXT_RUNTIME` stanza, split deployment vars into their own
section). Add audit logging to all three platform-admin writes, and a
SyncAction to `suspendTenant`/`restoreTenant` — **but not to
`updateTenantLimits`**: the limits are not in the synced `DBOrganization` shape
(§3-F1), so a SyncAction there changes nothing unless the payload and client
type grow too, and Phase 2 moves those values out of columns entirely. Doing it
now would churn the client shape twice in three phases; suspension is state
rather than config and does not have that problem. **This phase alone removes
the most misleading parts of the current state.**

**Phase 1 — The registry, over existing storage.**
Build `defineSetting` + `ConfigService` + the resolver, and back it with the
`Organization.max*` and `Team.*` columns that already exist. No migration. Port
the live org/team knobs onto it. Ship `/admin/config` as a read-only "effective
configuration" view — that alone closes F6 and proves the provenance model
before anything is writable.

**Invalidation ships with this phase, not Phase 2.** The legacy mutations
(`aiSettingsUpdate`, the tenant-limit editor) still write those columns outside
the registry, so without the `config:*` channel from day one `ConfigService`
would serve values stale by up to its TTL with no way to tell. A read-only view
that lies is worse than no view.

**Phase 2 — The `settings` table and generic writes.**
Add the table (§4.2) with the platform sentinel and the orphan sweep, the
layered write path with registry-backed validation, the per-scope propagation
matrix of §4.3, and audit logging with `previousValue`. The org and team rows
of that matrix reuse the SyncAction pattern `aiSettingsUpdate`/`teamUpdate`
already prove; **per-user targeted delivery is net-new work on
`ConnectionManager` and should be budgeted separately** — it is the one item
here with no existing precedent to copy. Migrate the five `Organization.max*`
columns into `settings` rows and drop the columns (§4.2 — no SDL change, so
clients see nothing). **Copy only rows whose value differs from the column
default**: a blanket copy would convert "never configured" into an explicit
override for every existing org, permanently freezing them against any future
change to the product default. Registry-driven forms in all three UIs, plus the client config
store and Dexie table. Add "reset to inherited" while the write path is being
built; per §9-3 it is close to free here and awkward to retrofit.

**Phase 3 — Migrate the tunables.**
Move §2.1d's ~14 operational env vars and the safe subset of §2.4's constants
onto the registry, each keeping its constant as the code default and its env
var in `default` mode. Nothing breaks for existing deployments: an unset DB
value and an unset env var resolve to exactly today's behaviour.

**Phase 4 — Fill the gaps the system makes cheap.**
`organizationUpdate` (rename / logo / URL key). A runtime `APP_NAME` so
branding stops requiring a rebuild. Per-event-type notification preferences.
The live-but-hidden team knobs. Each is now one registry entry plus a resolver.

---

## 7. Decisions taken (2026-08-18)

Four of the eleven questions this raised were settled in review. Recorded here with
the reasoning, because the reasoning is what the next person needs. D1's
*reasoning* was subsequently corrected by an adversarial review of this
document; the conclusion did not change, but the argument that supports it did.

### D1 — Scope model: four scopes. `project` is **not** one of them.

`platform → org → team → user`, and it stops there.

**The argument that actually holds is about product semantics, not graph
theory:**

> Config is policy that applies to a *class* of entities and is inherited.
> An attribute is a property of *one* entity and is edited on that entity.
> `Team.autoClosePeriod` is config. `Project.roadmapVisible` is an attribute.

Scanning `Project`'s ~30 columns, the only config-shaped field is
`roadmapVisible`, and it is squarely an attribute by that test. Nothing in the
schema wants a project scope, so we do not add one.

**A weaker argument was made first and should not be repeated.** The original
claim was structural: that a precedence chain *must* be a global tree, and that
`Project`'s many-to-many relation to `Team` (via `ProjectTeam`,
`prisma/schema.prisma:685`) makes inheritance undefined. The first half is
wrong. The requirement is only that *each knob* have a well-defined parent
chain, not that all scopes form one tree — `org → project` is a perfectly good
chain, and a knob declared at both team and project scope could simply be
forbidden by the registry in one line. The giveaway that the argument was
overstated is that the document simultaneously claimed adding a project scope
later would be cheap; a genuinely structural impossibility is not cheap to
reverse.

**Applied honestly, the same scrutiny lands on two scopes we did keep**, and
both need stating rather than glossing:

- **`user` does not nest under `team` or `org`.** A user belongs to many orgs
  (`OrganizationMember`) and many teams (`TeamMembership`), and the existing
  preference columns — `users.locale`, `users.accent` — are *global per user*,
  not per-org. So user scope is global, and a single `scope_id` column cannot
  key a per-(user, org) preference at all. If per-org user preferences are ever
  wanted, that needs a second scope column, and it needs it **before** rows
  exist, not after.
- **`team` is itself a hierarchy that the chain ignores.** `Team.parentId`
  (`prisma/schema.prisma:303`, self-relation `TeamHierarchy`) is a real tree —
  and the one place inheritance would be unambiguous. Whether team resolution
  walks `parentId`, and what caps the walk, is currently undefined. It should
  be decided before team-scope writes ship in Phase 2.

If a genuine per-project need appears later, the answer is a column on
`Project` (an attribute), not a fifth scope. `scope_type` is a string, so
nothing forecloses it.

**Left open deliberately:** whether a team may only *narrow* an org value
rather than override it freely. That is per-knob policy, cheap to add to the
registry later (`teamMayOnlyNarrow: true`) once a real knob needs it.

### D2 — Storage: generic `settings` table.

Settled. The table shape and its four consequences — including the two that
change the design rather than merely describe it, the platform sentinel and the
orphan sweep — are in §4.2.

### D3 — Plan limits stay platform-admin only.

`editableBy: 'platform-admin'` for all five `max*` knobs. Org owners keep the
read-only view they already have at `/[workspace]/settings`. This is a billing
boundary, and the registry expresses it as data rather than as a hand-written
`requireOrgRole` at each call site.

This implies `editableBy` and `visibleTo` are genuinely two fields, not one.
The plan limits are the proof — visible to org admins, editable only by
platform admins. A single `role` field could not express a case that already
exists in the product.

### D4 — Env precedence: per-knob mode. Two modes, not three.

`default` and `override`, table and rules in §4.2. The load-bearing part is the
migration safety property: everything moved in Phase 3 starts in `default`
mode, which is bit-for-bit today's behaviour, so Phase 3 ships without a
behavioural diff and `override` promotions happen one knob at a time.

**A third mode, `seed`, was proposed and dropped on review.** "Supplies the
initial DB value at first boot / org creation, then never again" left four
things undefined, and one of them was disqualifying:

- An org created *before* the knob existed has no row and never gets one, so it
  diverges permanently from orgs created after.
- "First boot" for a platform-scope knob is undefined across three processes
  (`next`, `ws:server`, `yjs:server`) that boot concurrently — whichever wins
  races to write.
- **If the seed materialises lazily on read, the resolver writes.** That breaks
  the per-request memo, breaks read-replica safety, and turns a background job's
  config read into a mutation. The resolver must be a pure read path.
- Once seeded, `explain()` reports provenance "org", so the UI would state the
  value came from the tenant when it came from an env var — and changing the
  env var afterwards would do nothing, silently.

`seed` has no behaviour that `default` plus an explicit write at org-creation
time does not have, so seeding moved to provisioning (§4.2) and the resolver
kept two clean, non-overlapping modes.

---

### D5 — User scope is **global**, not per-(user, org)

A user belongs to many organizations, and a single `scope_id` column cannot key
a per-(user, org) preference. Settled as global, matching the two per-user
preferences the app already has: `users.locale` and `users.accent` are both one
row per user, not one per membership.

Nothing is deployed, so the second column would have been free to add — that is
the argument for taking the decision now rather than later, not an argument for
adding it. Adding a column nothing reads is the same defect as declaring a knob
nothing enforces.

Pinned by a test rather than only by this paragraph: keying user resolution per
(user, org) turns it red.

**Caveat worth knowing:** no knob declares `user` scope today, so the layer is
inert. That is why per-user live delivery was *not* built — see
REVIEW_BACKLOG §5b.4 for what a genuine first user-scoped knob would look like.

### D6 — Team scope is **flat**; `Team.parentId` is not walked

A sub-team inherits from its organization, not from its parent team. No knob
needs parent-team inheritance, and a walk costs a query per level and needs both
a cycle guard and a stated depth bound — none of which buys anything today.

The alternative was left available rather than foreclosed: the storage is
unchanged either way, so introducing a walk later is a resolver change, not a
migration. Also pinned by a test, which a `parentId` walk turns red.

---

## 8. What implementation changed

The design survived contact with the code largely intact. Four things did not,
and they are worth recording because each was a case of the proposal being
optimistic rather than wrong in principle.

**The two-phase column migration collapsed into one.** §6 had Phase 1 read the
`Organization.max*` columns as a layer and Phase 2 fold them into `settings`,
with a warning to copy only rows differing from the default. Nothing is
deployed, so there was no data to migrate and no default-vs-explicit
distinction to preserve — the columns were simply dropped and the knobs
declared. The two-step dance is the right advice for a live deployment and the
wrong advice here.

**`roadmapEnabled` was dropped, not wired.** §6 suggested wiring it to
`PublicRoadmap.enabled`. On inspection that would have created an org-level
gate defaulting to `false`, i.e. shipped the roadmap feature switched off for
every workspace. `PublicRoadmap.enabled` already gates the feature; two
booleans named for one feature was the actual defect, so the inert one is gone.

**Three knobs became `env-only` rather than database-backed.** The two security
guards (`security.allowPrivateWebhookUrls`, `security.authRateLimitFailClosed`)
and `log.httpSampleRate`. §5 already said security-invariant caps must never be
tenant-editable; `storage: 'env-only'` is the honest expression of that, and it
closes an attack the `override` mode alone did not — a compromised
platform-admin session cannot disable the SSRF guard with a mutation if there is
no stored layer to write.

**`branding.appName` was declared and then removed before shipping.** It is the
most-requested knob in §2.1c — renaming the product needs a rebuild — but
`APP_NAME` has 14 consumers and 12 are client components importing the constant
directly. Wiring only the server-rendered surfaces would rename transactional
emails and the PWA manifest while the sidebar still said Bilinear. That is worse
than not offering the knob: it is the "config that lies" failure this system was
built to remove. It needs a client delivery path (the value in the bootstrap
payload, a store, and those imports moved onto it) and is filed in
`REVIEW_BACKLOG.md`.

The rule those last two share is the one worth carrying forward: **every knob in
the registry is enforced by a consumer, or it is not in the registry.**

Also worth noting, because the original text overstated it: the orphan-row
hazard from the polymorphic `scopeId` is smaller than §4.2 implied. Orgs and
teams are *soft*-deleted, so their settings must survive — losing an archived
org's configuration on restore would be silent data loss. `deleteScope()` exists
for a genuine hard delete; the periodic sweep addresses the real lifecycle
problem, which is rows for a knob that has left the registry.

### 8.1 What review changed after it shipped

Two passes over the built system — an adversarial code review, then a
four-angle cleanup pass. The code changes are in the changelog; what belongs
here is the two things they say about the *design*.

**The authorization model had a hole the design did not describe, because the
design conflated two questions.** `editableBy` answers "may this role change
this knob"; it does not answer "may this caller reach this scope". Those are
different — the first is a property of the knob, the second of the caller — and
because §4.1 only ever named `editableBy`, the implementation gated on it alone
and let any org admin write platform-scope defaults for every tenant. The
scope-reachability rule is now explicit: platform scope requires
`requirePlatformAdmin` (which also refuses an impersonated session), team scope
requires membership unless the caller administers the org, and org and user
scope may never name someone else's id. It is enforced in the settings resolver
and covered by `setting.test.ts`; §5b.5 of the backlog records the argument for
also asserting it inside `ConfigService`.

**"A knob must have a consumer" needs a matching rule for readers.** §8's
closing line covers declarations; the review found the mirror-image failure.
`GitHubService` built its `WebhookService` without a `ConfigReader`, so it fell
back to `DEFAULTS_ONLY_CONFIG` and ignored every configured webhook retry and
timeout value — for that code path only, silently. `DEFAULTS_ONLY_CONFIG` is
what keeps ~1,800 unit tests against a mocked Prisma meaningful, so it is not
going away; the cost is that omitting the real reader fails quietly rather than
loudly. The rule to carry forward is: **a service that takes a `ConfigReader`
must be handed the real one at every production construction site**, and the
constructor default is a test affordance, not a fallback anyone should reach in
production.

### 8.2 What the branding knob and the first e2e spec changed

**`branding.appName` is in, and its delivery is simpler than the plan.** §8
recorded it as removed for want of a client delivery path, and the path filed in
the backlog was "put it in the bootstrap payload and hold it in a store". The
root layout turned out to be the better mount point: it is a server component
that already resolves the accent, the locale and the collab config the same way,
so one read per request feeds `BrandingProvider` for React and `getAppName()`
for the surfaces outside it (metadata, the PWA manifest, transactional email).
No bootstrap field, no store, no staleness on a cached boot — and the auth
screens are covered too, because they render inside the root layout.

The rule the bootstrap plan would have gotten wrong: **anything a page must
render correctly on first paint belongs in the layout, not in a payload the
client fetches afterwards.** `CollabProvider` and the accent cookie already
encoded that; branding is the third instance.

**Two defects only a real browser and a real bundle could show.** The console's
first e2e spec found both, and neither was reachable from a unit test:

- `mapConfigError` recognised `InvalidSettingValueError` with `instanceof`. The
  registry is deliberately importable from browser and server, so the bundler
  emits it into the SSR chunk *and* the server chunk — two copies, two class
  identities — and the resolver compared a value thrown by one against the
  constructor of the other. Every validation failure surfaced as
  `INTERNAL_SERVER_ERROR`. Under Vitest there is only ever one copy of a module,
  which is precisely why this class of bug needs a spec that runs the real
  bundle. Recognition now keys on `name`.
- `settingsForScope` filtered to `storage === 'db'`, so the console could never
  list an env-backed knob — contradicting §4.4 above, stranding `SettingRow`'s
  lock and redaction branches, and making the "console reported the opposite of
  the security guards" bug in §8.1 unobservable in the console it was about. A
  test had locked the exclusion in as intentional; it was asserting a bug.

The generalisable point: **a filter that decides what a UI may *show* is not the
same as the guard that decides what may be *written*.** Conflating them hid
exactly the values an operator most needs to see, and the write guard
(`assertWritable`) was doing its job the whole time.

---

## 9. Still open

1. **How `restartRequired` is surfaced.** The field itself is settled (§4.1) —
   some values are read once at process start (ports, the `setInterval` cadences
   in `ws/index.ts` and `yjs/server.ts`) and the registry marks them. What is
   open is the treatment: a banner on the knob, a deploy-time warning, or
   refusing to expose those knobs in the UI at all. Leaning toward the banner —
   a knob you can see and must restart to apply beats a knob you cannot find.
2. **Dead-column disposition.** Drop the 15 dead columns, or implement the
   features they were placeholders for? `themeSettings` / `authSettings` /
   `securitySettings` in particular look reserved for planned work — worth
   knowing whether that work is still planned before deleting. Note this is now
   partly forced: with D2 settled, any new org-level config lands in `settings`,
   so those three Json blobs have no future role unless a specific feature
   claims them. `themeSettings` additionally needs the §2.2 sync fix either way.
3. **Blast radius.** A misconfigured platform-scope knob can affect every
   tenant at once. Does the system need staged rollout, or a confirmation step
   on platform-scope writes? "Reset to defaults" is close to free with the
   `settings` table (delete the row → fall through to the layer below) and is
   folded into Phase 2; genuine *rollback* needs the `previousValue` in the
   audit record proposed in §4.5.
4. ~~Per-(user, org) preferences~~ — **settled, see §7-D5.** User scope stays
   global.
5. ~~Team hierarchy resolution~~ — **settled, see §7-D6.** Team scope stays
   flat.
6. **Platform-scope propagation to connected clients.** Settled *provisionally*
   in the build: platform-scope writes emit no SyncAction at all, because
   `createSyncAction` is org-keyed and inventing a channel would fan a
   deployment-wide change into one arbitrary tenant's stream. Every server
   process still learns of the change on the `config:invalidate` channel, so
   nothing serves a stale value; what does not happen is a *client* refresh —
   browsers pick a platform-scope change up on next bootstrap or after the
   30-second TTL behind whatever they next query. That is acceptable for the
   knobs declared today and would not be for a platform-scope knob the UI reads
   directly. Revisit when one exists.
7. **How the registry's TypeScript types are derived.** Settled by the build:
   plain hand-written types with a `defineSetting` identity helper, no codegen.
   Const-generic inference across the entries was not needed because nothing
   consumes a per-key value type — `get`/`getInt`/`getBoolean` take an explicit
   type parameter. Left here because the answer constrains the generators §4.5
   proposed: neither the SDL nor `.env.example` is generated today, and doing
   either would be the first thing to want inference.

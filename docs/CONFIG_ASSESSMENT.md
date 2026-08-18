# Configuration System — Assessment

**Status:** assessment only. No behaviour changed. Written to answer one
question: *what would it take to give this app a single, coherent configuration
system that admins (and other roles) can drive from the UI, instead of the five
disconnected mechanisms it has today?*

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
| 3 | Team config columns | `teams.*` | team admin (11 of 22) | partly |
| 4 | Code constants | `src/**/*.ts` module scope | nobody — requires a release | no |
| 5 | User preferences | `users.*` + cookies | the user | yes |

The headline numbers:

- **68 environment variables** documented in `.env.example`; **7** of them are
  read through the one typed accessor that exists (`src/server/lib/env.ts`),
  the rest are read as raw `process.env.X` at 20+ scattered call sites.
- **~60 behavioural constants** hardcoded in module scope across
  `src/server/**` — rate limits, retry policy, timeouts, retention windows,
  token lifetimes, sweep intervals, payload caps. None is configurable at
  runtime by anyone.
- **13 org-level config columns** exist. **5** are editable (platform-admin
  console only). **1** is editable by an org admin. **4 are dead** — the column
  exists, nothing reads it.
- **22 team-level config columns** exist. **11** are reachable from
  `TeamUpdateInput`. **8 are dead** — nothing in `src/` reads them.
- Config changes have **no propagation path**. Only one of them
  (`aiSettingsUpdate`) emits a SyncAction; the rest are invisible to every
  other open client until reload.

The good news: three of the ingredients for a real system already exist and
are well-built — `src/server/lib/env.ts` (typed, validated, documented env
accessors), the `Organization.max*` plan-limit columns with bounds validation
and a platform-admin editor, and `src/lib/plan-limits.ts` (a declarative field
registry shared by two UIs). **The work is mostly generalising those three
patterns, not inventing something new.**

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
process itself. ~8 vars.

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
  read by the Sentry configs. Documenting it as an input invites someone to
  set it wrongly.

**Structural note.** `src/server/lib/env.ts` is a genuinely good module —
typed getters, present-but-malformed values throw with an actionable message,
missing values fall back so `next build` still works without secrets. It
covers **7 of 68** vars. Everything else is a bare `process.env.X` read. One
side effect worth naming: because the accessor takes the name as a string
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
no reader, and no writer — they are placeholders that already made it into the
sync-payload omit list (`src/server/services/sync.service.ts:37`), i.e. they
are load-bearing in the *plumbing* while carrying no data.

`roadmapEnabled` is the sharpest case: it is a non-null field in the GraphQL
SDL (`schema.ts:46`), it is typed into the client's IndexedDB row
(`src/lib/db.ts:13`), it syncs to every client — and no code branches on it.
The public-roadmap feature is gated by the presence of a `PublicRoadmap` row
instead.

The five `max*` columns are the model to copy. They were introduced with the
explicit intent recorded in the schema: *"data-driven so a future admin UI can
raise/lower them per org without a code change. Until that UI ships, these are
only settable directly in the DB."* The UI did ship — in the platform-admin
console only.

**Missing entirely: there is no `organizationUpdate` mutation.** An org
owner cannot rename their own workspace, change its URL key, or set a logo
from the app. `logoUrl` is a column, is in the SDL, is returned by resolvers,
and has no writer.

### 2.3 Layer 3 — Team config columns (22)

Reachable from `TeamUpdateInput` (11): `name`, `description`, `icon`, `color`,
`private`, `timezone`, `cyclesEnabled`, `cycleDuration`,
`issueEstimationType`, `triageEnabled`, `autoClosePeriod`,
`autoArchivePeriod`, `parentId`.

**Read by code but not settable through the API (3):** `upcomingCycleCount`
(`cycle.service.ts:615`), `autoCloseChildIssues`, `autoCloseParentIssues`
(`issue.service.ts` cascade), `defaultIssueStateId`. These are live knobs an
admin can only change with `psql`.

**Dead — nothing in `src/` reads them (8):** `cycleLockToActive`,
`cycleAutoAssignStarted`, `cycleAutoAssignCompleted`, `autoCloseStateId`,
`issueEstimationExtended`, `issueEstimationAllowZero`, `defaultIssueEstimate`,
`joinByDefault`. `cycleCooldownTime` and `cycleStartDay` are read in exactly
one place each.

So of 22 team knobs: 11 exposed, 3 live-but-hidden, 8 dead.

### 2.4 Layer 4 — Code constants (~60, none configurable)

These are the values an operator most often actually wants to change during an
incident, and none of them can be changed without a release:

**Rate limiting** (`src/server/middleware/rate-limit.ts`) — `WINDOW_SECONDS`
3600, `REQUEST_LIMIT` 5000, `HOURLY_COMPLEXITY_BUDGET` 250 000,
`MAX_SINGLE_COMPLEXITY` 10 000, plus the auth-mutation limits (5/hr/email
login, 20/hr/IP, 10/15min verify, 50/15min IP) written inline in
`checkAuthMutationLimit`.

**Auth / token lifetimes** — `REFRESH_TOKEN_DAYS` 30 (`jwt.ts`),
`ACCESS_TOKEN_EXPIRY_SECONDS` 86 400, `MAGIC_LINK_EXPIRY_MINUTES` 15,
`REFRESH_GRACE_PERIOD_MINUTES` 30 (`auth.service.ts`), `INVITE_EXPIRY_DAYS` 7,
`MAX_PENDING_INVITES` 200 (`organization-invite.service.ts`).

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

**F1 — Config changes do not propagate.** `aiSettingsUpdate` is the only
config write that emits a SyncAction. `updateTenantLimits`, `suspendTenant`
and `restoreTenant` (`platform-admin.service.ts`) write to `organizations` and
emit nothing. A platform admin raising a cap, or suspending a tenant, is
invisible to every open client until reload. This is a direct violation of the
repo's own stated invariant ("Every mutation creates a SyncAction"). Note the
limits are not currently part of the synced `DBOrganization` shape, so this is
a staleness bug rather than a broken pool — but the suspension case is more
serious, and any new config surface will inherit the same hole unless the
system provides propagation by construction.

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
applied. Nothing else has it. Env vars get it only for the 7 in `env.ts`.

**F5 — Three-tier scoping exists implicitly but is never named.** Values
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

Four pieces. Each is independently shippable and independently useful.

### 4.1 A single config registry (the keystone)

One declarative module — the source of truth for *every* knob, generalising
what `src/lib/plan-limits.ts` already does for five of them:

```ts
defineSetting({
  key: 'webhook.maxAttempts',
  scope: 'org',              // 'platform' | 'org' | 'team' | 'user'
  type: 'int',
  default: 5,
  bounds: { min: 1, max: 20 },
  editableBy: 'platform-admin',   // role required to write
  visibleTo: 'org-admin',         // role required to read
  envOverride: 'WEBHOOK_MAX_ATTEMPTS',  // optional escape hatch
  labelKey: 'settings.webhook.maxAttempts',
  restartRequired: false,
})
```

Everything else derives from this one declaration: the TypeScript type of the
resolved config object, the Zod/manual validator, the GraphQL SDL fields, the
admin UI form rows (already the `PLAN_LIMIT_FIELDS` pattern), the i18n key
list, the `.env.example` generator, and the audit-log field names. Adding a
knob becomes one entry, not eight edits across the stack.

Critically, the registry also makes every knob **greppable by key from one
place** — fixing the traceability regression noted in §2.1.

### 4.2 A layered resolver with an explicit precedence chain

```
code default  →  env override  →  platform value  →  org value  →  team value  →  user value
```

`ctx.config.get('webhook.maxAttempts')` resolves through the chain and is
memoised per request. Two properties matter:

- **Every layer is optional.** A knob with no org row resolves to the code
  default — which is exactly the `org?.maxInitiativeDepth ?? MAX_INITIATIVE_DEPTH`
  pattern already in use, generalised.
- **The resolver can report provenance.** `ctx.config.explain(key)` returns
  the effective value *and* which layer supplied it. That is what makes §3-F6
  answerable and what makes the admin UI honest ("inherited from org" vs "set
  here").

Storage: a single `settings` table (`scopeType`, `scopeId`, `key`, `value`
Json, `updatedBy`, `updatedAt`) rather than one column per knob. Columns do
not scale to 60+ knobs across four scopes, and every new knob would be a
migration. The existing `Organization.max*` columns can be read as a
first-class layer during migration and folded in later, or left as-is
permanently — the resolver does not care where a layer's data comes from.

### 4.3 Cache + invalidation

Resolve once per request into the GraphQL context (fixes F3 immediately).
Behind that, a Redis snapshot per scope invalidated by pub/sub on write —
reusing the channel the sync system already runs on. Any config write emits a
SyncAction for the affected scope, so open clients update without a reload
(fixes F1 by construction) and writes land in `AuditLogEntry` automatically
(fixes F2 by construction).

### 4.4 UI

- `/admin/config` — platform-admin console: every knob, grouped, with
  effective value + provenance + bounds. Extends the existing tenant editor.
- `/[workspace]/settings/*` — org-admin view: knobs whose `editableBy` the
  caller satisfies, rendered from the same registry, with inherited values
  shown greyed and a "reset to inherited" action.
- Team settings — same component, team scope, closing the 3 live-but-hidden
  team knobs from §2.3.

One form component driven by the registry, three mount points. This is
literally what `PLAN_LIMIT_FIELDS` already does across two pages.

---

## 5. What should *not* move into the database

Being explicit about this matters as much as the migration list:

- **Secrets** (§2.1a). They belong to the deployment. If anything, they should
  move *further* out (a secrets manager), not in.
- **Boot-time values** (§2.1b) — ports, `DATABASE_URL`, `REDIS_URL`. Read
  before a DB connection exists. Bootstrapping config from a database that
  config tells you how to reach is circular.
- **`src/lib/sync-config.ts`** — these values must be **identical on both
  sides of the client/server boundary** and several are structurally coupled
  (`WS_PONG_TIMEOUT_MS` is derived from `WS_PING_INTERVAL_MS`;
  `MAX_PLAUSIBLE_XACT_ID` is a wire-format constant). Making them per-org
  runtime-editable would let an admin desynchronise their own clients. If any
  become configurable it should be deployment-wide, at boot, with the derived
  relationships preserved — not per-tenant.
- **Security-invariant caps.** `MAX_SINGLE_COMPLEXITY`, SAML `CLOCK_SKEW_MS`,
  Slack's `MAX_REQUEST_AGE_SECONDS`, `MAX_BUFFERED_BYTES`. These protect the
  server from its clients; letting a tenant raise them is a vulnerability, not
  a feature. If exposed at all: platform scope, never org scope.

---

## 6. Suggested phasing

Ordered so each phase is shippable alone and each de-risks the next.

**Phase 0 — Truth and cleanup (small, no new infrastructure).**
Delete or wire up the 7 dead org columns and 8 dead team columns; decide
`roadmapEnabled`'s fate (it is in the SDL as non-null, so removal is a
breaking SDL change — likely wire it to the existing roadmap feature instead).
Fix the `.env.example` drift (add `WS_PORT_PUBLISHED`/`YJS_PORT_PUBLISHED`,
drop the four third-party vars, split deployment vars into their own file or
section). Add SyncAction + audit logging to the three platform-admin writes
(F1, F2). **This phase alone removes the most misleading parts of the current
state.**

**Phase 1 — The registry, over existing storage.**
Build `defineSetting` + the resolver + `ctx.config`, and back it with the
`Organization.max*` columns and `Team.*` columns that already exist. No
migration. Port the 6 live org/team knobs onto it. Ship `/admin/config` as a
read-only "effective configuration" view — that alone closes F6 and proves the
provenance model before anything is writable.

**Phase 2 — The `settings` table and generic writes.**
Add the table, the layered write path with bounds validation, SyncAction
emission, and audit logging. Registry-driven forms in all three UIs. Now
adding a knob is one registry entry.

**Phase 3 — Migrate the tunables.**
Move §2.1d's ~14 operational env vars and the safe subset of §2.4's constants
onto the registry, each keeping its constant as the code default and its env
var as an override layer. Nothing breaks for existing deployments: an unset
DB value and an unset env var resolve to exactly today's behaviour.

**Phase 4 — Fill the gaps the system makes cheap.**
`organizationUpdate` (rename / logo / URL key). A runtime `APP_NAME` so
branding stops requiring a rebuild. Per-event-type notification preferences.
The 3 live-but-hidden team knobs. Each is now one registry entry plus a
resolver.

---

## 7. Open questions for discussion

1. **Scope model.** Is `platform → org → team → user` the right chain, or is
   `project` a needed fifth scope? Should a team be able to *override* an org
   value, or only narrow it (e.g. team may set a stricter cap than the org,
   never a looser one)?
2. **Storage shape.** Generic `settings` table (flexible, one migration ever,
   untyped at the DB level) vs. typed columns (self-documenting, indexable,
   one migration per knob). Recommendation is the generic table with the
   registry supplying types — but the `max*` columns are evidence the team may
   prefer columns.
3. **Who edits what.** Should org owners be able to raise their own plan
   limits, or is that permanently platform-admin? The current split says
   platform-only, which reads as a billing decision rather than a technical
   one — worth confirming it is intentional.
4. **Env override precedence.** Should env *win over* the database (operator
   escape hatch, DB edit silently ignored — confusing) or *seed* it (DB wins
   once set — but then an env change does nothing after first boot)? The
   registry should probably mark this per-knob rather than picking one rule.
5. **Restart-required knobs.** Some values are read once at process start
   (ports, sweep intervals installed via `setInterval`). Does the system flag
   these (`restartRequired: true`) and show a banner, or refuse to expose them
   at all?
6. **Dead-column disposition.** Drop the 15 dead columns, or implement the
   features they were placeholders for? `themeSettings`/`authSettings`/
   `securitySettings` in particular look like they were reserved for planned
   work — worth knowing whether that work is still planned before deleting.
7. **Blast radius.** A misconfigured global knob can take down every tenant.
   Does the system need staged rollout, a "reset to defaults" escape hatch, or
   a config-change confirmation for platform-scope writes?

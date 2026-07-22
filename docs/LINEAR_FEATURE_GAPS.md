# Linear Feature Gaps — Tracking Document

This document tracks all features present in Linear that are missing or incomplete in
this codebase, organized by priority. Each item links to the PR that implements it once
shipped.

**Legend:** 🔲 Not started · 🚧 In progress · ✅ Done

> **Doc consolidation note (2026-05-21):** `LINEAR_RESEARCH.md` and
> `LINEAR_RESEARCH_2.md` are competitive-research source material that
> seeded this gap list. They drift independently of code and should be
> treated as snapshots. Future research updates: add an addendum at the
> top of `LINEAR_RESEARCH_2.md` rather than editing in place, so the
> "as of date X" of any claim stays clear. Consolidate the two into one
> file the next time either is materially edited.

---

## Priority 1 — High-impact, Core Differentiators

### 1.1 GitHub Integration ✅ _(PR #37, shipped 2026-05-17)_

Connect a GitHub account to a workspace so PRs are automatically linked to issues and
issues can be auto-closed on merge.

**Scope:**
- OAuth flow: `/api/integrations/github` → `/api/integrations/github/callback`
- `GitHubIntegration` DB model — one per org, stores access_token + webhook_secret
- `GitHubPullRequest` DB model — linked PRs per issue (pr_number, title, url, state, repo)
- Webhook receiver: `POST /api/integrations/github/webhook` — validates HMAC-SHA256, handles `pull_request` events
- Issue auto-linking: parse issue identifier from PR title or head branch (regex `[A-Z]+-\d+`)
- Auto-close issue on PR merge (transitions to first `completed` workflow state)
- GraphQL: `GitHubIntegration` type, `githubIntegration` query, `githubDisconnect`/`githubRotateWebhookSecret` mutations
- `Issue.pullRequests` resolver returns linked PRs
- Settings page: `/settings/integrations` — Connect/Disconnect button, webhook instructions
- Issue detail panel: linked PRs section (state badge, PR title, repo, link)

**Env vars needed:**
```
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

Note: there is no global `GITHUB_WEBHOOK_SECRET`. Each workspace generates its own webhook secret at connect time and stores it in `github_integrations.webhook_secret`.

**Files touched:**
- `prisma/schema.prisma` — new models
- `prisma/migrations/20260517000000_github_integration_email_notifications/migration.sql`
- `src/server/services/github.service.ts` _(new)_
- `src/server/graphql/schema.ts` — new types/mutations/queries
- `src/server/graphql/resolvers/github.ts` _(new)_
- `src/server/graphql/resolvers/index.ts`
- `src/server/graphql/context.ts`
- `src/app/api/integrations/github/route.ts` _(new)_
- `src/app/api/integrations/github/callback/route.ts` _(new)_
- `src/app/api/integrations/github/webhook/route.ts` _(new)_
- `src/app/(workspace)/[workspace]/settings/integrations/page.tsx` _(new)_
- `src/components/issues/pull-requests-section.tsx` _(new)_
- `src/components/issues/issue-detail-panel.tsx` — add PR section
- `.env.example`

---

### 1.2 Email Notifications ✅ _(PR #37, shipped 2026-05-17)_

Send email notifications for assignment, @mention, new comment, and status change events
to users who have email notifications enabled (default on, per-user opt-out).

**Scope:**
- `User.emailNotificationsEnabled Boolean @default(true)` DB column
- Email templates (HTML + plain-text) for: assignment, mention, comment, status change
- `sendNotificationEmail()` helper in `src/server/lib/email.ts`
- `NotificationService` calls email sender after in-app notification creation
  (fire-and-forget — never blocks mutation response)
- GraphQL: `emailNotificationsEnabled` on `User` type, `userUpdateNotificationPreferences` mutation
- User settings UI: toggle in `/settings` (or profile page)

**Env vars (already in .env.example):**
```
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=
```

**Files touched:**
- `prisma/schema.prisma` — `emailNotificationsEnabled` on `User`
- `prisma/migrations/20260517000001_user_email_notifications/migration.sql`
- `src/server/lib/email.ts` — notification templates + sender helper
- `src/server/services/notification.service.ts` — call email sender
- `src/server/graphql/schema.ts` — User type + mutation
- `src/server/graphql/resolvers/user.ts` — mutation resolver
- `src/app/(workspace)/[workspace]/settings/page.tsx` — toggle UI

---

## Priority 2 — Workflow Automations

### 2.1 Rule-Based Automations 🟡 _(MVP shipped 2026-05-21)_

Linear's automation engine: "When [trigger] → [action]". Enables PM/ops
teams to automate repetitive triage and routing tasks.

**Shipped (MVP):**
- `automation_rules` table — `(organization_id, team_id?, trigger_type,
  trigger_config JSONB, conditions JSONB, actions JSONB, enabled,
  sort_order, last_run_at, run_count)`
- 5 triggers: `issue_created`, `issue_state_changed`,
  `issue_priority_changed`, `issue_assignee_changed`, `comment_created`
  (last one is defined but not yet emitted from the comment resolver)
- 5 actions: `set_state` (tenant-guarded against cross-team states),
  `set_assignee`, `set_priority`, `add_label`, `post_comment`
- Conditions: simple AND-of-leaves on `teamId / stateId / priority /
  assigneeId`. Schema-stable so a full filter-tree drops in later.
- `AutomationService.evaluateForIssue` fired from `issue.ts` resolvers
  fire-and-forget — never blocks the originating mutation. Errors are
  logged and swallowed.
- GraphQL: `automationRule(id)`, `automationRules`,
  `automationTriggerTypes`, `automationActionTypes` queries;
  `automationRuleCreate/Update/Archive` mutations (owner/admin only).
- Admin UI: `/settings/automations` — minimal CRUD list with trigger +
  action selectors and JSON action-config textarea.
- 13 unit-test specs covering validation, tenant guards, condition +
  trigger-config matching, set_state cross-team refusal, and the
  never-throws contract.

**Still open (separate PR):**
- Cycle / project lifecycle triggers (`cycle_started`, `cycle_completed`)
- SLA-driven escalation trigger
- `add_to_cycle` / `add_to_project` / `send_notification` /
  `create_sub_issue` actions
- Comment trigger emission from comment resolver
- Visual rule builder UI (currently raw JSON for action config)
- Dry-run mode + per-action audit log (currently only `last_run_at` +
  `run_count` are tracked)
- Drag-to-reorder rule priority in the UI

**Estimated remaining size:** Medium-Large for the open scope above.

---

## Priority 3 — Views & Planning

### 3.1 Timeline / Gantt View 🟡 _(projects roadmap shipped 2026-05-21)_

Gantt-style view showing issues and projects on a date axis. Linear
shows this per-team and per-project.

**Shipped:**
- `GanttView` shared component (`src/components/roadmap/gantt-view.tsx`)
  — month-axis timeline with draggable bar (shift dates) and resizable
  edges (extend either side). Pure mouse events, no @dnd-kit dep.
- `ProjectRoadmapView` wires active projects (statusType not completed
  / canceled) to the Gantt and dispatches `projectUpdate(startDate,
  targetDate)` via `TransactionQueue` with optimistic store updates and
  rollback on error.
- View toggle on `/projects` (List ↔ Roadmap) with localStorage
  persistence per browser.
- `Issue.startDate` column + GraphQL field for the upcoming issue
  timeline layout. Threaded through `IssueService` create/update and
  added to the activity-tracked field list.
- Migration `20260521010000_priority_one_features`.

**Still open (separate PR):**
- `layout: 'timeline'` option in `CustomView.layout` + timeline layout
  on the team issue list view (uses the same `GanttView` component;
  client just needs to provide `IssueGanttItem` rows from
  `startDate`/`dueDate`)
- Cycle swimlanes overlaid on the roadmap (`cycle.startsAt`/`endsAt`)
- Initiative-axis grouping
- Bar-tap → detail panel open (currently the row below the chart links
  to the project; bars are drag-only)

**Estimated remaining size:** Small-Medium (the heavy component is
done; remaining is data plumbing per entity type).

### 3.2 Sub-Initiatives ✅ _(shipped 2026-05-21)_

Initiatives nest up to 5 levels via `Initiative.parentId`. Progress rollup
includes both linked projects AND child initiatives, weighted equally, and
propagates one level up on each recompute.

**Shipped:**
- `Initiative.parentId` self-FK (`ON DELETE SET NULL` — children re-root, never cascade-delete)
- `assertParentAcceptsChild` guard: cycle detection + `MAX_INITIATIVE_DEPTH = 5`
- `recomputeProgress` includes children's `progress` in the mean and propagates upward
- GraphQL: `Initiative.parent` + `Initiative.children` fields, `parentId` on
  create/update inputs
- See DATABASE_SCHEMA.md §2.32, PATTERNS.md §46

**Not yet shipped (separate UI PR):**
- Nested list rendering on `/initiatives`
- Breadcrumb in initiative detail panel

### 3.3 Initiative Updates Timeline ✅ _(PR #38, shipped 2026-05-18)_

A feed of status updates on each initiative (same pattern as `ProjectUpdate`).

**Planned scope:**
- `InitiativeUpdate` DB model mirroring `ProjectUpdate` structure
- `initiativeUpdateCreate/Update/Delete` mutations
- Updates feed in initiative detail panel

**Estimated size:** Small (0.5 sprint)

---

## Priority 4 — Enterprise / Identity

### 4.1 SAML SSO 🔲

Enterprise identity integration: SAML 2.0 IdP-initiated and SP-initiated flows.

**Planned scope:**
- `SamlConfig` DB model: `idpEntityId`, `idpSsoUrl`, `idpCertificate`, `orgId`
- SAML response validation (use `samlify` or `node-saml`)
- `/api/auth/saml/metadata` GET — SP metadata XML
- `/api/auth/saml/acs` POST — assertion consumer service
- Settings page: `/settings/saml` for uploading IdP metadata

**Estimated size:** Large (2 sprint equivalents)

### 4.2 SCIM Provisioning 🔲

Auto-provision / de-provision users from IdP (Okta, Azure AD, OneLogin).

**Planned scope:**
- SCIM 2.0 endpoints: `GET/POST /api/scim/v2/Users`, `GET/PUT/PATCH/DELETE /api/scim/v2/Users/:id`
- SCIM bearer token auth (per-org, stored hashed in DB)
- Map SCIM attributes → `User` fields

**Estimated size:** Large (2 sprint equivalents)

### 4.3 API Keys 🔲

Personal API keys for CI/CD integrations and external tooling.

**Planned scope:**
- `ApiKey` DB model: `keyHash` (stored), `keyPrefix` (shown), `name`, `userId`, `orgId`,
  `lastUsedAt`, `expiresAt`, `scopes[]`
- Issue on creation: show raw key once, never again
- Auth middleware: accept `Bearer bilinear_<key>` in `Authorization` header
- GraphQL: `apiKeyCreate/Revoke/List` mutations + query
- Settings page: `/settings/api-keys`

**Estimated size:** Medium (1 sprint)

### 4.4 OAuth2 Provider 🔲

Let third-party apps access workspace data on behalf of users.

**Planned scope:**
- `OAuthApp` and `OAuthToken` DB models
- Authorization endpoint, token endpoint, revocation endpoint
- Scope system (read:issues, write:issues, read:projects, etc.)

**Estimated size:** Large (3 sprint equivalents)

---

## Priority 5 — Integrations

### 5.1 Slack Integration 🔲

Create issues, receive notifications, and sync threads from Slack.

**Planned scope:**
- Slack OAuth app (bot token)
- `/slack` slash command → create issue modal in Slack
- Notification routing: send in-app notifications to Slack DMs (opt-in per user)
- Settings page: `/settings/integrations` (reuse GitHub integrations page)

**Estimated size:** Large (2 sprint equivalents)

### 5.2 Import / Export 🔲

Migrate data from Jira, GitHub Issues, and CSV.

**Planned scope:**
- `ImportJob` DB model tracking status
- Background job processor (queue via Redis)
- Importers: CSV (generic), GitHub Issues (via API), Jira (via REST API + XML export)
- Export: full org JSON export, per-team CSV

**Estimated size:** Large (2–3 sprint equivalents)

### 5.3 Additional Integrations 🔲

PRD §2.17 enumerates a P2 long-tail beyond GitHub/Slack. None are scoped or
started.

**Planned scope (each is its own PR):**
- **GitLab** — mirror of GitHub integration (OAuth, webhook, PR ↔ issue link, auto-close on merge). Reuse `GitHubIntegration` shape.
- **Sentry** — issue auto-create from Sentry alerts; link back from issue to Sentry event
- **Figma** — embed Figma frames in issue descriptions (oEmbed-style)
- **Zendesk / Intercom** — feeds customer tickets into triage; pairs with §9.8 Customer Requests
- **Generic OAuth2 inbound** — covered by §4.4

**Estimated size:** Medium per integration

---

## Priority 6 — Analytics & Insights

### 6.1 Comprehensive Analytics 🟡 _(MVP shipped 2026-05-21)_

Linear's Insights page: lead-time histogram, cycle-time distribution,
flow metrics, date range selector, cross-team aggregates.

**Shipped:**
- New `AnalyticsService` with server-side `$queryRaw` queries:
  - `leadTimeHistogram` — created → completed, Fibonacci-ish day buckets
  - `cycleTimeHistogram` — started → completed
  - `throughputByWeek` — count of issues completed per ISO week
  - `timeInStateApprox` — coarse avg-hours-in-state from lifecycle
    timestamps (full audit log is the upgrade path)
- GraphQL: `AnalyticsInput` (teamId + from + to), four queries with
  `requireTeamMember` guard.
- `InsightsSection` component rendered below existing analytics charts
  on `/team/[key]/analytics`. Date-range presets: 30d / 90d / 180d /
  All. Uses the existing CSS bar primitives — no new chart dep.

**Still open (separate PR):**
- Cross-team aggregate dashboard (server queries are already org-scoped
  with optional teamId; just needs a workspace-level UI route)
- Cycle metrics: scope creep %, carryover rate, commitment vs delivery
  (requires augmenting the queries with cycle joins)
- Higher-fidelity time-in-state (needs an `issue_state_history` table
  written on every state change — currently approximated)
- Custom date-range picker (today only the 4 presets)
- CSV export of insights data

**Estimated remaining size:** Medium.

### 6.2 Project Progress History Charts ✅ _(PR #38, shipped 2026-05-18)_

The `completedIssueCountHistory` / `scopeHistory` JSONB columns exist on `Project`
but are never populated. Wire up the writer and add sparkline charts.

**Planned scope:**
- Populate history arrays in `ProjectService.update()` and nightly cron job
- Sparkline chart component in project list / detail

**Estimated size:** Small (0.5 sprint)

---

## Priority 7 — Collaboration & Editor

### 7.1 Collaborative Editing (YJS) 🟡 _(MVP scaffolded 2026-05-22)_

Real-time live cursors and conflict-free co-editing on issue descriptions
and documents.

**Shipped (MVP scaffold 2026-05-22):**
- `@hocuspocus/server` v4 + `@hocuspocus/provider` added as dependencies
- `src/server/yjs/server.ts` — Hocuspocus server with auth, load, and store
  hooks; `src/server/yjs/index.ts` — entry point (starts on `yarn yjs:server`)
- Auth: reuses existing `ws_ticket` JWT via `verifyWsTicket` — same 60s scoped
  token as the sync WebSocket (PATTERNS.md §18)
- Tenant guard: `onAuthenticate` verifies `issue:<uuid>` belongs to the org
  from the ticket; rejects archived issues
- Persistence: `onLoadDocument` loads `Issue.descriptionState` via `Y.applyUpdate`;
  `onStoreDocument` saves via `Y.encodeStateAsUpdate` (debounced 2s / 20s cap)
- Cold-start seeding: client seeds empty YJS doc from `Issue.description` HTML
  after first `onSynced` (the `description` column is not modified by the server)
- Resolution policy: existing `onBlur` saves `editor.getHTML()` (merged YJS state)
  to `Issue.description` via `issueUpdate` — search/sync/webhooks unaffected
- `TipTapEditor` gains `collabDocId` + `collabUserName` props; uses
  `Collaboration` + `CollaborationCaret` extensions when enabled
- `IssueDetailPanel` passes `collabDocId={`issue:${issue.id}`}` and
  `collabUserName` to the edit-mode TipTapEditor
- Feature flag: `NEXT_PUBLIC_COLLAB_ENABLED=true` (default off)
- Env vars: `YJS_PORT`, `NEXT_PUBLIC_YJS_SERVER_URL` added to `.env.example`
- See PATTERNS.md §51 for full implementation notes

**Still open (separate PR):**
- `Document.contentState Bytes?` migration + Document editor collab
- "Users editing now" avatar stack in the issue header
- View-only collaborator role (authenticated but non-editable sessions)
- Persistent cursor colors across reloads
- Docker Compose third service entry (`ws-yjs`)

**Estimated remaining size:** Medium (avatar stack + Document collab are the
main items; each is roughly a half-sprint).

### 7.2 Image Paste into Editor ✅ _(PR #38, shipped 2026-05-18)_

Currently images can only be inserted via the toolbar button. Paste/drag-drop from
clipboard should also trigger upload.

**Planned scope:**
- Add TipTap `handlePaste` / `handleDrop` hooks to upload pasted image blobs
- Same `/api/upload` endpoint, no backend changes needed

**Estimated size:** Small (0.5 sprint)

### 7.3 @Mention Issues and Projects 🔲

Currently `@` in the editor only suggests users. Extend to suggest issues (by identifier)
and projects (by name).

**Planned scope:**
- Separate mention extension instances for users, issues, and projects
- Client-side fuzzy search against `issueStore` / `projectStore` pools
- Rendered as pill with icon + identifier

**Estimated size:** Small (0.5 sprint)

---

## Priority 8 — Smaller / UX Polish

### 8.1 Favorites / Sidebar Pinning ✅ _(shipped 2026-05-21)_

Pin issues, projects, initiatives, views, cycles, documents, and teams to
the sidebar.

**Shipped:**
- `Favorite` table — `(userId, organizationId, entityType, entityId, sortOrder)`,
  unique on `(userId, entityType, entityId)`
- GraphQL: `favoriteCreate` / `favoriteDelete` / `favoriteReorder` mutations,
  `favorites` query, `FavoriteEntity` union resolves the target
- Service: `FavoriteService` (in-place upsert, atomic reorder, cross-tenant guard)
- See DATABASE_SCHEMA.md §2.18, PATTERNS.md §47

**Not yet shipped (separate UI PR):**
- Sidebar "Favorites" section UI above Teams
- Bootstrap payload inclusion (currently fetch-on-mount via `favorites` query)
- Folder grouping (one level of nesting) — deferred until users ask

### 8.2 Guest Role Enforcement ✅ _(shipped 2026-05-21, hardened same day)_

Guests on a team see only issues they created or are assigned to; cannot
perform write actions that aren't on their own issues. Both read and
per-issue write paths are enforced.

**Shipped:**
- Helpers in `src/server/middleware/auth.ts`: `getTeamRole`,
  `requireTeamMemberNotGuest`, `requireIssueAccessNotGuestOrOwn`,
  `isTeamGuest`, `getGuestTeamIds`
- Read path: `Issue.findMany` honors `IssueFilter.guestUserId`
  (server-derived; never accepted from clients)
- Relation read paths gated: `Project.issues`, `Cycle.issues`,
  `Issue.children`, `Issue.parent` re-check guest status so they
  aren't backdoors around the top-level filter
- Per-issue write path: every issue mutation (`issueUpdate`, `Archive`,
  `Unarchive`, `Delete`, `Snooze`, `Unsnooze`, `ReactionAdd`/`Remove`,
  `issuesBulkUpdate`) runs `requireIssueAccessNotGuestOrOwn` — guests
  can only act on issues they created or are assigned to
- `commentCreate` and `issueRelationCreate`/`issueRelationDelete` also
  use `requireIssueAccessNotGuestOrOwn` (shipped 2026-05-24)
- See PATTERNS.md §48

**Still TODO (separate PR):**
- Project / Initiative / Document scoping for guests (currently a
  guest can see every project and initiative in their org)

### 8.3 Issue Reactions ✅ _(PR #38, shipped 2026-05-18)_

`Issue.reactionData JSONB` column exists but is never populated or exposed in GraphQL.

**Planned scope:**
- `issueReactionAdd` / `issueReactionRemove` mutations (same shape as comment reactions)
- Display reaction bar in issue detail panel header

**Estimated size:** Small (0.5 sprint)

### 8.4 SLA Tracking 🔲

`slaBreachesAt`, `slaHighRiskAt`, `slaType` columns exist on `Issue` but are never
set or exposed in GraphQL.

**Planned scope:**
- `SlaPolicy` DB model: `teamId`, `name`, `responseTimeHours`, `resolutionTimeHours`,
  `priorityFilter`
- `IssueService.applySlaPolicy()` stamps breach timestamps on issue create/priority change
- Background sweep that auto-escalates overdue issues
- Visual indicators in issue list / detail (red/orange badges)
- Admin config UI: `/team/[key]/settings` → SLA tab

**Estimated size:** Medium–Large (1.5 sprint)

### 8.5 Project Templates 🔲

Create a new project pre-populated from a saved template.

**Planned scope:**
- `ProjectTemplate` DB model (same fields as `Project` minus live data)
- `projectTemplateCreate/Apply` mutations
- Template picker in "New Project" modal

**Estimated size:** Small (0.5 sprint)

### 8.6 Workspace-Level Custom Fields ✅ _(shipped 2026-05-21)_

`CustomFieldDefinition.teamId` is now nullable. Null = workspace-scoped,
applies to every team in the org. Owner/admin-only create/edit.

**Shipped:**
- Migration adds `team_id NULL`, `organization_id` (denormalised for clean
  workspace lookups), and matching FKs/indexes
- Service: `findDefinitionsByTeamId` returns team-scoped + workspace-scoped
  in one list; `findWorkspaceDefinitions` for the settings UI; separate
  per-org cap of 30 active workspace fields
- GraphQL: `customFieldDefinitionCreate.teamId` accepts null;
  `workspaceCustomFieldDefinitions` query; `CustomFieldDefinition.team` now
  nullable
- See DATABASE_SCHEMA.md §2.27

### 8.7 Notification Email Digest 🔲

Weekly / daily digest email summarising unread notifications.

**Planned scope:**
- `UserNotificationPreferences` DB model: `digestFrequency` (none/daily/weekly),
  `digestDayOfWeek`, `digestHour`
- Cron job (Redis-backed) that builds and sends digest emails
- Preference UI in notification settings

**Estimated size:** Medium (1 sprint). _Blocked on 1.2 (email infrastructure)._

### 8.8 Desktop / Mobile Apps 🔲

Native apps that wrap the web experience with offline push and tighter OS integration.

**Planned scope:**
- **Desktop:** Electron wrapper with system tray notifications
- **Mobile:** React Native or Expo with APNs/FCM push

**Estimated size:** Very Large (separate project)

---

## Priority 9 — Newly Identified Gaps (audit 2026-05-21)

The 2026-05-21 audit surfaced these items that Linear ships but the doc
hadn't tracked. They're partitioned into "shipped now" and "still open".

### 9.1 Issue Snooze ✅ _(shipped 2026-05-21)_

`snoozed_until_at` / `snoozed_by_id` columns existed on `issues` since
schema inception but had no API. Now exposed via `issueSnooze(id, until)`
and `issueUnsnooze(id)` mutations.

**Shipped:**
- `IssueService.snooze` / `unsnooze`
- GraphQL mutations validate `until` is in the future
- See PATTERNS.md §49

**Read-time hiding shipped:** `IssueService.buildWhere` filters out
snoozed-not-yet-woken rows via `snoozedUntilAt IS NULL OR <= now()` under
an `AND` clause (composes with the guest filter). Clients pass
`IssueFilter.includeSnoozed: true` to opt in. Coverage extends to the
relation resolvers — `Project.issues`, `Cycle.issues`, `Issue.children`
all delegate to `IssueService.snoozeHideClause()` so they aren't
backdoors. See PATTERNS.md §49.

### 9.2 Bulk Issue Update ✅ _(shipped 2026-05-21)_

`issuesBulkUpdate(ids, input)` mutation applies the same patch to up to
200 issues in a single transaction. Auto-close cascades intentionally
skipped — bulk operations are a manual reorganisation.

**Shipped:**
- `IssueService.bulkUpdate` — tenant pre-flight, cross-team state guard,
  per-row label sync, hard cap of 200
- GraphQL: `issuesBulkUpdate(ids: [ID!]!, input: IssueUpdateInput!)`
  returns `IssueBulkUpdatePayload` with `issues + lastSyncId`
- One SyncAction + one webhook dispatch per row
- See PATTERNS.md §50

**Not yet shipped (separate UI PR):** Bulk-action toolbar in list view
(select-via-X, action-bar appears with status / assignee / priority / etc.).

### 9.3 Drafts 🔲

Linear keeps unsent issues and comments around when you close the composer
or accidentally navigate away.

**Planned scope:**
- `IssueDraft` table — `(userId, teamId, title, description, parentId?,
  ...)` keyed by `(userId, teamId)` so each user has at most one in-flight
  draft per team
- `CommentDraft` table — `(userId, issueId, body)`
- GraphQL: `issueDraftUpsert` / `issueDraftDelete`, `commentDraftUpsert` /
  `commentDraftDelete`
- Bootstrap payload includes both

**Estimated size:** Small-Medium (server is simple; UI requires composer
state plumbing across CreateIssueModal + CommentComposer)

### 9.4 @mention Issues and Projects ✅ _(shipped 2026-05-24)_

Issue `#` mentions shipped 2026-05-22 (PATTERNS.md §55). Project mentions
(`~` trigger) shipped 2026-05-24.

**Shipped:**
- `TipTapEditor` accepts `mentionProjects?: MentionItem[]` prop
- `buildProjectMentionExtension` with `~` trigger — same pattern as the
  issue mention extension; items `{ id, label: name, sub: teamName }`
- Three independent Mention extension instances: `@` users, `#` issues,
  `~` projects — each with its own name, trigger, and suggestion list
- No schema change — client-side only

### 9.5 Keyboard Shortcuts Coverage 🔲

Basic letter shortcuts (c, s/a/p/l/d/q, escape) are wired. Missing the
Linear staples that define the "feels-like-Linear" bar.

**Gaps:**
- `Cmd+K` command palette coverage (nested commands: Set status → status
  list; Go to → entity)
- `j`/`k` vim-style navigation between list rows
- `e` to edit the focused row inline
- `x` to archive / `Cmd+Backspace` to delete
- `?` global help / shortcuts modal
- `g i` (Inbox), `g m` (My Issues), `g p` (Projects) chord nav

**Estimated size:** Medium (frontend-only — keymap infrastructure exists)

### 9.6 Issue Activity Log Query ✅ _(shipped 2026-05-24)_

`IssueActivity` rows are written on every tracked field change and exposed
via the `issueActivities(issueId)` query.

**Shipped (2026-05-24):**
- `labelAdded` / `labelRemoved` — diffed from the actual persisted label
  set (not raw input) so single-select deduplication is not falsely logged
- `commentResolved` / `commentUnresolved` — emitted in `commentResolve` /
  `commentUnresolve` resolvers

**Still missing vs. Linear:**
- Git event (PR linked/merged/closed) in the activity log
- Project move, cycle change entries (these fields are in
  `TRACKED_ACTIVITY_FIELDS` but no dedicated activity type exists)

### 9.7 Linear "Asks" — Public Intake Forms 🔲

Public, link-shared forms that non-workspace users can fill out to create
an issue in triage.

**Planned scope:**
- `IntakeForm` model — `(orgId, teamId, slug, title, schema, allowedDomains,
  requireAuth)`
- Public-facing route `GET /asks/[slug]`, `POST /asks/[slug]/submit`
- Submissions land in the team's triage queue with a structured
  `intake_form_response` payload

**Estimated size:** Medium

### 9.8 Customer Requests / CRM Linking 🔲

Linear's customer-facing feedback loop: attach customers to issues to
count requests, notify on resolution.

**Planned scope:**
- `Customer` model — `(orgId, name, domain, externalRef)`
- `CustomerNeed` join — `(customerId, issueId, requestedAt, notes)`
- GraphQL CRUD + `Issue.customerNeeds` field

**Estimated size:** Medium-Large

### 9.9 AI Features 🔲

Linear's AI surface: auto-title from description, summarisation,
duplicate-detection, triage suggestions.

**Planned scope:**
- Anthropic Claude SDK integration in a new `AiService`
- Server-side endpoints: `aiSuggestTitle(description)`, `aiSummariseIssue(id)`,
  `aiFindDuplicates(issueId)`
- Per-org enable toggle in `Organization.aiSettings`

**Estimated size:** Large (each feature is a separate prompt + UI flow)

### 9.10 Custom Emojis 🔲

Workspace-scoped emoji that users can react with. Currently reaction
`emoji` is a free-form VARCHAR(50); a `WorkspaceEmoji` table would give
admins control and a picker.

**Planned scope:**
- `WorkspaceEmoji` — `(orgId, name, imageUrl, createdBy)`
- Bootstrap inclusion; emoji picker reads workspace + builtin set
- Reaction services validate against the union

**Estimated size:** Small

### 9.11 Dependency Graph View 🔲

Visual dependency tree for `IssueRelation` blocks/blocked-by chains.
Currently Mermaid embeds in descriptions cover one-off diagrams but no
auto-rendered graph exists.

**Planned scope:**
- `/team/[key]/dependencies` route
- Server: `issueDependencyGraph(rootIssueId, depth)` returns nodes + edges
- Client: D3 / React Flow renderer

**Estimated size:** Medium

### 9.12 Mobile Responsive UX 🚧

`sm:` Tailwind breakpoints exist but the layout is desktop-first. The
detail panel, command palette, and board view all break < 768px width.

**Planned scope:**
- Sidebar collapses to bottom nav < `md`
- Board view falls back to list < `md`
- Detail panel becomes a full-screen modal route on mobile

**Estimated size:** Medium-Large

### 9.13 Roadmap Drag Reorder ✅ _(shipped 2026-05-21)_

Shipped as part of §3.1 Timeline. `/projects` has a roadmap layout
toggle with draggable, resizable bars wired to `projectUpdate`. See
§3.1 for the full implementation notes.

### 9.14 Notion-Style Collapsible Sidebar Sections 🔲

Sidebar currently has fixed sections (Teams, Settings). Linear lets users
collapse / expand / reorder their sections.

**Planned scope:**
- `UserSidebarPreferences` JSONB column on `User` (collapsed-section ids,
  custom order)
- Drag-reorder via `@dnd-kit`

**Estimated size:** Small

### 9.15 Duplicate Relation Auto-Cancel ✅ _(shipped 2026-05-24)_

**Shipped:**
- `IssueRelationService.create` with `type='duplicate'` transitions the
  `issueId` (the duplicate) to the team's first `canceled` workflow state
  inside the same transaction; skips if already `completed`/`canceled`
- Returns `{ relation, canceledIssue, canceledIssueOldStateId }` so the
  resolver can emit a SyncAction and `IssueActivity(field='stateId')` with
  the correct pre-cancel `oldValue` (captured in-transaction)
- Auto-cancel triggers the `autoCloseParentIssues`/`autoCloseChildIssues`
  cascade via a follow-up `IssueService.update()` call in the resolver
- Reverse on `IssueRelationService.delete` is intentionally out of scope —
  once canceled, manual re-open is required

### 9.16 Auto-Create "Related" From Issue-ID References 🔲

PRD §2.1.4 specifies "Auto-create 'Related' when referencing issue ID in
description/comments." Not implemented anywhere — `ENG-123` in a comment
body is a plain string.

**Planned scope:**
- After-write hook in `IssueService.create`/`update` and `CommentService.create`/`update`
  that scans the text body for `[A-Z]+-\d+` matches
- For each match resolving to a real issue in the same org, upsert an
  `IssueRelation(type='related')` (skip self-refs, skip if any directed
  relation already exists between the pair)
- Idempotent — re-saving the same description doesn't create dupes (handled
  by the existing unique index on `(issueId, relatedIssueId, type)`)

**Files:** `src/server/services/issue.service.ts`, `src/server/services/comment.service.ts`,
new helper in `src/server/lib/issue-refs.ts`

**Estimated size:** Small-Medium

### 9.17 Label Group Enforcement ✅ _(shipped 2026-05-24)_

**Shipped:**
- `LabelService.create` and `LabelService.update` both throw
  `LabelGroupDepthError` if `input.parentId` points to a label that itself
  has a parent (max 1 nesting level). The capacity check and create are
  wrapped in a `$transaction` to prevent TOCTOU races.
- `LabelService.create` throws `LabelGroupCapacityError` when the
  prospective parent already has ≥ 250 non-archived children.
- `LabelService.update` excludes the label being moved from the sibling
  count when it already belongs to the target group.
- `IssueService.syncLabels` calls `enforceSingleSelectPerGroup` (private
  method): last-writer-wins deduplication within each group; only the
  final label in input order is persisted.
- Resolver catches `LabelGroupDepthError` / `LabelGroupCapacityError` and
  maps them to `BAD_USER_INPUT` GraphQL errors.

### 9.18 T-Shirt Estimate Analytics Mapping 🔲

PRD §2.5 specifies the t-shirt scale "maps to Fibonacci for analytics
(XS=1, S=2, M=3, L=5, XL=8)" so velocity math stays comparable across
teams using different scales. No code performs this mapping today —
`Team.issueEstimationType` is a free-form string and analytics summing
`Issue.estimate` over a t-shirt team gets nonsense.

**Planned scope:**
- Promote `Team.issueEstimationType` to a Prisma enum (covered by
  `REVIEW_BACKLOG.md §2.3`)
- New `src/server/lib/estimates.ts` with `toAnalyticsPoints(estimate,
  scale)` mapping function
- Cycle / project / team analytics aggregations call through the mapping
  instead of summing raw values
- Optional: extended scale + zero-estimate flags from PRD §2.5

**Files:** `prisma/schema.prisma`, new `src/server/lib/estimates.ts`,
analytics resolvers

**Estimated size:** Small-Medium

### 9.19 Backlog "Ready" Toggle 🔲

PRD §2.21.2 promises a "Ready" toggle to mark issues as groomed and ready
to pull into a sprint. No column exists on `Issue` and no UI exposes it.

**Planned scope:**
- `issues.ready_at TIMESTAMPTZ NULL` column (so backlog views can sort by
  recency of grooming as well as filter `IS NOT NULL`)
- `issueMarkReady(id)` / `issueMarkNotReady(id)` mutations (or fold into
  `issueUpdate` with a `ready: boolean` input)
- Filter chip on `/team/[key]/backlog`; checkbox in `IssueDetailPanel`
  properties
- "Move to cycle" bulk action surface should default to ready-only

**Estimated size:** Small

### 9.20 Manual Drag-to-Reorder Within Priority Bands 🔲

PRD §2.4 specifies "Manual drag-to-reorder within priority-sorted views
(workspace-wide ordering)." Today `Issue.sortOrder` is per-state for
board view; there's no workspace-wide ordering anchor that survives
state transitions.

**Planned scope (design decision needed first):**
- **Option A:** Add `Issue.workspaceSortOrder DOUBLE PRECISION` plus a
  `WHERE priority IS NOT NULL` partial index; drag-end mutation rewrites
  only the moved row using a midpoint between neighbors
- **Option B:** Keep `sortOrder` but reinterpret it globally per priority
  band; requires a backfill that resequences existing data
- Wire the backlog and "My Issues" views to use the new order field when
  the active sort is "Priority"

**Risk:** Medium. Drag-reorder UIs are sensitive to floating-point drift;
periodic re-sequencing (every ~1000 inserts between two rows) needs a
plan.

**Estimated size:** Medium

### 9.21 Passkeys / WebAuthn 🔲

PRD §2.16 lists passkeys as P1 — not started. Magic link + Google OAuth
are the only auth methods today.

**Planned scope:**
- `WebauthnCredential` model: `(userId, credentialId, publicKey, counter,
  transports[], createdAt, lastUsedAt)`
- `@simplewebauthn/server` for registration + assertion ceremonies
- New auth routes: `/api/auth/webauthn/register/{options,verify}`,
  `/api/auth/webauthn/login/{options,verify}`
- Settings UI: `/settings/security` — manage registered passkeys

**Estimated size:** Medium

### 9.22 Private Teams & Sub-Teams 🔲

PRD §2.11.2 P2. Today every team in an org is visible to every member;
no privacy flag or hierarchical relationship between teams exists.

**Planned scope:**
- `Team.private BOOLEAN @default(false)` — when true, team is invisible
  to non-members (filter at resolver layer, not just UI)
- `Team.parentId TEXT NULL` self-FK for sub-teams; max depth 3; child
  teams inherit private + workflow defaults from parent unless overridden
- Sweep every team-scoped resolver (`Issue`, `Project`, `Label`,
  `WorkflowState`, `CustomView`, `IssueTemplate`) to honor the private
  flag for non-members
- Settings UI: privacy toggle in team settings; sub-team picker on team
  create

**Risk:** Medium. Private-team enforcement is a tenant-isolation problem
on the same level as the guest sweep (§8.2); needs the same care.

**Estimated size:** Medium-Large

### 9.23 iCal / Calendar Feed for Cycles ✅ _(shipped 2026-05-24)_

**Shipped:**
- `User.calendarFeedToken VARCHAR(64) UNIQUE` — 32-byte random hex string,
  stored in plaintext (rotation invalidates old URL). Migration
  `20260523000000_tier5_quickwins`.
- `GET /api/cycles/feed/[token].ics` — looks up user by token, fetches all
  non-archived, non-completed cycles for every team the user belongs to,
  emits RFC 5545 VCALENDAR with one VEVENT per cycle. `DTEND;VALUE=DATE`
  uses `cycle.endsAt` directly (exclusive semantics — consistent with how
  cycle dates are stored).
- `userCalendarFeedTokenRotate` mutation — generates a new token and
  returns the updated `calendarFeedUrl`.
- `User.calendarFeedUrl` field resolver — returns null for any user other
  than the authenticated viewer.
- Settings page UI: "My Preferences" section with email notification
  toggle, feed URL display with copy-to-clipboard and rotate buttons.

### 9.24 Org-Wide Audit Log 🔲

PRD §3.3 lists audit logging as an Enterprise requirement (free for
self-hosted). Today `IssueActivity` tracks per-issue field changes only;
there's no record of org-level events (member added/removed, role
changed, integration connected, webhook created, settings modified).

**Planned scope:**
- `AuditEvent` model: `(orgId, actorUserId, action, targetType, targetId,
  metadata JSONB, ipAddress, userAgent, createdAt)`
- Write helper `AuditService.record(...)` called from
  `OrganizationService`, `TeamService.{add,removeMember,changeRole}`,
  `WebhookService.*`, `GitHubService.*`, auth flows (login, logout,
  failed-login)
- Owner/admin-only GraphQL query + UI at `/settings/audit-log` with
  date-range filter, actor filter, action filter, CSV export
- Retention: 1 year default; configurable via env

**Estimated size:** Medium

### 9.25 Initiative-Level Health Badge ✅ _(shipped 2026-05-24)_

**Shipped:**
- `Initiative.health: String!` GraphQL field (schema.ts).
- Resolver in `src/server/graphql/resolvers/initiative.ts`: if a
  non-archived `InitiativeUpdate` exists within the last 30 days, returns
  its `health` value; otherwise falls back to a progress heuristic:
  `onTrack` (≥ 67%), `atRisk` (≥ 33%), `offTrack` (> 0%), `unknown` (0%).
- No new DB column — pure resolver derivation from `initiative.progress`
  (the persisted rollup float) and `initiativeUpdate` rows.

### 9.26 Project Update Reminder Cadence 🔲

PRD §2.6.3 specifies "Configurable reminder cadence (daily / weekly /
biweekly)" for project updates. Schema has no cadence column; no cron
sends reminder notifications.

**Planned scope:**
- `Project.updateReminderFrequency` enum: `none | weekly | biweekly | monthly`
- `Project.updateReminderDayOfWeek` int (0-6)
- Sweep job (in WS server, alongside webhook retry sweep) checks once an
  hour for projects whose last `ProjectUpdate` is older than the cadence
  and emits an in-app notification to the project lead
- Settings UI: cadence picker on project edit
- Pairs cleanly with §8.7 email digest

**Estimated size:** Small-Medium

### 9.27 Comment → Sub-Issue + Quote Reply + Activity Collapsing 🔲

PRD §2.15 lists three comment UX items not yet shipped (the rest of §2.15
landed in Sprint 29-30 + the 2026-05-18 drop).

**Planned scope:**
- **Convert comment → sub-issue:** menu item on a comment that POSTs an
  `issueCreate` mutation with `parentId = comment.issueId`, prefills
  description with the comment body, and posts a follow-up comment
  linking the new issue
- **Quote reply:** prepend the selected comment body as a blockquote into
  the composer (frontend-only, no schema)
- **Activity collapsing:** in the activity timeline, group consecutive
  same-actor field changes within a 5-minute window into a single
  collapsible row

**Estimated size:** Small-Medium (each)

### 9.28 Async Standup / "Pulse" Digest 🔲

Linear's Pulse: daily auto-generated summary of "what your team
shipped, what's in flight, what's blocked" sent to a Slack channel or
email. No equivalent exists today.

**Planned scope:**
- Cron in WS server, daily at team-configurable hour
- Aggregates per team: issues completed in last 24h, issues started,
  issues newly blocked, overdue issues
- Renders to HTML email (reuse §1.2 email infra) and/or Slack message
  (depends on §5.1 Slack integration)
- Team-level enable toggle + delivery channel config

**Estimated size:** Medium. Blocked partially on §5.1 (for Slack
delivery); email-only delivery can ship independently.

### 9.29 GraphQL `findByIdentifier` Fallback to `previousIdentifiers` ✅ _(shipped 2026-05-24)_

**Shipped:**
- `IssueService.findByIdentifier` now includes
  `OR: [{ identifier }, { previousIdentifiers: { has: identifier } }]`
  in its Prisma query, backed by the existing GIN index.
- `GitHubService.handlePullRequestEvent` also updated: the identifier
  resolution query uses
  `OR: [{ identifier: { in } }, { previousIdentifiers: { hasSome } }]`
  so PR auto-links survive team key renames.

---

## Completed Items

| # | Feature | PR | Date |
|---|---|---|---|
| — | Triage workflow | #30 | 2026-05-05 |
| — | Initiatives (base) | #30 | 2026-05-05 |
| — | Webhooks | #30 | 2026-05-05 |
| — | Public Roadmaps | #28 | — |
| — | Documents | #28 | — |
| — | WebSocket auth hardening | #34 | 2026-05-12 |
| — | SyncAction committed_at watermark | #34 | 2026-05-12 |
| — | Tenant guard hardening | #34 | 2026-05-12 |
| 1.1 | GitHub Integration | #37 | 2026-05-17 |
| 1.2 | Email Notifications | #37 | 2026-05-17 |
| 3.3 | Initiative Updates Timeline | #38 | 2026-05-18 |
| 6.2 | Project Progress History Charts | #38 | 2026-05-18 |
| 7.2 | Image Paste in Editor | #38 | 2026-05-18 |
| 8.3 | Issue Reactions | #38 | 2026-05-18 |
| 3.2 | Sub-Initiatives | (pending) | 2026-05-21 |
| 8.1 | Favorites / Sidebar Pinning (server) | (pending) | 2026-05-21 |
| 8.2 | Guest Role Enforcement (read path) | (pending) | 2026-05-21 |
| 8.6 | Workspace-Level Custom Fields | (pending) | 2026-05-21 |
| 9.1 | Issue Snooze | (pending) | 2026-05-21 |
| 9.2 | Bulk Issue Update | (pending) | 2026-05-21 |
| 2.1 | Rule-Based Automations (MVP) | (pending) | 2026-05-21 |
| 3.1 | Timeline / Gantt View — projects roadmap + Issue.startDate | (pending) | 2026-05-21 |
| 6.1 | Comprehensive Analytics (MVP) | (pending) | 2026-05-21 |
| 9.13 | Roadmap Drag Reorder | (pending) | 2026-05-21 |
| 7.1 | Collaborative Editing YJS (MVP scaffold) | (pending) | 2026-05-22 |
| 8.2 | Guest write-path sweep (comment + relation) | #47 | 2026-05-24 |
| 9.4 | Project `~`-mentions in TipTap editor | #47 | 2026-05-24 |
| 9.6 | Activity log: labelAdded/Removed, commentResolved/Unresolved | #47 | 2026-05-24 |
| 9.15 | Duplicate relation auto-cancel | #47 | 2026-05-24 |
| 9.17 | Label group enforcement (depth, cap, single-select) | #47 | 2026-05-24 |
| 9.23 | iCal cycle feed + calendarFeedToken | #47 | 2026-05-24 |
| 9.25 | Initiative health badge (resolver derivation) | #47 | 2026-05-24 |
| 9.29 | findByIdentifier fallback to previousIdentifiers | #47 | 2026-05-24 |

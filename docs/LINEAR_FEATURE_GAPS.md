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

### 2.1 Rule-Based Automations 🔲

Linear's automation engine: "When [trigger] → [action]". Enables PM/ops teams to
automate repetitive triage and routing tasks.

**Planned scope:**
- `AutomationRule` DB model: `triggerType`, `triggerConfig` (JSONB), `actionType`,
  `actionConfig` (JSONB), `teamId`, `enabled`
- Triggers: issue_created, issue_updated (field_changed), issue_state_changed,
  cycle_started, cycle_completed, comment_created
- Actions: set_state, set_assignee, set_priority, set_label, add_to_cycle,
  add_to_project, send_notification, create_sub_issue
- Evaluation engine: `AutomationService.evaluateForIssue(issue, event)` — called
  from issue/comment resolvers fire-and-forget
- Admin UI: `/settings/automations` — rule builder

**Estimated size:** Large (2–3 sprint equivalents)

---

## Priority 3 — Views & Planning

### 3.1 Timeline / Gantt View 🔲

Gantt-style view showing issues and projects on a date axis. Linear shows this per-team
and per-project.

**Planned scope:**
- New `layout: 'timeline'` option in `CustomView.layout`
- `TimelineView` React component using `@dnd-kit` for drag-resize
- Issue date bars rendered from `startDate` / `dueDate` (add `startDate` to Issue if
  needed)
- Project timeline: uses `project.startDate` / `project.targetDate`
- Cycle swimlanes: overlay cycle date ranges

**Estimated size:** Large (2 sprint equivalents)

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

---

## Priority 6 — Analytics & Insights

### 6.1 Comprehensive Analytics 🔲

Linear's Insights page: lead-time histogram, cycle-time distribution, flow metrics,
date range selector, cross-team aggregates.

**Planned scope (additive to existing analytics):**
- Lead-time and cycle-time histograms (SQL window functions over `started_at` / `completed_at`)
- Time-in-state breakdown per issue (requires state change events logged with timestamps)
- Date range selector (all analytics currently show all-time only)
- Cross-team aggregate view
- Throughput trend (weekly/monthly)
- Cycle metrics: scope creep %, carryover rate, commitment vs delivery

**Estimated size:** Large (2 sprint equivalents)

### 6.2 Project Progress History Charts ✅ _(PR #38, shipped 2026-05-18)_

The `completedIssueCountHistory` / `scopeHistory` JSONB columns exist on `Project`
but are never populated. Wire up the writer and add sparkline charts.

**Planned scope:**
- Populate history arrays in `ProjectService.update()` and nightly cron job
- Sparkline chart component in project list / detail

**Estimated size:** Small (0.5 sprint)

---

## Priority 7 — Collaboration & Editor

### 7.1 Collaborative Editing (YJS) 🔲

Real-time live cursors and conflict-free co-editing on issue descriptions and documents.

**Planned scope:**
- Add `hocuspocus` server (or Liveblocks) alongside the WebSocket server
- TipTap `CollaborationCursor` extension
- `descriptionState Bytes` column already exists on `Issue`; use it for YJS document state

**Estimated size:** Large (2 sprint equivalents)

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
- See PATTERNS.md §48

**Still TODO (separate PR):**
- Comment / IssueRelation / search resolvers — guests can still read
  comments and create relations on issues they don't own
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

**Not yet shipped:** Hiding snoozed issues from list views (requires a filter
extension; the `Issue.snoozedUntilAt` field is exposed so clients can hide
client-side in the meantime).

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

### 9.4 @mention Issues and Projects 🔲

Currently `@` in the editor only suggests users. Extend to suggest issues
(by identifier) and projects (by name).

**Planned scope:**
- Separate TipTap mention extension instances per type (users, issues,
  projects)
- Client-side fuzzy search against `issueStore` / `projectStore`
- Render as pill with icon + identifier

**Estimated size:** Small (frontend-only — no schema)

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

### 9.6 Issue Activity Log Query 🚧

`IssueActivity` rows are written on every tracked field change (see
`TRACKED_ACTIVITY_FIELDS` in `src/server/graphql/resolvers/issue.ts`) and
exposed via the `issueActivities(issueId)` query. The internal component
already exists — but tracked-field coverage is narrower than Linear's
audit log:

**Gap:** Linear logs git events, label add/remove, project move, cycle
change, comment-resolved, etc. We only track stateId/assigneeId/priority/
title/estimate/dueDate/projectId/trashed/cycleId/parentId.

**Estimated size:** Small (add fields to the tracked list, write activity
rows from comment / label resolvers).

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

### 9.13 Roadmap Drag Reorder 🔲

`/[workspace]/projects` shows projects on a date axis but bars aren't
drag-resizable / drag-shiftable. Linear's roadmap is fully interactive.

**Planned scope:**
- `@dnd-kit` on the project bar component
- Server: `projectUpdate({ startDate, targetDate })` already exists; client
  just needs to wire drag-end → mutation

**Estimated size:** Small-Medium (frontend-only)

### 9.14 Notion-Style Collapsible Sidebar Sections 🔲

Sidebar currently has fixed sections (Teams, Settings). Linear lets users
collapse / expand / reorder their sections.

**Planned scope:**
- `UserSidebarPreferences` JSONB column on `User` (collapsed-section ids,
  custom order)
- Drag-reorder via `@dnd-kit`

**Estimated size:** Small

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

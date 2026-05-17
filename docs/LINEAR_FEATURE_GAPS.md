# Linear Feature Gaps — Tracking Document

This document tracks all features present in Linear that are missing or incomplete in
this codebase, organized by priority. Each item links to the PR that implements it once
shipped.

**Legend:** 🔲 Not started · 🚧 In progress · ✅ Done

---

## Priority 1 — High-impact, Core Differentiators

### 1.1 GitHub Integration 🚧 _(PR: claude/audit-linear-features-0qIDa)_

Connect a GitHub account to a workspace so PRs are automatically linked to issues and
issues can be auto-closed on merge.

**Scope:**
- OAuth flow: `/api/integrations/github` → `/api/integrations/github/callback`
- `GitHubIntegration` DB model — one per org, stores access_token + webhook_secret
- `GitHubPullRequest` DB model — linked PRs per issue (pr_number, title, url, state, repo)
- Webhook receiver: `POST /api/integrations/github/webhook` — validates HMAC-SHA256, handles `pull_request` events
- Issue auto-linking: parse issue identifier from PR title or head branch (regex `[A-Z]+-\d+`)
- Auto-close issue on PR merge (transitions to first `completed` workflow state)
- GraphQL: `GitHubIntegration` type, `githubIntegration` query, `githubConnect`/`githubDisconnect` mutations
- `Issue.pullRequests` resolver returns linked PRs
- Settings page: `/settings/integrations` — Connect/Disconnect button, webhook instructions
- Issue detail panel: linked PRs section (state badge, PR title, repo, link)

**Env vars needed:**
```
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=   # set in GitHub org/repo webhook settings
```

**Files touched:**
- `prisma/schema.prisma` — new models
- `prisma/migrations/20260517000000_github_integration/migration.sql`
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

### 1.2 Email Notifications 🚧 _(PR: claude/audit-linear-features-0qIDa)_

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

### 3.2 Sub-Initiatives 🔲

Allow initiatives to be nested (up to 5 levels deep) for large strategic hierarchies.

**Planned scope:**
- `Initiative.parentId` self-relation (already designed in PATTERNS §39 comments)
- Progress rollup up the tree
- UI: nested list in `/initiatives` page, breadcrumb in detail panel

**Estimated size:** Medium (1 sprint)

### 3.3 Initiative Updates Timeline 🔲

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

### 6.2 Project Progress History Charts 🔲

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

### 7.2 Image Paste into Editor 🔲

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

### 8.1 Favorites / Sidebar Pinning 🔲

Pin issues, views, and projects to the sidebar for quick access.

**Planned scope:**
- `Favorite` DB model: `userId`, `entityType`, `entityId`, `sortOrder`
- GraphQL: `favoriteCreate/Delete` + `favorites` query
- Sidebar "Favorites" section above Teams
- Included in bootstrap payload

**Estimated size:** Small (0.5 sprint)

### 8.2 Guest Role Enforcement 🔲

`TeamMemberRole.guest` is defined but visibility/write checks don't test it anywhere.
Guests should only see issues assigned to them or issues they created.

**Planned scope:**
- Add `isGuestInTeam(userId, teamId)` helper
- Gate `issues` query to exclude guest-inaccessible issues
- Block guest users from creating issues in teams they don't own issues in

**Estimated size:** Small (0.5 sprint)

### 8.3 Issue Reactions 🔲

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

### 8.6 Workspace-Level Custom Fields 🔲

Currently `CustomFieldDefinition` is always scoped to a team (`teamId` NOT NULL).
Workspace-level fields (`teamId NULL`) would allow consistent fields across all teams.

**Planned scope:**
- Make `teamId` nullable on `CustomFieldDefinition` (already nullable in schema, just
  not exposed via API)
- Update `customFieldDefinitionCreate` to accept `teamId: null`
- UI: "Workspace fields" section in `/settings`

**Estimated size:** Small (0.5 sprint)

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

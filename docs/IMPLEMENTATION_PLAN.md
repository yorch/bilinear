# Implementation Plan

## Issue Tracker — Open-Source Linear Alternative

**Version:** 1.2
**Date:** April 2026

> **Status snapshot (2026-04-17):** Phase 1 complete. Phase 2 (Sprints 13-26) complete — all items shipped, including the Sprint 23-24 list-column picker, CSV export, and the Sprint 25-26 cascade + property-inheritance work. Phase 3 in progress — Sprints 27-28 (editor: mostly shipped in PR #27), 29-30 (comments), 33-34 (analytics + burndown + Sentry), and **35-36 (Documents, shipped in PR #28)** are done or near-done; Sprints 31-32 partially shipped; Sprints 37-40 not started. Phase 4 still unstarted except **Sprint 53-54 Public Roadmaps shipped in PR #28**. Phase 5 not started. See each sprint section for the per-item breakdown.

---

## How to Use This Document

This is the **high-level roadmap**. For Phase 1, each sprint has a detailed implementation doc in `docs/sprints/` with file paths, schema definitions, API contracts, acceptance criteria, and cross-references:

| Sprint                                | Detail Doc                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| Sprint 1-2: Project Setup & Auth      | [`docs/sprints/01-02-project-setup-auth.md`](sprints/01-02-project-setup-auth.md)         |
| Sprint 3-4: Teams & Workflows         | [`docs/sprints/03-04-teams-workflows.md`](sprints/03-04-teams-workflows.md)               |
| Sprint 5-6: Issue CRUD & List View    | [`docs/sprints/05-06-issue-crud-list.md`](sprints/05-06-issue-crud-list.md)               |
| Sprint 7-8: Sync Engine               | [`docs/sprints/07-08-sync-engine.md`](sprints/07-08-sync-engine.md)                       |
| Sprint 9-10: Search & Command Palette | [`docs/sprints/09-10-search-command-palette.md`](sprints/09-10-search-command-palette.md) |
| Sprint 11-12: Polish & Performance    | [`docs/sprints/11-12-polish-performance.md`](sprints/11-12-polish-performance.md)         |
| Sprint 13-14: Projects                | [`docs/sprints/13-14-projects.md`](sprints/13-14-projects.md)                             |

> **Pattern Documentation:** `docs/PATTERNS.md` is the living onboarding document for all contributors. It is updated each sprint as new patterns are established. All subsequent sprints should follow the patterns in that document.

> **Phase 2 sprints** (13-26, excluding 23-24 which is unstarted) were implemented without dedicated sprint detail docs. New Phase 3+ features should still create detail docs when a sprint is started, following the format established in `docs/sprints/`.

---

## Phase 1: Foundation (Weeks 1-12)

### Sprint 1-2: Project Setup & Auth ✅ COMPLETE

**Goal:** Working app shell with authentication

- [x] Initialize Next.js project structure (already bootstrapped)
- [x] Set up PostgreSQL database with Prisma 7
- [x] Create migration for: organizations, users, organization_members, auth_tokens
- [x] Implement email magic link authentication
  - POST /auth/email → send magic link code
  - POST /auth/verify → exchange code for JWT
  - JWT access tokens (24h) + refresh tokens (30d)
- [x] Implement Google OAuth flow
- [x] Set up GraphQL API server (Apollo Server — server only; frontend uses raw `fetch`)
- [x] Implement `viewer` query and `organization` query
- [x] Create basic app layout: sidebar shell, main content area
- [x] Auth pages: login, magic link verification
- [x] Protected routes middleware

**Deliverable:** Users can sign up, log in, and see empty workspace ✅

### Sprint 3-4: Teams & Workflow States ✅ COMPLETE

**Goal:** Teams with customizable workflows

- [x] Create migrations: teams, team_memberships, workflow_states
- [x] Implement team CRUD (GraphQL mutations + queries)
- [x] Implement workflow state CRUD with category constraints
- [x] Seed default workflow states per team (Backlog, Todo, In Progress, Done, Canceled; Triage only when enabled)
- [x] Team settings page: name, description, identifier (key), parent team, private toggle, triage toggle, delete-with-issues flow (`src/app/(workspace)/[workspace]/team/[key]/settings/page.tsx`)
- [x] Sidebar: team navigation with nested sub-team hierarchy, root/child rendering, collapsed mini-icons (`src/components/layouts/sidebar.tsx`)
- [x] Team creation modal: name, key auto-derive, description, private toggle (`src/components/teams/create-team-modal.tsx`)
- [x] Team members management UI: add/remove, owner toggle, role selector (admin/member/guest) (`src/components/teams/team-member-management.tsx`)

**Deliverable:** Teams with workflow states, full CRUD, sidebar navigation, settings and member management UI ✅

### Sprint 5-6: Issue CRUD & List View ✅ COMPLETE

**Goal:** Create, view, edit issues in list view

- [x] Create migrations: issues, issue_labels, issue_label_assignments
- [x] Issue CRUD mutations (create, update, archive, delete)
- [x] Issue query with Relay cursor pagination
- [x] Issue identifier generation (TEAM-123)
- [x] List view component with issues grouped by workflow state (collapsible groups)
- [x] Configurable properties: status, priority, assignee, labels, due date
- [x] Issue creation modal (C shortcut)
- [x] Issue detail panel (right side slide-in, Escape to close)
- [x] Inline field editing in list view (click to change status, assignee, etc.)
- [x] Priority system (5 levels, icons, colors)
- [x] Label CRUD and assignment
- [x] Due date picker with color coding
- [x] Shared frontend types (`src/types/issues.ts`), shared gql helper (`src/lib/graphql.ts`)
- [ ] TanStack Virtual list virtualization _(removed — per-group virtualizer was broken; plain rendering used; page-level virtualization deferred to Sprint 7-8)_

**Deliverable:** Full issue list view with create/edit/archive functionality ✅

### Sprint 7-8: Real-Time Sync Engine ✅ COMPLETE

**Goal:** Local-first architecture with optimistic updates

- [x] Create sync_actions table (BIGSERIAL monotonic IDs, serialized as String in GraphQL)
- [x] Implement sync action generation on every mutation (Issue, Team, TeamMembership, WorkflowState, IssueLabel)
- [x] Bootstrap endpoint: GET /api/sync/bootstrap (line-delimited stream with lastSyncId in metadata)
- [x] Delta endpoint: GET /api/sync/delta?lastSyncId=X
- [x] Standalone WebSocket server (port 3001, `yarn ws:server`) with JWT query-param auth
- [x] Redis pub/sub for real-time broadcast (channel: `sync:<orgId>`; auto-unsubscribe when org has no clients)
- [x] Client-side: Dexie.js AppDatabase (IndexedDB schema + 7 tables)
- [x] Client-side: MobX stores (IssueStore, TeamStore, UserStore, LabelStore, WorkflowStateStore, SyncStore, UIStore)
- [x] Client-side: SyncManager with concurrent-call guards and Dexie transaction for atomic bootstrap
- [x] Client-side: TransactionQueue — serial mutations, 3 retries with exponential backoff (1s/3s/10s)
- [x] Optimistic update pipeline: MobX → TransactionQueue → server confirm/rollback via delta sync
- [x] Offline detection (`online`/`offline` events) and reconnection with delta catch-up
- [x] Issue label IDs denormalized onto issues (from IssueLabelAssignment join table) for client-side resolution
- [x] Team issues page migrated to local-first: `observer()`, `useMemo` from stores, `txQueue` per mount

**Deliverable:** Real-time sync across multiple browser tabs/users, offline support ✅

### Sprint 9-10: Search & Command Palette ✅ COMPLETE

**Goal:** Fast search and keyboard-first navigation

- [x] PostgreSQL full-text search with GIN indexes
- [x] searchIssues query with fuzzy matching
- [x] Issue ID instant jump (type ENG-123 → navigate)
- [x] Command palette component (Cmd+K)
  - Recent items on open
  - Fuzzy search across issues, projects, views
  - Action commands (create issue, set status, etc.)
  - Nested command flows (e.g., "Set status" → show options)
  - Keyboard navigation (arrows, Enter, Escape)
- [x] Global keyboard shortcuts system
  - C: create issue, J/K: navigate, X: select, Enter: open
  - S: status, A: assignee, P: priority, L: label
  - I: inbox, G+I: my issues
- [x] Right-click context menu on issues

**Deliverable:** Full keyboard-driven navigation matching Linear's shortcut system

### Sprint 11-12: Polish & Performance ✅ COMPLETE

**Goal:** Production-ready foundation

- [x] Dark mode / light mode with system preference (next-themes, `ThemeProvider`, `ThemeToggle`)
- [x] Theme system (CSS variables via TailwindCSS v4 + `dark:` variants)
- [x] Loading states: skeleton shimmer animations (`IssueListSkeleton`, `SidebarSkeleton`, etc.)
- [x] Error boundaries and error states (`ErrorBoundary`, `SectionError`)
- [x] Toast notification system (sonner, `src/lib/toast.ts`)
- [x] Responsive layout (sidebar collapse — `UIStore.sidebarCollapsed`, `Cmd+B`, localStorage)
- [x] Performance: bundle analysis (`ANALYZE=true yarn analyze`, `@next/bundle-analyzer`)
- [x] Performance: code splitting (lazy `CommandPalette` + `LazyIssueDetailPanel` via `React.lazy`)
- [ ] Performance: virtualized list optimization (deferred — large list perf not yet needed)
- [x] E2E tests for critical paths (auth, issue CRUD, sync, offline, keyboard shortcuts)
- [x] API rate limiting implementation (Redis fixed-window, 5 000 req/hr + complexity budget)
- [x] Structured logging (pino + pino-pretty, `src/server/lib/logger.ts`; Sentry integration deferred)
- [x] **Docker Compose packaging** — `deployment/docker-compose.yaml` builds full stack (app + ws-server + PostgreSQL + Redis); `README.md` points to it
- [x] `.env.example` covering every required variable with documentation
- [ ] Startup migration check: warn if pending migrations on boot
- [x] `README.md` self-hosting section: prerequisites, `docker compose up`, first-run walkthrough (`deployment/` section)
- [ ] Backup/restore documentation for PostgreSQL volume
- [ ] Minimum resource validation: documented requirements for $6/mo VPS (1 vCPU / 1GB RAM)

**Deliverable:** Polished, performant MVP with auth, issues, teams, real-time sync — fully self-hostable via Docker Compose

---

## Phase 2: Essential Features (Weeks 13-26)

### Sprint 13-14: Projects ✅ COMPLETE

- [x] Create migrations: projects, project_teams, project_members, project_milestones, project_updates
- [x] Project CRUD with cross-team support
- [x] Project status system (Backlog/Planned/In Progress/Completed/Canceled)
- [x] Project health indicator (On Track/At Risk/Off Track)
- [x] Project lead assignment
- [x] Start/target date with resolution (day/month/quarter)
- [x] Project list and detail views
- [x] Project milestones CRUD (backend + store; UI in detail view)
- [x] Project updates CRUD with health selection (create, edit, delete, real-time sync)
- [x] Progress tracking: `Project.progress` / `Project.scope` computed from completed vs total issues, exposed via GraphQL and rendered as bar in list + detail views (`project.service.ts#getProgress`)
- [x] Assign issues to projects via Shift+P shortcut (`src/app/(workspace)/[workspace]/team/[key]/page.tsx`)
- [ ] Progress _charts_ over time (scope history, completion trend) — schema has history fields but they are unpopulated and not exposed via GraphQL; tracked under Sprint 33-34

**Deliverable:** Project list + detail views with updates feed, milestones, progress bars, real-time sync via WebSocket ✅

### Sprint 15-16: Cycles (Sprints) ✅ COMPLETE

- [x] Create migration: `cycles` table (`Cycle` model in `prisma/schema.prisma`)
- [x] Cycle CRUD with team configuration (cycle service + resolvers)
- [x] Auto-create upcoming cycles per team configuration
- [x] Active / upcoming / completed cycle states
- [x] Cycle duration and cooldown periods stored on `Team`
- [x] Cycle list and detail views (`src/components/cycles/cycle-list-view.tsx`, `cycle-detail-view.tsx`)
- [x] Assign issues to cycles via `Q` shortcut (`src/app/(workspace)/[workspace]/team/[key]/page.tsx`)
- [x] Manual rollover of unfinished work to next cycle (`cycleRollover` mutation + button in cycle detail view)
- [ ] **Auto**-rollover at cycle boundary — manual button only; no automatic trigger when cycle ends
- [ ] Capacity estimation based on velocity (deferred — rolls into Sprint 33-34 analytics)
- [x] Burndown chart on cycle detail (`BurndownChart` SVG component with ideal line + actual line)

### Sprint 17-18: Board View (Kanban) ✅ COMPLETE

- [x] Board view component with status columns (`src/components/issues/board-view.tsx`)
- [x] Issue cards (title, ID, priority icon, assignee avatar, label dots)
- [x] Drag-and-drop between columns (status change) via @dnd-kit
- [x] View toggle `Alt+1` list / `Alt+2` board (`src/components/issues/view-toggle.tsx`)
- [x] Drag within column (reorder) — `sortOrder` midpoint calculation on drop
- [ ] Multi-select drag — deferred
- [x] Swimlanes (group by assignee, priority) — `BoardSwimlaneBy` prop, grouping logic in `board-view.tsx`

### Sprint 19-20: Advanced Filtering, Custom Views & Backlog Management ✅ COMPLETE

- [x] Filter builder UI (add filter → field → operator → value) (`src/components/issues/filter-builder.tsx`)
- [x] Filter pills/chips display
- [x] Filter fields: status, assignee, creator, label, priority, project, cycle, estimate, dates
- [x] Save filter as custom view (`src/components/views/save-view-modal.tsx`, `CustomView` model)
- [x] Custom view CRUD (backend + store)
- [x] Sidebar: custom views under team
- [x] Sort by: priority, status, assignee, created, updated, due date
- [x] Backlog view route (`src/app/(workspace)/[workspace]/team/[key]/backlog/page.tsx`)
- [x] Backlog displays Backlog + Unstarted state categories, sortable by priority/estimate/age
- [x] Bulk operations from backlog: set priority, set estimate, move to cycle, archive
- [x] Inline estimate + priority editing directly in backlog rows
- [x] "Move to cycle" action from backlog
- [x] AND/OR composition in filter builder (`FilterComposition` toggle in filter-builder.tsx)
- [ ] Drag-to-reorder within priority bands (manual backlog ordering)
- [ ] Multi-level sorting
- [ ] Visual staleness indicators on backlog items

### Sprint 21-22: Notifications & Activity ✅ COMPLETE

- [x] Create migrations: `notifications`, `notification_subscriptions`, `issue_activities`
- [x] Notification creation on: assign, mention, comment, status change
- [x] Notification inbox UI (`src/components/notifications/notification-inbox.tsx`)
- [x] Read/unread state, mark all read
- [x] Auto-subscribe rules (create, assign, mention)
- [x] Issue activity history timeline (`src/components/issues/activity-timeline.tsx`)
- [x] Snooze notifications (`notificationSnooze` mutation, `snoozedUntilAt` field)
- [ ] Manual subscribe/unsubscribe via `Shift+S` shortcut (deferred — no hotkey bound)
- [ ] Activity collapsing for dense histories (deferred)

### Sprint 23-24: Custom Fields ✅ COMPLETE

- [x] Create migrations: `custom_field_definitions` (team-scoped), `custom_field_values` (separate table keyed by `(issueId, definitionId)`)
- [x] Field types: `text`, `number`, `date`, `select`, `multi_select`, `url`, `checkbox`
- [x] Custom field CRUD (GraphQL mutations + queries)
- [x] Max 20 fields per team; validation enforced at service layer
- [x] Custom field values included in mutations via `customFieldValuesSet` (bulk upsert per issue)
- [x] Issue detail panel: custom fields section below standard properties (`src/components/custom-fields/custom-fields-editor.tsx`)
- [x] Filter builder: custom fields as filterable dimensions (filter-engine `custom` field + per-issue value resolver)
- [x] Sync: `custom_field_definitions` and `custom_field_values` included in bootstrap + delta payloads; definition deletes cascade-delete values on the client
- [x] MobX store: `CustomFieldStore` (definitions pool + per-issue value map keyed `issueId:definitionId`)
- [x] List view: optional columns for custom fields (toggled via column picker — `src/components/issues/column-picker.tsx`, `useVisibleColumns` hook with localStorage persistence; custom fields render as read-only cells with per-type formatting)
- [x] Custom field values included in CSV export (`CsvExportButton` on the team page list view uses `src/lib/csv-export.ts`; exports the current filtered issues with one column per active custom-field definition, option labels resolved for select / multi_select)

**Note:** Custom fields do not replace Priority, Estimate, or Status — those remain opinionated and fixed. Custom fields are additive metadata only.

### Sprint 25-26: Sub-Issues, Relations & Templates ✅ COMPLETE

- [x] Sub-issue creation and management via `Issue.parentId` (`src/components/issues/sub-issue-list.tsx`)
- [x] Multiple nesting levels (recursive parent relation)
- [x] Issue relations CRUD — related, blocks, blocked by, duplicate (`IssueRelation` model, `src/components/issues/relations-section.tsx`)
- [x] Visual indicators for blocking/blocked (relations section)
- [x] Issue template CRUD (`IssueTemplate` model, `src/components/issues/template-selector.tsx`)
- [x] Template application via creation modal
- [x] Property inheritance from parent issue (project + milestone + cycle auto-applied to children at create time; `IssueService.create`)
- [x] Auto-close cascade — both directions, gated per-team (`autoCloseParentIssues` closes parent when all children done; `autoCloseChildIssues` closes open children when parent closes)
- [x] `Alt+C` shortcut to open template picker — implemented in `create-issue-modal.tsx`
- [x] Default templates per team — auto-applied on modal open when a team template has `isDefault: true` (`create-issue-modal.tsx:111`)

---

## Phase 3: Organization (Weeks 27-40)

### Sprint 27-28: Rich Text Editor ✅ MOSTLY COMPLETE

Shipped in PRs #24 (@mentions + image upload) and #27 (file uploads, embeds,
editor enhancements). Remaining items are small.

- [x] TipTap editor integration (`src/components/editor/tiptap-editor.tsx`)
- [x] Markdown-equivalent support: bold, italic, underline, strikethrough, headings, bullet/ordered/task lists, code blocks with syntax highlighting (lowlight), tables with resizable columns, blockquotes, horizontal rule, links
- [x] @mentions for **users** via `@tiptap/extension-mention` and `src/components/editor/mention-list.tsx`
- [x] Image upload via toolbar — persisted to the `File` model through `POST /api/upload` (see `file-attachments.tsx:80`)
- [x] File attachments as a separate in-issue component (`src/components/issues/file-attachments.tsx`)
- [x] Slash commands — `SlashCommands` extension wired into `tiptap-editor.tsx:209`; popup driven by `slash-command-list.tsx`
- [x] Mermaid diagram rendering (`mermaid-node.tsx`, wired into the extension list)
- [x] Collapsible sections (`details-node.ts` / details-accordion node)
- [x] Embed support — YouTube, Loom, and generic embeds via `embed-node.tsx`
- [ ] @mentions for **issues** and **projects** (users only today)
- [ ] Image drag-and-drop (toolbar-only today)
- [ ] Collaborative editing (YJS / Hocuspocus)

### Sprint 29-30: Comments & Reactions ✅ COMPLETE (partial)

- [x] Threaded comments on issues (`Comment.parentId`, `src/components/issues/comment-thread.tsx`)
- [x] Rich text (TipTap) in comments
- [x] @mentions in comments (wired through `TipTapEditor.mentionUsers`, triggers notifications)
- [x] Emoji reactions on comments (`CommentReaction` model)
- [x] Comment resolution / unresolve (`Comment.resolvedAt`, `resolvedById`)
- [ ] Threaded comments on **projects** (issue-only today)
- [ ] Reactions on issues and project updates (comments only today)
- [ ] Convert comment to sub-issue
- [ ] Quote reply

### Sprint 31-32: Sub-Teams, Advanced Roles & SAML/SCIM 🟡 PARTIAL

- [x] Sub-team hierarchy — `Team.parentId` with `TeamHierarchy` relation; parent selector in team settings; `TeamService.findChildren()`
- [x] Private teams — `Team.private` flag; visibility filtering in `teamResolvers.Query.teams`
- [x] Team owner role — `TeamMembership.isOwner` + `TeamMemberRole` (`admin` / `member` / `guest`) with UI toggle in `team-member-management.tsx`
- [x] Workspace admin settings page — `src/app/(workspace)/[workspace]/settings/page.tsx` (org info, teams, member roles)
- [ ] Sub-team hierarchy up to 5 levels deep (current implementation supports parent/child; depth limit not enforced)
- [ ] Inheritance of cycle schedules / estimation config from parent team (schema fields exist per-team, no `getEffectiveConfig()` logic)
- [ ] Guest role **enforcement** — guest is present as a role value and rendered in UI, but access control only checks `TeamMembership` existence, not role
- [ ] Cross-team issue visibility rules — issues are strictly scoped by `teamId` today (`requireTeamMember()`); no cross-team visibility logic
- [ ] **SAML SSO** — SP-initiated SAML 2.0 with identity provider metadata URL; JIT user provisioning on first login; free for self-hosted deployments
- [ ] **SCIM** — user/group provisioning via SCIM 2.0 API; auto-deprovision on directory removal; free for self-hosted deployments
- [ ] **Audit log** — append-only ledger of security-relevant events (auth, permission changes, team/member changes, data exports); filterable/searchable; free for self-hosted deployments
- [ ] IP restriction rules (allowlist by CIDR) — workspace admin setting

### Sprint 33-34: Estimates, Progress Tracking & Team Analytics 🟡 PARTIAL

- [x] Per-team estimation scale configuration (`Team.issueEstimationType`)
- [x] Estimate assignment via `Shift+E` shortcut (`src/app/(workspace)/[workspace]/team/[key]/page.tsx`)
- [x] Team analytics dashboard route (`src/app/(workspace)/[workspace]/team/[key]/analytics/page.tsx`) — stat cards + CSS-only bar charts (no chart library)
- [x] 8-week velocity chart (weekly bins, issues-only) — partial implementation of the planned cycle-based, points-inclusive velocity with 3/6/12-cycle rolling averages
- [x] Average cycle-time stat (days, started→completed) — partial implementation of the planned lead-time / cycle-time / time-in-state histograms
- [x] Assignee workload bar chart — partial team health panel (workload only; no overdue or unestimated breakdowns)
- [x] Cycle detail burndown chart (`BurndownChart` SVG with ideal line + actual remaining issues; burnup not yet implemented)
- [ ] Project progress charts over time — schema has `scopeHistory` / `completedScopeHistory` / `issueCountHistory` / `completedIssueCountHistory` JSON fields on `Project`, but they are never populated or exposed via GraphQL
- [ ] Live completion predictions
- [ ] Cycle-based velocity chart with rolling averages (3/6/12 cycles) and story-point velocity
- [ ] Throughput trend chart (weekly / monthly, separate from velocity)
- [ ] Cycle metrics: scope creep, carryover rate
- [ ] Flow metrics: lead time histogram, cycle time histogram, time-in-state distribution
- [ ] Team health: overdue count, unestimated percentage
- [ ] Date range selector (current cycle / last N cycles / 30-180 days / custom) — analytics is all-time today
- [ ] CSV export
- [ ] Workspace-level aggregate analytics view (cross-team)

### Sprint 35-36: Documents (Linear Docs) ✅ SHIPPED (PR #28)

- [x] Migration `20260417000001_documents` — `documents` table with parent hierarchy
- [x] Document CRUD — `documentCreate / Update / Archive / Delete` mutations, `DocumentService` + `DocumentStore`
- [x] Associate documents with teams and projects via `teamId` / `projectId`; nest under `parentId`
- [x] Document listing (`documents(teamId?, projectId?)`) and left-nav tree in the sidebar
- [x] TipTap-powered rich-text editor on `/documents/[id]` — shares the editor extension set with issues
- [ ] Document search (relies on general full-text search; no dedicated docs search UI)
- [ ] Comments on documents
- [ ] Document templates
- [ ] Initiative association (depends on Sprint 57-58 Initiatives)
- [ ] Collaborative editing (YJS / Hocuspocus) — shared with Sprint 27-28

### Sprint 37-38: Triage Workflow

- [ ] Enable triage per team
- [ ] Triage inbox view
- [ ] Accept / Decline / Mark Duplicate / Snooze actions
- [ ] Keyboard shortcuts (1=Accept, 2=Duplicate, 3=Decline, H=Snooze)
- [ ] Triage responsibility assignment
- [ ] Require priority before leaving triage (optional)

### Sprint 39-40: Automated Workflows & Rules Engine

- [ ] Create migrations: automation_rules, automation_rule_conditions, automation_rule_actions, automation_run_log
- [ ] Rules CRUD (GraphQL mutations + queries)
- [ ] Trigger types: issue_created, status_changed, label_added, label_removed, assignee_changed, priority_changed, cycle_assigned, due_date_approaching, sla_risk_threshold
- [ ] Condition types: team, priority, label, assignee, state_category, has_estimate, has_sub_issues
- [ ] Action types: set_status, assign_user, add_label, remove_label, set_priority, add_to_cycle, post_comment, send_notification, trigger_webhook
- [ ] Built-in automations: auto-close (inactivity), auto-archive (stale completed), cycle rollover, priority escalation on SLA risk
- [ ] Git-linked automations (branch created → In Progress; PR merged → Done) — activated when GitHub integration is enabled
- [ ] Rules management UI per team (list, create, edit, enable/disable, reorder)
- [ ] Dry-run mode: preview affected issues before activating a rule
- [ ] Rule execution log (audit trail per rule: timestamp, issue, action taken)
- [ ] Global rules for workspace admins
- [ ] Rule execution via BullMQ background queue (`automation-dispatch` queue)

---

## Phase 4: Integrations (Weeks 41-56)

### Sprint 41-42: GitHub Integration

- [ ] GitHub OAuth app setup
- [ ] Link PRs to issues via branch name / PR title / magic words
- [ ] Auto-status mapping: branch → In Progress, PR → In Review, merge → Done
- [ ] Display PR status, reviews, CI checks on issues
- [ ] Git branch name copy (issue.branchName)
- [ ] Commit/PR linkback messages

### Sprint 43-44: Slack Integration

- [ ] Slack app setup (OAuth, events API)
- [ ] /linear slash command for issue creation
- [ ] Message actions (create issue from message)
- [ ] Notification mirroring to Slack DM
- [ ] Team/project channel notifications
- [ ] Rich unfurls for issue/project links
- [ ] Bidirectional thread sync (Slack ↔ Linear comments)

### Sprint 45-46: Webhooks

- [ ] Webhook CRUD (GraphQL + settings UI)
- [ ] Event dispatch for 14 resource types
- [ ] HMAC-SHA256 signature generation
- [ ] Retry logic (1m, 1h, 6h) via BullMQ
- [ ] Auto-disable persistently failing webhooks
- [ ] Webhook delivery logs

### Sprint 47-48: Import/Export

- [ ] CSV import with field mapping
- [ ] Jira import (API-based)
- [ ] GitHub Issues import
- [ ] Asana import
- [ ] Duplicate detection during import
- [ ] CSV export
- [ ] Bulk delete of imported data (rollback)

### Sprint 49-50: OAuth2 Provider

- [ ] OAuth2 authorization server
- [ ] App registration and management
- [ ] Scopes: read, write, issues:create, comments:create, admin
- [ ] Token lifecycle: 24h access, refresh tokens
- [ ] Actor modes: user vs app

### Sprint 51-52: API SDK & Developer Experience

- [ ] TypeScript SDK auto-generation from GraphQL schema
- [ ] SDK: chained model access, pagination helpers, raw query support
- [ ] API documentation (generated from schema)
- [ ] Rate limiting documentation
- [ ] API key management UI
- [ ] Developer portal

### Sprint 53-54: Public Roadmaps ✅ SHIPPED (PR #28)

A differentiator vs Linear. Read-only, public-facing view of product progress.
Shipped ahead of schedule alongside the Documents feature.

- [x] Migration `20260417000002_public_roadmaps` — `public_roadmaps` table + `projects.roadmap_visible` column
- [x] Per-org public roadmap config (`publicRoadmapUpsert` mutation)
- [x] Per-project exposure toggle — `projectSetRoadmapVisible(id, visible)` mutation + `Project.roadmapVisible`
- [x] Public URL scheme: `/r/[slug]` — unauthenticated route, served server-side
- [x] Roadmap page shows projects with name, icon/color, status, health, target date, and milestone progress counts (`RoadmapProject` type)
- [x] Does **not** expose issues, comments, assignees, or internal notes
- [x] Optional password protection — SHA-256 hash on `public_roadmaps.password_hash`; client sends plaintext over HTTPS to `publicRoadmapPage(slug, password?)`
- [x] Roadmap settings page under Workspace Settings → Public Roadmap
- [ ] Embeddable via `<iframe>` (headers not yet relaxed)
- [ ] Email subscribe + subscriber management
- [ ] Initiative-level grouping (depends on Sprint 57-58 Initiatives)

---

## Phase 5: Advanced (Weeks 57+)

### Sprint 57-58: Initiatives & Strategic Planning

- [ ] Initiative CRUD (name, status, health, owner, target date)
- [ ] Initiative ↔ project associations
- [ ] Sub-initiatives (nest up to 5 levels)
- [ ] Initiative updates
- [ ] Timeline view (Gantt-like) for projects
- [ ] Draggable timeline bars

### Sprint 59-60: SLAs

- [ ] SLA rule configuration
- [ ] Auto-apply SLA deadlines based on conditions
- [ ] Risk progression tracking (Low → Medium → High → Breached)
- [ ] Business day configuration
- [ ] SLA notifications (24h before breach)
- [ ] SLA filtering and reporting

### Sprint 61+: AI Features, Mobile, Desktop

- [ ] Triage intelligence (AI-powered assignee/label suggestions, pluggable providers)
- [ ] Document summarization
- [ ] Natural language filtering
- [ ] Coding tool deeplinks (launch Cursor/Claude Code from issue with pre-filled context)
- [ ] Mobile app (React Native) — iOS and Android
- [ ] Desktop app (Electron)
- [ ] Advanced analytics and AI-driven insights
- [ ] Customer tracking (Linear Asks equivalent)

---

## Technical Milestones

| Milestone | Target   | Criteria                                                                                       | Status                                        |
| --------- | -------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Alpha** | Week 12  | Auth + Issues + Teams + List View + Sync Engine + **Docker Compose deploy**                    | ✅ Reached                                     |
| **Beta**  | Week 26  | + Projects + Cycles + Board + Filters + Backlog + Notifications + **Custom Fields**            | ✅ Reached                                     |
| **RC1**   | Week 40  | + Rich Editor + Comments + Sub-teams + **SAML/SCIM** + Triage + Docs + Automations + Analytics | 🟡 In progress                                 |
| **v1.0**  | Week 54  | + GitHub + Slack + Webhooks + Import/Export + OAuth + **Public Roadmaps**                      | 🟡 In progress (Public Roadmaps shipped early) |
| **v2.0**  | Week 68+ | + Initiatives + SLAs + AI + Mobile + Desktop                                                   | ⬜ Not started                                 |

**RC1 gap analysis** (remaining work to hit RC1):

- Rich editor: issue/project @mentions, image drag-drop, collaborative editing (Sprint 27-28 — the bulk shipped in PR #27)
- Sub-teams: config inheritance, guest-role enforcement, cross-team visibility, SAML/SCIM, audit log, IP restrictions (Sprint 31-32)
- Analytics: burnup chart, cycle-based velocity with rolling averages, flow histograms, date ranges, CSV rollup, workspace-level aggregate (Sprint 33-34 — burndown + Sentry ✅ done)
- Documents: comments on docs, doc templates, initiative association (Sprint 35-36 — base CRUD shipped in PR #28)
- Triage: entirely unstarted (Sprint 37-38)
- Automations: entirely unstarted (Sprint 39-40)

**Custom Fields (Sprint 23-24) ✅ SHIPPED** — definitions CRUD, values CRUD,
filterable in list views, editable in the detail panel. See lines 233-247.

---

## Team Structure (Recommended)

| Role                   | Count | Focus                                  |
| ---------------------- | ----- | -------------------------------------- |
| **Tech Lead**          | 1     | Architecture, sync engine, code review |
| **Frontend Engineers** | 2-3   | React, MobX, UI components, editor     |
| **Backend Engineers**  | 2     | GraphQL, services, database, sync      |
| **Full-Stack**         | 1-2   | Integrations, webhooks, imports        |
| **Designer**           | 1     | UI/UX, component library, dark mode    |
| **QA Engineer**        | 1     | E2E testing, performance testing       |
| **DevOps**             | 0.5   | CI/CD, infrastructure, monitoring      |

---

## Risk Mitigation

| Risk                             | Mitigation                                                |
| -------------------------------- | --------------------------------------------------------- |
| Sync engine complexity           | Start with simple polling, iterate to WebSocket+IndexedDB |
| Performance with large datasets  | Virtualization from day 1, pagination mandatory           |
| Real-time collaboration (editor) | Use battle-tested YJS, start with single-user editing     |
| Migration from Linear            | Build robust import tooling early for dogfooding          |
| Feature creep                    | Strict phase gating, P0/P1/P2 prioritization              |
| Auth security                    | Use well-tested JWT libraries, regular security audits    |

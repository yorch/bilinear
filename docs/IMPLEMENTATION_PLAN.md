# Implementation Plan
## Issue Tracker — Linear Rebuild

**Version:** 1.1  
**Date:** April 2026

---

## How to Use This Document

This is the **high-level roadmap**. For Phase 1, each sprint has a detailed implementation doc in `docs/sprints/` with file paths, schema definitions, API contracts, acceptance criteria, and cross-references:

| Sprint | Detail Doc |
|--------|-----------|
| Sprint 1-2: Project Setup & Auth | [`docs/sprints/01-02-project-setup-auth.md`](sprints/01-02-project-setup-auth.md) |
| Sprint 3-4: Teams & Workflows | [`docs/sprints/03-04-teams-workflows.md`](sprints/03-04-teams-workflows.md) |
| Sprint 5-6: Issue CRUD & List View | [`docs/sprints/05-06-issue-crud-list.md`](sprints/05-06-issue-crud-list.md) |
| Sprint 7-8: Sync Engine | [`docs/sprints/07-08-sync-engine.md`](sprints/07-08-sync-engine.md) |
| Sprint 9-10: Search & Command Palette | [`docs/sprints/09-10-search-command-palette.md`](sprints/09-10-search-command-palette.md) |
| Sprint 11-12: Polish & Performance | [`docs/sprints/11-12-polish-performance.md`](sprints/11-12-polish-performance.md) |

> **Pattern Documentation:** `docs/PATTERNS.md` is the living onboarding document for all contributors. It is updated each sprint as new patterns are established. All subsequent sprints should follow the patterns in that document.

> **Phase 2+ sprints** will be broken into detailed docs following the same format once Phase 1 patterns are established and documented.

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
- [ ] Team settings page: name, key, timezone, estimation _(deferred — backend done, UI pending)_
- [ ] Sidebar: team navigation, team switcher _(partial — basic sidebar exists)_
- [ ] Team creation modal _(deferred)_
- [ ] Team members management UI _(deferred)_

**Deliverable:** Team + workflow state backend with GraphQL API ✅; settings UI deferred

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

### Sprint 9-10: Search & Command Palette
**Goal:** Fast search and keyboard-first navigation

- [ ] PostgreSQL full-text search with GIN indexes
- [ ] searchIssues query with fuzzy matching
- [ ] Issue ID instant jump (type ENG-123 → navigate)
- [ ] Command palette component (Cmd+K)
  - Recent items on open
  - Fuzzy search across issues, projects, views
  - Action commands (create issue, set status, etc.)
  - Nested command flows (e.g., "Set status" → show options)
  - Keyboard navigation (arrows, Enter, Escape)
- [ ] Global keyboard shortcuts system
  - C: create issue, J/K: navigate, X: select, Enter: open
  - S: status, A: assignee, P: priority, L: label
  - I: inbox, G+I: my issues
- [ ] Right-click context menu on issues

**Deliverable:** Full keyboard-driven navigation matching Linear's shortcut system

### Sprint 11-12: Polish & Performance
**Goal:** Production-ready foundation

- [ ] Dark mode / light mode with system preference
- [ ] Theme system (CSS custom properties)
- [ ] Loading states: skeleton shimmer animations
- [ ] Error boundaries and error states
- [ ] Toast notification system
- [ ] Responsive layout (sidebar collapse)
- [ ] Performance: bundle analysis, code splitting
- [ ] Performance: virtualized list optimization
- [ ] E2E tests for critical paths (auth, issue CRUD, sync)
- [ ] API rate limiting implementation
- [ ] Logging and error tracking (Sentry)

**Deliverable:** Polished, performant MVP with auth, issues, teams, real-time sync

---

## Phase 2: Essential Features (Weeks 13-24)

### Sprint 13-14: Projects
- [ ] Create migrations: projects, project_teams, project_members, project_milestones, project_updates
- [ ] Project CRUD with cross-team support
- [ ] Project status system (Backlog/Planned/In Progress/Completed/Canceled)
- [ ] Project health indicator (On Track/At Risk/Off Track)
- [ ] Project lead assignment
- [ ] Start/target date with resolution (day/month/quarter)
- [ ] Project list and detail views
- [ ] Project milestones CRUD
- [ ] Project updates CRUD with health selection
- [ ] Progress tracking (completed issues / total scope)
- [ ] Assign issues to projects (Shift+P shortcut)

### Sprint 15-16: Cycles (Sprints)
- [ ] Create migrations: cycles
- [ ] Cycle CRUD with team configuration
- [ ] Auto-create upcoming cycles (up to 15)
- [ ] Active/upcoming/completed cycle states
- [ ] Auto-rollover of unfinished work
- [ ] Cycle duration (1-8 weeks), cooldown periods
- [ ] Cycle detail view with progress charts
- [ ] Capacity estimation based on velocity
- [ ] Assign issues to cycles (Q shortcut)

### Sprint 17-18: Board View (Kanban)
- [ ] Board view component with status columns
- [ ] Issue cards (title, ID, priority icon, assignee avatar, label dots)
- [ ] Drag-and-drop between columns (status change) via @dnd-kit
- [ ] Drag within column (reorder)
- [ ] Multi-select drag
- [ ] Swimlanes (group by assignee, priority, etc.)
- [ ] View toggle (Alt+1 list, Alt+2 board)

### Sprint 19-20: Advanced Filtering & Custom Views
- [ ] Filter builder UI (add filter → field → operator → value)
- [ ] Filter pills/chips display
- [ ] All filter fields: status, assignee, creator, label, priority, project, cycle, estimate, dates
- [ ] AND/OR composition
- [ ] Save filter as custom view (personal or shared)
- [ ] Custom view CRUD
- [ ] Custom view: layout, columns, grouping, sorting configuration
- [ ] Sidebar: custom views under team
- [ ] Sort by: priority, status, assignee, created, updated, due date, manual
- [ ] Multi-level sorting

### Sprint 21-22: Notifications & Activity
- [ ] Create migrations: notifications, notification_subscriptions
- [ ] Notification creation on: assign, mention, comment, status change
- [ ] Notification inbox UI (up to 500)
- [ ] Read/unread state, mark all read
- [ ] Snooze notifications
- [ ] Auto-subscribe rules (create, assign, mention)
- [ ] Manual subscribe/unsubscribe (Shift+S)
- [ ] Issue activity history UI (timeline of changes)
- [ ] Activity collapsing for dense histories

### Sprint 23-24: Sub-Issues, Relations & Templates
- [ ] Sub-issue creation and management
- [ ] Multiple nesting levels
- [ ] Property inheritance (project, cycle)
- [ ] Auto-close parent/child status cascading
- [ ] Issue relations CRUD (related, blocks, blocked by, duplicate)
- [ ] Visual indicators for blocking/blocked
- [ ] Issue template CRUD (standard + form templates)
- [ ] Template application via Alt+C and creation modal
- [ ] Default templates per team

---

## Phase 3: Organization (Weeks 25-36)

### Sprint 25-26: Rich Text Editor
- [ ] TipTap editor integration
- [ ] Full Markdown support (bold, italic, lists, code, tables, blockquotes)
- [ ] @mentions (users, issues, projects)
- [ ] Slash commands (/code, /table, /diagram, /file, /date)
- [ ] Image upload and drag-drop
- [ ] File attachments
- [ ] Mermaid diagram rendering
- [ ] Collapsible sections
- [ ] Embed support (YouTube, Loom)
- [ ] Collaborative editing (YJS integration)

### Sprint 27-28: Comments & Reactions
- [ ] Threaded comments on issues and projects
- [ ] Full markdown in comments
- [ ] @mentions in comments (with notifications)
- [ ] Emoji reactions on comments, issues, project updates
- [ ] Convert comment to sub-issue
- [ ] Comment resolution (resolve/unresolve)
- [ ] Quote reply

### Sprint 29-30: Sub-Teams & Advanced Roles
- [ ] Sub-team hierarchy (parent/child teams)
- [ ] Inheritance: cycle schedules, estimation config
- [ ] Private teams (hidden from non-members)
- [ ] Team owner role with configurable member permissions
- [ ] Guest role (team-specific access)
- [ ] Cross-team issue visibility rules
- [ ] Workspace admin settings page

### Sprint 31-32: Estimates & Progress Tracking
- [ ] Per-team estimation scale configuration
- [ ] Estimate assignment (Shift+E shortcut)
- [ ] Cycle progress charts (burndown, velocity)
- [ ] Project progress charts (completion, scope history)
- [ ] Live completion predictions
- [ ] Dashboard with workspace-level metrics

### Sprint 33-34: Documents (Linear Docs)
- [ ] Create migrations: documents
- [ ] Document CRUD with collaborative editing
- [ ] Associate documents with projects, initiatives, teams
- [ ] Document listing and search
- [ ] Comments on documents
- [ ] Document templates

### Sprint 35-36: Triage Workflow
- [ ] Enable triage per team
- [ ] Triage inbox view
- [ ] Accept / Decline / Mark Duplicate / Snooze actions
- [ ] Keyboard shortcuts (1=Accept, 2=Duplicate, 3=Decline, H=Snooze)
- [ ] Triage responsibility assignment
- [ ] Require priority before leaving triage (optional)

---

## Phase 4: Integrations (Weeks 37-48)

### Sprint 37-38: GitHub Integration
- [ ] GitHub OAuth app setup
- [ ] Link PRs to issues via branch name / PR title / magic words
- [ ] Auto-status mapping: branch → In Progress, PR → In Review, merge → Done
- [ ] Display PR status, reviews, CI checks on issues
- [ ] Git branch name copy (issue.branchName)
- [ ] Commit/PR linkback messages

### Sprint 39-40: Slack Integration
- [ ] Slack app setup (OAuth, events API)
- [ ] /linear slash command for issue creation
- [ ] Message actions (create issue from message)
- [ ] Notification mirroring to Slack DM
- [ ] Team/project channel notifications
- [ ] Rich unfurls for issue/project links
- [ ] Bidirectional thread sync (Slack ↔ Linear comments)

### Sprint 41-42: Webhooks
- [ ] Webhook CRUD (GraphQL + settings UI)
- [ ] Event dispatch for 14 resource types
- [ ] HMAC-SHA256 signature generation
- [ ] Retry logic (1m, 1h, 6h) via BullMQ
- [ ] Auto-disable persistently failing webhooks
- [ ] Webhook delivery logs

### Sprint 43-44: Import/Export
- [ ] CSV import with field mapping
- [ ] Jira import (API-based)
- [ ] GitHub Issues import
- [ ] Asana import
- [ ] Duplicate detection during import
- [ ] CSV export
- [ ] Bulk delete of imported data (rollback)

### Sprint 45-46: OAuth2 Provider
- [ ] OAuth2 authorization server
- [ ] App registration and management
- [ ] Scopes: read, write, issues:create, comments:create, admin
- [ ] Token lifecycle: 24h access, refresh tokens
- [ ] Actor modes: user vs app

### Sprint 47-48: API SDK & Developer Experience
- [ ] TypeScript SDK auto-generation from GraphQL schema
- [ ] SDK: chained model access, pagination helpers, raw query support
- [ ] API documentation (generated from schema)
- [ ] Rate limiting documentation
- [ ] API key management UI
- [ ] Developer portal

---

## Phase 5: Advanced (Weeks 49+)

### Sprint 49-50: Initiatives & Roadmaps
- [ ] Initiative CRUD (name, status, health, owner, target date)
- [ ] Initiative ↔ project associations
- [ ] Sub-initiatives (nest up to 5 levels)
- [ ] Initiative updates
- [ ] Timeline view (Gantt-like) for projects
- [ ] Draggable timeline bars

### Sprint 51-52: SLAs
- [ ] SLA rule configuration
- [ ] Auto-apply SLA deadlines based on conditions
- [ ] Risk progression tracking (Low → Medium → High → Breached)
- [ ] Business day configuration
- [ ] SLA notifications (24h before breach)
- [ ] SLA filtering and reporting

### Sprint 53+: AI Features, Mobile, Desktop
- [ ] Triage intelligence (AI-powered assignee/label suggestions)
- [ ] Document summarization
- [ ] Natural language filtering
- [ ] Mobile app (React Native)
- [ ] Desktop app (Electron)
- [ ] Advanced analytics and insights
- [ ] Customer tracking (Asks)
- [ ] SAML SSO / SCIM provisioning
- [ ] IP restrictions
- [ ] Audit log with streaming

---

## Technical Milestones

| Milestone | Target | Criteria |
|-----------|--------|----------|
| **Alpha** | Week 12 | Auth + Issues + Teams + List View + Sync Engine |
| **Beta** | Week 24 | + Projects + Cycles + Board + Filters + Notifications |
| **RC1** | Week 36 | + Rich Editor + Comments + Sub-teams + Triage + Docs |
| **v1.0** | Week 48 | + GitHub + Slack + Webhooks + Import/Export + OAuth |
| **v2.0** | Week 60+ | + Initiatives + SLAs + AI + Mobile + Desktop |

---

## Team Structure (Recommended)

| Role | Count | Focus |
|------|-------|-------|
| **Tech Lead** | 1 | Architecture, sync engine, code review |
| **Frontend Engineers** | 2-3 | React, MobX, UI components, editor |
| **Backend Engineers** | 2 | GraphQL, services, database, sync |
| **Full-Stack** | 1-2 | Integrations, webhooks, imports |
| **Designer** | 1 | UI/UX, component library, dark mode |
| **QA Engineer** | 1 | E2E testing, performance testing |
| **DevOps** | 0.5 | CI/CD, infrastructure, monitoring |

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Sync engine complexity | Start with simple polling, iterate to WebSocket+IndexedDB |
| Performance with large datasets | Virtualization from day 1, pagination mandatory |
| Real-time collaboration (editor) | Use battle-tested YJS, start with single-user editing |
| Migration from Linear | Build robust import tooling early for dogfooding |
| Feature creep | Strict phase gating, P0/P1/P2 prioritization |
| Auth security | Use well-tested JWT libraries, regular security audits |

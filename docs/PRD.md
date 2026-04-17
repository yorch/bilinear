# Product Requirements Document (PRD)

## Issue Tracker — Open-Source Linear Alternative

**Version:** 1.1
**Date:** April 2026
**Status:** Draft

---

## 1. Product Overview

### 1.1 Vision

Build a modern, high-performance issue tracking and project management platform that matches Linear's feature set, speed, and UX quality — and ships it as a fully open-source, self-hostable alternative. The primary differentiator over Linear is **self-hosting**: teams that can't or won't use a SaaS product (data residency, cost at scale, compliance, air-gapped environments) get a first-class experience without compromise. Enterprise features (SAML, SCIM, audit logs) are free for self-hosted deployments since the hosting cost is borne by the operator.

### 1.2 Target Users

- **Primary:** Software engineering teams (5-500 people)
- **Secondary:** Product managers, designers, and cross-functional stakeholders
- **Tertiary:** Support/operations teams using triage workflows

### 1.3 Core Value Propositions

1. **Self-hostable:** Docker Compose for small teams, production-ready for larger orgs; no SaaS lock-in
2. **Speed:** Sub-100ms interactions via local-first architecture
3. **Keyboard-first:** Every action reachable without a mouse
4. **Opinionated workflows:** Sensible defaults that reduce configuration overhead
5. **Real-time collaboration:** Instant sync across all connected clients
6. **Beautiful design:** Dark-mode-forward, minimal chrome, high information density
7. **Enterprise features free for self-hosted:** SAML, SCIM, audit logs, granular permissions — no paywalls when you own the infra

---

## 2. Feature Requirements

### 2.1 Issue Management (P0 — Must Have)

#### 2.1.1 Issue CRUD

- Create issues with title (required) and status (required, defaults to team's default)
- Rich markdown description with collaborative editing
- Unique identifier per issue: `TEAM_KEY-NUMBER` (e.g., ENG-123)
- Soft delete (trash) with 30-day recovery, then permanent deletion
- Archive with `includeArchived` query parameter support

#### 2.1.2 Issue Properties

| Property    | Type             | Required | Notes                                                  |
| ----------- | ---------------- | -------- | ------------------------------------------------------ |
| Title       | String           | Yes      | Plain text                                             |
| Description | Markdown         | No       | Rich text with mentions, embeds, attachments           |
| Status      | WorkflowState    | Yes      | From team's configured workflow                        |
| Priority    | Enum(0-4)        | No       | No Priority, Urgent, High, Medium, Low                 |
| Assignee    | User             | No       | Single user                                            |
| Labels      | Label[]          | No       | Multiple; single-select within label groups            |
| Estimate    | Number           | No       | Per-team scale (Linear/Fibonacci/Exponential/T-shirt)  |
| Due Date    | Date             | No       | Color-coded: red (overdue), orange (within week), gray |
| Project     | Project          | No       | Cross-team deliverable                                 |
| Milestone   | ProjectMilestone | No       | Stage within project                                   |
| Cycle       | Cycle            | No       | Time-boxed sprint                                      |
| Parent      | Issue            | No       | Makes this a sub-issue                                 |

#### 2.1.3 Sub-Issues

- Multiple nesting levels supported
- Inherit project and cycle from parent automatically
- Auto-close parent when all children completed (configurable per team)
- Auto-close children when parent completed (configurable per team)
- Convert between standalone issue and sub-issue
- Batch sub-issue creation

#### 2.1.4 Issue Relations

- **Related** — general association
- **Blocks / Blocked by** — dependency tracking with visual indicators (red/orange flags)
- **Duplicate** — marks as duplicate, auto-sets status to Canceled
- Auto-create "Related" when referencing issue ID in description/comments

#### 2.1.5 Bulk Operations

- Multi-select via X key, Shift+click, Cmd+A
- Bulk change: status, priority, assignee, labels, project, cycle
- Bulk archive/delete
- Action toolbar appears at bottom on multi-select

#### 2.1.6 Issue Templates

- Standard templates: pre-fill properties + description with placeholders
- Form templates: structured fields (text, dropdown, checkbox, date)
- Workspace-level and team-level scoping
- Default templates: different for team members vs external users
- Accessible via Alt+C, modal dropdown, integrations

### 2.2 Workflow States (P0)

#### 2.2.1 State Categories (Fixed)

| Category  | Default Status | Behavior                         |
| --------- | -------------- | -------------------------------- |
| Triage    | (optional)     | Pre-acceptance inbox             |
| Backlog   | Backlog        | Acknowledged but not prioritized |
| Unstarted | Todo           | Prioritized, not in progress     |
| Started   | In Progress    | Active work                      |
| Completed | Done           | Finished                         |
| Canceled  | Canceled       | Rejected/invalid                 |

#### 2.2.2 Customization

- Add custom statuses within each category
- Each status: name, color, description
- Reorder within category via drag-and-drop
- Configure default status for new issues
- Per-team workflow configuration

#### 2.2.3 Automations

- Auto-close issues after configurable inactivity period
- Auto-archive stale completed/canceled issues
- Git-linked automations (branch created → In Progress, PR merged → Done)

### 2.3 Labels & Categorization (P0)

- Workspace-level labels (global) and team-level labels
- Label groups: one nesting level, single-select per group, max 250 per group
- Properties: name, color, description
- Archive (preserves on existing issues) vs delete (removes from all)
- Reserved names: assignee, cycle, effort, estimate, hours, priority, project, state, status

### 2.4 Priority System (P0)

- Fixed 5 levels: No Priority (0), Urgent (1), High (2), Medium (3), Low (4)
- Urgent triggers immediate email notification to assignee
- Manual drag-to-reorder within priority-sorted views (workspace-wide ordering)
- No custom priority levels (by design)

### 2.5 Estimates (P1)

- Per-team configuration
- Scales: Linear (1-7), Fibonacci (1-21), Exponential (1-64), T-Shirt (XS-XXXL)
- T-shirt maps to Fibonacci for analytics (XS=1, S=2, M=3, L=5, XL=8)
- Optional extended scales, optional zero estimates
- Unestimated default to 1 point (configurable)

### 2.6 Projects (P0)

#### 2.6.1 Core

- Cross-team deliverables with target dates
- Properties: name, description, icon, color, lead, start/target dates, status, health
- Status categories: Backlog, Planned, In Progress, Completed, Canceled (custom sub-statuses)
- Health indicator: On Track (green), At Risk (yellow), Off Track (red)
- Progress tracking with live completion predictions from historical velocity

#### 2.6.2 Project Milestones

- Stages within a project with optional target dates
- Completion percentage per milestone
- Diamond icons with status coloring
- Assignable issues, filterable and groupable

#### 2.6.3 Project Updates

- Health indicator + rich text description
- Automatic progress summaries (delays, target changes, milestone advancement)
- Configurable reminder cadence (daily/weekly/biweekly)
- Staleness tracking with visual indicators

### 2.7 Cycles / Sprints (P1)

- Time-boxed periods: 1-8 weeks, consistent per team
- Auto-create up to 15 upcoming cycles
- Auto-rollover of unfinished work to next cycle
- Optional cooldown periods between cycles
- Capacity estimation based on 3-cycle velocity history
- Calendar integration (Google Calendar, .ics, feed URL)

### 2.8 Initiatives (P2)

- Highest-level planning: group projects by company objective
- Status: Planned, Active, Completed
- Owner, target date, health indicator
- Sub-initiatives: nest up to 5 levels, multiple parents allowed
- Project inheritance from sub-initiatives

### 2.9 Triage (P1)

- Optional per-team inbox for incoming issues
- Actions: Accept, Mark Duplicate, Decline, Snooze
- Triage responsibility with rotating schedules
- Intelligence (P2): AI-powered assignee/label/duplicate suggestions
- Rules-based automation (P2)

### 2.10 Views & Filtering (P0)

#### 2.10.1 View Types

- **List view:** Dense table with configurable columns, groupable
- **Board view:** Kanban with status columns, drag-drop, optional swimlanes
- **Timeline view (P2):** Gantt-style with draggable bars

#### 2.10.2 Filters

- Fields: status, assignee, creator, label, priority, project, cycle, estimate, due date, created/updated date, subscriber, relations, has: attachments/comments/sub-issues
- Operators: is, is not, is any of, is none of, contains, before, after, between, overdue
- AND/OR composition with nested groups
- Save as custom view (personal or shared)

#### 2.10.3 Custom Views

- Workspace-level or team-specific
- Configurable: layout, columns, grouping, sorting, filters
- Favoritable, shareable via URL
- Set as default home view
- Notification subscriptions (in-app, Slack)

### 2.11 Teams & Workspace (P0)

#### 2.11.1 Workspace

- Top-level container for organization
- Data region selection (US/EU) at creation
- Multi-workspace support for users

#### 2.11.2 Teams

- Team key/identifier (e.g., ENG) for issue IDs
- Per-team: workflow states, labels, templates, cycles, estimation config
- Private teams (P2): hidden from non-members
- Sub-teams (P2): hierarchical, inherit parent config

#### 2.11.3 Roles

- **Admin:** Full workspace management
- **Member:** Standard access, no admin
- **Guest (P2):** Team-specific access only

### 2.12 Notifications (P1)

- Inbox with up to 500 notifications
- Auto-subscribe on: create, assign, @mention
- Manual subscribe/unsubscribe
- Snooze (hide until time) and reminders
- Channels: in-app, desktop push, mobile push, email digest, Slack

### 2.13 Search (P0)

- Global search across issues, projects, documents, comments
- Issue ID instant jump (e.g., ENG-123)
- Fuzzy matching on titles
- <100ms perceived latency
- Keyboard-navigable results

### 2.14 Rich Text Editor (P0) 🟡 MOSTLY SHIPPED

- [x] Full Markdown: bold, italic, strikethrough, links, lists, code blocks, tables
- [x] Advanced: blockquotes, collapsible sections, Mermaid diagrams, slash commands
- [x] @user mentions (via `@tiptap/extension-mention`)
- [x] Embeds: YouTube, Loom, generic (`EmbedNode`)
- [x] File attachments: persisted to `File` model via `POST /api/upload`; toolbar button + dedicated file-attachments block
- [ ] @mentions for `@ISSUE-ID` and `@project`
- [ ] Image / file drag-and-drop into the editor body
- [ ] Collaborative editing with live cursors (YJS)

### 2.15 Comments & Activity (P0) 🟡 MOSTLY SHIPPED (Sprint 29-30)

- [x] Threaded comments (`Comment.parentId`) with TipTap rich text
- [x] @mentions on users, emoji reactions (`CommentReaction`)
- [x] Comment resolution (`commentResolve` / `commentUnresolve`)
- [x] Activity history (`IssueActivity`): field / oldValue / newValue per change
- [ ] Convert comment to sub-issue
- [ ] Quote reply
- [ ] Activity collapsing for dense histories

### 2.16 Authentication (P0)

- Email magic link
- Google OAuth
- Passkeys (P1)
- SAML SSO (P2, Enterprise)
- SCIM provisioning (P2, Enterprise)

### 2.17 Integrations (P1-P2)

#### P1 Integrations

- **GitHub:** PR/branch linking via issue ID, auto-status, CI visibility
- **Slack:** Issue creation, notifications, bidirectional thread sync

#### P2 Integrations

- GitLab, Figma, Sentry, Zendesk, Intercom
- Webhooks (14 resource types, HMAC-SHA256, retry logic)
- OAuth2 provider for third-party apps
- Import/export (Jira, Asana, GitHub Issues, CSV)

### 2.18 API (P0)

- GraphQL API (primary interface)
- Relay-style cursor pagination
- Typed filtering with AND/OR composition
- Rate limiting: 5,000 requests/hr + complexity points
- TypeScript SDK auto-generated from schema

### 2.19 Documents / Docs (P2) 🟡 BASE SHIPPED (Sprint 35-36)

- [x] Standalone documents associated with projects and teams (initiative association deferred until Initiatives ship)
- [x] Nested hierarchy via `parentId` self-relation
- [x] TipTap-powered editor matching the issue description editor
- [ ] Collaborative editing (YJS / Hocuspocus)
- [ ] Templates and AI summaries
- [ ] Comments on documents

### 2.20 Custom Fields (P2) ✅ SHIPPED (Sprint 23-24)

A deliberate departure from Linear's "no custom fields" stance, enabling non-engineering teams (ops, HR, marketing) to use the same tool.

- **Scope:** team-level only today (workspace-level scope is a future extension)
- Types: text, number, date, select (single), multi-select, URL, checkbox
- Fields appear as optional columns in list view and properties in detail panel
- Filterable, sortable, and exportable to CSV
- Max 20 active definitions per team (enforced in `CustomFieldService`)
- **Storage:** definitions live in `custom_field_definitions`; values live in a separate `custom_field_values` table keyed by `(issue_id, definition_id)` so filter and sort stay indexable. **Not** a JSONB metadata column on `issues`.

**Non-goal:** Custom fields will not replace the fixed Priority, Estimate, or Status systems. Those remain opinionated and fixed.

### 2.20b Public Roadmaps (P2) 🟡 BASE SHIPPED (Sprint 53-54 / PR #28)

Share a read-only, public-facing view of product progress — a feature Linear doesn't offer. Useful for open-source projects and transparent product orgs.

- [x] One `PublicRoadmap` row per workspace; enable / disable toggle
- [x] Per-project exposure toggle (`Project.roadmapVisible`)
- [x] Public URL: `/r/[slug]` — unauthenticated route
- [x] Shows projects (name, icon/color, status, health, target date, milestone progress counts)
- [x] Does **not** expose: issue titles, comments, assignees, internal notes
- [x] Optional password protection (SHA-256 hash; client sends plaintext over HTTPS)
- [ ] Initiative-level grouping (depends on Sprint 57-58 Initiatives)
- [ ] Embeddable as iframe
- [ ] Subscribable: visitors can sign up for email updates when projects change status

### 2.21 SLAs (P2)

- Auto-apply deadlines based on rules
- Risk progression: Low → Medium → High → Breached → Achieved/Failed
- Business day configuration
- Notifications 24h before breach

### 2.22 Backlog Management (P1)

#### 2.21.1 Backlog View

- Dedicated backlog route per team (`/[workspace]/team/[key]/backlog`)
- Displays all issues in Backlog and Unstarted state categories
- Sortable by priority, estimate, created date, updated date, and manual order
- Drag-to-reorder within priority bands for manual prioritization

#### 2.21.2 Grooming Operations

- Bulk prioritization: assign or change priority on multiple backlog issues at once
- Bulk estimation: apply estimates to groups of unestimated issues
- Quick-add issues directly from the backlog view (no modal required)
- Archive stale backlog issues in bulk (issues inactive for configurable period)
- "Move to cycle" action: add selected backlog issues to the active or upcoming cycle
- "Ready" toggle: mark issues as groomed and ready to pull into a sprint

#### 2.21.3 Prioritization Workflow

- Sort by: Priority, Estimate, Age (created date), Updated date, Manual
- Filter to show only unestimated issues (grooming mode)
- Inline estimate and priority editing without opening detail panel
- Visual overdue and staleness indicators on backlog items

#### 2.21.4 AI-Assisted Suggestions (P3)

- Priority suggestions based on issue content, labels, and historical patterns
- Duplicate detection: surface likely duplicates during backlog grooming
- Auto-label suggestions on newly triaged issues
- Assignee suggestions based on team workload and domain expertise

### 2.23 Automated Workflows / Rules Engine (P2)

#### 2.22.1 Rule Anatomy

- **Trigger:** the event that fires the rule
  - Issue created, status changed, label added/removed, assignee changed, priority changed, cycle assigned, due date approaching, SLA risk threshold crossed, PR merged (via GitHub integration)
- **Conditions:** optional filters applied before executing actions
  - Match on team, priority, label, assignee, state category, estimated/unestimated, has/lacks sub-issues
- **Actions:** one or more effects to apply
  - Change status, assign user, add/remove label, set priority, add to cycle, post comment, send notification, trigger webhook

#### 2.22.2 Built-In Automations

- **Auto-close:** close issues with no updates after N configurable days
- **Auto-archive:** archive completed/canceled issues after N configurable days
- **Git-linked:** branch created → In Progress; PR opened → In Review; PR merged → Done (requires GitHub integration)
- **Priority escalation:** auto-upgrade to Urgent when approaching SLA breach
- **Cycle rollover:** auto-move unfinished issues to the next cycle on cycle end

#### 2.22.3 Custom Rules UI

- Rules management page per team; workspace admins can create global rules
- Drag-to-reorder rule priority (first matching rule wins by default; "run all" mode optional)
- Dry-run mode: preview which existing issues would be affected before enabling a rule
- Rule execution log: audit trail of every rule-triggered action (who/what/when)
- Enable/disable individual rules without deleting them

### 2.24 Team Analytics & Insights (P2)

#### 2.23.1 Velocity & Throughput

- Issues completed per cycle (count and estimate points)
- Rolling velocity average over last 3, 6, and 12 cycles
- Throughput trend chart (weekly and monthly views)
- Cycle comparison: planned scope vs. actually completed

#### 2.23.2 Cycle Metrics

- Burndown chart: remaining scope vs. ideal burn line
- Burnup chart: completed work vs. total scope (including scope creep)
- Scope creep tracking: issues added after cycle start are visually flagged
- Carryover rate: percentage of unfinished issues rolled to the next cycle

#### 2.23.3 Flow Metrics

- Lead time: issue created → issue completed (distribution histogram)
- Cycle time: issue started → issue completed (distribution histogram)
- Time-in-state: average time issues spend in each workflow state
- Work-in-progress (WIP) over time per workflow state

#### 2.23.4 Team Health

- Per-member workload: assigned open issues, estimated points, overdue count
- Unestimated issues count and percentage (team grooming health indicator)
- Issue age distribution: how old are the oldest open issues
- Triage backlog size over time

#### 2.23.5 Scope & Access

- Analytics dashboard per team at `/[workspace]/team/[key]/analytics`
- Workspace-level summary view (cross-team aggregate insights)
- Date range selector: current cycle, last N cycles, last 30/90/180 days, custom range
- Export charts and raw data to CSV

---

## 3. Non-Functional Requirements

### 3.1 Performance

- View switching: <50ms (local cache)
- Issue creation UI update: <16ms (one frame)
- Search results: <100ms
- Initial load (cached): <1s
- Initial load (fresh): <4s
- List scrolling: 60fps with 10,000+ issues

### 3.2 Reliability

- 99.9% uptime SLA
- Offline support: full functionality with queued sync
- Optimistic updates with rollback on failure
- Data loss prevention via local IndexedDB persistence

### 3.3 Security

- SOC 2 Type II compliance target
- GDPR compliant (EU data region option)
- All data encrypted at rest and in transit
- Webhook signature verification (HMAC-SHA256)
- IP restriction support (Enterprise)
- Audit logging (Enterprise)

### 3.4 Self-Hosting & Deployment

This is the primary differentiator over Linear. Deployment must be a first-class experience.

- **Docker Compose (small teams):** single `docker-compose.yml` spins up the full stack (app, ws-server, PostgreSQL, Redis). `docker compose up` → running in <5 minutes.
- **Environment configuration:** all secrets and URLs via `.env`; documented `.env.example` covers every required variable
- **Database migrations:** `yarn db:migrate` (Prisma) runnable at startup or manually; no raw SQL required
- **Upgrades:** documented upgrade path; migrations are always backwards-compatible within a minor version
- **Backup:** documented backup/restore for PostgreSQL volume
- **Resource requirements:** minimum viable deployment on a $6/mo VPS (1 vCPU, 1GB RAM) for teams <20; recommended 2 vCPU / 4GB for teams up to 100
- **No license key or phone-home:** fully functional offline; no telemetry without opt-in

Enterprise features (SAML SSO, SCIM, audit logs, IP restrictions) are **not paywalled** for self-hosted deployments — they are configuration, not gating.

### 3.5 Scalability

- Support workspaces with 500+ users
- Support teams with 100,000+ issues
- Incremental sync (only deltas after initial load)
- Virtualized rendering for large lists

---

## 4. Out of Scope (V1)

- Mobile native apps (web responsive first; native apps documented as a future phase)
- Desktop Electron app
- AI/ML features (triage intelligence, auto-assign, AI-assisted backlog suggestions) — targeted for Phase 5
- Customer tracking (Linear Asks / Customer Requests)
- AI-powered predictive analytics (basic team analytics are in Phase 3; advanced AI-driven insights are Phase 5)

**Deliberately in scope (diverging from Linear):**

- Custom fields (§2.20) — unlocks non-engineering teams
- Public roadmaps (§2.20b) — differentiator vs Linear
- Enterprise features free for self-hosted (SAML, SCIM, audit logs in Phase 3, no paywall)

---

## 5. Success Metrics

| Metric                     | Target                    |
| -------------------------- | ------------------------- |
| P50 interaction latency    | <50ms                     |
| P99 API response time      | <500ms                    |
| Time to create issue       | <3s (keyboard)            |
| Sync delta size            | <10KB per update          |
| User onboarding completion | >80%                      |
| Daily active usage         | >60% of workspace members |

---

## 6. Milestones

| Phase                 | Duration     | Deliverable                                                           |
| --------------------- | ------------ | --------------------------------------------------------------------- |
| Phase 1: Foundation   | Months 1-3   | Auth, issues, teams, list view, real-time sync, Docker Compose deploy |
| Phase 2: Essential    | Months 4-6   | Projects, cycles, board view, filters, notifications, custom fields   |
| Phase 3: Organization | Months 7-9   | Sub-teams, roles, SAML/SCIM (free), audit logs, templates             |
| Phase 4: Integrations | Months 10-12 | GitHub, Slack, webhooks, import/export, public roadmaps               |
| Phase 5: Advanced     | Months 13+   | Initiatives, SLAs, docs, AI agent, analytics                          |

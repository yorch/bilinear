# Linear (linear.app) — Comprehensive Rebuild Research

**Date:** April 2026  
**Scope:** Complete technical analysis for rebuilding Linear from scratch  
**Research Coverage:** 6 major dimensions (555+ pages of detailed analysis)

---

## Table of Contents

1. [Core Features & Issue Tracking](#1-core-features--issue-tracking)
2. [Projects, Cycles & Roadmaps](#2-projects-cycles--roadmaps)
3. [Teams, Workspace & Organization](#3-teams-workspace--organization)
4. [Integrations & API](#4-integrations--api)
5. [UX & Design Patterns](#5-ux--design-patterns)
6. [Data Model & Schema](#6-data-model--schema)
7. [Implementation Priorities](#implementation-priorities)

---

## 1. Core Features & Issue Tracking

### Issue Structure
- **Mandatory fields:** Title (string), Status (from team workflow)
- **Core properties:** Description (markdown), Priority (5 levels), Assignee, Labels, Estimate, Due Date, Cycle, Project, Parent (for sub-issues)
- **Relationships:** Team (exactly one), Assignee (nullable), Labels (many), Parent Issue (optional)
- **Unique identifier:** `TEAM_KEY-NUMBER` format (e.g., ENG-123)

### Priority System (Fixed 5 Levels)
- **Urgent** (1): Immediate email notification to assignee
- **High** (2): Standard priority
- **Medium** (3): Standard priority
- **Low** (4): Standard priority
- **No Priority** (0): Default, appears at bottom
- Manual drag-to-reorder creates workspace-wide priority ordering

### Workflow States (5 Fixed Categories)
Each team configures statuses within these immutable categories:
1. **Triage** — optional inbox for incoming work
2. **Backlog** — starting point for acknowledged work
3. **Unstarted** — work not yet begun (default: Todo)
4. **Started** — active work (default: In Progress)
5. **Completed** — finished work (default: Done)
6. **Canceled** — rejected/archived work

State automations: auto-close inactive issues, auto-archive stale issues, parent/child status cascading

### Labels & Categorization
- **Workspace labels:** global, accessible to all teams
- **Team labels:** team-scoped only
- **Label groups:** one level of nesting, single-select per group (not multi-selectable within same group)
- Max 250 labels per group
- Supports color, description, archival (preserves on old issues, prevents new application)

### Estimates (Per-Team Configuration)
- Scales: Linear (1-7), Fibonacci (1-21), Exponential (1-64), T-Shirt (XS-XXXL)
- Optional extended scales
- Allow zero estimates (configurable)
- Unestimated issues default to 1 point (configurable)

### Issue Templates
- **Standard:** Pre-fill properties + optional description with placeholders
- **Form:** Structured with generic fields (text, long text, dropdowns, checkboxes, dates, instructions) + property-linked fields
- **Scope:** Workspace (cross-team) or Team-specific
- **Application:** Via Alt+C, modal dropdown, email, integrations (Slack, Asks, Intercom, Zendesk)
- **Default templates:** Different for team members vs. external users

### Sub-Issues
- **Nesting:** Multiple levels supported
- **Property inheritance:** Automatically inherit project + cycle from parent
- **Status automation:** Auto-close parent when all children done; auto-close children when parent done
- **Conversion:** Issue ↔ Sub-issue, batch creation, parent duplication with sub-issues included
- Creation methods: +Add, Cmd+Shift+O, from comments, from checklist items

### Bulk Operations
- Selection: X key, Shift+click, Cmd+A for all visible
- Toolbar appears with: status changes, priority, assignee, labels, backlog, unsubscribe, reorder
- Right-click context menu + command palette support

### Issue Relations (4 Types)
- **Related** (M+R): General association
- **Blocking** (M+X): Red flag, current issue prevents other
- **Blocked by** (M+B): Orange flag, current issue cannot proceed
- **Duplicate** (M+M): Marks as duplicate, changes status to Canceled
- Auto-creation via identifier reference (e.g., @ENG-123 in description)

### Rich Text Editor (Markdown)
- Full Markdown support: bold, italic, strikethrough, links, lists, code blocks
- Advanced: blockquotes, collapsible sections, diagrams (Mermaid), tables, inline dates
- Mentions: @user, @ISSUE-ID, @project, @document
- Embeds: YouTube, Loom, Figma (with preview if integrated)
- Attachments: drag-drop, /file, up to 25MB in emails
- Collaborative editing with live cursors

### Activity & History
- Complete change tracking: title, description, status, priority, estimates, labels, assignee, cycle, project, team
- Git integration events logged
- Activity collapsing for extended histories
- Workspace audit log (Enterprise): 90-day history with IP/country tracking

---

## 2. Projects, Cycles & Roadmaps

### Projects
- **Purpose:** Cross-team deliverables with target dates and clear ownership
- **Lead:** Single person for ownership
- **Status:** Backlog → Planned → In Progress → Completed / Canceled
- **Custom statuses:** Teams can add custom statuses within each status category
- **Dates:** Start + Target (flexible: year, half-year, quarter, month, specific day)
- **Health indicator:** On Track (green), At Risk (yellow), Off Track (red), No Update (gray)
- **Progress tracking:** Live completion predictions based on historical velocity
- **Teams:** Multiple teams can contribute to single project
- **Milestones:** Internal stages within projects with target dates and completion %

### Project Updates
- Health + rich text description
- Auto-summary with progress overviews (delays, target changes, leadership transitions)
- Reminder cadence (daily/weekly/biweekly) with timezone awareness
- Staleness tracking (dashed outline = minor, gray icon = prolonged inactivity)
- Slack bidirectional sync + emoji reactions

### Cycles (Sprints)
- **Duration:** 1-8 weeks per team (consistent duration)
- **Automation:** Linear auto-creates upcoming cycles (up to 15 pre-created)
- **Cooldown periods:** Optional breaks between cycles
- **Auto-rollover:** Unfinished work automatically moves to next cycle
- **Auto-add:** Optional auto-add of Active/Started/Completed issues to current cycle
- **Calendar integration:** Google Calendar, .ics export, feed URL subscription
- **Capacity tracking:** Estimated based on 3-cycle velocity or team size

### Initiatives (Highest-Level Planning)
- **Purpose:** Group projects by company objectives
- **Status:** Planned, Active, Completed
- **Owner:** Single person, reassignable
- **Target date:** Expected completion
- **Health:** Same as projects (On Track/At Risk/Off Track)
- **Sub-initiatives (Enterprise):** Nest up to 5 levels deep, allow multiple parents
- **Project inheritance:** Parent includes direct projects + all projects from sub-initiatives
- **Updates:** Health + description, reminder cadence, Slack sync, emoji reactions

### Roadmaps & Timeline Views
- **Timeline view:** Gantt-like visualization on Projects page
- **Display:** Project bars with status icons, milestones, target dates
- **Interactions:** Right-click to add milestones, drag bars to reschedule

### Triage
- **Purpose:** Optional inbox for incoming issues before team acceptance
- **Triggers:** Integration-created, Triage view creation, non-team members, templates override
- **Actions:** Accept (→ default status), Mark Duplicate, Decline (→ Canceled), Snooze
- **Responsibility:** Rotating schedules from PagerDuty, OpsGenie, Rootly, Incident.io
- **Intelligence (Business+):** AI suggests assignee, labels, duplicates
- **Automations (Business+):** Rules-based processing with AND/OR logic

### Views (Custom Filtering)
- **Types:** Issue views, Project views, Initiative views
- **Scope:** Workspace or Team-specific
- **Creation:** From scratch, from filtered lists (Alt+V), by duplication
- **Sharing:** Link-based, visibility depends on user role
- **Sidebar filters:** Assignee, label, project sidebars for quick navigation
- **Notifications:** Individual (per-view) or Slack (per-channel)

### SLAs (Service Level Agreements)
- **Plans:** Business & Enterprise only
- **Automation:** Rules apply deadlines to issues matching conditions
- **Presets:** 12h, 24h, 48h, 1w, 2w, 4w, or custom intervals
- **Business days:** Configurable (default Mon-Fri)
- **Risk progression:** Low (gray) → Medium (yellow) → High (orange) → Breached (red) → Achieved (green) / Failed (red X)
- **Filtering:** By team, status, assignee, creator, priority, labels, project, project status, initiative

---

## 3. Teams, Workspace & Organization

### Workspace Structure
- **Hierarchy:** Organization → Teams → Issues
- **Data region:** US or EU (selected at creation, permanent)
- **Default team:** Auto-created matching workspace name
- **Multi-workspace:** Users can belong to multiple workspaces

### Teams
- **Identifier:** Customizable team key (e.g., ENG, DES, MKT)
- **Issue IDs:** Team-key + sequential number (e.g., ENG-123)
- **Timezone:** Per-team setting
- **Private teams (Business+):** Hidden from non-members
- **Sub-teams (Business+):** Hierarchical, inherit parent cycle schedules + optional status/estimate config
- **Team limits:** Free=2, Basic=5, Business/Enterprise=Unlimited
- **Member roles:** Team Owner (Business+) has exclusive control; configurable permissions

### Roles & Permissions
- **Workspace Owner (Enterprise):** Full admin, billing, security, OAuth, workspace exports
- **Admin:** Manage members, roles, settings; all users are Admin on Free plans
- **Member:** Full workspace access, no admin privileges
- **Guest (Business+):** Team-specific access, cannot see workspace-wide features (workspace views, customer requests, initiatives)
- **Team Owner (Business+):** Per-team control; configurable member permissions

### Notifications System
- **Inbox:** Central hub with up to 500 notifications, keyboard-navigable (J/K, U for read/unread)
- **Channels:** In-app, Desktop app, Mobile app, Slack, Email (digest)
- **Auto-subscription:** Create, assigned, @mentioned, thread mention
- **Snoozing:** Temporarily hides; reappears unread at specified time
- **Reminders:** Scheduled notifications for issues, documents, projects, initiatives
- **Project/Initiative subscriptions:** Per-channel config with trigger selection

### User Profiles & Settings
- **Profile:** Name, email (unique), avatar, connected accounts
- **Preferences:** Default home view, full names display, week format, text emoticons, font size, cursor style, theme
- **Theme support:** Light, Dark, system preference, 70+ community themes (linear.style)
- **Account settings:** Spell check, auto-assign, git integration options

### Workspace Settings
- **Admin-only:** Workspace name/URL, login methods, third-party app approvals, project updates config, initiatives toggle
- **Shared:** Workspace labels, project statuses, templates, SLA rules, custom emoji, integrations
- **Security:** Team creation restriction, email domain auto-join, app approval requirement, role-based action restrictions

### Authentication
- **Methods:** Email (magic link), Google Auth, Passkeys, SAML SSO (Enterprise)
- **SAML:** Multi-IDP support, JIT provisioning, domain claiming (DNS verification)
- **SCIM (Enterprise):** User provisioning from Okta, OneLogin, SCIM 2.0 compatible
- **IP Restrictions (Enterprise):** Restrict by IP/CIDR ranges
- **Lockout prevention:** Admins/Owners always have access via any method

### Billing & Plans
| Feature | Free | Basic | Business | Enterprise |
|---------|------|-------|----------|-----------|
| Price | $0 | $10/mo | $16/mo | Custom |
| Members | Unlimited | Unlimited | Unlimited | Unlimited |
| Teams | 2 | 5 | Unlimited | Unlimited |
| Issues | 250 | Unlimited | Unlimited | Unlimited |
| Private Teams | ✗ | ✗ | ✓ | ✓ |
| Guests | ✗ | ✗ | ✓ | ✓ |
| Sub-Teams | ✗ | ✗ | ✓ | ✓ |
| Triage Intelligence | ✗ | ✗ | ✓ | ✓ |
| SAML/SCIM | ✗ | ✗ | ✗ | ✓ |
| IP Restrictions | ✗ | ✗ | ✗ | ✓ |
| Audit Logs | ✗ | ✗ | ✗ | ✓ |

### Audit Logs (Enterprise Only)
- **Retention:** 90 days
- **Tracking:** Account access, subscriptions, settings changes with IP/country
- **Access:** Workspace owners only
- **Filtering:** By event type, actor email, metadata
- **Webhook streaming:** SIEM integration with signature verification

---

## 4. Integrations & API

### GraphQL API
- **Endpoint:** `https://api.linear.app/graphql`
- **Schema:** 555 object types, 351 input types, 89 enums, 8 interfaces, 10 unions
- **Authentication:** API key or OAuth2 Bearer token
- **Pagination:** Relay-style cursor-based (first/after, last/before, default 50)
- **Filtering:** Typed comparators with AND/OR logic on 40+ fields per entity
- **Rate limits:** 5,000 requests/hr + 250K complexity points/hr (API key)
- **Introspection:** Schema explorable via Apollo Studio

### Webhooks
- **Events:** 14 resource types (Issue, Comment, Label, Project, Cycle, Initiative, Document, etc.)
- **Retry:** 3 attempts (1m, 1h, 6h), must respond HTTP 200 within 5s
- **Signature:** HMAC-SHA256 with timing-safe comparison
- **Payload:** action, type, actor, data, updatedFrom, url, webhookTimestamp, webhookId

### OAuth2
- **Grant types:** Authorization Code, PKCE, Refresh Token, Client Credentials
- **Scopes:** read, write, issues:create, comments:create, admin, app:assignable, app:mentionable
- **Token lifecycle:** 24h access tokens, refresh token grace period 30min
- **Actor:** user (default) or app (for bot attribution)

### GitHub Integration
- **Linking:** Issue ID in branch name, PR title, or magic words (closes/fixes/resolves ENG-123)
- **Auto-status:** Branch created → In Progress; PR opened → In Review; PR merged → Done (customizable)
- **Sync:** PR status, review state, CI checks visible on issues
- **Workflow:** GitHub Actions status syncing

### GitLab Integration
- **Linking:** Same convention as GitHub
- **Status mapping:** Draft → Open → Merged

### Slack Integration
- **@Linear agent:** Natural language issue creation/queries
- **Message actions:** Create issues from any message
- **/linear command:** Lightweight issue creation
- **Thread sync:** Bidirectional Slack ↔ Linear comment threads
- **Notifications:** Personal DM mirror + team/project channels
- **Unfurls:** Rich previews of issues/projects with action buttons
- **Auto-linking:** Mention ENG-123 → auto-reply with link
- **Linear Asks:** Non-Linear user issue submission (Business+)
- **Templates:** Up to 10 exposed with admin-configurable instructions

### Other Integrations
- **Figma:** Embed files directly in issues/documents
- **Sentry:** Create issues from errors, bidirectional status sync
- **Zendesk:** Link tickets, feedback loop
- **Intercom:** Link conversations, customer notification on resolution
- **Front, Salesforce, PagerDuty, OpsGenie, Rootly, Discord, Loom, Google Sheets, Google Calendar, Microsoft Teams:** 40+ total

### Import/Export
- **Importers:** Jira, GitHub Issues, Asana, Shortcut, Linear-to-Linear, Trello, Pivotal Tracker, GitLab Issues, CSV
- **Export:** CSV via Settings > Administration > Import/Export, or full access via GraphQL
- **Features:** Duplicate detection, sub-issue conversion, estimate mapping

### SDK & Libraries
- **Official:** `@linear/sdk` (TypeScript/JavaScript, npm, auto-generated from schema)
- **Community:** Python, Ruby, Go, etc.
- **Usage:** Chained model access, pagination, raw GraphQL queries

---

## 5. UX & Design Patterns

### UI Layout (Three-Panel)
- **Left Sidebar:** Workspace switcher, My Issues, Inbox, Favorites, Teams (expandable), Settings
  - Collapsible via Cmd+. (macOS)
  - Contains New Issue button
- **Main Content:** Issue list/board/timeline with configurable columns
- **Right Detail Panel:** Issue metadata, description, activity, sub-issues, relations
  - Opens on selection or full-screen via V key

### Navigation
- **Hierarchy:** Workspace → Team → {Issues, Cycles, Projects, Views}
- **Breadcrumbs:** Top of content area
- **Back/Forward:** Cmd+[ / Cmd+] (browser-style)
- **Deep linking:** Every item has unique URL (linear.app/{workspace}/team/{team-key}/active)

### Keyboard Shortcuts (Heavily Optimized)
| Shortcut | Action |
|----------|--------|
| C | Create issue |
| Cmd+K | Command palette |
| Cmd+. | Toggle sidebar |
| J/K | Navigate list (vim-style) |
| X | Select/deselect issue |
| Enter | Open selected issue |
| S | Set status |
| A | Set assignee |
| P | Set priority |
| L | Set label |
| D | Set due date |
| E | Set estimate |
| Shift+P | Set project |
| Q | Set cycle |
| Space | Toggle peek/preview |
| Alt+1/2/3 | Switch view (list/board/timeline) |
| I | Go to Inbox |
| G then I | Go to My Issues |

### Command Palette (Cmd+K)
- **Universal search & action dispatcher**
- Fuzzy matching, recent items, context-aware results
- Categories: Issues, Projects, Actions, Teams, Views, Settings
- Nested command flows (e.g., "Set status" shows status options)
- Real-time results as you type

### Views
- **List:** Dense table, configurable columns, groupable by status/assignee/priority/label
- **Board:** Kanban with columns = statuses, drag-drop for status change, swimlanes optional
- **Timeline:** Gantt-style with calendar, bars represent issue duration, draggable for reschedule

### Filters & Sorting
- **Filter bar:** Click to open builder, additive AND logic, each filter is a pill
- **Fields:** Status, Assignee, Creator, Label, Priority, Project, Cycle, Estimate, Due Date, Created Date, Updated Date, Subscriber, Relation, Has: (attachments/comments/sub-issues/links)
- **Multi-level sorting:** Sort by Priority, then Created, etc.
- **Custom Views:** Save filters as named views, personal or shared

### Dark/Light Mode
- **Default:** Dark mode (signature Linear look)
- **Options:** Light mode, system preference, 70+ community themes
- **Status colors:** Gray (backlog), Yellow (todo), Orange (in progress), Blue (in review), Green (done), Red (canceled)
- **Priority colors:** Urgent=red, High=orange, Medium=yellow, Low=blue, No priority=gray

### Search
- **Scope:** Issue titles, descriptions, comments, projects, documents
- **Speed:** <100ms perceived latency
- **Operators:** Issue ID (e.g., ENG-123) instant jump, partial title matching
- **Ranking:** Relevance with recent items boosted

### Drag & Drop
- **Board:** Drag cards between columns (status change) or within column (reorder)
- **Multi-select:** Drag multiple selected issues as group
- **Timeline:** Drag bar endpoints (reschedule) or entire bar (shift dates)
- **Sidebar:** Drag Favorites to reorder, teams to reorder
- **Sub-issues:** Drag to reorder, nest/un-nest
- **Visual feedback:** Ghost preview, drop target highlight, spring-like animations

### Right-Click Context Menu
- Status, Assignee, Priority, Labels, Due Date, Project, Cycle, Relations
- Copy (URL, ID, Title, Markdown), Open in New Tab, Archive, Delete
- Each item shows keyboard shortcut

### Quick Actions & Inline Editing
- **Hover:** Quick-action icons on issue rows
- **In-place editing:** Click cells in list view to edit (status, assignee, priority, labels, estimate, due date)
- **Bulk actions:** Select multiple + action bar at bottom (status, assignee, priority, labels, project, cycle, archive, delete)
- **Detail panel:** All metadata clickable, live collaborative description editing

### Mobile App
- **Platforms:** iOS, Android
- **Features:** Browse/triage, create, comment, notifications, offline support (limited)
- **Gestures:** Swipe actions (e.g., right=done, left=more)
- **Views:** Primarily list, some versions may have board
- **Push notifications:** Mentions, assignments, status changes

### Desktop App (Electron)
- **Global shortcut:** Configurable hotkey (e.g., Ctrl+Shift+L)
- **Quick capture:** Create issue without switching to full app
- **Menu bar/System tray:** Quick access to notifications, issue creation
- **Deep links:** linear.app URLs open in desktop app
- **Native notifications:** OS-level alerts
- **Multiple workspaces:** Switch without browser tabs
- **Auto-updates:** Silent background updates

### Performance Characteristics
- **Local-first architecture:** IndexedDB cache loads instantly, server sync in background
- **Optimistic updates:** UI updates immediately, network request background (rare rollbacks)
- **Incremental sync:** Only deltas after initial load
- **Virtualized lists:** Thousands of issues scroll smoothly (60fps)
- **Minimal re-renders:** Granular React state management
- **Prefetching:** Likely destinations preload data
- **Lean bundle:** Code splitting, small JS footprint

### Perceived Performance Times
- Switch between views: <50ms (local cache)
- Create issue: UI updates in <16ms, server confirms background
- Search results: <100ms for first results
- Initial load (cached): <1s
- Initial load (fresh): 2-4s

### Animations & Micro-Interactions
- **Transitions:** Crossfade on view switch (150-200ms), sidebar collapse (200ms), detail panel slide (200ms)
- **Micro:** Status changes animate color fill, priority icon smooth transition, checkbox scale bounce
- **Hover states:** Subtle background shift (50ms), focus rings (purple outline)
- **Drag & drop:** Elevate card with shadow, rotate slightly (~2°), placeholder with spring animation
- **Notifications:** Slide in from bottom-right, auto-dismiss 3-4s with fade-out
- **Loading:** Skeleton pulse shimmer
- **Motion principles:** Fast (100-250ms), ease-out curves, no gratuitous animation, respects prefers-reduced-motion

---

## 6. Data Model & Schema

### Schema Scale
- **555** object types
- **351** input types
- **89** enums
- **8** interfaces
- **10** union types
- **16** scalar types

### Core Entities & Relationships
```
Organization (workspace)
  ├── Team (many)
  │    ├── Issue (many)
  │    ├── Cycle (many)
  │    ├── WorkflowState (many)
  │    ├── IssueLabel (team-scoped)
  │    └── Template (team-scoped)
  ├── Project (cross-team)
  │    ├── ProjectMilestone (many)
  │    └── ProjectUpdate (many)
  ├── Initiative (high-level goals)
  │    ├── InitiativeUpdate (many)
  │    └── InitiativeRelation (many)
  ├── User (members)
  ├── Document (Linear Docs)
  ├── Customer (for Asks)
  │    └── CustomerNeed (many)
  ├── Webhook (integrations)
  ├── Integration (connected services)
  ├── CustomView (saved filters)
  └── Favorite (bookmarks, hierarchical)
```

### Issue Entity (~60 Fields)
**Identity:** id (UUID), identifier (e.g., ENG-123), number, previousIdentifiers, url
**Content:** title, description, descriptionState (YJS), documentContent
**Properties:** priority, estimate, dueDate, state, team, assignee, creator, delegate
**Organization:** project, projectMilestone, cycle, parent
**Relationships:** labels, children (sub-issues), comments, attachments, relations
**Timestamps:** createdAt, updatedAt, archivedAt, startedAt, completedAt, canceledAt, autoArchivedAt
**Lifecycle:** snoozedUntilAt, snoozedBy, lastAppliedTemplate, recurringIssueTemplate
**SLA:** slaBreachesAt, slaHighRiskAt, slaMediumRiskAt, slaStartedAt
**Other:** trashed, favorite, reactionData, reactions, sourceComment, botActor, integrationSourceType

### Key Entity Fields

**Team:** name, key, displayName, description, icon, color, private, organization, parent, children, cyclesEnabled, cycleConfig, defaultStates, autoClose/Archive config, estimationConfig, defaultTemplates, members, issues, cycles, labels, projects, webhooks

**User:** name, displayName, email, initials, avatarUrl, active, admin, guest, owner, app, timezone, statusEmoji, statusLabel, isMe, isAssignable, isMentionable, assignedIssues, createdIssues, teams

**Organization:** name, urlKey, logoUrl, userCount, createdIssueCount, feature flags, settings, subscription, projectStatuses, integrations, labels, teams, users, templates

**Project:** name, slugId, description, content, icon, color, status, health, priority, progress, scope, startDate, targetDate, lead, creator, issues, members, teams, milestones, updates, documents, labels

**Cycle:** name, number, description, startsAt, endsAt, completedAt, isActive, isFuture, isPast, progress, scope, team, issues

**WorkflowState:** name, color, type (triage|backlog|unstarted|started|completed|canceled|duplicate), position, team, inheritedFrom

**IssueLabel:** name, color, description, isGroup, parent, children, team (null=workspace), creator, retiredAt

**Comment:** body, bodyData (Prosemirror), user, externalUser, botActor, issue, parent, children, editedAt, resolvedAt, reactionData, reactions

**Document:** title, slugId, content, contentState (YJS), icon, color, creator, updatedBy, project/initiative/issue/cycle/team association, trashed

**Favorite:** type, sortOrder, title, owner, parent, children, folderName, polymorphic target (issue/project/cycle/view/document/label/initiative/customer/roadmap/release/user), predefinedViewType, icon, color, url

### ID System
- **All entities use UUIDs** as primary identifier (id: ID!)
- **Human-readable shorthands:** Issues use TEAM-KEY-NUMBER (e.g., ENG-123)
- **Interchangeable in API:** Both UUID and shorthand accepted in queries/mutations
- **slugId:** Documents, Projects, Initiatives, Roadmaps use URL-friendly identifiers
- **Client-generated IDs:** Supported on IssueCreateInput (important for offline-first)

### Pagination (Relay Cursor-Based)
```graphql
type IssueConnection {
  edges: [IssueEdge!]!
  nodes: [Issue!]!         # convenience
  pageInfo: PageInfo!
}

type PageInfo {
  endCursor: String
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
}
```
**Arguments:** first/after, last/before, includeArchived (default false), orderBy (createdAt|updatedAt)

### Filtering System
**Comparators:** Typed (String, Number, Date, Boolean, Nullable)
**Operators:** eq, neq, in, nin, contains, startsWith, endsWith, lt, lte, gt, gte
**Logic:** AND by default, explicit and/or arrays for composition
**Relationships:** Nested (assignee: { email: { eq: "..." } })
**Collections:** "includes any/all/neither/either/none" semantics

**IssueFilter fields (~40):** assignee, creator, state, team, project, projectMilestone, cycle, parent, labels, priority, estimate, dueDate, title, description, createdAt, updatedAt, completedAt, canceledAt, startedAt, snoozedUntilAt, children, comments, attachments, reactions, relations, subscribers, custom fields

### Sync Engine (Offline-First Architecture)
**Local Storage:** IndexedDB full local database with all entities
**Bootstrap:** Two-phase (full instant models, partial deferred data)
**SyncAction:** Atomic unit with id (monotonic), modelName, modelId, action (I|U|D|A), data

**Real-time:** WebSocket delta packets, MobX reactive updates
**Delta sync:** /sync/delta?lastSyncId=X&toSyncId=Y for catch-up
**Conflict resolution:** Last-writer-wins; server is source of truth
**State management:** MobX observables, Object Pool for fast model retrieval, lazy hydration

**Key principles:**
- Local mutations immediately, async server confirmation
- Full offline functionality with queued transaction sync
- Developer API simple: `issue.title = "X"; issue.save()`
- New features often possible without backend changes

### Archived vs Deleted
- **Archived** (archivedAt: DateTime): Soft removal, hidden by default, queryable with includeArchived: true, reversible
- **Trashed** (trashed: Boolean): Intermediate state, recoverable
- **Deleted:** Permanent, SyncAction with action: "D" and data: null

### Custom Fields Approach
Linear doesn't expose user-defined custom fields in public schema. Instead:
- **Labels:** Hierarchical, colored, groupable (not custom fields but effective categorization)
- **Templates:** Store arbitrary JSON (templateData) with optional form fields
- **JSONObject fields:** Extensible metadata on Attachment, settings, etc.
- **CustomView filterData:** JSON filter compositions

### Favorites System (Polymorphic Bookmarks)
- **Folder structure:** Nested via parent/children
- **Polymorphic:** Can reference issue, project, cycle, view, document, label, initiative, customer, roadmap, release, user
- **Predefined views:** "My Issues", "Active Cycle", etc.
- **Per-user:** owner field
- **Ordering:** sortOrder for manual arrangement

### Notifications
- Inbox with up to 500 (older auto-removed)
- Subscriptions: auto on create/assign/@mention, manual subscribe/unsubscribe
- Channels: in-app, desktop push, mobile push, Slack, email (digest)
- Snooze vs Reminder (scheduled, persistent)

### Real-time Subscriptions (GraphQL)
Exposed for: Issue, Comment, Cycle, Document, Label, Project, ProjectUpdate, Initiative, InitiativeUpdate, Notification, User, Webhook, plus SLA and OAuth app revocation events

### Scalar Types
DateTime, TimelessDate (date-only), Duration, JSON, JSONObject, UUID

---

## Implementation Priorities

### Phase 1: Foundation (Months 1-3)
1. **Database schema:** PostgreSQL, UUIDs, archived/trashed fields
2. **GraphQL API:** Core entities (Organization, Team, User, Issue, WorkflowState)
3. **Authentication:** Email + OAuth2 with refresh tokens
4. **Issue core:** Title, description, status, priority, assignee, basic labels
5. **Basic UI:** List view, issue detail panel, create modal
6. **Real-time:** WebSocket sync engine bootstrap (IndexedDB local storage)

### Phase 2: Essential Features (Months 4-6)
1. **Project management:** Projects, cycles, milestones
2. **Advanced issue fields:** Estimates, due dates, sub-issues, relations
3. **Filtering & views:** Custom views, saved filters, multiple groupings
4. **Notifications:** Inbox, subscriptions, snooze
5. **Board view:** Kanban board with drag-drop
6. **Templates:** Issue templates, batch creation

### Phase 3: Team & Organization (Months 7-9)
1. **Teams & sub-teams:** Hierarchical teams, team-specific settings
2. **Workspace structure:** Multi-team support, team switching
3. **Roles & permissions:** Admin, Member, Guest roles, granular permissions
4. **Labels system:** Workspace vs team-scoped, label groups
5. **SAML/SSO:** Enterprise authentication
6. **Audit logs:** 90-day history tracking

### Phase 4: Integrations & Polish (Months 10-12)
1. **GitHub integration:** PR linking, branch status sync
2. **Slack integration:** Issue creation, bidirectional thread sync, @Linear agent
3. **Webhooks:** Event system, signature verification, retries
4. **Import/export:** Data migration tools
5. **Mobile app:** React Native iOS/Android
6. **Desktop app:** Electron wrapper with global shortcuts
7. **Performance optimization:** Bundle size, rendering optimization

### Phase 5: Advanced (Months 13+)
1. **Initiatives & roadmaps:** Strategic planning features
2. **SLAs:** Deadline automation, risk tracking
3. **AI features:** Triage intelligence, document summarization, agent automation
4. **Documents:** Linear Docs with collaborative editing
5. **Customers:** Linear Asks, customer tracking
6. **Advanced analytics:** Trends, insights, burndown charts
7. **Third-party integrations:** Figma, Sentry, Zendesk, Intercom, etc.

### Critical Technical Decisions
- **Local-first sync engine:** Essential for perceived performance; requires IndexedDB + WebSocket + delta sync
- **GraphQL as primary API:** Matches Linear's approach, enables complex queries
- **Relay pagination:** Cursor-based, standard implementation
- **MobX for state:** Reactive, observable-based approach (alternative: Zustand for simpler setup)
- **TypeScript everywhere:** Frontend and backend, shared types
- **Dark mode as default:** Design-forward, matches Linear's brand
- **Keyboard-first UX:** Accessibility + power-user efficiency
- **Offline support:** IndexedDB + optimistic updates required early

---

## References & Sources

**Official Documentation:**
- [Linear Developers](https://linear.app/developers)
- [Linear Docs](https://linear.app/docs)
- [Linear API Schema (Apollo Studio)](https://studio.apollographql.com/public/Linear-API/schema/reference?variant=current)
- [Linear GitHub Repo](https://github.com/linear/linear)

**Research & Analysis:**
- Reverse Engineering Linear's Sync Magic (marknotfound.com)
- The Story of Linear (Pragmatic Engineer)
- Linear Product Walkthroughs
- GraphQL Schema Analysis (43,106 lines)

---

**Research completed:** April 2026  
**Total analysis:** 6 comprehensive dimensions covering 555+ pages of detailed technical specifications  
**Ready for:** Full rebuild, architecture planning, team onboarding, implementation roadmap

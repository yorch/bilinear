# Linear Research: Feature Audit & Competitive Analysis

> Research conducted April 2026. Goal: document Linear's complete offering as the reference target for this open-source alternative.

---

## 1. What Linear Is

Linear is a **system for product development** — not just an issue tracker. It positions itself as the unified platform for the full software delivery lifecycle: from strategic planning (initiatives, roadmaps) to daily execution (issues, cycles) to customer feedback loops (Customer Requests, Asks).

Their philosophy, documented in [The Linear Method](https://linear.app/method/introduction):

- **Build for creators** — optimize for the people doing the work, not managers tracking it
- **Momentum over sprints** — sustainable cadence, not velocity-at-all-costs
- **Clarity above all** — call things what they are, use standard terminology
- **Eliminate busy work** — automate the meta-work so teams focus on what matters
- **Simple first, then powerful** — easy onboarding that grows naturally
- **Decide and move on** — action over deliberation

The tool is explicitly **opinionated**: no custom fields, fixed priority levels, fixed workflow state categories. This is a feature, not a bug.

---

## 2. Conceptual Hierarchy

```text
Workspace
├── Teams (n-levels deep, up to 5)
│   ├── Workflow States (customizable within fixed categories)
│   ├── Labels (team-scoped)
│   ├── Templates
│   ├── Cycles (time-boxed, recurring)
│   └── Issues
│       ├── Sub-issues (multi-level)
│       ├── Comments & Activity
│       ├── Relations (blocks, duplicate, related)
│       └── Attachments
├── Projects (cross-team)
│   ├── Milestones
│   ├── Documents
│   ├── Project Updates (health reports)
│   └── Issues (from any team)
├── Initiatives (workspace-level, groups projects)
│   └── Sub-Initiatives (up to 5 levels)
├── Documents (standalone, associated with projects/teams)
├── Views (saved filters, per-team or workspace)
└── Customers & Requests (feedback layer)
```

**Key design decision:** Issues belong to exactly one team. Projects can span teams. Initiatives span projects. The hierarchy is strict but allows cross-cutting via projects/initiatives.

---

## 3. Feature Inventory

### 3.1 Issues (Core)

The atomic unit. Identified by `TEAM-NUMBER` (e.g., `ENG-123`).

**Properties:**

| Property  | Type                                              | Required |
| --------- | ------------------------------------------------- | -------- |
| Title     | String                                            | Yes      |
| Status    | WorkflowState                                     | Yes      |
| Priority  | Enum (No Priority / Urgent / High / Medium / Low) | No       |
| Assignee  | User or AI Agent                                  | No       |
| Labels    | Label[]                                           | No       |
| Estimate  | Number (team scale)                               | No       |
| Due Date  | Date                                              | No       |
| Project   | Project                                           | No       |
| Milestone | ProjectMilestone                                  | No       |
| Cycle     | Cycle                                             | No       |
| Parent    | Issue (sub-issue)                                 | No       |
| SLA       | Auto-applied rule                                 | No       |

**Capabilities:**

- Relations: Related, Blocks, Blocked by, Duplicate
- Sub-issues with multiple levels of nesting
- Issue templates (pre-fill properties + description)
- Bulk operations: multi-select, bulk status/priority/assignee/label changes
- Drag-to-reorder within priority-sorted views
- Convert sub-issue ↔ standalone
- Issue history/activity feed: all property changes tracked

### 3.2 Workflow States

Fixed **6 categories** (Triage, Backlog, Unstarted, Started, Completed, Canceled). Custom statuses can be added within each. Each team configures its own workflow.

**Automations on state transitions:**

- Git branch created → move to Started
- PR opened → move to In Review
- PR merged → move to Completed

### 3.3 Cycles (Sprints)

Time-boxed periods, typically 2 weeks. Key properties:

- Configurable length (1–8 weeks), start day, cooldown period
- Auto-generate up to 15 upcoming cycles
- Auto-rollover of incomplete issues to next cycle (configurable)
- Capacity estimation from 3-cycle velocity history
- Burndown chart per cycle
- Scope creep tracking (issues added after cycle start)
- Calendar feed integration (Google Calendar, .ics)

**Philosophy:** Cycles are about maintaining momentum, not about shipping releases. They don't end in deployments.

### 3.4 Projects

Cross-team, time-bound deliverables.

**Properties:** name, icon, color, lead, members, teams, start/target dates, status, health (On Track / At Risk / Off Track), priority, labels, description, dependencies, initiative membership.

**Contents:** Issues (from any team), Documents, Milestones, Links.

**Project Updates:** Health report with rich text. Configurable reminder cadence (daily/weekly/biweekly). Staleness indicators.

**Views inside projects:** Custom filtered tabs (e.g., "bugs", "assigned to me", "in progress"). Shareable.

### 3.5 Milestones

Stages within a project. Optional target dates. Completion percentage (% of milestone issues completed). Diamond icon with status coloring. Issues assignable to milestones.

### 3.6 Initiatives (formerly Roadmaps)

Strategic layer above projects. Workspace-level. Properties: name, owner, target date, health, status (Planned/Active/Completed). Sub-initiatives supported (5 levels deep, multiple parents). Quarterly planning view, product pipeline view, timeline/Gantt view.

Used for: aligning teams on company objectives, resource allocation planning, progress monitoring at scale.

### 3.7 Documents

Collaborative real-time documents (multiplayer editing). Associated with projects, teams, or initiatives. Features:

- Inline commenting
- Text-to-issue commands (convert bullet points into issues)
- Update subscriptions with change tracking
- Templates
- AI summaries

Use case: PRDs, specs, proposals, meeting notes — living alongside the work they describe.

### 3.8 Triage

Optional per-team inbox for incoming issues (from integrations, outside team members, forms).

**Actions:** Accept (`1`), Mark as Duplicate (`2`), Decline (`3`), Snooze (`H`).

**Automation tiers (Business/Enterprise):**

1. **Triage Rules** — predefined condition/action rules
2. **Triage Intelligence** — AI analyzes issues, suggests team routing, assignee, labels, surfaces duplicates
3. **Triage Automations** — open-ended AI agent behaviors on triage events

**Triage Responsibility:** Assign specific team members to handle triage. Integrates with on-call schedules (PagerDuty, OpsGenie, Rootly, Incident.io).

### 3.9 Views & Filtering

**View types:**

- List view — dense, configurable columns, groupable
- Board view — Kanban, drag-drop, optional swimlanes
- Timeline view — Gantt-style with draggable bars

**Filter operators:** is, is not, is any of, is none of, contains, before, after, between, overdue.

**Filter fields:** status, assignee, creator, label, priority, project, cycle, estimate, due date, created/updated date, subscriber, relations, has: attachments/comments/sub-issues.

**AND/OR composition with nested groups.** Save as personal or shared views. Favoritable, shareable via URL, set as default home.

### 3.10 Keyboard-First UX

This is one of Linear's defining differentiators. Near-complete mouse-free operation:

| Action            | Shortcut     |
| ----------------- | ------------ |
| Create issue      | `C`          |
| Command palette   | `Cmd/Ctrl K` |
| Navigate sections | `G` + letter |
| Accept triage     | `1`          |
| Decline triage    | `3`          |
| Multi-select      | `X`          |
| Snooze            | `H`          |

The interface **teaches shortcuts passively** — hovering any element reveals the keyboard hint. After ~1 week, experienced users operate entirely without the mouse.

Design principle: even 1–2 seconds saved per interaction compounds to hours/week for power users doing hundreds of daily interactions.

### 3.11 Search

Global search across issues, projects, documents, comments. Issue ID instant jump (e.g., `ENG-123`). Fuzzy matching on titles. Semantic search (AI-powered). <100ms perceived latency. Fully keyboard-navigable.

### 3.12 Labels

Workspace-level and team-level. **Label groups:** single nesting level, single-select per group (up to 250 labels per group). Properties: name, color, description (shown on hover). Archive (preserves on existing issues) vs. delete.

### 3.13 Notifications & Inbox

- Auto-subscribe on: issue creation, assignment, @mention
- Manual subscribe/unsubscribe
- Snooze and reminders
- Channels: in-app inbox, desktop push, mobile push, email digest, Slack/Teams
- View subscriptions (subscribe to a filtered view)

### 3.14 Teams & Workspace

**Multi-level sub-teams:** up to 5 levels deep. Sub-teams inherit parent configuration. **Team owners** role can manage their own team settings/membership.

**Roles:** Admin (full workspace), Member (standard), Guest (team-scoped access, Business+).

**Multi-workspace:** users can belong to multiple workspaces.

### 3.15 SLAs

Auto-apply deadlines via rules. Risk progression: Low → Medium → High → Breached → Achieved/Failed. Business day configuration. Notifications 24h before breach. Webhook events on SLA state changes.

### 3.16 Insights / Analytics (Business+)

**6 measurement types:**

1. Issue count (bar graph)
2. Effort / estimate points (bar graph)
3. Cycle Time — started → completed (scatterplot)
4. Lead Time — created → completed (scatterplot)
5. Triage Time — time in Triage status (scatterplot)
6. Issue Age — time since creation (scatterplot)

**Burn-up/cumulative flow diagrams** showing historical work streams.

**Filtering dimensions:** assignee, status, project, team, label. Date ranges: current cycle, last N cycles, last 30/90/180 days, custom.

**Export to CSV.** Shareable via workspace links.

**Notable gap:** No native burndown chart (cycle-scoped burn), no WIP-over-time chart, no flow efficiency. These require third-party integrations (Screenful, Count.co).

### 3.17 AI Features (Linear Agent)

Progressively integrated — not a sidebar chatbot but woven into workflows:

- **Issue summarization:** condenses long issue threads into a paragraph
- **Triage Intelligence:** AI routing, duplicate detection, property suggestions
- **Triage Automations:** define complex behaviors for Agent to execute on incoming issues
- **Bulk updates:** Agent can reorganize labels, update multiple issues
- **Code Intelligence (upcoming):** code-aware task execution
- **Coding tool deeplinks:** launch Cursor, Claude Code, Windsurf from an issue with pre-filled context (issue ID, description, comments, images)
- **Slack/Teams Agent:** Linear Agent operable from chat tools

### 3.18 Linear Asks

Internal helpdesk layer. Turns workplace requests (IT, HR, data pulls, feature requests, bug reports) into structured Linear issues.

**Input channels:**

- @Linear Asks mention in Slack
- Email (forward/cc to dedicated address)
- Custom web forms (built on issue templates) — public, no Linear account needed

**Workflow:** submitted requests → routable to appropriate team via triage → two-way email thread sync → status updates visible to requester.

Available on Business+ plans.

### 3.19 Customer Requests

CRM/feedback layer that links customer voices to product work:

- Attach requests to projects and issues — see which customers want what
- Multi-source ingestion: Intercom, Zendesk, Front, Salesforce, email, Slack, Asks forms
- Customer data enrichment: sync company tier, revenue, size from Salesforce for priority scoring
- Smart prioritization: filter by request volume, customer tier, ARR
- Subscribe to customers — get notified when new requests arrive or requested issues complete
- Cross-team alignment: product, engineering, sales, support all see the same request data

### 3.20 Mobile Apps

iOS and Android. Full issue management, notifications, custom navigation. Designed for "moving product work forward from anywhere."

---

## 4. Integrations

### Official (Linear-built)

| Integration         | Key Capabilities                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **GitHub**          | PR/branch ↔ issue sync, auto-status on PR events, CI visibility, branch creation from issue |
| **GitLab**          | MR workflow automation, branch/commit linking                                               |
| **Slack**           | Issue creation from messages, thread sync, notifications, Linear Asks for Slack             |
| **Microsoft Teams** | Notifications, Linear Agent operable from Teams                                             |
| **Figma**           | Create issues from designs, link Figma files to issues, preview embeds                      |
| **Sentry**          | Auto-create issues from error events, link errors to issues                                 |
| **Jira**            | Bidirectional sync (Epic sync), migration tooling                                           |
| **Notion**          | Preview Linear issues/views in Notion, Notion AI can query Linear data                      |
| **Zendesk**         | Route support tickets to Linear, request linking                                            |
| **Intercom**        | Customer feedback → Linear requests                                                         |
| **Front**           | Email thread → Linear issues/requests                                                       |
| **Salesforce**      | Customer data enrichment for Customer Requests                                              |
| **Discord**         | Notifications                                                                               |
| **Google Sheets**   | Data export/analytics                                                                       |
| **VS Code**         | Agent SDK integration, issue-linked coding                                                  |
| **Zapier**          | Custom automations (2,200+ connected apps)                                                  |
| **Airbyte**         | Data warehouse export                                                                       |

### Developer Platform

- **GraphQL API** (primary) — mirrors Linear's internal API
- **Webhooks** — HTTP push for: Issues, Comments, Attachments, Documents, Emoji, Projects, Project Updates, Cycles, Labels, Users, SLAs
- **OAuth2** — for building integrations
- **Personal API keys** — scoped permissions (Read/Write/Admin/Create Issues/Create Comments)
- **TypeScript SDK** — auto-generated from schema
- **Agent SDK** — for building AI coding tool integrations

---

## 5. Pricing Model

| Plan           | Price                | Key Limits / Features                                                                                                   |
| -------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Free**       | $0                   | Unlimited members, 2 teams, 250 issues, Slack+GitHub, Linear Agent (beta)                                               |
| **Basic**      | $10/user/mo (annual) | 5 teams, unlimited issues, file uploads, admin roles                                                                    |
| **Business**   | $16/user/mo (annual) | Unlimited teams, private teams, guests, Triage Intelligence, Agent automations, Insights, Linear Asks, Zendesk+Intercom |
| **Enterprise** | Custom (annual only) | SAML/SCIM, granular admin, audit logs, advanced security, org modeling, migration support, priority support             |

**Key observation:** The free tier 250-issue cap is a deliberate growth lever — real teams outgrow it within weeks.

---

## 6. What's Working (Strengths)

1. **Speed as a feature** — genuinely sub-100ms interactions via optimistic updates + local cache. Not just fast enough, but *feels* instant.
2. **Keyboard-first design** — complete mouse-free operation after ~1 week of use. Hover hints passively teach shortcuts.
3. **Opinionated structure** — no custom fields, no feature bloat. Teams adopt it in hours, not days. The "right" defaults.
4. **Tight GitHub integration** — PR → issue lifecycle automation is seamless for engineering teams.
5. **Linear Method** — the philosophy itself is a product. It shapes how teams think about work, not just where they track it.
6. **Cycles philosophy** — sustainable cadence focus over deadline pressure. Resonates with engineering culture.
7. **AI integration** — not bolted on. Triage Intelligence, Agent automations, and deeplinks to coding tools feel native.
8. **Multi-level hierarchy** — Issue → Project → Initiative covers tactical through strategic planning without over-engineering.
9. **Customer Requests layer** — rare for issue trackers; bridges the product ↔ customer gap without requiring a separate CRM.
10. **Real-time sync** — changes propagate instantly across all connected clients.

---

## 7. What's Missing / Criticized (Weaknesses)

### Core Product Gaps

1. **No custom fields** — deliberate, but limiting for non-engineering teams (HR, marketing, ops). Workaround: labels + templates.
2. **Weak native analytics** — Insights covers the basics but lacks burndown charts (cycle-scoped), WIP over time, flow efficiency metrics, and forecasting. Teams that need serious analytics use Screenful or Count.co.
3. **Reporting is minimal** — no automated report generation, no PDF exports, no presentation-ready dashboards.
4. **Limited per-project views** — board view at project level is less capable than Jira's.
5. **No time tracking** — not built in. Requires Everhour or similar integrations.
6. **No resource/capacity planning** — can see workload per person but can't plan/schedule capacity across future cycles.
7. **No public roadmaps** — can't share a read-only roadmap with customers/the public.
8. **No dependency Gantt at issue level** — timeline view exists at project level but not for issue-level dependency chains.

### Organizational Limitations

1. **Scales to ~500 people** — the minimalist structure starts to strain at large enterprise scale. Not a Jira replacement for 5,000-person orgs.
2. **Not suited for non-engineering teams** — marketing, sales, and ops teams will feel constrained and likely need a separate tool.
3. **Guest access is paid** — external collaborators require a Business plan seat.

### Discovery-to-Delivery Gap

1. **Silent on "why"** — world-class at tracking *how* you build; weak on *why* you're building it. No built-in OKR framework, no customer interview tracking, no opportunity scoring, no Jobs-to-be-Done support. Product discovery lives outside Linear.

### Ecosystem

1. **~200 integrations vs Jira's 3,000+** — Atlassian Marketplace is vastly larger. Linear's integration depth is higher per integration, but breadth is limited.
2. **Priority support only for Enterprise** — smaller teams on Standard get community support only.

---

## 8. Gap Analysis vs. This Project's PRD

The existing PRD ([docs/PRD.md](PRD.md)) covers most of Linear's core feature set well. Below are **gaps and additions** identified from this research:

### Features in Linear not yet in PRD

| Feature                             | Linear Detail                                                         | PRD Coverage                                        |
| ----------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| **AI Agent (Linear Agent)**         | Bulk updates, Slack/Teams operation, code intelligence                | Listed as P5, no detail on Agent architecture       |
| **Coding tool deeplinks**           | Launch Cursor/Claude Code/Windsurf from issue with pre-filled context | Not in PRD                                          |
| **Customer Requests**               | Full CRM-lite feedback layer with Salesforce enrichment               | Not in PRD (noted as out-of-scope)                  |
| **Linear Asks web forms**           | Custom intake forms for non-Linear users, Triage routing              | Not in PRD (noted as out-of-scope)                  |
| **Multi-level sub-teams (5 deep)**  | Sub-teams inherit parent config                                       | PRD mentions P2 sub-teams, no depth limit specified |
| **Team owners role**                | Teams can own their own settings                                      | Not in PRD                                          |
| **Triage Responsibility schedules** | PagerDuty/OpsGenie/Rootly integration for rotating triage             | Not in PRD                                          |
| **SLA Triage Time metric**          | Native SLA triage metric in Insights                                  | Not in PRD analytics section                        |
| **Project document multiplayer**    | YJS real-time collaborative editing on project docs                   | PRD mentions YJS but no multiplayer cursor detail   |
| **Timeline view (Gantt)**           | Issue-level timeline inside projects                                  | Marked P2 in PRD                                    |
| **Burn-up charts**                  | Cumulative flow diagrams in Insights                                  | PRD has burndown, no burn-up                        |
| **Calendar feed for cycles**        | Google Calendar, .ics, feed URL                                       | Not in PRD                                          |
| **Cycle cooldown periods**          | Configurable rest periods between cycles                              | Not in PRD                                          |

### Features in PRD Not Explicitly in Linear

| Feature                       | PRD Detail                                             | Notes                                           |
| ----------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| **Automated Rules Engine UI** | Detailed rule anatomy with dry-run mode, execution log | Linear has this but less documented publicly    |
| **Backlog "Ready" toggle**    | Mark issues as groomed/ready                           | Not a public Linear feature (may use labels)    |
| **Issue age distribution**    | Team health indicator                                  | Available via Insights but not a dedicated view |

### Priority Reassessments

Based on what Linear users cite as critical vs. nice-to-have:

- **GitHub integration (P1)** — correct priority; this is the #1 adoption driver for engineering teams
- **Keyboard shortcuts** — underspecified in PRD; deserves its own requirements section
- **Triage (P1)** — correct; teams with integrations need this from day one
- **Insights/Analytics (P2)** — correct; but even basic cycle burndown should be P1.5
- **Custom fields** — deliberately excluded (as Linear does); maintain this as a non-goal

---

## 9. Key Design Decisions to Replicate

These are the non-obvious choices that make Linear feel like Linear:

1. **Optimistic updates everywhere** — every action updates the UI before the server responds. Rollback only on error.
2. **Local-first with IndexedDB** — the entire workspace fits in the client cache. View switching is zero-latency.
3. **Keyboard hints on hover** — passive education, never annoying
4. **`C` to create anywhere** — global create shortcut accessible from any view
5. **Issue ID as first-class citizen** — `ENG-123` works as a deep link, in search, in comments, in git branches
6. **No custom fields (by design)** — use labels + templates instead. This keeps the data model clean.
7. **Fixed priority levels** — 5 levels, no customization. Forces teams to use a shared language.
8. **Projects don't own issues — teams do** — issues belong to teams; projects are a cross-cutting concern
9. **Cycles don't end in releases** — they end in rhythm. This reframes sprint culture.
10. **Activity feed over edit history** — show *what changed* and *who changed it*, not diffs

---

## 10. Confirmed Design Decisions

These were decided April 2026 after the Linear research review:

| Question                                      | Decision                         | Rationale                                                                                                                               |
| --------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Self-hosted first?**                        | **Yes — primary differentiator** | Linear is cloud-only. Docker Compose deploy is P0. No license keys, no phone-home.                                                      |
| **Custom fields?**                            | **Yes — P2**                     | Unlocks non-engineering teams. Stored as JSONB metadata, doesn't pollute core schema. Max 20 per team.                                  |
| **Enterprise features free for self-hosted?** | **Yes**                          | SAML, SCIM, audit logs are configuration, not business logic. No paywall when user bears hosting cost.                                  |
| **Public roadmaps?**                          | **Yes — P2**                     | Linear doesn't have this. Read-only, optionally password-protected, embeddable. Shows initiative/project progress, not issue internals. |
| **Mobile apps?**                              | **Documented for later**         | Web responsive is V1. Native iOS/Android is a future phase — not abandoned, not prioritized.                                            |
| **AI features?**                              | **Later (Phase 5)**              | Linear Agent is a moat but requires careful design. Opt-in, pluggable providers.                                                        |
| **Time tracking?**                            | **Not building in**              | Out of scope; integration with Toggl/Everhour via webhooks/API is sufficient.                                                           |

---

## Sources

- [Linear Features](https://linear.app/features)
- [Linear Build](https://linear.app/build)
- [Linear Plan](https://linear.app/plan)
- [Linear Conceptual Model Docs](https://linear.app/docs/conceptual-model)
- [Linear Projects Docs](https://linear.app/docs/projects)
- [Linear Triage Docs](https://linear.app/docs/triage)
- [Linear Insights Docs](https://linear.app/docs/insights)
- [Linear Pricing](https://linear.app/pricing)
- [Linear Method](https://linear.app/method/introduction)
- [Linear Changelog](https://linear.app/changelog)
- [Linear Integrations](https://linear.app/integrations/linear-crafted)
- [Linear API Docs](https://linear.app/docs/api-and-webhooks)
- [Linear Customer Requests](https://linear.app/customer-requests)
- [Linear Asks](https://linear.app/features/asks)
